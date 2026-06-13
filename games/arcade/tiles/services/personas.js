/**
 * personas — autonomous casino "players" that roam the live tables so a solo
 * human always has company: Sam Sneed, Tad Dow & Dazz. They take an OPEN seat at
 * a casino table that has a real human present — or, at tables that run full of
 * bots (craps/roulette), they DISPLACE a generic numbered bot so a named player
 * shows there too. They bet + play through the normal bot path (their action
 * shows on the socket like any player) and come & go on a timer. Their platformId
 * is a `bot:` id, so they never touch the chip wallet.
 *
 * Presence + live-betting layer. Chat (ollama → chat modal), invites, and stats
 * are layered on top of this same roster.
 */
import { listTables, getTable } from '../lib/tables.js';
import ai from './ai/client.js';
import config from '../config/index.js';

export const PERSONAS = [
  { id: 'bot:sam', name: 'Sam Sneed' },
  { id: 'bot:tad', name: 'Tad Dow' },
  { id: 'bot:dazz', name: 'Dazz' },
];
const PERSONA_IDS = new Set(PERSONAS.map((p) => p.id));
const CASINO = new Set(['craps', 'roulette', 'blackjack', 'baccarat']);
const MAX_PER_TABLE = 2;          // leave room for the human (and open boxes)
const TICK_MS = 11000;
const STAY_MIN_MS = 70000, STAY_MAX_MS = 200000;

const room = (id) => `table:${id}`;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let _io = null, _advance = null;
const seatedAt = new Map();        // persona id -> { tableId, seat, until }

const ARRIVE = ['Deal me in.', 'Room for one more?', "Let's run it.", 'Feeling lucky tonight.', 'Cards are hot, I hear.'];
const DEPART = ['Cashing out, gg.', 'Calling it — good run.', 'Catch you next shoe.', "I'm out, nice playing."];

const PERSONALITY = {
  'bot:sam': 'a smooth, confident card hustler who loves needling the table',
  'bot:tad': 'a jittery, superstitious gambler chasing a hot streak',
  'bot:dazz': 'a flashy, hype-loving high-roller talking big',
};
let _lastBanter = 0;
const _lastLine = new Map();   // persona id -> last posted line (dedupe)
const BANTER_MIN_MS = 130000;

