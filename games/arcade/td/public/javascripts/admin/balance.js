/**
 * Balance console - admin CRUD for enemies, towers, maps, and levels.
 * Talks to /api/v1/admin/* (admin-gated, same-origin session cookie).
 */
const API = '/api/v1/admin';
const $ = (s) => document.querySelector(s);
const esc = (s) => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
const escAttr = (s) => String(s ?? '').replace(/"/g, '&quot;');

let toastTimer = null;
function toast(msg, bad) {
  const t = $('#admin-toast');
  t.textContent = msg;
  t.className = 'admin-toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'admin-toast'; }, 2600);
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

// Read all [data-field] inputs in a card into a (possibly nested) object.
function readFields(card) {
  const o = {};
  card.querySelectorAll('[data-field]').forEach((el) => {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') v = el.value === '' ? null : Number(el.value);
    else v = el.value;
    const parts = el.dataset.field.split('.');
    let cur = o;
    for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
    cur[parts[parts.length - 1]] = v;
  });
  return o;
}

const colorIntToHex = (n) => '#' + ((Number(n) >>> 0) & 0xffffff).toString(16).padStart(6, '0');
const hexToColorInt = (h) => parseInt(String(h).replace('#', ''), 16) || 0;

// ---- Tabs ----
const TABS = ['enemies', 'towers', 'maps', 'levels'];
document.querySelectorAll('.admin-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach((t) => t.classList.toggle('active', t === tab));
    const name = tab.dataset.tab;
    TABS.forEach((p) => { $('#panel-' + p).hidden = (p !== name); });
    if (name === 'levels') loadLevels();
  });
});

/* ============================ ENEMIES ============================ */
async function loadEnemies() {
  const el = $('#enemy-list');
  try {
    const { types } = await api('GET', '/enemy-types');
    if (!types.length) { el.innerHTML = '<em>No enemy types yet — add one.</em>'; return; }
    el.innerHTML = types.map((t) => `
      <div class="edit-card" data-slug="${escAttr(t.slug)}">
        <h3>${esc(t.name)} <span class="swatch" style="background:${colorIntToHex(t.color)}"></span></h3>
        <div class="slug">${esc(t.slug)}</div>
        <div class="field"><label>Name</label><input type="text" data-field="name" value="${escAttr(t.name)}"></div>
        <div class="field"><label>HP</label><input type="number" data-field="hp" value="${t.hp}"></div>
        <div class="field"><label>Speed</label><input type="number" step="0.1" data-field="speed" value="${t.speed}"></div>
        <div class="field"><label>Reward</label><input type="number" data-field="reward" value="${t.reward}"></div>
        <div class="field"><label>Color</label><input type="color" data-field="color" value="${colorIntToHex(t.color)}"></div>
        <div class="field"><label>Model</label><input type="text" data-field="model" value="${escAttr(t.model || '')}"></div>
        <div class="field"><label>Enabled</label><input type="checkbox" data-field="enabled" ${t.enabled ? 'checked' : ''}></div>
        <div class="row-btns"><button class="btn small" data-act="save">Save</button><button class="btn small danger" data-act="del">Delete</button></div>
      </div>`).join('');
  } catch (e) { el.innerHTML = `<em>Failed to load: ${esc(e.message)}</em>`; }
}
$('#enemy-list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-act]'); if (!btn) return;
  const card = btn.closest('.edit-card'); const slug = card.dataset.slug;
  try {
    if (btn.dataset.act === 'save') {
      const f = readFields(card); f.color = hexToColorInt(f.color);
      await api('PATCH', '/enemy-types/' + slug, f); toast('Saved ' + slug);
    } else if (confirm('Delete enemy "' + slug + '"?')) {
      await api('DELETE', '/enemy-types/' + slug); toast('Deleted ' + slug); loadEnemies();
    }
  } catch (e) { toast(e.message, true); }
});
$('#enemy-add').addEventListener('click', async () => {
  const name = prompt('Enemy name?'); if (!name) return;
  const slug = prompt('Slug (lowercase id)?', name.toLowerCase().replace(/[^a-z0-9]+/g, '-')); if (!slug) return;
  try { await api('POST', '/enemy-types', { slug, name, hp: 20, speed: 1.5, reward: 5, color: 0x88ff88, enabled: true }); toast('Created ' + slug); loadEnemies(); }
  catch (e) { toast(e.message, true); }
});

/* ============================ TOWERS ============================ */
const TARGETING = ['nearest', 'first', 'last', 'strongest', 'weakest'];
const TOWER_STATUS = ['draft', 'submitted', 'approved', 'rejected', 'featured'];
const CATEGORIES = ['kinetic', 'energy', 'support', 'special'];
const optList = (arr, sel) => arr.map((o) => `<option ${o === sel ? 'selected' : ''}>${o}</option>`).join('');

