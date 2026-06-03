# MadLadsLab Arcade — System Map & Task Board

> **Status:** active work in progress. This is the single source of truth for how the
> arcade is laid out and what work remains, broken into manageable directories and
> taskable chunks. Building is **paused** at this checkpoint pending review.
> Last updated: 2026-06-01.

The arcade spans **three services**. Identity + economy + the public portal live on
`games`; matchmaking seats players; `tiles` hosts the game engines and 3D clients.

```
games.madladslab.com   (portal, identity/SSO, chip wallet, arcade registry, leaderboards)
match.madladslab.com   (matchmaking: intake → seat → handoff)
tiles.madladslab.com   (game engines, variants, 3D + interactive clients, casino)
```

Launch flow (every arcade game):
```
arcade card → /arcade/<game>/play → SSO bridge → match/intake/<game>
   → seat (bots fill) → handoff → tiles/lobby/<game>?ticket=…  → live table
```

---

## 1. Directory map

### 1A. `games` (portal · identity · economy) — `/srv/games`
| Path | Role |
|---|---|
| `webgames.json` | Arcade registry — **single source of truth** for which games appear. Add a game here and it shows in the (now dynamic) arcade grid. |
| `lib/wallet.js` | Chip economy: balances, ledger, debit/credit/settle, leaderboards, earn hooks. |
| `lib/announcements.js` | Landing-strip announcements (+ mtime auto-reload). |
| `routes/internal.js` | Service-to-service API (bridge-secret): `webgame/score`, `wallet/{get,debit,credit,settle,grant}`. |
| `routes/api.js` | Public reads: `webgame/*`, `wallet/me`, `wallet/leaderboard`. |
| `routes/arcade.js` | Arcade registry endpoint + `/arcade/:slug/play` SSO launcher. |
| `public/landing.html` | Portal page: dynamic arcade grid, stats tabs, chip pill, chip leaderboards, one-time flash. |
| `public/img/<game>.svg` | Arcade card icons. |

### 1B. `match` (matchmaking) — `/srv/matchmaking`
| Path | Role |
|---|---|
| `app.js` | Intake/seat/handoff. `GAME_PLATFORM` maps each game → its host platform (all six tile games → `tiles`). |

### 1C. `tiles` (engines · variants · clients) — `/srv/tiles`
| Path | Role |
|---|---|
| `app.js` | Express + Socket.IO host; lobby routing (game → client html); dev endpoints; scene-bg endpoints. |
| `engine/` | Tile engine (`tile.js`, `bag.js`, `rng.js`) — dominoes, mahjong. |
| `engine-cards/` | Card engine (`deck.js`, `card.js`, `trick.js`) — hearts, euchre. |
| `lib/table.js`, `lib/tables.js` | Generic table runtime (turns, bots, scoring, reconnect, votes). |
| `lib/variants/` | Variant registry + `scaffold.js` factory. |
| `lib/tickets.js` | Signed seat tickets (shared bridge secret). |
| `lib/stats.js` | Exports finished games to `games` master leaderboard. |
| `lib/wallet.js` | tiles-side client for the chip economy on `games`. |
| `services/socket.js` | Socket protocol: join/ready/action → state/hand/event/over. |
| `services/wallet-sync.js` | Mirrors casino bankrolls ↔ real wallet (seed + settle). |
| `services/art/` | SD scene backgrounds (prompts, generation, manifest). |
| `<game>/` | Per-variant: `index.js` (rules), `config.js`, `meta.json`. |
| `public/<game>3d.html` + `public/js/<game>3d.js` | Bespoke 3D clients. |
| `public/js/table3d.js` | Shared 3D table core (camera, seats, deal, scene bg, cam-debug). |
| `public/js/tableclient3d.js`, `hud3d.js` | Shared socket client + HUD. |
| `public/js/{card3d,tile3d,dice3d,wheel3d}.js` | Mesh builders. |
| `public/js/game3d.js`, `scaffold3d.js` | Generic interactive / read-only fallback clients. |
| `scripts/` | Provisioning, patch, and test scripts (see §4). |

---

## 2. Per-game status

| Game | Engine | Server rules | Client | Notes |
|---|---|---|---|---|
| Dominoes | tile | ✅ full | ✅ bespoke 3D | reference variant |
| Hearts | cards | ✅ full | ✅ bespoke 3D | reference variant |
| Euchre | cards | ✅ full (bowers, bidding, stick-the-dealer) | ✅ bespoke 3D (cards) | going-alone not implemented |
| Mahjong | tile | ✅ full + claiming (pung/kong/chow/ron) | ✅ bespoke 3D (tiles + melds) | bots skip chow; scoring is flat (no fan/yaku) |
| Craps | — | ✅ pass/don't-pass, point, bankroll | ✅ bespoke 3D (dice + puck) | uses real chips; no come/odds bets |
| Roulette | — | ✅ numbers + outsides + dozens/columns | ✅ bespoke 3D (wheel + full board) | uses real chips; no splits/corners |

---

## 3. Subsystems

- **Economy** — `games/lib/wallet.js` (+ `tiles/lib/wallet.js`, `tiles/services/wallet-sync.js`). Start 500 chips; earn via arcade play/win + server grants; spend in casino. Leaderboards: Most Chips, Biggest Bet Won. Balance reaches in-game clients via `seat.chips` in table state (cross-origin-proof).
- **Scene backgrounds** — `tiles/services/art/` + `table3d.js`. SD-generated, muted/blurred, screen-pinned cover-fit.
- **Camera framing** — `?cam=1` in any lobby URL → SAVE ANGLE → `/dev/cam` → `tiles/camlog.txt`. Bake into a client's `cameraStart`/`cameraTarget`.
- **Announcements / flash** — strip via `games/lib/announcements.js`; one-time flash keyed in localStorage (`mll_flash_<id>`), bump id to re-trigger.

