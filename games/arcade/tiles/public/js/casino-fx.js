/**
 * casino-fx.js — shared result feedback for the casino games.
 *
 *   • showResult(): a NON-BLOCKING status bar that drops from the top edge,
 *     coloured green / red / gold for win / loss / push. pointer-events:none so
 *     the felt stays fully tappable on a phone — you keep table touch control.
 *     Shows the outcome, the net chip delta, the resulting balance, and an
 *     itemised per-bet breakdown when supplied.
 *   • setWallet(): a highlighted gold chip-balance pill in the top bar, always
 *     visible, with a quick green/red flash when the balance changes.
 *   • renderHistory(): a strip of recent results (newest highlighted).
 *   • makeDeltaTracker(): remembers the local bankroll for per-round deltas.
 *
 * DOM overlays (not 3D) so they're crisp and always readable. Created lazily.
 */

function el(tag, css, html) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (html != null) e.innerHTML = html;
  return e;
}
const fmt = (n) => { try { return Math.round(n).toLocaleString(); } catch (e) { return String(n); } };

// ---- highlighted wallet pill (top bar) ----
let _wallet = null, _walletLast = null;
export function setWallet(balance) {
  if (balance == null || isNaN(balance)) return;
  if (!_wallet) {
    _wallet = el('div', 'display:flex;align-items:center;gap:6px;background:linear-gradient(180deg,#3a2f12,#221b06);border:1px solid #e3c567;color:#ffe9a8;font-weight:800;font-size:13.5px;padding:5px 12px;border-radius:999px;box-shadow:0 2px 12px rgba(227,197,103,.28);white-space:nowrap;flex:none;transition:box-shadow .3s,transform .12s;font-variant-numeric:tabular-nums',
      '<span style="font-size:15px;filter:saturate(1.2)">\uD83D\uDCB0</span><span id="walletAmt">0</span>');
    const bar = document.getElementById('topbar');
    if (bar) bar.insertBefore(_wallet, bar.firstChild);
    else { _wallet.style.position = 'fixed'; _wallet.style.top = '8px'; _wallet.style.left = '12px'; _wallet.style.zIndex = '20'; document.body.appendChild(_wallet); }
  }
  const v = Math.round(balance);
  const amt = _wallet.querySelector('#walletAmt');
  if (amt) amt.textContent = fmt(v);
  if (_walletLast != null && v !== _walletLast) {
    const up = v > _walletLast;
    _wallet.style.boxShadow = `0 0 0 3px ${up ? 'rgba(63,208,127,.55)' : 'rgba(255,111,82,.55)'}`;
    _wallet.style.transform = 'scale(1.06)';
    setTimeout(() => { if (_wallet) { _wallet.style.boxShadow = '0 2px 12px rgba(227,197,103,.28)'; _wallet.style.transform = 'scale(1)'; } }, 360);
  }
  _walletLast = v;
}

// ---- result status bar (top, non-blocking) ----
let _bar = null, _barTimer = null;
function ensureBar() {
  if (_bar) return _bar;
  const wrap = el('div', 'position:fixed;left:0;right:0;top:46px;z-index:88;pointer-events:none;display:flex;justify-content:center;padding:0 8px');
  _bar = el('div', 'width:100%;max-width:560px;transform:translateY(-140%);opacity:0;transition:transform .28s cubic-bezier(.2,.9,.3,1.2),opacity .2s;border-radius:0 0 16px 16px;box-shadow:0 12px 34px rgba(0,0,0,.5);overflow:hidden');
  wrap.appendChild(_bar); document.body.appendChild(wrap);
  return _bar;
}
const THEME = {
  win:  { bg: 'linear-gradient(180deg,#1f8a4c,#11633500)', edge: '#43e08a', ink: '#eafff2', word: 'WIN' },
  loss: { bg: 'linear-gradient(180deg,#9a2f22,#5e1c1300)', edge: '#ff7a5f', ink: '#ffe7e1', word: 'LOSS' },
  push: { bg: 'linear-gradient(180deg,#6a5a1f,#3a300f00)', edge: '#e3c567', ink: '#fff4cf', word: 'PUSH' },
};
function breakdownInline(list, ink) {
  if (!Array.isArray(list) || !list.length) return '';
  const items = list.filter((r) => r && (r.delta || r.note)).slice(0, 6).map((r) => {
    const pos = r.delta > 0, neg = r.delta < 0;
    const col = pos ? '#bdf5d4' : (neg ? '#ffc9bd' : 'rgba(255,255,255,.7)');
    const label = (r.label || r.side || '').toString().toUpperCase();
    const amt = r.delta ? ((pos ? '+' : '') + r.delta) : (r.note || '—');
    return `<span style="color:${col};white-space:nowrap"><b style="opacity:.8;font-weight:700">${label}</b> ${amt}</span>`;
  }).join('<span style="opacity:.35">·</span>');
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11.5px;margin-top:5px;color:${ink};opacity:.92">${items}</div>`;
}

/**
 * showResult(opts)
 *   title      — short token (e.g. "17", "PLAYER", "Point 6")
 *   titleColor — 'red'|'black'|'green'|null — tints the token text
 *   sub        — secondary descriptor (e.g. "BLACK", "Player 9 · Banker 5")
 *   delta      — net chip change for the local player (number; sets win/loss)
 *   balance    — resulting balance (also updates the wallet pill)
 *   breakdown  — optional [{label/side, delta, note}] itemisation
 *   hold       — ms before auto-dismiss (default 3200)
 */
