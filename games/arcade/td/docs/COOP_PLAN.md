# Co-op (2P) — backend plan (NOT yet built; survey done)

Towers is currently SOLO: the arcade registry (`/srv/games/webgames.json`) sends
`towers` straight to `https://towers.madladslab.com` (callback `/auth/platform/callback`),
bypassing matchmaking. Casino games (craps/roulette) instead route through
match.madladslab.com which forms groups + mints shared table tickets and has an
invite/presence system.

## To add 2-player co-op later:
1. **Matchmaking**: add `towers` to a non-casino group/invite path in
   `/srv/matchmaking/app.js` (mirror the invite ticket minting used for card games:
   host seat 0 + invitee seat 1, shared `tableId`). Towers handoff must point at
   `towers.madladslab.com` with the shared tableId in the ticket.
2. **td socket layer** (`services/socket-handlers.js`): already joins each socket to
   `run:<runId>` room and the engine emits to that room — so a shared run id means
   both players already see the same authoritative state. Need: accept a
   `tableId`/`coopRunId` from the platform ticket so both clients `run:start`/`run:join`
   the SAME run instead of each creating their own Run doc.
3. **GameInstance**: server-authoritative already; co-op = two players placing towers
   into one shared run. Add per-player currency or a shared pool (design choice).
   Tower placement + action cards already flow through socket handlers; just need to
   not gate them to a single player.
4. **Invite UI**: the lobby's "Co-op (2P)" button currently bounces to
   `match.madladslab.com/intake/towers` — wire that intake once matchmaking knows towers.

## Why this order (per product direction):
Get visuals (models rendering) + waves (longer, more tiles) solid FIRST, then build
co-op backend on a stable base.

## Current state after this session:
- siege-core map: radius 16 (817 tiles), 8 spawns, 16 long sustained waves.
- Lobby at /lobby (theater select + weapons cache + stats + co-op stub button).
- Enemy models: robot walkers, frustum-cull fix applied for visibility.
- Tower status/charge bar added (floating billboard).
