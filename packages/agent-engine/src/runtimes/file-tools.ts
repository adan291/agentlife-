// The file tools a model gets when it does not run as kiro-cli (multi-runtime). The engine runs them, so the engine is the
// sandbox: every path is resolved inside the job's folder, links out are refused, the secret-looking files the role agents
// may not read are refused, and only the Developer may write. There is no shell, no network and no other tool.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadTier } from "../team/tiers.ts";

export const READ_MAX_BYTES = 2_000_000;
/** What one tool answer may carry back to the model; a longer file is read in slices. */
export const TOOL_ANSWER_MAX_CHARS = 60_000;
export const WRITE_MAX_CHARS = 400_000;
const LIST_MAX = 1_000;
const SEARCH_MAX_HITS = 100;
const SEARCH_FILE_MAX_BYTES = 1_000_000;
/** Folders no tool walks into: generated or not part of the project. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo"]);

/** A tool call the engine refuses; the text goes back to the model and to the activity line. */
export class ToolRefusedError extends Error {}

/** OpenAI `tools` entries. The Developer also gets `write_file`. */
export function toolDefinitions(write: boolean): object[] {
  const fn = (name: string, description: string, properties: Record<string, object>, required: string[]) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
  });
  const defs = [
    fn("list_files", "List files and folders of the project. Paths are relative to the project root.", {
      dir: { type: "string", description: "Folder to list, default the project root" },
      recursive: { type: "boolean", description: "Also list sub-folders" },
    }, []),
    fn("read_file", "Read a text file of the project, optionally a range of lines (1-based, inclusive).", {
      path: { type: "string" },
      start_line: { type: "integer" },
      end_line: { type: "integer" },
    }, ["path"]),
    fn("search", "Find a text (case-insensitive) in the project's text files. Returns file:line: text.", {
      text: { type: "string" },
      dir: { type: "string", description: "Folder to search, default the project root" },
    }, ["text"]),
  ];
  if (write) {
    defs.push(fn("write_file", "Create or replace a whole text file of the project with the given content.", {
      path: { type: "string" },
      content: { type: "string" },
    }, ["path", "content"]));
  }
  return defs;
}

function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "i");
}

