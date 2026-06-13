# Economy Redesign — Components / Ammo / Global Currency

## Model (per user direction)
GLOBAL games currency (the arcade chip wallet on games.madladslab.com) is the
ONLY money. In-game run currency is NO LONGER the gate for placing towers.

Three resources:
- **Global currency (chips)** — the single money. Buys ANY lobby item: components,
  ammo, and finished defenses. Lives in the platform wallet (games service),
  accessed via /internal/wallet/{get,debit,credit} with the bridge secret.
- **Components** — earned by playing rounds (loot drops, ~1/8 supply) OR bought
  with global currency. Spent in the LOBBY to BUILD defenses (towers) beyond the
  level's base set.
- **Ammo** — earned by playing (loot) OR bought. ONE-TIME ARM COST to deploy a
  tower during a run. (Not a firing magazine — arming = paying ammo once on place.)

## Persistence (td User doc — new `inventory` subdoc)
inventory: {
  components: Number,         // build material
  ammo: Number,              // arm-to-deploy stock
  builtTowers: [{ towerId, count }],   // defenses crafted in the lobby (deployable)
}
(Global chips are NOT mirrored here — always read live from the wallet.)

## In-run change (services/game/instance.js)
- placeTower no longer charges run.currency. Instead it requires the player to
  have an available BUILT tower of that type AND enough ammo; arming spends
  `armCost` ammo (one-time). Run currency stays only as score/loot bookkeeping;
  the old "money builds during the wave to buy towers" loop is removed.
- Deployable inventory (built towers + ammo) is passed into the GameInstance at
  run start (from the User doc) and decremented as towers are placed.
- The level provides a BASE set of free defenses (map.baseLoadout) the player can
  always deploy; built towers extend beyond that.

## Lobby (the build/buy hub)
- Shows global chip balance (live from wallet), owned components, ammo, and built
  defenses.
- BUILD a defense: spend components (recipe per tower) → adds to builtTowers.
- BUY with chips: components packs, ammo packs, or directly buy a finished defense.
- API (td): POST /api/v1/economy/build, /buy ; GET /api/v1/economy (inventory+balance).

## Loot → inventory
- On run end, loot earned in the run (this.loot {ammo, components, tokens}) is
  persisted: ammo+components added to inventory; tokens credited to global chips
  via wallet credit. (Tokens are the in-run way to earn a little global currency.)

## Sequencing
1. User.inventory model + economy service (wallet client). 
2. Persist run loot on end (onEnd hook).
3. In-run placeTower: ammo-arm + built-inventory gate (remove currency gate).
4. Lobby build/buy UI + economy API.
