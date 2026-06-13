# MadLadsLab Reels Protocol — v0

**Status:** active · **Started:** 2026-06-10 · **Service:** `/srv/reels` · port `3740` · `reels.madladslab.com` · tmux `reels`
**First skin:** `classic-diamond` (3-reel classic — cherry / lemon / BAR / 2xBAR / 3xBAR / 7 / diamond)

Reels is a new **arcade type**: one service hosting many slot *machines*. A machine
is pure JSON config — theme/skin, reel count, strips, paylines, paytable,
denominations, bet levels, and bonus modes all live in `machines/<slug>.json`.
The engine (`lib/engine.js`) is machine-agnostic. New skins are config, not code.

## 1. Platform integration (per WEBGAMES_PROTOCOL.md)
- **Identity:** SSO bridge. `GET /auth/platform` → platform `/auth/bridge` →
  `GET /auth/platform/callback?token=` (HS256 `BRIDGE_SECRET`). Session = signed
  JWT cookie (`reels_session`, 12h). Screen names only (§9.1).
- **Chips:** platform wallet is authoritative. Each paid spin: `POST
  /internal/wallet/debit` (wager) then `POST /internal/wallet/settle`
  `{wager, payout}` — settle records `totalWagered` / `biggestBetWon` and credits
  the payout. Free spins settle with `wager: 0`.
- **Big wins** (payout ≥ `bigWin.thresholdX` × bet) are reported best-effort to
  `POST /internal/webgame/score` (`event: game-end`, `status: won`,
  `score: payout`) → master leaderboard + LIVE ACTIVITY feed.
- Registered in `/srv/games/webgames.json` as slug `reels`; origin listed in the
  platform `TRUSTED_ORIGINS` + `ALLOWED_ORIGINS`.

## 2. Machine config schema (`machines/<slug>.json`)
| Field | Meaning |
|---|---|
| `slug,name,blurb,theme` | identity + skin hook for the client |
| `layout.reels/rows` | reel count and visible window height |
| `symbols` | id → `{label, art, group?, scatter?}` — `art` keys into client art; `group` enables mixed-match rules |
| `strips` | one symbol array per reel — the *physical* strips (RNG picks a stop index per strip) |
| `paylines` | `{id, name, rows[]}` — `rows[r]` = row used on reel r |
| `lineOptions` | selectable payline counts (prefix of `paylines`) |
| `denominations` | chip value per credit (lit buttons) |
| `betLevels` | bet-per-line multipliers (lit buttons) |
| `paytable` | ordered best→worst; rule forms: `match` (exact L→R), `group`+`count` (any n of a symbol group), `anyCount` (exactly n of a symbol anywhere on the line) |
| `bonuses` | bonus modes. Implemented: `freespins` `{trigger:{scatter,count}, spins, multiplier}` and `pick` `{trigger:{scatter,count}, prizes[](total-bet multipliers), label}` — pick prizes are crypto-shuffled and committed server-side at trigger; spins 409 (`BONUS_PENDING`) until `POST /api/bonus/pick` resolves. New types extend `engine.evalBonuses` + app.js state + client presentation |
| `bigWin.thresholdX` | payout multiple of bet that triggers the big-win overlay + leaderboard report |

**Bet model:** `total = denom × betLevel × lines`; a line win pays
`mult × denom × betLevel` (× bonus multiplier during free spins).

## 3. Server authority
Stops come from `crypto.randomInt` server-side; the client only animates to the
returned stops. Free-spin state and session tallies are in-memory per
`platformId` (v0 — a restart drops pending free spins; move to Mongo if that
ever matters). Wallet ordering is debit → spin → settle; a settle failure after
debit is logged loudly (`[settle] FAILED`) for manual reconciliation.

## 4. HTTP surface
- `GET /api/v1/health`
- `GET /api/machines` — catalog
- `GET /api/state?machine=` (auth) — public machine config + chips + session + free spins
- `POST /api/spin` (auth) `{machine, denom, betLevel, lines}` →
  `{stops, window, wins[], payout, bonus?, freeSpins?, pendingPick?, bigWin, chips, session}`
- `POST /api/bonus/pick` (auth) `{choice}` → `{picked, prizes[], mult, amount, bigWin, chips, session}` — resolves a pending pick bonus
- `GET /auth/platform`, `GET /auth/platform/callback`, `POST /auth/logout`

