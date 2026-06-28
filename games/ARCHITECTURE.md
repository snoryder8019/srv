# MadLadsLab Arcade — Architecture & Protocol Index

**Status:** active · **Last settled:** 2026-05-30 · **Owner of identity & analytics:** `games.madladslab.com`

This is the canonical map of the MadLadsLab **Arcade**: the multiplayer browser-game
platform that sits on top of `games.madladslab.com`. It explains how the services fit
together and points to the per-surface protocol docs. Read this first; then the
protocol doc for whatever you're touching.

| Doc | Scope |
|---|---|
| **this file** | Big picture, topology, cross-cutting protocols, ops, roadmap |
| `/srv/games/WEBGAMES_PROTOCOL.md` | Platform contract: SSO bridge, score/stats ingest, public read API, presence/invite |
| `/srv/games/GLOBAL_MODAL_PROTOCOL.md` | The games-owned universal overlay (global chat / leaderboards / nav) |
| `/srv/cards/CARDGAMES_PROTOCOL.md` | The **cards** platform: engine, table runtime, variant contract (euchre, hearts), socket protocol |
| `/srv/matchmaking/ARCADE_INTAKE_PROTOCOL.md` | The **match** intake/grouping/invite contract + table ticket |
| `/srv/cards/CARDS_RENDER_PROTOCOL.md` | The cards visual + animation stack + SD asset pipeline |
| `/srv/hex/HEX_PLATFORM_PROTOCOL.md` | The **hex** platform (threejs hex-grid games); Towers migrates in as the first variant |

---

## 1. The big picture

Two kinds of thing live in the Arcade:

- **The platform** (`games`) — owns *identity*, *permissions*, the *master leaderboard*,
  *per-user web-game stats*, the *activity feed*, *portal presence*, and (planned) the
  *global modal*. It never runs gameplay.
- **Game platforms** — self-contained services that host a *family* of games as
  **variants** inside a shared scaffold:
  - **cards** (`cards.madladslab.com`) — trick/shedding card games. Variant 1: **euchre** (live). Variant 2: **hearts** (planned).
  - **hex** (`/srv/hex`, planned) — threejs hex-grid games. Variant 1: **td / Towers** (migrating in).
- **Matchmaking** (`match`) — the universal *intake + grouping + invite* loader between
  the portal and a game platform. It forms a group, mints a signed **table ticket**, and
  hands off. It never holds a lobby or runs gameplay.

**Canonical navigation:**
```
games (arcade tile)  ->  match (intake: bots / quick / invite)  ->  game platform lobby (cards|hex)  ->  live table
        |                                                                      |
        +-- identity (signed bridge JWT) --------------------------------------+
                                                                               |
        results (master leaderboard + per-user stats + activity) <-- export ---+
```

A **variant** is a folder inside its platform (e.g. `/srv/cards/euchre/`), never a
separate top-level service. The platform is the scaffold; variants are content.

---

## 2. Services & topology

| Service | Dir | Domain | Port | Stack | tmux session | Supervised by |
|---|---|---|---|---|---|---|
| **games** (portal/IdP) | `/srv/games` | games.madladslab.com | 3500 | CJS, Express, Mongo, Socket.IO | `games` | service-watchdog |
| **cards** (platform) | `/srv/cards` | cards.madladslab.com | 3600 | ESM, Express, Socket.IO | `cards` | watchdog + auto-start |
| **match** (intake) | `/srv/matchmaking` | match.madladslab.com | 3610 | ESM, Express, Socket.IO | `matchmaking` | watchdog + auto-start |
| **td / Towers** (web game) | `/srv/td` | towers.madladslab.com | 3720 | ESM, Express, EJS, Mongoose, Socket.IO | `td` | **none (manual)** ⚠ |
| **hex** (platform, planned) | `/srv/hex` | TBD (hex.madladslab.com) | TBD (3650-range) | ESM | `hex` | to add |

Supervision files: `/srv/auto-start-npm.json` (boot) and `/srv/service-watchdog.json`
(liveness). Each Arcade service runs in **its own tmux session** for failure isolation —
a crashing table never takes down the portal, and the portal is never in the gameplay path.

