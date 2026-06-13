/**
 * siege-kit/economy.js
 * --------------------
 * Locational inventory + the death economy + coin conversion. Pure +
 * browser-safe. Engine and world both reason about loadouts with these helpers
 * so the rules stay identical on every surface.
 *
 * MODEL
 *   - Inventory is LOCATIONAL: a map of locationKey -> bucket. Everything begins
 *     on your SHIP (the origin bucket). You carry a loadout from the ship (or a
 *     forward base) into an instance.
 *   - A bucket: { components, ammo, builtTowers:[{towerId,count}] }.
 *   - COINS are the platform's single global currency (chips). Never stored in a
 *     bucket — they live in the platform wallet, read/written live. This module
 *     only computes coin AMOUNTS (credit / buyback); the wallet call is the app's job.
 *   - On DEATH: the loadout you brought splits 50/50.
 *       • SALVAGED half  -> returns straight to your ship.
 *       • LOST half      -> dropped as a CACHE at the death location. You may
 *                           either BUY it back with coins (buybackCost), or
 *                           JOURNEY back to that location to RECOVER it for free.
 */

export const SHIP = 'ship';   // canonical origin/home bucket key

// Coin value of goods (used for both buyback cost and loot credit).
export const COIN_PRICE = { ammo: 1, component: 4, tower: 25 };

// How participation + loot convert into wallet coins (credited on instance end).
export const COIN_REWARD = {
  participation: 5,
  perWave: 3,
  win: 20,
  loot: { ammo: 1, component: 4, token: 10 },
};

// ---- bucket helpers --------------------------------------------------------

export function emptyBucket() { return { components: 0, ammo: 0, builtTowers: [] }; }

export function newInventory(shipBucket = null) {
  return { [SHIP]: { ...emptyBucket(), ...(shipBucket || {}) } };
}

export function bucketAt(inv, location) {
  return (inv && inv[location]) ? inv[location] : emptyBucket();
}

export function towerCount(bucket) {
  return (bucket.builtTowers || []).reduce((s, t) => s + (t.count || 0), 0);
}

/**
 * What a player can deploy when an instance opens at `location`. Locational
 * rule: you fight with what you carried there; if you've never staged here,
 * fall back to the ship — you always have your ship's stock at the start.
 */
export function deployableAt(inv, location) {
  const here = bucketAt(inv, location);
  if (here.ammo || here.components || towerCount(here)) return cloneBucket(here);
  return cloneBucket(bucketAt(inv, SHIP));
}

// ---- death: salvage + recoverable cache ------------------------------------

/**
 * Split a brought loadout 50/50 on death and drop a recoverable cache.
 *
 * @param {object} brought   bucket the player took in
 * @param {string} location  where they died (the world path) — cache lives here
 * @returns {{ salvaged, lost, buybackCost, cache }}
 *   salvaged  -> apply to ship now (applySalvageToShip)
 *   lost      -> the other half (informational)
 *   buybackCost -> coins to repurchase the lost half immediately
 *   cache     -> { location, bundle, coins, droppedAt } — recover by returning
 */
export function salvageOnDeath(brought = emptyBucket(), location = SHIP) {
  const splitN = (n) => { const s = Math.floor((n || 0) / 2); return { salvaged: s, lost: (n || 0) - s }; };

  const ammo = splitN(brought.ammo);
  const comp = splitN(brought.components);
  const salvagedTowers = [];
  const lostTowers = [];
  for (const t of (brought.builtTowers || [])) {
    const { salvaged, lost } = splitN(t.count);
    if (salvaged) salvagedTowers.push({ towerId: t.towerId, count: salvaged });
    if (lost) lostTowers.push({ towerId: t.towerId, count: lost });
  }

  const salvaged = { components: comp.salvaged, ammo: ammo.salvaged, builtTowers: salvagedTowers };
  const lost = { components: comp.lost, ammo: ammo.lost, builtTowers: lostTowers };
  const coins = bundleValue(lost);
  return {
    salvaged,
    lost,
    buybackCost: coins,
    cache: { location, bundle: lost, coins, droppedAt: Date.now() },
  };
}

/**
 * Recover a dropped cache by being at its location. Merges the cache bundle into
 * that location's bucket and returns { inv, recovered }. The world calls this
 * when the player journeys back instead of paying the buyback.
 */
export function recoverCache(inv, cache) {
  if (!cache || !cache.bundle) return { inv, recovered: emptyBucket() };
  inv[cache.location] = inv[cache.location] || emptyBucket();
  addToBucket(inv[cache.location], cache.bundle);
  return { inv, recovered: cloneBucket(cache.bundle) };
}

/** Coin cost to buy back a lost bundle (the other 50%). */
export function buybackCost(lostBundle = emptyBucket()) { return bundleValue(lostBundle); }

/** Flat coin value of a bundle of goods. */
export function bundleValue(bundle = emptyBucket()) {
  let v = 0;
  v += (bundle.ammo || 0) * COIN_PRICE.ammo;
  v += (bundle.components || 0) * COIN_PRICE.component;
  v += towerCount(bundle) * COIN_PRICE.tower;
  return v;
}

// ---- coin rewards (participation + loot) -----------------------------------

/**
 * Coins to CREDIT to the wallet when an instance ends. Participation is always
 * paid (win or lose); loot + wave progress add to it.
 * @param {object} o  { status:'won'|'lost'|'abandoned', wave, loot:{ammo,components,tokens} }
 */
export function coinsForRun({ status, wave = 0, loot = {} } = {}) {
  let coins = COIN_REWARD.participation;
  coins += Math.max(0, wave) * COIN_REWARD.perWave;
  if (status === 'won') coins += COIN_REWARD.win;
  coins += (loot.ammo || 0) * COIN_REWARD.loot.ammo;
  coins += (loot.components || 0) * COIN_REWARD.loot.component;
  coins += (loot.tokens || 0) * COIN_REWARD.loot.token;
  return Math.max(0, Math.round(coins));
}

// ---- mutation helpers ------------------------------------------------------

/** Add a bundle into a bucket (merging built towers by towerId). Returns the bucket. */
export function addToBucket(bucket, bundle = emptyBucket()) {
  bucket.ammo = (bucket.ammo || 0) + (bundle.ammo || 0);
  bucket.components = (bucket.components || 0) + (bundle.components || 0);
  bucket.builtTowers = bucket.builtTowers || [];
  for (const t of (bundle.builtTowers || [])) {
    const row = bucket.builtTowers.find((x) => String(x.towerId) === String(t.towerId));
    if (row) row.count = (row.count || 0) + (t.count || 0);
    else bucket.builtTowers.push({ towerId: String(t.towerId), count: t.count || 0 });
  }
  return bucket;
}

/** Apply death salvage to an inventory: salvaged half lands on the ship. */
export function applySalvageToShip(inv, salvaged) {
  inv[SHIP] = inv[SHIP] || emptyBucket();
  addToBucket(inv[SHIP], salvaged);
  return inv;
}

function cloneBucket(b) {
  return {
    components: b.components || 0,
    ammo: b.ammo || 0,
    builtTowers: (b.builtTowers || []).map((t) => ({ towerId: String(t.towerId), count: t.count || 0 })),
  };
}
