const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String },
  videoUrl: { type: String, required: true },
  thumbnail: { type: String },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser', required: true },
  tags: [{ type: String }],
  published: { type: Boolean, default: true },
  views: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'grv_videos' });

module.exports = mongoose.model('GrvVideo', VideoSchema);
