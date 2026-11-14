# Design Document: ghost-skins

Same split as furni-shop. Pure rules and schemas live in `@agentlife/shared` (`outfits.ts`). The world-server owns the files (`Economy`, the same class that owns the wallet and the inventory) and decides who gets what. The client draws the parts and shows the pages. The agent-engine does not change: an outfit is never seen by a model, a permission or a job. Task 1 is described first (parts, drawing, wardrobe, shop); task 2 (wearing) is at the end and is only outlined until it is built.

## Vocabulary
- **Part**: one piece of clothing, `config/outfits.json`. It has a **slot**: `hat`, `top` or `accessory`.
- **Outfit**: at most one part per slot (`{ hat?, top?, accessory? }`, part ids). Task 2.
- **Wardrobe**: the part ids the user owns (`data/wardrobe.json`). A part is owned once and can be worn by any number of ghosts at the same time. It is not a stock: wearing does not use it up.
- **Look**: an outfit with the parts resolved to their palettes. This is what the renderer draws.

## Slots and the set of the first picture
Three slots, so a ghost wears at most three things. The picture that started this spec has four (cap, waistcoat, neckerchief, carnation): the cap is a hat, the waistcoat a top, and the neckerchief and the carnation are both accessories, so a ghost wears one of them, not both. Decided to keep three slots (the requirements fix them); a fourth slot (`neck`) is a small change later if the user wants the full set at once.

## Parts (`packages/world-server/config/outfits.json`)
```json
{ "version": 1, "parts": [ { "id": "flat_cap", "name": "Checked flat cap", "slot": "hat", "price": 40,
  "palette": { "main": "#4a4458", "shade": "#2c2838", "light": "#d8d0e8", "accent": "#8a7fb0" } } ] }
```
- `id`: `^[a-z][a-z0-9_]{0,39}$`, unique. `name`: 1 to 30 characters. `slot`: `hat | top | accessory`.
- Exactly one of `price` (whole number 1..10 000, bought with Ecto) or `badge` (a badge id from `badges.json`: free, unlocked when the badge is earned, never for sale).
- `palette`: four colours as `#rrggbb`, always the same four names: `main` (the body of the piece), `shade` (its dark side and outlines), `light` (highlights, the second colour of a pattern) and `accent` (small details: buttons, stems, flames). The recipe decides where each goes; the file only chooses the colours, so a part can be recoloured without code.
- 23 parts: 8 hats, 7 tops, 8 accessories. Four are badge parts (crown: Hotel veteran, halo: Ten passes, lab coat: Review regular, delivery ribbon: Ten deliveries). The set of the requirements is all there: flat cap (checked), waistcoat, neckerchief, carnation, pumpkin hat, witch hat, bat bow tie, candle.
- `checkOutfits(parts, badgeIds)` (shared) refuses: fewer than 20 parts, a slot with no part, a duplicate id, a badge rule that names no real badge, a part with a price and a badge or with neither, and a required id that is missing. The world-server calls it at start with the ids of `badges.json` and exits with the message when the file is wrong, as for the catalogue.
- Prices: hats 25..55, tops 30..70, accessories 15..40 (a pass pays 15 Ecto, so the cheapest piece is one job).

## Drawing (`client/src/scene/outfit.ts`, `outfit-parts.ts`)
Every part is drawn by a recipe in code, with the same `Graphics` calls the ghost uses (rects, ellipses, polygons, 1 to 2 px lines, no image file). A recipe is keyed by the part id, like furniture recipes by definition. A client test checks that every part of the shipped file has a recipe. The shapes are made for this hotel's ghost; nothing is traced from the picture the user showed or from any other game.

### Anchors
`drawGhost` knows where everything is (it computes `hx`, `top`, `hem`, `half`, the eye offsets and the lift of the pose). It passes them to the part code as `PartAnchors`, so the parts follow the ghost whatever it does:

| Anchor | Meaning | Value for a ghost |
|---|---|---|
| `view` | one of the five drawn views | 3, 4, 5, 6, 7 |
| `hx`, `hy` | centre of the head dome | `shift`, `-36 - lift` |
| `hr` | radius of the head dome | `half` (9.5 to 11) |
| `bw` | half width of the body | `half` |
| `chest` | first row of the body below the face | `hy + 10` |
| `hem` | where the scallops start | `hy + 19` |
| `eyes` | x offsets of the eyes from `hx` | the view's list |

`lift` is the float bob (0 or 3), the cheer hop (4 or 8) and the glum sink (-2), so a ghost that floats, cheers or looks glum keeps its parts in place: they are drawn from `hy`, never from a fixed y. A ghost never sits, so there is no seat to follow (a user figure that sits is task 2).

