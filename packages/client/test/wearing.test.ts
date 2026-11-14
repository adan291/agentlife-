import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import { GUEST_IDS, OUTFIT_SLOTS, OutfitsFileSchema, RunExportSchema, validateRoom } from "@agentlife/shared";
import type { HrState, OutfitPart, OutfitSlot, ProgressView, ServerMsg, TeamMember, WardrobeState, WearWho } from "@agentlife/shared";
import { AVATAR_FRAME, drawAvatar, guestAnchors } from "../src/scene/figure.ts";
import type { AvatarPose, DrawnView } from "../src/scene/figure.ts";
import { FloorPeople } from "../src/scene/floor-people.ts";
import { lookKey, lookOf } from "../src/scene/outfit.ts";
import { OutfitBook, outfitOfAvatar } from "../src/scene/outfit-book.ts";
import { createLookPreviews } from "../src/scene/previews.ts";
import { ReplayTransport } from "../src/replay/transport.ts";
import type { ReplayRooms } from "../src/replay/transport.ts";
import { createHrPanel, standing } from "../src/ui/hr.ts";
import { createLookPicker, pickerParts } from "../src/ui/look-picker.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { createProfilePanel } from "../src/ui/profile.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const here = dirname(fileURLToPath(import.meta.url));
const shipped = OutfitsFileSchema.parse(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "config", "outfits.json"), "utf8"))).parts;
const VIEWS: DrawnView[] = [3, 4, 5, 6, 7];
const part = (id: string) => shipped.find((p) => p.id === id)!;

// ---- the user's figure ----

/** A Graphics stand-in that records every call as text and every point it is asked to draw. */
function recorder() {
  const points: { x: number; y: number }[] = [];
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  const box = (x: number, y: number, rx: number, ry = rx) => points.push({ x: x - rx, y: y - ry }, { x: x + rx, y: y + ry });
  chain["circle"] = (x: number, y: number, r: number) => (calls.push(`circle:${x},${y},${r}`), box(x, y, r), chain);
  chain["ellipse"] = (x: number, y: number, rx: number, ry: number) => (calls.push(`ellipse:${x},${y},${rx},${ry}`), box(x, y, rx, ry), chain);
  chain["rect"] = (x: number, y: number, w: number, h: number) => (calls.push(`rect:${x},${y},${w},${h}`), points.push({ x, y }, { x: x + w, y: y + h }), chain);
  chain["poly"] = (pts: number[]) => {
    calls.push(`poly:${pts.join(",")}`);
    for (let i = 0; i < pts.length; i += 2) points.push({ x: pts[i]!, y: pts[i + 1]! });
    return chain;
  };
  chain["moveTo"] = (x: number, y: number) => (calls.push(`moveTo:${x},${y}`), points.push({ x, y }), chain);
  chain["lineTo"] = (x: number, y: number) => (calls.push(`lineTo:${x},${y}`), points.push({ x, y }), chain);
  chain["quadraticCurveTo"] = (cx: number, cy: number, x: number, y: number) => (calls.push(`quad:${cx},${cy},${x},${y}`), points.push({ x: cx, y: cy }, { x, y }), chain);
  chain["fill"] = (s: unknown) => (calls.push(`fill:${JSON.stringify(s)}`), chain);
  chain["stroke"] = (s: unknown) => (calls.push(`stroke:${JSON.stringify(s)}`), chain);
  return { g: chain as unknown as Graphics, points, calls };
}

interface Move {
  pose?: AvatarPose;
  frame: 0 | 1;
}
/** Every posture of the user's figure: walking frames, sitting, and the gestures of waiting-fun, on both phases. */
const MOVES: Move[] = [
  { frame: 0 },
  { frame: 1 },
  ...(["sit", "wave", "cheer", "dance", "sit_wave", "sit_cheer"] as const).flatMap((pose) => [{ pose, frame: 0 as const }, { pose, frame: 1 as const }]),
];
const moveName = (m: Move) => `${m.pose ?? "walk"}:${m.frame}`;

