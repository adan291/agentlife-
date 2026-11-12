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

// ---- Engine HTTP (and the messages that carry the same shapes to the client) ----

/** `GET /projects/:id/memory`: the Library of a project and what is waiting for the user. */
export const MemoryStateSchema = z.object({
  /** Newest first. */
  entries: z.array(MemoryEntrySchema).max(MEMORY_ENTRIES_MAX),
  /** Suggested by finished jobs, not stored yet. Newest first. */
  proposals: z.array(MemoryProposalSchema).max(MEMORY_PENDING_MAX),
  autoRemember: z.boolean(),
  /** Jobs whose lessons are still being written, so the report can say "thinking" instead of "nothing to remember". */
  learning: z.array(MemorySourceTaskSchema).max(20),
});
export type MemoryState = z.infer<typeof MemoryStateSchema>;

/** `PATCH /projects/:id/memory/:entryId`. At least one field. */
export const MemoryUpdateBodySchema = z
  .object({ kind: MemoryKindSchema.optional(), text: z.string().max(2000).optional() })
  .refine((b) => b.kind !== undefined || b.text !== undefined, { message: "nothing to change" });
export type MemoryUpdateBody = z.infer<typeof MemoryUpdateBodySchema>;

/** `POST /projects/:id/memory/proposals/:proposalId/accept`: the user may edit the proposal first. */
export const MemoryAcceptBodySchema = z.object({ kind: MemoryKindSchema.optional(), text: z.string().max(2000).optional() });
export type MemoryAcceptBody = z.infer<typeof MemoryAcceptBodySchema>;

/** `PUT /projects/:id/memory/settings`. */
export const MemorySettingsBodySchema = z.object({ autoRemember: z.boolean() });
export type MemorySettingsBody = z.infer<typeof MemorySettingsBodySchema>;

/** What the user can do in the Library panel and in the report's "Remember this?" card. The project is the user's floor. */
export const MemoryActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), entryId: MemoryEntryIdSchema, kind: MemoryKindSchema.optional(), text: z.string().max(2000).optional() }),
  z.object({ action: z.literal("delete"), entryId: MemoryEntryIdSchema }),
  z.object({ action: z.literal("accept"), proposalId: MemoryProposalIdSchema, kind: MemoryKindSchema.optional(), text: z.string().max(2000).optional() }),
  z.object({ action: z.literal("dismiss"), proposalId: MemoryProposalIdSchema }),
  z.object({ action: z.literal("auto"), autoRemember: z.boolean() }),
]);
export type MemoryAction = z.infer<typeof MemoryActionSchema>;
