# @madlads/siege-kit

Shared, dependency-free logic for **siege/attack instances** — the fights a world
(madlands) opens and an engine (towers) runs. Full contract:
**`/srv/games/SIEGE_KIT_PROTOCOL.md`**.

## Modules
- `descriptor.js` — build/validate the InstanceDescriptor; launch + return URLs (browser-safe)
- `skins.js` — one defender, many skins; per-kind scenery/palette/background (browser-safe)
- `economy.js` — locational inventory, 50/50 death salvage, coin rewards + buyback (browser-safe)
- `token.js` — HMAC sign/verify a descriptor for safe browser transit (**server-only**)

## Use
```js
// world (server): open a siege
import { buildDescriptor, launchUrl, kindFromMadlands } from './descriptor.js';
import { signDescriptor } from './token.js';
const desc  = buildDescriptor({ kind: kindFromMadlands(tier, interiorKind),
  biome, path, returnUrl, platformId });
const token = signDescriptor(desc, process.env.BRIDGE_SECRET);
res.redirect(launchUrl(ENGINE_ORIGIN, token));

// engine (server): receive a siege
import { verifyDescriptor } from './token.js';
const { ok, descriptor } = verifyDescriptor(req.query.siege, process.env.BRIDGE_SECRET);

// engine/world: economy
import { salvageOnDeath, coinsForRun, deployableAt } from './economy.js';
```

## Independence / vendoring
Each app **copies** this kit into its own tree and conforms to the protocol; do not
cross-import a sibling service. `/srv/siege-kit` is canonical; bump the copies when
the version bumps. See protocol §2.

## Test
```bash
cd /srv/siege-kit && node --input-type=module -e 'import("./economy.js").then(m=>console.log(m.coinsForRun({status:"won",wave:5,loot:{ammo:4,components:2,tokens:1}})))'
```
