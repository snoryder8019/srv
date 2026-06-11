// share.js — owner share-link management for Left Field pitches.
//
// Owners mint a fresh 48h public token for a *user* pitch (not seeds), see the
// shareable URL + QR + countdown, and can regenerate or revoke it. The public
// /c/:slug routes honour that token (see routes/clients.js).
import express from 'express';
import QRCode from 'qrcode';
import { getPitch, setShare, clearShare } from '../lib/store.js';
import { requireUser } from '../plugins/mllAuth.js';

const router = express.Router();

// Owner / superadmin gate for a single user pitch. Returns the pitch or null
// after sending the appropriate 404/403 response.
function ownedPitchOr404(req, res) {
  const pitch = getPitch(req.params.slug);
  if (!pitch) {
    res.status(404).render('error', { title: 'Not found', message: 'Unknown pitch.' });
    return null;
  }
  const isOwner = req.mllUser?.id === pitch.ownerId;
  const isAdmin = !!req.mllUser?.isSuperadmin;
  if (pitch.source !== 'user' || (!isOwner && !isAdmin)) {
    res.status(403).render('error', {
      title: 'Not allowed',
      message: pitch.source !== 'user'
        ? 'Seeded pitches are always public and have no share link to manage.'
        : 'You do not own this pitch.',
    });
    return null;
  }
  return pitch;
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function shareUrlFor(req, slug, token) {
  return `${baseUrl(req)}/c/${slug}?s=${token}`;
}

// GET /share/:slug — owner management page.
router.get('/:slug', requireUser, async (req, res) => {
  const pitch = ownedPitchOr404(req, res);
  if (!pitch) return;

  const share = pitch.share || null;
  const active = !!(share && share.token && new Date(share.expiresAt).getTime() > Date.now());

  let url = null;
  let qr = null;
  if (active) {
    url = shareUrlFor(req, pitch.slug, share.token);
    try { qr = await QRCode.toDataURL(url, { margin: 1, width: 240 }); } catch { qr = null; }
  }

  res.render('share/index', {
    title: `Share — ${pitch.client || pitch.slug}`,
    pitch,
    active,
    share,
    url,
    qr,
  });
});

// POST /share/:slug/create — mint a fresh 48h token (also used by "Regenerate").
router.post('/:slug/create', requireUser, async (req, res) => {
  const pitch = ownedPitchOr404(req, res);
  if (!pitch) return;

  const share = setShare(pitch.slug, req.mllUser.id);
  if (!share) {
    return res.status(403).render('error', {
      title: 'Not allowed',
      message: 'Could not create a share link for this pitch.',
    });
  }

  if (req.accepts(['html', 'json']) === 'json') {
    const url = shareUrlFor(req, pitch.slug, share.token);
    let qr = null;
    try { qr = await QRCode.toDataURL(url, { margin: 1, width: 240 }); } catch { qr = null; }
    return res.json({ url, expiresAt: share.expiresAt, qr });
  }
  return res.redirect(`/share/${pitch.slug}`);
});

// POST /share/:slug/revoke — kill the active token.
router.post('/:slug/revoke', requireUser, (req, res) => {
  const pitch = ownedPitchOr404(req, res);
  if (!pitch) return;

  clearShare(pitch.slug, req.mllUser.id);

  if (req.accepts(['html', 'json']) === 'json') {
    return res.json({ ok: true });
  }
  return res.redirect(`/share/${pitch.slug}`);
});

export default router;
