// What the gateway does with each event of the engine: Ecto and XP first, then the room's simulation, then the floor's
// mirrored state (job, approvals, reports, activity, work) and what the user is told.
import { ACTIVITY_BUFFER_SIZE, LOBBY_ROOM, projectRoomId, splitAgentId } from "@agentlife/shared";
import type { ActivityLine, AgentEvent, AgentWork, Approval, JobState, Report, StepName } from "@agentlife/shared";
import { ProgressTracker } from "../progress-tracker.ts";
import type { Floor, GatewayContext } from "./context.ts";
import type { EconomyFeature } from "./features/economy.ts";
import type { FloorsFeature } from "./features/floors.ts";
import type { JobsFeature } from "./features/jobs.ts";
import type { MoodFeature } from "./features/mood.ts";
import type { ProgressFeature } from "./features/progress.ts";
import type { WispsFeature } from "./features/wisps.ts";

/** Reports kept in a floor's mailbox; older ones remain in the engine and in the run folder. */
export const MAILBOX_REPORTS_MAX = 10;

const STEP_OF_STATE: Partial<Record<JobState, StepName>> = {
  analyzing: "analyze",
  developing: "develop",
  testing: "test",
  reviewing: "review",
  report_ready: "report",
};

export interface EngineEventDeps {
  builder: { observe(ev: AgentEvent): void };
  economy: Pick<EconomyFeature, "tracker" | "grantEcto">;
  progress: Pick<ProgressFeature, "enabled" | "recordFact">;
  mood: Pick<MoodFeature, "observe" | "reactToDelivery">;
  floors: Pick<FloorsFeature, "syncProjects" | "pushFloors" | "scheduleOverview">;
  jobs: Pick<JobsFeature, "sendJobUpdate">;
  wisps: Pick<WispsFeature, "dropStale">;
}

/** A finished, failed or cancelled job can no longer be approved; keep its resolved approvals
 *  (history) but drop the pending ones so the mailbox never offers a dead Approve button. */
const dropPendingApprovals = (f: Floor, taskId: string): void => {
  for (const [id, a] of f.approvals) if (a.taskId === taskId && a.status === "pending") f.approvals.delete(id);
};

