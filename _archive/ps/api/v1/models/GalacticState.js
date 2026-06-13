/**
 * GalacticState Model
 * Persists the galactic map state including zones, orbitals, and system positions
 * Allows state to survive server restarts
 */

import mongoose from 'mongoose';

const zoneSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  vx: { type: Number, required: true },
  vy: { type: Number, required: true },
  symbol: { type: String, required: true },
  name: { type: String, required: true }
}, { _id: false });

const orbitalSchema = new mongoose.Schema({
  id: { type: String, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  vx: { type: Number, default: 0 },
  vy: { type: Number, default: 0 },
  assetType: { type: String, required: true },
  radius: { type: Number, default: 10 },
  mass: { type: Number, default: 1 },
  isStationary: { type: Boolean, default: false }
}, { _id: false });

const galacticStateSchema = new mongoose.Schema({
  // Singleton ID - only one galactic state document
  stateId: {
    type: String,
    default: 'main',
    unique: true,
    index: true
  },

  // Space dimensions
  spaceWidth: { type: Number, default: 5000 },
  spaceHeight: { type: Number, default: 5000 },

  // Zone movement data (for the 4 main zones)
  zones: [zoneSchema],

  // Orbital and system positions
  orbitals: [orbitalSchema],

  // Movement settings
  movementSpeed: { type: Number, default: 0.1 },
  gridSize: { type: Number, default: 100 },

  // Timestamps
  lastUpdate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Static method to get or create the singleton state
galacticStateSchema.statics.getState = async function() {
  let state = await this.findOne({ stateId: 'main' });

  if (!state) {
    // Create initial state with default zones
    state = await this.create({
      stateId: 'main',
      spaceWidth: 5000,
      spaceHeight: 5000,
      zones: [
        { id: 1, x: 1250, y: 1250, vx: 0.5, vy: 0.3, symbol: '●', name: 'Alpha' },
        { id: 2, x: 3750, y: 1250, vx: -0.3, vy: 0.5, symbol: '◆', name: 'Beta' },
        { id: 3, x: 1250, y: 3750, vx: 0.4, vy: -0.4, symbol: '■', name: 'Gamma' },
        { id: 4, x: 3750, y: 3750, vx: -0.5, vy: -0.3, symbol: '★', name: 'Delta' }
      ],
      orbitals: [],
      movementSpeed: 0.1,
      gridSize: 100
    });
  }

  return state;
};

// Static method to update state
galacticStateSchema.statics.updateState = async function(updates) {
  const state = await this.getState();

  Object.assign(state, updates);
  state.lastUpdate = new Date();

  await state.save();
  return state;
};

// Static method to update zones only
galacticStateSchema.statics.updateZones = async function(zones) {
  const state = await this.getState();
  state.zones = zones;
  state.lastUpdate = new Date();
  await state.save();
  return state;
};

// Static method to update orbitals
galacticStateSchema.statics.updateOrbitals = async function(orbitals) {
  const state = await this.getState();
  state.orbitals = orbitals;
  state.lastUpdate = new Date();
  await state.save();
  return state;
};

// Static method to reset to defaults
galacticStateSchema.statics.resetState = async function() {
  await this.deleteOne({ stateId: 'main' });
  return await this.getState(); // Will create fresh state
};

export const GalacticState = mongoose.model('GalacticState', galacticStateSchema);