/** A matcher over the deny patterns of a tier (`*.pem`, `.env.*`, `.git/**`, `**\/.ssh/**`...). Paths use `/`. */
export function secretMatcher(patterns: readonly string[]): (rel: string) => boolean {
  const dirs = new Set<string>();
  const names: RegExp[] = [];
  for (const raw of patterns) {
    const p = raw.replace(/^\*\*\//, "");
    if (p.endsWith("/**")) dirs.add(p.slice(0, -3).toLowerCase());
    else if (!p.includes("/")) names.push(globToRegExp(p));
  }
  return (rel: string) => {
    const segs = rel.split("/").filter(Boolean);
    if (segs.some((s) => dirs.has(s.toLowerCase()))) return true;
    const base = segs.at(-1) ?? "";
    return names.some((r) => r.test(base));
  };
}

let defaultMatcher: ((rel: string) => boolean) | undefined;
/** The files the read-only tier denies to the role agents; one source of truth with kiro-cli's permissions. */
export function defaultSecretMatcher(): (rel: string) => boolean {
  if (!defaultMatcher) {
    const deny = loadTier("read-only").permissions.rules.filter((r) => r.capability === "fs_read" && r.effect === "deny").flatMap((r) => r.match);
    defaultMatcher = secretMatcher(deny);
  }
  return defaultMatcher;
}

export interface FileToolOptions {
  /** The job's folder (worktree or clone). Nothing outside it is ever read or written. */
  cwd: string;
  write: boolean;
  isSecret?: (rel: string) => boolean;
}

export interface ToolResult {
  /** Sent back to the model. */
  text: string;
  /** For the activity terminal and the step's read/edit counts. */
  progress: { text: string; tool?: { kind: "read" | "edit"; file: string } };
}

function realRoot(cwd: string): string {
  return realpathSync(cwd);
}

/**
 * A path from the model as a path inside `cwd`: relative only, no `..`, no drive letter, no link that leads out.
 * Returns the absolute path and the `/`-separated relative one.
 */
export function resolveInside(cwd: string, raw: unknown, isSecret: (rel: string) => boolean): { abs: string; rel: string } {
  if (typeof raw !== "string") throw new ToolRefusedError("A path must be a text.");
  const trimmed = raw.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  const p = trimmed === "" || trimmed === "." ? "" : trimmed;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.startsWith("//")) throw new ToolRefusedError(`Only paths inside the project are allowed: ${raw}`);
  const segs = p.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) throw new ToolRefusedError(`Only paths inside the project are allowed: ${raw}`);
  if (segs.some((s) => s.includes("\0") || /[<>"|?*]/.test(s) || s.endsWith(" ") || s.endsWith("."))) throw new ToolRefusedError(`Not a valid path: ${raw}`);
  const rel = segs.join("/");
  if (rel !== "" && isSecret(rel)) throw new ToolRefusedError(`That file is not available to agents: ${rel}`);
  const root = realRoot(cwd);
  const abs = path.join(root, ...segs);
  // A link (or a link in a parent folder) must not lead outside the project.
  let probe = abs;
  while (!existsSync(probe) && probe !== root) probe = path.dirname(probe);
  const real = realpathSync(probe);
  if (real !== root && !real.startsWith(root + path.sep)) throw new ToolRefusedError(`Only paths inside the project are allowed: ${raw}`);
  return { abs, rel };
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

function cut(text: string, max = TOOL_ANSWER_MAX_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (cut at ${max} characters; read a smaller range of lines)`;
}

function walk(root: string, start: string, isSecret: (rel: string) => boolean, visit: (rel: string, abs: string, dir: boolean) => boolean): void {
  const stack = [start];
  while (stack.length) {
    const dirAbs = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(dirAbs, e.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (e.isSymbolicLink() || isSecret(rel)) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (!visit(rel, abs, true)) return;
        stack.push(abs);
      } else if (e.isFile()) {
        if (!visit(rel, abs, false)) return;
      }
    }
  }
}

function args(json: string): Record<string, unknown> {
  if (json.trim() === "") return {};
  try {
    const v = JSON.parse(json) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new ToolRefusedError("The tool arguments are not a JSON object.");
}

/** Runs one tool call. A refusal is returned as text (the model may try something else), never thrown. */
export function runFileTool(name: string, argsJson: string, opts: FileToolOptions): ToolResult {
  const isSecret = opts.isSecret ?? defaultSecretMatcher();
  try {
    const a = args(argsJson);
    if (name === "list_files") {
      const { abs, rel } = resolveInside(opts.cwd, a["dir"] ?? "", isSecret);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new ToolRefusedError(`Not a folder: ${rel || "."}`);
      const root = realRoot(opts.cwd);
      const out: string[] = [];
      if (a["recursive"] === true) {
        walk(root, abs, isSecret, (r, _abs, dir) => (out.push(dir ? `${r}/` : r), out.length < LIST_MAX));
      } else {
        for (const e of readdirSync(abs, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isSymbolicLink() || isSecret(r) || (e.isDirectory() && SKIP_DIRS.has(e.name))) continue;
          if (e.isDirectory()) out.push(`${r}/`);
          else if (e.isFile()) out.push(r);
          if (out.length >= LIST_MAX) break;
        }
      }
      return { text: out.length ? cut(out.join("\n")) : "(empty folder)", progress: { text: `Listing: ${rel || "."}` } };
    }
    if (name === "read_file") {
      const { abs, rel } = resolveInside(opts.cwd, a["path"], isSecret);
      if (!existsSync(abs) || !lstatSync(abs).isFile()) throw new ToolRefusedError(`No such file: ${rel}`);
      if (statSync(abs).size > READ_MAX_BYTES) throw new ToolRefusedError(`The file is too large to read: ${rel}`);
      const buf = readFileSync(abs);
      if (isBinary(buf)) throw new ToolRefusedError(`Not a text file: ${rel}`);
      const lines = buf.toString("utf8").split(/\r?\n/);
      const start = Math.max(1, Number.isInteger(a["start_line"]) ? (a["start_line"] as number) : 1);
      const end = Math.min(lines.length, Number.isInteger(a["end_line"]) ? (a["end_line"] as number) : lines.length);
      const body = lines.slice(start - 1, end).join("\n");
      return { text: cut(`${rel} (lines ${start}-${end} of ${lines.length})\n${body}`), progress: { text: `Reading: ${rel}`, tool: { kind: "read", file: rel } } };
    }
    if (name === "search") {
      const text = typeof a["text"] === "string" ? a["text"].trim() : "";
      if (text.length < 2 || text.length > 200) throw new ToolRefusedError("Search for a text of 2 to 200 characters.");
      const { abs } = resolveInside(opts.cwd, a["dir"] ?? "", isSecret);
      const needle = text.toLowerCase();
      const hits: string[] = [];
      walk(realRoot(opts.cwd), abs, isSecret, (r, fileAbs, dir) => {
        if (dir) return true;
        let buf: Buffer;
        try {
          if (statSync(fileAbs).size > SEARCH_FILE_MAX_BYTES) return true;
          buf = readFileSync(fileAbs);
        } catch {
          return true;
        }
        if (isBinary(buf)) return true;
        const lines = buf.toString("utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length && hits.length < SEARCH_MAX_HITS; i++) {
          if (lines[i]!.toLowerCase().includes(needle)) hits.push(`${r}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
        }
        return hits.length < SEARCH_MAX_HITS;
      });
      return { text: hits.length ? cut(hits.join("\n")) : "No match.", progress: { text: `Searching: ${text.slice(0, 60)}` } };
    }
    if (name === "write_file") {
      if (!opts.write) throw new ToolRefusedError("This agent is read-only: it cannot write files.");
      const { abs, rel } = resolveInside(opts.cwd, a["path"], isSecret);
      if (rel === "") throw new ToolRefusedError("Name a file to write.");
      const content = a["content"];
      if (typeof content !== "string") throw new ToolRefusedError("The content must be a text.");
      if (content.length > WRITE_MAX_CHARS) throw new ToolRefusedError(`The content is too long (over ${WRITE_MAX_CHARS} characters).`);
      if (existsSync(abs) && !lstatSync(abs).isFile()) throw new ToolRefusedError(`Not a file: ${rel}`);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
      return { text: `Wrote ${rel} (${content.length} characters).`, progress: { text: `Editing: ${rel}`, tool: { kind: "edit", file: rel } } };
    }
    throw new ToolRefusedError(`There is no tool named ${name}.`);
  } catch (e) {
    const msg = e instanceof ToolRefusedError ? e.message : `The tool failed: ${e instanceof Error ? e.message.replace(/[A-Za-z]:\\[^\s]*|\/[^\s]*/g, "<path>") : "unknown error"}`;
    return { text: `Refused: ${msg}`, progress: { text: `Refused: ${msg.slice(0, 120)}` } };
  }
}
