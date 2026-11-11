import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectSchema, RegisterProjectResultSchema, type RegisterProjectBody, type RegisterProjectResult } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";
import { ConflictError, NotFoundError } from "../src/errors.ts";
import { git } from "../src/git.ts";
import { PROJECT_ROOT } from "../src/paths.ts";
import { ProjectRegistry, ProjectUnavailableError, repoView, slugify } from "../src/projects/registry.ts";
import { NODE_FILES, fakeKiroKey, makeRepo } from "./helpers.ts";

let tmp: string;
let hotel: string;
let file: string;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "al-proj-")));
  hotel = path.join(tmp, "hotel");
  mkdirSync(hotel, { recursive: true });
  file = path.join(tmp, "data", "projects.json");
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function registry(extra: Partial<ConstructorParameters<typeof ProjectRegistry>[0]> = {}): ProjectRegistry {
  return new ProjectRegistry({
    file,
    roots: [hotel],
    builtin: [{ id: "haunted-todo", name: "haunted-todo", source: "fixtures/repos/haunted-todo", testCommand: "npm test" }],
    reposDir: path.join(tmp, "data", "repos"),
    agentlifeRoot: PROJECT_ROOT,
    secrets: [],
    now: () => 1234,
    ...extra,
  });
}

const body = (p: string, name = "My App", more: Partial<RegisterProjectBody> = {}): RegisterProjectBody => ({ path: p, name, ...more });

async function expectError(reg: ProjectRegistry, input: RegisterProjectBody, code: string): Promise<void> {
  const res = await reg.register(input);
  expect(res.status, JSON.stringify(res)).toBe("error");
  if (res.status === "error") expect(res.code).toBe(code);
}

