// The WebSocket gateway: builds the features of the hotel (gateway/features/*), connects them, and runs the one browser
// connection. Each feature owns its state and answers its own client messages; this file owns the socket, the rate
// limit, message validation and the timers' lifetime. See docs/architecture.md.
import { WebSocketServer } from "ws";
import type { RawData } from "ws";
import { BUG_RATE_PER_MINUTE, ClientMsgSchema, LOBBY_ROOM, MAX_MESSAGES_PER_SECOND, MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from "@agentlife/shared";
import type { ClientMsg } from "@agentlife/shared";
import { ShotUpload } from "./bug-upload.ts";
import { checkOrigin, normalizeOrigin, parseAllowedOrigins } from "./origin.ts";
import { createContext, mergeHandlers } from "./gateway/context.ts";
import type { Connection, Incoming } from "./gateway/context.ts";
import { createEngineEvents } from "./gateway/engine-events.ts";
import { createArrange } from "./gateway/features/arrange.ts";
import { createBugs } from "./gateway/features/bugs.ts";
import { createBuilder } from "./gateway/features/builder.ts";
import { createEconomy } from "./gateway/features/economy.ts";
import { createFloors } from "./gateway/features/floors.ts";
import { createJobs } from "./gateway/features/jobs.ts";
import { createLibrary } from "./gateway/features/library.ts";
import { createMood } from "./gateway/features/mood.ts";
import { createNight } from "./gateway/features/night.ts";
import { createOutfits } from "./gateway/features/outfits.ts";
import { createPanels } from "./gateway/features/panels.ts";
import { createPipeline } from "./gateway/features/pipeline.ts";
import { createProgress } from "./gateway/features/progress.ts";
import { createProjects } from "./gateway/features/projects.ts";
import { createRooms } from "./gateway/features/rooms.ts";
import { createTeam } from "./gateway/features/team.ts";
import { createWisps } from "./gateway/features/wisps.ts";
import type { GatewayOptions } from "./gateway/options.ts";
import { SlidingWindow, TokenBucket } from "./gateway/rate.ts";

export type { GatewayOptions } from "./gateway/options.ts";
export { SlidingWindow, TokenBucket } from "./gateway/rate.ts";
export { MAILBOX_REPORTS_MAX } from "./gateway/engine-events.ts";

export interface Gateway {
  readonly port: number;
  close(): Promise<void>;
}

export function startGateway(options: GatewayOptions): Promise<Gateway> {
  const bindHost = options.host ?? "127.0.0.1";
  const allowedOrigins = (options.allowedOrigins ?? parseAllowedOrigins(undefined)).map(normalizeOrigin);
  const wss = new WebSocketServer({
    host: bindHost,
    port: options.port ?? 8787,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: (info, done) => {
      if (checkOrigin(info.req.headers.origin, { allowed: allowedOrigins, bindHost })) return done(true);
      done(false, 403, "Forbidden");
    },
  });

  const ctx = createContext(options);
  const { engine, hotel } = ctx;

  // ---- features, each with the others it needs; the order is the order of their timers and first requests ----
  const economy = createEconomy(ctx);
  const outfits = createOutfits(ctx);
  const bugs = createBugs(ctx);
  const wisps = createWisps(ctx, { economy });
  const team = createTeam(ctx, outfits);
  const mood = createMood(ctx, { economy, team });
  const builder = createBuilder(ctx);
  const progress = createProgress(ctx, { economy, outfits, team });
  const floors = createFloors(ctx);
  const night = createNight(ctx, { economy, progress, floors });
  const library = createLibrary(ctx, { economy, progress });
  const pipeline = createPipeline(ctx);
  const projects = createProjects(ctx, { floors });
  const jobs = createJobs(ctx, { floors });
  const panels = createPanels(ctx, { projects, library, night, floors, jobs, pipeline, team, economy, outfits, bugs });
  const rooms = createRooms(ctx, { panels, wisps, mood, economy, bugs, outfits, progress, night, jobs, team, floors });
  const arrange = createArrange(ctx);
  const events = createEngineEvents(ctx, { builder, economy, progress, mood, floors, jobs, wisps });
  ctx.wire.sendSim = rooms.sendSim;
  ctx.wire.sendWelcome = rooms.sendWelcome;

  const handlers = mergeHandlers(
    economy.handlers,
    outfits.handlers,
    bugs.handlers,
    wisps.handlers,
    team.handlers,
    floors.handlers,
    night.handlers,
    library.handlers,
    pipeline.handlers,
    projects.handlers,
    jobs.handlers,
    panels.handlers,
    rooms.handlers,
    arrange.handlers,
  );

  if (engine) {
    events.listen();
    ctx.enqueue(floors.syncProjects);
    ctx.enqueue(night.syncSummaries);
  }
  // Quests completed before a restart whose Ecto was never written: pay them now.
  if (progress.enabled) ctx.enqueue(() => progress.payQuests());

  const tick = setInterval(rooms.tick, options.tickMs ?? 50);

  // Model per role for the agent tooltips. Refreshed on every connection (a reload picks up a late engine); failures
  // leave the cache as it was.
  const refreshModels = (): void => {
    if (!engine?.roleModels) return;
    engine.roleModels().then(
      (m) => {
        if (Object.keys(m).length > 0) ctx.models = m;
      },
      () => undefined,
    );
  };
  refreshModels();

  // The night shift writes its summary while nobody is connected, or while the user works on another floor; the window
  // opens and closes by the clock. One look a minute covers both.
  const nightPoll =
    engine?.getNightSummaries || engine?.getNight
      ? setInterval(() => {
          ctx.enqueue(night.syncSummaries);
          ctx.enqueue(() => night.pushNightClock());
        }, options.nightPollMs ?? 60_000)
      : undefined;
  nightPoll?.unref();

  wss.on("connection", (ws) => {
    // One user session in the MVP: a second connection replaces the first.
    ctx.session()?.ws.close(4000, "replaced by a newer connection");
    const { you, welcome } = hotel.join();
    ctx.setSession({ ws, userId: you, activityAll: false, overviewWatch: false });
    rooms.sendWelcome(ws, hotel.roomOf(you) ?? LOBBY_ROOM, welcome);
    builder.sweep();
    // A project registered since the last connection gets its floor now.
    if (engine) {
      ctx.enqueue(floors.syncProjects);
      ctx.enqueue(night.syncSummaries);
      ctx.enqueue(() => night.pushNightClock(true));
    }
    refreshModels();

    const bucket = new TokenBucket(MAX_MESSAGES_PER_SECOND, ctx.clock);
    const conn: Connection = { bugWindow: new SlidingWindow(BUG_RATE_PER_MINUTE, 60_000, ctx.clock), bugShots: new ShotUpload(ctx.clock) };

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!bucket.take()) return ctx.sendError(ws, "rate_limited", "too many messages");
      if (isBinary) return ctx.sendError(ws, "bad_message", "binary messages are not supported");
      const raw = rawToString(data);
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return ctx.sendError(ws, "bad_message", "invalid JSON");
      }
      const parsed = ClientMsgSchema.safeParse(json);
      if (!parsed.success) return ctx.sendError(ws, "bad_message", "invalid message");
      if (ctx.session()?.ws !== ws) return;
      const msg = parsed.data;
      if (msg.type === "hello") {
        if (msg.protocol !== PROTOCOL_VERSION) ctx.sendError(ws, "bad_message", `protocol ${PROTOCOL_VERSION} required`);
        return;
      }
      const handle = handlers[msg.type] as ((m: ClientMsg, at: Incoming) => void) | undefined;
      if (handle) handle(msg, { ws, raw, conn });
      else rooms.intent(msg);
    });

    ws.on("close", () => {
      const current = ctx.session();
      if (current?.ws === ws) {
        hotel.leave(current.userId);
        ctx.setSession(null);
        wisps.forget();
      }
    });
    ws.on("error", () => ws.terminate());
  });

  return new Promise((resolve, reject) => {
    wss.once("error", reject);
    wss.once("listening", () => {
      const addr = wss.address();
      const port = typeof addr === "object" && addr ? addr.port : (options.port ?? 0);
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(tick);
            clearInterval(nightPoll);
            for (const f of [bugs, floors, wisps, mood, builder, team]) f.close();
            engine?.close?.();
            for (const c of wss.clients) c.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}

function rawToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