export function showResult(opts = {}) {
  const bar = ensureBar();
  const d = (typeof opts.delta === 'number') ? opts.delta : null;
  const kind = d > 0 ? 'win' : (d < 0 ? 'loss' : 'push');
  const th = THEME[kind];
  const tintMap = { red: '#ff8a6f', black: '#dfe6df', green: '#7dffb0' };
  const tint = tintMap[opts.titleColor] || th.ink;
  const descriptor = [opts.title, opts.sub].filter((x) => x != null && x !== '').join('  ·  ');
  const deltaStr = d == null ? '' : (d > 0 ? '+' + d : '' + d);
  if (opts.balance != null) setWallet(opts.balance);

  bar.style.background = th.bg;
  bar.innerHTML = `
    <div style="border-top:3px solid ${th.edge};background:rgba(6,12,9,.32);padding:9px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="display:flex;flex-direction:column;line-height:1.15;min-width:0">
          <span style="font-size:17px;font-weight:900;letter-spacing:.10em;color:${th.ink}">${(opts.word != null && opts.word !== '') ? opts.word : th.word}</span>
          ${descriptor ? `<span style="font-size:12.5px;color:${tint};opacity:.95;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${descriptor}</span>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;line-height:1.1;flex:none">
          ${deltaStr ? `<span style="font-size:22px;font-weight:900;color:${th.ink}">${deltaStr}<span style="font-size:11px;font-weight:700;opacity:.7"> chips</span></span>` : `<span style="font-size:14px;color:${th.ink};opacity:.8">no change</span>`}
          ${opts.balance != null ? `<span style="font-size:11.5px;color:${th.ink};opacity:.75">balance ${fmt(opts.balance)}</span>` : ''}
        </div>
      </div>
      ${breakdownInline(opts.breakdown, th.ink)}
    </div>`;
  requestAnimationFrame(() => { bar.style.transform = 'translateY(0)'; bar.style.opacity = '1'; });
  clearTimeout(_barTimer);
  _barTimer = setTimeout(() => { bar.style.transform = 'translateY(-140%)'; bar.style.opacity = '0'; }, opts.hold || 3200);
}

// ---- history bar ----
let _hist = null;
function ensureHistory() {
  if (_hist) return _hist;
  _hist = el('div', `
    position:fixed; top:50%; right:8px; transform:translateY(-50%);
    z-index:85; display:flex; flex-direction:column-reverse; gap:5px; padding:8px 6px; pointer-events:none;
    background:rgba(6,12,9,.5); border-radius:10px; backdrop-filter:blur(3px); max-height:78vh; overflow:hidden;`);
  document.body.appendChild(_hist);
  return _hist;
}
// tap / hover a history chip to see that hand's win-loss
let _histTip = null, _histTipT = null;
function ensureHistTip() {
  if (_histTip) return _histTip;
  _histTip = el('div', 'position:fixed;z-index:92;pointer-events:none;background:rgba(6,12,9,.96);border:1px solid rgba(227,197,103,.5);color:#e9ecef;font:600 12px system-ui;padding:6px 9px;border-radius:8px;box-shadow:0 8px 22px rgba(0,0,0,.5);opacity:0;transition:opacity .15s;max-width:62vw;white-space:normal;text-align:right');
  document.body.appendChild(_histTip);
  return _histTip;
}
function showHistTip(text, chip) {
  const t = ensureHistTip(); t.textContent = text; t.style.opacity = '1';
  const rect = chip.getBoundingClientRect();
  t.style.left = 'auto'; t.style.right = (window.innerWidth - rect.left + 8) + 'px'; t.style.top = Math.max(48, rect.top - 8) + 'px';
  if (_histTipT) clearTimeout(_histTipT); _histTipT = setTimeout(() => { if (_histTip) _histTip.style.opacity = '0'; }, 2400);
}
/** results: array of { label, color, tip? } newest-last. tip shows on tap/hover. */
export function renderHistory(results, max = 12) {
  const h = ensureHistory();
  const cmap = { red: '#b5482f', black: '#15171a', green: '#2f8f5b', gold: '#9a7d27' };
  const list = results.slice(-max);
  if (!list.length) { h.style.display = 'none'; return; }
  h.style.display = 'flex';
  h.innerHTML = '';
  list.forEach((r, i) => {
    const bg = cmap[r.color] || '#1d2733';
    const fresh = i === list.length - 1;
    const chip = el('div', `width:30px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex:none;font-size:13px;font-weight:800;color:#f3eccf;background:${bg};pointer-events:${r.tip ? 'auto' : 'none'};cursor:${r.tip ? 'pointer' : 'default'};${fresh ? 'outline:2px solid #e3c567;' : 'opacity:.82;'}`, r.label);
    if (r.tip) {
      chip.title = r.tip;
      const show = () => showHistTip(r.tip, chip);
      chip.addEventListener('click', show);
      chip.addEventListener('mouseenter', show);
      chip.addEventListener('mouseleave', () => { if (_histTip) _histTip.style.opacity = '0'; });
    }
    h.appendChild(chip);
  });
}

// ---- per-round chip delta tracker ----
export function makeDeltaTracker() {
  let last = null;
  return {
    delta(balance) {
      if (balance == null) return null;
      const d = (last == null) ? 0 : balance - last;
      last = balance;
      return d;
    },
    prime(balance) { last = balance; },
    get last() { return last; },
  };
}