describe("register", () => {
  it("registers a node project, detects the stack and stores the path only in the file", async () => {
    const dir = await makeRepo(path.join(hotel, "my-app"), NODE_FILES);
    const reg = registry();
    const res = await reg.register(body(dir));
    expect(res).toEqual({
      status: "ok",
      project: { id: "my-app", name: "My App", stack: "node-npm", testCommand: "npm test", builtin: false, registeredAt: 1234 },
    });
    expect(RegisterProjectResultSchema.safeParse(res).success).toBe(true);

    const stored = JSON.parse(readFileSync(file, "utf8")) as { projects: { path: string; acceptedFindings: string[] }[] };
    expect(stored.projects[0]!.path).toBe(dir);
    expect(JSON.stringify(reg.list())).not.toContain(dir);
    expect(reg.list().map((p) => p.id)).toEqual(["haunted-todo", "my-app"]);
    expect(reg.list().every((p) => ProjectSchema.safeParse(p).success)).toBe(true);
    // A new registry reads the file back.
    expect(registry().get("my-app")?.path).toBe(dir);
  });

  it("keeps a custom test command for node projects and ignores one for projects without a lockfile", async () => {
    const node = await makeRepo(path.join(hotel, "node"), NODE_FILES);
    const plain = await makeRepo(path.join(hotel, "plain"), { "README.md": "hi\n" });
    const reg = registry();
    const a = await reg.register(body(node, "Node", { testCommand: "npm run check" }));
    const b = await reg.register(body(plain, "Plain", { testCommand: "make test" }));
    expect(a.status === "ok" && a.project.testCommand).toBe("npm run check");
    expect(b.status === "ok" && b.project.stack).toBe("unsupported-tests");
    expect(b.status === "ok" && b.project.testCommand).toBe("");
  });

  it("gives unique ids and refuses the same folder twice", async () => {
    const one = await makeRepo(path.join(hotel, "one"), NODE_FILES);
    const two = await makeRepo(path.join(hotel, "two"), NODE_FILES);
    const reg = registry();
    await reg.register(body(one, "Same Name"));
    const second = await reg.register(body(two, "Same Name"));
    expect(second.status === "ok" && second.project.id).toBe("same-name-2");
    await expectError(reg, body(one + path.sep, "Other"), "already_registered");
    const clash = await makeRepo(path.join(hotel, "three"), NODE_FILES);
    const third = await reg.register(body(clash, "haunted-todo"));
    expect(third.status === "ok" && third.project.id).toBe("haunted-todo-2");
    await expectError(reg, body(await makeRepo(path.join(hotel, "four"), NODE_FILES), "!!!"), "invalid_name");
  });

  it("refuses folders that are not usable, with the rule and never the path", async () => {
    const reg = registry();
    mkdirSync(path.join(hotel, "plain-dir"));
    writeFileSync(path.join(hotel, "a-file.txt"), "x");
    await expectError(reg, body("relative/dir"), "invalid_path");
    await expectError(reg, body(path.join(hotel, "missing")), "path_not_found");
    await expectError(reg, body(path.join(hotel, "a-file.txt")), "not_a_directory");
    await expectError(reg, body(path.join(hotel, "plain-dir")), "not_a_git_repo");

    const empty = path.join(hotel, "empty");
    await makeRepo(empty, {}, { commit: false });
    await expectError(reg, body(empty), "no_commits");

    const mono = await makeRepo(path.join(hotel, "mono"), { "sub/a.txt": "a\n" });
    await expectError(reg, body(path.join(mono, "sub")), "not_a_git_repo");

    const outside = await makeRepo(path.join(tmp, "outside"), NODE_FILES);
    const res = await reg.register(body(outside));
    expect(res).toMatchObject({ status: "error", code: "outside_allowed_roots" });
    expect(JSON.stringify(res)).not.toContain(outside);
    await expectError(reg, body(hotel), "outside_allowed_roots");
  });

  it("refuses a repository in detached HEAD state", async () => {
    const dir = await makeRepo(path.join(hotel, "detached"), NODE_FILES);
    await git(dir, ["checkout", "--quiet", "--detach"]);
    await expectError(registry(), body(dir), "detached_head");
  });

  it("refuses the AGENT LIFE repository itself and anything inside it", async () => {
    const reg = registry({ roots: [path.dirname(PROJECT_ROOT)] });
    await expectError(reg, body(PROJECT_ROOT), "is_agentlife");
    await expectError(reg, body(path.join(PROJECT_ROOT, "packages")), "is_agentlife");
  });

  it("refuses a link that leaves the allowed root", async () => {
    const outside = await makeRepo(path.join(tmp, "outside"), NODE_FILES);
    try {
      symlinkSync(outside, path.join(hotel, "link"), "junction");
    } catch {
      return;
    }
    await expectError(registry(), body(path.join(hotel, "link")), "outside_allowed_roots");
  });

  it("refuses projects over the file and size limits and says which limit was hit", async () => {
    const dir = await makeRepo(path.join(hotel, "big"), { "a.txt": "1\n", "b.txt": "2\n", "c.txt": "3\n", "d.txt": "x".repeat(500) });
    const files = await registry({ limits: { files: 3, bytes: 1_000_000 } }).register(body(dir));
    expect(files).toMatchObject({ status: "error", code: "too_many_files" });
    expect(files.status === "error" && files.message).toMatch(/limit is 3/);
    const bytes = await registry({ limits: { files: 100, bytes: 100 } }).register(body(dir));
    expect(bytes).toMatchObject({ status: "error", code: "too_large" });
    expect(bytes.status === "error" && bytes.message).toMatch(/limit is 100 bytes/);
  });
});

// Addresses are built at runtime: the repository scanner would flag the literals.
const email = (user: string, host: string) => [user, host].join("@");

