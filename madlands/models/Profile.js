/**
 * Local Madlands profile, keyed to the platform user by platformId (NOT email).
 * Identity of record lives in the platform `users` collection; this is just the
 * game-local mirror + per-player progress. Per WEBGAMES_PROTOCOL §3.
 *
 * Economy (siege-kit): inventory is LOCATIONAL — a map of locationKey -> bucket
 * { components, ammo, builtTowers[] } — and everything begins on the SHIP. On
 * death in a siege, half the brought loadout salvages back to the ship and the
 * other half drops as a recoverable `cache` at the death location (buy back with
 * coins, or journey back to reclaim free). Coins themselves are platform chips,
 * never stored here. See /srv/SIEGE_KIT_PROTOCOL.md.
 *
 * NOTE: inventory/caches are Mixed types — call markModified('inventory') /
 * markModified('caches') after mutating before save().
 */
import mongoose from 'mongoose';

const ProfileSchema = new mongoose.Schema({
  platformId:  { type: String, index: true, unique: true, required: true },
  displayName: { type: String, default: 'wanderer' },
  isAdmin:     { type: Boolean, default: false },
  permissions: { type: Object, default: {} },
  lastLoginAt: { type: Date, default: Date.now },

  // Locational inventory, seeded with a starter ship stock.
  inventory: {
    type: Object,
    default: () => ({ ship: { components: 8, ammo: 40, builtTowers: [] } }),
  },
  // Dropped loot caches awaiting buyback or recovery:
  //   { location, bundle:{components,ammo,builtTowers[]}, coins, droppedAt }
  caches: { type: Array, default: [] },
}, { timestamps: true });

ProfileSchema.methods.canAdmin = function () {
  return this.isAdmin === true
    || this.permissions?.games === 'admin'
    || this.permissions?.madlands === 'admin';
};

export default mongoose.models.Profile || mongoose.model('Profile', ProfileSchema);
