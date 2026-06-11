import express from 'express';
import { getPitch, getView } from '../lib/pitchLoader.js';
import { shareValid, SHARE_TTL_MS } from '../lib/store.js';

const router = express.Router();

// Gate access to a pitch. Seed pitches are always public. User pitches are
// viewable only by their owner/superadmin or with a valid 48h share token
// (via ?s= or the pv_<slug> cookie). Returns true when allowed; otherwise it
// renders the friendly gate page (403) and returns false.
//
// On a valid ?s= token it drops a short-lived httpOnly cookie so sub-views can
// be navigated without re-appending ?s on every link.
function canView(req, res, pitch) {
  if (pitch.source === 'seed') return true;

  const isOwner = req.mllUser?.id && req.mllUser.id === pitch.ownerId;
  const isAdmin = !!req.mllUser?.isSuperadmin;
  if (isOwner || isAdmin) return true;

  const slug = pitch.slug;
  const queryToken = (req.query.s || '').toString() || null;
  const cookieToken = req.cookies?.['pv_' + slug] || null;
  const token = queryToken || cookieToken;

  if (shareValid(pitch, token)) {
    // Persist a valid query token so the visitor can browse sub-views freely.
    if (queryToken && queryToken === token) {
      res.cookie('pv_' + slug, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SHARE_TTL_MS,
      });
    }
    return true;
  }

  res.status(403).render('share/gate', {
    title: 'This pitch link has expired or is private',
    slug,
  });
  return false;
}

router.get('/:slug', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch) return res.status(404).render('error', { title: 'Not found', message: 'Unknown client pitch.' });
  if (!canView(req, res, pitch)) return;
  const firstView = pitch.views?.[0]?.slug;
  return res.redirect(firstView ? `/c/${pitch.slug}/${firstView}` : `/c/${pitch.slug}/overview`);
});

router.get('/:slug/overview', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch) return res.status(404).render('error', { title: 'Not found', message: 'Unknown client pitch.' });
  if (!canView(req, res, pitch)) return;
  res.render('pitch', { title: `${pitch.client} — Overview`, pitch, currentView: null });
});

router.get('/:slug/proposal/app', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch || !pitch.app) return res.status(404).render('error', { title: 'Not found', message: 'No app demo for this client.' });
  if (!canView(req, res, pitch)) return;
  res.render('proposal/app', { title: `${pitch.client} — Live App Demo`, pitch });
});

router.get('/:slug/proposal/draft', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch || !pitch.proposal) return res.status(404).render('error', { title: 'Not found', message: 'No proposal for this client.' });
  if (!canView(req, res, pitch)) return;
  const designs = pitch.proposal.designs || [];
  const requested = (req.query.design || '').toString();
  const design = designs.find((d) => d.id === requested) || designs.find((d) => d.id === pitch.proposal.defaultDesign) || designs[0];
  res.render('proposal/draft', { title: `${pitch.client} — Proposal`, pitch, currentDesign: design });
});

router.get('/:slug/:view', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch) return res.status(404).render('error', { title: 'Not found', message: 'Unknown client pitch.' });
  if (!canView(req, res, pitch)) return;
  const view = getView(pitch, req.params.view);
  if (!view) return res.status(404).render('error', { title: 'Not found', message: `No view "${req.params.view}".` });
  res.render('pitch', { title: `${pitch.client} — ${view.title}`, pitch, currentView: view });
});

export default router;