describe("leak scanner on registration", () => {
  it("asks for acceptance with masked findings, then registers and stores only finding ids", async () => {
    const key = fakeKiroKey();
    const dir = await makeRepo(path.join(hotel, "leaky"), { ...NODE_FILES, "src/config.js": `const k = "${key}";\n// owner ${email("jane.doe", "corp.io")}\n` });
    const reg = registry();
    const first = await reg.register(body(dir, "Leaky"));
    expect(first.status).toBe("needs_acceptance");
    const dump = JSON.stringify(first);
    expect(dump).not.toContain(key);
    expect(dump).not.toContain("jane.doe");
    expect(dump).not.toContain(dir);
    if (first.status !== "needs_acceptance") throw new Error("unreachable");
    expect(first.total).toBe(2);
    expect(first.findings.map((f) => `${f.severity}:${f.kind}`)).toEqual(["high:kiro-api-key", "medium:email"]);
    expect(first.findings[0]).toMatchObject({ where: "src/config.js", count: 1 });
    expect(reg.list().map((p) => p.id)).toEqual(["haunted-todo"]); // nothing was stored

    const second = await reg.register(body(dir, "Leaky", { acceptFindings: true }));
    expect(second.status).toBe("ok");
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(key);
    expect(text).not.toContain("jane.doe");
    const stored = JSON.parse(text) as { projects: { acceptedFindings: string[] }[] };
    expect(stored.projects[0]!.acceptedFindings).toHaveLength(2);
  });

  it("finds a known secret value of this machine and a tracked .env file, but not a lockfile hash or .env.example", async () => {
    const secret = "correct-horse-battery-staple-1234";
    const dir = await makeRepo(path.join(hotel, "envs"), {
      ...NODE_FILES,
      ".env": "A=1\n",
      ".env.example": "A=\n",
      "notes.txt": `token ${secret}\n`,
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, integrity: fakeKiroKey() }),
    });
    const res = await registry({ secrets: [secret] }).register(body(dir));
    expect(res.status).toBe("needs_acceptance");
    if (res.status !== "needs_acceptance") throw new Error("unreachable");
    expect(res.findings.map((f) => f.kind).sort()).toEqual(["known-secret-value", "tracked-env-file"]);
    expect(JSON.stringify(res)).not.toContain(secret);
  });

  it("scans the committed content (HEAD), not uncommitted edits", async () => {
    const dir = await makeRepo(path.join(hotel, "dirty"), NODE_FILES);
    writeFileSync(path.join(dir, "index.js"), `const k = "${fakeKiroKey()}";\n`);
    const res = await registry().register(body(dir));
    expect(res.status).toBe("ok");
  });
});

describe("remove, revalidate and storage", () => {
  it("unregisters, deletes only the engine's clone and never touches the user's repository", async () => {
    const dir = await makeRepo(path.join(hotel, "gone"), NODE_FILES);
    const reg = registry();
    await reg.register(body(dir, "Gone"));
    const clone = path.join(tmp, "data", "repos", "gone");
    mkdirSync(clone, { recursive: true });
    writeFileSync(path.join(clone, "x.txt"), "x");
    const head = (await git(dir, ["rev-parse", "HEAD"])).trim();

    reg.remove("gone");
    expect(reg.has("gone")).toBe(false);
    expect(existsSync(clone)).toBe(false);
    expect(existsSync(path.join(dir, "index.js"))).toBe(true);
    expect((await git(dir, ["rev-parse", "HEAD"])).trim()).toBe(head);
    expect(registry().has("gone")).toBe(false);
    expect(() => reg.remove("gone")).toThrow(NotFoundError);
  });

  it("does not remove the built-in project", () => {
    const reg = registry();
    expect(() => reg.remove("haunted-todo")).toThrow(ConflictError);
    expect(reg.has("haunted-todo")).toBe(true);
    expect(reg.list()[0]).toMatchObject({ builtin: true, registeredAt: 0 });
  });

  it("checks again at job time that the folder is still inside an allowed root", async () => {
    const dir = await makeRepo(path.join(hotel, "moved"), NODE_FILES);
    const reg = registry();
    await reg.register(body(dir, "Moved"));
    const project = reg.get("moved")!;
    expect(reg.revalidate(project)).toBe(dir);
    expect(() => registry({ roots: [path.join(tmp, "other-root")] }).revalidate(project)).toThrow(ProjectUnavailableError);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    expect(() => reg.revalidate(project)).toThrow(/no longer on disk/);
    expect(() => reg.revalidate(reg.get("haunted-todo")!)).toThrow(ProjectUnavailableError);
  });

  it("refuses to start from a damaged projects file instead of dropping the projects", () => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    expect(() => registry()).toThrow(/not valid JSON/);
    writeFileSync(file, JSON.stringify({ version: 1, projects: [{ id: "Bad Id" }] }));
    expect(() => registry()).toThrow(/is invalid/);
  });

  it("makes slugs from names", () => {
    expect(slugify("My Cool App!")).toBe("my-cool-app");
    expect(slugify("  Ünïcode  ")).toBe("unicode");
    expect(slugify("---")).toBe("");
    expect(slugify("x".repeat(80)).length).toBe(40);
  });

  it("describes projects in the repo list without a path", async () => {
    const dir = await makeRepo(path.join(hotel, "view"), NODE_FILES);
    const reg = registry();
    await reg.register(body(dir, "View"));
    const views = reg.list().map(repoView);
    expect(views[0]).toEqual({ id: "haunted-todo", name: "haunted-todo" });
    expect(views[1]!.description).toMatch(/Docker/);
  });
});

