# Implementation Plan

- [ ] 1. Parts, wardrobe and the shop
  - Shared schemas (part, wardrobe, outfit, messages); `config/outfits.json` with 20+ parts; renderer draws each part on the ghost in four directions; Outfits page in the shop with previews; buy and badge unlock on the server; tests
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 4.1, 4.3_

- [ ] 2. Wearing outfits
  - Look section in the HR member card and in the Profile panel; wear message checked by the server, stored per member and for the user; live update on the floor, kept across reload, restart and floors; fired member drops it; demo shows the default look; tests and Playwright
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.2, 4.3, 4.4_
