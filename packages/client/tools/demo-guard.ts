/**
 * Checks for the demo build: the public demo must not contain the live connection code or any world-server address.
 * Pure functions here (unit tested); `check-demo-build.ts` builds the demo and runs them over the output.
 */

export interface Finding {
  file: string;
  rule: string;
}

/** Text that must not appear in the demo bundle, with the reason. */
const FORBIDDEN: readonly { rule: string; pattern: RegExp }[] = [
  { rule: "WebSocket URL (ws:// or wss://)", pattern: /wss?:\/\/[\w.[\]-]/ },
  { rule: "world-server default port 8787", pattern: /\b8787\b/ },
  { rule: "engine port 8788", pattern: /\b8788\b/ },
  { rule: "loopback address 127.0.0.1", pattern: /127\.0\.0\.1/ },
  { rule: "localhost address", pattern: /\blocalhost\b/ },
  { rule: "VITE_WORLD_URL setting", pattern: /VITE_WORLD_URL/ },
  { rule: "LiveTransport class", pattern: /LiveTransport/ },
  { rule: "new WebSocket(...) call", pattern: /new\s+WebSocket\s*\(/ },
];

/** Files in the build output that are text and worth scanning. */
export function isScannable(file: string): boolean {
  return /\.(js|mjs|css|html|json|map|txt)$/i.test(file);
}

/** Rules broken by one file's text. */
export function findLiveEndpoints(file: string, text: string): Finding[] {
  return FORBIDDEN.filter((f) => f.pattern.test(text)).map((f) => ({ file, rule: f.rule }));
}
