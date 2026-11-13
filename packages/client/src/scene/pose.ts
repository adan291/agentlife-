import type { Emote } from "@agentlife/shared";
import type { AvatarPose } from "./figure.ts";

/** Time of one frame of each emote's two-frame loop. */
export const EMOTE_FRAME_MS: Readonly<Record<Emote, number>> = { wave: 260, cheer: 220, dance: 300, glum: 600 };

/** The emotes each kind of figure can show: the user waves, cheers and dances; a ghost cheers or looks glum. */
const USER_CAN: ReadonlySet<Emote> = new Set(["wave", "cheer", "dance"]);
const GHOST_CAN: ReadonlySet<Emote> = new Set(["cheer", "glum"]);

export interface PoseInput {
  /** The user's figure (a person) or a ghost. */
  isUser: boolean;
  /** Between two tiles: the walk cycle shows, whatever else is going on. */
  moving: boolean;
  sitting: boolean;
  /** The emote that is playing now, or null. */
  emote: Emote | null;
  /** Milliseconds since that emote began. */
  elapsedMs: number;
  /** Reduced motion: an emote holds its first frame instead of looping. */
  reduced: boolean;
}

export interface PoseChoice {
  /** Undefined: the normal stance (the walk cycle or the float bob decides the frame). */
  pose: AvatarPose | undefined;
  /** The frame of the pose; meaningless when `pose` is undefined. */
  frame: 0 | 1;
}

/**
 * Which drawing a figure shows now. Pure. A walk wins over everything; a seated figure does not dance; an emote the kind of
 * figure cannot show is ignored; under reduced motion an emote is its first frame, and it never loops.
 */
export function poseFor(input: PoseInput): PoseChoice {
  const { isUser, moving, sitting, emote, elapsedMs, reduced } = input;
  if (moving) return { pose: undefined, frame: 0 };
  const seated = isUser && sitting;
  const shown = emote !== null && (isUser ? USER_CAN : GHOST_CAN).has(emote) && !(seated && emote === "dance") ? emote : null;
  if (shown === null) return seated ? { pose: "sit", frame: 0 } : { pose: undefined, frame: 0 };
  const frame = reduced ? 0 : ((Math.floor(Math.max(0, elapsedMs) / EMOTE_FRAME_MS[shown]) % 2) as 0 | 1);
  if (seated) return { pose: shown === "wave" ? "sit_wave" : "sit_cheer", frame };
  return { pose: shown, frame };
}

/** True for the poses of a seated figure: its sprite is lifted onto the seat. */
export function isSeatedPose(pose: AvatarPose | undefined): boolean {
  return pose === "sit" || pose === "sit_wave" || pose === "sit_cheer";
}