/** Where the head of the user's figure is for a move: the same arithmetic as `drawGuest`. */
function headOf(m: Move, view: DrawnView): { hx: number; hy: number } {
  const shift = { 3: 0, 4: -2, 5: -3, 6: -2, 7: 0 }[view];
  const sitting = m.pose === "sit" || m.pose === "sit_wave" || m.pose === "sit_cheer";
  const gesture = m.pose === "wave" || m.pose === "sit_wave" ? "wave" : m.pose === "cheer" || m.pose === "sit_cheer" ? "cheer" : m.pose === "dance" ? "dance" : undefined;
  const step = gesture || sitting ? 0 : m.frame;
  const phase = gesture ? m.frame : 0;
  const hop = !sitting && (gesture === "cheer" || gesture === "dance") && phase === 1 ? -3 : 0;
  const sway = gesture === "dance" ? (phase === 1 ? 2 : -2) : 0;
  const bob = (step === 1 ? -1 : 0) + hop + (sitting ? 8 : 0);
  return { hx: shift + sway, hy: -39 + bob };
}
const TORSO: Record<DrawnView, number> = { 3: 16, 4: 14, 5: 10, 6: 14, 7: 16 };

const guest = (look: ReturnType<typeof lookOf> | undefined, view: DrawnView, m: Move) => {
  const r = recorder();
  drawAvatar(r.g, "user", view, m.frame, m.pose, look);
  return r;
};
const isSubsequence = (small: string[], big: string[]): boolean => {
  let i = 0;
  for (const call of big) if (small[i] === call) i++;
  return i === small.length;
};
/** The points the part drew: those of the dressed drawing that the bare one does not have (each bare point is used up once). */
function ownPoints(d: { points: { x: number; y: number }[] }, b: { points: { x: number; y: number }[] }): { x: number; y: number }[] {
  const left = new Map<string, number>();
  for (const p of b.points) left.set(`${p.x},${p.y}`, (left.get(`${p.x},${p.y}`) ?? 0) + 1);
  return d.points.filter((p) => {
    const key = `${p.x},${p.y}`;
    const n = left.get(key) ?? 0;
    if (n > 0) left.set(key, n - 1);
    return n === 0;
  });
}
const FRONT_ONLY = new Set(["carnation", "bat_bow_tie"]);

describe("the user's figure wears parts", () => {
  it("has anchors that follow its head and torso", () => {
    const a = guestAnchors(3, 0, -39);
    expect(a).toMatchObject({ view: 3, hx: 0, hy: -39, hr: 9.5, bw: 8, chest: -30, hem: -15, chestX: 0, eyes: [-3.5, 3.5] });
    expect(guestAnchors(5, -3, -31).bw).toBe(5);
    expect(guestAnchors(7, 0, -39).eyes).toEqual([]);
  });

  it("draws every part in the five views and every posture, inside the frame of the sprite", () => {
    for (const p of shipped) {
      for (const view of VIEWS) {
        for (const m of MOVES) {
          for (const pt of guest(lookOf([p]), view, m).points) {
            const where = `${p.id} view ${view} ${moveName(m)}`;
            expect(pt.x, where).toBeGreaterThanOrEqual(AVATAR_FRAME.x);
            expect(pt.x, where).toBeLessThanOrEqual(AVATAR_FRAME.x + AVATAR_FRAME.width);
            expect(pt.y, where).toBeGreaterThanOrEqual(AVATAR_FRAME.y);
            expect(pt.y, where).toBeLessThanOrEqual(AVATAR_FRAME.y + AVATAR_FRAME.height);
          }
        }
      }
    }
  });

  it("only adds: the bare figure's drawing is inside the dressed one, and every part adds something (front-only pieces not from behind)", () => {
    for (const p of shipped) {
      for (const view of VIEWS) {
        for (const m of MOVES) {
          const bare = guest(undefined, view, m).calls;
          const dressed = guest(lookOf([p]), view, m).calls;
          const where = `${p.id} ${view} ${moveName(m)}`;
          expect(isSubsequence(bare, dressed), where).toBe(true);
          if (FRONT_ONLY.has(p.id) && (view === 6 || view === 7)) expect(dressed.length, where).toBe(bare.length);
          else expect(dressed.length, where).toBeGreaterThan(bare.length);
        }
      }
    }
  });

  it("keeps a hat above the eyes and within reach of the head, wherever the head is", () => {
    for (const p of shipped.filter((s) => s.slot === "hat")) {
      for (const view of VIEWS) {
        for (const m of MOVES) {
          const { hy } = headOf(m, view);
          for (const pt of ownPoints(guest(lookOf([p]), view, m), guest(undefined, view, m))) {
            expect(pt.y, `${p.id} ${view} ${moveName(m)} low`).toBeLessThanOrEqual(hy - 1.5 + 1e-9);
            expect(pt.y, `${p.id} ${view} ${moveName(m)} high`).toBeGreaterThanOrEqual(hy - 17.5 - 1e-9);
          }
        }
      }
    }
  });

  it("keeps a top on the torso, below the head and inside its edges (a cape may flare out)", () => {
    for (const p of shipped.filter((s) => s.slot === "top")) {
      for (const view of VIEWS) {
        for (const m of MOVES) {
          const { hx, hy } = headOf(m, view);
          // The side view of the user's figure is only 10 px wide: a lapel may stick out two pixels there.
          const out = p.id === "cape" ? 3 : view === 5 ? 2 : 1;
          const half = TORSO[view] / 2;
          for (const pt of ownPoints(guest(lookOf([p]), view, m), guest(undefined, view, m))) {
            const where = `${p.id} ${view} ${moveName(m)}`;
            expect(pt.x, `${where} left`).toBeGreaterThanOrEqual(hx - half - out + 1e-9);
            expect(pt.x, `${where} right`).toBeLessThanOrEqual(hx + half + out - 1e-9);
            // A collar may rise two pixels above the torso, onto the neck.
            expect(pt.y, `${where} up`).toBeGreaterThanOrEqual(hy + 7 - 1e-9);
          }
        }
      }
    }
  });

  it("draws the top before the head and the hat and the accessory after it, as for a ghost", () => {
    const face = (calls: string[]) => calls.findIndex((c) => c.startsWith("ellipse:") && c.endsWith(",7.5,7"));
    const base = guest(undefined, 3, { frame: 0 }).calls;
    for (const p of shipped) {
      const calls = guest(lookOf([p]), 3, { frame: 0 }).calls;
      const start = calls.findIndex((c, i) => c !== base[i]);
      if (p.slot === "top") expect(start, p.id).toBeLessThan(face(calls));
      else expect(start, p.id).toBeGreaterThan(face(calls) - 1);
    }
  });

  it("keeps the ghost's drawing as it was when no look is given", () => {
    const a = recorder();
    const b = recorder();
    drawAvatar(a.g, "developer", 3, 0);
    drawAvatar(b.g, "developer", 3, 0, undefined, {});
    expect(b.calls).toEqual(a.calls);
  });
});

