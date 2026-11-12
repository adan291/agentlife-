import { mkdirSync } from "node:fs";
import { z } from "zod";
import { sanitize, type Template } from "@agentlife/shared";
import { fence, loadPromptTemplate, renderPrompt } from "../prompts.ts";
import type { AgentRuntime } from "../runtimes/types.ts";
import { runStructured } from "../steps/extract-json.ts";
import type { ImportReviewer } from "./imports.ts";

const ReplySchema = z.object({
  verdict: z.enum(["pass", "concerns"]),
  flags: z.array(z.string().max(400)).max(8),
});

export interface AgentReviewerOptions {
  runtime: AgentRuntime;
  /** Name of the kiro-cli agent (see `service-agents.ts`). */
  agent: string;
  model?: string;
  /** An empty directory the agent runs in; it has nothing to read there. Created when missing. */
  cwd: string;
  timeoutMs?: number;
  /** Where the raw runtime lines go (optional). */
  rawLogPath?: string;
}

/**
 * The security agent's review of a template: a read-only agent with an empty working directory is given the text in a
 * fence and answers with a verdict and flags (one retry when the reply is malformed). What it says is advice shown to
 * the user, never a decision: it cannot approve anything, and a hostile persona that talks it into `pass` still has to
 * get past the fixed checks and the user's own reading.
 */
export function agentImportReviewer(opts: AgentReviewerOptions): ImportReviewer {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return async (t: Template) => {
    mkdirSync(opts.cwd, { recursive: true });
    const prompt = renderPrompt(loadPromptTemplate("import-review"), {
      role: t.role,
      name: fence(t.name),
      description: fence(t.description),
      persona: fence(t.persona),
    });
    const ask = async (note?: string): Promise<string> => {
      const outputs: string[] = [];
      for await (const ev of opts.runtime.run({
        role: "qa",
        prompt: note ? `${prompt}\n\n${note}` : prompt,
        cwd: opts.cwd,
        timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
        agent: opts.agent,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.rawLogPath ? { rawLogPath: opts.rawLogPath } : {}),
      })) {
        if (ev.kind === "output") outputs.push(ev.text);
      }
      return outputs.join("\n");
    };
    const reply = await runStructured({ what: "import review", schema: ReplySchema, ask });
    const flags = reply.flags.map((f) => sanitize(f, 200)).filter((f) => f.length > 0);
    return { verdict: reply.verdict, flags };
  };
}
