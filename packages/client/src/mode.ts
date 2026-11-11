export type ClientMode = "live" | "demo";

/**
 * Picks the client mode. `?mode=demo` or `VITE_MODE=demo` selects the replay of a recorded run;
 * anything else is live. The query string wins over the build setting so a build can be tried either way.
 */
export function resolveMode(search: string, buildMode: string | undefined): ClientMode {
  const fromQuery = new URLSearchParams(search).get("mode");
  const wanted = fromQuery ?? buildMode;
  return wanted === "demo" ? "demo" : "live";
}

/** Mode of this page. In demo mode the client never builds a `LiveTransport`. */
export function currentMode(): ClientMode {
  const search = typeof location === "undefined" ? "" : location.search;
  return resolveMode(search, import.meta.env["VITE_MODE"] as string | undefined);
}

/** Joins a base path (`/repo/`, from `import.meta.env.BASE_URL`) and a relative asset path. */
export function joinBase(base: string, path: string): string {
  const b = base.endsWith("/") ? base : `${base}/`;
  return b + path.replace(/^\/+/, "");
}

/** URL of a static file shipped with the client, valid under any `base` (GitHub Pages sub-path). */
export function assetUrl(path: string): string {
  return joinBase(import.meta.env.BASE_URL, path);
}

/** The recorded run played in demo mode. */
export const DEMO_RUN_PATH = "demo/run-001.json";
