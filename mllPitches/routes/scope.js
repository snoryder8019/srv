import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPitch } from '../lib/pitchLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SUBMISSIONS_DIR = path.resolve(__dirname, '..', 'data', 'submissions');

const router = express.Router();

router.post('/submit', (req, res) => {
  const { clientSlug, selectedIds = [], notes = '', contact = {} } = req.body || {};
  if (!clientSlug || !Array.isArray(selectedIds)) {
    return res.status(400).json({ ok: false, error: 'clientSlug and selectedIds[] required' });
  }
  const pitch = getPitch(clientSlug);
  if (!pitch) return res.status(404).json({ ok: false, error: 'unknown client' });

  const items = [];
  for (const view of pitch.views || []) {
    for (const item of view.scope || []) {
      if (selectedIds.includes(item.id)) {
        items.push({ viewSlug: view.slug, viewTitle: view.title, ...item });
      }
    }
  }
  const totals = items.reduce(
    (acc, it) => ({
      hours: acc.hours + (it.hours || 0),
      cost: acc.cost + (it.cost || 0),
      firmCost: acc.firmCost + (it.firmCost || (it.cost || 0) * 3),
    }),
    { hours: 0, cost: 0, firmCost: 0 }
  );
  totals.savings = totals.firmCost - totals.cost;

  const submission = {
    id: `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    clientSlug,
    client: pitch.client,
    submittedAt: new Date().toISOString(),
    contact,
    notes: String(notes).slice(0, 4000),
    items,
    totals,
  };

  fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(SUBMISSIONS_DIR, `${submission.id}.json`),
    JSON.stringify(submission, null, 2),
    'utf8'
  );

  res.json({ ok: true, id: submission.id, totals, count: items.length });
});

export default router;
