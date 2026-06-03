# Global Modal Protocol — the Arcade overlay — v0 (design)

**Status:** BUILT (v0 live) · **Started:** 2026-05-30 · **Shipped:** 2026-05-30 · **Owned & served by:** `games`

A single overlay, implemented once and run by `games`, that **docks over the top of every
Arcade surface** (portal, match, cards, hex/Towers) and provides three things without the
player leaving their current table:

1. **Global chat** — one Arcade-wide room (screen names only).
2. **Leaderboards** — cross-game standings, read from the existing webgame API.
3. **On-the-fly navigation** — jump to any other Arcade game from anywhere.

It is the *one* shared chrome of the Arcade. Platforms embed it with a single line; all the
logic, data, and identity live in `games`.

---

## 1. Why iframe + owned-by-games

The modal must work **same-origin to games** (so it has the games session/socket for chat &
leaderboards) while being shown on **cross-origin** surfaces (cards, match, hex). The clean
solution is a **games-served panel embedded as an iframe overlay**:

- The panel page is `games /modal/panel` → same-origin to games → its socket/API/cookies
  "just work".
- The host surface only loads a tiny `loader.js` that injects a launcher button + the iframe
  and relays identity. The host never touches chat/leaderboard logic.

No cross-site cookie/CORS gymnastics; one implementation; instant updates everywhere.

---

## 2. Components (all under `games`)

```
/srv/games/public/modal/loader.js     injected by each surface; mounts launcher + iframe overlay
/srv/games/routes/modal.js            GET /modal/panel (the UI), GET /modal/catalog, POST /modal/ticket/verify
/srv/games/public/modal/panel.html    the overlay UI: tabs Chat | Leaderboards | Games
/srv/games  app.js                    io.of('/global')  — global chat + presence-backed roster
/srv/games/lib/global-chat.js         in-memory ring (last N) + capped Mongo collection; rate limit
```

