import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseGitDiff, pathProblem, validateDiff, type DiffEntry } from "../src/steps/validate-diff.ts";

const ROOT = path.join(os.tmpdir(), "al-validate-root");
const LIMITS = { maxDiffLines: 400, maxFilesChanged: 10 };

const entry = (over: Partial<DiffEntry> = {}): DiffEntry => ({
  path: "src/a.ts",
  status: "M",
  oldMode: "100644",
  newMode: "100644",
  added: 3,
  deleted: 1,
  ...over,
});

const safeSegment = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,8}$/)
  .filter((s) => !["jenkinsfile"].includes(s));
const safePath = fc
  .tuple(fc.array(safeSegment, { maxLength: 3 }), safeSegment)
  .map(([dirs, file]) => [...dirs, `${file}.ts`].join("/"));

/** Random upper/lower case per character. */
function mixedCase(name: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: name.length, maxLength: name.length })
    .map((flags) => [...name].map((c, i) => (flags[i] ? c.toUpperCase() : c)).join(""));
}

const DENIED_FILES = ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", ".env", ".env.local", ".gitattributes", ".npmrc", ".gitlab-ci.yml"];
const DENIED_DIRS = [".git", ".github", ".kiro", ".circleci"];

describe("pathProblem (property tests)", () => {
  it("accepts ordinary relative paths inside the worktree", () => {
    fc.assert(fc.property(safePath, (p) => {
      expect(pathProblem(ROOT, p)).toBeUndefined();
    }));
  });

  it("rejects any path that leaves the worktree", () => {
    const outside = fc.oneof(
      fc.tuple(fc.array(safeSegment, { maxLength: 2 }), fc.integer({ min: 1, max: 4 }), safePath).map(([d, up, p]) => [...d, ...Array<string>(up).fill(".."), p].join("/")),
      safePath.map((p) => `/${p}`),
      safePath.map((p) => `C:/${p}`),
      safePath.map((p) => `c:${p}`),
      safePath.map((p) => `../${p}`),
      safePath.map((p) => p.replace("/", "\\")).map((p) => `..\\${p}`),
      fc.constantFrom("..", ".", "", "a//b", "./a", "a/./b", "a/..", "a/../.."),
    );
    fc.assert(fc.property(outside, (p) => {
      expect(pathProblem(ROOT, p)).toBeDefined();
    }));
  });

  it("rejects protected files at any depth and in any letter case", () => {
    const file = fc.constantFrom(...DENIED_FILES).chain((f) => mixedCase(f));
    fc.assert(
      fc.property(fc.array(safeSegment, { maxLength: 3 }), file, (dirs, f) => {
        expect(pathProblem(ROOT, [...dirs, f].join("/"))).toBeDefined();
      }),
    );
  });

  it("rejects anything under a protected directory", () => {
    const dir = fc.constantFrom(...DENIED_DIRS).chain((d) => mixedCase(d));
    fc.assert(
      fc.property(fc.array(safeSegment, { maxLength: 2 }), dir, safePath, (pre, d, rest) => {
        expect(pathProblem(ROOT, [...pre, d, rest].join("/"))).toBeDefined();
      }),
    );
  });

  it("rejects Windows spellings of protected files (trailing dot, trailing space, stream)", () => {
    for (const p of ["package.json.", "package.json ", "src/package.json::$DATA", ".git ", ".env."]) {
      expect(pathProblem(ROOT, p), p).toBeDefined();
    }
  });

  it("accepts look-alikes that are not protected", () => {
    for (const p of ["src/package.ts", "docs/environment.md", "src/github.ts", "my.envelope.ts", "src/git.ts"]) {
      expect(pathProblem(ROOT, p), p).toBeUndefined();
    }
  });
});

