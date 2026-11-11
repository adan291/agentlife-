import net from "node:net";

/** Where the Vite dev server serves the client. */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = ["http://localhost:5173", "http://127.0.0.1:5173"];

/** `Origin` of a page is scheme://host[:port] without a path. Compare case-insensitively, ignore a trailing slash. */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * `WORLD_ALLOWED_ORIGINS` is a comma-separated list. An empty or missing value gives the default list.
 * The value replaces the defaults, so a deployment lists every origin it serves the client from.
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  const list = (value ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter((o) => o !== "");
  return list.length > 0 ? list : DEFAULT_ALLOWED_ORIGINS.map(normalizeOrigin);
}

/** True for `localhost`, `127.x.x.x`, `::1` and the IPv4-mapped form of 127.x. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost") return true;
  if (net.isIPv4(h)) return h.startsWith("127.");
  if (net.isIPv6(h)) return h === "::1" || /^::ffff:127\./.test(h);
  return false;
}

export interface OriginPolicy {
  /** Normalised allowed origins. */
  allowed: readonly string[];
  /** The address the server binds to. A request without Origin is accepted only for a loopback bind. */
  bindHost: string;
}

/**
 * Decides a WebSocket upgrade (security audit M3). A browser always sends Origin, so a page on another
 * site cannot talk to a server on the user's machine. Non-browser clients (tests, scripts) send none; they are
 * accepted only when the server listens on loopback, where only local processes can reach it anyway.
 */
export function checkOrigin(origin: string | undefined, policy: OriginPolicy): boolean {
  if (origin === undefined || origin === "") return isLoopbackHost(policy.bindHost);
  return policy.allowed.includes(normalizeOrigin(origin));
}
