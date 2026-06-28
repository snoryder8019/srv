const mongoose = require('mongoose');

const SPORTS = [
  'Football', 'Basketball', 'Soccer', 'Volleyball', 'Baseball',
  'Softball', 'Wrestling', 'Swimming', 'Track & Field', 'Cross Country',
  'Tennis', 'Golf', 'Other'
];

const VENUES = [
  'District 6 Stadium',
  'Greeley Central - Baggot Gymnasium',
  'Greeley West - Fieldhouse',
  'Northridge - On-Campus Gym',
  'Greeley Rec Center Pool',
  'Away Game',
  'Other'
];

const GameEventSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  sport:    { type: String, enum: SPORTS, required: true },
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, default: 'TBD' },
  venue:    { type: String, enum: VENUES, required: true },
  venueAddress: { type: String },
  // Scheduling
  gameDate: { type: Date, required: true },
  gameTime: { type: String },
  // Broadcast assignment
  delegates: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GrvDelegate' }],
  broadcastType: { type: String, enum: ['delegate-mobile', 'hardware-fixed', 'hybrid', 'none'], default: 'none' },
  // Stream info
  streamUrl:   { type: String, default: '' },
  isLive:      { type: Boolean, default: false },
  // After game
  recordingUrl: { type: String, default: '' },
  highlights:   { type: String, default: '' },
  viewCount:    { type: Number, default: 0 },
  // Status
  status: { type: String, enum: ['scheduled', 'live', 'completed', 'cancelled'], default: 'scheduled' },
  // Created by admin
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser' },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'grv_game_events' });

GameEventSchema.statics.SPORTS = SPORTS;
GameEventSchema.statics.VENUES = VENUES;

module.exports = mongoose.model('GrvGameEvent', GameEventSchema);
