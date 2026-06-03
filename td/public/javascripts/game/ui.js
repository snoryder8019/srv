/**
 * UI rendering for the two card layers + wave forecast + pre-game loadout.
 *   - equipment hand (towers)   : renderHand / setCurrency
 *   - incoming wave forecast     : renderForecast
 *   - action cards (buffs)       : renderActionHand / clearActionSel
 *   - pre-game loadout modal      : showLoadout
 * Pure view layer: reads/writes shared `state`, emits intents on `socket`.
 */
import { state, CAT_COLOR, ENEMY_ICON, RARITY_COLOR } from './state.js';
import { socket } from './net.js';
import { $, setHud } from './dom.js';

export function setCurrency(v) {
  setHud('currency', v);
  if (v !== state.currency) {
    state.currency = v;
    if (state.lastHand && state.lastHand.length) renderHand(state.lastHand);
  }
}

export function renderHand(hand) {
  const el = $('td-hand');
  if (!el) return;
  state.lastHand = hand || [];
  el.innerHTML = state.lastHand.filter(Boolean).map(c => {
    const afford = (state.currency ?? Infinity) >= c.cost;
    const sel = state.selectedCardId === c.cardId;
    const data = JSON.stringify({ cardId: c.cardId, towerId: c.towerId, name: c.name, gltfUrl: c.gltfUrl, stats: c.stats });
    return '<button class="game-card' + (afford ? '' : ' broke') + (sel ? ' sel' : '') + '" data-card=\'' + data + '\' style="--cat:' + (CAT_COLOR[c.category] || '#9aa7ff') + '">' +
      '<span class="gc-cat">' + c.category + '</span>' +
      '<span class="gc-name">' + c.name + '</span>' +
      '<span class="gc-cost">$' + c.cost + '</span>' +
      '<span class="gc-stats">DMG ' + c.stats.damage + ' · RNG ' + c.stats.range + '</span>' +
      '</button>';
  }).join('');
  el.querySelectorAll('.game-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = JSON.parse(btn.dataset.card);
      state.selectedTowerDef = { _id: d.towerId, name: d.name, gltfUrl: d.gltfUrl, stats: d.stats };
      state.selectedCardId = d.cardId;
      el.querySelectorAll('.game-card').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
    });
  });
}

export function renderForecast(current, waves) {
  const el = $('td-forecast');
  if (!el) return;
  const cards = (waves || []).map((w, i) =>
    '<div class="wave-card' + (i === 0 ? ' now' : '') + '">' +
      '<span class="wc-n">Wave ' + (w.index + 1) + (i === 0 ? ' ▸' : '') + '</span>' +
      '<span class="wc-total">×' + w.total + '</span>' +
      '<span class="wc-en">' + w.enemies.map(e => (ENEMY_ICON[e.type] || '●') + e.count).join('  ') + '</span>' +
    '</div>').join('');
  el.innerHTML = '<div class="wf-label">Incoming</div>' + cards;
}

export function clearActionSel() {
  state.selectedActionCard = null;
  const el = $('td-action-hand');
  if (el) el.querySelectorAll('.action-card').forEach(b => b.classList.remove('sel'));
  const hint = $('apply-hint');
  if (hint) hint.classList.remove('show');
}

export function renderActionHand(hand) {
  const el = $('td-action-hand');
  if (!el) return;
  state.lastActionHand = hand || [];
  el.innerHTML = state.lastActionHand.filter(Boolean).map(c => {
    const col = RARITY_COLOR[c.rarity] || '#9aa7ff';
    const data = JSON.stringify({ instanceId: c.instanceId, kind: (c.effect && c.effect.kind) || 'tower-buff', name: c.name });
    return '<button class="action-card" data-act=\'' + data + '\' title="' + (c.description || '') + '" style="--rar:' + col + '">' +
      '<span class="ac-ico">' + (c.icon || '✦') + '</span>' +
      '<span class="ac-name">' + c.name + '</span>' +
      '</button>';
  }).join('');
  el.querySelectorAll('.action-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = JSON.parse(btn.dataset.act);
      if (d.kind === 'base-heal') {
        socket.emit('run:play-card', { runId: state.runId, instanceId: d.instanceId, towerId: null });
        return;
      }
      state.selectedActionCard = d;
      el.querySelectorAll('.action-card').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
      const hint = $('apply-hint');
      if (hint) { hint.textContent = 'Tap a tower to apply ' + d.name; hint.classList.add('show'); }
    });
  });
}

export async function showLoadout(mapId, levelId) {
  let data = null;
  try { data = await fetch('/api/v1/loadout').then(r => r.json()); } catch (e) {}
  const overlay = $('td-loadout');
  if (!data || !data.success || !overlay) {
    socket.emit('run:start', { mapId, levelId, loadout: { collectionSlugs: [] } });
    return;
  }
  const picks = data.picks || 1;
  const chosen = new Set();
  const cards = (data.collection || []).map(c => {
    const col = RARITY_COLOR[c.rarity] || '#9aa7ff';
    return '<button class="lo-card" data-slug="' + c.slug + '" style="--rar:' + col + '">' +
      '<span class="lo-ico">' + (c.icon || '✦') + '</span>' +
      '<span class="lo-name">' + c.name + '</span>' +
      '<span class="lo-rar">' + c.rarity + '</span>' +
      '<span class="lo-desc">' + (c.description || '') + '</span>' +
      '</button>';
  }).join('') || '<div class="lo-empty">No collection cards yet - win runs to earn them.</div>';

  overlay.innerHTML =
    '<div class="lo-panel arcane">' +
      '<div class="lo-head"><strong>Loadout</strong> · Lv ' + data.level + ' · ' + data.slots + ' slots</div>' +
      '<p class="lo-sub">Choose up to ' + picks + ' from your collection; the rest of your ' + data.slots + ' slots are dealt generics.</p>' +
      '<div class="lo-grid">' + cards + '</div>' +
      '<button class="btn primary lo-start">Deal &amp; Start</button>' +
    '</div>';
  overlay.classList.add('open');

  overlay.querySelectorAll('.lo-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const slug = btn.dataset.slug;
      if (chosen.has(slug)) { chosen.delete(slug); btn.classList.remove('sel'); }
      else { if (chosen.size >= picks) return; chosen.add(slug); btn.classList.add('sel'); }
    });
  });
  overlay.querySelector('.lo-start').addEventListener('click', () => {
    overlay.classList.remove('open');
    socket.emit('run:start', { mapId, levelId, loadout: { collectionSlugs: [...chosen] } });
  });
}
