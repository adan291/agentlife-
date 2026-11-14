# Requirements Document

## Introduction
The game layer, part 4. Each ghost (the desk agents, the members standing on the floor, the HR ghost, the Builder) and the user's avatar can wear an outfit made of parts: a hat, a top and an accessory. Outfits are bought with Ecto in the lobby shop or unlocked by badges, and put on at the HR desk (team members) or in the Profile panel (the user). They change the look only: never a model, a permission or a job.

Asked by the user on 2026-11-14 with an example picture (a ghost with a houndstooth flat cap, a dark waistcoat, a white neckerchief and a red carnation). The picture is inspiration only: every part is drawn in code in the hotel's own pixel style, like the furniture, and nothing is traced from that picture or from any other game (security steering: own art, CC0 or MIT only). Depends on furni-shop (Ecto, shop, inventory), team-progress (badges) and hr-desk (members). All user-facing text in English.

## Requirements

### Requirement 1: Outfit parts drawn in code
#### Acceptance Criteria
1. At least 20 parts SHALL exist in `config/outfits.json`: slots `hat`, `top` and `accessory`, each part with an id, a name, a slot, a price in Ecto or a badge that unlocks it, and a palette. Among them the set the user asked for: flat cap (checked), waistcoat, neckerchief, carnation; and Kiroween ones (pumpkin hat, witch hat, bat bow tie, candle).
2. Each part SHALL be drawn by the client's renderer on top of the ghost body for the four facing directions, at 1× and 2×, following the existing depth order (hat over the head, top over the body, accessory in front); a ghost that sits, waves or floats keeps its parts in place.
3. Parts SHALL keep the role colour readable: the ghost body keeps its role tint, and the name tag and the role colour on the tag do not change.

### Requirement 2: Getting parts
#### Acceptance Criteria
1. THE lobby shop SHALL get an Outfits page with a preview of the part on a ghost; buying checks the price and the balance on the server, as for furniture, and puts the part in the user's wardrobe (`data/wardrobe.json`, same file rules as the inventory).
2. A part with a badge rule SHALL unlock when the badge is granted to the user or to any member of a team (team-progress), with a toast; it is free and cannot be bought.
3. A part bought once SHALL be wearable by any number of ghosts at the same time (a wardrobe, not single items).

### Requirement 3: Wearing parts
#### Acceptance Criteria
1. THE HR panel's member card SHALL get a Look section: one picker per slot (none or a part from the wardrobe), with a preview; the choice is a client message that the server checks (known member, part in the wardrobe, right slot) and stores per member in `data/outfits.json`.
2. THE Profile panel SHALL let the user dress their own avatar the same way.
3. Every client on the floor SHALL see the change at once; a reload, a restart of the world-server and a move to another floor keep it. A fired member's outfit is dropped; the wardrobe keeps the parts.
4. The recorded demo SHALL show the default look (no outfits) until final-demo re-records it.

### Requirement 4: Tests
#### Acceptance Criteria
1. shared: schema and catalogue checks (20+ parts, every slot used, every badge rule names a real badge, ids unique).
2. world-server: buy, refused buy, badge unlock once, wear, refused wear (not owned, wrong slot, unknown member), outfit survives a restart, fired member drops it.
3. client: every part draws in the four directions without errors; the pickers send the right message.
4. Playwright: buy the flat cap in the shop, put it on the Developer at the HR desk, go to the project floor, the Developer wears it after a reload.
