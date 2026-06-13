/**
 * casino-ui.js — shared, themeable panel/modal chrome for the casino tables.
 *
 * The card games already share their scoreboard / info / game-over overlays through
 * hud3d.js. This module centralizes the *other* recurring surfaces — the floating
 * dark-glass popovers and prompts (audio mixer, press/pull prompt, …) and a centered
 * dialog with a scrim (for future confirm dialogs, blackjack/poker actions) — so the
 * theming lives in exactly one place instead of being hand-rolled per game.
 *
 *   import { panel, modal } from './casino-ui.js?v=…';
 *   const p = panel({ place:{ top:'54px', right:'10px' }, dismissable:true, anchor:btn });
 *   p.el.appendChild(myContent);  p.show();  // p.hide() / p.toggle() / p.isOpen()
 *
 *   const m = modal({ maxWidth:'min(560px,92vw)' });
 *   m.el.innerHTML = '…';  m.show();          // taps on the scrim close it
 */

const GLASS = 'rgba(6,14,9,.96)';          // dark-green table glass
const HAIR  = 'rgba(255,255,255,.18)';     // hairline border
const GOLD  = 'rgba(227,197,103,.5)';      // accent (chips/gold)

/**
 * A fixed, positioned floating panel (popover / prompt). Returns an api with the
 * element plus show/hide/toggle/isOpen. Theming is consistent across callers; only
 * the position and a few accents vary.
 *
 * opts: { id, place:{top,right,bottom,left}, z, bg, accent, radius, pad, minWidth,
 *         center (translateX -50% for left:50% anchoring), flexCol (column layout),
 *         gap, display, dismissable, anchor, onDismiss }
 */
export function panel(opts = {}) {
  const el = document.createElement('div');
  if (opts.id) el.id = opts.id;
  const place = opts.place || { top: '54px', right: '10px' };
  const placeCss = Object.entries(place).map(([k, v]) => `${k}:${v}`).join(';');
  const display = opts.display || (opts.flexCol ? 'flex' : 'block');
  const styles = [
    'position:fixed', placeCss, `z-index:${opts.z || 140}`, 'display:none',
    `background:${opts.bg || GLASS}`,
    `border:1px solid ${opts.accent || HAIR}`,
    `border-radius:${opts.radius || 14}px`,
    `padding:${opts.pad || '12px 14px'}`,
    'box-shadow:0 18px 60px rgba(0,0,0,.6)', 'font-family:system-ui',
  ];
  if (opts.center) styles.push('transform:translateX(-50%)');
  if (opts.minWidth) styles.push(`min-width:${opts.minWidth}`);
  if (opts.flexCol) { styles.push('flex-direction:column'); styles.push(`gap:${opts.gap || '8px'}`); }
  el.style.cssText = styles.join(';');
  document.body.appendChild(el);

  const api = {
    el,
    show() { el.style.display = display; return api; },
    hide() { el.style.display = 'none'; return api; },
    toggle() { el.style.display = (el.style.display === 'none') ? display : 'none'; return api; },
    isOpen() { return el.style.display !== 'none'; },
  };
  if (opts.dismissable) {
    document.addEventListener('pointerdown', (ev) => {
      if (api.isOpen() && !el.contains(ev.target) && ev.target !== opts.anchor) {
        api.hide(); if (opts.onDismiss) opts.onDismiss();
      }
    });
  }
  return api;
}

/**
 * A centered dialog over a full-screen scrim. Tapping the scrim closes it (unless
 * dismissable:false). Returns { el (the card), scrim, show, hide, isOpen }.
 *
 * opts: { z, bg, accent, maxWidth, dismissable, onDismiss }
 */
export function modal(opts = {}) {
  const scrim = document.createElement('div');
  scrim.style.cssText = `position:fixed;inset:0;z-index:${opts.z || 160};display:none;` +
    'align-items:center;justify-content:center;background:rgba(4,7,5,.78);padding:12px';
  const card = document.createElement('div');
  card.style.cssText = `background:${opts.bg || 'rgba(8,18,13,.98)'};` +
    `border:1px solid ${opts.accent || GOLD};border-radius:16px;padding:16px 18px;` +
    `max-width:${opts.maxWidth || 'min(560px,92vw)'};max-height:88vh;overflow:auto;` +
    'box-shadow:0 24px 80px rgba(0,0,0,.7);font-family:system-ui;color:#cfe7d8';
  scrim.appendChild(card);
  document.body.appendChild(scrim);

  const api = {
    el: card, scrim,
    show() { scrim.style.display = 'flex'; return api; },
    hide() { scrim.style.display = 'none'; return api; },
    isOpen() { return scrim.style.display !== 'none'; },
  };
  if (opts.dismissable !== false) {
    scrim.addEventListener('pointerdown', (ev) => {
      if (ev.target === scrim) { api.hide(); if (opts.onDismiss) opts.onDismiss(); }
    });
  }
  return api;
}

export default { panel, modal };
