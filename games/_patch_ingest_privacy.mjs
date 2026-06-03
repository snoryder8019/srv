import fs from 'fs';
const F = '/srv/games/routes/internal.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('safeDisplayName')) { console.log('already'); process.exit(0); }

// add a sanitizer near the top (after requireInternal). A reported displayName
// that looks like a real name (contains whitespace) is NEVER trusted — the
// platform only stores screen names. We fall back to the anonymized handle.
s = s.replace(
  `const libs = { rust, valheim, l4d2, '7dtd': sdtd, se, palworld, windrose };`,
  `const libs = { rust, valheim, l4d2, '7dtd': sdtd, se, palworld, windrose };

const crypto = require('crypto');
// Privacy guard: external game services may report a player name; we must never
// store a real name. Anything with whitespace (First Last) or that looks like an
// email is rejected in favor of the platform's anonymized handle.
function anonHandle(platformId) {
  return 'user_' + crypto.createHash('sha256').update(String(platformId)).digest('hex').slice(0, 8);
}
function safeDisplayName(name, platformId) {
  const n = (typeof name === 'string' ? name : '').trim();
  if (!n) return anonHandle(platformId);
  if (/\\s/.test(n)) return anonHandle(platformId);     // "Scott Wallace" -> handle
  if (/@/.test(n)) return anonHandle(platformId);       // email-ish -> handle
  return n;                                              // already a screen name
}`
);

// use it in the webgame score ingest (both the scores insert and leaderboard set)
s = s.replace(
  `    const { game, platformId, displayName, event = 'run-end', score = 0, wave = 0, status = 'abandoned', durationMs = 0, meta = {} } = req.body || {};
    if (!game || !platformId) return res.status(400).json({ error: 'game and platformId required' });
    const now = new Date();
    await db.collection('webgame_scores').insertOne({
      game, platformId: String(platformId), displayName: displayName || null,`,
  `    const { game, platformId, displayName: rawName, event = 'run-end', score = 0, wave = 0, status = 'abandoned', durationMs = 0, meta = {} } = req.body || {};
    if (!game || !platformId) return res.status(400).json({ error: 'game and platformId required' });
    const displayName = safeDisplayName(rawName, platformId);   // never store a real name
    const now = new Date();
    await db.collection('webgame_scores').insertOne({
      game, platformId: String(platformId), displayName,`
);
s = s.replace(
  `        $set: { displayName: displayName || null, lastPlayedAt: now },`,
  `        $set: { displayName, lastPlayedAt: now },`
);

fs.writeFileSync(F, s);
console.log('games ingest hardened: real-name displayNames replaced with anon handle');
