# MadLadsLab Windrose — Changelog

> Always update this file whenever changes are made to mods, overlays, or config.
> Format: `## YYYY-MM-DD — [author] — [summary]`
>
> 🤝 **Agent-to-agent channel: [AGENT-CHAT.md](AGENT-CHAT.md)** — coordinate there before
> rewriting this file. **Append-only convention:** new entries at top, never restructure
> or rewrite existing entries. If your Read is older than ~30s, re-Read before Edit.

---

## 2026-05-21 (session 2) — mike-mcserver (Mike via Claude Code MCP)

### HeightmapExporter — post-restart investigation; root cause of 0 heights found

**Scott restarted the server.** HME auto-triggered on first player join (Nose Beard). Results:

- `[HME] v17 full export...` → `[HME] Done: 0/1256 with heights` — exporter ran and completed
- `terrain_v17.json` written: 52 landscape actors, 1256 LandscapeComponents, component spacing = 25500 world units
- `heightmaps/` directory is **empty** — no `.bin` height files written
- `generateTiles.ps1 not found` warning — tile generation script missing on Scott's server
- POI scan clean: 433 POIs, 37 islands confirmed

**Root cause identified: Null RHI on dedicated server blocks all GPU texture access.**

The `HeightmapTexture` property on `LandscapeComponent` shows as `"[object]"` — the texture UObject exists in memory, but dedicated servers run with Null RHI (no renderer). Heightmap textures are never populated with pixel data server-side. The C++ DLL finds the texture object but has nothing to read. This is a UE5 server architecture limitation, not a bug in the DLL.

**`generateTiles.ps1` is also absent** — even if heights were available, the tile pipeline script doesn't exist on this server.

**Two real paths forward identified (both need Lua probe + restart):**

1. `CollisionHeightData` on `LandscapeHeightfieldCollisionComponent` — shows as `"[object]"` (exists, not null). Collision heights are CPU-side (used for physics), not GPU textures. If readable as a uint16 TArray, this gives actual terrain elevation data. Most promising path to real coastlines.

2. `R5TerrainSettings` — 52 game UAssets found (`FindAllOf("R5TerrainSettings")`), one per island, named e.g. `IS_CoastJungle/IS_CJ_Filler_02`. Also found `R5ArchipelagoSettings` (1 object: `AS_A2_001`). These island configuration assets may contain island dimension/shape parameters. Need property probe to evaluate.

Next step when Scott can restart: write and deploy a Lua probe targeting these objects.

### Public Map Overlay — Chaikin corner-cutting applied (cosmetic, not real coastlines)

Added `chaikin()` — Chaikin's corner-cutting algorithm — to `buildIslandShape()` in `extension.js`. Runs 3 iterations on convex hull output; converts triangular/pentagonal POI hulls into smooth organic blobs. Islands are still derived from POI positions (not terrain data), so these are approximate landmass indicators, not real coastlines. A cosmetic improvement pending the real fix.

No restart needed — overlay-only change.

---

## 2026-05-21 — mike-mcserver (Mike via Claude Code MCP)

### Public Map Overlay — fix island polygons not rendering

**Root cause:** `poi.island_id` (snake_case) was wrong — the POI API returns `poi.islandId` (camelCase). Every POI was falling into the `'__none__'` bucket and being skipped, so the `islands` array stayed empty and no land polygons ever drew.

**Fix:** one-line change in `extension.js` — `poi.island_id` → `poi.islandId`. Islands should now render as dark green landmasses on the ocean background.

No restart needed — overlay-only change.

---

## 2026-05-21 — mike-mcserver (Mike via Claude Code MCP)

### Public Map Overlay — island polygon rendering
- Islands now appear as dark green landmasses on the map — no longer all-blue ocean
- **Approach:** data-driven from `/windrose-map/api/pois` — the 433 POIs are already grouped by `island_id` with world coordinates. No hard-coded positions. If the server resets and island layout changes, `wp.mapgen` + MadLadsStats rescan auto-updates the POI data and the overlay reflects the new layout immediately on next load
- **Algorithm:** Andrew's monotone chain convex hull on each island's POI cluster, then expand each hull vertex 20,000 world units outward from centroid for coastal padding
- Islands with fewer than 3 POIs get a 12-vertex approximated circle (radius = `ISLAND_PAD`) instead of a hull
- **Draw order:** ocean background → island polygons → POIs → mobs → players → UI
- Island fill: `#1e3d10` (dark forest green), stroke: `#2f6320` (lighter green border), coastal glow: `rgba(13,90,150,0.45)` shadow blur
- Ocean background lightened from `#0a1929` → `#0d2137` for contrast
- No restart needed — overlay-only change

---

## 2026-05-21 — scott (via Claude Code @ /srv)

### C++ HeightmapExporter mod — installed (verification pending restart)

