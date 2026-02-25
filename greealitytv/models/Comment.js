const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({
  body: { type: String, required: true, trim: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser', required: true },
  contentType: { type: String, enum: ['post', 'video'], required: true },
  contentId: { type: mongoose.Schema.Types.ObjectId, required: true },
  upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser' }],
  downvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GrvUser' }],
  createdAt: { type: Date, default: Date.now }
}, { collection: 'grv_comments' });

module.exports = mongoose.model('GrvComment', CommentSchema);