Apache terminates TLS and reverse-proxies each subdomain to its loopback port, with the
WebSocket upgrade declared explicitly:
```apache
Protocols http/1.1
<Location "/socket.io/">
  ProxyPass http://127.0.0.1:<PORT>/socket.io/ upgrade=websocket
  ProxyPassReverse http://127.0.0.1:<PORT>/socket.io/
  Require all granted
</Location>
ProxyPass / http://127.0.0.1:<PORT>/
```
> Gotcha (solved): Apache's empty-User-Agent bot filter returns 403 to UA-less upgrade
> probes (bare `ws`/socket.io-client). Real browsers and clients that send a UA upgrade
> fine. This is not a TLS/ufw/ws problem — set a UA in test clients.

---

## 3. Identity & SSO — the bridge

`games` is the identity provider. Every Arcade surface authenticates the same way
(see WEBGAMES_PROTOCOL §3). Flow: a game/intake redirects to
`GET https://games.madladslab.com/auth/bridge?redirect=<callback>`; games signs a 5-minute
HS256 JWT with the shared `BRIDGE_SECRET` and 302s back with `?token=`.

**Token payload (v2):**
```json
{ "id":"<platform user _id>", "email":"<server-only>",
  "displayName":"<SCREEN NAME>", "isAdmin":false, "permissions":{...},
  "iat":..., "exp":... }
```