Protocol references: `tiles/TILEGAMES_PROTOCOL.md`, `games/WEBGAMES_PROTOCOL.md`, `games/GLOBAL_MODAL_PROTOCOL.md`.

---

## 4. Task board — chunked & ownable

Each chunk is sized to be picked up independently. **P1** = next-up, **P2** = soon, **P3** = later.

### Epic A — Casino depth
- [ ] **A1 (P1)** Craps betting board client (match roulette): come/odds/place/field bets. *Touches:* `craps/index.js` (bet types + payout), `craps3d.js` (board overlay). *Done:* new bet types validated + settled; board renders.
- [ ] **A2 (P2)** Roulette splits/corners/streets. *Touches:* `roulette/index.js` (`betWins` + multipliers), `roulette3d.js` (cell adjacency). *Done:* multi-number bets pay correctly.
- [ ] **A3 (P2)** Casino game-over "biggest bet won this session" highlight + chip delta. *Touches:* `hud3d.js` over-card, `wallet-sync.js`.
- [ ] **A4 (P3)** Side-bet history / hot-numbers panel for roulette. *Touches:* `roulette3d.js`, publicView.

### Epic B — Economy
- [ ] **B1 (P1)** Wire dedicated-server presence → chips. The `/internal/wallet/grant` hook exists; needs the presence tick to call it (e.g. `serverMinute` per active minute). *Touches:* `games/lib/presence` + a periodic grant.
- [ ] **B2 (P2)** Daily login bonus + streak. *Touches:* `wallet.js` (new reason), landing pill claim.
- [ ] **B3 (P2)** Anti-bankruptcy top-up (free chips when balance hits 0, throttled). *Touches:* `wallet.js`.
- [ ] **B4 (P3)** Chip ledger view for a user (transaction history). *Touches:* new `api.js` route + a modal tab.
- [ ] **B5 (P3)** Admin chip tools (grant/clawback) in `admin.html`.

### Epic C — Mahjong correctness
- [ ] **C1 (P2)** Bots claim chow (currently skipped). *Touches:* `mahjong/index.js` botAction.
- [ ] **C2 (P3)** Real scoring (fan/yaku, dealer rotation, multi-round east). *Touches:* `mahjong/index.js` scoring.
- [ ] **C3 (P3)** Concealed-kong from hand on your own turn. *Touches:* `mahjong/index.js` legalActions/applyAction.

### Epic D — Euchre completeness
- [ ] **D1 (P2)** Going alone (loner) + 4-point march. *Touches:* `euchre/index.js`.
- [ ] **D2 (P3)** Dealer "pick it up" discard UX polish. *Touches:* `euchre3d.js`.

### Epic E — Client polish
- [ ] **E1 (P1)** Capture + bake camera framing for euchre/mahjong/craps/roulette (tooling ready; needs saved angles). *Touches:* each `<game>3d.js`.
- [ ] **E2 (P2)** Draggable card/tile drop zones (vs tap) for euchre/mahjong. *Touches:* `euchre3d.js`, `mahjong3d.js`.
- [ ] **E3 (P3)** Sound pass (distinct cues per game event). *Touches:* `table3d.js` Sound + clients.

### Epic F — Platform hygiene
- [ ] **F1 (P1)** Convert accumulated `scripts/_patch_*.mjs` into committed source edits + delete the patch scripts (they were one-shot migrations). *Touches:* `tiles/scripts/`.
- [ ] **F2 (P2)** Browser smoke test (none on host) — a manual checklist or headless harness for the visual layer (3D render, board, flash, pill).
- [ ] **F3 (P2)** Clean stale backups: `*/index.js.*bak*`, `public/landing.html.*bak*`, `camlog.*`.
- [ ] **F4 (P3)** A real `db.js`-style wallet test suite (unit + ledger invariants).
- [ ] **F5 (P2)** Restart safety: the MCP `restart_service_safe` tool tripped its own guard and dropped sessions earlier; document/repair the safe restart path for games/match/tiles.

### Epic G — New games (provision via scaffold, then build)
- [ ] **G1 (P3)** Blackjack (cards engine + chip betting; closest to existing pieces).
- [ ] **G2 (P3)** Spades / Bid Whist (cards engine; partnership like euchre).
- [ ] **G3 (P3)** Baccarat (simple casino, chip betting).

---

## 5. Conventions (so chunks stay consistent)

- **Adding a game:** scaffold a folder (`index.js`/`config.js`/`meta.json`) → register in `lib/variants/index.js` → add to `games/webgames.json` (grid auto-shows) → add `GAME_PLATFORM[game]='tiles'` in matchmaking → lobby client mapping in `tiles/app.js` → optional SD scene prompt.
- **Variant contract:** `startHand, currentTurn, botSeatsToAct, legalActions, applyAction, publicView, privateView, botAction` (+ optional `gameResult, standings, resetMatch`). Single active seat at a time — sequence any "simultaneous" mechanic (see mahjong claims).
- **Client contract:** drive the shared core (`table3d`) + client (`tableclient3d`) + HUD (`hud3d`); send actions from `priv.legal`; server re-validates everything.
- **Chips:** never trust client amounts — server validates debit/settle; casino bankroll syncs through `wallet-sync.js`; in-game balance reads `seat.chips`.
- **Edits to running services:** edit source, then restart that service (lib changes need a restart; static `public/*` does not). Recreate the tmux session if it drops.