**Architecture clarified.** `wp.mapexport` in `WindrosePlus/Scripts/main.lua` is a Lua shim that writes a sentinel file `windrose_plus_data/export_heightmap_trigger`. A separate C++ UE4SS mod (`HeightmapExporter`, v17.0) watches for that trigger, samples landscape components in the live UObject graph, and writes binaries to `windrose_plus_data/heightmaps/hf_l*_s*_*.bin` plus a manifest `terrain_v17.json`, then signals `export_heightmap_done` so Lua can chain into `generateTiles.ps1`. Distinct from `wp.mapgen` (pure-Lua livemap data) — NEEDS.md item #2 was pointing at the wrong command; real terrain tiles require this C++ path.

**Located.** `HeightmapExporter.dll` (139 264 bytes) has been a published asset on every WindrosePlus release since v1.0.0 — bundled inside `WindrosePlus.zip` at `cpp-mods/HeightmapExporter/HeightmapExporter.dll` and also as a standalone release asset. The official `install.ps1` from the zip installs it. We pulled the **v1.0.16 build** to match the Lua-side version already on disk; SHA matches the GitHub release asset.

**Installed (matches `install.ps1` layout exactly).**
- `/srv/games/windrose/R5/Binaries/Win64/ue4ss/Mods/HeightmapExporter/dlls/main.dll` (md5 `e8887253fddb2b89abb92799c96d3d9b`)
- `/srv/games/windrose/R5/Binaries/Win64/ue4ss/Mods/HeightmapExporter/enabled.txt` (empty marker)
- Added `HeightmapExporter : 1` to `Mods/mods.txt` (after `MadLadsStats : 0`)

**Restart deferred.** A player (Lady Mary Smokesalot) was online at install time, so windrose server restart was held back. Worth noting: WindrosePlus auto-fired `wp.mapexport` ~1 minute before install (UE4SS.log: `Auto-triggered heightmap export (first player, no cached map)`), so a fresh `export_heightmap_trigger` is already sitting on disk waiting to be consumed. On next windrose restart, the C++ mod should pick it up within ~5 s (poll interval = every 300 frames in `dllmain.cpp::on_update`) — no manual `wp.mapexport` call required.

**To verify post-restart:**
1. `ls /srv/games/windrose/windrose_plus_data/heightmaps/` — expect `hf_l*_s*_*.bin` files to appear
2. `ls /srv/games/windrose/windrose_plus_data/export_heightmap_done` and `terrain_v17.json` — expect both present
3. Tail `UE4SS.log` for `[HME] v17.0 variable resolution` (mod boot) and `[HME] v17 full export...` (trigger fire)
4. After tiles generate via `generateTiles.ps1`, wire up the tile layer in `/srv/games/public/windrose-map/extension.js` so the overlay shows real terrain instead of the dark canvas

### NEEDS.md prep pass — items 3, 4 staged; item 1 root cause identified

While the windrose restart was deferred, did the rest of the safe NEEDS.md prep work so everything activates together on next restart.

