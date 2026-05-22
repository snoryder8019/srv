'use strict';

/**
 * Username — the user-facing public handle that appears in chat, on
 * broadcast cards, and anywhere a player is rendered. Replaces direct use of
 * displayName / firstName / email in user-facing UI.
 *
 * Rules:
 *   - 3–24 chars, [A-Za-z0-9_]
 *   - unique case-insensitively (we store both `username` and `usernameLower`)
 *   - cannot start with a reserved prefix (admin/mod/staff/system/anon/null/owner)
 *
 * Seeding: every user gets a generated `AdjectiveNoun###` username on first
 * boot. The seed pool is small and rotated; collisions retry up to 8 times,
 * then fall back to `Player<6 hex>` so the migration always terminates.
 */

const crypto = require('crypto');

const ADJECTIVES = [
  'Swift','Silent','Wild','Iron','Stormy','Lonely','Gritty','Lucky','Salty','Frozen',
  'Crimson','Wicked','Brave','Lazy','Cursed','Foggy','Hungry','Jolly','Misty','Noisy',
  'Quiet','Rusty','Smoky','Tasty','Vivid','Witty','Zesty','Quick','Wary','Bold',
  'Feral','Loyal','Sharp','Sunny','Drunk','Plump','Fuzzy','Sneaky','Royal','Hardy',
];
const NOUNS = [
  'Falcon','Wolf','Hauler','Skiff','Boar','Vault','Raider','Drifter','Ranger','Hunter',
  'Smith','Reaver','Knight','Wisp','Ghost','Tinker','Salvager','Squire','Sailor','Trapper',
  'Bandit','Brawler','Captain','Engineer','Forager','Gunner','Hunter','Jester','Marshal','Nomad',
  'Outlaw','Pilot','Quartermaster','Rover','Scout','Surveyor','Trader','Vagrant','Warden','Yeoman',
];

const RESERVED_PREFIXES = ['admin','mod','staff','system','anon','null','owner','superadmin','moderator','root','games','bot'];
const MIN_LEN = 3;
const MAX_LEN = 24;
const USERNAME_RE = /^[A-Za-z0-9_]+$/;

function randomFrom(arr) { return arr[crypto.randomInt(arr.length)]; }

function generateCandidate() {
  const a = randomFrom(ADJECTIVES);
  const n = randomFrom(NOUNS);
  const num = (100 + crypto.randomInt(900)).toString();
  return a + n + num;
}

function generateFallback() {
  return 'Player' + crypto.randomBytes(3).toString('hex');
}

function validate(name) {
  if (typeof name !== 'string') return { ok: false, error: 'username required' };
  const trimmed = name.trim();
  if (trimmed.length < MIN_LEN) return { ok: false, error: `must be at least ${MIN_LEN} chars` };
  if (trimmed.length > MAX_LEN) return { ok: false, error: `must be at most ${MAX_LEN} chars` };
  if (!USERNAME_RE.test(trimmed)) return { ok: false, error: 'only letters, numbers, and underscore' };
  const lower = trimmed.toLowerCase();
  if (RESERVED_PREFIXES.some(p => lower === p || lower.startsWith(p))) {
    return { ok: false, error: 'this name is reserved' };
  }
  return { ok: true, username: trimmed, usernameLower: lower };
}

async function ensureIndex(db) {
  // Sparse-unique so we can roll forward without blocking users yet to be
  // backfilled. After the backfill pass everyone has a value; the sparse
  // qualifier is harmless on a fully-populated field.
  try {
    await db.collection('users').createIndex(
      { usernameLower: 1 },
      { unique: true, sparse: true, name: 'usernameLower_unique' }
    );
  } catch (e) {
    console.error('[username] index create error:', e.message);
  }
}

// Try a username for this user. Returns { ok, error? } — leaves the user
// document untouched on failure. Uniqueness is enforced both by the unique
// index and a pre-check to give nice error messages.
async function setForUser(db, userId, raw) {
  const v = validate(raw);
  if (!v.ok) return v;
  const clash = await db.collection('users').findOne(
    { usernameLower: v.usernameLower, _id: { $ne: userId } },
    { projection: { _id: 1 } }
  );
  if (clash) return { ok: false, error: 'that username is taken' };
  try {
    await db.collection('users').updateOne(
      { _id: userId },
      { $set: { username: v.username, usernameLower: v.usernameLower } }
    );
  } catch (e) {
    if (e.code === 11000) return { ok: false, error: 'that username is taken' };
    throw e;
  }
  return { ok: true, username: v.username };
}

// Pick a free username for this user. Retries against the unique index a
// handful of times, then falls back to Player<hex>. Idempotent: a doc that
// already has `username` set is skipped.
async function seedOne(db, user) {
  if (user.username && user.usernameLower) return null;
  for (let i = 0; i < 8; i++) {
    const candidate = generateCandidate();
    const lower = candidate.toLowerCase();
    try {
      const r = await db.collection('users').updateOne(
        { _id: user._id, username: { $exists: false } },
        { $set: { username: candidate, usernameLower: lower } }
      );
      if (r.matchedCount === 0) return null; // raced with another writer
      // Did the upsert actually land? Confirm by re-reading; the unique index
      // would have rejected a collision and matchedCount would still be 1 but
      // the $set would have errored — so if we got here, it stuck.
      return candidate;
    } catch (e) {
      if (e.code !== 11000) throw e;
      // Collision; loop and try a new pair.
    }
  }
  // Last-ditch: deterministic-ish fallback
  const fallback = generateFallback();
  await db.collection('users').updateOne(
    { _id: user._id, username: { $exists: false } },
    { $set: { username: fallback, usernameLower: fallback.toLowerCase() } }
  );
  return fallback;
}

async function backfillAll(db) {
  await ensureIndex(db);
  const cursor = db.collection('users')
    .find({ $or: [ { username: { $exists: false } }, { usernameLower: { $exists: false } } ] }, { projection: { _id: 1, username: 1, usernameLower: 1 } });
  let count = 0;
  for await (const u of cursor) {
    const seeded = await seedOne(db, u);
    if (seeded) count++;
  }
  if (count > 0) console.log('[username] backfilled ' + count + ' user(s)');
  return count;
}

// Helper used everywhere the portal renders a player: prefer the user-set
// username, then a generated fallback, never displayName/firstName/email.
function displayFor(user) {
  if (!user) return 'Player';
  if (user.username) return user.username;
  // No username yet — render the anon handle, never the real name.
  if (user._id) return 'user_' + crypto.createHash('sha256').update(String(user._id)).digest('hex').slice(0, 8);
  return 'Player';
}

module.exports = {
  validate,
  setForUser,
  backfillAll,
  displayFor,
  ensureIndex,
  MIN_LEN,
  MAX_LEN,
};
