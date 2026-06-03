/**
 * Economy API — the lobby build/buy hub. Global chips (platform wallet) are the
 * only money; components build defenses; ammo arms deployments in a run.
 *
 *   GET  /api/v1/economy            -> { inventory, balance, prices }
 *   POST /api/v1/economy/buy        -> spend chips for a pack (components/ammo) or a finished tower
 *   POST /api/v1/economy/build      -> spend components to craft a tower into inventory
 *
 * All mutations are server-authoritative and re-read the user doc fresh.
 */
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import Tower from '../models/Tower.js';
import wallet from '../../../services/platform/wallet.js';

const router = express.Router();

// Pricing knobs (tune freely). Chips = global currency.
export const PRICES = {
  componentPack: { chips: 60, components: 10 },   // buy 10 components for 60 chips
  ammoPack:      { chips: 40, ammo: 25 },         // buy 25 ammo for 40 chips
  buildComponentCost: 8,                           // components to craft one tower
  buyTowerChips: 120,                              // buy a finished tower outright
  armCost: 5,                                      // ammo to deploy/arm one tower in a run
};

function invOf(user) {
  const inv = user.inventory || {};
  return {
    components: inv.components || 0,
    ammo: inv.ammo || 0,
    builtTowers: (inv.builtTowers || []).map(t => ({ towerId: t.towerId, count: t.count || 0 })),
  };
}

router.get('/', requireAuth, async (req, res) => {
  const user = await User.findById(req.user._id).lean();
  const bal = await wallet.getBalance(user.platformId, user.displayName);
  res.json({
    success: true,
    inventory: invOf(user),
    balance: { chips: bal.chips, live: bal.ok },
    prices: PRICES,
  });
});

// Buy with global chips: kind = 'components' | 'ammo' | 'tower'
router.post('/buy', requireAuth, async (req, res) => {
  const { kind, towerId } = req.body || {};
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ success: false, error: 'no user' });

  let cost, apply;
  if (kind === 'components') {
    cost = PRICES.componentPack.chips;
    apply = () => { user.inventory.components = (user.inventory.components || 0) + PRICES.componentPack.components; };
  } else if (kind === 'ammo') {
    cost = PRICES.ammoPack.chips;
    apply = () => { user.inventory.ammo = (user.inventory.ammo || 0) + PRICES.ammoPack.ammo; };
  } else if (kind === 'tower') {
    if (!towerId) return res.status(400).json({ success: false, error: 'towerId required' });
    const tower = await Tower.findById(towerId).lean();
    if (!tower) return res.status(404).json({ success: false, error: 'no such tower' });
    cost = PRICES.buyTowerChips;
    apply = () => addBuiltTower(user, towerId);
  } else {
    return res.status(400).json({ success: false, error: 'unknown kind' });
  }

  const spend = await wallet.spend(user.platformId, cost, { kind, towerId }, user.displayName);
  if (!spend.ok) return res.status(402).json({ success: false, error: spend.error || 'insufficient chips' });

  apply();
  await user.save();
  const bal = await wallet.getBalance(user.platformId, user.displayName);
  res.json({ success: true, inventory: invOf(user), balance: { chips: bal.chips, live: bal.ok } });
});

// Build a tower from components (no chips).
router.post('/build', requireAuth, async (req, res) => {
  const { towerId } = req.body || {};
  if (!towerId) return res.status(400).json({ success: false, error: 'towerId required' });
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ success: false, error: 'no user' });
  const tower = await Tower.findById(towerId).lean();
  if (!tower) return res.status(404).json({ success: false, error: 'no such tower' });

  const have = user.inventory.components || 0;
  const cost = PRICES.buildComponentCost;
  if (have < cost) return res.status(402).json({ success: false, error: 'not enough components', need: cost, have });

  user.inventory.components = have - cost;
  addBuiltTower(user, towerId);
  await user.save();
  res.json({ success: true, inventory: invOf(user) });
});

function addBuiltTower(user, towerId) {
  user.inventory.builtTowers = user.inventory.builtTowers || [];
  const row = user.inventory.builtTowers.find(t => t.towerId === String(towerId));
  if (row) row.count = (row.count || 0) + 1;
  else user.inventory.builtTowers.push({ towerId: String(towerId), count: 1 });
}

export default router;
