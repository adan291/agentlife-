# Design Document: team-progress

Pure rules live in `@agentlife/shared` (`progress.ts`). The world-server owns the file and decides what counts (`progress-store.ts`, `progress-tracker.ts`, gateway). The client only shows. The agent-engine does not change. Task 1 (XP, levels, stats) is described first; task 2 (badges, daily quests, Profile panel) is at the end. Everything reuses the furni-shop code for "count an event once": the keyed idempotence of `applyGrant`, `GrantTracker`, `json-file.ts` and the wallet itself.

## Vocabulary
- **Fact**: something verified that happened, with a **source**, a **ref** (what it happened to) and a time. The pair is its **key**, `<source>:<ref>`, exactly like a grant. A fact can pay XP to the user, to team members, or to both, and moves counters.
- **Entity**: the user, or one team member. It has XP, counters, the time spent in steps, a streak and its badges.
- **Member key**: `<projectId>/<memberId>`. The default team already has real ids (`architect`, `developer`, `qa-1`...), and the room labels them the same way. The role name is used as the id only when the team cannot be read (the engine is down, or the scripted engine has no HR office), so a fact is never lost for lack of a name.

## Facts (requirement 1.1)
`ProgressTracker` (world-server) follows the engine's events and says which facts they make. It owns no task facts of its own for deliveries: it asks the `GrantTracker` of furni-shop (`facts(taskId)`: kind, verdict seen at `report_ready`, failed) so that "a job that passed" means the same thing for Ecto and for XP. Its own memory is the repository of each task, the roles that finished a step in it, the start of each step (from `agent.work.startedAt`) and the kind of each approval, for the latest 500 tasks.

| Source | Event | Ref | Pays |
|---|---|---|---|
| `step_done` | `agent.state_changed` to `done` of a project role (`architect`, `developer`, `qa`) | `<taskId>.<role>` | the member of that role |
| `job_passed` | `task.state_changed` to `delivered`, kind is not `review-branch`, never failed, verdict pass | task id | the members who finished a step of the job, and the user |
| `review_passed` | the same for `review-branch` | task id | same |
| `job_not_passed` | `delivered` with the job failed or the verdict not pass, or a review whose verdict is not pass | task id | nobody (a stat) |
| `review_finished` | `delivered` of a `review-branch` that never failed, whatever it found | task id | nobody (a counter, task 2) |
| `plan_approved` | `approval.resolved` with `approve`, for an approval of kind `plan` | approval id | the user |
| `branch_delivered` | `delivery.done` | task id | the user |
| `memory_accepted` | the user accepted a proposal in the Library (gateway) | `sourceTaskId` | counter only |
| `night_summary` | a summary with `counts.done >= 1` (gateway) | night key | counter only |
| `night_scheduled` | the user scheduled a night job (gateway) | `<time>-<n>` | counter only |

- "Never failed" is the rule of `GrantTracker`. A `delivered` of a task whose creation the tracker did not see makes nothing (no guessing). A step of a task whose repository is unknown makes nothing.
- A done step is XP for the member only when the step finished: a developer attempt that is retried counts once (same key).
- Who the member is: when the fact is made the gateway looks at the seats of the project (`seatsNow`, else one read of `engine.hr.team`, not shown in the room). The member who holds the role's desk gets the step. If the team cannot be read, the role name is the member id. A member who is fired keeps the XP in the file and is not shown.
- Replays: after a restart the gateway replays the latest jobs. Every fact has a key, the file remembers the last 4000 (`PROGRESS_KEYS_MAX`; a job makes about seven facts, the replay window is 50 jobs), and an event older than `since` counts for nothing. The member of a replayed step is the one who sits at the desk now. This is accepted: it can only happen for events that arrived while the world-server was off.

