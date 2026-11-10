import type { z } from "zod";
import { fence } from "../prompts.ts";

/**
 * Returns the body of the LAST fenced block tagged `json` (a fence of three or more backticks that starts
 * a line and is closed by a fence of the same length), or undefined when there is none.
 */
export function extractJsonBlock(text: string): string | undefined {
  const re = /^(`{3,})json[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/gim;
  let last: string | undefined;
  for (const m of text.matchAll(re)) last = m[2];
  return last;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function issueText(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Extracts the last json block of a model reply and validates it. The error text is safe to show to the model. */
export function parseBlock<T>(text: string, schema: z.ZodType<T>, check?: (value: T) => string | undefined): Parsed<T> {
  const body = extractJsonBlock(text);
  if (body === undefined) return { ok: false, error: "the reply has no fenced json block" };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, error: "the json block is not valid JSON" };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, error: issueText(parsed.error) };
  const problem = check?.(parsed.data);
  if (problem) return { ok: false, error: problem };
  return { ok: true, value: parsed.data };
}

export interface StructuredOptions<T> {
  /** Name used in error messages, e.g. "plan". */
  what: string;
  schema: z.ZodType<T>;
  /** Extra rule the schema cannot express; returns a message when violated. */
  check?: (value: T) => string | undefined;
  /** Runs the agent. `retryNote` is set on the second call only. */
  ask: (retryNote?: string) => Promise<string>;
}

/** Appended to the prompt on the retry. The validation error is placed in a fence like any other untrusted text. */
export function retryNote(error: string): string {
  return [
    "Your previous reply was rejected by the engine's validator:",
    fence(error),
    "Reply again. Finish with exactly one fenced block tagged json that follows the format above, and nothing after it.",
  ].join("\n");
}

/** Asks, validates, and asks once more with the error appended. A second failure throws. */
export async function runStructured<T>(opts: StructuredOptions<T>): Promise<T> {
  const first = parseBlock(await opts.ask(), opts.schema, opts.check);
  if (first.ok) return first.value;
  const second = parseBlock(await opts.ask(retryNote(first.error)), opts.schema, opts.check);
  if (second.ok) return second.value;
  throw new Error(`${opts.what}: invalid output after one retry (${second.error})`);
}
