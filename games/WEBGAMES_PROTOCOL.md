# MadLadsLab Web‑Games Plug‑in Protocol — v1

**Status:** active · **Started:** 2026‑05‑29 · **Reference integration:** Towers (`towers.madladslab.com`)

This document is the source of truth for plugging a **browser game** into the
`games.madladslab.com` platform. The platform owns **identity**, **permissions**,
and **cross‑game analytics / master leaderboards**. Each game keeps its own code,
DB, and config in its own service directory and talks to the platform over two
narrow, versioned channels (SSO + internal reporting).

> History: `bih.madladslab.com` was the first app to use the `/auth/bridge`
> SSO mechanism. **bih is now deprecated.** Towers is the first first‑class
> *web game* integration and the model this protocol is written against. The
> bridge mechanism itself is unchanged and proven.

---

## 1. Roles

| Concern | Owner |
|---|---|
| Who a player *is* (identity) | **Platform** — shared `users` collection (madladslab Mongo) |
| What a player may *do* across apps (permissions) | **Platform** — `users.permissions` + `users.isAdmin` |
| Cross‑game scores / records / activity (master leaderboard) | **Platform** — `webgame_scores`, `webgame_leaderboard` |
| Game rules, levels, characters, per‑game profile/progress | **Game** — its own service + DB (e.g. `/srv/td`, db `td`) |

A game may keep a *local* profile row, but it is keyed to the platform user and
is never the identity of record. Games must **not** self‑grant elevated roles —
control flows from platform permissions only.

---

## 2. Shared secret

`BRIDGE_SECRET` (HS256) lives in the platform `.env` and in **each** game's env.
It signs the SSO token and authenticates the internal reporting channel. It is
server‑only and never sent to a browser.

---

## 3. Identity / SSO handshake

Platform is the identity provider. The flow (game → platform → game):

```
Player on game site clicks "Sign in"            (or platform Arcade "Play")
  → GET https://games.madladslab.com/auth/bridge?redirect=<GAME_CALLBACK>
      • redirect must be a platform TRUSTED_ORIGIN
      • if not logged in, platform bounces through its own /login first
      • platform signs a 5‑min JWT and 302s to: <GAME_CALLBACK>?token=<jwt>
  → GAME verifies token (BRIDGE_SECRET, HS256), establishes its own session
```

**JWT payload** (issued by `GET /auth/bridge`):

```json
{ "id": "<platform user _id>", "email": "...", "displayName": "...",
  "isAdmin": false, "permissions": { "games": "admin", "<slug>": "..." },
  "iat": ..., "exp": ... }    // exp = iat + 5m
```

**Game responsibilities:**
- `GET /auth/platform` → 302 to the bridge with its own callback URL.
- `GET /auth/platform/callback?token=` → `jwt.verify(token, BRIDGE_SECRET)`,
  then **upsert a local profile keyed by `platformId = payload.id`** (never by
  email alone), copy `displayName`, and store `permissions` + `isAdmin`.
  Establish the game's session and redirect into the game.
- Treat the token as single‑use and short‑lived; reject on expiry.

---

## 4. Permissions

The platform `users.permissions` object + `users.isAdmin` are authoritative.
A game decides in‑game control like so:

```
isGameAdmin = payload.isAdmin === true
           || payload.permissions?.games === 'admin'
           || payload.permissions?.<slug> === 'admin'
```

