// Jobs from the user's side: start one from a floor's furniture, decide an approval, read a job's details, deliver its
// branch, and the scope of the activity terminal.
import type { WebSocket } from "ws";
import { projectIdOfRoom } from "@agentlife/shared";
import type { StartJobOptions } from "../../engine-link.ts";
import { errorText } from "../context.ts";
import type { GatewayContext, Handlers } from "../context.ts";
import type { FloorsFeature } from "./floors.ts";

export function createJobs(ctx: GatewayContext, deps: { floors: Pick<FloorsFeature, "scheduleOverview"> }) {
  const { engine, hotel, floors, taskRooms, send, sendError } = ctx;

  /** The job card and stepper of a floor: the engine's view of the floor's current job. */
  const sendJobUpdate = async (roomId: string): Promise<void> => {
    const taskId = floors.get(roomId)?.currentTaskId;
    if (!engine || !taskId) return;
    try {
      ctx.toUser(roomId, { type: "job_update", job: await engine.getJob(taskId) });
    } catch {
      ctx.toUser(roomId, { type: "error", code: "engine_unavailable", message: "cannot read job state" });
    }
  };

  const startJob = async (ws: WebSocket, repoId: string, goal: string, options?: StartJobOptions): Promise<void> => {
    if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
    const roomId = ctx.userRoom();
    // The furniture of a floor starts jobs for the floor's own project only.
    if (!roomId || projectIdOfRoom(roomId) !== repoId) return sendError(ws, "bad_message", "start the job from the furniture on the project's floor");
    const f = ctx.floorOf(roomId);
    if (f.jobActive) return sendError(ws, "busy", "a job is already running");
    f.jobActive = true;
    try {
      const { taskId } = await engine.startJob(repoId, goal, options);
      f.currentTaskId = taskId;
      taskRooms.set(taskId, roomId);
    } catch (e) {
      f.jobActive = false;
      sendError(ws, "engine_unavailable", e instanceof Error ? e.message.slice(0, 200) : "cannot start job");
    }
  };

  /** True when the job is known to belong to another floor than the user's. */
  const otherFloor = (taskId: string): boolean => {
    const room = taskRooms.get(taskId);
    return room !== undefined && room !== ctx.userRoom();
  };

  const sendJobDetails = async (ws: WebSocket, taskId: string): Promise<void> => {
    if (!engine?.getJobDetails) return sendError(ws, "engine_unavailable", "no engine connected");
    if (otherFloor(taskId)) return sendError(ws, "bad_message", "that job is on another floor");
    try {
      send(ws, { type: "job_details", details: await engine.getJobDetails(taskId) });
    } catch {
      sendError(ws, "engine_unavailable", "cannot read job details");
    }
  };

  const resolveApproval = async (ws: WebSocket, approvalId: string, decision: "approve" | "reject", note?: string): Promise<void> => {
    if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
    const roomId = ctx.userRoom();
    // Only the approvals of the floor the user is on can be decided.
    if (!roomId || floors.get(roomId)?.approvals.get(approvalId)?.status !== "pending") {
      return sendError(ws, "bad_message", "unknown or resolved approval");
    }
    try {
      await engine.resolveApproval(approvalId, decision, note);
    } catch {
      sendError(ws, "engine_unavailable", "cannot resolve approval");
    }
  };

  /** Fetches the job's branch into the user's repository, then re-sends the report with its new delivery state. */
  const deliverJob = async (ws: WebSocket, taskId: string): Promise<void> => {
    if (!engine?.deliver) return sendError(ws, "engine_unavailable", "no engine connected");
    if (otherFloor(taskId)) return sendError(ws, "bad_message", "that job is on another floor");
    try {
      const info = await engine.deliver(taskId);
      for (const f of floors.values()) {
        for (const r of f.reports.values()) {
          if (r.taskId !== taskId) continue;
          r.delivery = { state: "done", branch: info.branch, commit: info.commit };
          const room = taskRooms.get(taskId);
          if (room) ctx.toUser(room, { type: "report", report: r, resend: true });
        }
      }
      deps.floors.scheduleOverview();
    } catch (e) {
      sendError(ws, "delivery_failed", errorText(e, "cannot deliver the branch"));
    }
  };

  /** Activity terminal scope. "all" sends the other floors' buffered lines at once and their new lines from now on. */
  const setActivityScope = (scope: "floor" | "all"): void => {
    const current = ctx.session();
    if (!current) return;
    current.activityAll = scope === "all";
    if (!current.activityAll) return;
    // Sent on every request: the client asks again after each `welcome` (its terminal was reseeded with one floor).
    const here = ctx.userRoom();
    ctx.enqueue(() => {
      const now = ctx.session();
      if (!now?.activityAll) return;
      for (const [roomId, f] of floors) {
        if (roomId === here || !hotel.has(roomId)) continue;
        for (const line of f.activity) send(now.ws, { type: "activity", line });
      }
    });
  };

  const handlers: Handlers = {
    start_job: (msg, { ws }) => {
      const kind = msg.kind ?? "change";
      void startJob(ws, msg.repoId, msg.goal, kind === "change" ? undefined : { kind, target: msg.target });
    },
    approve: (msg, { ws }) => void resolveApproval(ws, msg.approvalId, msg.decision, msg.note),
    job_details: (msg, { ws }) => void sendJobDetails(ws, msg.taskId),
    deliver: (msg, { ws }) => void deliverJob(ws, msg.taskId),
    activity_scope: (msg) => setActivityScope(msg.scope),
  };

  return { sendJobUpdate, handlers };
}
export type JobsFeature = ReturnType<typeof createJobs>;
