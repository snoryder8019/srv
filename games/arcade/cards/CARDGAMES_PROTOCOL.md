# MadLadsLab Card-Games Protocol — cardgames/v1

**Status:** active · **Started:** 2026-05-30 · **First variant:** Euchre (`/srv/euchre`)
**Builds on:** `WEBGAMES_PROTOCOL.md` v1 (SSO bridge + score reporting + registry).
**Companion:** the **matchmaking / arcade-intake protocol** (`/srv/matchmaking`) — the
universal contract every new arcade game implements to enter the pipe. Cards games
are one *class* of thing matchmaking can load.

WEBGAMES v1 covers *single-player score games* (identity + master leaderboard).
This protocol extends it for **realtime, multiplayer, partnership** card games. It
is the source of truth for the cards platform and for every card-game variant
built under `/srv`. An engine version bump should upgrade all variants without
touching their rules code — so dependencies point one way only: **variant → engine**,
never the reverse.

---

## 1. The arcade flow

```
games.madladslab.com ── THE platform · auth/users · master leaderboard
   ARCADE = grid of divs. EACH card-game type (euchre, hearts, spades…) is its OWN div.
   The div carries that game's PARAMETERS (type, mode, variant config). ALL params
   originate from the selection and flow down the pipe — nothing downstream hardcodes
   a game's config.
   │  (token handoff — BRIDGE_SECRET JWT via /auth/bridge, WEBGAMES v1 §3)
   ├─ single-player → game start/play screen → game → score POST back (WEBGAMES v1 §5)
   └─ multiplayer   → MATCHMAKING (generic loader) → loads the target → score POST back
```

Identity **always originates at games.madladslab.com**. No game or sub-platform
mints identity; they receive a short-lived signed token and trust it.

---

## 2. Role split

| Concern | Owner |
|---|---|
| Identity, users, permissions | **games platform** (`/srv/games`) |
| Arcade UI — one div per game (incl. each card-game type); selection params | **games platform** |
| Cross-game master leaderboard | **games platform** |
| Generic game **loader**: group formation (quickmatch auto-fill, bot fill on request), handoff ticket. Loads a cards table **or** another arcade game. Its protocol = the universal arcade intake for any new game. | **matchmaking** (`/srv/matchmaking`) |
| Shared card mechanics (deck/shuffle/deal/trick/turns), versioned | **cards platform** (`/srv/cards`, `cards.madladslab.com`) |
| **Table lobby** (waiting room) **and the live table** | **cards platform** |
| A specific game's rules, bidding, scoring, live state | **variant** (e.g. `/srv/euchre`) atop the cards engine |

Boundaries that matter:
- **Matchmaking forms the group and loads the target, then steps out.** It does
  not hold the lobby and does not run gameplay.
- **The lobby and the live table live in the cards platform.** Players land in the
  cards table lobby; cards runs the socket game and owns state.
- **Matchmaking is game-agnostic.** Adding a new arcade game = implementing the
  matchmaking intake protocol; matchmaking neither knows nor cares whether the
  target is a cards variant or a standalone game like Towers.

---

## 3. Engine API (the variant seam)

`@mll/cards-engine` (`/srv/cards/engine`, currently v0.1.0) provides game-agnostic
mechanics and leaves the rules open. A variant implements this shape, fed entirely
by the parameters that arrived from the game selection:

```
Variant = {
  buildDeck(config)               -> Card[]      // which ranks/suits to deal
  deal(deck, ctx)                 -> { hands, kitty }
  isLegalPlay(card, hand, trick, ctx) -> boolean // follow-suit etc.
  trickComparator(plays, ctx)     -> seat        // trump/bower-aware winner
  scoreHand(state)                -> { deltas, ... }
  isGameOver(score)               -> boolean
}
```

The engine never imports a variant. The trick winner is resolved through the
variant's `trickComparator` (euchre supplies bower logic there); the engine ships
a `naturalComparator` for plain trump games only. All randomness flows through the
engine's seedable rng so a recorded seed replays a hand exactly (audit + repro).

---

## 4. Loading + handoff (matchmaking → cards table)

For a multiplayer cards game, matchmaking forms the group, then **loads a table on
the cards platform** and hands each player a short-lived **table ticket** — an
HS256 JWT signed with `BRIDGE_SECRET` (same shared secret as the SSO bridge):

```json
{ "tableId": "...", "game": "euchre",
  "params": { "...": "from the arcade selection (variant config, mode)" },
  "seat": 0, "team": 0, "partner": 2,
  "players": [{ "seat": 0, "platformId": "...", "displayName": "...", "bot": false }, ...],
  "iat": ..., "exp": ... }    // exp short (≈60s); single-use
```

