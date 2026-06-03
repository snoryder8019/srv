/**
 * Loadout API - pre-game deck info for the authed player.
 *   GET /api/v1/loadout -> level/xp, hand slots, collection picks, owned cards.
 *
 * The client uses this to render the pre-game screen where the player chooses
 * collection cards (up to `picks`); the rest of the hand is dealt generics.
 */
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import ActionCard from '../models/ActionCard.js';
import User from '../models/User.js';
import { handSlots, collectionPicks, levelFromXp, xpForNext, genericPool } from '../../../services/cards/actions.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const user = await User.findById(req.user._id).lean();
  const level = levelFromXp(user.xp || 0);
  const owned = (user.cardCollection || []).map(c => c.slug);

  const [collectionCards, generics] = await Promise.all([
    owned.length ? ActionCard.find({ slug: { $in: owned } }).lean() : [],
    genericPool(level),
  ]);

  // collapse owned counts for display
  const counts = {};
  for (const c of (user.cardCollection || [])) counts[c.slug] = c.count || 1;

  res.json({
    success: true,
    level,
    xp: user.xp || 0,
    nextXp: xpForNext(level),
    slots: handSlots(level),
    picks: collectionPicks(level),
    genericPoolSize: generics.length,
    collection: collectionCards.map(c => ({
      slug: c.slug, name: c.name, icon: c.icon, rarity: c.rarity,
      description: c.description, count: counts[c.slug] || 1,
    })),
  });
});

export default router;
