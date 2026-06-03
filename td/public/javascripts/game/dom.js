/** Tiny DOM helpers + transient toast notifications. */
export const $ = (id) => document.getElementById(id);
export const setHud = (key, value) => { const el = $(`hud-${key}`); if (el) el.textContent = value; };
export const log = (...args) => console.log('[td/play]', ...args);

export function toast(msg, kind) {
  const host = $('td-toast');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'td-toast-item' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 2600);
}
