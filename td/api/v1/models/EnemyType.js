/**
 * EnemyType - data-driven enemy archetypes (was hardcoded in game/enemy-types).
 * Editable from the admin balance backend; the engine loads these at run start.
 */
import mongoose from 'mongoose';

const enemyTypeSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true },
  name: { type: String, required: true, trim: true, maxlength: 40 },
  hp: { type: Number, default: 20, min: 1 },
  speed: { type: Number, default: 1.5, min: 0.1, max: 20 },
  reward: { type: Number, default: 5, min: 0 },
  color: { type: Number, default: 0x88ff88 },     // stored as int (0xRRGGBB)
  model: { type: String, default: '' },            // optional enemy model key (robot/parrot/stork)
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('EnemyType', enemyTypeSchema);