// ---- the book ----

const wardrobeMsg = (owned: string[] = [], parts: OutfitPart[] = shipped): ServerMsg => ({
  type: "wardrobe",
  state: { balance: 100, parts, owned, badges: [{ id: "veteran", name: "Hotel veteran" }] },
});
const outfitsMsg = (user: Record<string, string> = {}, members: { project: string; member: string; outfit: Record<string, string> }[] = []): ServerMsg => ({
  type: "outfits",
  state: { user, members },
});

describe("OutfitBook", () => {
  it("is empty and unavailable until the server sends a wardrobe", () => {
    const book = new OutfitBook();
    expect(book.available).toBe(false);
    expect(book.wardrobe).toBeNull();
    expect(book.parts).toEqual([]);
    expect(book.forUser()).toEqual({});
    expect(book.forMember("alpha", "developer")).toEqual({});
    expect(book.look({ hat: "flat_cap" })).toBeUndefined();
  });

  it("follows the wardrobe and the outfits messages and ignores everything else", () => {
    const book = new OutfitBook();
    expect(book.apply({ type: "wallet", balance: 3 })).toBe(false);
    expect(book.apply(wardrobeMsg(["flat_cap"]))).toBe(true);
    expect(book.available).toBe(true);
    expect(book.apply(outfitsMsg({ hat: "crown" }, [{ project: "alpha", member: "developer", outfit: { hat: "flat_cap" } }]))).toBe(true);
    expect(book.forUser()).toEqual({ hat: "crown" });
    expect(book.forMember("alpha", "developer")).toEqual({ hat: "flat_cap" });
    expect(book.forMember("alpha", "qa")).toEqual({});
    expect(book.forMember("beta", "developer")).toEqual({});
    // A new message replaces the old one: a member who is gone is bare.
    book.apply(outfitsMsg());
    expect(book.forMember("alpha", "developer")).toEqual({});
  });

  it("turns an outfit into a look with the palettes of the parts, leaving out what it does not know", () => {
    const book = new OutfitBook();
    book.apply(wardrobeMsg());
    const look = book.look({ hat: "flat_cap", top: "waistcoat", accessory: "no_such_part" });
    expect(lookKey(look)).toBe("flat_cap|waistcoat|");
    expect(look?.hat?.palette.main).toBe(Number.parseInt(part("flat_cap").palette.main.slice(1), 16));
    // A part in the wrong slot (a corrupt file) is not drawn on that slot.
    expect(book.look({ top: "flat_cap" })).toBeUndefined();
    expect(book.look({})).toBeUndefined();
  });
});

