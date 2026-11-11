import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { joinBase, resolveMode } from "../src/mode.ts";

describe("resolveMode", () => {
  it("is live by default", () => {
    expect(resolveMode("", undefined)).toBe("live");
    expect(resolveMode("?x=1", "")).toBe("live");
  });

  it("selects demo from the build setting or the query string", () => {
    expect(resolveMode("", "demo")).toBe("demo");
    expect(resolveMode("?mode=demo", undefined)).toBe("demo");
  });

  it("lets the query string override the build setting", () => {
    expect(resolveMode("?mode=live", "demo")).toBe("live");
  });

  it("treats unknown values as live", () => {
    expect(resolveMode("?mode=banana", "demo")).toBe("live");
  });
});

describe("joinBase", () => {
  it("joins with exactly one slash for any base", () => {
    expect(joinBase("/", "demo/run-001.json")).toBe("/demo/run-001.json");
    expect(joinBase("/repo/", "demo/run-001.json")).toBe("/repo/demo/run-001.json");
    expect(joinBase("/repo", "/demo/run-001.json")).toBe("/repo/demo/run-001.json");
  });

  it("keeps the base as a prefix", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\/([a-z0-9][a-z0-9-]{0,11}\/?)?$/), fc.stringMatching(/^[a-z0-9]([a-z0-9.-]|\/[a-z0-9]){0,20}$/), (base, path) => {
        const url = joinBase(base, path);
        expect(url.startsWith(base.endsWith("/") ? base : `${base}/`)).toBe(true);
        expect(url).not.toContain("//");
      }),
    );
  });
});
