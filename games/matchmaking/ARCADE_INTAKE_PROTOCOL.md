# Arcade Intake Protocol (arcade-intake/v1)

Matchmaking (`match.madladslab.com`) is the **universal arcade-intake loader**.
It sits between the platform portal and a game, owns only intake + grouping, and
then steps out. It runs no gameplay and holds no lobby — the game (e.g. the cards
platform) does that.

## Navigation

```
games.madladslab.com   →   match.madladslab.com   →   <game> lobby (e.g. cards)
   (portal / arcade)         (intake + grouping)         (lobby + live table)
```

## Flow

1. **Arcade launch.** The portal arcade tile points at matchmaking via the SSO
   bridge: `games /arcade/<game>/play` → `games /auth/bridge?redirect=<match intake>`.
   The bridge signs a 5-min identity JWT (BRIDGE_SECRET) and bounces to
   `match /intake/<game>?token=<jwt>`.

2. **Identity.** Matchmaking verifies the token (same BRIDGE_SECRET as the bridge
   and the game loader), stores `{ platformId, displayName, ... }` in its session,
   and serves the intake screen.

3. **Discovery.** Matchmaking reads the loader catalog (`GET cards /catalog`) to
   learn the game's seating shape (`players`, `partnerships`, `lobbyPath`,
   `fillWithBots`). The catalog is the contract every card game implements by
   shipping a `meta.json`.

4. **Grouping.** On the player's choice:
   - **Play vs Bots** — player takes seat 0; remaining seats fill with bots.
   - **Quick Match** — join/await a live pool; falls back to bots until a pool
     exists. (v1: bots.)

5. **Handoff.** Matchmaking mints a signed **table ticket** (HS256, BRIDGE_SECRET):
   ```json
   { "tableId", "game", "params", "seat", "platformId", "displayName",
     "players": [{ "seat", "bot", "displayName" }], "via": "matchmaking", "mode" }
   ```
   and redirects to the game's lobby: `cards <lobbyPath>?ticket=<jwt>`. The loader
   creates the table from the ticket on first join and verifies identity from the
   ticket (not a shared session). Matchmaking is now out of the path.

## Adding a new card game

A card variant becomes matchmaking-ready by shipping `meta.json` in its folder
inside cards (e.g. `/srv/cards/<game>/meta.json`) with `id, name, players,
partnerships, lobbyPath, image, status`. It then appears in `cards /catalog`
automatically and matchmaking can seat it with no matchmaking code change — the
loader stays generic.

## Failure isolation

Identity travels by signed token, so the portal is never in the gameplay path and
matchmaking never runs gameplay. Each title (and matchmaking) runs in its own
tmux session; one crashing only stops that title, never the portal.

---

## Amendments (2026-05-30) — endpoints, ticket, multi-platform, invites

See `/srv/games/ARCHITECTURE.md` for cross-cutting protocols.

### Endpoints (live)
- `GET /intake/:game?token=<bridge jwt>` — bridge lands here; establishes the session
  (`user = {platformId, displayName(screen name), isAdmin}`), serves `intake.html`.
- `GET /intake/:game/info` — `{ game:{id,name,blurb,players,image}, user:{displayName} }`.
  **`image` is returned as an ABSOLUTE platform URL** (`config.platform.url + path`) because
  arcade art lives on games — resolving it against cards 404s. The page uses it directly.
- `GET /intake/:game/go?mode=bots|quick` — group (player seat 0 + bots) → mint ticket → 302
  to the platform lobby.
- `GET /intake/:game/online` — online portal users to invite (proxies games
  `/internal/online-users?exclude=<self>`; screen names only).
- `GET /intake/:game/invite?to=<platformId>&name=<screenName>` — private table: host seat 0,
  invitee seat 1, bots fill the rest; mints **both** tickets; pushes the invite to games
  (`POST /internal/invite`, joinUrl = platform lobby with the invitee ticket); 302s the host
  into the lobby.

### Table ticket (HS256, BRIDGE_SECRET, short TTL)
`{ tableId, game, params, seat, platformId, displayName(screen name), players[], via, mode }`.
Invitee tickets get a longer TTL (~600s) so the toast has time to be accepted. The platform
`table:join` verifies it, creates the table on first join, and seats the player. It is the
only entry into a table.

### Identity / privacy
`displayName` from the bridge token is the **screen name only**. Matchmaking stores it in
session and forwards it into tickets and invites — it never sees or forwards the real name.
A matchmaking restart flushes in-memory sessions (use after any bridge/identity change so
stale names can't linger).

### Multi-platform (cards now, hex next)
Matchmaking is platform-agnostic: it reads `/catalog` from the game loader and hands off to
that loader's lobby. The same intake/go/online/invite flow will drive **hex** (Towers) once
it exists — point `config.cards.*` style settings at the target platform per game, or add a
per-game loader base in the catalog. Quick-match currently fills with bots; a live socket
pool is the roadmap item.

### Calls into games (server-side, x-bridge-secret)
`gamesInternal(path)` → `config.platform.url + /internal + path` with the shared secret:
used for `/online-users` and `/invite`. `config.platform.bridgeSecret == games BRIDGE_SECRET`.

### Reconnect / user game management (2026-05-30)
Cards is the source of truth for live seats; match owns the user-facing resume.
- cards `GET /internal/seat?platformId=` (x-bridge-secret) → `{ seat: {tableId,game,seat,phase} | null }`
  (prefers an in-progress table over a finished one). Survives match restarts.
- match `GET /active` (session) → `{ active }` for a "Rejoin" affordance on intake.
- match `GET /resume` (session) → looks up the live seat via cards, re-mints a fresh ticket
  into that exact seat, 302s to the lobby. No match-side state.
- Table tickets (go/invite/resume) now carry a session-length TTL (8h) so a reload or socket
  blip rejoins via the in-URL ticket (cards re-seats by platformId); the match session is 8h too.
- Cards client: socket.io auto-reconnect re-emits `table:join`; a "Reconnecting…" banner shows
  on drop, and a "Rejoin" button (→ match `/resume`) appears if the ticket/table is gone.
- **Dev caveat:** all live-table state is in-memory — a cards restart (deploy) drops mid-game
  tables and resume then finds nothing (redirects to the arcade). Durable resume needs table
  persistence (later).
