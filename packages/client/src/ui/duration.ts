/** `850` -> "0.9s", `12_400` -> "12s", `65_000` -> "1m 05s", `3_723_000` -> "1h 02m". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, ms);
  if (total < 10_000) return `${(Math.round(total / 100) / 10).toFixed(1)}s`;
  const s = Math.floor(total / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
