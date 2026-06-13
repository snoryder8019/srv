import fs from 'fs';
const F = '/srv/td/services/auth/passport.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('safeHandle')) { console.log('already'); process.exit(0); }

// add a privacy-safe handle generator (screen names only — NEVER the real name)
s = s.replace(
  `let configured = false;`,
  `let configured = false;

// Privacy: we must NEVER store or surface a user's real name. Google's
// profile.displayName is the real name, so we ignore it entirely and seed a
// neutral screen-name handle the user can change later. Email local-parts can
// also contain a real name (scott.wallace@…), so we don't use those either —
// we generate an anonymous handle.
function safeHandle() {
  const adj = ['Swift', 'Iron', 'Hex', 'Storm', 'Ember', 'Frost', 'Shadow', 'Bright', 'Stone', 'Vapor'];
  const noun = ['Warden', 'Architect', 'Sentinel', 'Ranger', 'Tinker', 'Nomad', 'Glyph', 'Bastion', 'Drifter', 'Spark'];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = noun[Math.floor(Math.random() * noun.length)];
  return a + n + Math.floor(100 + Math.random() * 900);
}`
);

// never seed displayName from the real name; use a generated handle
s = s.replace(
  `          displayName: profile.displayName || email.split('@')[0],`,
  `          displayName: safeHandle(),   // screen name only — never profile.displayName (real name)`
);

fs.writeFileSync(F, s);
console.log('passport.js: Google real name no longer stored; safe handle seeded');
