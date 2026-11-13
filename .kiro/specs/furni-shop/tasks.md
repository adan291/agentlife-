# Implementation Plan

- [ ] 1. Wallet and grants
  - Shared schemas (wallet, ledger, catalogue item, messages); `config/economy.json`; world-server wallet store and idempotent grants from engine events; balance in the top bar and grant toast; property test
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1_

- [ ] 2. Catalogue, shop and inventory
  - 24+ items with own art in the client renderer and `FURNI_CATALOG`; lobby `shop_counter` and Shop panel with pages and previews; buy message; inventory store; tests
  - _Requirements: 2.1, 2.2, 2.3, 4.2_

- [ ] 3. Placing bought furniture
  - Inventory tray in arrange mode, place and pick up through the furni-move checks, template furniture protected, removed project returns items; Playwright test
  - _Requirements: 3.1, 3.2, 3.3, 4.2, 4.3_
