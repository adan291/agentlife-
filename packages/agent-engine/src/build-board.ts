import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BuildBoardSchema,
  BuildReportSchema,
  SPEC_NAME_RE,
  phaseGroup,
} from "@agentlife/shared";
import type { BuildBoard, BuildPhase, BuildRow, BuildRowStatus, BuildSession, BuildSpec, BuildVerdict } from "@agentlife/shared";
import { NotFoundError } from "./errors.ts";
import { sendJson, type Route } from "./http/server.ts";
import { isInside } from "./paths.ts";

/**
 * Read-only view of how AGENT LIFE itself is being built (build-board, requirement 1). Only these files of the
 * AGENT LIFE repository are read; spec names must match SPEC_NAME_RE before they become part of a path.
 */
const SESSION_LINES = 10;

function readText(root: string, ...parts: string[]): string {
  try {
    const file = path.join(root, ...parts);
    if (!isInside(root, file)) return "";
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Rows of the TASKMAP table: `| # | `spec` | sessions | live | status | purpose |`. Malformed rows are skipped. */
export function parseTaskmap(text: string): BuildRow[] {
  const rows: BuildRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 7 || !/^\d{1,3}$/.test(cells[1] ?? "")) continue;
    const spec = (cells[2] ?? "").replace(/`/g, "");
    if (!SPEC_NAME_RE.test(spec) || spec.length > 40) continue;
    const raw = (cells[5] ?? "").toLowerCase();
    const status: BuildRowStatus =
      raw === "done" ? "merged" : raw === "skip" ? "skipped" : raw === "needs-check" ? "waits_for_you" : "todo";
    rows.push({
      number: Number(cells[1]),
      spec,
      sessions: (cells[3] ?? "").split(/[ ,]+/).filter((s) => /^S\d+[A-Z]?$/.test(s)).slice(0, 10),
      live: /^(yes|sí)$/i.test(cells[4] ?? ""),
      status,
      ...(status === "waits_for_you" ? { reason: "Merged; a check by you is pending (docs/HUMAN-CHECKS.md)" } : {}),
      purpose: (cells[6] ?? "").slice(0, 300),
    });
  }
  return rows;
}

/** Top-level checkbox lines of a spec's tasks.md: `- [x] 3. Title`. */
export function parseTasks(text: string): Pick<BuildSpec, "tasks" | "done" | "total"> {
  const tasks: BuildSpec["tasks"] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^- \[( |x)\] (\d+(?:\.\d+)?)\.?\s+(.*)$/.exec(line);
    if (!m || tasks.length >= 60) continue;
    tasks.push({ number: m[2] ?? "", title: (m[3] ?? "").trim().slice(0, 200), done: m[1] === "x" });
  }
  return { tasks, done: tasks.filter((t) => t.done).length, total: tasks.length };
}

/** Last lines of the session log table: `| S16 | 2026-11-11 23:11 | model | effort | minutes | status | file |`. */
export function parseSessionLog(text: string): BuildSession[] {
  const out: BuildSession[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 8 || !/^S\d+[A-Z]?$/.test(cells[1] ?? "")) continue;
    const minutes = Number(cells[5]);
    if (!Number.isFinite(minutes) || minutes < 0) continue;
    out.push({
      session: cells[1] ?? "",
      date: (cells[2] ?? "").slice(0, 20),
      model: (cells[3] ?? "").slice(0, 40),
      minutes,
      status: (cells[6] ?? "").slice(0, 20),
    });
  }
  return out.slice(-SESSION_LINES);
}

/** First line of a verify report: `VERDICT: PASS` or `VERDICT: FAIL`. */
export function parseVerdict(text: string): BuildVerdict {
  const first = (text.split(/\r?\n/, 1)[0] ?? "").trim();
  const m = /^VERDICT:\s*(PASS|FAIL)\b/.exec(first);
  return m ? (m[1] as "PASS" | "FAIL") : "none";
}

/** Applies the conductor phase to the rows: the running spec is highlighted, a stop waits for the user. */
export function applyPhase(rows: BuildRow[], phase: BuildPhase | undefined): BuildRow[] {
  if (!phase?.spec) return rows;
  const group = phaseGroup(phase.text);
  return rows.map((row) => {
    if (row.spec !== phase.spec || row.status === "merged" || row.status === "skipped") return row;
    if (group === "running" || group === "verifying") return { ...row, status: group };
    if (group === "stopped") {
      return { ...row, status: "waits_for_you", reason: phase.text.replace(/^stopped:?\s*/i, "").slice(0, 200) || "The conductor stopped" };
    }
    return row;
  });
}

/** Rows that wait for the user come first; the rest keep the TASKMAP order. */
export function waitingFirst(rows: BuildRow[]): BuildRow[] {
  return [...rows.filter((r) => r.status === "waits_for_you"), ...rows.filter((r) => r.status !== "waits_for_you")];
}

export function readBuildBoard(root: string, phase: BuildPhase | undefined): BuildBoard {
  const rows = applyPhase(parseTaskmap(readText(root, "docs", "TASKMAP.md")), phase);
  const specs: BuildSpec[] = rows.map((r) => ({
    spec: r.spec,
    ...parseTasks(readText(root, ".kiro", "specs", r.spec, "tasks.md")),
    verdict: parseVerdict(readText(root, "docs", "reviews", `feat-${r.spec}-verify.md`)),
  }));
  return BuildBoardSchema.parse({
    ...(phase ? { phase } : {}),
    rows: waitingFirst(rows),
    specs,
    sessions: parseSessionLog(readText(root, "data", "sessions", "log.md")),
  });
}

export function createBuildBoardRoutes(opts: { root: string; phase: () => BuildPhase | undefined }): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/build\/board$/,
      handle: ({ res }) => sendJson(res, 200, BuildBoardSchema, readBuildBoard(opts.root, opts.phase())),
    },
    {
      method: "GET",
      pattern: /^\/build\/verify\/([^/]+)$/,
      handle: ({ res, params }) => {
        let spec = "";
        try {
          spec = decodeURIComponent(params[0] ?? "");
        } catch {
          // falls through to the not-found error
        }
        const content = readVerifyReport(opts.root, spec);
        if (!content) throw new NotFoundError("no verify report");
        sendJson(res, 200, BuildReportSchema, { spec, content });
      },
    },
  ];
}

/** The verify report of a spec as text for the viewer; empty when the name is invalid or there is no report. */
export function readVerifyReport(root: string, spec: string): string {
  if (!SPEC_NAME_RE.test(spec) || spec.length > 40) return "";
  return readText(root, "docs", "reviews", `feat-${spec}-verify.md`).slice(0, 100_000);
}
