import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTACTS_DIR = path.resolve(__dirname, '..', 'data', 'contacts');

const router = express.Router();

const RECENT = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 5;

router.post('/', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const hits = (RECENT.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    return res.status(429).json({ ok: false, error: 'too many requests; try again in a minute' });
  }
  RECENT.set(ip, [...hits, now]);

  const { name = '', email = '', company = '', topic = '', message = '', hp = '', pageHint = '' } = req.body || {};

  // Honeypot — silent success on hits
  if (hp && hp.trim()) {
    return res.json({ ok: true, id: 'silent' });
  }

  if (!String(name).trim() || !String(email).trim() || !String(message).trim()) {
    return res.status(400).json({ ok: false, error: 'name, email, message required' });
  }
  if (String(message).length > 5000) {
    return res.status(400).json({ ok: false, error: 'message too long' });
  }

  const submission = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    submittedAt: new Date().toISOString(),
    name: String(name).slice(0, 200).trim(),
    email: String(email).slice(0, 200).trim(),
    company: String(company).slice(0, 200).trim(),
    topic: String(topic).slice(0, 200).trim(),
    message: String(message).slice(0, 5000).trim(),
    pageHint: String(pageHint).slice(0, 200),
    ip,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 400),
  };

  fs.mkdirSync(CONTACTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(CONTACTS_DIR, `${submission.id}.json`),
    JSON.stringify(submission, null, 2),
    'utf8'
  );

  console.log(`[contact] ${submission.id} from ${submission.email} (${submission.name}) — ${submission.message.length} chars`);

  res.json({ ok: true, id: submission.id });
});

export default router;
