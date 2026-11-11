import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentEventSchema,
  PROJECT_ROLES,
  ScopedAgentIdSchema,
  scopeAgentId,
  type AgentEvent,
  type AgentId,
  type EngineJobView,
  type ProjectRole,
} from "@agentlife/shared";
import { applyEvent, foldJob } from "./jobs/fold.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before the store assigns `seq` (and, if absent, `ts`). */
export type NewEvent = DistributiveOmit<AgentEvent, "seq" | "ts"> & { ts?: number };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const DEFAULT_DB_PATH = path.join(ROOT, "data", "engine.db");
export const DEFAULT_RUNS_DIR = path.join(ROOT, "data", "runs");

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SAFE_FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export interface StoreOptions {
  /** SQLite path or ":memory:". Defaults to env ENGINE_DB, then data/engine.db. */
  dbPath?: string;
  runsDir?: string;
  /** Removes secrets from everything persisted: events, artifacts and run logs. */
  redact?: (text: string) => string;
}

export interface SaveArtifactInput {
  taskId: string;
  agentId?: AgentId;
  kind: string;
  title: string;
  /** File name inside data/runs/<taskId>/, e.g. plan.json. */
  filename: string;
  content: string;
}

export interface StoredArtifact {
  id: string;
  taskId: string;
  kind: string;
  title: string;
  content: string;
}

interface EventRow {
  seq: number;
  ts: number;
  task_id: string;
  agent_id: string | null;
  type: string;
  payload: string;
}

export class Store {
  /** Emits "event" with each appended AgentEvent, after it is committed. */
  readonly bus = new EventEmitter();
  private readonly db: Database.Database;
  private readonly runsDir: string;
  private readonly redact: (text: string) => string;
  private readonly views = new Map<string, EngineJobView>();

