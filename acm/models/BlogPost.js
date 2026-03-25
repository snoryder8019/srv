const mongoose = require('mongoose');

const blogPostSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  slug:        { type: String, required: true, unique: true },
  excerpt:     String,
  content:     { type: String, required: true },
  restaurant:  { type: String, enum: ['all', 'nook', 'heyday', 'graffiti'], default: 'all' },
  category:    String,
  tags:        [String],
  coverImage:  String,
  status:      { type: String, enum: ['draft', 'published'], default: 'draft' },
  author:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  publishedAt: Date,
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now }
});

blogPostSchema.pre('save', function() {
  this.updatedAt = new Date();
  if (!this.slug) {
    this.slug = this.title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
});

module.exports = mongoose.model('BlogPost', blogPostSchema);
