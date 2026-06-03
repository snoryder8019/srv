import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listPitches, getPitch } from '../lib/pitchLoader.js';
import { ADMIN_EMAIL, isOAuthConfigured } from '../plugins/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SUB_DIR = path.resolve(__dirname, '..', 'data', 'submissions');
const CONTACTS_DIR = path.resolve(__dirname, '..', 'data', 'contacts');
const CLIENTS_DIR = path.resolve(__dirname, '..', 'data', 'clients');

const router = express.Router();

router.use((req, res, next) => {
  if (!isOAuthConfigured()) {
    return res.status(503).render('admin/setup', {
      title: 'Admin setup needed',
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'https://pitch.madladslab.com/auth/google/callback',
      adminEmail: ADMIN_EMAIL,
    });
  }
  if (!req.user) return res.redirect('/auth/google');
  if (req.user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Not your account.' });
  }
  next();
});

function loadJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
}
function loadSubmissions() { return loadJsonDir(SUB_DIR); }
function loadContacts() { return loadJsonDir(CONTACTS_DIR); }

router.get('/', (req, res) => {
  const pitches = listPitches();
  const submissions = loadSubmissions();
  const contacts = loadContacts();
  res.render('admin/dashboard', {
    title: 'Left Field · admin',
    pitches,
    submissions,
    contacts,
    user: req.user,
  });
});

router.get('/contact/:id', (req, res) => {
  const p = path.join(CONTACTS_DIR, req.params.id + '.json');
  if (!fs.existsSync(p)) return res.status(404).render('error', { title: 'Not found', message: 'No contact.' });
  const contact = JSON.parse(fs.readFileSync(p, 'utf8'));
  res.render('admin/contact', { title: `Contact ${contact.id}`, contact, user: req.user });
});

router.get('/pitch/:slug', (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch) return res.status(404).render('error', { title: 'Not found', message: 'Unknown pitch.' });
  const filePath = path.join(CLIENTS_DIR, req.params.slug + '.json');
  const stat = fs.statSync(filePath);
  res.render('admin/pitch', {
    title: pitch.client + ' · admin',
    pitch,
    fileSize: stat.size,
    fileModified: stat.mtime,
    user: req.user,
  });
});

router.get('/submission/:id', (req, res) => {
  const p = path.join(SUB_DIR, req.params.id + '.json');
  if (!fs.existsSync(p)) return res.status(404).render('error', { title: 'Not found', message: 'No submission.' });
  const submission = JSON.parse(fs.readFileSync(p, 'utf8'));
  res.render('admin/submission', { title: 'Submission ' + submission.id, submission, user: req.user });
});

export default router;
