# Siege-Kit Protocol — v1 (draft)

**Status:** draft · **Started:** 2026-06-03 · **Canonical kit:** `/srv/siege-kit`
**Companion to:** `/srv/games/WEBGAMES_PROTOCOL.md` (identity, wallet, leaderboard)

This document is the source of truth for **siege/attack instances**: short,
self-contained tactical fights that a **world** opens and a **siege engine** runs,
then hands back. It exists so the towers combat loop is no longer welded to the
towers lobby — any world (today: **madlands**) can open an instance, and any
engine that speaks this protocol (today: **towers**) can run it.

> Relationship to WEBGAMES_PROTOCOL: that protocol owns *who the player is* and
> *the global coin wallet*. This protocol owns *what a single fight is* and *how
> a world and an engine hand a player back and forth*. Siege-kit calls the
> platform wallet; it does not replace it.

---

## 1. Roles

| Concern | Owner |
|---|---|
| World map, exploration, where instances live | **World** (madlands) |
| Running a fight (waves, towers, win/lose) | **Engine** (towers) |
| Player identity + permissions | **Platform** (games.madladslab.com) |
| **Coins** (single global currency) | **Platform wallet** (chips) |
| Instance contract, skins, inventory + salvage math | **siege-kit** (shared, pure) |

A **tower** is a *defender*. Its mechanics are identical in every instance; only
its **skin** changes per kind (see §5). "Tower" is the engine's word for the unit;
"defender" is the protocol's neutral word.

---

## 2. The kit (`/srv/siege-kit`)

Dependency-free ES modules. Pure modules are browser-safe; `token.js` is
server-only (uses `node:crypto`).

| Module | Env | Responsibility |
|---|---|---|
| `descriptor.js` | any | Build/validate the InstanceDescriptor; launch + return URLs; kind mapping |
| `skins.js` | any | One-defender-many-skins registry; per-kind scenery/palette/bg |
| `economy.js` | any | Locational inventory, 50/50 death salvage, coin rewards + buyback |
| `token.js` | server | HMAC-sign/verify a descriptor for safe browser transit |
| `index.js` | any | Re-exports the pure modules |

**Independence:** each app **vendors** the kit (copies it into its own tree, e.g.
`/srv/td/services/siege/` and `/srv/madlands/services/siege/`) and conforms to
this doc. `/srv/siege-kit` is the canonical source; per-app copies are the
runtime artifact. This keeps towers' "no cross-service imports" rule intact — the
kit is a deliberate shared *spec*, not a borrowed sibling internal. Bump the
copies when this version bumps.

---

## 3. The InstanceDescriptor

The single payload a world hands the engine. Built with
`buildDescriptor(...)`, shaped:

```json
{
  "v": 1,
  "kind": "dungeon|building|ground|space",
  "biome": "<art/palette key>",
  "origin": { "world": "madlands", "path": "3,-1/0,2", "hexKey": "0,2", "tier": "interior" },
  "board":  { "mapId": null, "seed": 123456, "radius": null },
  "loadout":{ "location": "3,-1/0,2" },
  "ret":    { "url": "https://madlands.madladslab.com/?path=3,-1/0,2" },
  "pacing": 1,
  "platformId": "<id>",
  "iat": 0
}
```

- **kind** — the four siege themes. Mechanics identical; skins differ.
- **origin** — where in the world this opened. `kindFromMadlands(tier, interiorKind)`
  maps madlands' scale ladder onto a kind (interior+ship → `space`, zone → `ground`, …).
- **board** — `mapId` pins an authored engine map; else the engine generates from
  `seed` (deterministic per path) at `radius`.
- **loadout.location** — the inventory bucket to deploy from (§6). Defaults to the path.
- **ret.url** — absolute return into the world at this path.
- **pacing** — global wave-speed multiplier (1 = normal, `<1` slower). The "waves
  too fast" knob lives here; the engine multiplies spawn cadence by it.

---

## 4. Launch & return flow

```
WORLD (madlands)                         ENGINE (towers)
  player picks "Lay Siege" on a hex
  desc = buildDescriptor({kind,biome,path,returnUrl,platformId})
  token = signDescriptor(desc, BRIDGE_SECRET)        // server-side
  302 -> launchUrl(ENGINE_ORIGIN, token)  ───────►   GET /play?siege=<token>
                                                     verifyDescriptor(token, BRIDGE_SECRET)
                                                     validateDescriptor(desc) -> open instance
                                                     deploy from inventory bucket (desc.loadout.location)
                                                     run waves at desc.pacing, skinned by desc.kind
                                  ◄─── on end ───    report to platform (/internal/webgame/score)
                                                     credit coins = economy.coinsForRun(...)  (wallet)
  GET <ret.url>?siegeResult=...&coins=...  ◄──302──  returnUrl(desc, result)
  apply salvage on death (economy.salvageOnDeath)
  resume world at path
```

- The descriptor rides as an **opaque signed token**, never readable params, so a
  player can't forge an easier board or a richer loadout. Same trust model as the
  SSO bridge; same `BRIDGE_SECRET`.
- Coin credit happens **engine-side** on end (it owns the run outcome + loot).
- Salvage application happens **world-side** on return (it owns the ship/inventory).

---

## 5. Skins — one defender, many looks

`skins.js` is the only place kind→appearance lives.