// ── ollama-driven banter into the Arcade-wide chat modal ────────────────────
async function genLine(persona, situation) {
  try {
    const text = await ai.chat([
      { role: 'system', content: `You are ${persona.name}, ${PERSONALITY[persona.id] || 'a casino regular'}. Reply with ONE short line of casino table banter, max 12 words. No quotes, no emoji, no name prefix, no hashtags.` },
      { role: 'user', content: situation },
    ], { temperature: 0.95, maxTokens: 40, timeoutMs: 8000 });
    return (text || '').replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0].slice(0, 140);
  } catch (e) { return null; }
}
async function postGlobal(persona, text) {
  if (!text || !config.platform.bridgeSecret) return;
  if (_lastLine.get(persona.id) === text) return;   // don't repeat the same line
  _lastLine.set(persona.id, text);
  try {
    await fetch(`${config.platform.url}/internal/chat/global`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-secret': config.platform.bridgeSecret },
      body: JSON.stringify({ platformId: persona.id, from: persona.name, surface: 'casino', text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {}
}
async function chatGlobal(persona, situation, fallback) {
  const line = (await genLine(persona, situation)) || fallback;
  await postGlobal(persona, line);
}

function publicRecent(t) { try { const v = t.variant.publicView(t); return Array.isArray(v.recent) ? v.recent : []; } catch (e) { return []; } }
function othersAt(t, selfId) { return t.seats.filter((x) => PERSONA_IDS.has(x.platformId) && x.platformId !== selfId).map((x) => x.displayName); }
function tableContext(t, selfId) {
  const recent = publicRecent(t).slice(-3), others = othersAt(t, selfId);
  let ctx = `You are at the ${t.game} table.`;
  if (recent.length) ctx += ` Recent hands: ${recent.join('; ')}.`;
  if (others.length) ctx += ` ${others.join(' and ')} ${others.length > 1 ? 'are' : 'is'} also playing.`;
  return ctx;
}
function fallbackLine(t) {
  const r = publicRecent(t);
  if (r.length) { const last = r[r.length - 1]; return pick([`${last} — called it.`, `${last}, wild shoe tonight.`, 'Saw that one coming.']); }
  return pick(['Who else is feeling lucky tonight?', 'Cards are running hot.', 'Let it ride.']);
}
async function chatAbout(persona, t, mode) {
  const others = othersAt(t, persona.id);
  let task = 'Drop ONE short line reacting to how the table is running.';
  if (mode === 'join') task = 'You just sat down \u2014 react to how the table has been running in ONE short line.';
  else if (mode === 'banter' && others.length) task = `Needle ${pick(others)} or react to the recent hands in ONE short line.`;
  const line = (await genLine(persona, tableContext(t, persona.id) + ' ' + task)) || fallbackLine(t);
  await postGlobal(persona, line);
}

function liveCasinoTables() {
  return listTables()
    .filter((s) => CASINO.has(s.game))
    .map((s) => getTable(s.tableId))
    .filter((t) => t && (t.phase === 'playing' || t.phase === 'lobby'));
}
function connectedHumans(t) { return t.seats.filter((s) => s.platformId && !s.bot && s.connected).length; }
function tablePersonaCount(t) { return t.seats.filter((s) => PERSONA_IDS.has(s.platformId)).length; }
function wantsBotFill(t) { const se = t.variant && t.variant.meta && t.variant.meta.seating; return !(se && se.fillWithBots === false); }
function displaceableBot(t) { return t.seats.find((s) => s.bot && s.platformId && s.platformId.startsWith('bot:') && !PERSONA_IDS.has(s.platformId)); }
// an open seat, else a generic numbered bot we can take over (craps/roulette)
function targetSeat(t) { return t.seats.find((s) => !s.platformId) || displaceableBot(t) || null; }

function say(table, persona, text) {
  if (!_io || !persona) return;
  _io.to(room(table.tableId)).emit('table:event', { type: 'persona', name: persona.name, text });
}

export async function tick() {
  const now = Date.now();

  // 1) reconcile: forget any persona whose seat is no longer theirs (kicked/displaced/taken)
  for (const [id, info] of [...seatedAt]) {
    const t = getTable(info.tableId);
    const s = t && t.seats[info.seat];
    if (!t || !s || s.platformId !== id) seatedAt.delete(id);
  }

  // 2) leave: TTL elapsed, or the table lost all its humans
  for (const [id, info] of [...seatedAt]) {
    const t = getTable(info.tableId);
    if (!t) { seatedAt.delete(id); continue; }
    const humans = connectedHumans(t);
    if (now > info.until || humans < 1) {
      const persona = PERSONAS.find((p) => p.id === id);
      say(t, persona, pick(DEPART));
      _io && _io.to(room(t.tableId)).emit('table:event', { type: 'persona', action: 'leave', seat: info.seat, name: persona && persona.name });
      t.vacate(info.seat);
      // tables that run full of bots get a plain bot back in the seat (keep it lively)
      if (humans >= 1 && wantsBotFill(t)) t.seatPlayer(info.seat, { bot: true });
      seatedAt.delete(id);
      try { await _advance(_io, t); } catch (e) {}
    }
  }

  // 3) join: trickle a free persona into a seat at a human-occupied table
  for (const t of liveCasinoTables()) {
    if (connectedHumans(t) < 1) continue;
    if (tablePersonaCount(t) >= MAX_PER_TABLE) continue;
    const target = targetSeat(t);
    if (!target) continue;
    const free = PERSONAS.filter((p) => !seatedAt.has(p.id));
    if (!free.length) continue;
    if (Math.random() < 0.5) {
      const p = pick(free);
      t.seatPlayer(target.seat, { platformId: p.id, displayName: p.name, bot: true });
      seatedAt.set(p.id, { tableId: t.tableId, seat: target.seat, until: now + rnd(STAY_MIN_MS, STAY_MAX_MS) });
      _io && _io.to(room(t.tableId)).emit('table:event', { type: 'persona', action: 'join', seat: target.seat, name: p.name });
      say(t, p, pick(ARRIVE));
      if (Math.random() < 0.3) chatAbout(p, t, 'join').catch(() => {});
      try { await _advance(_io, t); } catch (e) {}
    }
  }

  // 4) occasional idle banter into the arcade chat, to keep the modal lively
  if (now - _lastBanter > BANTER_MIN_MS) {
    const ids = [...seatedAt.keys()];
    if (ids.length && Math.random() < 0.4) {
      _lastBanter = now;
      const persona = PERSONAS.find((p) => p.id === pick(ids));
      const info = persona && seatedAt.get(persona.id); const t = info && getTable(info.tableId);
      if (t) chatAbout(persona, t, 'banter').catch(() => {});
    }
  }
}

export function startPersonas({ io, advance }) {
  _io = io; _advance = advance;
  const h = setInterval(() => { tick().catch((e) => console.warn('[personas]', e.message)); }, TICK_MS);
  if (h && h.unref) h.unref();   // background timer: don't keep the process alive on its own
  console.log('[personas] Sam Sneed, Tad Dow & Dazz are roaming the casino');
}

// test seam
export const _state = { seatedAt, PERSONAS };