### Directions
A ghost has five drawn views and three mirrors (`viewFor` in `figure.ts`), which cover the eight facings, so a part is drawn in all five: front (3), front turned (4), side (5), back turned (6) and back (7). The mirrored three come for free. Recipes use two derived facts: `front` (views 3, 4, 5: the face shows) and `lean` (-1 when the figure looks to screen-left: views 4, 5, 6; 0 for 3 and 7). Rules every recipe follows:
- Front pieces (carnation, bow tie, glasses, the knot of a neckerchief, a pumpkin face) are drawn only when `front` is true. From behind a part shows what it has there: the back of a cap without a peak, the band of the scarf, the seam of a waistcoat, the hood of a hoodie.
- The peak of a cap and the like point to `lean`; in view 3 they show as a short strip under the crown.
- Held pieces (candle, lantern) hang at the figure's right edge in every view.

### Depth order
Inside one ghost sprite, in this order: shadow, body and hem (unchanged), the **top** (over the body, under the face), the eyes and mouth (unchanged), the **hat** (over the head), the **accessory** (in front of everything but the pose sparks), then the pose sparks. Parts are only added: the drawing of a bare ghost is a subsequence of the drawing of a dressed one (tested), so the body tint, the face and the poses are the ones they always were.

### What a part may and may not cover (requirement 1.3)
- The role tint stays readable: a top covers the body from `chest` to `hem` and from 1 px inside each edge, so a rim of the role colour shows on both sides, and the dome above and the scallops below keep the tint. A cape is the one top that goes out to the edge. A hat covers the head dome only above the eyes (its lowest pixel is at `hy - 1.5`; glasses are an accessory and are the only piece that sits on the eyes). Nothing goes more than 7 px above the dome, so a hat does not run into the name tag.
- The name tag, its role colour and the mood face are DOM and overlay objects that do not take part in the sprite. They do not change.

### Frame, sizes and cache
- `AVATAR_FRAME` grows from `-16,-56,32×60` to `-20,-72,40×76`: the old frame ended 1.5 px above a cheering ghost's head, and a hat needs up to 7 px more; the sides gain room for the candle and the lantern. Only `textures.ts` and a test read it. The feet stay on the sprite's origin (the anchor is computed from the frame), so nothing moves on screen.
- Sprites are baked once at 1× with nearest-neighbour scaling, and the stage scales them to 2×: a part drawn once is right at both sizes. Recipes use whole-pixel positions and sizes (some half pixels at the dome, as the ghost does).
- `SpriteProvider.avatar(role, view, frame, pose?, look?)` takes an optional `OutfitLook`. The cache key adds the part ids: `a:<role>:<view>:<frame>:<pose>:o=<hat>|<top>|<accessory>`. Without a look the key and the drawing are what they were.
- A part that has no recipe (an id from a newer server) is skipped, never an error.

### The user's own figure
It is a person, not a ghost: its head and torso have other anchors (`guestAnchors`, built in task 2 together with the Profile picker). The recipes already take anchors, so no part is redrawn.

## Wardrobe (`data/wardrobe.json`)
`AGENTLIFE_WARDROBE_FILE` overrides the path (tests, Playwright).
```json
{ "version": 1, "owned": ["flat_cap", "crown"] }
```
- A set of part ids, at most 200, no duplicates, written in the order they were got. Same file rules as the wallet and the inventory (`json-file.ts`): a temporary file then a rename; a file that cannot be read or fails the schema is renamed `wardrobe.json.bad-<time>` and the wardrobe starts empty (parts that were bought are then lost to the user; the file is kept aside to be put back). A part id that is no longer in the catalogue stays in the file and is ignored.
- `Economy` owns it, because buying touches the wallet and the wardrobe in one step. It is on only when `Economy` is given the parts (`outfits`) and a file: tests that build an `Economy` as before get no wardrobe and no `wardrobe` message, and never touch `data/`. `main.ts` passes both.

## Getting parts (requirement 2)
Pure rules in `shared/outfits.ts`:

`applyOutfitPurchase(wallet, owned, part, ts)` checks in this order; the first that fails answers and changes nothing:

| Code | Rule | Text |
|---|---|---|
| `unknown_part` | the id is not in the file | "That outfit is not in the shop." |
| `badge_only` | the part has a badge rule | "This one cannot be bought: earn the Hotel veteran badge." |
| `already_owned` | the id is in the wardrobe | "You already own the Checked flat cap." |
| `not_enough_ecto` | balance below the price | "You need 40 Ecto and have 12." |

