import fs from 'fs';
const F = '/srv/td/public/javascripts/game/lobby.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('loadEconomy')) { console.log('already'); process.exit(0); }

// 1) economy state + loader. Renders the resource bar and powers build/buy.
s = s.replace(
  `let chosenMap = null;
const MATCH_URL = 'https://match.madladslab.com';`,
  `let chosenMap = null;
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
}`
);

// 2) rewrite loadTowers to show Build / Buy + owned count per tower
s = s.replace(
  `async function loadTowers() {
  const res = await api('/api/v1/towers?status=approved');
  let towers = (res && res.towers) || [];
  if (!towers.length) { const d = await api('/api/v1/towers?status=draft'); towers = (d && d.towers) || []; }
  const host = $('cache-towers');
  if (!towers.length) { host.innerHTML = '<p class="muted">No towers in the cache yet.</p>'; return; }
  host.innerHTML = towers.map((t) => \`
    <div class="cache-item">
      <div class="ci-name">\${esc(t.name)}</div>
      <div class="ci-stats">DMG \${t.stats?.damage ?? '?'} · RNG \${t.stats?.range ?? '?'} · $\${t.stats?.cost ?? '?'}</div>
    </div>\`).join('');
}`,
  `let TOWER_DEFS = [];
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
}`
);

// 3) wire the resource shop buttons (buy parts / ammo) + boot loadEconomy
s = s.replace(
  `loadStats();
loadLevels();
loadTowers();`,
  `const buyParts = $('buy-parts'), buyAmmo = $('buy-ammo');
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
loadLevels();`
);

fs.writeFileSync(F, s);
console.log('lobby.js: economy bar + build/buy wired');
