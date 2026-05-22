const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Announcements drive the landing-page communications strip and any embedded
// news/updates surface. Stored on disk so they survive restarts without a DB
// hop on every public page-load. Posts are small (title + body + meta) so the
// flat JSON file is fine until volume grows past a few hundred entries.
const FILE = path.join(__dirname, '..', 'announcements.json');

const VALID_KINDS = new Set(['news', 'update', 'help', 'maintenance', 'event', 'note']);
const VALID_TONES = new Set(['info', 'warning', 'success', 'critical']);

let cache = [];

function _load() {
  try {
    if (!fs.existsSync(FILE)) { cache = []; return; }
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cache = Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.error('[announcements] load failed:', e.message);
    cache = [];
  }
}

function _save() {
  try { fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8'); }
  catch (e) { console.error('[announcements] save failed:', e.message); }
}

_load();

function list({ activeOnly = false } = {}) {
  const now = Date.now();
  let items = cache.slice();
  if (activeOnly) {
    items = items.filter(a => {
      if (!a.active) return false;
      if (a.expiresAt && new Date(a.expiresAt).getTime() < now) return false;
      return true;
    });
  }
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return items;
}

function add({ title, body, kind = 'news', tone = 'info', pinned = false, expiresAt = null, author = '', thumbnailUrl = null }) {
  if (!body || !String(body).trim()) throw new Error('body required');
  const k = VALID_KINDS.has(kind) ? kind : 'news';
  const t = VALID_TONES.has(tone) ? tone : 'info';
  const item = {
    id: crypto.randomBytes(6).toString('hex'),
    title: String(title || '').slice(0, 140),
    body: String(body).slice(0, 4000),
    kind: k,
    tone: t,
    pinned: !!pinned,
    active: true,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    createdAt: new Date().toISOString(),
    author: String(author || '').slice(0, 100),
    thumbnailUrl: thumbnailUrl ? String(thumbnailUrl).slice(0, 400) : null,
  };
  cache.push(item);
  _save();
  return item;
}

function update(id, patch) {
  const i = cache.findIndex(a => a.id === id);
  if (i < 0) return null;
  const cur = cache[i];
  if (patch.title !== undefined) cur.title = String(patch.title).slice(0, 140);
  if (patch.body !== undefined) cur.body = String(patch.body).slice(0, 4000);
  if (patch.kind !== undefined && VALID_KINDS.has(patch.kind)) cur.kind = patch.kind;
  if (patch.tone !== undefined && VALID_TONES.has(patch.tone)) cur.tone = patch.tone;
  if (patch.pinned !== undefined) cur.pinned = !!patch.pinned;
  if (patch.active !== undefined) cur.active = !!patch.active;
  if (patch.expiresAt !== undefined) cur.expiresAt = patch.expiresAt ? new Date(patch.expiresAt).toISOString() : null;
  if (patch.thumbnailUrl !== undefined) cur.thumbnailUrl = patch.thumbnailUrl ? String(patch.thumbnailUrl).slice(0, 400) : null;
  cache[i] = cur;
  _save();
  return cur;
}

function remove(id) {
  const before = cache.length;
  cache = cache.filter(a => a.id !== id);
  if (cache.length !== before) { _save(); return true; }
  return false;
}

module.exports = { list, add, update, remove, VALID_KINDS, VALID_TONES };
