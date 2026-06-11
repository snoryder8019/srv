# /srv/_shared — Arcade shared toolkit (single source of truth)

Canonical copies of cross-game modules live in `js/`:
- **audiobus.js** — master+channel WebAudio mixer (music/crowd/dealer/fx/win),
  applause, dealer voice, beds, and a popover mixer UI. `createAudioBus({channels:[...]})`.
  Exposes `context()` + `channelNode(ch)` so a game can synthesize its own
  effects onto the shared channels and inherit the shared mixer/mute.
- **casino-ui.js** — popover/panel/modal kit (leaf module).
- **cards-render.js** — card table visual + animation layer.

## How games consume it
- **ES module imports** (reels slot.js, tiles *3d.js): import directly + stampless
  from `https://games.madladslab.com/shared/js/<file>`. Served by the games portal
  (`app.js` `/shared` mount) with CORS scoped to ALLOWED_ORIGINS and
  `Cache-Control: max-age=60, must-revalidate` — edits propagate in ~1 min, no
  consumer changes needed.
- **Plain `<script>`** (cards/tiles HTML loading cards-render): can't cross-origin
  cleanly, so they keep a LOCAL copy synced by `sync.sh`.

## Editing
1. Edit the file in `/srv/_shared/js`.
2. Run `/srv/_shared/sync.sh` (copies plain-script consumers; modules auto-update).
3. No service restart needed (all static).
