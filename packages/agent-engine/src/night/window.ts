import type { NightConfig } from "@agentlife/shared";

/** One occurrence of the night window. */
export interface NightWindow {
  /** `YYYY-MM-DD` (local) of the day the window started; names the night. */
  key: string;
  /** Epoch ms. */
  start: number;
  end: number;
}

/** Minutes after midnight of an `HH:MM` text that the config schema has already checked. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

function dayKey(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function at(day: Date, minutes: number, dayOffset = 0): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + dayOffset, Math.floor(minutes / 60), minutes % 60).getTime();
}

/**
 * The window that contains `now` (local time of the machine), or undefined outside every window. A window may cross
 * midnight: `22:00` to `06:00` started yesterday at 03:00. The end is exclusive.
 */
export function windowAt(now: number, config: Pick<NightConfig, "start" | "end">): NightWindow | undefined {
  const d = new Date(now);
  const minute = d.getHours() * 60 + d.getMinutes();
  const s = minutesOf(config.start);
  const e = minutesOf(config.end);
  const crosses = s > e;
  let startDay: Date;
  if (!crosses) {
    if (minute < s || minute >= e) return undefined;
    startDay = d;
  } else if (minute >= s) {
    startDay = d;
  } else if (minute < e) {
    startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  } else {
    return undefined;
  }
  return { key: dayKey(startDay), start: at(startDay, s), end: at(startDay, e, crosses ? 1 : 0) };
}