export function createEngineEvents(ctx: GatewayContext, d: EngineEventDeps) {
  const { hotel, engine, taskRooms, toUser } = ctx;
  const progressTracker = new ProgressTracker();

  /** The room an event belongs to: the room of its job, else the project in its agent id, else the lobby (Builder). */
  const roomOfEvent = (ev: AgentEvent): string | undefined => {
    if (ev.type === "task.created") {
      const room = projectRoomId(ev.repoId);
      taskRooms.set(ev.taskId, room);
      return room;
    }
    const known = taskRooms.get(ev.taskId);
    if (known) return known;
    const agent = "agentId" in ev ? ev.agentId : undefined;
    if (!agent) return undefined;
    const { projectId, agentId } = splitAgentId(agent);
    if (projectId !== undefined) return projectRoomId(projectId);
    return agentId === "builder" ? LOBBY_ROOM : undefined;
  };

  /** The floor's mirrored state and what the user is told, per event type. */
  const applyToFloor = async (ev: AgentEvent, roomId: string, f: Floor): Promise<void> => {
    switch (ev.type) {
      case "task.created":
        f.currentTaskId = ev.taskId;
        f.jobActive = true;
        f.approvals.clear();
        // Reports of earlier jobs stay in the mailbox (the newest MAILBOX_REPORTS_MAX); approvals belong to one job.
        f.works.clear();
        f.currentStep = undefined;
        f.verdicts.clear();
        f.jobState = "created";
        f.queuePosition = undefined;
        f.unread = null;
        f.jobKind = ev.kind;
        f.jobTarget = ev.target;
        f.timeline = [{ ts: ev.ts, state: "created" }];
        await d.jobs.sendJobUpdate(roomId);
        d.floors.pushFloors();
        break;
      case "task.queued":
        if (ev.taskId === f.currentTaskId) {
          f.queuePosition = ev.position;
          d.floors.pushFloors();
        }
        break;
      case "task.state_changed":
        if (ev.taskId === f.currentTaskId) {
          f.currentStep = STEP_OF_STATE[ev.state];
          f.jobState = ev.state;
          f.queuePosition = undefined;
          f.timeline.push({ ts: ev.ts, state: ev.state });
        }
        if (ev.state === "report_ready" && ev.reason?.startsWith("verdict:")) {
          const v = ev.reason.slice("verdict:".length);
          if (v === "pass" || v === "fail") f.verdicts.set(ev.taskId, v);
        }
        if (ev.state === "cancelled" || ev.state === "delivered" || ev.state === "failed") {
          dropPendingApprovals(f, ev.taskId);
          if (ev.taskId === f.currentTaskId) f.works.clear();
        }
        // The engine ends a rejected or cancelled job with `cancelled` only (no task.failed/completed).
        if ((ev.state === "cancelled" || ev.state === "delivered") && ev.taskId === f.currentTaskId) f.jobActive = false;
        if (ev.taskId === f.currentTaskId) {
          await d.jobs.sendJobUpdate(roomId);
          d.floors.pushFloors();
        }
        break;
      case "task.failed":
      case "task.completed":
        dropPendingApprovals(f, ev.taskId);
        if (ev.taskId === f.currentTaskId) {
          f.jobActive = false;
          await d.jobs.sendJobUpdate(roomId);
          d.floors.pushFloors();
        }
        break;
      case "approval.requested": {
        const a: Approval = {
          approvalId: ev.approvalId,
          taskId: ev.taskId,
          kind: ev.kind,
          summary: ev.summary,
          status: "pending",
          ...(ev.options ? { options: ev.options } : {}),
        };
        f.approvals.set(a.approvalId, a);
        toUser(roomId, { type: "approval", approval: a });
        break;
      }
      case "approval.resolved": {
        const a = f.approvals.get(ev.approvalId);
        if (a) {
          a.status = ev.decision === "approve" ? "approved" : "rejected";
          toUser(roomId, { type: "approval", approval: a });
        }
        break;
      }
      case "report.ready": {
        const r: Report = {
          reportId: ev.reportId,
          taskId: ev.taskId,
          title: ev.title,
          markdown: ev.markdown,
          ts: ev.ts,
          ...(f.verdicts.has(ev.taskId) ? { verdict: f.verdicts.get(ev.taskId)! } : {}),
        };
        // The job card tells whether the job's branch can be delivered to the user's repository.
        if (engine?.getJobDetails) {
          try {
            const { job } = await engine.getJobDetails(ev.taskId);
            if (job.delivery) r.delivery = { state: "done", branch: job.delivery.branch, commit: job.delivery.commit };
            else if (job.deliverable) r.delivery = { state: "available" };
          } catch {
            // No delivery button, the report itself still arrives.
          }
        }
        f.reports.set(r.reportId, r);
        while (f.reports.size > MAILBOX_REPORTS_MAX) f.reports.delete(f.reports.keys().next().value!);
        // Unread until the user opens the mailbox on this floor; a report that arrives while the user reads it counts as read.
        f.unread = r.verdict === "fail" ? "failed" : "report_ready";
        toUser(roomId, { type: "report", report: r });
        d.floors.pushFloors();
        break;
      }
      case "agent.activity": {
        const line: ActivityLine = {
          ts: ev.ts,
          agentId: splitAgentId(ev.agentId).agentId,
          text: ev.text,
          taskId: ev.taskId,
          roomId,
          ...(f.currentStep && ev.taskId === f.currentTaskId ? { step: f.currentStep } : {}),
        };
        f.activity.push(line);
        if (f.activity.length > ACTIVITY_BUFFER_SIZE) f.activity.splice(0, f.activity.length - ACTIVITY_BUFFER_SIZE);
        // "All floors" also gets the lines of the floors the user is not on (opt-in, see `activity_scope`).
        const current = ctx.session();
        if (current?.activityAll) ctx.send(current.ws, { type: "activity", line });
        else toUser(roomId, { type: "activity", line });
        break;
      }
      case "agent.work": {
        const { taskId, step, title, model, contextPct, filesRead, filesEdited, startedAt } = ev;
        const agentId = splitAgentId(ev.agentId).agentId;
        const work: AgentWork = {
          taskId,
          step,
          title,
          ...(model ? { model } : {}),
          ...(contextPct === undefined ? {} : { contextPct }),
          filesRead,
          filesEdited,
          startedAt,
        };
        f.works.set(agentId, work);
        toUser(roomId, { type: "work", agentId, work });
        break;
      }
      default:
        break;
    }
  };

  const onEngineEvent = (ev: AgentEvent): void => {
    d.builder.observe(ev);
    ctx.enqueue(async () => {
      // Before any room lookup: a job on a floor that has no room yet still earns and still counts.
      const candidates = d.economy.tracker.observe(ev);
      if (ctx.options.economy) for (const c of candidates) d.economy.grantEcto(c.reason, c.ref, c.ts);
      if (d.progress.enabled) for (const tracked of progressTracker.observe(ev, d.economy.tracker)) await d.progress.recordFact(tracked);
      d.mood.observe(ev);
      const roomId = roomOfEvent(ev);
      if (!roomId) return;
      if (ev.type === "task.state_changed" && ev.state === "delivered") d.mood.reactToDelivery(roomId, ev.taskId, ev.ts);
      // A project registered after the gateway started has no floor yet.
      if (!hotel.has(roomId)) await d.floors.syncProjects();
      const sim = hotel.sim(roomId);
      if (!sim) return;
      const f = ctx.floorOf(roomId);
      await ctx.wire.sendSim(roomId, sim.handleAgentEvent(ev));
      await applyToFloor(ev, roomId, f);
      // Approvals, reports and job states change what the overview shows; activity lines do not.
      if (ev.type !== "agent.activity" && ev.type !== "agent.work") d.floors.scheduleOverview();
    });
    // After the event was handled: a job that ended takes its wisp with it.
    ctx.enqueue(d.wisps.dropStale);
  };

  /** Reads the engine's event stream for the life of the gateway. */
  const listen = (): void => {
    if (!engine) return;
    void (async () => {
      try {
        for await (const ev of engine.events()) onEngineEvent(ev);
      } catch {
        const ws = ctx.session()?.ws;
        if (ws) ctx.sendError(ws, "engine_unavailable", "engine event stream ended");
      }
    })();
  };

  return { listen };
}
