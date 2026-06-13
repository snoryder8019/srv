# Tile Games Protocol — tiles.madladslab.com — v0

**Status:** BUILT (dominoes live) · **Shipped:** 2026-05-30 · **Port:** 3625 · **Mirrors:** cards

The **tiles** platform is to tile games what **cards** is to card games: a shared scaffold
owning everything generic (identity handoff, seating, table lifecycle, turn clock + wait/kick
vote, end-game, stats/activity export, reconnect, global modal) and delegating game rules to a
**variant** in a subfolder. Engine differs from cards (tile sets/walls vs a 52-card deck);
every cross-cutting protocol is shared. See /srv/ARCHITECTURE.md.

## Layout (mirror of cards)
```
/srv/tiles/
  engine/      @mll/tiles-engine: tile.js (domino bones + mahjong tiles), bag.js (wall/boneyard
               shuffle/deal/draw), rng.js (shared seedable), index.js barrel. protocol tilegames/v1
  lib/         table.js (TileTableRuntime: 2-4 seats, per-seat scoring, turn clock + vote, end-game,
               rematch/reseat), tables.js (registry + findSeatByPlatformId), tickets.js, stats.js
               (individual scoring; variant picks high/low via winnerSeat), variants/index.js
  dominoes/    config.js meta.json index.js  (first variant — block/draw dominoes)
  services/socket.js   Socket.IO transport — IDENTICAL event set to cards (join/ready/addBot/
               action/vote/rematch/reseat/exit; state+seat:hand+event+over). botSeatsToAct aware.
  routes/auth.js  public/  app.js  config/  .env
```

## Variant contract (tiles)
`id` + `meta.json` + hooks: `startHand(table,rng)`, `currentTurn(table)`, `legalActions(table,seat)`,
`applyAction(table,seat,action) -> {ok,events,handOver,gameOver}`, `botAction(table,seat)`,
`publicView(table)`, `privateView(table,seat)`, and the individual-scoring seams
`gameResult/standings/resetMatch`. The private view is AUTHORITATIVE and self-contained
(carries `yourTurn`, `turn`, decision counters) — clients drive actions off it, never by
cross-referencing the public state (avoids the stale "illegal" race, same lesson as hearts).

## Dominoes (block/draw, double-six, 4 players, 7 each)
Highest double/bone opens; match a bone to an open END (endL/endR); draw from the boneyard when
stuck else pass; going out or a block ends the hand; the hand winner scores opponents' remaining
pips; first to target (default 100) wins; HIGHEST total wins (individual). Verified: 25/25 all-bot
games valid; full game over the live websocket with 0 illegal plays; stats exported.

## Multi-platform matchmaking (the integration)
matchmaking now aggregates the catalog from EVERY platform in config.platforms (cards + tiles),
tags each game with its platform key, and routes go/invite/share/resume to that game's own
public lobby + internal API. findActiveSeat() searches all platforms for reconnect. Adding a
platform = one config block; its games appear in matchmaking + the arcade automatically.

## Ops TODO
- Add tiles to auto-start-npm.json + service-watchdog.json (currently tmux-only, like several others).
- Mahjong is the next variant (136/144-tile set already in the engine; melds/scoring not yet built).