### Privacy rule (non-negotiable)
`displayName` in the token is the **public screen name only** —
`username.displayFor(user)`, which returns `user.username` or an anonymous
`user_<hash>`, and **never** the real account name, Google profile name, or email.
`email` is carried solely for one server-side purpose (Towers' legacy account-linking)
and is **never displayed** by any surface. Anywhere a player is rendered — seats,
lobbies, end screens, leaderboards, recent results, activity, presence, invites — uses
the screen name. The single source of a player's public name is the bridge token's
`displayName`; downstream services must not re-derive it from email or account fields.

`BRIDGE_SECRET` is identical across games, cards, match, td (and any future platform),
server-only, and also authenticates the internal reporting channel (`x-bridge-secret`).

---

## 4. The platform–variant pattern

A game platform is a scaffold that owns everything generic and delegates all rules to a
variant. Established by **cards**; **hex** mirrors it.

```
<platform>/
  engine/                 generic primitives (cards: @mll/cards-engine; hex: grid/threejs core)
  lib/
    table.js              TableRuntime — seats, phases, scores, dealer/turn, end-game, rematch/reseat
    tables.js             registry (create/get/drop/list)
    tickets.js            verify/mint table tickets (shared BRIDGE_SECRET)
    stats.js              reportGameResult(table) -> games ingest (best-effort)
    variants/index.js     variant registry
  <variant>/              e.g. euchre/  (config.js, meta.json, index.js)
  services/socket.js      Socket.IO transport (join/ready/action; state/hand/event/over)
  routes/, public/, app.js, config/
```

**Variant contract (what a variant supplies):** `id`, `meta.json`
(`{id,name,blurb,players,partnerships,image,lobbyPath,status}`), and the rules hooks the
runtime calls: `startHand`, `applyAction(table,seat,action) -> {ok,events,handOver,gameOver}`,
`currentTurn`, `botAction`, `publicView`, `privateView` (returns legal actions so the client
is never authoritative). Adding a game = adding a folder + registering it. See the platform
protocol doc for the exact interface.

---

## 5. Matchmaking & the table ticket

`match` reads the platform's `/catalog`, authenticates the player (bridge), forms a group,
mints a **table ticket**, and 302s to the platform lobby. Modes:
- **bots** — player seat 0, bots fill the rest.
- **quick** — same as bots until a live pool exists (roadmap).
- **invite** — player seat 0, invited online user seat 1, bots fill the rest (see §8).

**Table ticket** (HS256, `BRIDGE_SECRET`, short TTL): `{ tableId, game, params, seat,
platformId, displayName, players[], via, mode }`. The platform `table:join` verifies it,
creates the table on first join, and seats the player. The ticket is the *only* way into a
table. See ARCADE_INTAKE_PROTOCOL.md.

---

## 6. Live gameplay transport (Socket.IO)

All platforms use Socket.IO (Scott requirement) across the stacks. Standard event set
(see CARDGAMES_PROTOCOL §socket):
- **client→server:** `table:join {ticket}`, `seat:ready {ready}`, `seat:addBot {seat}`,
  `game:action {action}`, `table:rematch`, `table:reseat {perm}`, `table:exit`.
- **server→client:** `table:state` (public snapshot), `seat:hand` (private, that seat's
  cards + legal actions), `table:event` (incremental), `table:over` (end screen payload),
  `table:error`.

Server is authoritative: clients render `seat:hand.legal` and act idempotently
(decisionId = `handNo:phase:tricksPlayed:trickLen:turn`).

---

## 7. Stats & activity export

On game end the platform calls the games ingest, **best-effort, never blocking play**
(WEBGAMES_PROTOCOL §5):
```
POST https://games.madladslab.com/internal/webgame/score   (x-bridge-secret)
{ game, platformId, displayName(screen name), event:'game-end',
  score, status:'won|lost', durationMs, meta:{...} }
```
One call per **human** seat (bots and `dev:`/`bot:` ids skipped). Games then:
1. appends `webgame_scores` (one doc/result),
2. upserts `webgame_leaderboard` on `{game,platformId}` (`$max bestScore`, `$inc runs/wins`, `lastPlayedAt`),
3. emits a live `/stats` `webgame_result` event (activity feed).

**Surfaced on the portal:**
- `GET /api/webgame/leaderboard/:slug` (public) — top by wins, then bestScore.
- `GET /api/webgame/recent/:slug` (public) — recent final scores.
- `GET /api/webgame/me` (auth) — the signed-in user's record + recent results.
- `/stats/events` merges recent `webgame_result`s into the LIVE ACTIVITY feed.
- Landing **ARCADE · <GAME>** panel renders leaderboard + recent + "your record".

---

## 8. Presence & private invites

Portal presence is required so a player can invite "someone active on games".
- `games` `/presence` Socket.IO namespace (auth via shared session) tracks signed-in
  portal users `{platformId, name(screen name), sockets}` in memory (`lib/presence.js`).
- `GET /internal/online-users?exclude=<pid>` (x-bridge-secret) — list of online users.
- `POST /internal/invite` (x-bridge-secret) `{toPlatformId, fromName, game, joinUrl, inviteId}`
  — pushes an `invite` to the target's presence sockets.
- Landing shows an **invite toast** ("X invited you to Euchre — Join") → the joinUrl drops
  the invitee into the same platform table (their pre-minted invitee ticket).
- `match` exposes `/intake/:game/online` and `/intake/:game/invite?to=&name=` to drive this.

All names in this path are **screen names only**.

---

## 9. The global modal (planned) — see GLOBAL_MODAL_PROTOCOL.md

A single, games-owned overlay docked over *every* Arcade surface (portal, match, cards,
hex) providing **global chat**, **cross-game leaderboards**, and **on-the-fly navigation**
between games — without leaving the current table. One implementation, served and run by
`games`, embedded by the platforms via a tiny loader. Designed but not yet built.

---

## 10. Operations

**Restart a service** (watchdog tool is unreliable; use tmux directly):
```
cd /srv/<svc> && node -c <entry>            # or: node --check app.js  (ESM)
tmux kill-session -t <session>; sleep 1
tmux new-session -d -s <session> "cd /srv/<svc> && npm start 2>&1 | tee -a /srv/<svc>/<svc>.log"
sleep 5 && curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/health
```
Recreate the session with the **exact** name/cmd in `service-watchdog.json` so the watchdog
doesn't double-start it.

**execute_command guardrails:** no `killall`/`pkill`/`kill -9`, no `rm -rf /<path>`
(use `cd /srv && rm -rf <name>`), no `dd`/`mkfs`/`reboot`/`shutdown`.

**Known risks / cleanup owed:**
- ⚠ `service-watchdog.json` lists **both** `servers` and `cards` on port **3600**. Only
  cards is actually on 3600; the `servers` entry is stale. If `servers` is ever revived it
  will collide — fix the watchdog entry (servers is otherwise dormant).
- ⚠ **Towers (`td`) is unsupervised** — running in a manual tmux session, absent from both
  `auto-start-npm.json` and `service-watchdog.json`. It will not auto-recover on crash/boot.
  Folded into supervision as part of the hex migration.

---

## 11. Roadmap (settled, not yet built)

1. **hex platform + Towers migration** — stand up `/srv/hex` as a threejs hex-grid platform
   mirroring cards; migrate Towers in as variant `td`; route match → hex; export stats +
   activity like cards. Add hex (and td) to supervision. *(HEX_PLATFORM_PROTOCOL.md)*
2. **hearts** — second cards variant proving the generic intake (folder + meta.json +
   rules hooks inside `/srv/cards/hearts/`; register; match needs no change). *(CARDGAMES_PROTOCOL.md)*
3. **global modal** — games-owned overlay over all surfaces. *(GLOBAL_MODAL_PROTOCOL.md)*
4. **quick-match live pool** — real socket-based grouping in match (replace bot fill).

5. **tiles platform** (`/srv/tiles`) — **mahjong + dominoes**. These are *tile* games, not
   card games: different pieces (mahjong 136 tiles: suits/honors/bonus, melds pung/kong/chow,
   wall + draw/discard; dominoes double-six set, line layout, matching ends) and a draw/place
   turn model, not trick-taking. So they do **not** fit the cards 52-card engine — but they
   *do* fit the platform-variant pattern: stand up `/srv/tiles` mirroring cards/hex with a
   `tiles-engine` (tile sets, hands, walls, legal-move hooks), reuse the shared protocols
   (SSO bridge, table ticket, stats/activity, presence/invite) and the **render/animation
   stack** (tiles draw like cards: faces/backs, fan/line layout, deal/play flights). Mahjong
   and dominoes are variants inside it. (Same engine-differs / protocols-shared split as hex.)
6. **Reconnect + user game management (in match)** — when a player drops or reloads, they
   should rejoin their in-progress table. Design: match keeps a per-user *active-games*
   registry (set on go/invite: `{platformId -> {tableId, game, seat, lobbyPath}}`) + a
   `GET /resume` that re-mints a fresh ticket for the existing seat and redirects in; cards
   already keeps the table alive across a disconnect and re-seats by `platformId`. The cards
   client should auto-rejoin on socket reconnect (re-emit `table:join` with its ticket) and
   show a "reconnecting…" state. Longer table-ticket TTL covers reload/blip within a session.
   **Dev caveat:** all live-table + registry state is in-memory, so any service *restart*
   (every deploy) drops mid-game tables — durable resume needs persistence (or cards-as-
   source-of-truth) and is a later step.

---

## 12. Change log
- **2026-05-30** — Tiles platform shipped (tiles.madladslab.com:3625), mirroring cards with its
  own @mll/tiles-engine (tilegames/v1); first variant DOMINOES (block/draw) live and verified end
  to end. Matchmaking made MULTI-PLATFORM: aggregates every platform's catalog, routes each game
  to its own host, searches all platforms for reconnect. Dominoes wired into the arcade (tile,
  svg, webgames.json, intake) and the global modal. New dedicated Apache vhost + cert; the
  exact-host vhost loads before slab-wildcard so it isn't shadowed. See TILEGAMES_PROTOCOL.md.
- **2026-05-30** — Global modal shipped (v0): games-owned overlay embedded on portal, match, and
  cards (euchre+hearts) via a one-line loader.js. Arcade-wide chat (`io.of('/global')`, screen
  names, rate-limited in-memory ring), Leaderboards tab (per-game + new master cross-game aggregate
  `/api/webgame/leaderboard`), and a Games/nav tab. Cross-origin identity via a short-lived modal
  ticket (shared BRIDGE_SECRET) minted by each surface's `/modal-ticket` and relayed into the
  games-served iframe panel. See GLOBAL_MODAL_PROTOCOL.md §10.
- **2026-05-30** — Hearts shipped (cards variant #2): full rules (passing, 2♣ lead, follow-suit,
  hearts-broken, first-trick no-penalty, Q♠/hearts scoring, shoot-the-moon, lowest-wins to a
  cap), individual-scoring runtime seams (gameResult/standings/resetMatch), simultaneous-pass
  bot driver (botSeatsToAct), hearts.html client, arcade tile + svg + webgames.json entry.
  Fixed a private/public state desync that caused stale 'illegal play' submissions: the private
  view is now authoritative and self-contained (yourTurn/turn/counters); clients act off it alone.
- **2026-05-30** — Reconnect + user game management shipped: cards `/internal/seat` (source of
  truth), match `/active` + `/resume` (re-mint into the existing seat), session-length (8h)
  ticket TTLs, cards-client auto-rejoin + reconnect banner, intake "Rejoin" affordance. Also:
  cards visual/animation stack (SD art: card-back/felt/rail/crest; opponents' backs; deal/play
  animations) and the euchre landscape fill view.
- **2026-05-30** — Architecture settled & documented. Built to date: cards platform +
  @mll/cards-engine, euchre variant, live tables, matchmaking intake, end-game flow
  (stats export / rematch / reseat / exit), portal leaderboard+recent+activity surfacing,
  screen-name privacy fix across the bridge + scrub, portal presence + private invites.
  Defined for next: hex/Towers, hearts, global modal.