async function loadTowers() {
  const el = $('#tower-list');
  try {
    const { towers } = await api('GET', '/towers');
    if (!towers.length) { el.innerHTML = '<em>No towers yet — build one.</em>'; return; }
    el.innerHTML = towers.map((t) => `
      <div class="edit-card" data-id="${t._id}">
        <h3>${esc(t.name)}</h3>
        <div class="slug">${esc(t.slug)} · ${esc(t.category || 'kinetic')}</div>
        <div class="field"><label>Name</label><input type="text" data-field="name" value="${escAttr(t.name)}"></div>
        <div class="field"><label>Category</label><select data-field="category">${optList(CATEGORIES, t.category)}</select></div>
        <div class="field"><label>Status</label><select data-field="status">${optList(TOWER_STATUS, t.status)}</select></div>
        <div class="field"><label>Damage</label><input type="number" data-field="stats.damage" value="${t.stats?.damage}"></div>
        <div class="field"><label>Range</label><input type="number" data-field="stats.range" value="${t.stats?.range}"></div>
        <div class="field"><label>Fire rate</label><input type="number" step="0.1" data-field="stats.fireRate" value="${t.stats?.fireRate}"></div>
        <div class="field"><label>Cost</label><input type="number" data-field="stats.cost" value="${t.stats?.cost}"></div>
        <div class="field"><label>Targeting</label><select data-field="behavior.targeting">${optList(TARGETING, t.behavior?.targeting)}</select></div>
        <div class="field"><label>Splash radius</label><input type="number" data-field="behavior.splashRadius" value="${t.behavior?.splashRadius || 0}"></div>
        <div class="field"><label>Scale</label><input type="number" step="0.1" data-field="scale" value="${t.scale ?? 1}"></div>
        <div class="row-btns"><button class="btn small" data-act="save">Save</button><button class="btn small danger" data-act="del">Delete</button></div>
      </div>`).join('');
  } catch (e) { el.innerHTML = `<em>Failed to load: ${esc(e.message)}</em>`; }
}
$('#tower-list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-act]'); if (!btn) return;
  const card = btn.closest('.edit-card'); const id = card.dataset.id;
  try {
    if (btn.dataset.act === 'save') { await api('PATCH', '/towers/' + id, readFields(card)); toast('Saved tower'); }
    else if (confirm('Delete this tower?')) { await api('DELETE', '/towers/' + id); toast('Deleted'); loadTowers(); }
  } catch (e) { toast(e.message, true); }
});
$('#tower-add').addEventListener('click', async () => {
  const name = prompt('Tower name?'); if (!name) return;
  try { await api('POST', '/towers', { name }); toast('Created ' + name); loadTowers(); }
  catch (e) { toast(e.message, true); }
});

/* ============================ MAPS (boards) ============================ */
const MAP_STATUS = ['draft', 'submitted', 'approved', 'rejected', 'featured'];
async function loadMaps() {
  const el = $('#map-list');
  try {
    const { maps } = await api('GET', '/maps');
    cacheMaps = maps;
    if (!maps.length) { el.innerHTML = '<em>No maps yet — add one, then paint it in the builder.</em>'; return; }
    el.innerHTML = maps.map((m) => `
      <div class="edit-card" data-id="${m._id}">
        <h3>${esc(m.name)}</h3>
        <div class="slug">${esc(m.slug)} · r${m.radius} · ${(m.pathHexes || []).length} path / ${(m.spawnHexes || []).length} spawn / ${(m.baseHexes || []).length} base</div>
        <div class="field"><label>Name</label><input type="text" data-field="name" value="${escAttr(m.name)}"></div>
        <div class="field"><label>Radius</label><input type="number" data-field="radius" value="${m.radius}"></div>
        <div class="field"><label>Status</label><select data-field="status">${optList(MAP_STATUS, m.status)}</select></div>
        <div class="row-btns">
          <button class="btn small" data-act="save">Save</button>
          <a class="btn small ghost" href="/build/map?id=${m._id}" target="_blank">Edit board ↗</a>
          <button class="btn small danger" data-act="del">Delete</button>
        </div>
      </div>`).join('');
  } catch (e) { el.innerHTML = `<em>Failed to load: ${esc(e.message)}</em>`; }
}
$('#map-list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]'); if (!btn) return;
  const card = btn.closest('.edit-card'); const id = card.dataset.id;
  try {
    if (btn.dataset.act === 'save') { await api('PATCH', '/maps/' + id, readFields(card)); toast('Saved map'); }
    else if (confirm('Delete this map?')) { await api('DELETE', '/maps/' + id); toast('Deleted'); loadMaps(); }
  } catch (e) { toast(e.message, true); }
});
$('#map-add').addEventListener('click', async () => {
  const name = prompt('Map name?'); if (!name) return;
  try { const { map } = await api('POST', '/maps', { name, radius: 6 }); toast('Created — open the builder to paint it'); loadMaps(); }
  catch (e) { toast(e.message, true); }
});