describe("who wears what on the floor", () => {
  const teamView = (over: Partial<Extract<ServerMsg, { type: "team_view" }>> = {}): ServerMsg => ({
    type: "team_view",
    roomId: "project:alpha",
    members: [
      { agentId: "architect", name: "Architect", memberId: "architect" },
      { agentId: "developer", name: "Ada", memberId: "dev-2" },
      { agentId: "qa", name: "QA", memberId: "qa" },
    ],
    guests: [{ guestId: "guest2", name: "Bea", role: "developer", memberId: "dev-3" }],
    ...over,
  });
  const welcome = { type: "welcome" } as unknown as ServerMsg;
  const setup = () => {
    const book = new OutfitBook();
    book.apply(wardrobeMsg());
    book.apply(
      outfitsMsg({ hat: "crown" }, [
        { project: "alpha", member: "dev-2", outfit: { hat: "flat_cap" } },
        { project: "alpha", member: "dev-3", outfit: { top: "waistcoat" } },
        { project: "alpha", member: "qa", outfit: { accessory: "carnation" } },
      ]),
    );
    const people = new FloorPeople();
    people.apply(welcome);
    return { book, people };
  };

  it("dresses the user from the user's outfit, on any floor", () => {
    const { book, people } = setup();
    expect(outfitOfAvatar(book, people, "project:alpha", 1)).toEqual({ hat: "crown" });
    expect(outfitOfAvatar(book, people, "lobby", 1)).toEqual({ hat: "crown" });
    expect(outfitOfAvatar(book, people, null, 1)).toEqual({ hat: "crown" });
  });

  it("dresses a desk ghost and a standing member by the member who is there", () => {
    const { book, people } = setup();
    people.apply(teamView());
    expect(outfitOfAvatar(book, people, "project:alpha", "developer")).toEqual({ hat: "flat_cap" });
    expect(outfitOfAvatar(book, people, "project:alpha", "qa")).toEqual({ accessory: "carnation" });
    expect(outfitOfAvatar(book, people, "project:alpha", "architect")).toEqual({});
    expect(outfitOfAvatar(book, people, "project:alpha", "guest2")).toEqual({ top: "waistcoat" });
  });

  it("gives a desk nobody was hired for to the default member, named like the role", () => {
    const { book, people } = setup();
    expect(outfitOfAvatar(book, people, "project:alpha", "qa")).toEqual({ accessory: "carnation" });
    expect(outfitOfAvatar(book, people, "project:alpha", "developer")).toEqual({});
  });

  it("dresses nobody in the lobby or the HR office, and never the Builder or an empty spot", () => {
    const { book, people } = setup();
    people.apply(teamView());
    expect(outfitOfAvatar(book, people, "lobby", "developer")).toBeUndefined();
    expect(outfitOfAvatar(book, people, "hr", "qa")).toBeUndefined();
    expect(outfitOfAvatar(book, people, "project:alpha", "builder")).toBeUndefined();
    expect(outfitOfAvatar(book, people, "project:alpha", "guest5")).toBeUndefined();
    for (const g of GUEST_IDS) expect(outfitOfAvatar(book, people, "lobby", g)).toBeUndefined();
  });

  it("follows the next team view: the same spot with somebody else wears what that member wears", () => {
    const { book, people } = setup();
    people.apply(teamView());
    people.apply(teamView({ guests: [{ guestId: "guest2", name: "Cy", role: "developer", memberId: "cy" }] }));
    expect(outfitOfAvatar(book, people, "project:alpha", "guest2")).toEqual({});
  });
});

