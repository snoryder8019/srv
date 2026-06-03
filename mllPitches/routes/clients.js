import express from 'express';
import { getPitch, getView } from '../lib/pitchLoader.js';

const router = express.Router();

router.get('/:slug', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch) return res.status(404).render('error', { title: 'Not found', message: 'Unknown client pitch.' });
  const firstView = pitch.views?.[0]?.slug;
  return res.redirect(firstView ? `/c/${pitch.slug}/${firstView}` : `/c/${pitch.slug}/overview`);
});

router.get('/:slug/overview', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch) return res.status(404).render('error', { title: 'Not found', message: 'Unknown client pitch.' });
  res.render('pitch', { title: `${pitch.client} — Overview`, pitch, currentView: null });
});

router.get('/:slug/proposal/app', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch || !pitch.app) return res.status(404).render('error', { title: 'Not found', message: 'No app demo for this client.' });
  res.render('proposal/app', { title: `${pitch.client} — Live App Demo`, pitch });
});

router.get('/:slug/proposal/draft', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch || !pitch.proposal) return res.status(404).render('error', { title: 'Not found', message: 'No proposal for this client.' });
  const designs = pitch.proposal.designs || [];
  const requested = (req.query.design || '').toString();
  const design = designs.find((d) => d.id === requested) || designs.find((d) => d.id === pitch.proposal.defaultDesign) || designs[0];
  res.render('proposal/draft', { title: `${pitch.client} — Proposal`, pitch, currentDesign: design });
});

router.get('/:slug/:view', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch) return res.status(404).render('error', { title: 'Not found', message: 'Unknown client pitch.' });
  const view = getView(pitch, req.params.view);
  if (!view) return res.status(404).render('error', { title: 'Not found', message: `No view "${req.params.view}".` });
  res.render('pitch', { title: `${pitch.client} — ${view.title}`, pitch, currentView: view });
});

export default router;
