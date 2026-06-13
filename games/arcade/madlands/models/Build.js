/**
 * Build — a generic builder artifact produced by a focused agent.
 * Every builder form (environment, object, npc, level, story, music, ...) saves
 * the same shape, scoped by scale tier + hex. The master level-agent later reads
 * all builds for a hex and composes them into a playable map.
 */
import mongoose from 'mongoose';

const BuildSchema = new mongoose.Schema({
  kind:   { type: String, required: true, index: true }, // environment|object|npc|level|story|music
  tier:   { type: String, default: 'zone' },             // space|body|zone|interior
  hexKey: { type: String, default: null, index: true },  // which hex this belongs to (nullable)
  name:   { type: String, default: 'untitled' },

  input:  { type: Object, default: {} },   // raw manual form fields
  output: { type: Object, default: {} },   // structured agent JSON

  agent:  { type: String, default: null }, // which agent produced output
  status: { type: String, default: 'draft', index: true }, // draft|ready|published
  createdBy: { type: String, default: null }, // platformId
}, { timestamps: true });

BuildSchema.index({ kind: 1, tier: 1, hexKey: 1 });

export default mongoose.models.Build || mongoose.model('Build', BuildSchema);
