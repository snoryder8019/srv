/**
 * ActionCard - the "play on your equipment" layer.
 *
 * Equipment (towers) is placed on the board; ACTION cards are dealt into a hand
 * and played ONTO a placed tower to buff it. Two sources:
 *   - generic: the base game pile. Available set grows with player level.
 *   - collection: cards the player has earned/been rewarded; chosen pre-game.
 *
 * Effect model is deliberately small and data-driven so new cards need no code:
 *   effect.kind   'tower-buff' | 'base-heal'
 *   effect.stat   'damage' | 'range' | 'fireRate' | 'splash'   (tower-buff only)
 *   effect.mode   'mult' | 'add'
 *   effect.value  number
 *   effect.durationMs  0 = lasts the whole run, >0 = temporary
 */
import mongoose from 'mongoose';

const actionCardSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true },
  name: { type: String, required: true, trim: true, maxlength: 40 },
  description: { type: String, maxlength: 200 },
  icon: { type: String, default: '✦' },
  bgUrl: { type: String, default: '' },  // SD-generated card background

  rarity: { type: String, enum: ['common', 'rare', 'epic', 'legendary'], default: 'common' },
  source: { type: String, enum: ['generic', 'collection'], default: 'generic' },
  minLevel: { type: Number, default: 1 },   // for generics: unlocks at this level

  effect: {
    kind: { type: String, enum: ['tower-buff', 'base-heal'], default: 'tower-buff' },
    stat: { type: String, enum: ['damage', 'range', 'fireRate', 'splash'], default: 'damage' },
    mode: { type: String, enum: ['mult', 'add'], default: 'mult' },
    value: { type: Number, default: 1.25 },
    durationMs: { type: Number, default: 12000 },
  },
}, { timestamps: true });

actionCardSchema.index({ source: 1, minLevel: 1 });

export default mongoose.model('ActionCard', actionCardSchema);
