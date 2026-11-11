// Reports the conductor phase to the engine (`POST /crew/events`, kind `phase`). Best effort: never fails.
//   node --experimental-strip-types scripts/crew-phase.ts "<phase>" [spec]
// The conductor is synchronous, so it runs this as a child process (see reportPhase in conduct.ts).

import type { CrewEvent } from "../packages/shared/src/crew.ts";

export function phaseEvent(phase: string, spec?: string): CrewEvent {
  return { kind: "phase", session: "conduct", phase: phase.slice(0, 80), ...(spec && /^[a-z0-9-]+$/.test(spec) ? { spec: spec.slice(0, 40) } : {}) };
}

export async function sendPhase(phase: string, spec?: string): Promise<void> {
  if (process.env.AGENTLIFE_CREW === "0") return;
  const base = (process.env.ENGINE_URL ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.ENGINE_TOKEN) headers["x-agentlife-token"] = process.env.ENGINE_TOKEN;
  try {
    await fetch(`${base}/crew/events`, { method: "POST", headers, body: JSON.stringify(phaseEvent(phase, spec)), signal: AbortSignal.timeout(1000) });
  } catch {
    // The engine may not be running; the conductor goes on.
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isMain && process.argv[2]) await sendPhase(process.argv[2], process.argv[3]);
