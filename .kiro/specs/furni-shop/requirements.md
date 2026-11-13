# Requirements Document

## Introduction
The game layer, part 1 (housing). The user decorates the project floors with furniture bought with a currency of the hotel, **Ecto**, that is earned only by real, verified work of the agents. Decoration never changes what agents do, their permissions or their results.

Asked by the user on 2026-11-13 ("housing like in classic hotel sims, a bit of RPG, fun while you wait for the agents"). Depends on furni-move (arrange mode and saved layouts). Own names, own art drawn in code like today's furniture, nothing from Habbo (security steering). All user-facing text in English.

## Requirements

### Requirement 1: Ecto, earned from real work
#### Acceptance Criteria
1. THE world-server SHALL keep one Ecto balance per user in `data/wallet.json` (git-ignored, atomic write, an unreadable file is moved aside and never overwritten) and a ledger of the last 200 entries (amount, reason, task id, time).
2. Ecto SHALL be granted only from engine events the gateway already receives, once per task (idempotent by task id and reason): a delivered job with verdict pass, a branch delivered to the user's repository, a branch review finished, a memory note accepted, a morning summary with at least one finished night job. The amounts live in `config/economy.json`.
3. No client message SHALL add Ecto; a client can only spend it. A grant whose event was already counted (gateway replay after a restart) adds nothing.
4. THE balance SHALL always be visible, in a chip in the top left corner of the stage (not in the top bar: with the chip in the bar the job stepper lost its labels at 1366 px and overflowed at 800 px, 6 existing Playwright tests failed; the same reason that put the Arrange button on the stage). A grant shows a short toast ("+20 Ecto: branch delivered").

### Requirement 2: Shop and catalogue
#### Acceptance Criteria
1. THE lobby SHALL get a shop counter (furniture `shop_counter`) that opens the Shop panel: catalogue pages (Seating, Tables, Lights, Plants, Spooky, Walls), each item with its price, size and a preview drawn with the same renderer as the room.
2. At least 24 catalogue items SHALL exist in `config/catalogue-furni.json`, each mapped to a furniture definition in `FURNI_CATALOG` with own art; decorative only (no interaction that starts work).
3. Buying SHALL be a client message the server checks (known item, enough Ecto, inventory below 200 items); a refused purchase says why and changes nothing.

### Requirement 3: Inventory and placing
#### Acceptance Criteria
1. Bought items SHALL go to the user's inventory (`data/inventory.json`, same file rules). In arrange mode (furni-move) an Inventory tray lists them; dragging one onto a project floor places it with the same server checks as a move; picking up a placed bought item returns it to the inventory.
2. Template furniture (desks, computer, mailbox, board, review desk, test lab, library shelf, elevator) SHALL not be sold, picked up or removed.
3. Removing a project SHALL return its placed bought items to the inventory.

### Requirement 4: Tests
#### Acceptance Criteria
1. Property test: any sequence of events and purchases never makes the balance negative, and replaying the same events never changes it.
2. world-server tests: each grant reason, refused purchases, place and pick up, removed project returns items, files survive a restart.
3. Playwright: buy an item in the shop, place it on a floor in arrange mode, reload, it is still there.
