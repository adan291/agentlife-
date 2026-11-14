# Regression backlog

Checks of behaviour that the Playwright suite does not run yet. None needs a person's eyes; each can become a test. They were in `docs/HUMAN-CHECKS.md` and were moved here so that file keeps only what needs a human. Tick an item when a test covers it, with the test's name.

- [ ] Restart the world-server (not only the page): placed pieces, stock, the lobby and HR office arrangements, worn outfits and the wardrobe are still there; a `data/layouts.json` written before ui-tidy is read and rewritten with `project:<id>` keys.
- [ ] Removing a project at the Reception puts its pieces back in the tray of another floor.
- [ ] A second purchase of an owned outfit part is refused and the item says "Owned". A badge part unlocks with a toast when its badge is earned (also at the next visit, also a member's badge).
- [ ] The same part on two members at once, a different top on a member who stands on the floor, None takes a part off; a fired member who wore something leaves the new hire bare and the part stays in Owned.
- [ ] The HR ghost stands at tile 7,1 of the HR office and the Builder's desk takes its seat when moved.
- [ ] Hover on a ghost or its team-bar row shows the stats (jobs, % passed, average step time). The pipeline editor's "Back to the default".
- [ ] The day after: three other quests and yesterday's gone.
- [ ] `scripts/conduct.ts` `runBrowserTests`: the decision to stop the conductor (a failure, a missing report, a retry that passes) has no test; only `summarizeE2e` and `describeE2e` do. `summarizeE2e` has no test for a report without suites or with several levels of nested suites.
- [ ] The empty mailbox at 360x640: no palette command opens it, so `mailbox-empty` is not compared there.
- [ ] Visual comparisons of the panels not yet compared (requirement 3.1 says "each panel"): night board, Library, review desk, test lab, directory, coffee machine, pipeline editor, HR imports. Each needs the furniture on screen and its data scripted (`FAKE_*` in the fake engine), then one `expectLooksLike` per size.