describe("HTTP routes", () => {
  let engine: Engine | undefined;
  afterEach(async () => {
    await engine?.close();
    engine = undefined;
  });

  async function boot(): Promise<string> {
    engine = await startEngine({
      storeOptions: { dbPath: ":memory:", runsDir: path.join(tmp, "runs") },
      dataDir: path.join(tmp, "data"),
      projectRoots: [hotel],
      projectsFile: file,
      port: 0,
    });
    return `http://127.0.0.1:${engine.port}`;
  }
  const post = (url: string, b: unknown) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

  it("registers, lists, starts a job on the project and removes it, never exposing the path", async () => {
    const dir = await makeRepo(path.join(hotel, "http-app"), NODE_FILES);
    const url = await boot();

    const created = await post(`${url}/projects`, { path: dir, name: "Http App" });
    expect(created.status).toBe(201);
    const createdText = await created.text();
    expect(createdText).not.toContain(dir);
    const result = RegisterProjectResultSchema.parse(JSON.parse(createdText)) as Extract<RegisterProjectResult, { status: "ok" }>;
    expect(result.project.id).toBe("http-app");

    for (const route of ["/projects", "/repos"]) {
      const text = await (await fetch(`${url}${route}`)).text();
      expect(text, route).toContain("http-app");
      expect(text, route).not.toContain(dir);
      expect(text, route).not.toContain("http-app\\");
    }

    const job = await post(`${url}/tasks`, { repoId: "http-app", goal: "Do something small" });
    expect(job.status).toBe(201);
    const unknown = await post(`${url}/tasks`, { repoId: "nope", goal: "x" });
    expect(unknown.status).toBe(400);
  });

  it("answers 400 for a refused folder, 200 for findings to accept and 409 when removing the built-in project", async () => {
    const dir = await makeRepo(path.join(hotel, "http-leaky"), { ...NODE_FILES, "a.js": `// ${email("bob", "corp.io")}\n` });
    const url = await boot();
    const refused = await post(`${url}/projects`, { path: path.join(tmp, "elsewhere"), name: "x" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).not.toContain("elsewhere");
    const needs = await post(`${url}/projects`, { path: dir, name: "Leaky" });
    expect(needs.status).toBe(200);
    expect((await needs.json() as { status: string }).status).toBe("needs_acceptance");
    const invalid = await post(`${url}/projects`, { path: dir });
    expect(invalid.status).toBe(400);
    expect((await fetch(`${url}/projects/haunted-todo`, { method: "DELETE" })).status).toBe(409);
    expect((await fetch(`${url}/projects/unknown`, { method: "DELETE" })).status).toBe(404);
  });
});
