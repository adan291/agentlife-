import {
  DEFAULT_PIPELINE,
  defaultMemberFor,
  pipelineProblem,
  validatePipeline,
  type PipelineCheck,
  type PipelineResponse,
  type PipelineStep,
  type TeamMember,
} from "@agentlife/shared";
import { ConflictError } from "../errors.ts";
import { BadRequestError } from "../http/server.ts";
import type { PipelineStore } from "./store.ts";

/** What the service needs of the teams: the members of a project (throws for an unknown project). */
export interface TeamSource {
  team(projectId: string): { members: readonly TeamMember[] };
}

export interface PipelineServiceOptions {
  store: PipelineStore;
  team: TeamSource;
}

/**
 * The pipeline of each project (pipeline-editor, requirements 1 and 2). Saving checks the fixed safety rules against the
 * project's team and says which rule a step breaks. A job takes the pipeline when it starts and keeps it, so a change
 * applies to the next job (requirement 2.2).
 */
export class PipelineService {
  private readonly o: PipelineServiceOptions;

  constructor(opts: PipelineServiceOptions) {
    this.o = opts;
  }

  private stored(projectId: string): readonly PipelineStep[] | undefined {
    return this.o.store.get(projectId);
  }

  view(projectId: string): PipelineResponse {
    const { members } = this.o.team.team(projectId);
    const stored = this.stored(projectId);
    return {
      projectId,
      customised: stored !== undefined,
      steps: (stored ?? DEFAULT_PIPELINE).map((s) => ({ ...s })),
      members: members.map((m) => ({ id: m.id, displayName: m.displayName, role: m.role, model: m.model })),
    };
  }

  /** Checks the rules and stores the pipeline; a broken rule is a 400 that names the step and the reason. */
  save(projectId: string, steps: readonly PipelineStep[]): PipelineResponse {
    const { members } = this.o.team.team(projectId);
    const check = validatePipeline(steps, members);
    if (!check.ok) throw invalid(check);
    // Steps that name no member keep naming none; research and the second review get theirs when a job starts.
    this.o.store.set(projectId, steps);
    return this.view(projectId);
  }

  /** Back to the default pipeline. */
  reset(projectId: string): PipelineResponse {
    this.o.team.team(projectId); // unknown project: 404
    this.o.store.delete(projectId);
    return this.view(projectId);
  }

  /** The project is gone: its pipeline goes with it. */
  remove(projectId: string): void {
    this.o.store.delete(projectId);
  }

  /**
   * The pipeline a job takes when it starts. The team may have changed since the pipeline was saved (a reviewer left, a
   * model changed), so the rules are checked again; a pipeline that no longer holds refuses the job with the reason, and
   * the user fixes it on the board. Research and the second review name their member, so the job keeps it.
   */
  forJob(projectId: string): PipelineStep[] {
    const { members } = this.o.team.team(projectId);
    const steps = this.stored(projectId) ?? DEFAULT_PIPELINE;
    const check = validatePipeline(steps, members);
    if (!check.ok) {
      throw new ConflictError("pipeline_invalid", `This project's pipeline no longer works: ${pipelineProblem(check)} Fix it on the board.`);
    }
    return steps.map((s) => {
      const memberId = s.memberId ?? defaultMemberFor(s.kind, members)?.id;
      return { kind: s.kind, ...(memberId ? { memberId } : {}) };
    });
  }
}

function invalid(check: PipelineCheck): BadRequestError {
  if (check.ok) return new BadRequestError("invalid_pipeline", "invalid pipeline");
  return new BadRequestError(
    "invalid_pipeline",
    pipelineProblem(check) ?? "invalid pipeline",
    check.errors.map((e) => ({ path: e.index === null ? "steps" : `steps.${e.index}`, message: e.rule })),
  );
}