/* ============================ LEVELS (map + waves) ============================ */
let cacheMaps = [];
const LEVEL_STATUS = ['draft', 'approved', 'featured'];
const WAVE_HINT = '[{"enemies":[{"type":"basic","count":10,"delayMs":800}],"intermissionMs":5000}]';

async function loadLevels() {
  const el = $('#level-list');
  try {
    if (!cacheMaps.length) { try { cacheMaps = (await api('GET', '/maps')).maps; } catch {} }
    const { levels } = await api('GET', '/levels');
    const mapOpts = (sel) => cacheMaps.map((m) => `<option value="${m._id}" ${String(sel) === String(m._id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
    if (!levels.length) { el.innerHTML = '<em>No levels yet — create one on a map.</em>'; return; }
    el.innerHTML = levels.map((lv) => {
      const mod = lv.modifiers || {};
      const mapId = lv.mapId && lv.mapId._id ? lv.mapId._id : lv.mapId;
      return `
      <div class="edit-card" data-id="${lv._id}">
        <h3>${esc(lv.name)}</h3>
        <div class="slug">${esc(lv.slug)} · ${(lv.waves || []).length} waves</div>
        <div class="field"><label>Name</label><input type="text" data-field="name" value="${escAttr(lv.name)}"></div>
        <div class="field"><label>Map</label><select data-field="mapId">${mapOpts(mapId)}</select></div>
        <div class="field"><label>Status</label><select data-field="status">${optList(LEVEL_STATUS, lv.status)}</select></div>
        <div class="field"><label>Order</label><input type="number" data-field="order" value="${lv.order || 0}"></div>
        <div class="field"><label>Start $</label><input type="number" data-field="modifiers.startingCurrency" value="${mod.startingCurrency ?? ''}"></div>
        <div class="field"><label>Base HP</label><input type="number" data-field="modifiers.baseHealth" value="${mod.baseHealth ?? ''}"></div>
        <div class="field"><label>Enemy HP ×</label><input type="number" step="0.1" data-field="modifiers.enemyHpMult" value="${mod.enemyHpMult ?? 1}"></div>
        <div class="field"><label>Enemy spd ×</label><input type="number" step="0.1" data-field="modifiers.enemySpeedMult" value="${mod.enemySpeedMult ?? 1}"></div>
        <div class="field"><label>Reward ×</label><input type="number" step="0.1" data-field="modifiers.rewardMult" value="${mod.rewardMult ?? 1}"></div>
        <label class="hint">Waves (JSON)</label>
        <textarea class="wave-json" data-waves placeholder='${WAVE_HINT}'>${esc(JSON.stringify(lv.waves || [], null, 2))}</textarea>
        <div class="row-btns"><button class="btn small" data-act="save">Save</button><button class="btn small danger" data-act="del">Delete</button></div>
      </div>`; }).join('');
  } catch (e) { el.innerHTML = `<em>Failed to load: ${esc(e.message)}</em>`; }
}
$('#level-list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-act]'); if (!btn) return;
  const card = btn.closest('.edit-card'); const id = card.dataset.id;
  try {
    if (btn.dataset.act === 'save') {
      const f = readFields(card);
      let waves;
      try { waves = JSON.parse(card.querySelector('[data-waves]').value || '[]'); }
      catch (e) { return toast('Waves JSON invalid: ' + e.message, true); }
      if (!Array.isArray(waves)) return toast('Waves must be a JSON array', true);
      f.waves = waves;
      await api('PATCH', '/levels/' + id, f); toast('Saved level');
    } else if (confirm('Delete this level?')) { await api('DELETE', '/levels/' + id); toast('Deleted'); loadLevels(); }
  } catch (e) { toast(e.message, true); }
});
$('#level-add').addEventListener('click', async () => {
  if (!cacheMaps.length) { try { cacheMaps = (await api('GET', '/maps')).maps; } catch {} }
  if (!cacheMaps.length) return toast('Create a map first', true);
  const name = prompt('Level name?'); if (!name) return;
  try { await api('POST', '/levels', { name, mapId: cacheMaps[0]._id, waves: [{ enemies: [{ type: 'basic', count: 10, delayMs: 800 }], intermissionMs: 5000 }] }); toast('Created ' + name); loadLevels(); }
  catch (e) { toast(e.message, true); }
});

// ---- Initial load ----
loadEnemies();
loadTowers();
loadMaps();