## 5. RTP discipline
Every machine MUST be run through `npm run rtp` (exact enumeration) before
shipping. `classic-diamond` v0.4: **94.07%** total (85.95% base + 2.21% free spins + 5.92% Diamond Vault); symbols: cherry/lemon/bell/BAR/2xBAR/3xBAR/7/diamond + star(bonus);
jackpot 1-in-2,130 per line; free spins and vault each ≈ 1-in-394 (a bonus every ~197 spins).

## 6. Adding a skin (checklist)
1. `machines/<slug>.json` — strips, paylines, paytable, bonuses.
2. Client art: add draw fns to `ART` in `public/slot.js` for any new `art` keys
   (theme colors/chassis can key off `machine.theme`).
3. `npm run rtp <slug>` — tune to target (house standard: 90–95%).
4. New bonus *types* only: extend `engine.evalBonuses` + spin-state handling in
   `app.js` + presentation in the client.


## Engine v0.5 additions
- **leftMatch** paytable rule: left-aligned N-of-a-kind from reel 0 with wild substitution (`m.wild`). Order paytable longest->shortest per symbol so the longest run wins. Enables video-slot style 3/4/5-of-a-kind on many paylines.
- **theme: digital** client skin (dark LED screen, Orbitron marquee, grid lines) alongside classic blue-steel. Theme + marquee name + reel-window aspect ratio (reels:rows) are applied dynamically from the machine config on boot.
- **URL machine select:** client reads `?m=<slug>` (default classic-diamond). Arcade entries pass `callbackPath:/auth/platform/callback?m=<slug>`; the SSO bridge token-append now uses correct ?/& separators.

### Machine: royal-suits (Royal Suits)
- Digital **5x5**, 33 paylines (lineOptions 10/20/30), denominations 1/2/5/10/25/50, betLevels 1-3.
- Symbols: 10 J Q K A (ranks) + spade/heart/diamond/club (suits, higher pay) + wild (reels 2-4) + scatter (reels 1,3,5).
- Left-aligned 3/4/5-of-a-kind pays; wild substitutes. Scatter x3 -> 8 free games at x2.
- Monte-Carlo RTP ~91.7% (base ~72.6% + free spins ~3% + Dealer Shoe ~16%); hit freq ~65%. NOTE: mixed-royal combos on 30 lines are RTP-explosive — Any-3-Royals removed, Royal Run x5 kept tiny (5x).


## Audio mixer (v0.6)
- SFX is channel-routed: master -> {fx (mechanical: pull/spin/reel clicks), win (chimes/bell/jackpot/coins)}. Levels + mute persist to localStorage (reels_mix_v1).
- A self-contained mixer popover (no external deps) mounts on the topbar speaker button (#mixBtn), themed per machine. Mirrors the tiles audiobus.js mixer used by craps/blackjack/baccarat/roulette.
- Stack-wide standard: tiles casino games use /srv/tiles/public/js/audiobus.js (master/music/crowd/dealer/fx); reels uses its own zero-asset synth bus with the same UX. Bump the ?v= cache-bust string when editing audiobus.


## v0.8–0.9: persistent collection bonus + paytable modal
- **machine.collect** — cross-spin collection bonus. {symbol, key, fill, label, bonus:{type:pick,prizes,label}}. Each matching symbol on the board banks 1; reaching fill triggers the bonus and carries remainder. State is DURABLE via the platform gamestate KV (survives restarts/sessions forever).
- **Platform gamestate KV** — new generic internal endpoints POST /internal/gamestate/{get,set} {game,platformId,key,value}, collection `gamestate`. Reusable by any web game needing persistent per-player state; reels reaches it via platform.getState/setState.
- **Royal Suits**: wild rethemed as JOKER; Dealer Shoe collects 13 Jokers → pick-a-card bonus. Added mixed-royal combo pays (Royal Run x5 = 60×, Any 3 Royals = 5×) ordered AFTER exact runs so true N-of-a-kind always wins.
- **Paytable & odds modal** — info (ℹ️) button opens a per-machine modal built from machine.paytable/bonuses/collect, with a client-side Monte-Carlo odds estimate (any-win %, bonus trigger 1-in-N, jokers/spin). Generic across machines.
