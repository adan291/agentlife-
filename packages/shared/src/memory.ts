import { z } from "zod";

/**
 * The Library (project-memory): what the agents of a project learned, kept per project and read at the start of every
 * job. The engine owns the rules (what may be stored, how it is ranked); these are the shapes that cross the engine, the
 * world-server and the client.
 */

export const MEMORY_KINDS = ["decision", "convention", "pitfall", "finding"] as const;
export const MemoryKindSchema = z.enum(MEMORY_KINDS);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

/** Readable names for the panel. */
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  decision: "Decision",
  convention: "Convention",
  pitfall: "Pitfall",
  finding: "Finding",
};

/** One entry is one short sentence or two. */
export const MEMORY_TEXT_MAX = 500;
/** A project keeps at most this many entries. A full memory refuses new ones; the user deletes old ones. */
export const MEMORY_ENTRIES_MAX = 200;
/** A finished job proposes at most this many entries. */
export const MEMORY_PROPOSALS_MAX = 5;
/** Proposals waiting for the user, per project. The oldest ones are dropped past this. */
export const MEMORY_PENDING_MAX = 50;
/** The memory block of a role prompt is cut at this many characters. */
export const MEMORY_PROMPT_MAX_CHARS = 4000;

export const MemoryTextSchema = z.string().min(1).max(MEMORY_TEXT_MAX);
export const MemoryEntryIdSchema = z.string().regex(/^mem-[a-z0-9]{6,20}$/);
export const MemoryProposalIdSchema = z.string().regex(/^prop-[a-z0-9]{6,20}$/);
/** The job an entry came from (same shape as a task id). */
export const MemorySourceTaskSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

export const MemoryEntrySchema = z.object({
  id: MemoryEntryIdSchema,
  kind: MemoryKindSchema,
  text: MemoryTextSchema,
  sourceTaskId: MemorySourceTaskSchema,
  /** Milliseconds since the epoch. */
  createdAt: z.number().int().nonnegative(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

/** An entry a finished job suggests. It is stored only when the user accepts it (or the project auto-remembers). */
export const MemoryProposalSchema = MemoryEntrySchema.extend({ id: MemoryProposalIdSchema });
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;

/** What a model may propose: no ids, no source. The engine adds them. */
export const MemoryDraftSchema = z.object({ kind: MemoryKindSchema, text: z.string().min(1).max(2000) });
export type MemoryDraft = z.infer<typeof MemoryDraftSchema>;

/** Why a text was refused. */
export const MEMORY_REJECTIONS = ["empty", "too_long", "path_or_secret", "secret", "duplicate", "full"] as const;
export const MemoryRejectionSchema = z.enum(MEMORY_REJECTIONS);
export type MemoryRejection = z.infer<typeof MemoryRejectionSchema>;
