/**
 * Reels engine — machine-agnostic slot core.
 *
 * A "machine" is pure JSON (see ../machines/*.json + REELS_PROTOCOL.md):
 * reel strips, visible window, paylines, paytable, bonuses. The engine knows
 * nothing about themes or art — it spins strips, slices the window, evaluates
 * line + scatter rules, and reports bonus triggers. New skins / reel counts /
 * bonus types are config, not code (new bonus *types* extend evalBonuses).
 *
 * Server-authoritative: stops come from crypto RNG here, never the client.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MACHINE_DIR = path.join(__dirname, '..', 'machines');
const machines = new Map();

function loadMachines() {
  machines.clear();
  for (const f of fs.readdirSync(MACHINE_DIR)) {
    if (!f.endsWith('.json')) continue;
    const m = JSON.parse(fs.readFileSync(path.join(MACHINE_DIR, f), 'utf8'));
    validateMachine(m);
    machines.set(m.slug, m);
  }
  return machines;
}

function validateMachine(m) {
  const { reels, rows } = m.layout || {};
  if (!m.slug || !reels || !rows) throw new Error(`machine ${m.slug || '?'}: slug/layout required`);
  if (!Array.isArray(m.strips) || m.strips.length !== reels)
    throw new Error(`machine ${m.slug}: strips must match layout.reels (${reels})`);
  m.strips.forEach((s, i) => {
    s.forEach(sym => { if (!m.symbols[sym]) throw new Error(`machine ${m.slug}: strip ${i} has unknown symbol "${sym}"`); });
  });
  (m.paylines || []).forEach(pl => {
    if (pl.rows.length !== reels) throw new Error(`machine ${m.slug}: payline ${pl.id} length != reels`);
    pl.rows.forEach(r => { if (r < 0 || r >= rows) throw new Error(`machine ${m.slug}: payline ${pl.id} row out of range`); });
  });
}

function getMachine(slug) { return machines.get(slug) || null; }
function listMachines() {
  return [...machines.values()].map(m => ({
    slug: m.slug, name: m.name, blurb: m.blurb, theme: m.theme, layout: m.layout,
  }));
}

/** Public (client-safe) view of a machine. Strips included — the client renders
 * the real physical strips; outcomes stay server-authoritative (RNG here). */
function publicMachine(m) {
  return { ...m };
}

// ── RNG ──
function randInt(maxExclusive) {
  // crypto-uniform integer in [0, maxExclusive)
  return crypto.randomInt(maxExclusive);
}

/** Spin: pick one stop index per reel. */
function spinStops(m) {
  return m.strips.map(strip => randInt(strip.length));
}

/** Visible window from stops: window[reel][row] = symbol id (row 0 = top). */
function windowFromStops(m, stops) {
  const rows = m.layout.rows;
  return m.strips.map((strip, r) => {
    const out = [];
    for (let row = 0; row < rows; row++) out.push(strip[(stops[r] + row) % strip.length]);
    return out;
  });
}

/** Symbols on a payline given the window. */
function lineSymbols(win, payline) {
  return payline.rows.map((row, reel) => win[reel][row]);
}

/**
 * Evaluate one line against the paytable. Rules are checked in order; the
 * FIRST hit wins (so order paytable best → worst). Rule forms:
 *   { match: [sym,...] }                exact left-to-right symbols
 *   { group: g, count: n }              n symbols sharing symbols[s].group === g
 *   { anyCount: { symbol, count } }     exactly `count` of `symbol`, any positions
 */
function evalLine(m, syms) {
  for (const rule of m.paytable) {
    if (rule.match) {
      if (rule.match.length === syms.length && rule.match.every((s, i) => s === syms[i]))
        return { mult: rule.mult, label: rule.label };
    } else if (rule.group) {
      const n = syms.filter(s => (m.symbols[s] && m.symbols[s].group) === rule.group).length;
      if (n >= (rule.count || syms.length)) return { mult: rule.mult, label: rule.label };
    } else if (rule.anyCount) {
      const n = syms.filter(s => s === rule.anyCount.symbol).length;
      if (n === rule.anyCount.count) return { mult: rule.mult, label: rule.label };
    } else if (rule.leftMatch) {
      // left-aligned run from reel 0: count how many leading reels match the
      // symbol (wilds substitute). rule = { symbol, count, mult }. The longest
      // qualifying run wins because paytable is ordered best->worst per symbol.
      const wild = m.wild || null;
      const target = rule.leftMatch;
      let run = 0;
      for (let i = 0; i < syms.length; i++) {
        if (syms[i] === target || (wild && syms[i] === wild)) run++; else break;
      }
      if (run >= rule.count) return { mult: rule.mult, label: rule.label, run };
    }
  }
  return null;
}

/** Scatter count anywhere in the window. */
function countInWindow(win, symbol) {
  let n = 0;
  for (const reel of win) for (const s of reel) if (s === symbol) n++;
  return n;
}

/** Evaluate bonus triggers. Returns array of fired bonus descriptors. */
function evalBonuses(m, win) {
  const fired = [];
  for (const b of m.bonuses || []) {
    if (b.type === 'freespins' && b.trigger && b.trigger.scatter) {
      if (countInWindow(win, b.trigger.scatter) >= (b.trigger.count || 3)) {
        fired.push({ type: 'freespins', spins: b.spins || 5, multiplier: b.multiplier || 1, label: b.label || 'FREE SPINS' });
      }
    }
    if (b.type === 'pick' && b.trigger && b.trigger.scatter) {
      if (countInWindow(win, b.trigger.scatter) >= (b.trigger.count || 3)) {
        fired.push({ type: 'pick', prizes: b.prizes.slice(), label: b.label || 'PICK BONUS' });
      }
    }
    // future bonus types (wheel, challenge, hold-and-spin) plug in here keyed on b.type
  }
  return fired;
}

/**
 * Full spin evaluation.
 * bet model: total = denom × betLevel × lines. Each line wins mult × denom × betLevel.
 * winMultiplier scales line wins (free-spin x2 etc).
 * Returns credits-and-chips amounts in CHIPS (denom already applied).
 */
function evaluateSpin(m, { denom, betLevel, lines, winMultiplier = 1 }) {
  const stops = spinStops(m);
  const win = windowFromStops(m, stops);
  const activeLines = m.paylines.slice(0, lines);
  const lineBet = denom * betLevel;

  const wins = [];
  let payout = 0;
  for (const pl of activeLines) {
    const syms = lineSymbols(win, pl);
    const hit = evalLine(m, syms);
    if (hit) {
      const amount = hit.mult * lineBet * winMultiplier;
      payout += amount;
      wins.push({ line: pl.id, name: pl.name, rows: pl.rows, symbols: syms, mult: hit.mult, label: hit.label, amount });
    }
  }
  const bonuses = evalBonuses(m, win);
  return { stops, window: win, wins, payout, bonuses };
}

/** Validate a bet request against machine config. */
function validBet(m, { denom, betLevel, lines }) {
  return m.denominations.includes(denom)
    && m.betLevels.includes(betLevel)
    && m.lineOptions.includes(lines);
}

module.exports = {
  loadMachines, getMachine, listMachines, publicMachine,
  spinStops, windowFromStops, evaluateSpin, evalLine, lineSymbols, countInWindow, validBet,
};
