// The Builder that stopped reporting (ui-tidy): back to idle after the stale time.
import { LOBBY_ROOM } from "@agentlife/shared";
import type { AgentEvent } from "@agentlife/shared";
import { BuilderWatch } from "../../builder-watch.ts";
import type { GatewayContext } from "../context.ts";

export function createBuilder(ctx: GatewayContext) {
  const watch = new BuilderWatch(ctx.options.builder?.staleMs);

  /** Sends the Builder to idle when it has been busy and silent for too long. The lobby sim keeps the state, so a reload shows it. */
  const sweep = (): void => {
    const now = Date.now();
    if (!watch.expired(now)) return;
    ctx.enqueue(async () => {
      const sim = ctx.hotel.sim(LOBBY_ROOM);
      if (!sim) return;
      await ctx.wire.sendSim(LOBBY_ROOM, sim.handleAgentEvent({ type: "agent.state_changed", seq: 0, ts: now, taskId: "builder-idle", agentId: "builder", state: "idle" }));
    });
  };
  const poll = setInterval(sweep, ctx.options.builder?.pollMs ?? 30_000);
  poll.unref();

  return { observe: (ev: AgentEvent) => watch.observe(ev), sweep, close: () => clearInterval(poll) };
}
