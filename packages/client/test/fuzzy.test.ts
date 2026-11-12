import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fuzzyScore, moveSelection, rankMatches } from "../src/ui/fuzzy.ts";

const titles = [
  "Go to Lobby",
  "New change job in alpha",
  "New documentation job in alpha",
  "Approve plan in alpha",
  "Open report of alpha",
  "Schedule night job",
  "Toggle view",
];

describe("fuzzyScore", () => {
  it("matches everything for an empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("   ", "anything")).toBe(0);
  });

  it("ranks the whole text above a prefix, a prefix above word starts, word starts above the rest", () => {
    const whole = fuzzyScore("toggle view", "Toggle view")!;
    const prefix = fuzzyScore("toggle", "Toggle view")!;
    const words = fuzzyScore("view", "Toggle view")!;
    const inside = fuzzyScore("ggle", "Toggle view")!;
    const letters = fuzzyScore("tgv", "Toggle view")!;
    expect(whole).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(words);
    expect(words).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(letters);
    expect(letters).toBeGreaterThan(0);
  });

  it("is case-insensitive and ignores extra spaces", () => {
    expect(fuzzyScore("  GO   TO ", "Go to Lobby")).toBe(fuzzyScore("go to", "Go to Lobby"));
  });

  it("matches the words of the query in any order at the start of words", () => {
    expect(fuzzyScore("alpha approve", "Approve plan in alpha")).not.toBeNull();
    expect(fuzzyScore("plan app", "Approve plan in alpha")).not.toBeNull();
  });

  it("does not use one word of the text for two words of the query", () => {
    // Only the looser tiers can match it; the word-start tier needs two different words.
    expect(fuzzyScore("al al", "Approve plan in alpha")).toBeLessThan(500);
    expect(fuzzyScore("al pl", "Approve plan in alpha")).toBeGreaterThan(500);
  });

  it("returns null when the letters are not all there in order", () => {
    expect(fuzzyScore("zzz", "Toggle view")).toBeNull();
    expect(fuzzyScore("vt", "Toggle view")).toBeNull();
  });
});

describe("rankMatches", () => {
  it("puts exact prefixes first", () => {
    expect(rankMatches(titles, "new", (t) => t)).toEqual(["New change job in alpha", "New documentation job in alpha"]);
    // "job" is the start of a word in four titles and a prefix of none: they come in command order.
    expect(rankMatches(titles, "job", (t) => t)).toEqual(["New change job in alpha", "New documentation job in alpha", "Schedule night job"]);
    // A prefix of one title beats a word start of another.
    expect(rankMatches(["Open report of alpha", "Report"], "rep", (t) => t)).toEqual(["Report", "Open report of alpha"]);
  });

  it("keeps the command order for equal scores and for an empty query", () => {
    expect(rankMatches(titles, "", (t) => t)).toEqual(titles);
    expect(rankMatches(["b x", "a x"], "x", (t) => t)).toEqual(["b x", "a x"]);
  });

  it("drops what does not match", () => {
    expect(rankMatches(titles, "lobby", (t) => t)).toEqual(["Go to Lobby"]);
    expect(rankMatches(titles, "qqq", (t) => t)).toEqual([]);
  });

  it("finds a command by its project name", () => {
    const list = ["Approve plan in alpha", "Approve plan in beta"];
    expect(rankMatches(list, "approve beta", (t) => t)).toEqual(["Approve plan in beta"]);
  });

  it("property: every item that starts with the query comes before every item that does not", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 12 }), fc.string({ minLength: 1, maxLength: 4 }), (items, query) => {
        const q = query.trim().toLowerCase().replace(/\s+/g, " ");
        fc.pre(q.length > 0);
        const ranked = rankMatches(items, query, (t) => t);
        const starts = (t: string) => t.toLowerCase().startsWith(q);
        const firstOther = ranked.findIndex((t) => !starts(t));
        if (firstOther < 0) return;
        expect(ranked.slice(firstOther).some(starts)).toBe(false);
      }),
    );
  });

  it("property: the result is a sub-list of the items, with nothing added", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 10 }), { maxLength: 10 }), fc.string({ maxLength: 4 }), (items, query) => {
        const ranked = rankMatches(items, query, (t) => t);
        expect(ranked.length).toBeLessThanOrEqual(items.length);
        for (const r of ranked) expect(items).toContain(r);
      }),
    );
  });
});

describe("moveSelection", () => {
  it("wraps at both ends and stays at 0 without rows", () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(0, 1, 0)).toBe(0);
  });

  it("property: always inside the list", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), fc.constantFrom(-1, 1), fc.integer({ min: 1, max: 50 }), (at, delta, count) => {
        const next = moveSelection(Math.min(at, count - 1), delta, count);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(count);
      }),
    );
  });
});
