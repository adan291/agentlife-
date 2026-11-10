import { z } from "zod";

/**
 * Record shapes of `kiro-cli chat --v3 --output-format stream-json` (kiro-cli 3.1.0), as seen in the spike
 * (docs/spikes/kiro-cli.md). One JSON object per line: `{ "type": ..., "data": {...} }`.
 * Schemas are loose: fields we do not use are allowed, so new fields in a later version do not break us.
 */

const RunStarted = z.looseObject({
  type: z.literal("runStarted"),
  data: z.looseObject({ engine: z.string().optional() }).optional(),
});

const Location = z.looseObject({ path: z.string().optional() });

const ToolCallUpdate = z.looseObject({
  sessionUpdate: z.literal("tool_call"),
  toolCallId: z.string().optional(),
  title: z.string().optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
  locations: z.array(Location).optional(),
});

const MessageChunk = z.looseObject({
  sessionUpdate: z.literal("agent_message_chunk"),
  content: z.looseObject({ type: z.string().optional(), text: z.string().optional() }).optional(),
});

/** Any other sessionUpdate kind (thought chunks, tool_call_update, session_info_update, ...). */
const OtherUpdate = z.looseObject({ sessionUpdate: z.string() });

export const SessionUpdateSchema = z.union([ToolCallUpdate, MessageChunk, OtherUpdate]);

const SessionUpdate = z.looseObject({
  type: z.literal("sessionUpdate"),
  data: z.looseObject({ update: SessionUpdateSchema }),
});

/** Not reported by kiro-cli 3.1.0; read when a later version adds it. */
const Usage = z.looseObject({
  credits: z.number().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
});

const RunFinished = z.looseObject({
  type: z.literal("runFinished"),
  data: z.looseObject({
    status: z.string().optional(),
    stopReason: z.string().optional(),
    finalText: z.string(),
    finalTextTruncated: z.boolean().optional(),
    usage: Usage.optional(),
  }),
});

const RunError = z.looseObject({
  type: z.literal("runError"),
  data: z.looseObject({ stage: z.string().optional(), message: z.string() }),
});

export const KiroRecordSchema = z.union([RunStarted, SessionUpdate, RunFinished, RunError]);
export type KiroRecord = z.infer<typeof KiroRecordSchema>;

export type ParsedLine =
  | { kind: "record"; record: KiroRecord }
  /** Valid JSON that is not a record we know. Kept in the raw log, otherwise ignored. */
  | { kind: "unknown" }
  /** Not JSON (or empty). */
  | { kind: "invalid" };

export function parseKiroLine(line: string): ParsedLine {
  const text = line.trim();
  if (text === "") return { kind: "invalid" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "invalid" };
  }
  const parsed = KiroRecordSchema.safeParse(json);
  return parsed.success ? { kind: "record", record: parsed.data } : { kind: "unknown" };
}