The cards platform verifies the ticket, seats the player into the **table lobby**,
and opens the live socket once the table is ready. Players are still carried by
their **platformId** from games.madladslab — the ticket binds a platform identity
(and the selection's params) to a seat; it does not replace identity. The same
intake shape, minus cards-specific fields, is how matchmaking loads *any* arcade
game (defined in the matchmaking protocol).

---

## 5. Realtime (in the cards platform)

- Transport: **Socket.IO** (rooms, reconnection), matching Towers (`/srv/td`).
- One room per table; the variant's table object is the single source of truth.
- Table state is small + serializable (see engine `Table.snapshot/restore`) so a
  dropped player rejoins into the exact state; combined with the deterministic
  shuffle seed, the hand is fully reconstructable.
- Bots: a seat is controlled by either a human socket or a bot policy. The engine
  treats seats uniformly; "bot fill on request" (matchmaking, lobby stage) and any
  in-table bot takeover share one seat-controller abstraction in the variant.

---

## 6. Scoring export

On hand/game end the cards platform reports to the games platform exactly as
WEBGAMES v1 §5 (`POST /internal/webgame/score`, `x-bridge-secret`), with card-game
fields in `meta` (e.g. `{ teamScores, euchres, loners, seatResults }`). Best-effort;
never blocks gameplay.

---

## 7. Build log

- **2026-05-30** — Protocol drafted, then corrected after design review:
  lobby + live table live in the **cards platform** (not matchmaking); matchmaking
  is a **generic loader** whose protocol is the universal arcade intake (loads a
  cards table *or* another arcade game); **each card-game type is its own arcade
  div**; **all params originate from the game selection** and flow down. To do: a
  separate matchmaking/arcade-intake protocol doc at `/srv/matchmaking`.
- **2026-05-30** — `@mll/cards-engine` v0.1.0 stood up: card model, seedable rng,
  deck build/shuffle/deal (round + packet modes), Trick + comparator seam, Table
  (seats/partners/rotation). Verified: 24-card euchre deck, deterministic seed
  shuffle, 3-2 packet deal → 5/5/5/5 + 4 kitty, trump trick resolution,
  partnership/turn order. Next: cards platform service shell (subdomain + SSO
  bridge consumer + table lobby), then euchre variant + live socket, then
  matchmaking.

---

## Amendments (2026-05-30) — live state, end-game, and adding hearts

See `/srv/games/ARCHITECTURE.md` for cross-cutting protocols (bridge, ticket, stats, presence).

### Live components
- `engine/` — `@mll/cards-engine` (ESM): cards/deck/rng/trick/table primitives.
- `lib/table.js` — `TableRuntime`: seats, phases `lobby→playing→gameOver`, `scores[2]`
  (team0 = seats {0,2}, team1 = {1,3}), dealer/turn, end-game bookkeeping
  (`startedAt/endedAt/winnerTeam/tally/gamesPlayed`), `standings()`, `rematch()`,
  `reseat(perm)→{platformId:newSeat}`, `vacate(seat)`.
- `lib/{tables,tickets,stats}.js`, `lib/variants/index.js` (registry).
- `euchre/` — variant 1 (**live**): `config.js`, `meta.json`, `index.js` (bower-aware
  comparator, bidding/discard/play, going-alone, scoring to 10).
- `services/socket.js` — transport (see below). `app.js` serves `/lobby/:game`, `/catalog`,
  `/auth/*`, `/play/:game`. `public/euchre.html` — Canvas client.

### Socket protocol (authoritative server)
client→server: `table:join {ticket}`, `seat:ready {ready}`, `seat:addBot {seat}`,
`game:action {action}`, `table:rematch`, `table:reseat {perm}`, `table:exit`.
server→client: `table:state` (public), `seat:hand` (private: cards + **legal actions**),
`table:event`, `table:over` (end screen), `table:error`.
Clients act idempotently: `decisionId = handNo:phase:tricksPlayed:trickLen:turn`.

### End-game flow
On `gameOver` the runtime sets `winnerTeam/endedAt`; the socket layer emits `table:over`
(scores, winnerTeam, standings, tally) **once** (guarded by `table._finished`) and calls
`lib/stats.js reportGameResult(table)` → games ingest (best-effort, one POST per human seat).
- **rematch** = "ready up for a new game": first requester resets to a fresh 0–0 lobby
  (dealer rotates), everyone re-readies, game starts.
- **reseat** = pick one of the 3 partnership permutations; occupants rearrange and sockets
  resync by `platformId`.
- **exit** = free the seat; client returns to the arcade.

### Multiplayer seating (match)
Tickets carry `seat` + a `players[]` bot-fill list. `bots` mode = human seat 0 + bots.
`invite` mode = host seat 0 + invitee seat 1 + bots fill the rest (same table id, two
tickets). Cards needs no per-mode logic — it just seats whoever presents a valid ticket.

### Adding a variant — **hearts (next)**
Hearts is a 4-player trick-avoidance game (no partnerships; per-player scores; shoot-the-moon).
Steps — **no matchmaking or games changes required**:

1. `mkdir /srv/cards/hearts`, add:
   - `config.js` — deck (full 52), deal (13 each), scoring (hearts=1, Q♠=13, moon=26),
     `players:4`, **no partnerships** (free-for-all), passing rotation (L/R/across/hold).
   - `meta.json` — `{ "id":"hearts","name":"Hearts","blurb":"...","players":4,
     "image":"/static/img/hearts.svg","lobbyPath":"/lobby/hearts","status":"live" }`.
   - `index.js` — rules hooks: `startHand` (deal + passing phase), `applyAction`
     (pass 3 cards → play; enforce leading ♣2, no hearts until broken, follow suit),
     `currentTurn`, `botAction`, `publicView`, `privateView` (legal cards per rules),
     end at a points cap (e.g. 100) with **lowest score wins**.
2. Register it in `lib/variants/index.js` (import + `registerVariant`).
3. **Scoring shape**: hearts is per-player, not 2-team. Either generalize `scores` to
   `seats.length` for non-partnership variants, or have the variant own a `playerScores[4]`
   in `table.hand`/state and set `winnerTeam`→`winnerSeat` semantics for `standings()`/stats.
   Keep the stats `meta` shape (final score, opponents) so the existing leaderboard/recent/
   activity surfacing works unchanged.
4. Add `/srv/games/public/img/hearts.svg` (served at games `/static/img/hearts.svg`) and a
   `webgames.json` entry if it gets its own arcade tile (or surface both card games under one
   "Cards" tile that lets match pick the variant).
5. Client: clone `public/euchre.html` → `public/hearts.html` (Canvas felt + `priv.legal`
   rendering + end overlay); `app.js` already serves `/lobby/:game` generically.

Note: euchre assumes 2-team partnerships; hearts is free-for-all. When generalizing the
runtime, gate partnership logic on `meta.partnerships` so both models coexist.

### Visual + animation layer
Variant clients render through the shared stack `public/js/cards-render.js` (table art,
card faces/backs, fan layout, deal/play flight animations) with art generated via the SD
gateway. Opponents' hands show as fanned card backs. See **CARDS_RENDER_PROTOCOL.md**.
A new variant supplies a seat layout + `drawBoard` + which events animate; faces/backs/
table/flights are inherited.

### Turn clock, timeout & wait/kick vote (2026-05-30)
The runtime owns a per-seat turn clock; the socket layer runs a 1s per-table interval.
- Timing (lib/table.js `TIMING`): `turnMs` 30s human turn, `voteMs` 20s vote window,
  `botMin/MaxMs` bot "thinking" delay (≈0.6–1.2s) so play is readable and takeovers paced.
- `publicState().turn = { seat, remainingMs, totalMs }` — the client draws a countdown ring on
  the active human's seat plate (green→gold→red). Bots are not on the clock.
- On expiry the table opens a **wait/kick vote** (`turn:timeout` then `vote:open`); other
  connected humans send `table:vote {choice:'wait'|'kick'}`. Majority (or the deadline) decides:
  **wait** grants another full turn; **kick** calls `convertToBot(seat)` and the seat is played
  by the variant's existing `botAction` from then on (clean takeover via the normal bot loop).
  A solo human vs bots (no eligible voters) auto-resolves to kick. Acting on your turn cancels
  any vote against you.
- Events added: `turn:timeout`, `vote:open`, `vote:update`, `vote:result`, `seat:kicked`.
  Client shows a vote panel (Wait / Kick→bot) to everyone except the seat under vote.

### Hearts variant (2026-05-30)
Full 4-player Hearts in /srv/cards/hearts (config.js, meta.json, index.js), registered
in lib/variants/index.js. Individual (free-for-all) scoring, not 2-team.
- Deck 52, 13 each. Pre-hand PASSING phase rotating left/right/across/hold by hand number.
  Passing is simultaneous: legalActions returns `passCard` SELECTION candidates; the client
  submits ONE `{type:'pass',cards:[3]}`. Bots are driven via the new `botSeatsToAct(table)`
  seam (returns all un-passed seats at once); the socket layer's runBotsPaced honors it.
- Play: 2♣ leads trick 1; follow suit; hearts can't be led until broken (Q♠ also breaks);
  no penalty cards on trick 1. Scoring: heart=1, Q♠=13; shoot-the-moon = shooter 0 / others +26.
  Game ends when any total ≥ losingScore (default 100); LOWEST total wins.
- Non-partnership scoring flows through optional runtime seams: `gameResult(table)`,
  `standings(table)`, `resetMatch(table)`. The runtime/stats use these when present, else
  fall back to euchre's 2-team path. stats.js branches on Array.isArray(table.finalTotals).
- **Client sync fix (important for all future variants):** the private view (seat:hand) is
  AUTHORITATIVE and self-contained — it carries `yourTurn`, `turn`, and decision counters
  (handNo/tricksPlayed/trickLen). Clients must drive plays off the private view alone, never
  by cross-referencing the public `table:state`, because the two arrive as separate events and
  can momentarily desync (which previously caused stale "illegal play" submissions).
