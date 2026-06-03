/**
 * Siege routes — madlands is a WORLD that opens attack instances in the siege
 * engine (towers) and handles the player's return. Implements the world side of
 * /srv/SIEGE_KIT_PROTOCOL.md.
 *
 *   GET  /siege/launch   -> draw a loadout from the locational inventory, sign an
 *                           InstanceDescriptor, 302 to the engine.
 *   GET  /siege/return   -> the engine sends the player back here with the outcome;
 *                           apply death salvage + drop a recoverable cache.
 *   GET  /siege/state    -> JSON: inventory, caches, coin balance (for the UI).
 *   POST /siege/buyback  -> spend coins to buy back a lost cache (to the ship).
 *   POST /siege/recover  -> reclaim a cache for free by being at its location.
 *
 * Coins are platform chips (wallet.js). Inventory persists on the Profile when a
 * DB is up; otherwise it lives in the session so the flow still works in dev.
 */
import express from 'express';
import config from '../config/index.js';
import { dbReady } from '../services/db.js';
import Profile from '../models/Profile.js';
import { spend, getBalance } from '../services/platform/wallet.js';
import { buildDescriptor, launchUrl, SIEGE_KINDS, SIEGE_MODES } from '../services/siege/descriptor.js';
import { signDescriptor } from '../services/siege/token.js';
import {
  SHIP, emptyBucket, bucketAt, deployableAt, addToBucket,
  salvageOnDeath, applySalvageToShip, recoverCache, bundleValue,
} from '../services/siege/economy.js';

const router = express.Router();

const seedInventory = () => ({ ship: { components: 8, ammo: 40, builtTowers: [] } });

