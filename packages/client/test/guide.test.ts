import { describe, expect, it } from "vitest";
import { GUIDE_FLAG, GUIDE_STEPS, isFirstVisit, markGuideSeen } from "../src/ui/guide.ts";
import type { FlagStorage } from "../src/ui/guide.ts";

function memory(): FlagStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("guide flag", () => {
  it("is a first visit until the guide is marked as seen", () => {
    const s = memory();
    expect(isFirstVisit(s)).toBe(true);
    markGuideSeen(s);
    expect(s.data.get(GUIDE_FLAG)).toBe("1");
    expect(isFirstVisit(s)).toBe(false);
  });

  it("treats missing or throwing storage as a first visit and never throws", () => {
    const broken: FlagStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(isFirstVisit(undefined)).toBe(true);
    expect(isFirstVisit(broken)).toBe(true);
    expect(() => markGuideSeen(broken)).not.toThrow();
    expect(() => markGuideSeen(undefined)).not.toThrow();
  });

  it("has the three steps of the spec", () => {
    expect(GUIDE_STEPS).toHaveLength(3);
  });
});
