// Lists the bugs the Bug sack has kept (spec bug-sack), so a Kiro session can read them.
//
//   pnpm run bugs                      open groups, newest first
//   pnpm run bugs --all                every group (open, fixed, ignored)
//   pnpm run bugs --component game|code
//   pnpm run bugs --md                 Markdown, ready to paste into a chat
//
// Reads data/bugs.jsonl and the inbox (reports the engine, the conductor and the sessions have not handed over yet) and
// never writes, so it works while the hotel is stopped.

import { pathToFileURL } from "node:url";
import { BugBook, groupsToMarkdown, type BugComponent, type BugGroup } from "../packages/shared/src/bugs.ts";
import { bugFiles, cleanBugInput, loadBugFile, readInboxFile, type BugFiles } from "../packages/shared/src/bugs-node.ts";

export const USAGE = "Usage: pnpm run bugs [--all] [--component game|code] [--md]";

export interface BugsArgs {
  all: boolean;
  md: boolean;
  component?: BugComponent;
}

/** The flags, or the reason one of them is not known. */
export function parseBugsArgs(argv: readonly string[]): BugsArgs | { error: string } {
  const out: BugsArgs = { all: false, md: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--all") out.all = true;
    else if (arg === "--md") out.md = true;
    else if (arg === "--component" || arg.startsWith("--component=")) {
      const value = arg === "--component" ? argv[++i] : arg.slice("--component=".length);
      if (value !== "game" && value !== "code") return { error: `--component needs game or code, not "${value ?? ""}"` };
      out.component = value;
    } else return { error: `unknown argument "${arg}"` };
  }
  return out;
}

/** The groups on disk with the inbox applied in memory. Nothing is written. */
export function readBugBook(files: BugFiles, onLog?: (message: string) => void): BugBook {
  const book = new BugBook(loadBugFile(files.file, { moveAside: false, ...(onLog ? { onLog } : {}) }));
  let n = 0;
  for (const file of [files.draining, files.inbox]) {
    for (const r of readInboxFile(file).records) book.record(cleanBugInput(r.report), r.at, `b${r.at.toString(36)}${(n++).toString(36)}`);
  }
  return book;
}

function utc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function whereOf(g: BugGroup): string {
  return (["floor", "panel", "view", "task", "step", "session", "spec"] as const).flatMap((k) => (g.last[k] ? [`${k} ${g.last[k]}`] : [])).join(", ");
}

function describeGroup(g: BugGroup): string {
  const lines = [
    `${g.id}  ${g.component}/${g.process}  ${g.kind}  x${g.count}  ${g.status}${g.reopened > 0 ? ` (reopened ${g.reopened})` : ""}`,
    `  first ${utc(g.firstSeen)}, last ${utc(g.lastSeen)}`,
  ];
  const where = whereOf(g);
  if (where) lines.push(`  where: ${where}`);
  lines.push(`  ${g.message}`);
  if (g.frame) lines.push(`  at ${g.frame}`);
  return lines.join("\n");
}

/** What the command prints and the exit code it ends with. */
export function bugsCommand(argv: readonly string[], files: BugFiles): { code: number; out: string } {
  const args = parseBugsArgs(argv);
  if ("error" in args) return { code: 2, out: `${args.error}\n${USAGE}\n` };
  const warnings: string[] = [];
  const book = readBugBook(files, (m) => warnings.push(m));
  const groups = book.list({ ...(args.component ? { component: args.component } : {}), ...(args.all ? {} : { status: "open" as const }) });
  const title = args.all ? "Bugs" : "Open bugs";
  const head = warnings.map((w) => `warning: ${w}\n`).join("");
  if (args.md) return { code: 0, out: `${head}${groups.length === 0 ? `# ${title} (0)\n` : groupsToMarkdown(groups, title)}` };
  if (groups.length === 0) return { code: 0, out: `${head}${args.all ? "No bugs." : "No open bugs."}\n` };
  return { code: 0, out: `${head}${title} (${groups.length})\n\n${groups.map(describeGroup).join("\n\n")}\n` };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = bugsCommand(process.argv.slice(2), bugFiles());
  process.stdout.write(result.out);
  process.exitCode = result.code;
}