// Load a working {inventory, caches} + a save() that persists where it can.
async function loadEconomy(req) {
  const u = req.session?.user;
  if (dbReady() && u?.platformId) {
    const profile = await Profile.findOneAndUpdate(
      { platformId: u.platformId },
      { $setOnInsert: { displayName: u.displayName || 'wanderer' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!profile.inventory) profile.inventory = seedInventory();
    if (!Array.isArray(profile.caches)) profile.caches = [];
    return {
      inv: profile.inventory,
      caches: profile.caches,
      async save() { profile.markModified('inventory'); profile.markModified('caches'); await profile.save(); },
    };
  }
  // Session fallback (no DB / guest)
  if (!req.session.econ) req.session.econ = { inv: seedInventory(), caches: [] };
  const econ = req.session.econ;
  return { inv: econ.inv, caches: econ.caches, async save() { /* session autosaves */ } };
}

function requireUser(req, res) {
  if (req.session?.user) return true;
  res.redirect('/auth/platform');   // SSO, then back to the map; player re-initiates
  return false;
}

// ---- LAUNCH ---------------------------------------------------------------
router.get('/launch', async (req, res) => {
  if (!requireUser(req, res)) return;
  const u = req.session.user;

  const path = String(req.query.path || '').trim();
  if (!path) return res.redirect('/?siege=nopath');

  let mode = String(req.query.mode || 'siege').toLowerCase();
  if (!SIEGE_MODES.includes(mode)) mode = 'siege';
  let kind = String(req.query.kind || 'ground').toLowerCase();
  if (!SIEGE_KINDS.includes(kind)) kind = 'ground';
  const biome = req.query.biome ? String(req.query.biome) : kind;
  const tier = req.query.tier ? String(req.query.tier) : 'interior';

  let eco;
  try { eco = await loadEconomy(req); }
  catch (e) { console.warn('[siege] economy load failed:', e.message); eco = { inv: seedInventory(), caches: [], save: async () => {} }; }

  // Draw the whole bucket at this location (ship fallback) into the field.
  const here = bucketAt(eco.inv, path);
  const from = (here.ammo || here.components || (here.builtTowers || []).length) ? path : SHIP;
  const brought = deployableAt(eco.inv, path);
  eco.inv[from] = emptyBucket();             // carried into the instance
  try { await eco.save(); } catch (e) { console.warn('[siege] save on launch failed:', e.message); }

  // Remember what's at risk so the return handler can salvage correctly.
  req.session.activeSiege = { path, location: path, from, mode, kind, brought, startedAt: Date.now() };

  let token;
  try {
    const desc = buildDescriptor({
      mode, kind, biome, path, tier,
      returnUrl: config.publicUrl + '/siege/return',
      location: path,
      platformId: u.platformId,
    });
    token = signDescriptor(desc, config.platform.bridgeSecret);
  } catch (e) {
    console.error('[siege] descriptor/sign failed:', e.message);
    return res.redirect('/?siege=error');
  }
  return res.redirect(launchUrl(config.engine.url, token));
});

// ---- RETURN ---------------------------------------------------------------
router.get('/return', async (req, res) => {
  const result = String(req.query.siegeResult || 'abandoned');
  const path = String(req.query.path || '');
  const active = req.session.activeSiege || null;
  req.session.activeSiege = null;

  if (!active) return res.redirect('/?siege=' + encodeURIComponent(result) + (path ? '&path=' + encodeURIComponent(path) : ''));

  let eco;
  try { eco = await loadEconomy(req); }
  catch (e) { console.warn('[siege] economy load failed:', e.message); return res.redirect('/?siege=' + encodeURIComponent(result)); }

  const loc = active.location || path || SHIP;
  let flag = result;
  let buyback = 0;

  if (result === 'lost') {
    const s = salvageOnDeath(active.brought, loc);
    applySalvageToShip(eco.inv, s.salvaged);
    if (bundleValue(s.cache.bundle) > 0) { eco.caches.push(s.cache); buyback = s.cache.coins; }
  } else {
    // survived (won/abandoned): the gear you carried is now staged at the location.
    addToBucket(eco.inv[loc] || (eco.inv[loc] = emptyBucket()), active.brought);
  }
  try { await eco.save(); } catch (e) { console.warn('[siege] save on return failed:', e.message); }

  const qs = new URLSearchParams({ siege: flag, path: loc });
  if (buyback) qs.set('buyback', String(buyback));
  return res.redirect('/?' + qs.toString());
});

// ---- STATE (for the UI) ---------------------------------------------------
router.get('/state', async (req, res) => {
  if (!req.session?.user) return res.json({ ok: false, guest: true, inventory: {}, caches: [], coins: 0 });
  let eco;
  try { eco = await loadEconomy(req); }
  catch (e) { return res.json({ ok: false, error: e.message }); }
  const bal = await getBalance(req.session.user.platformId, req.session.user.displayName);
  res.json({ ok: true, inventory: eco.inv, caches: eco.caches, coins: bal.chips || 0 });
});

// ---- BUYBACK (spend coins) ------------------------------------------------
router.post('/buyback', express.json(), async (req, res) => {
  const u = req.session?.user;
  if (!u) return res.status(401).json({ ok: false, error: 'sign in' });
  const eco = await loadEconomy(req);
  const idx = Number.isInteger(req.body?.cacheIndex)
    ? req.body.cacheIndex
    : eco.caches.findIndex((c) => c.location === req.body?.location);
  const cache = eco.caches[idx];
  if (!cache) return res.json({ ok: false, error: 'no such cache' });

  const pay = await spend(u.platformId, cache.coins, { reason: 'siege-buyback', location: cache.location }, u.displayName);
  if (pay.ok === false) return res.json({ ok: false, error: pay.error || 'payment failed' });

  applySalvageToShip(eco.inv, cache.bundle);   // bought back to the ship
  eco.caches.splice(idx, 1);
  await eco.save();
  res.json({ ok: true, chips: pay.chips, recovered: cache.bundle, to: SHIP });
});

// ---- RECOVER (journey back, free) -----------------------------------------
router.post('/recover', express.json(), async (req, res) => {
  const u = req.session?.user;
  if (!u) return res.status(401).json({ ok: false, error: 'sign in' });
  const eco = await loadEconomy(req);
  const location = String(req.body?.location || req.body?.path || '');
  const idx = eco.caches.findIndex((c) => c.location === location);
  const cache = eco.caches[idx];
  if (!cache) return res.json({ ok: false, error: 'no cache here' });

  recoverCache(eco.inv, cache);                // merges into the location bucket
  eco.caches.splice(idx, 1);
  await eco.save();
  res.json({ ok: true, recovered: cache.bundle, at: location });
});

export default router;
