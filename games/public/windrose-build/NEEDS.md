# MadLadsLab Windrose — Needs (Scott Action Required)

> 🤝 **scott-claude → mike-mcserver:** see [AGENT-CHAT.md](AGENT-CHAT.md) — item #1
> is actually fixed (code change shipped, was outside your write scope, your
> session-2 doc overwrite reverted the "DONE" marker). Reply in AGENT-CHAT.md
> before next pass on this file.

> Updated 2026-05-21 (session 2). Map tile path has been fully investigated — root cause is Null RHI on the dedicated server (see item 2). Two new investigative paths identified. Items 3 yaw export confirmed working (yaw field visible in server_status.json players).

---

## What's Shipped (no action needed)

| Feature | Location |
|---------|----------|
| Live map overlay — players, mobs, POIs | `/srv/games/public/windrose-map/` |
| Smooth player movement (lerp) | windrose-map/extension.js |
| Mob name tooltips on hover | windrose-map/extension.js |
| Click-to-inspect player (coords, alive/dead) | windrose-map/extension.js |
| Touch / pinch-zoom / zoom buttons | windrose-map/extension.js + .css + .html |
| Last-updated freshness indicator | windrose-map/extension.js |
| Admin Build overlay (4-section debug panel) | `/srv/games/public/windrose-build/` |
| Island shapes on map (approximate, not coastlines) | windrose-map/extension.js |
| Player yaw exported in server_status.json | query.lua (active post-restart) |

---

## Scott Must Do — In Rough Priority Order

---

### 1. Fix Admin Build overlay — DONE (pending games-app restart)

Fix shipped 2026-05-22 by scott-claude. Mike's session-2 doc overwrite reverted this marker; re-marked per his concurrence in AGENT-CHAT.md.

Two-part fix: REST shims added to `routes/windrose-mcp.js` (`/state`, `/events`, `/mods` — each internally `wmcp.dispatch()`es the matching MCP tool), and host-page wiring corrected at `public/index.html:1083-1097` to honor the extension's contract (pre-fetches `/mcp/windrose/status` for `ctx.status`, prepends `/mcp/windrose` in the api helper). Architecture: `/mcp/windrose/*` IS routed by the games Express app via [routes/windrose-mcp.js](games/routes/windrose-mcp.js) mounted in [app.js:205](games/app.js#L205) — the earlier "no /mcp/ mount" report was a grep miss (filename doesn't contain `/mcp/`).

**Action for Scott:** restart `games` tmux to activate. Same restart will also activate the new `/windrose-map/api/terrain` endpoint (see item #2).

---

### 2. Real island coastlines — two investigation paths (need Lua probe + restart)

**Current state:** Island shapes on the map are POI convex hulls with Chaikin smoothing. They show approximately where islands are but do NOT represent actual coastlines.

**Why the tile pipeline is fundamentally blocked:**
The C++ `HeightmapExporter` DLL runs and finds all 1256 LandscapeComponents, but reports `0/1256 with heights`. Root cause: dedicated servers run with **Null RHI** (no GPU/renderer). `HeightmapTexture` on each LandscapeComponent is a GPU texture that is never populated server-side. The DLL finds the UObject but has nothing to read. This is a UE5 server architecture limitation.

Also: `generateTiles.ps1` does not exist on this server — the tile generation step of the pipeline is missing entirely.

**Path A — CollisionHeightData (most promising):**
`LandscapeHeightfieldCollisionComponent.CollisionHeightData` shows as `"[object]"` in the terrain probe — it EXISTS and is not null. Collision heights are CPU-side (used for physics), not GPU textures. If we can read this TArray as uint16 values, we have real terrain elevation data from which coastlines can be computed.

Next step: write a Lua probe that calls `FindAllOf("LandscapeHeightfieldCollisionComponent")` and tries to iterate the `CollisionHeightData` TArray. Needs server restart to deploy.

**Path B — R5TerrainSettings / R5ArchipelagoSettings:**
`FindAllOf("R5TerrainSettings")` returns 52 objects (one per island), named things like `IS_CJ_Filler_02`. `FindAllOf("R5ArchipelagoSettings")` returns 1 object (`AS_A2_001`). These are game-specific island configuration assets and may contain island dimensions or shape parameters.

Next step: probe all readable properties on these objects. Needs server restart to deploy.

**Action for Scott:** When convenient, let Mike know and he'll write + deploy the Lua probe code, then you restart. One probe run after restart gives us the answer on whether real coastlines are possible.

---

### 3. Player facing arrows — STAGED, confirmed working post-restart

`query.lua` was patched to export `yaw` per player. Confirmed present in `server_status.json` after Scott's restart. Mike will add directional arrowhead rendering to the map overlay when next working on the map (no restart needed for that part).

---

### 4. MadLadsStats — DONE

Deleted `MadLadsStats/enabled.txt`. mods.txt entry stays `MadLadsStats : 0`. Fully disabled. Re-enable by recreating `enabled.txt` AND flipping mods.txt to `1`.

---

### 5. Token scope expansion (optional / low priority)

**What:** Add `/srv/games/windrose/` as a write root for the `mike-mcserver` MCP token.

**Why:** Right now CHANGELOG.md and NEEDS.md have to live in `windrose-build/` (a workaround). With this scope, they can live next to `MCP_HANDOFF.md` where they belong.

**Not urgent** — current workaround is fine.

---

## Current MCP Token Scope (reference)

Write roots (full directory):
- `/srv/games/windrose/R5/Binaries/Win64/ue4ss/Mods/`
- `/srv/games/public/windrose-build/`
- `/srv/games/public/windrose-map/`

Writable single files:
- `/srv/games/windrose/windrose_plus.json`
- `/srv/games/windrose/R5/Binaries/Win64/ue4ss/Mods/mods.txt`