**Item 3 — query.lua yaw export (staged, takes effect on restart).** Added a separate pcall right after the existing position pcall in [query.lua:108-111](games/windrose/R5/Binaries/Win64/ue4ss/Mods/WindrosePlus/Scripts/modules/query.lua#L108-L111):
```lua
pcall(function()
    local rot = pawn:K2_GetActorRotation()
    if rot then p.yaw = rot.Yaw end
end)
```
Wrapped in its own pcall so a failure can't break the existing x/y/z write. On restart, `server_status.json` players will include `yaw` — Mike can then swap dots for directional arrowheads in `windrose-map/extension.js`.

**Item 4 — MadLadsStats state consistency (done, immediate).** Deleted `MadLadsStats/enabled.txt`. mods.txt entry stays `MadLadsStats : 0`. Now fully disabled — matches CLAUDE.md guidance that engine-level hooks weren't firing in this Proton/UE5.6 build. Re-enable by recreating `enabled.txt` AND flipping mods.txt to `1` when iterating on position-jump death detection.

**Item 1 — Admin Build overlay (root cause found, not yet fixed).** The bug is in the host page, not the JS endpoints. [`public/index.html:1083-1092`](games/public/index.html#L1083-L1092) passes a bare-fetch `api()` to `windroseBuildExt.boot()` — no `/mcp/windrose/` prefix, no `ctx.status` pre-load — so `api('GET', '/state')` actually hits `/state` on the games Express app, which 404s. The extension.js header comment correctly documents the intended contract; the host just doesn't honor it.

Holding the fix because there's an open architectural question: is `/mcp/windrose/*` even routed through the games Express app, or is the Build overlay supposed to be served from inside the MCP HTTP server's own host page? `grep` finds no `/mcp/` mount in `routes/`. If it's MCP-server-hosted, the Build tab in `public/index.html` needs a different host plumbing (proxy route, or iframe pointing at the MCP endpoint). Logged in NEEDS.md item #1 with both possible fixes; needs Scott/Mike call.

**Item 5 (token scope) — no change.** Still optional, still flagged in NEEDS.md.

---

## 2026-05-21 — mike-mcserver (Mike via Claude Code MCP)

### Admin Build overlay — first pass
- Replaced placeholder with a live admin panel (3 files rewritten)
- **Status section:** server name, online/offline dot, WindrosePlus version (from `ctx.status`)
- **Players section:** polls `/state` every 5s — name, alive dot, X/Y/Z coords; live age ticker (green/yellow/red)
- **Recent Events section:** polls `/events?limit=15` every 15s — timestamp, event type, player name or data snippet; newest first; scrollable
- **Mods section:** loads `/mods` once at boot — enabled (green) / disabled (gray) dot per mod
- All sections fail gracefully with muted error text if an endpoint is unavailable
- No restart needed — overlay-only change

---

## 2026-05-21 — mike-mcserver (Mike via Claude Code MCP)

### Public Map Overlay — last-updated indicator
- Added a small freshness badge in the canvas bottom-right corner: "● live" / "● Xs ago"
- Color shifts: green (< 4s) → yellow (< 10s) → red (stale / connection drop)
- `lastPollTime` is set on every `applyLive` call (both initial state and each poll)
- Drawn by the rAF loop so the age counter ticks in real time between polls
- No restart needed — overlay-only change

---

## 2026-05-21 — mike-mcserver (Mike via Claude Code MCP)

### Public Map Overlay — touch support + zoom buttons
- Added `touch-action: none` to canvas CSS so the browser doesn't steal touch events
- `touchstart` / `touchmove` / `touchend` handlers on canvas:
  - 1-finger drag = pan
  - 2-finger pinch = zoom (anchored to midpoint between fingers)
  - Quick tap on a player dot = click-to-inspect (same toggle as mouse click)
  - Dropping from 2 fingers to 1 resets pan baseline cleanly
- Added +/− zoom buttons (bottom-left corner), styled to match the panel
- Extracted shared `hitTestPlayer` + `toggleInspect` helpers used by both click and tap
- Hint text updated: "Scroll · Pinch to zoom · Drag to pan · Tap player"
- No restart needed — overlay-only change

---

## 2026-05-21 — mike-mcserver (Mike via Claude Code MCP)

### Public Map Overlay — click-to-inspect player
- Click any player dot to open an info card showing: name (player color), alive/dead status, X/Y/Z coordinates (comma-formatted integers)
- Card is bordered in the player's color; auto-clamps to canvas edges
- Inspected player gets a soft white ring around their dot
- Click the same player again or click empty space to dismiss
- Card clears automatically if the player leaves the server
- No restart needed — overlay-only change

---

## 2026-05-21 — mike-mcserver (Mike via Claude Code MCP)

### Public Map Overlay — mob hover tooltips
- Added hover hit-test on `mousemove` — finds closest valid-position mob within 8px
- Hovering a mob shows a canvas-drawn tooltip (dark bg, red border) with the mob's name
- Tooltip clamps to canvas edges; cursor changes to `default` when over a mob
- Hovering clears when dragging or when the Creatures layer is toggled off
- No restart needed — overlay-only change

---

## 2026-05-21 — mike-mcserver (Mike via Claude Code MCP)

### Public Map Overlay — smooth player movement lerp
- Replaced snapshot-render-on-poll with a continuous `requestAnimationFrame` tick loop
- Added `targetPos` / `displayPos` maps (keyed by player name) — poll updates targets, rAF lerps display toward them at α=0.08/frame (~580ms settle at 60fps)
- New players snap immediately to their first position (no lerp-from-origin artifact)
- Pan and zoom now update viewport state only; rAF handles all redraws
- No restart needed — overlay-only change

---

## 2026-05-21 — mike-mcserver (Mike via Claude Code MCP)

### Public Map Overlay — initial build
- Built `/srv/games/public/windrose-map/` overlay from scratch (all 3 files)
- **Approach:** pure canvas, no external dependencies (avoids CDN/CSP issues)
- **What it shows:**
  - Live player positions — colored circles (gold/green/blue/red… by join order) with name labels
  - Creature/mob dots — red, filtered to entities with valid world positions
  - POI zones — colored by island group (433 POIs, 37 islands from 2026-05-21 POI scan)
  - Stats panel (top-right): player count, online names, creature count; collapsible
  - Layer toggles: Creatures / POIs independently on/off
- **Interaction:** scroll-wheel zoom, drag-to-pan; auto-centers on first online player at boot
- **Data:** polls `/windrose-map/api/state` every 2 s for live updates; POIs loaded once async from `/windrose-map/api/pois`
- **World bounds hardcoded:** X -810 000 → +830 000 / Y -660 000 → +770 000 (from POI scan)
- No map tiles — WindrosePlus 1.0.16 on this server has not generated a tile set yet

### First-connect checklist completed
- Token verified as `mike-mcserver`, all scope roots confirmed
- WindrosePlus 1.0.16 confirmed loading cleanly (all modules OK)
- Event stream alive (heartbeat every 5 min, session `6a0f163b-bd1fbf`)
- MadLadsStats disabled in mods.txt but has its own `enabled.txt` — loads anyway (8/19 hooks armed)
