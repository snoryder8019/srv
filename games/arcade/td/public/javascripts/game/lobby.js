/**
 * Command Lobby — between-games hub: pick a theater (map), review the weapons
 * cache (owned towers + action cards), see lifetime stats, then deploy to a run.
 * Co-op (2P) routes into the match.madladslab.com invite flow (backend wired
 * later); for now it points the player at matchmaking intake for towers.
 *
 * Pure view layer talking to existing APIs: /api/v1/maps, /api/v1/towers,
 * /api/v1/loadout, /auth/me. Deploy = navigate to /play?map=<id>.
 */
const $ = (id) => document.getElementById(id);
const api = (p) => fetch(p).then((r) => r.json()).catch(() => null);

let chosenMap = null;
let econ = null;            // { inventory, balance, prices }
const MATCH_URL = 'https://match.madladslab.com';

async function loadEconomy() {
  econ = await api('/api/v1/economy');
  renderEconomyBar();
  return econ;
}

function renderEconomyBar() {
  const bar = $('econ-bar');
  if (!bar || !econ || !econ.success) return;
  const b = econ.balance || {}; const inv = econ.inventory || {};
  bar.innerHTML =
    '<span class="eb-item" title="Global games currency">🪙 ' + (b.chips ?? 0) + ' chips</span>' +
    '<span class="eb-item" title="Build defenses with these">🔩 ' + (inv.components ?? 0) + ' parts</span>' +
    '<span class="eb-item" title="Arms each tower you deploy">🎯 ' + (inv.ammo ?? 0) + ' ammo</span>';
}

function builtCount(towerId) {
  const inv = (econ && econ.inventory) || {};
  const row = (inv.builtTowers || []).find((t) => String(t.towerId) === String(towerId));
  return row ? row.count : 0;
}

async function econPost(path, body) {
  const r = await fetch('/api/v1/economy/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  }).then((x) => x.json()).catch(() => null);
  if (r && r.success) { econ = { ...econ, inventory: r.inventory, balance: r.balance || econ.balance }; renderEconomyBar(); }
  return r;
}

function toast(msg) {
  const host = $('td-toast'); if (!host) return;
  const el = document.createElement('div'); el.className = 'td-toast-item'; el.textContent = msg;
  host.appendChild(el); setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 2400);
}

async function loadStats() {
  const me = await api('/auth/me');
  const s = (me && me.user && me.user.stats) || {};
  $('ls-best').textContent = s.bestScore ?? 0;
  $('ls-wave').textContent = (s.highestWave != null ? s.highestWave + 1 : 0);
  $('ls-wins').textContent = s.gamesWon ?? 0;
  const lo = await api('/api/v1/loadout');
  if (lo && lo.success) {
    $('ls-level').textContent = lo.level;
    $('ls-xp').textContent = `${lo.xp}/${lo.nextXp}`;
    renderCards(lo.collection || []);
  } else {
    $('cache-cards').innerHTML = '<p class="muted">Sign in to see your cards.</p>';
  }
}

async function loadLevels() {
  const res = await api('/api/v1/maps?status=approved');
  let maps = (res && res.maps) || [];
  if (!maps.length) { const d = await api('/api/v1/maps?status=draft'); maps = (d && d.maps) || []; }
  const host = $('level-list');
  if (!maps.length) { host.innerHTML = '<p class="muted">No theaters yet. An admin can build one.</p>'; return; }
  host.innerHTML = '';
  maps.forEach((m) => {
    const waves = (m.waves || []).length;
    const spawns = (m.spawnHexes || []).length;
    const card = document.createElement('button');
    card.className = 'level-card';
    card.innerHTML = `
      <div class="lc-name">${esc(m.name)}</div>
      <div class="lc-meta">radius ${m.radius} · ${spawns} spawn${spawns === 1 ? '' : 's'} · ${waves} wave${waves === 1 ? '' : 's'}</div>
      <div class="lc-desc">${esc(m.description || 'Defend the core.')}</div>`;
    card.addEventListener('click', () => {
      chosenMap = m;
      document.querySelectorAll('.level-card').forEach((c) => c.classList.remove('sel'));
      card.classList.add('sel');
      $('deploy-summary').textContent = `Theater: ${m.name} — ${waves} waves from ${spawns} spawn point${spawns === 1 ? '' : 's'}.`;
      $('btn-deploy').disabled = false;
    });
    host.appendChild(card);
  });
}