## Amounts and levels (`config/progress.json`, requirement 1.1 and 1.2)
```json
{ "version": 1, "xp": { "step_done": { "member": 10 }, "job_passed": { "member": 25, "user": 15 },
  "review_passed": { "member": 20, "user": 10 }, "branch_delivered": { "user": 20 }, "plan_approved": { "user": 5 } } }
```
All five sources are required; `member` and `user` are whole numbers 0 to 1000 and at least one is above 0. Facts that are not in the table (the other sources above) pay no XP.

Level curve (fixed, not in the config): level n needs `50·n·(n+1)/2 = 25·n·(n+1)` XP in total: level 1 at 50, level 2 at 150, level 3 at 300. Below 50 XP the level is 0. `levelOf(xp)` is the largest n whose threshold is at most xp, with a cap of `LEVEL_MAX` (50). XP is capped at `XP_MAX` (the threshold of level 50), so the numbers are bounded. `levelView(xp)` gives `{ xp, level, base, next }` (`next` absent at the cap) and the client derives "35 / 100 XP".

## Stats (requirement 1.3)
Kept per entity from the same facts: counters per source, `stepMs` (sum of the time of the steps that finished, from the step start to the `done` event, only when both are known and the step is between 0 and 24 h), and the streak of passes. The client shows: jobs (`job_passed + review_passed + job_not_passed`), pass rate (`passed / jobs`, hidden below one job), and the average step time (`stepMs / step_done` when a time is known). Nothing else is stored, so a stat cannot disagree with another.

## File (`data/progress.json`)
`AGENTLIFE_PROGRESS_FILE` overrides the path. Same rules as the wallet: temporary file then rename; a file that cannot be read or fails the schema is renamed `progress.json.bad-<time>` and the store starts empty with a new `since`; a write failure is logged, the change is undone in memory and not counted, so the next replay tries again.
```json
{ "version": 1, "since": 1763000000000,
  "user": { "xp": 40, "counts": { "branch_delivered": 1 }, "stepMs": 0, "streak": 2, "badges": { "first_delivery": 1763000100000 } },
  "members": { "haunted-todo/developer": { "xp": 35, "counts": { "step_done": 3, "job_passed": 1 }, "stepMs": 91000, "streak": 1, "badges": {} } },
  "counted": ["step_done:task-1a.developer"],
  "quests": { "day": "2026-11-13", "progress": { "deliver_branch": 1 }, "done": ["deliver_branch"] }, "payouts": [] }
```
`badges`, `quests` and `payouts` are task 2 and have schema defaults, so a file written by task 1 stays valid. At most `MEMBERS_MAX` (300) members; a fact for a 301st member pays the others and leaves that one out.

`applyFact(progress, fact, memberKeys, config)` (shared, pure) adds nothing, and says why, when the key was counted before (`counted`), when the fact is older than `since` (`before_start`) or when the ref is not an identifier (`bad_ref`). Otherwise it records the key, moves the counters, adds the XP and returns the level-ups. The same list of facts applied twice gives the same file as applied once, and XP never goes down (property tests).

