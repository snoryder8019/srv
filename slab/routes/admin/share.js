/**
 * Admin share endpoint — backs the reusable Share modal.
 *
 * `POST /admin/share/link` mints (or reuses) the `/s/:token` short link for any
 * shareable piece of content and returns the absolute URL + display metadata.
 * Generic by design so every content module (blog today, pages/portfolio next)
 * shares through one code path and one modal.
 */
import express from 'express';
import { ObjectId } from 'mongodb';
import { mintShareToken, shareUrlFor, isShareable } from '../../plugins/shareLink.js';

const router = express.Router();

// Maps the modal's `collection` arg to the source doc + the fields the share
// link needs. Add an entry here to make a new content type shareable.
const SOURCES = {
  blog: {
    coll: 'blog',
    toLink: (doc) => ({
      collection: 'blog', docId: doc._id, slug: doc.slug,
      contentType: doc.contentType || 'blog', title: doc.title,
      image: doc.coverImage || doc.heroImage || doc.featuredImageUrl || doc.ogImage || '',
    }),
    isPublic: (doc) => doc.status === 'published',
  },
  pages: {
    coll: 'pages',
    toLink: (doc) => ({
      collection: 'pages', docId: doc._id, slug: doc.slug,
      contentType: null, title: doc.title || doc.metaTitle || doc.slug,
      image: doc.ogImage || '',
    }),
    isPublic: (doc) => doc.status === 'published',
  },
};

router.post('/link', async (req, res) => {
  try {
    const { collection, id } = req.body || {};
    const src = SOURCES[collection];
    if (!src) return res.status(400).json({ error: 'Unsupported content type.' });
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id.' });

    const doc = await req.db.collection(src.coll).findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).json({ error: 'Content not found.' });

    const payload = src.toLink(doc);
    if (!isShareable(payload)) {
      return res.status(409).json({ error: 'This item has no public page to share yet.' });
    }
    if (!src.isPublic(doc)) {
      return res.status(409).json({ error: 'Publish this item before sharing it.' });
    }

    const link = await mintShareToken(req.db, payload);
    if (!link?.token) return res.status(500).json({ error: 'Could not create share link.' });

    res.json({
      url: shareUrlFor(req, link.token),
      title: payload.title || '',
      image: payload.image || '',
      clicks: link.clicks || 0,
    });
  } catch (err) {
    console.error('[admin/share] link error:', err);
    res.status(500).json({ error: 'Failed to create share link.' });
  }
});

export default router;
