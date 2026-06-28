# Hex Platform Protocol — threejs hex-grid games — v0 (design)

**Status:** design (not yet built) · **Started:** 2026-05-30 · **Mirrors:** the cards platform
**Master directory:** `/srv/hex` · **First variant:** `td` (Towers) at `/srv/hex/td`

The **hex** platform is to threejs hex-grid games what **cards** is to card games: a shared
scaffold that owns everything generic (identity handoff, seating, table lifecycle, state
sync, stats/activity export, end-game flow) and delegates all *game rules + rendering* to a
**variant** living in a subfolder. Towers becomes the first variant — `/srv/hex/td` —
"configured into" hex exactly like euchre was configured into cards.

Read `/srv/games/ARCHITECTURE.md` for the cross-cutting protocols (SSO bridge, table ticket,
stats/activity, presence/invite). This doc covers only what's hex-specific.

---

## 1. Why a separate platform from cards

Card games are **discrete and turn-based**: a small JSON state, one legal action at a time,
trivially server-authoritative. Hex/threejs games (tower-defense, strategy) are
**continuous/tick-based** with a 3D scene: many entities, real-time simulation, client
rendering in threejs. The transport and identity protocols are identical; the **engine** and
**table runtime** differ. So hex reuses every shared protocol but ships its own engine.

---

## 2. Directory layout (mirror of cards)

```
/srv/hex/
  HEX_PLATFORM_PROTOCOL.md      this doc
  engine/                       @mll/hex-engine (ESM)
    grid.js                     axial/cube coords, neighbors, distance, ring/spiral, line
    pathfind.js                 A* / flow-field over the hex grid
    scene.js                    threejs scene CONTRACT (what a variant must render): tiles,
                                entities, camera; server stays render-agnostic
    rng.js                      seedable RNG (shared style with cards engine)
    index.js                    barrel
  lib/
    table.js                    HexTableRuntime — seats, phase, shared/team state, end-game,
                                rematch/reseat, AND a tick loop for real-time variants
    tables.js                   registry (create/get/drop/list) — same shape as cards
    tickets.js                  verify/mint table tickets (shared BRIDGE_SECRET) — same as cards
    stats.js                    reportGameResult(table) -> games ingest — same contract as cards
    variants/index.js           variant registry
  td/                           Towers as a variant (see §6)
    config.js  meta.json  index.js  (+ render/ for the threejs client bundle)
  services/socket.js            Socket.IO transport (shared event names + tick deltas)
  routes/  public/  app.js  config/  .env
```

`config/index.js`: own port (allocate in the 3650+ range, e.g. **3630**), `platform.url`,
`platform.bridgeSecret` (== games `BRIDGE_SECRET`), `session.secret`, `allowedOrigins`.
Add hex to `auto-start-npm.json` + `service-watchdog.json` and an Apache vhost
(`hex.madladslab.com`) using the canonical WebSocket form.

---

## 3. The runtime: supports turn-based AND tick-based

`HexTableRuntime` generalizes the cards `TableRuntime`. A variant declares its model:

```js
// meta.json
{ "id":"td", "name":"Towers", "blurb":"...", "players":1, "model":"tick",
  "tickHz":20, "image":"/static/img/td.svg", "lobbyPath":"/lobby/td", "status":"live" }
```

- **`model:"turn"`** — behaves exactly like cards: the runtime calls `applyAction` and
  advances on `handOver`/`gameOver`. (Lets hex host turn-based strategy games too.)
- **`model:"tick"`** — the runtime runs a `setInterval(tickHz)` loop calling
  `variant.tick(table, dtMs)`; player input arrives as `game:action` and is queued into the
  next tick; the runtime broadcasts **state deltas** (not full snapshots) each tick.

Shared with cards regardless of model: seats, connect/ready, phases
(`lobby -> playing -> gameOver`), `scores`, end-game bookkeeping (`startedAt/endedAt/
winnerTeam/tally`), and `rematch()/reseat()/vacate()`.

---

## 4. Variant contract (hex)

A variant supplies `id` + `meta.json` + these hooks:

| Hook | Turn model | Tick model |
|---|---|---|
| `init(table, rng)` | build initial state | build initial world (towers, lanes, spawn plan) |
| `applyAction(table, seat, action)` | `{ok,events,handOver,gameOver}` | validate + enqueue (returns `{ok}`) |
| `tick(table, dtMs)` | — | advance sim; return `{events, deltas, gameOver}` |
| `currentTurn(table)` | seat to act | — |
| `botAction(table, seat)` | bot move | optional AI director |
| `publicView(table)` | snapshot | full world (used on join/resync) |
| `privateView(table, seat)` | hand + legal | per-player fog/economy + legal build actions |
| `sceneSpec(table)` | — | threejs scene description the client renders (tiles, entity types, assets) |

The server never imports threejs; it emits scene **data**, the client renders it. This keeps
the runtime headless/testable (drive `tick` in a unit test with no GPU).

---

## 5. Transport (shared + tick extension)

Reuses the standard event set (ARCHITECTURE §6). Additions for `tick` variants:
- server→client `table:tick { t, deltas }` — entity/economy deltas at `tickHz`.
- server→client `table:state` — full world on join/resync only (not every tick).
- client→server `game:action { action }` — build/upgrade/sell/target; enqueued for next tick.

Identity (bridge), table ticket, end-game flow, and stats/activity export are **identical**
to cards — Towers already speaks the SSO bridge and the score ingest, so the export wiring
is a lift-and-shift into `lib/stats.js`.

---

## 6. Migrating Towers in (`/srv/hex/td`)

Towers today (`/srv/td`, `towers.madladslab.com:3720`) is a self-contained ESM service that
*already*: consumes the SSO bridge (`routes/auth.js`) and reports scores to games
(`services/socket-handlers.js -> /internal/webgame/score`). It is the reference web-game.
It is **not yet** threejs/hex and is **currently unsupervised**.

**Migration (phased, keep towers.madladslab.com live throughout):**
1. **Stand up hex** empty: engine (grid/pathfind/scene), `HexTableRuntime` (tick loop),
   tickets/stats/tables, socket transport, app/config, vhost `hex.madladslab.com`. Prove it
   with a trivial `trial` tick-variant (like cards' trial).
2. **Wrap Towers as `td`**: move the existing game simulation into `td/index.js` behind the
   variant hooks (`init/tick/publicView/privateView/sceneSpec`). Port the threejs client into
   `td/render/` served by hex. Keep Towers' own Mongo profile if it needs per-game progress
   (platform identity still by `platformId`).
3. **Route through match**: register `td` in cards-style `/catalog` on hex; add the Towers
   arcade tile → match intake → hex lobby. Stats/activity export now flows through the shared
   `lib/stats.js` (same leaderboard/recent/activity surfacing as euchre).
4. **Supervise**: add hex (and retire standalone `td`) in `auto-start-npm.json` +
   `service-watchdog.json`.
5. **Cut over** `towers.madladslab.com` to the hex-hosted variant; retire `/srv/td` once
   parity is confirmed. Old direct-login path can remain as a transition fallback.

**Multiplayer note (per Scott):** once Towers is a hex variant, `match` can group multiple
players into one `td` table (co-op/versus) exactly as it does for cards, and the result
exports to the master leaderboard + activity feed via the shared contract — no Towers-specific
plumbing.

---

## 7. Open decisions
- Final hex port + subdomain (`hex.madladslab.com` proposed; `3630` proposed).
- Whether Towers keeps a local Mongo (per-game progression) or folds fully into platform stats.
- Delta-encoding format for `table:tick` (compact array vs keyed object) — pick during step 1.
