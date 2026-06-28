# Blender × SD Asset Protocol — v1 (draft)

**Status:** draft · **Started:** 2026-06-03 · **Companion to:**
`/srv/SIEGE_KIT_PROTOCOL.md` (instances/skins), `/srv/games/WEBGAMES_PROTOCOL.md`
(identity/wallet). **Applies to:** every Three.js surface in the lab — today
**towers** (`/srv/td`) and **madlands** (`/srv/madlands`); the SD generators are
shared across `tiles`, `cards`, etc.

This document is the source of truth for how **two asset pipelines layer into one
scene**: a **geometry** pipeline (Blender / procedural native shapes → glTF/GLB
or runtime primitives) and an **SD** pipeline (Stable Diffusion via the Ollama
tunnel → PNG textures/backdrops). It exists so a scene is *built once from native
objects* and then *progressively skinned* — SD paints the flat layers, Blender
replaces the volumetric ones — with no change to placement, gameplay, or netcode.

---

## 1. The cross (core principle)

> Every native-built object is a **placeholder slot**. An SD texture and/or a
> Blender GLB may layer onto or replace it at any time, addressed purely by an
> asset path. If the asset is absent, the native fallback renders. Nothing about
> tile coordinates, stats, or events changes.

Two proven fallback chains, already live:

- **Geometry:** `Blender GLB → native primitive`. See `td` `entities/tower.js`
  (`gltfUrl` loads, else cylinder+barrel) and `madlands` `geomFor(category)`.
- **Texture:** `SD PNG → palette tint`. See `madlands` `applyEnvironment` (loads
  `groundUrl`, else tints `scene.background` from `env.palette`).

Layering is therefore **additive and reversible**: ship the scene on primitives
today, drop in art as it renders, never block on either pipeline.

---

## 2. Roles / owners

| Concern | Owner |
|---|---|
| Scene composition + which layers exist | **This protocol** (the layer stack, §4) |
| Volumetric assets (units, landmarks, vessels) | **Geometry pipeline** (§3a) |
| Flat assets (backdrops, grounds, base-color textures, thumbnails) | **SD pipeline** (§3b) |
| Where an asset lives + its naming/fit contract | **§5 asset contracts** |
| What each scene currently has vs needs | **scene manifest** (`/srv/scene-layers.manifest.json`, §6) |
| Stats / targeting / events | **Game engine** — never touched by either pipeline |

---

## 3. The two pipelines

### 3a. Geometry (Blender / native)
Emits glTF/GLB (or builds primitives at runtime). All conform to the **fit
contract** (§5).

| Artifact | Kind | Output |
|---|---|---|
| `td/scripts/gen-gltf-towers.js` | procedural→embedded glTF | system mechs (placeholder) |
| `td/scripts/blender-gen-mechs.py` | Blender bpy → glTF | system mechs (upgrade; needs a Blender host) |
| `td/scripts/gen-gltf-skins.js` | procedural→binary GLB | the 4 per-kind defender skins |
| `madlands` `geomFor` / `placeObjects` / `placeNpcs` | runtime primitives | landmarks, NPCs, monsters |
| `madlands` `cosmos.js` `makeObject` + vessel marker | runtime primitives | cosmos objects, ship/rover/figure |

**Blender MCP note:** when a Blender host is connected, the `.py` generators run
through it; absent one, the `.js` procedural generators stand in (same paths,
same fit contract), so the geometry layer never blocks.

### 3b. SD (Stable Diffusion via Ollama tunnel)
Emits PNGs. Tunnel base: `ollama.madladslab.com` (see `td/config` `ollama.baseUrl`).
Existing generators: `gen-scene-art.js`, `gen-biome-backgrounds.js`,
`gen-tower-art.js` (picker thumbnails), `gen-card-art.js`, `gen-enemy-art.js`,
`gen-level-banners.js`, `gen-resource-art.js`, `gen-ui-art.js`,
`gen-story-portraits.js`. **Empty-result rule:** an SD run can come back blank
(observed on a madlands ground prompt); the consumer MUST keep the palette/tint
fallback so a blank render degrades, never breaks.

---

## 4. The layer stack

A scene is composed bottom-up. Each layer declares a **source** (`sd` / `blender`
/ `native`) and a **fallback**.