Store the resolved flag on the local profile at login; re‑resolve on each login
so a platform permission change takes effect on next sign‑in. Games expose admin
tools (e.g. Towers' balance console / bug button) **only** when this is true.

---

## 5. Score / analytics reporting (master leaderboard)

Machine‑to‑machine, game → platform, best‑effort (must never block gameplay):

```
POST https://games.madladslab.com/internal/webgame/score
Header: x-bridge-secret: <BRIDGE_SECRET>
Body:   { game: "<slug>", platformId: "<id>", displayName: "...",
          event: "run-end", score: 0, wave: 0, status: "won|lost|abandoned",
          durationMs: 0, meta: { } }
```

Platform behaviour:
- Append to `webgame_scores` (one doc per event, TTL‑eligible).
- Upsert `webgame_leaderboard` on `{ game, platformId }`: `bestScore` (max),
  `highestWave` (max), `runs` (inc), `wins` (inc on won), `lastPlayedAt`.
- Respond `{ ok, best, rank }`. A non‑2xx or timeout is logged and ignored by
  the game.

Leaderboard reads (public): `GET /internal/webgame/leaderboard/:slug` (internal)
and a public portal view derived from `webgame_leaderboard`.

---

## 6. Catalog / registration

- Each web game is registered in the platform web‑games registry:
  **`/srv/games/webgames.json`** — `{ slug, name, blurb, url, callbackPath,
  icon, status }`.
- The portal renders an **Arcade** section from the registry.
- Launch link: `GET /arcade/:slug/play` → (optional permission gate) → 302 to
  `/auth/bridge?redirect=<game origin><callbackPath>`.
- **Config isolation:** each game's rules/levels/characters/art live entirely in
  its own service dir and DB. The platform stores only identity, permissions,
  and analytics/leaderboards — never game config.

---

## 7. Plug‑in checklist (new browser game)

1. Game implements `GET /auth/platform` + `GET /auth/platform/callback`
   (verify `BRIDGE_SECRET` JWT, upsert by `platformId`, own session).
2. Game `POST`s run results to `/internal/webgame/score`.
3. Game gates admin features on resolved platform permissions (§4).
4. Add the game origin to platform **TRUSTED_ORIGINS** (`routes/index.js`) and
   **ALLOWED_ORIGINS** (`app.js`).
5. Register the game in `/srv/games/webgames.json`.
6. Put `BRIDGE_SECRET` in the game's env.

---

## 8. Integration log

- **2026‑05‑29** — Protocol v1 written. bih deprecated; Towers chosen as the
  reference web‑game. Decisions: reuse existing `/auth/bridge` (sign+verify with
  `BRIDGE_SECRET`); identity stays in platform `users`, Towers keeps a local
  profile keyed by `platformId`; new `webgame_scores` + `webgame_leaderboard`
  collections for the master leaderboard; new `/arcade` section + registry;
  new `/internal/webgame/*` endpoints. Towers keeps its existing Google login as
  a fallback during transition.

---

## 9. v2 amendments (2026-05-30) — Arcade build

These extend v1; v1 mechanics are unchanged. See `/srv/games/ARCHITECTURE.md` for the full map.

### 9.1 Screen-name privacy (supersedes the displayName note in §3)
`/auth/bridge` now signs `displayName = username.displayFor(u)` — the **public screen
name only** (`user.username`, else anonymous `user_<hash>`), **never** the real account
name, Google profile name, or email. `email` remains in the token solely for server-side
account-linking (Towers) and is **never displayed**. Every Arcade surface renders the
screen name only. Existing `webgame_*` rows were scrubbed to screen names.

### 9.2 Public web-game read API (portal surfacing)
- `GET /api/webgame/leaderboard/:slug` (public) — top players by `wins`, then `bestScore`.
- `GET /api/webgame/recent/:slug` (public) — recent `game-end` results (final scores).
- `GET /api/webgame/me` (auth) — the signed-in user's per-game record + recent results.
- (planned) `GET /api/webgame/leaderboard` (no slug) — cross-game master aggregate (modal).

### 9.3 Activity feed integration
`/internal/webgame/score` now also emits a live `/stats` `webgame_result` event on
`event:'game-end'`, and `/stats/events` merges recent `webgame_result`s into the LIVE
ACTIVITY feed. The landing page renders an **ARCADE · <GAME>** panel (leaderboard + recent +
"your record") and a `webgame_result` activity row.

### 9.4 Portal presence + private invites
- `io.of('/presence')` (auth via shared session) tracks online portal users — screen names
  only — in `lib/presence.js`.
- `GET /internal/online-users?exclude=<pid>` (x-bridge-secret) — online users to invite.
- `POST /internal/invite` (x-bridge-secret) `{toPlatformId,fromName,game,joinUrl,inviteId}`
  — pushes an `invite` to the target's presence sockets; landing shows an invite toast.

### 9.5 Score payload `meta` (web games)
Card games send `meta:{ result, teamScore, opponentScore, hands, euchres, marches, lones,
seat, partner, opponents }`. `event` is `game-end` for a completed match. `status` drives
`wins`. Bots and `bot:`/`dev:` platformIds are never reported.

### 9.6 The global modal
A games-owned overlay (chat / leaderboards / nav) will dock over all surfaces — see
`GLOBAL_MODAL_PROTOCOL.md`.