describe("the recorded demo", () => {
  it("never carries a wardrobe or outfits, so everybody keeps the default look", () => {
    const room = (name: string) => validateRoom(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", name), "utf8")));
    const rooms: ReplayRooms = { lobby: room("lobby.json"), hr: room("hr.json"), template: room("project-template.json") };
    const exp = RunExportSchema.parse(JSON.parse(readFileSync(join(here, "..", "public", "demo", "run-001.json"), "utf8")));
    let t = 1_000_000;
    const transport = new ReplayTransport(exp, rooms, { now: () => t, startTicker: () => () => {}, autoBegin: false });
    const book = new OutfitBook();
    const people = new FloorPeople();
    let seen = 0;
    transport.onMessage((m) => {
      seen++;
      book.apply(m);
      people.apply(m);
    });
    transport.begin();
    transport.send({ type: "use", itemId: "computer_desk_1" });
    for (let i = 0; i < 400; i++) {
      t += 50;
      transport.tick();
    }
    expect(seen).toBeGreaterThan(5);
    expect(book.available).toBe(false);
    expect(book.forUser()).toEqual({});
    for (const id of ["architect", "developer", "qa", 1] as const) {
      const outfit = outfitOfAvatar(book, people, "project:haunted-todo", id);
      expect(book.look(outfit ?? {})).toBeUndefined();
    }
  });
});

describe("the look previews", () => {
  it("draw the figure in its role tint wearing the look, and read it back once per look", () => {
    const asked: string[] = [];
    let extracted = 0;
    const sprites = {
      avatar: (role: string, view: number, frame: number, pose: unknown, look: unknown) => {
        asked.push(`${role}:${view}:${frame}:${String(pose)}:${lookKey(look as never)}`);
        return { texture: { name: lookKey(look as never) }, anchor: { x: 0, y: 0 } };
      },
    };
    const renderer = {
      extract: {
        canvas: (t: { name: string }) => {
          extracted++;
          return { toDataURL: () => `data:image/png;${t.name}` };
        },
      },
    };
    const preview = createLookPreviews(sprites as never, renderer as never);
    const look = lookOf([part("flat_cap")]);
    expect(preview("developer", look)).toBe("data:image/png;flat_cap||");
    expect(preview("developer", look)).toBe("data:image/png;flat_cap||");
    expect(preview("user", look)).toBe("data:image/png;flat_cap||");
    expect(preview("user", undefined)).toBe("data:image/png;");
    expect(asked).toEqual(["developer:3:0:undefined:flat_cap||", "user:3:0:undefined:flat_cap||", "user:3:0:undefined:"]);
    expect(extracted).toBe(3);
  });
});

// ---- the pickers ----

interface Worn {
  who: WearWho;
  slot: OutfitSlot;
  partId: string | null;
}
function pickerFixture(opts: { owned?: string[]; outfit?: Record<string, string>; error?: string | null; wardrobe?: boolean } = {}) {
  const book = new OutfitBook();
  if (opts.wardrobe !== false) book.apply(wardrobeMsg(opts.owned ?? ["flat_cap", "beanie", "waistcoat", "carnation"]));
  book.apply(outfitsMsg({}, [{ project: "alpha", member: "developer", outfit: opts.outfit ?? {} }]));
  const sent: Worn[] = [];
  const previews: string[] = [];
  const picker = createLookPicker(fakeDoc(), {
    book,
    wear: (who, slot, partId) => sent.push({ who, slot, partId }),
    preview: (role, look) => (previews.push(`${role}:${lookKey(look)}`), `data:image/png;${role}`),
    error: () => opts.error ?? null,
  });
  return { book, sent, previews, picker };
}
const select = (root: unknown, slot: string): FakeElement => findAll(root, (e) => e.tagName === "select" && e.dataset["slot"] === slot)[0]!;
const optionTexts = (sel: FakeElement) => sel.children.map((c) => textOf(c));
const dev = { who: { project: "alpha", member: "developer" } as WearWho, name: "Developer", role: "developer" as const };

describe("the Look picker", () => {
  it("offers None and the owned parts of each slot, and nothing the user does not own", () => {
    const { picker } = pickerFixture();
    const root = picker(dev);
    expect(optionTexts(select(root, "hat"))).toEqual(["None", part("flat_cap").name, part("beanie").name]);
    expect(optionTexts(select(root, "top"))).toEqual(["None", part("waistcoat").name]);
    expect(optionTexts(select(root, "accessory"))).toEqual(["None", part("carnation").name]);
    expect(textOf(root)).not.toContain(part("crown").name);
    expect(findAll(root, (e) => e.dataset["section"] === "look")).toHaveLength(1);
  });

  it("selects what the person wears and names each picker for the person", () => {
    const { picker, previews } = pickerFixture({ outfit: { hat: "flat_cap", accessory: "carnation" } });
    const root = picker(dev);
    expect(select(root, "hat").value).toBe("flat_cap");
    expect(select(root, "top").value).toBe("");
    expect(select(root, "accessory").value).toBe("carnation");
    expect(select(root, "hat").getAttribute("aria-label")).toBe("Hat for Developer");
    expect(select(root, "top").getAttribute("aria-label")).toBe("Top for Developer");
    // The preview shows the figure in its own tint with what it wears.
    expect(previews).toEqual(["developer:flat_cap||carnation"]);
    expect(findAll(root, (e) => e.tagName === "img")[0]?.getAttribute("src")).toBe("data:image/png;developer");
  });

  it("sends the person, the slot and the part when a picker changes, and null for None", () => {
    const { picker, sent } = pickerFixture({ outfit: { hat: "flat_cap" } });
    const root = picker(dev);
    const hat = select(root, "hat");
    hat.value = "beanie";
    hat.fire("change");
    hat.value = "";
    hat.fire("change");
    const top = select(root, "top");
    top.value = "waistcoat";
    top.fire("change");
    expect(sent).toEqual([
      { who: { project: "alpha", member: "developer" }, slot: "hat", partId: "beanie" },
      { who: { project: "alpha", member: "developer" }, slot: "hat", partId: null },
      { who: { project: "alpha", member: "developer" }, slot: "top", partId: "waistcoat" },
    ]);
  });

  it("keeps a worn part in the list even when it is not owned, so the picker never lies", () => {
    const { picker } = pickerFixture({ owned: [], outfit: { hat: "crown" } });
    const root = picker(dev);
    expect(optionTexts(select(root, "hat"))).toEqual(["None", part("crown").name]);
    expect(select(root, "hat").value).toBe("crown");
    expect(pickerParts(shipped, [], "hat", undefined)).toEqual([]);
  });

  it("says where to get parts when the wardrobe is empty, and says so when outfits are off", () => {
    expect(textOf(pickerFixture({ owned: [] }).picker(dev))).toContain("You own no outfit parts yet. Buy some at the shop counter in the lobby.");
    const off = pickerFixture({ wardrobe: false }).picker(dev);
    expect(textOf(off)).toContain("Outfits are off: they need the real engine.");
    expect(findAll(off, (e) => e.tagName === "select")).toEqual([]);
  });

  it("shows why a change was refused", () => {
    const root = pickerFixture({ error: "The Checked flat cap is a hat, not a top." }).picker(dev);
    const alert = findAll(root, (e) => e.getAttribute("role") === "alert");
    expect(alert).toHaveLength(1);
    expect(textOf(alert[0])).toBe("The Checked flat cap is a hat, not a top.");
  });

  it("dresses the user from the user's outfit", () => {
    const { book, picker, sent } = pickerFixture();
    book.apply(outfitsMsg({ top: "waistcoat" }));
    const root = picker({ who: "user", name: "you", role: "user" });
    expect(select(root, "top").value).toBe("waistcoat");
    const hat = select(root, "hat");
    hat.value = "flat_cap";
    hat.fire("change");
    expect(sent).toEqual([{ who: "user", slot: "hat", partId: "flat_cap" }]);
    expect(OUTFIT_SLOTS).toHaveLength(3);
  });
});

describe("the Look section of the HR card and the Profile panel", () => {
  const noop = () => undefined;
  const actions = { hire: noop, rename: noop, setModel: noop, fire: noop, importFrom: noop, approve: noop, reject: noop, suggest: noop, apply: noop };
  const members: TeamMember[] = [
    { id: "architect", displayName: "Architect", templateId: "architect", role: "architect", model: "auto" },
    { id: "developer", displayName: "Developer", templateId: "developer", role: "developer", model: "auto" },
  ];
  const hr: HrState = {
    catalogue: [],
    teams: [{ projectId: "alpha", name: "ALPHA", customised: false, members }],
    imports: [],
    sources: [],
    models: {},
  };

  it("puts a Look section on each member card for that member of that project", () => {
    const targets: string[] = [];
    const panel = createHrPanel(fakeDoc(), actions, undefined, undefined, (t) => {
      targets.push(`${typeof t.who === "string" ? t.who : `${t.who.project}/${t.who.member}`}:${t.name}:${t.role}`);
      const e = fakeDoc().createElement("div");
      e.dataset["section"] = "look";
      return e;
    });
    const content = panel({ hr, error: null, suggestion: null, busy: null }, noop);
    expect(targets).toEqual(["alpha/architect:Architect:architect", "alpha/developer:Developer:developer"]);
    const cards = findAll(content.body, (e) => e.className.includes("al-hr-member"));
    for (const card of cards) expect(findAll(card, (e) => e.dataset["section"] === "look")).toHaveLength(1);
    expect(standing(members).get("developer")).toBe("desk");
  });

  it("has no Look section when the panel is not given a picker", () => {
    const panel = createHrPanel(fakeDoc(), actions);
    const content = panel({ hr, error: null, suggestion: null, busy: null }, noop);
    expect(findAll(content.body, (e) => e.dataset["section"] === "look")).toEqual([]);
  });

  const progress = { user: { level: 1, xp: 60, next: 150, jobs: 0, passed: 0, steps: 0, avgStepMs: 0, passRate: 0, badges: [] }, members: [], badgeDefs: [], quests: { day: "", items: [] } } as unknown as ProgressView;
  const profileWith = (view: { progress: ProgressView | null; lookAvailable?: boolean }) => {
    const panel = createProfilePanel(fakeDoc(), (t) => {
      const e = fakeDoc().createElement("div");
      e.dataset["section"] = "look";
      e.dataset["who"] = t.who === "user" ? "user" : "member";
      return e;
    });
    let content = panel(view, () => (content = panel(view, noop)));
    return { content: () => content, tab: (name: string) => findAll(content.body, (e) => e.dataset["tab"] === name)[0] };
  };

  it("adds a Look tab for the user's own figure when the hotel has a wardrobe", () => {
    const p = profileWith({ progress, lookAvailable: true });
    expect(findAll(p.content().body, (e) => e.dataset["tab"] !== undefined).map((e) => e.dataset["tab"])).toEqual(["badges", "quests", "look"]);
    expect(findAll(p.content().body, (e) => e.dataset["section"] === "look")).toEqual([]);
    p.tab("look")!.click();
    expect(findAll(p.content().body, (e) => e.dataset["who"] === "user")).toHaveLength(1);
    expect(p.tab("look")!.disabled).toBe(true);
  });

  it("has no Look tab without a wardrobe, and still shows the badges", () => {
    const p = profileWith({ progress, lookAvailable: false });
    expect(findAll(p.content().body, (e) => e.dataset["tab"] !== undefined).map((e) => e.dataset["tab"])).toEqual(["badges", "quests"]);
  });

  it("works before there is any progress", () => {
    const p = profileWith({ progress: null, lookAvailable: true });
    expect(findAll(p.content().body, (e) => e.dataset["tab"] !== undefined).map((e) => e.dataset["tab"])).toEqual(["look"]);
    expect(findAll(p.content().body, (e) => e.dataset["who"] === "user")).toHaveLength(1);
    expect(textOf(profileWith({ progress: null }).content().body)).toContain("No progress yet");
  });
});

describe("panel state of the outfits", () => {
  const w = (): WardrobeState => ({ balance: 5, parts: shipped, owned: [], badges: [] });

  it("re-renders the HR desk and the Profile when the outfits or the wardrobe change, and no other panel", () => {
    const s = new PanelState();
    expect(s.apply(outfitsMsg())).toBe(false);
    s.apply({ type: "open_panel", panel: "hr" });
    expect(s.apply(outfitsMsg())).toBe(true);
    expect(s.apply({ type: "wardrobe", state: w() })).toBe(true);
    s.apply({ type: "open_panel", panel: "profile" });
    expect(s.apply(outfitsMsg())).toBe(true);
    s.apply({ type: "open_panel", panel: "mailbox" });
    expect(s.apply(outfitsMsg())).toBe(false);
  });

  it("keeps the refusal of a change until the next outfits, and clears it when the HR desk or the Profile opens", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "hr" });
    expect(s.apply({ type: "error", code: "outfit_error", message: "That outfit is not in the shop." })).toBe(true);
    expect(s.lookError).toBe("That outfit is not in the shop.");
    expect(s.hrError).toBeNull();
    s.apply(outfitsMsg());
    expect(s.lookError).toBeNull();
    s.apply({ type: "error", code: "outfit_error", message: "no" });
    s.apply({ type: "open_panel", panel: "profile" });
    expect(s.lookError).toBeNull();
    s.apply({ type: "open_panel", panel: "shop" });
    expect(s.apply({ type: "error", code: "outfit_error", message: "no" })).toBe(false);
  });
});