  constructor(opts: StoreOptions = {}) {
    const dbPath = opts.dbPath ?? process.env["ENGINE_DB"] ?? DEFAULT_DB_PATH;
    this.runsDir = opts.runsDir ?? DEFAULT_RUNS_DIR;
    this.redact = opts.redact ?? ((t: string) => t);
    if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.bus.setMaxListeners(0);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, task_id TEXT NOT NULL, agent_id TEXT, type TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_task ON events(task_id, seq);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, decision TEXT, note TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER);
    `);
    this.rebuildViews();
  }

  /** Rebuild the in-memory job views from the log (startup). */
  private rebuildViews(): void {
    this.views.clear();
    const byTask = new Map<string, AgentEvent[]>();
    for (const ev of this.eventsSince(0)) {
      const list = byTask.get(ev.taskId) ?? [];
      list.push(ev);
      byTask.set(ev.taskId, list);
    }
    for (const [taskId, evs] of byTask) {
      const v = foldJob(evs);
      if (v) this.views.set(taskId, v);
    }
  }

  /**
   * Events of a project's job name their agent `<projectId>:<role>` (hotel-floors, requirement 3.2), so two jobs on
   * different projects never share an agent. Callers keep using plain roles; the job's project is known from `task.created`.
   * A plain id stays plain when the job is unknown (Builder, `build:*` tasks) or the project id cannot be part of a scoped id.
   */
  private scoped(input: NewEvent): NewEvent {
    const id = (input as { agentId?: string }).agentId;
    if (!id || !(PROJECT_ROLES as readonly string[]).includes(id)) return input;
    const repoId = this.views.get(input.taskId)?.repoId;
    if (!repoId) return input;
    const agentId = scopeAgentId(repoId, id as ProjectRole);
    return ScopedAgentIdSchema.safeParse(agentId).success ? ({ ...input, agentId } as NewEvent) : input;
  }

  /** The only write path for job state. Validates, persists, updates the cached view, then emits. */
  appendEvent(raw: NewEvent): AgentEvent {
    const input = this.scoped(raw);
    const ts = input.ts ?? Date.now();
    // Validate shape first (seq is a placeholder until the insert assigns it).
    const parsed = AgentEventSchema.parse({ ...input, ts, seq: 0 });
    // Redact on the serialised form so every string field is covered; re-validate the result.
    const checked = AgentEventSchema.parse(JSON.parse(this.redact(JSON.stringify(parsed))));
    const { seq: _s, ts: _t, taskId, type, ...rest } = checked;
    const { agentId, ...payload } = rest as { agentId?: string } & Record<string, unknown>;

    const tx = this.db.transaction((): AgentEvent => {
      const info = this.db
        .prepare("INSERT INTO events (ts, task_id, agent_id, type, payload) VALUES (?, ?, ?, ?, ?)")
        .run(ts, taskId, agentId ?? null, type, JSON.stringify(payload));
      const ev = { ...checked, seq: Number(info.lastInsertRowid) } as AgentEvent;
      if (ev.type === "approval.requested") {
        this.db
          .prepare("INSERT OR IGNORE INTO approvals (id, task_id, kind, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
          .run(ev.approvalId, ev.taskId, ev.kind, ts);
      } else if (ev.type === "approval.resolved") {
        this.db
          .prepare("UPDATE approvals SET status = ?, decision = ?, resolved_at = ? WHERE id = ?")
          .run(ev.decision === "approve" ? "approved" : "rejected", ev.decision, ts, ev.approvalId);
      }
      return ev;
    });
    const ev = tx();
    const view = applyEvent(this.views.get(ev.taskId), ev);
    if (view) this.views.set(ev.taskId, view);
    this.bus.emit("event", ev);
    return ev;
  }

  private rowToEvent(r: EventRow): AgentEvent {
    const payload = JSON.parse(r.payload) as Record<string, unknown>;
    return AgentEventSchema.parse({
      ...payload,
      seq: r.seq,
      ts: r.ts,
      taskId: r.task_id,
      type: r.type,
      ...(r.agent_id ? { agentId: r.agent_id } : {}),
    });
  }

  /** Events with seq greater than `seq`, ascending. */
  eventsSince(seq: number): AgentEvent[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq").all(seq) as EventRow[];
    return rows.map((r) => this.rowToEvent(r));
  }

  eventsFor(taskId: string): AgentEvent[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE task_id = ? ORDER BY seq").all(taskId) as EventRow[];
    return rows.map((r) => this.rowToEvent(r));
  }

  lastSeq(): number {
    const r = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM events").get() as { m: number };
    return r.m;
  }

  getJob(taskId: string): EngineJobView | undefined {
    return this.views.get(taskId);
  }

  listJobs(): EngineJobView[] {
    return [...this.views.values()];
  }

  private taskDir(taskId: string): string {
    if (!SAFE_ID.test(taskId)) throw new Error("invalid task id");
    return path.join(this.runsDir, taskId);
  }

  /** Writes the artifact file under data/runs/<taskId>/, records the row and appends `artifact.created`. */
  saveArtifact(input: SaveArtifactInput): string {
    if (!SAFE_FILE.test(input.filename)) throw new Error("invalid artifact filename");
    const dir = this.taskDir(input.taskId);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, input.filename);
    writeFileSync(file, this.redact(input.content), "utf8");
    const n = (this.db.prepare("SELECT COUNT(*) AS c FROM artifacts WHERE task_id = ?").get(input.taskId) as { c: number }).c;
    const id = `${input.taskId}-a${n + 1}`;
    this.db
      .prepare("INSERT INTO artifacts (id, task_id, kind, title, path, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, input.taskId, input.kind, input.title, file, Date.now());
    this.appendEvent({
      type: "artifact.created",
      taskId: input.taskId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      kind: input.kind,
      artifactId: id,
      title: input.title,
    });
    return id;
  }

  readArtifact(id: string): StoredArtifact | undefined {
    const r = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as
      | { id: string; task_id: string; kind: string; title: string; path: string }
      | undefined;
    if (!r) return undefined;
    return { id: r.id, taskId: r.task_id, kind: r.kind, title: r.title, content: readFileSync(r.path, "utf8") };
  }

  /** All artifacts of a task with their contents, in creation order. */
  artifactsFor(taskId: string): StoredArtifact[] {
    const rows = this.db.prepare("SELECT id FROM artifacts WHERE task_id = ? ORDER BY created_at, rowid").all(taskId) as { id: string }[];
    return rows.map((r) => this.readArtifact(r.id)).filter((a): a is StoredArtifact => a !== undefined);
  }

  /** Appends one JSON line to data/runs/<taskId>/<step>.jsonl (raw runtime output). */
  appendRunLog(taskId: string, step: string, record: Record<string, unknown>): void {
    if (!SAFE_ID.test(step)) throw new Error("invalid step name");
    const dir = this.taskDir(taskId);
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, `${step}.jsonl`), this.redact(JSON.stringify(record)) + "\n", "utf8");
  }

  /** Parsed lines of a step run log; missing file gives []. */
  readRunLog(taskId: string, step: string): Record<string, unknown>[] {
    if (!SAFE_ID.test(step)) throw new Error("invalid step name");
    let raw: string;
    try {
      raw = readFileSync(path.join(this.taskDir(taskId), `${step}.jsonl`), "utf8");
    } catch {
      return [];
    }
    const out: Record<string, unknown>[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // skip a torn line
      }
    }
    return out;
  }

  close(): void {
    this.db.close();
  }
}