Reuses what already exists: `/api/webgame/leaderboard/:slug` & `/recent/:slug` (leaderboards),
`lib/presence.js` (who's online), `username.displayFor` (screen names), the arcade registry
(`webgames.json`) for the Games tab.

---

## 3. Embedding (one line per surface)

Each Arcade page adds:
```html
<script src="https://games.madladslab.com/modal/loader.js" defer
        data-surface="cards" data-game="euchre"></script>
```
`loader.js`:
1. injects a floating launcher (💬/▲) bottom-left and a hidden iframe overlay
   (`games /modal/panel#surface=<surface>`),
2. obtains an identity token for the iframe (see §4) and `postMessage`s it in,
3. toggles the overlay open/closed; the iframe is `allow`-scoped and pinned `position:fixed`.

Surfaces to embed: portal landing, match intake, cards lobbies/tables (euchre, hearts),
hex lobbies/tables (td). Portal embeds the panel directly (same-origin, no iframe needed).

---

## 4. Identity across origins (the modal ticket)

The panel needs to know the **screen name + platformId** of the viewer.

- **On the portal** (same-origin to games): use the games session directly. No ticket.
- **On cross-origin surfaces**: the surface already holds the player's identity from the
  SSO bridge and shares `BRIDGE_SECRET`. It mints a **modal ticket** (HS256, ~5 min):
  `{ platformId, displayName(screen name), surface, iat, exp }`, and passes it to the iframe
  via `postMessage` (target origin `https://games.madladslab.com`). The panel calls
  `POST /modal/ticket/verify` (or verifies inline) and binds the chat/roster identity to it.

Privacy: the ticket carries the **screen name only**; the panel renders screen names only;
chat requires a valid identity (no anonymous posting). `frame-ancestors` is restricted to
`*.madladslab.com`.

---

## 5. Global chat (`/global` namespace)

- `io.of('/global')` on games; auth via games session (portal) or a verified modal ticket
  (embedded). On connect, the user joins the single Arcade room and the roster.
- client→server `chat:send {text}` (trimmed, ≤500 chars, rate-limited ~1/sec).
- server→client `chat:msg {from(screen name), surface, text, ts}` to the room;
  `chat:history [..lastN..]` on join; `roster {users:[{name,surface}]}` on change.
- Persistence: `lib/global-chat.js` keeps an in-memory ring (last ~100) for instant history
  and optionally a capped Mongo collection for durability. Screen names only; no PII.
- Moderation hooks reuse platform `isAdmin` from the session/ticket (mute/clear).

`surface`/`data-game` lets a message show context ("[euchre] Ropadope: gg").

---

## 6. Leaderboards tab

- **Per-game**: `GET /api/webgame/leaderboard/:slug` for each registered arcade game.
- **Master (cross-game)**: a new `GET /api/webgame/leaderboard` (no slug) that aggregates
  `webgame_leaderboard` across games → total wins / games / win-rate per player. (Small
  addition to `routes/api.js`.)
- Tabs/among games come from the arcade registry; "your record" uses `/api/webgame/me`.

---

## 7. Games tab — on-the-fly navigation

- Lists the arcade catalog (`/modal/catalog`, derived from `webgames.json`, status `live`).
- Selecting a game navigates the **top window** to `/arcade/:slug/play` (→ bridge → match
  intake), i.e. the player hops tables/games without manually returning to the portal.
- The current surface/game is highlighted; "Back to Arcade" → portal.

---

## 8. Build order
1. `lib/global-chat.js` + `io.of('/global')` + `/modal/panel` + `panel.html` (chat first,
   tested on the portal same-origin).
2. `loader.js` + modal ticket mint/verify; embed on **match** and **cards** (euchre) and test
   cross-origin chat + identity.
3. Leaderboards tab (+ master aggregate endpoint) and Games/nav tab.
4. Embed on hex/Towers once that platform exists.

## 9. Open decisions
- Launcher placement/coexistence with each surface's own UI (cards end-screen, match buttons).
- Chat durability (in-memory ring only vs capped collection) and history depth.
- Whether the master leaderboard ranks by total wins, win-rate (min games), or a blended score.


---

## 10. Build notes (shipped 2026-05-30)
Implemented per the build order. Steps 1–3 are live; step 4 (hex/Towers) waits on that platform.
- `lib/global-chat.js` — in-memory ring (last 100), per-sender rate limit (~0.9s), 500-char cap, screen names only.
- `io.of('/global')` in app.js — auth via games session (portal) OR a verified modal ticket in
  `socket.handshake.auth.ticket` (cross-origin). One room (`arcade`), roster, `chat:history` on join,
  `chat:send`/`chat:msg` with a `surface` tag, admin `chat:clear`.
- `routes/modal.js` mounted at `/modal`: `GET /panel`, `GET /loader.js`, `GET /catalog`,
  `POST /ticket/verify`. Panel sets `frame-ancestors 'self' https://*.madladslab.com`.
- `public/modal/panel.html` — tabs Chat | Leaderboards | Games. Leaderboards use the existing
  per-game API plus a NEW master aggregate `GET /api/webgame/leaderboard` (no slug → per-player
  wins/games/win-rate across all games). Games tab navigates the TOP window to `/arcade/:slug/play`.
- `public/modal/loader.js` — one-line embed; injects a bottom-left launcher + left-docked iframe
  overlay; on cross-origin surfaces POSTs the host's `/modal-ticket` (session→signed JWT, shared
  BRIDGE_SECRET) and relays it to the panel via postMessage(targetOrigin=games). Portal is
  same-origin → no ticket (session path).
- Mint endpoints added: cards `POST /modal-ticket`, match `POST /modal-ticket` (both 401 w/o session).
- Embedded on: portal landing, match intake, cards euchre + hearts. (Towers later.)
- Verified: cross-origin two-client chat (ticket auth, history, roster, surface-tagged delivery);
  no-auth socket correctly rejected; master leaderboard aggregation; all surfaces serve the loader.
- Decisions taken: master board ranks by total wins (then win-rate, then games); chat is in-memory
  ring only (no Mongo persistence yet); launcher pinned bottom-left to avoid each surface's own UI.
