// store.js — per-user JSON data layer for Left Field.
//
// Layout:
//   data/users/<userId>.json   account: email, displayName, settings{}, pitchSlugs[] (cap 3)
//   data/pitches/<slug>.json   full pitch doc (renderer schema) + ownerId, status, share{}
//   data/clients/<slug>.json   LEGACY seeded pitches — superadmin-owned, always public
//
// userId is derived deterministically from the lowercased email so the same
// madladslab account always maps to the same record without a lookup table.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'data');
const USERS_DIR = path.join(DATA, 'users');
const PITCHES_DIR = path.join(DATA, 'pitches');
const SEED_DIR = path.join(DATA, 'clients'); // legacy, always-public superadmin pitches

export const MAX_PITCHES = 3;
const SHARE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

for (const d of [USERS_DIR, PITCHES_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── helpers ──────────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();

export function userIdForEmail(email) {
  return 'u_' + crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex').slice(0, 16);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'pitch';
}

function uniqueSlug(base) {
  let slug = slugify(base);
  if (!pitchFileExists(slug)) return slug;
  let i = 2;
  while (pitchFileExists(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

function pitchFileExists(slug) {
  return fs.existsSync(path.join(PITCHES_DIR, slug + '.json')) ||
         fs.existsSync(path.join(SEED_DIR, slug + '.json'));
}

// ── users ────────────────────────────────────────────────────────────────────
function userFile(id) { return path.join(USERS_DIR, id + '.json'); }

export function getUser(id) {
  return readJson(userFile(id));
}

export function getUserByEmail(email) {
  return getUser(userIdForEmail(email));
}

export function saveUser(user) {
  user.updatedAt = nowIso();
  writeJsonAtomic(userFile(user.id), user);
  return user;
}

/** Create-or-update a user from a verified SSO profile. Returns the user record. */
export function upsertUserFromSSO(profile = {}) {
  const email = String(profile.email || '').toLowerCase().trim();
  const id = userIdForEmail(email);
  let user = getUser(id);
  if (!user) {
    user = {
      id,
      email,
      displayName: profile.displayName || profile.name || email.split('@')[0],
      googleId: profile.googleId || null,
      isSuperadmin: !!profile.isSuperadmin,
      createdAt: nowIso(),
      settings: {
        company: '',
        defaultRate: 75,
        brandColor: '#0c1020',
        accent: '#5b8cff',
        logoUrl: '',
        tagline: '',
        contactEmail: email,
      },
      pitchSlugs: [],
    };
  } else {
    if (profile.displayName) user.displayName = profile.displayName;
    if (profile.googleId) user.googleId = profile.googleId;
    if (profile.isSuperadmin) user.isSuperadmin = true;
  }
  return saveUser(user);
}

// ── pitches ──────────────────────────────────────────────────────────────────
function pitchFile(slug) { return path.join(PITCHES_DIR, slug + '.json'); }
function seedFile(slug) { return path.join(SEED_DIR, slug + '.json'); }

export function isSeedPitch(slug) {
  return fs.existsSync(seedFile(slug)) && !fs.existsSync(pitchFile(slug));
}

/** Read a pitch by slug from the user store, falling back to seeded pitches. */
export function getPitch(slug) {
  let p = readJson(pitchFile(slug));
  let source = 'user';
  if (!p) { p = readJson(seedFile(slug)); source = 'seed'; }
  if (!p) return null;
  p.slug = slug;
  p.source = source;
  if (source === 'seed') { p.ownerId = p.ownerId || 'superadmin'; p.status = 'published'; }
  return p;
}

/** All pitch slugs across both stores. */
export function allPitchSlugs() {
  const fromUsers = fs.existsSync(PITCHES_DIR)
    ? fs.readdirSync(PITCHES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
    : [];
  const fromSeed = fs.existsSync(SEED_DIR)
    ? fs.readdirSync(SEED_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
    : [];
  // user store wins on slug collision
  return Array.from(new Set([...fromUsers, ...fromSeed]));
}

function summarize(p) {
  return {
    slug: p.slug,
    client: p.client,
    industry: p.industry,
    date: p.date,
    summary: p.summary,
    status: p.status || 'published',
    ownerId: p.ownerId || 'superadmin',
    source: p.source,
    share: p.share || null,
    updatedAt: p.updatedAt || null,
  };
}

/** Lightweight list of every pitch (used by superadmin + legacy home). */
export function listPitches() {
  return allPitchSlugs().map((slug) => summarize(getPitch(slug))).filter(Boolean);
}

/** Pitches owned by a given user (user store only). */
export function listUserPitches(userId) {
  return allPitchSlugs()
    .map((slug) => getPitch(slug))
    .filter((p) => p && p.source === 'user' && p.ownerId === userId)
    .map(summarize)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function countUserPitches(userId) {
  return listUserPitches(userId).length;
}

/**
 * Create a new pitch for a user. Enforces the per-user cap.
 * `data` is the pitch body (client, summary, views, packages, …).
 * Throws Error('pitch_limit') when the user is at MAX_PITCHES.
 */
export function createPitch(userId, data = {}) {
  const user = getUser(userId);
  if (!user) throw new Error('unknown_user');
  if (!user.isSuperadmin && countUserPitches(userId) >= MAX_PITCHES) {
    throw new Error('pitch_limit');
  }
  const slug = uniqueSlug(data.slug || data.client || 'pitch');
  const pitch = {
    ...data,
    slug,
    ownerId: userId,
    status: data.status || 'draft',
    share: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeJsonAtomic(pitchFile(slug), pitch);
  user.pitchSlugs = Array.from(new Set([...(user.pitchSlugs || []), slug]));
  saveUser(user);
  return pitch;
}

/** Patch a pitch the user owns. Returns the updated pitch or null if not owned. */
export function updatePitch(slug, userId, patch = {}) {
  const p = getPitch(slug);
  if (!p || p.source !== 'user') return null;
  if (p.ownerId !== userId && !getUser(userId)?.isSuperadmin) return null;
  const merged = { ...p, ...patch, slug, ownerId: p.ownerId, updatedAt: nowIso() };
  delete merged.source;
  writeJsonAtomic(pitchFile(slug), merged);
  return merged;
}

export function deletePitch(slug, userId) {
  const p = getPitch(slug);
  if (!p || p.source !== 'user') return false;
  const user = getUser(userId);
  if (p.ownerId !== userId && !user?.isSuperadmin) return false;
  fs.unlinkSync(pitchFile(slug));
  const owner = getUser(p.ownerId);
  if (owner) {
    owner.pitchSlugs = (owner.pitchSlugs || []).filter((s) => s !== slug);
    saveUser(owner);
  }
  return true;
}

// ── share tokens (48h expiry) ────────────────────────────────────────────────
/** Mint a fresh 48h share token for a pitch. Returns {token, expiresAt}. */
export function setShare(slug, userId) {
  const p = getPitch(slug);
  if (!p || p.source !== 'user') return null;
  if (p.ownerId !== userId && !getUser(userId)?.isSuperadmin) return null;
  const share = {
    token: crypto.randomBytes(18).toString('base64url'),
    expiresAt: new Date(Date.now() + SHARE_TTL_MS).toISOString(),
  };
  updatePitch(slug, p.ownerId, { share, status: 'published' });
  return share;
}

export function clearShare(slug, userId) {
  const p = getPitch(slug);
  if (!p || p.source !== 'user') return false;
  if (p.ownerId !== userId && !getUser(userId)?.isSuperadmin) return false;
  updatePitch(slug, p.ownerId, { share: null });
  return true;
}

/** True if a pitch is publicly viewable for this request's token. */
export function shareValid(pitch, token) {
  if (!pitch) return false;
  if (pitch.source === 'seed') return true; // legacy seeds are always public
  const s = pitch.share;
  if (!s || !s.token) return false;
  if (token !== s.token) return false;
  return new Date(s.expiresAt).getTime() > Date.now();
}

export { DATA, USERS_DIR, PITCHES_DIR, SEED_DIR, SHARE_TTL_MS };