describe("validateDiff", () => {
  it("accepts a small change and counts files and lines", () => {
    expect(validateDiff(ROOT, [entry(), entry({ path: "test/a.test.ts", status: "A", oldMode: "000000", added: 10, deleted: 0 })], LIMITS)).toEqual({
      ok: true,
      files: 2,
      lines: 14,
    });
  });

  it("rejects an empty diff", () => {
    const r = validateDiff(ROOT, [], LIMITS);
    expect(r).toEqual({ ok: false, reason: "the Developer made no change" });
  });

  it("rejects binary files, symlinks, submodules and type changes", () => {
    expect(validateDiff(ROOT, [entry({ added: null, deleted: null })], LIMITS)).toMatchObject({ ok: false, reason: expect.stringContaining("binary") });
    expect(validateDiff(ROOT, [entry({ newMode: "120000" })], LIMITS)).toMatchObject({ ok: false, reason: expect.stringContaining("symbolic link") });
    expect(validateDiff(ROOT, [entry({ newMode: "160000" })], LIMITS)).toMatchObject({ ok: false, reason: expect.stringContaining("submodule") });
    expect(validateDiff(ROOT, [entry({ status: "T" })], LIMITS)).toMatchObject({ ok: false });
  });

  it("rejects protected paths even when everything else is fine", () => {
    for (const p of ["package.json", "packages/x/package-lock.json", ".github/workflows/ci.yml", ".env", "../x.ts"]) {
      expect(validateDiff(ROOT, [entry(), entry({ path: p })], LIMITS).ok, p).toBe(false);
    }
  });

  it("enforces the file, line and byte limits", () => {
    const many = Array.from({ length: 11 }, (_, i) => entry({ path: `src/f${i}.ts` }));
    expect(validateDiff(ROOT, many, LIMITS).ok).toBe(false);
    expect(validateDiff(ROOT, many.slice(0, 10), LIMITS).ok).toBe(true);
    expect(validateDiff(ROOT, [entry({ added: 300, deleted: 100 })], LIMITS).ok).toBe(true);
    expect(validateDiff(ROOT, [entry({ added: 300, deleted: 101 })], LIMITS).ok).toBe(false);
    expect(validateDiff(ROOT, [entry()], { ...LIMITS, maxBytes: 100 }, 101).ok).toBe(false);
    expect(validateDiff(ROOT, [entry()], { ...LIMITS, maxBytes: 100 }, 100).ok).toBe(true);
  });

  it("property: a diff with at least one bad path is never accepted", () => {
    const bad = fc.constantFrom("package.json", "a/.env", "../x", "/etc/passwd", ".git/config", "x/.github/a.yml");
    fc.assert(
      fc.property(fc.array(safePath, { maxLength: 4 }), bad, fc.nat(4), (good, badPath, at) => {
        const entries = good.map((p) => entry({ path: p }));
        entries.splice(Math.min(at, entries.length), 0, entry({ path: badPath }));
        expect(validateDiff(ROOT, entries, { maxDiffLines: 10_000, maxFilesChanged: 100 }).ok).toBe(false);
      }),
    );
  });
});

describe("parseGitDiff", () => {
  const sha = "a".repeat(40);
  const raw = (rows: [string, string, string, string][]): string =>
    rows.map(([o, n, s, p]) => `:${o} ${n} ${sha} ${sha} ${s}\0${p}\0`).join("");

  it("joins raw and numstat records, including binary and unusual file names", () => {
    const r = raw([
      ["100644", "100644", "M", "src/a.ts"],
      ["000000", "100644", "A", "img/a b.png"],
    ]);
    const n = "3\t1\tsrc/a.ts\0-\t-\timg/a b.png\0";
    expect(parseGitDiff(r, n)).toEqual([
      { path: "src/a.ts", status: "M", oldMode: "100644", newMode: "100644", added: 3, deleted: 1 },
      { path: "img/a b.png", status: "A", oldMode: "000000", newMode: "100644", added: null, deleted: null },
    ]);
  });

  it("returns an empty list for empty output", () => {
    expect(parseGitDiff("", "")).toEqual([]);
  });

  it("throws on output it does not understand", () => {
    expect(() => parseGitDiff("garbage\0x\0", "")).toThrow();
    expect(() => parseGitDiff(raw([["100644", "100644", "M", "a.ts"]]), "")).toThrow();
    expect(() => parseGitDiff("", "1\t1\ta.ts\0")).toThrow();
  });
});