async function loadCampaign() {
  const res = await api('/api/v1/levels?status=approved');
  const levels = (res && res.levels) || [];
  const panel = $('panel-campaign');
  const host = $('lobby-campaign');
  if (!host) return;
  if (!levels.length) { if (panel) panel.style.display = 'none'; return; }
  if (panel) panel.style.display = '';
  host.innerHTML = '';
  levels.forEach((lv, i) => {
    const order = (lv.order != null ? lv.order : i + 1);
    const desc = String(lv.description || 'Clear this theater to advance.');
    const shortDesc = desc.length > 110 ? desc.slice(0, 107) + '…' : desc;
    const card = document.createElement('div');
    card.className = 'campaign-card';
    card.innerHTML = `
      <img class="cc-banner" alt="" src="/assets/img/levels/${esc(lv.slug)}.png" onerror="this.style.display='none'">
      <span class="cc-badge">${esc(order)}</span>
      <div class="cc-body">
        <div class="cc-name">${esc(lv.name)}</div>
        <div class="cc-desc">${esc(shortDesc)}</div>
        <button class="cc-deploy" type="button">Deploy ▸</button>
      </div>`;
    const go = () => { window.location.href = '/play?level=' + encodeURIComponent(lv._id); };
    card.addEventListener('click', go);
    const btn = card.querySelector('.cc-deploy');
    if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); go(); });
    host.appendChild(card);
  });
}

let TOWER_DEFS = [];
async function loadTowers() {
  const res = await api('/api/v1/towers?status=approved');
  let towers = (res && res.towers) || [];
  if (!towers.length) { const d = await api('/api/v1/towers?status=draft'); towers = (d && d.towers) || []; }
  TOWER_DEFS = towers;
  renderTowerCache();
}

function renderTowerCache() {
  const host = $('cache-towers');
  if (!TOWER_DEFS.length) { host.innerHTML = '<p class="muted">No towers in the cache yet.</p>'; return; }
  const p = (econ && econ.prices) || { buildComponentCost: 8, buyTowerChips: 120 };
  host.innerHTML = '';
  TOWER_DEFS.forEach((t) => {
    const owned = builtCount(t._id);
    const row = document.createElement('div');
    row.className = 'cache-item build-item';
    row.innerHTML =
      '<div class="ci-head"><span class="ci-name">' + esc(t.name) + '</span>' +
      (owned ? '<span class="ci-owned">×' + owned + ' built</span>' : '') + '</div>' +
      '<div class="ci-stats">DMG ' + (t.stats?.damage ?? '?') + ' · RNG ' + (t.stats?.range ?? '?') + '</div>' +
      '<div class="ci-actions">' +
        '<button class="btn small bd-build">🔩 Build (' + p.buildComponentCost + ' parts)</button>' +
        '<button class="btn small bd-buy">🪙 Buy (' + p.buyTowerChips + ')</button>' +
      '</div>';
    row.querySelector('.bd-build').addEventListener('click', async () => {
      const r = await econPost('build', { towerId: t._id });
      if (r && r.success) { toast('Built ' + t.name); renderTowerCache(); }
      else toast((r && r.error) || 'Need more parts');
    });
    row.querySelector('.bd-buy').addEventListener('click', async () => {
      const r = await econPost('buy', { kind: 'tower', towerId: t._id });
      if (r && r.success) { toast('Bought ' + t.name); renderTowerCache(); }
      else toast((r && r.error) || 'Not enough chips');
    });
    host.appendChild(row);
  });
}

function renderCards(cards) {
  const host = $('cache-cards');
  if (!cards.length) { host.innerHTML = '<p class="muted">No action cards yet — win runs to earn them.</p>'; return; }
  host.innerHTML = cards.map((c) => `
    <div class="cache-item">
      <div class="ci-name">${c.icon || '✦'} ${esc(c.name)} ${c.count > 1 ? `<span class="ci-x">×${c.count}</span>` : ''}</div>
      <div class="ci-stats">${esc(c.rarity || '')} · ${esc(c.description || '')}</div>
    </div>`).join('');
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

// tabs
document.querySelectorAll('.cache-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.cache-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    $('cache-towers').style.display = which === 'towers' ? '' : 'none';
    $('cache-cards').style.display = which === 'cards' ? '' : 'none';
  });
});

$('btn-deploy').addEventListener('click', () => {
  if (!chosenMap) return;
  window.location.href = `/play?map=${encodeURIComponent(chosenMap._id)}`;
});

$('btn-coop').addEventListener('click', () => {
  // Co-op uses the arcade matchmaking/invite flow. Backend co-op sim lands later;
  // for now bounce into matchmaking intake for towers so the invite system can form a pair.
  toast('Opening co-op matchmaking…');
  setTimeout(() => { window.location.href = `${MATCH_URL}/intake/towers`; }, 600);
});

const buyParts = $('buy-parts'), buyAmmo = $('buy-ammo');
if (buyParts) buyParts.addEventListener('click', async () => {
  const r = await econPost('buy', { kind: 'components' });
  toast(r && r.success ? 'Bought parts' : ((r && r.error) || 'Not enough chips'));
});
if (buyAmmo) buyAmmo.addEventListener('click', async () => {
  const r = await econPost('buy', { kind: 'ammo' });
  toast(r && r.success ? 'Bought ammo' : ((r && r.error) || 'Not enough chips'));
});

(async () => { await loadEconomy(); await loadTowers(); })();
loadStats();
loadLevels();
loadCampaign();
