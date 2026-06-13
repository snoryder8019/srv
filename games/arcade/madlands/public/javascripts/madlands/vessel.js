/**
 * vessel.js — traversal economy. Moving between tiles has a COST that depends on
 * your conveyance, which depends on the tier:
 *   space tiers (cluster/galaxy/system/battle) -> SHIP  : burns fuel + food + nitrogen
 *   planet/sector                              -> FOOT  : burns food (short range), no fuel
 *                                              -> VEHICLE: burns fuel + food (board to extend range)
 *   interior                                   -> FOOT
 *
 * Fittings are the limits/sustain: a fuel tank (fuelMax), a food-production fitting
 * (slow food regen), nitrogen for bio-freeze (enables long ship jumps), and a med
 * bay (halves crew drain). Self-contained: builds + updates its own HUD, exposes a
 * tiny API the map calls at each traverse. In-memory for now (resets on reload);
 * persist on the Profile next. Coins (platform chips) will price resupply later.
 */

const SPACE_TIERS = new Set(['cluster', 'galaxy', 'system', 'battle']);

// per-conveyance traverse cost
const COST = {
  ship:    { fuel: 10, food: 3, nitrogen: 2 },
  vehicle: { fuel: 6,  food: 1, nitrogen: 0 },
  foot:    { fuel: 0,  food: 2, nitrogen: 0 },
};

const v = {
  fuel: 60, fuelMax: 60,
  food: 40, foodMax: 40,
  nitrogen: 20, nitrogenMax: 20,
  medbay: 100,             // sustain fitting: >50 halves food drain
  foodRegen: 1,            // food-production fitting: +1 food per traverse
  vehicle: false,          // boarded a ground vehicle?
  scaleKey: 'cluster',
};

function modeFor(scaleKey) {
  if (SPACE_TIERS.has(scaleKey)) return 'ship';
  if ((scaleKey === 'planet' || scaleKey === 'sector') && v.vehicle) return 'vehicle';
  return 'foot';
}

function effectiveCost(scaleKey) {
  const c = { ...COST[modeFor(scaleKey)] };
  if (v.medbay > 50) c.food = Math.max(0, Math.round(c.food / 2));   // med bay eases crew drain
  return c;
}

// ---- public API -----------------------------------------------------------

export function setScale(scaleKey) { v.scaleKey = scaleKey; if (SPACE_TIERS.has(scaleKey)) v.vehicle = false; render(); }

export function conveyance() { return modeFor(v.scaleKey); }

/** Can we afford a traverse at the current tier? */
export function canTraverse(scaleKey = v.scaleKey) {
  const c = effectiveCost(scaleKey);
  return v.fuel >= c.fuel && v.food >= c.food && v.nitrogen >= c.nitrogen;
}

export function blockReason(scaleKey = v.scaleKey) {
  const c = effectiveCost(scaleKey);
  if (v.fuel < c.fuel) return 'out of fuel — resupply at a station';
  if (v.food < c.food) return 'crew rations spent — resupply';
  if (v.nitrogen < c.nitrogen) return 'no nitrogen for bio-freeze — resupply';
  return 'cannot travel';
}

/** Attempt a traverse: charges resources if affordable. -> { ok, reason? }. */
export function tryTraverse(scaleKey = v.scaleKey) {
  if (!canTraverse(scaleKey)) return { ok: false, reason: blockReason(scaleKey) };
  const c = effectiveCost(scaleKey);
  v.fuel = Math.max(0, v.fuel - c.fuel);
  v.food = Math.max(0, v.food - c.food + v.foodRegen);   // food production offsets a little
  v.nitrogen = Math.max(0, v.nitrogen - c.nitrogen);
  if (v.medbay < 100) v.medbay = Math.min(100, v.medbay + 4);
  render();
  return { ok: true };
}

export function resupply() { v.fuel = v.fuelMax; v.food = v.foodMax; v.nitrogen = v.nitrogenMax; v.medbay = 100; render(); }
export function toggleVehicle() {
  if (SPACE_TIERS.has(v.scaleKey)) return;   // no ground vehicles in space
  v.vehicle = !v.vehicle; render();
}
export function snapshot() { return { ...v, mode: modeFor(v.scaleKey) }; }

// ---- HUD -------------------------------------------------------------------

let elBar = null;
const MODE_LABEL = { ship: '🚀 ship', vehicle: '🚗 vehicle', foot: '🥾 on foot' };

function injectCss() {
  if (document.getElementById('vessel-css')) return;
  const el = document.createElement('style'); el.id = 'vessel-css';
  el.textContent = `
  .vessel-hud{position:fixed;left:12px;bottom:12px;z-index:60;display:flex;flex-direction:column;gap:6px;
    background:rgba(12,10,22,0.92);border:1px solid #3a2150;border-radius:12px;padding:10px 12px;
    color:#e7e3f5;font:500 12px/1.2 system-ui,sans-serif;min-width:172px;box-shadow:0 8px 30px rgba(0,0,0,.5)}
  .vessel-hud .vh-mode{font:700 12px/1 'JetBrains Mono',monospace;letter-spacing:.06em;color:#9ad0ff;margin-bottom:2px}
  .vessel-hud .vh-g{display:flex;align-items:center;gap:7px}
  .vessel-hud .vh-g span{width:16px;text-align:center}
  .vessel-hud .vh-bar{flex:1;height:7px;border-radius:5px;background:rgba(255,255,255,.12);overflow:hidden}
  .vessel-hud .vh-bar > i{display:block;height:100%;border-radius:5px;transition:width .25s ease}
  .vessel-hud .vh-row{display:flex;gap:6px;margin-top:4px}
  .vessel-hud .vh-btn{cursor:pointer;border:1px solid #5a4a82;background:#221a3a;color:#e7e3f5;
    padding:5px 9px;border-radius:999px;font-size:11px}
  .vessel-hud .vh-btn:hover{background:#2e2350}`;
  document.head.appendChild(el);
}

function bar(icon, val, max, color) {
  const pct = Math.max(0, Math.min(100, (val / max) * 100));
  return `<div class="vh-g"><span>${icon}</span><div class="vh-bar"><i style="width:${pct}%;background:${color}"></i></div></div>`;
}

function render() {
  if (!elBar) return;
  const mode = modeFor(v.scaleKey);
  const showVehicleBtn = (v.scaleKey === 'planet' || v.scaleKey === 'sector');
  elBar.innerHTML =
    `<div class="vh-mode">${MODE_LABEL[mode] || mode}</div>` +
    bar('⛽', v.fuel, v.fuelMax, '#ffb24a') +
    bar('🍞', v.food, v.foodMax, '#7cffb2') +
    bar('❄', v.nitrogen, v.nitrogenMax, '#6cc8ff') +
    bar('✚', v.medbay, 100, '#ff6c8a') +
    `<div class="vh-row">` +
      `<button class="vh-btn" id="vh-resupply">resupply</button>` +
      (showVehicleBtn ? `<button class="vh-btn" id="vh-vehicle">${v.vehicle ? 'disembark' : 'board vehicle'}</button>` : '') +
    `</div>`;
  const rs = document.getElementById('vh-resupply'); if (rs) rs.onclick = resupply;
  const vb = document.getElementById('vh-vehicle'); if (vb) vb.onclick = toggleVehicle;
}

export function init() {
  injectCss();
  if (!elBar) { elBar = document.createElement('div'); elBar.className = 'vessel-hud'; document.body.appendChild(elBar); }
  render();
}

// auto-init on import
if (typeof document !== 'undefined') init();