| Layer | Content | Source | Fallback | Today |
|---|---|---|---|---|
| **L0 Backdrop** | sky / env image (`scene.background`) | SD | palette tint | madlands `env.skyUrl`; towers `sceneEnvFor.skyUrl` (unwired) |
| **L1 Ground** | tiled terrain texture | SD | palette tint | madlands `env.groundUrl`; towers `ground-terrain.png` |
| **L2 Board/terrain** | hex tiles + scatter (trees/rocks/mountains) | native | — | `buildHexBoard`; towers `sceneryRenderer.populate` |
| **L3 Landmarks** | structures, vehicles, items, hazards | Blender→native | primitive | madlands `geomFor`; (towers map scenery) |
| **L4 Actors** | defenders, enemies, NPCs, vessels, avatar | Blender→native | primitive | towers `skinFor`→GLB; enemies GLB; madlands NPC/monster/marker primitives |
| **L5 FX / markers** | beacons, rings, muzzle, projectiles, contest icons | native (+SD sprites) | — | both engines |
| **Audio** | generative score | procedural | — | madlands `music-engine.js` |

Rule of thumb: **SD owns L0–L1 (and any L3/L4 base-color textures); Blender owns
L3–L4 volume; native owns L2/L5 and every fallback.**

---

## 5. Asset contracts & paths

**Geometry fit contract** (from `td/entities/tower.js#fitTowerModel`, applies to
every L3/L4 GLB): base sits on `y=0`; footprint roughly square (auto-fit scales
to the tile, so proportion matters, not absolute size); **front faces −Z**
(barrel/muzzle), so aim/recoil/muzzle math lines up. Per-object size trim is the
`scale` field on the definition.

**Paths & naming**
- Defender skins (per-kind fallback): `td/public/assets/models/skins/<kind>-<role>.glb`
  — keyed by `skins.js#KIND_THEME[kind].defenderGltf`.
- System mechs (per-tower model): `td/public/assets/gltf/system/<slug>.gltf`
  — keyed by the `Tower.gltfUrl` seed.
- SD scene art: `td/public/assets/img/scene/<key>-{sky,ground,env}.png`
  — keyed by `sceneEnvFor(kind)` / madlands `env.{skyUrl,groundUrl}`.
- Picker thumbnails: `td/public/assets/img/towers/<slug>.png` (`Tower.thumbnailUrl`).

**Kind ↔ theme mapping** lives in exactly one place per app: `skins.js`
(`KIND_THEME`: label, palette, scenery biome, `defenderGltf`, bg pair, muzzle).
Madlands maps its scale ladder onto kinds via `kindFromMadlands(tier, interiorKind)`.

---

## 6. The scene manifest

`/srv/scene-layers.manifest.json` is the machine-readable inventory: for each
scene (the four siege **kinds** + the madlands **tiers**), it lists L0–L5 with
`{ source, asset, status }` where `status ∈ native|sd|blender|missing`. It is the
"begin layering" worklist — regenerate it as assets land. It carries **no
gameplay data**; it only tracks which slot is filled by what.

---

## 7. Per-game application

**towers (engine):** on `tower:placed`, resolve `skinFor(kind, tower)` for L4
(done); wire `sceneEnvFor(kind)` for L0/L1 (pending — needs the 3 missing kind
backdrops, §9). `sceneryRenderer.populate` is L2.

**madlands (world):** `applyScene(path)` already runs the full stack —
`applyEnvironment` (L0/L1) → `applyTiles` (L2) → `placeObjects` (L3) →
`placeNpcs`/markers (L4) → `playMusic`. New objects enter as `geomFor` primitives
(L3/L4) and upgrade to GLB in place via a single `makeObject` route.

---

## 8. Active threads folded in (2026-06-03)

1. **td/madlands refinements** — player vessel marker is native (ship/rover/
   figure); route it + cosmos objects through one `makeObject` so a single
   `ship.glb` (L4 Blender) covers both. Space/planet/cave **backgrounds** are L0
   SD work. Unit/board scale is an L2/L4 concern (bigger footprints, larger
   `HEX.SIZE`).
2. **madlands build-engine** — `geomFor` categories are the L3 placeholder
   vocabulary; SD ground is L1 (honor the empty-result fallback).
3. **tiles SD/Ollama tunnel** — the L0/L1 generation transport; all SD layers
   call it.

---

## 9. Conform checklist (new scene or surface)

1. Build it on native primitives first (L2–L5) — playable immediately.
2. Register the scene in `scene-layers.manifest.json` with every slot `native`/`missing`.
3. Fill L0/L1 via the SD pipeline → flip those slots to `sd`; keep the tint fallback.
4. Replace L3/L4 placeholders with Blender GLBs at the contracted paths → `blender`.
5. Never move placement/stats between layers; the manifest is cosmetic truth only.

---

## 10. Integration log

- **2026-06-03** — v1 drafted. Unifies the geometry (Blender/procedural) and SD
  pipelines as a single additive layer stack (L0–L5 + audio) over the existing
  towers + madlands renderers. Codifies the placeholder-first cross rule already
  live in `tower.js` and `madlands/app.js`. Folds in three active threads
  (vessel-marker/backgrounds/scale, geomFor/SD-ground, SD/Ollama tunnel). Seeded
  `scene-layers.manifest.json` as the layering worklist.