- `skinFor(kind, tower)` → `{ gltfUrl, color, scale, label, muzzle, themed }`.
  Prefers the tower's own uploaded model; falls back to the kind's default
  defender model + tint so a community tower still fits the theme. **No stats
  here** — stats stay on the tower definition.
- `sceneEnvFor(kind)` → `{ scenery, palette, skyUrl, groundUrl }` for scene setup
  (space has no ground). This is also how a world tells the engine which
  background to use, and how madlands picks space/cave/interior backdrops.
- Labels reskin the same unit: a Tower reads **Emplacement** (dungeon),
  **Sentry** (building), **Turret** (ground), **Platform** (space).

---

## 6. Locational inventory + the death economy

`economy.js`. Coins are platform chips (never stored locally).

- **Locational:** inventory is `location -> bucket{ components, ammo, builtTowers[] }`.
  Everything begins on your **ship** (`SHIP` bucket). `deployableAt(inv, location)`
  returns what you fight with there, falling back to the ship if you've never
  staged at that location.
- **Death = 50/50:** `salvageOnDeath(brought)` → `{ salvaged, lost, buybackCost }`.
  `salvaged` (floor of half) returns to the ship via `applySalvageToShip`; `lost`
  (the remainder) is gone unless bought back with coins at `buybackCost`.
- **Coins in:** `coinsForRun({status, wave, loot})` — participation is always paid,
  plus per-wave, a win bonus, and looted supplies converted to coins. Credit it to
  the wallet engine-side; pricing in `COIN_PRICE`, rates in `COIN_REWARD`.

---

## 7. Plug-in checklist

**A world that opens instances (madlands):**
1. Build a descriptor on the player's "Lay Siege" action; sign it with `BRIDGE_SECRET`.
2. 302 to `launchUrl(ENGINE_ORIGIN, token)`.
3. Handle the return: read `?siegeResult`, on `lost` apply `salvageOnDeath` to the
   player's inventory and offer the coin buyback; advance the map on `won`.
4. Keep inventory locational, seeded on the ship.

**An engine that runs instances (towers):**
1. `GET /play?siege=<token>` → `verifyDescriptor` → `validateDescriptor` → open.
2. Deploy from the descriptor's inventory bucket; skin defenders via `skinFor(kind, …)`;
   set scene via `sceneEnvFor(kind)`; multiply spawn cadence by `pacing`.
3. On end: report to `/internal/webgame/score`, credit `coinsForRun(...)` to the wallet,
   302 to `returnUrl(desc, result)`.
4. Legacy standalone lobby play (`/play?level=` / `/play?map=`) keeps working — a
   missing `?siege` token just means "free play", no world to return to.

---

## 8. Open items (next increments)

- **towers**: parse `?siege` in `public/javascripts/game/play.js#boot`; wire `skinFor`
  into `three/entities` tower renderer; apply `pacing` in `services/game/instance.js`
  (`startNextWave` spawn timing). *Global pacing knob = `descriptor.pacing` default.*
- **towers UI**: collapse the three control surfaces (desktop `td-hud`, mobile
  `mg-dock`, floating hands) in `views/game/play.ejs` into one responsive bottom bar.
- **madlands**: add "Lay Siege" on interior hexes in `public/javascripts/madlands/app.js`
  (replaces the placeholder explore-level as the *combat* path); server route to sign
  + redirect; return handler applies salvage.
- **scale combo**: bigger defender/enemy models + larger `HEX.SIZE`/board radius +
  multi-tile footprints for bases/machines (engine `hex-grid.js` + placement).
- **entry surface**: madlands map becomes the canonical entry/exit; the towers lobby
  war-map (`game/lobby-map.js`) is legacy. (Known bug there: the dive loop reassigns
  `location.href` every frame with no guard + never cancels its rAF/WebGL context —
  fix or retire when superseded.)

---

## 9. Integration log

- **2026-06-03** — v1 drafted. Canonical kit scaffolded at `/srv/siege-kit`
  (descriptor/skins/economy/token), smoke-tested (token round-trip, tamper reject,
  50/50 salvage, coin payout). Decisions: descriptor travels as an HMAC token reusing
  `BRIDGE_SECRET`; coins = platform chips (credit engine-side, salvage world-side);
  one defender reskinned per kind; inventory locational, seeded on the ship; pacing is
  a descriptor field so "waves too fast" is a per-launch knob. Wiring into towers +
  madlands is the next increment.

- **2026-06-03 (later)** — Pipeline closed end-to-end. Towers (engine) receives a
  signed launch at `/play?siege=` (verify → validate → boot the pinned board; SSO
  resume if logged out; "Return to World" exit). Madlands (world) implements the
  full world side: `/siege/launch` signs a descriptor + 302s to the engine;
  `/siege/return` applies 50/50 salvage + drops a recoverable cache; `/siege/state`,
  `/siege/buyback`, `/siege/recover` back the UI; the rail's ⚔ Siege / ⛨ Defend
  buttons + the spoils prompt are wired in `app.js`. Verified on the live VM:
  BRIDGE_SECRET matches across both apps, and a madlands-signed token VERIFIES on
  the running Towers server (routes to /auth/platform, not /auth/google). Locational
  inventory + caches persist on the madlands `Profile`. Remaining: engine-side use
  of `mode` (siege=outer-in vs defend=middle-out placement), `pacing`, and the
  per-location loadout; defender reskins via `skinFor`; the consolidated bottom bar.