## Messages (`shared/src/protocol.ts`)
- Server to client: `progress { state }` with `user` (level view, counters, `stepMs`), `members` (one per member that has a record: project id, member id, level view, counters, `stepMs`; at most 300) and, from task 2, `badges` and `quests`. Sent after every `welcome` and after every fact that changed something. Never sent when the hotel has no progress (fake engine without `AGENTLIFE_PROGRESS_FILE`): then the client shows no level anywhere, and the recorded demo shows none either.
- `level_up { who, name, level, slot? }`: `who` is `user` or `member`. `slot` (a `StaffId`) is present only for a member who stands on the floor the user is on, so the client can play the effect over that ghost. The toast is shown in every case: "Developer reached Lv 3".
- `team_view` members and guests get an optional `memberId` (the member key's second half), so the client can look the seat up.
- No client message changes progress.

## Wiring in the gateway
- The gateway feeds every engine event to `GrantTracker` first (as before, now also when only progress is on), then to `ProgressTracker`, before it looks at rooms: a job on a floor with no room yet still counts.
- `record(fact)`: resolve the member keys, `Progress.record` (applies and saves), then send `progress`, `level_up`, and in task 2 the badge toast and the quest payout.
- Gateway options: `progress?: ProgressStore`. `main.ts` builds it when the engine is the real one, or when `AGENTLIFE_PROGRESS_FILE` is set (tests and Playwright), because the scripted engine's jobs are not real work. It does not follow `AGENTLIFE_WALLET_FILE`: a test that only wants the shop must not write the user's `data/progress.json`.

## Client
- `ui/progress.ts` (pure): `ProgressModel` keeps the latest `progress`, the room, the seats of `team_view` and answers `seatOf(slot)`; `levelText`, `xpText`, `statLines`. All user-facing text is English: "Lv 3", "35 / 100 XP", "4 jobs, 75% passed", "avg step 42s".
- Team bar: under the name of each role row, one line "Lv 3 · 35 / 100 XP". Tooltip of a ghost (desk or floor): level, XP to the next level and the stats. HR card: a line with the level, the XP and the stats.
- The user's level sits in a chip on the stage, to the right of the Ecto chip (both in one corner container; the balance chip moved inside it without changing its class or its text). Task 2 makes it the Profile button.
- Level-up effect (`scene/levelup-fx.ts`): a ring of eight small stars rises over the ghost for 1.6 s and fades, drawn with `Graphics`; with reduced motion it is a still ring that fades. `levelUpFrame(progress, reduced)` is pure and tested. Toast: `hud.toast`.

## Tests (task 1)
- shared: level curve (threshold formula, `levelOf` inverse and monotonic, cap), config schema, `applyFact` (each refusal, XP split, stepMs, streak) and the fast-check properties (monotonic, replay-safe, levels never go down).
- world-server: `ProgressTracker` for each source (a failed job pays nothing, a retried step once, a review that asks for changes, unknown task), `Progress` (XP, restart, broken file aside, write failure undone, `since`), gateway (progress after welcome, level-up with slot, no progress without a store, seat lookup with and without a team).
- client: texts, `ProgressModel`, level-up frames, team bar line, HR card line, panel state.

## Task 2: badges, daily quests, Profile panel

### Badges (`config/badges.json`, requirement 2)
```json
{ "version": 1, "badges": [ { "id": "first_delivery", "name": "First delivery", "description": "...", "scope": "user",
  "rule": { "counter": "branch_delivered", "atLeast": 1 }, "icon": { "shape": "branch", "colour": "#7fd1ae" } } ] }
```
- 18 badges: 10 for the user and 8 for team members (the HR card shows the member's). A badge has one rule: a counter reaches `atLeast` (1 to 100 000). Counters are the sources above plus `late_job` (a `job_passed` made between 00:00 and 04:59 local time: the Night owl), `best_streak` (the longest run of passes in a row; a `job_not_passed` ends the run) and `level` (derived). A user has every source as a counter; a member has the ones that pay members. `checkBadges(defs)` (shared) refuses a duplicate id, a counter a scope cannot have, fewer than 12 badges and an icon shape that is not in `BADGE_SHAPES`.
- `evaluateBadges(entity, scope, defs, ts)` grants each badge once (`badges[id] = ts`), after the counters moved. The gateway sends a toast "Badge earned: First delivery" for the user's, and for a member's "Developer earned: Night owl".
- Icons are drawn in code: `BADGE_SHAPES` (star, moon, book, branch, check, flame, envelope, bolt, crown, ghost, clock, medal) are lists of SVG primitives in `client/src/ui/badge-icons.ts`, drawn with `createElementNS`; the colour comes from the config. No image files, no third-party art.

### Daily quests (`config/quests.json`, requirement 3)
- Pool of eight quests `{ id, title, counter, target, reward }` (counters as above; reward 1 to 1000 Ecto). Example: "Deliver a branch" (`branch_delivered`, 1, 30 Ecto), "Run a branch review" (`review_finished`, 1), "Accept a memory note" (`memory_accepted`, 1), "Schedule a night job" (`night_scheduled`, 1).
- `pickQuests(day, pool)` (shared, pure): `day` is the local date `YYYY-MM-DD`; pool sorted by id, FNV-1a hash of the date seeds a mulberry32 generator, a partial Fisher-Yates takes three. The same date always gives the same three.
- State `quests = { day, progress, done }`. A fact moves a quest when its own local day is `day` and its key was new (so a replay never adds). When the stored day is not today, the state starts again. `done` has each completed quest once.
- Payout: completing a quest pushes `{ ref: "<day>.<id>", reward }` to `payouts`, in the same write as the fact. The gateway pays each pending payout with `economy.grant("quest_done", ref, ts, reward)`, the same idempotent call as every other grant (`GrantReason` gets `quest_done`; `Economy.grant` takes an optional amount for it; `hasGranted` tells a payout that was already paid before a crash), and then removes it from `payouts`. A payout that could not be written stays and is tried again at the next fact and at start. Without an economy a quest completes and pays nothing.
- A fact counts for quests only when it happened today, so a replayed old job does not complete today's quest.

### Profile panel
- `PanelName` gets `profile`, opened by the Profile button (client side, no furniture): the level chip next to the Ecto chip is that button ("Lv 3", `aria-label` "Open your profile. ..."). Tabs: Badges (the user's badges, earned first and newest first, each with icon, name, description and date; locked ones greyed with what the rule asks for) and Quests (today's three: title, progress bar, reward, "Done"). The header shows level, XP to the next level and the user's stats.
- The button exists only when the hotel sends `progress`. In the recorded demo and with the scripted engine without a progress file there is no button, so no panel and no empty page.
- A member's HR card shows the badges that member earned as small pictures (title: name and description).

### Tests (task 2)
- shared (`badges.test.ts`): badge file checks (each refusal), `evaluateBadges` once, `pickQuests` deterministic for a date and always three distinct (fast-check), a quest completes once with one payout, only for the facts of today, the day rolls over, replaying changes nothing with badges and quests on (fast-check).
- world-server (`progress-quests.test.ts`): every shipped badge is earned exactly at its rule and only by its scope; every shipped quest completes after its target and pays once, also after a restart; payouts survive a restart and a failed write; through the gateway: the three quests pay into the wallet once, a replay after a restart pays nothing more, an unpaid payout is paid at start, a payout already in the wallet is only taken off the list, no economy means no payment, and a note kept, a morning report and a scheduled night job each count. No client message can complete a quest or earn a badge.
- client (`profile.test.ts`): badge icons for every shape, rule texts, Profile panel (badges, quests, empty states, text from the server never becomes markup), badges on the HR card, panel state.
- Playwright (`e2e/team-progress.spec.ts`): a scripted job on the fake engine raises the Developer's and QA's XP in the team bar, earns the Plan approver badge, completes today's three quests and pays their Ecto; after a reload the quests are still done. The date picks the quests, so the spec runs against a pool of its own in which one job completes any three (`AGENTLIFE_QUESTS_FILE`). It also gets a world-server and a Vite server of its own (ports 8796 and 5198) with scratch progress, wallet and inventory files, because XP, level-up toasts and Ecto would otherwise leak into the other specs; the config deletes its progress file before the run (the fake engine reuses task ids).

### Changes from the first plan (recorded while building)
- `applyFact` stays the pure core of task 1. Badges and quests are in `applyFactWithRules` (`progress-rules.ts`), so `progress.ts` does not import `badges.ts` (that would be a cycle). `ProgressView` therefore lives in `progress-rules.ts`; `EntityView` (in `progress.ts`) carries the earned badges.
- New server message `badge_earned { who, owner, badge }` for the toast ("Badge earned: First delivery", "Ada earned a badge: Night owl").
- `ProgressModel.ofSlot` uses the role name as the member id for a desk when no `team_view` has arrived (the scripted engine has no HR office; the server counts those under the role name too).
- `AGENTLIFE_QUESTS_FILE` replaces `config/quests.json` (tests and Playwright only).