Then the balance goes down by the price, a ledger entry is added (`reason: purchase`, `ref: outfit:<id>`) and the id is added to the wardrobe. The wardrobe file is written first and the wallet second, like a furniture purchase (a crash between them gives a part for free, never an empty wallet for nothing); a failed second write puts the first back and answers "Could not save your purchase." Buying works only in the lobby (the counter is there), reading the wardrobe on every floor (task 2 needs it for the pickers).

**Badge unlock** (`unlockedBy(parts, owned, badgeIds)`, pure): the parts whose `badge` is in `badgeIds` and that are not owned. The gateway calls it
1. when a badge is earned (`recordFact` knows the earned badges of the user and of the members), and
2. at every `welcome`, with the badges the progress view shows for the user and for all members, so a badge earned before the wardrobe existed, or while the world-server could not write the file, still unlocks.

A badge of the user or of any team member unlocks the part (requirement 2.2). The parts are added in one write; on a write failure nothing is added and the next welcome tries again. Each newly unlocked part sends `part_unlocked` (toast: "Unlocked: Crown (hat), from the Hotel veteran badge"). A part that is already owned is never announced twice.

## Messages (`shared/src/protocol.ts`)
- Client to server: `wardrobe_state {}` and `outfit_buy { partId }` (same id pattern).
- Server to client:
  - `wardrobe { state }`: `{ balance, parts, owned, badges }` where `parts` is the whole file, `owned` the ids and `badges` the `{ id, name }` of the badges that parts name (so the client can say "Earn the Hotel veteran badge" without the progress view). Sent after every `welcome` (after `wallet`), after a purchase, after an unlock and on `wardrobe_state`. The client keeps the parts: it needs their palettes to draw a ghost.
  - `part_unlocked { partId, name, slot, badge }`.
- A refusal is `error` `shop_error` with the text of the table. Without a wardrobe (no economy, or no outfits) nothing is sent and `outfit_buy` answers `shop_error` "The shop is closed: it needs the real engine.".
- The recorded demo has no `wardrobe` message: no parts, default look, and the Outfits page says the shop is off.

## Client
- `scene/outfit.ts`: `OutfitLook`, `lookOf(parts)`, `lookKey(look)` (the cache signature), `drawLook(g, look, anchors, stage)`. `scene/outfit-parts.ts`: the recipes. `figure.ts` calls `drawLook` at the three points of the depth order; it gets `look` as one more argument of `drawAvatar`, and `ProceduralSprites.avatar` passes it.
- `scene/previews.ts`: `createOutfitPreviews(sprites, renderer)(part)` draws the part on a neutral ghost (role `builder`, pale lilac, view 3, frame 0, no pose) and reads it back to a PNG data URL, as for furniture. Nothing else draws an outfit.
- `ui/shop.ts`: an **Outfits** tab after the furniture pages. Cards in three groups (Hats, Tops, Accessories): preview, name, price or the badge rule, and one of Buy, Owned, or "Locked: earn the <badge> badge". A Buy button of a part the user cannot afford is disabled with the missing amount in its title, as for furniture. The open tab survives re-renders. In the recorded demo the panel says the shop is off.
- `PanelState` keeps `wardrobe`; `wardrobe` and `wallet` update it; `part_unlocked` shows a toast (main.ts).

## Tests (task 1)
- shared (`outfits.test.ts`): schema (palette, price xor badge, names), `checkOutfits` (the shipped file passes; each refusal), the purchase table, a fast-check property (any sequence of purchases and unlocks keeps `0 <= balance`, no duplicate owned id, and a purchase never adds a badge part), `unlockedBy`, the messages.
- world-server: `Economy` wardrobe (buy, refusals, write failure, restart, a bad file moved aside, unlock once, unlock failure retried, off without `outfits`); gateway (`wardrobe` after welcome, buy and refusal, badge-only part refused, unlock at welcome and on a badge earned by a member, `part_unlocked` once).
- client (`outfits.test.ts`): every part of the shipped file has a recipe; every recipe draws in the five views, at several lifts (-2, 0, 3, 4, 8) and in the cheer and glum poses, with every point inside `AVATAR_FRAME`; a hat stays above `hy - 1.5` and within 7 px of the dome; a top stays inside the body; a bare ghost's calls are a subsequence of the dressed ghost's; the cache key; the card render and the Buy message; the preview helper.
- Playwright for the whole flow is task 2.

## Task 2: wearing (outline)
`data/outfits.json` (`{ version: 1, members: { "<project>/<member>": { hat?, top?, accessory? } }, user: {...} }`); client message `outfit_wear { who: "user" | { project, member }, slot, partId | null }` checked by the server (known member, part owned, right slot); `room`/`welcome` carry each person's outfit and a live `outfit` message follows a change; `AvatarView.setLook`; the HR card's Look section and the Profile picker; `guestAnchors`. Written in detail when task 2 starts.
