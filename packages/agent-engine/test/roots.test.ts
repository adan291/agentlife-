import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowedRoots, ensureRoots, isInsideRoot, realRoots, samePath } from "../src/projects/roots.ts";

let tmp: string;
let hotel: string;
let linked = false;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "al-roots-")));
  hotel = path.join(tmp, "hotel");
  mkdirSync(path.join(hotel, "a", "a", "a"), { recursive: true });
  mkdirSync(path.join(tmp, "hotelx", "a"), { recursive: true }); // shares a name prefix with the root
  mkdirSync(path.join(tmp, "outside", "a", "a"), { recursive: true });
  try {
    // A junction needs no privileges on Windows; on other systems this is a plain symlink.
    symlinkSync(path.join(tmp, "outside"), path.join(hotel, "jlink"), "junction");
    linked = true;
  } catch {
    linked = false;
  }
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const check = (candidate: string): boolean => {
  let real: string;
  try {
    real = realpathSync.native(candidate);
  } catch {
    return false;
  }
  return isInsideRoot(real, realRoots([hotel]));
};

describe("isInsideRoot", () => {
  it("accepts folders below the root and refuses the root itself and look-alike siblings", () => {
    expect(check(path.join(hotel, "a"))).toBe(true);
    expect(check(path.join(hotel, "a", "..", "a", "a"))).toBe(true);
    expect(check(path.join(hotel, "a", "a", "a") + path.sep)).toBe(true);
    expect(check(hotel)).toBe(false);
    expect(check(hotel + path.sep)).toBe(false);
    expect(check(path.join(tmp, "hotelx", "a"))).toBe(false);
    expect(check(path.join(hotel, "a", "..", ".."))).toBe(false);
    expect(check(path.join(tmp, "outside", "a"))).toBe(false);
  });

  it("is case-insensitive on Windows only", () => {
    const upper = path.join(hotel.toUpperCase(), "A");
    if (process.platform === "win32") expect(check(upper)).toBe(true);
  });

  it("follows a link out of the root", () => {
    if (!linked) return;
    expect(check(path.join(hotel, "jlink", "a"))).toBe(false);
    expect(check(path.join(hotel, "jlink"))).toBe(false);
  });

  it("refuses everything when the root does not exist", () => {
    expect(isInsideRoot(path.join(tmp, "outside"), realRoots([path.join(tmp, "missing")]))).toBe(false);
  });

  it("never validates a path whose real location is outside the root (property)", () => {
    const names = ["a", "..", ".", "A", "", "hotel", "hotelx", "outside", "jlink"];
    const rootReal = realpathSync.native(hotel).toLowerCase();
    const bases = [hotel, path.join(hotel, "a"), path.join(hotel, "a", "a"), tmp, path.join(tmp, "outside"), path.join(tmp, "hotelx"), hotel + path.sep];
    fc.assert(
      fc.property(fc.constantFrom(...bases), fc.array(fc.constantFrom(...names), { maxLength: 8 }), fc.boolean(), (base, segs, trailing) => {
        const candidate = [base, ...segs].join(path.sep) + (trailing ? path.sep : "");
        if (!check(candidate)) return true;
        const real = realpathSync.native(candidate).toLowerCase();
        // Independent check by string prefix: the real path starts with the real root plus a separator.
        return real.startsWith(rootReal + path.sep);
      }),
      { numRuns: 300 },
    );
  });
});

describe("samePath", () => {
  it("compares places, not spellings", () => {
    expect(samePath(hotel, hotel + path.sep)).toBe(true);
    expect(samePath(hotel, path.join(hotel, "a"))).toBe(false);
    expect(samePath(hotel, path.join(tmp, "hotelx"))).toBe(false);
  });
});

describe("allowedRoots", () => {
  it("reads config/hotel.json and lets AGENTLIFE_PROJECT_ROOTS replace it", () => {
    const a = path.join(tmp, "one");
    const b = path.join(tmp, "two");
    expect(allowedRoots({ env: { AGENTLIFE_PROJECT_ROOTS: `${a};${b}` } })).toEqual([a, b]);
    // hotel.json lists a Windows path; only absolute paths of this platform count.
    const shipped = allowedRoots({ env: {} });
    expect(shipped.every((r) => path.isAbsolute(r))).toBe(true);
  });

  it("ignores relative roots, so 'D:\\AgentHotel' on Linux never becomes a folder in the working directory", () => {
    expect(allowedRoots({ env: { AGENTLIFE_PROJECT_ROOTS: "relative/dir;..\\x" } })).toEqual([]);
  });

  it("returns no roots when the config file is missing", () => {
    expect(allowedRoots({ configDir: path.join(tmp, "nope"), env: {} })).toEqual([]);
  });

  it("creates missing root folders and survives a root that cannot be created", () => {
    const fresh = path.join(tmp, "new-root");
    ensureRoots([fresh]);
    expect(realRoots([fresh])).toHaveLength(1);
    expect(() => ensureRoots([path.join(fresh, "\0bad")])).not.toThrow();
  });
});
