/**
 * betbar.js — shared chip-denomination stake builder for the casino tables.
 *
 * A fixed on-screen tray of casino chips (5 / 10 / 25 / 100). Tapping a chip ADDS
 * its value to the working stake; CLEAR resets to the table minimum. The running
 * stake is the amount each felt / board tap wagers — so a player builds the bet
 * up from the minimum by stacking denominations, then taps a zone to place it.
 *
 * Chip colours match chip3d's denomination palette so the tray reads like the
 * chips that land on the felt. Used by both craps3d and roulette3d.
 *
 *   const BAR = createBetBar({ Sound: T.Sound });
 *   ... BAR.getStake() ...        // current wager amount
 *   BAR.setVisible(canBetNow);    // show only while the local seat can bet
 */
import { CHIP_COLORS } from './chip3d.js?v=1781441125092';

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

export function createBetBar(opts = {}) {
  const denoms = opts.denoms || [5, 10, 25, 100];
  const min = (opts.min != null) ? opts.min : denoms[0];
  const onChange = opts.onChange || (() => {});
  const Sound = opts.Sound || null;
  const action = opts.action || null;   // optional primary button, e.g. { label:'Ready', onClick }
  const click = () => { if (Sound && Sound.click) Sound.click(); };
  let stake = min;

  const wrap = document.createElement('div');
  wrap.id = 'betBar';
  wrap.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0',
    'z-index:82', 'display:none', 'align-items:center', 'gap:9px', 'justify-content:center',
    'background:linear-gradient(180deg,rgba(6,14,9,.85),rgba(4,9,6,.98))',
    'border-top:1px solid rgba(227,197,103,.45)', 'box-shadow:0 -8px 26px rgba(0,0,0,.5)',
    'padding:7px 12px', 'padding-bottom:calc(7px + env(safe-area-inset-bottom,0px))',
    'font-family:system-ui', 'flex-wrap:nowrap', 'overflow-x:auto',
  ].join(';');

  const readWrap = document.createElement('div');
  readWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;line-height:1;margin-right:2px';
  const readLabel = document.createElement('div');
  readLabel.style.cssText = 'color:#9fb0a6;font-size:9px;font-weight:700;letter-spacing:.08em';
  readLabel.textContent = 'BET';
  const readout = document.createElement('div');
  readout.style.cssText = 'color:#ffe9a8;font-weight:800;font-size:18px;min-width:34px;text-align:center;font-variant-numeric:tabular-nums';
  readWrap.appendChild(readLabel); readWrap.appendChild(readout);

  const chips = document.createElement('div');
  chips.style.cssText = 'display:flex;gap:7px';
  denoms.forEach((d) => {
    const c = hex(CHIP_COLORS[d] || CHIP_COLORS.default);
    const b = document.createElement('button');
    b.textContent = d;
    b.title = 'Add ' + d;
    b.style.cssText = [
      'width:40px', 'height:40px', 'border-radius:50%', 'cursor:pointer',
      'font-weight:800', 'font-size:14px', 'color:#fff',
      'background:' + c, 'border:2px dashed rgba(255,255,255,.85)',
      'box-shadow:0 2px 6px rgba(0,0,0,.45)', 'transition:transform .06s',
      'flex:none',
    ].join(';');
    b.onpointerdown = () => { b.style.transform = 'scale(.9)'; };
    const up = () => { b.style.transform = ''; };
    b.onpointerup = up; b.onpointerleave = up; b.onpointercancel = up;
    b.onclick = () => { stake += d; render(); onChange(stake); click(); };
    chips.appendChild(b);
  });

  const clear = document.createElement('button');
  clear.textContent = 'Clear';
  clear.style.cssText = 'background:#243;color:#cfe7d8;border:1px solid #6f8478;border-radius:10px;padding:9px 12px;font-size:13px;font-weight:800;cursor:pointer;flex:none';
  clear.onclick = () => { stake = min; render(); onChange(stake); click(); };

  // Ready button with a forcing countdown: GRACE seconds all-green, then a COUNT
  // second drain; at zero it auto-fires the action so a continuous table never
  // stalls. Placing a bet calls kick() to reset the clock.
  let actionBtn = null, meter = null;
  let meterStart = 0, meterRAF = null, meterActive = false, meterFired = false;
  const GRACE = 5, COUNT = 9;
  function paintMeter(frac, color) { if (meter) { meter.style.transform = 'scaleX(' + Math.max(0, frac) + ')'; meter.style.background = color; } }
  function meterTick() {
    if (!meterActive) { meterRAF = null; return; }
    const t = (performance.now() - meterStart) / 1000;
    if (t < GRACE) paintMeter(1, '#1f8a4c');
    else { const k = Math.max(0, 1 - (t - GRACE) / COUNT); paintMeter(k, k > 0.5 ? '#1f8a4c' : (k > 0.25 ? '#c9920f' : '#b5402f')); }
    if (t >= GRACE + COUNT) { meterActive = false; meterRAF = null; if (!meterFired) { meterFired = true; if (action && action.onClick) action.onClick(); } return; }
    meterRAF = requestAnimationFrame(meterTick);
  }
  function startMeter() { if (!actionBtn) return; meterFired = false; meterStart = performance.now(); paintMeter(1, '#1f8a4c'); if (!meterActive) { meterActive = true; if (!meterRAF) meterRAF = requestAnimationFrame(meterTick); } }
  function kickMeter() { if (!actionBtn) return; if (!meterActive) { startMeter(); return; } meterFired = false; meterStart = performance.now(); }
  function stopMeter() { meterActive = false; if (meterRAF) { cancelAnimationFrame(meterRAF); meterRAF = null; } paintMeter(1, '#1f8a4c'); }
  if (action) {
    actionBtn = document.createElement('button');
    actionBtn.style.cssText = 'position:relative;overflow:hidden;background:#0f3d24;color:#eafff2;border:1px solid rgba(67,224,138,.55);border-radius:10px;padding:9px 18px;font-size:14px;font-weight:800;cursor:pointer;flex:none;display:none;align-items:center;justify-content:center';
    meter = document.createElement('div');
    meter.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:left center;transform:scaleX(1);background:#1f8a4c;opacity:.55;z-index:0;pointer-events:none';
    const albl = document.createElement('span'); albl.textContent = action.label || 'Ready'; albl.style.cssText = 'position:relative;z-index:1;white-space:nowrap';
    actionBtn.appendChild(meter); actionBtn.appendChild(albl);
    actionBtn.onclick = () => { stopMeter(); if (action.onClick) action.onClick(); click(); };
  }

  wrap.appendChild(readWrap);
  wrap.appendChild(chips);
  wrap.appendChild(clear);
  if (actionBtn) wrap.appendChild(actionBtn);
  document.body.appendChild(wrap);

  function render() { readout.textContent = stake; }
  render();

  return {
    el: wrap,
    getStake: () => stake,
    setStake: (v) => { stake = Math.max(min, v | 0); render(); },
    reset: () => { stake = min; render(); onChange(stake); },
    setVisible: (v) => {
      wrap.style.display = v ? 'flex' : 'none';
      const cb = document.getElementById('arcadeModalBtn');   // float the arcade chat launcher above the bar
      if (cb) cb.style.bottom = v ? (wrap.offsetHeight + 12) + 'px' : '14px';
    },
    setActionVisible: (v) => {
      if (!actionBtn) return;
      actionBtn.style.display = v ? 'inline-flex' : 'none';
      if (!v) stopMeter();
    },
    // the forcing countdown runs ONLY when the player actually has chips down;
    // an empty layout never auto-readies (you can still Ready manually to sit out).
    armMeter: (on) => { if (!actionBtn) return; if (on) { if (!meterActive) startMeter(); } else stopMeter(); },
    kick: () => kickMeter(),
  };
}

export default { createBetBar };
