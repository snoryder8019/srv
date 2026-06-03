/**
 * Story Arc builder — authoring UI for narrative arcs.
 *
 * Cast characters (each with an SD-generated "headset" portrait) and place
 * dialogue beats on the run timeline (run-start, wave-start/cleared, base-below,
 * objective, win/lose). Saves to /api/v1/stories. Lives beside the Map + Tower
 * builders; admin-only via the page route.
 */

const $ = (id) => document.getElementById(id);
const api = (path, opts) => fetch('/api/v1' + path, opts).then((r) => r.json());
const slugify = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const TRIGGERS = [
  { v: 'run-start', label: 'Run start' },
  { v: 'wave-start', label: 'Wave starts' },
  { v: 'wave-cleared', label: 'Wave cleared' },
  { v: 'base-below', label: 'Base health below %' },
  { v: 'objective-complete', label: 'Objective complete' },
  { v: 'objective-failed', label: 'Objective failed' },
  { v: 'run-won', label: 'Run won' },
  { v: 'run-lost', label: 'Run lost' },
];

const model = {
  _id: null,
  title: '', slug: '', synopsis: '', mapId: '', mapSlug: '',
  characters: [],   // { slug, name, role, color, portraitUrl, portraitPrompt }
  beats: [],        // { id, trigger:{type,wave,threshold,objectiveId,once}, speaker, lines:[], improvise, effects:{} }
};
let beatSeq = 1, charSeq = 1;

/* ---------------- characters ---------------- */
function addCharacter(c = {}) {
  model.characters.push({
    slug: c.slug || ('npc-' + (charSeq++)), name: c.name || 'New Character',
    role: c.role || '', color: c.color || '#33ddff',
    portraitUrl: c.portraitUrl || '', portraitPrompt: c.portraitPrompt || '',
  });
  renderChars();
}
function renderChars() {
  const host = $('st-chars'); host.innerHTML = '';
  model.characters.forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'char-row';
    row.innerHTML = `
      <div class="char-port">${c.portraitUrl ? `<img src="${c.portraitUrl}" alt="">` : '<span class="ph">no art</span>'}</div>
      <div class="char-fields">
        <input data-k="name" value="${esc(c.name)}" placeholder="Name">
        <input data-k="role" value="${esc(c.role)}" placeholder="Role / title">
        <div class="row">
          <input data-k="slug" value="${esc(c.slug)}" placeholder="slug" style="flex:1">
          <input data-k="color" type="color" value="${c.color || '#33ddff'}">
          <button type="button" class="btn small del">✕</button>
        </div>
        <textarea data-k="portraitPrompt" rows="2" placeholder="Portrait prompt for SD (e.g. grizzled scout, scar over eye, mud-streaked armor)">${esc(c.portraitPrompt)}</textarea>
        <button type="button" class="btn small gen">🎨 Generate portrait</button>
        <span class="gen-status muted"></span>
      </div>`;
    row.querySelectorAll('input[data-k],textarea[data-k]').forEach((inp) => {
      inp.addEventListener('input', () => { c[inp.dataset.k] = inp.value; if (inp.dataset.k === 'color') renderTimeline(); });
    });
    row.querySelector('.del').addEventListener('click', () => { model.characters.splice(i, 1); renderChars(); renderBeats(); });
    row.querySelector('.gen').addEventListener('click', async () => {
      const st = row.querySelector('.gen-status');
      if (!c.portraitPrompt) { st.textContent = 'add a prompt first'; return; }
      if (!c.slug) c.slug = slugify(c.name) || ('npc-' + charSeq++);
      st.textContent = 'generating… (SD, ~30–90s)';
      try {
        const res = await api('/stories/portrait', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: c.slug, prompt: c.portraitPrompt }),
        });
        if (res.success) { c.portraitUrl = res.url; st.textContent = '✓ done'; renderChars(); renderBeats(); }
        else st.textContent = '✗ ' + (res.error || 'failed');
      } catch (e) { st.textContent = '✗ ' + e.message; }
    });
    host.appendChild(row);
  });
}

/* ---------------- beats ---------------- */
function addBeat(b = {}) {
  model.beats.push({
    id: b.id || ('beat-' + (beatSeq++)),
    trigger: { type: b.trigger?.type || 'wave-start', wave: b.trigger?.wave ?? 0, threshold: b.trigger?.threshold ?? 50, objectiveId: b.trigger?.objectiveId || '', once: b.trigger?.once ?? true },
    speaker: b.speaker || (model.characters[0]?.slug || 'vesk'),
    lines: b.lines && b.lines.length ? b.lines.slice() : [''],
    improvise: !!b.improvise,
    effects: { grantCurrency: b.effects?.grantCurrency || 0, healBase: b.effects?.healBase || 0, pauseUntilDismissed: b.effects?.pauseUntilDismissed ?? true },
  });
  renderBeats();
}
function renderBeats() {
  const host = $('st-beats'); host.innerHTML = '';
  model.beats.forEach((b, i) => {
    const row = document.createElement('div'); row.className = 'beat-row';
    const charOpts = model.characters.map((c) => `<option value="${esc(c.slug)}" ${c.slug === b.speaker ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
      || '<option value="vesk">Vesk (default)</option>';
    const trigOpts = TRIGGERS.map((t) => `<option value="${t.v}" ${t.v === b.trigger.type ? 'selected' : ''}>${t.label}</option>`).join('');
    row.innerHTML = `
      <div class="beat-head">
        <span class="beat-n">${i + 1}</span>
        <select data-k="trigger.type">${trigOpts}</select>
        <input class="trig-wave" data-k="trigger.wave" type="number" min="0" value="${b.trigger.wave}" title="wave # (0-based)">
        <input class="trig-thr" data-k="trigger.threshold" type="number" min="1" max="100" value="${b.trigger.threshold}" title="base % threshold">
        <button type="button" class="btn small del">✕</button>
      </div>
      <div class="beat-body">
        <label class="inline">Speaker <select data-k="speaker">${charOpts}</select></label>
        <label class="inline"><input type="checkbox" data-k="improvise" ${b.improvise ? 'checked' : ''}> Improvise (LLM)</label>
        <label class="inline"><input type="checkbox" data-k="effects.pauseUntilDismissed" ${b.effects.pauseUntilDismissed ? 'checked' : ''}> Pause game</label>
        <div class="lines"></div>
        <button type="button" class="btn small addline">+ line</button>
        <div class="row fx">
          <label class="inline">+Currency <input type="number" data-k="effects.grantCurrency" value="${b.effects.grantCurrency}" style="width:64px"></label>
          <label class="inline">Heal base <input type="number" data-k="effects.healBase" value="${b.effects.healBase}" style="width:64px"></label>
        </div>
      </div>`;
    // field bindings
    row.querySelectorAll('[data-k]').forEach((inp) => {
      const apply = () => {
        const path = inp.dataset.k.split('.');
        const val = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' ? Number(inp.value) : inp.value);
        let o = b; for (let j = 0; j < path.length - 1; j++) o = o[path[j]];
        o[path[path.length - 1]] = val;
        if (inp.dataset.k === 'trigger.type') renderBeats();
        renderTimeline();
      };
      inp.addEventListener('input', apply); inp.addEventListener('change', apply);
    });
    // show/hide wave vs threshold field per trigger
    const tw = row.querySelector('.trig-wave'), tt = row.querySelector('.trig-thr');
    tw.style.display = (b.trigger.type === 'wave-start' || b.trigger.type === 'wave-cleared') ? '' : 'none';
    tt.style.display = (b.trigger.type === 'base-below') ? '' : 'none';
    // lines
    const linesEl = row.querySelector('.lines');
    const drawLines = () => {
      linesEl.innerHTML = '';
      b.lines.forEach((ln, li) => {
        const lr = document.createElement('div'); lr.className = 'line-row';
        lr.innerHTML = `<textarea rows="1" placeholder="dialogue line">${esc(ln)}</textarea><button type="button" class="btn small lndel">✕</button>`;
        const ta = lr.querySelector('textarea');
        ta.addEventListener('input', () => { b.lines[li] = ta.value; renderTimeline(); });
        lr.querySelector('.lndel').addEventListener('click', () => { b.lines.splice(li, 1); if (!b.lines.length) b.lines.push(''); drawLines(); renderTimeline(); });
        linesEl.appendChild(lr);
      });
    };
    drawLines();
    row.querySelector('.addline').addEventListener('click', () => { b.lines.push(''); drawLines(); });
    row.querySelector('.del').addEventListener('click', () => { model.beats.splice(i, 1); renderBeats(); renderTimeline(); });
    host.appendChild(row);
  });
  renderTimeline();
}

/* ---------------- preview timeline ---------------- */
function renderTimeline() {
  const host = $('st-timeline'); if (!host) return;
  const charBy = Object.fromEntries(model.characters.map((c) => [c.slug, c]));
  const order = { 'run-start': 0, 'wave-start': 1, 'wave-cleared': 2, 'base-below': 3, 'objective-complete': 4, 'objective-failed': 4, 'run-won': 9, 'run-lost': 9 };
  const beats = model.beats.slice().sort((a, b) => (order[a.trigger.type] - order[b.trigger.type]) || (a.trigger.wave - b.trigger.wave));
  host.innerHTML = beats.map((b) => {
    const c = charBy[b.speaker] || { name: b.speaker, color: '#33ddff', portraitUrl: '' };
    const trig = TRIGGERS.find((t) => t.v === b.trigger.type)?.label || b.trigger.type;
    const sub = b.trigger.type.startsWith('wave') ? ` ${b.trigger.wave + 1}` : (b.trigger.type === 'base-below' ? ` ${b.trigger.threshold}%` : '');
    return `<div class="tl-beat" style="--accent:${c.color}">
      <div class="tl-trig">${trig}${sub}</div>
      <div class="tl-card">
        <div class="tl-port">${c.portraitUrl ? `<img src="${c.portraitUrl}">` : '<span class="ph"></span>'}</div>
        <div class="tl-text"><div class="tl-name">${esc(c.name)}</div><div class="tl-line">${esc((b.improvise ? '✦ ' : '') + (b.lines[0] || '…'))}</div></div>
      </div></div>`;
  }).join('') || '<p class="muted">No beats yet.</p>';
}

/* ---------------- load / save ---------------- */
async function loadMaps() {
  const sel = $('st-map');
  for (const status of ['approved', 'draft']) {
    const res = await api('/maps?status=' + status).catch(() => ({}));
    for (const m of (res.maps || [])) {
      const o = document.createElement('option'); o.value = m._id; o.textContent = `${m.name} (${status})`; o.dataset.slug = m.slug;
      sel.appendChild(o);
    }
  }
}
async function loadExisting() {
  const sel = $('st-existing');
  const res = await api('/stories').catch(() => ({}));
  for (const st of (res.stories || [])) {
    const o = document.createElement('option'); o.value = st._id; o.textContent = `${st.title} (${st.status})`;
    sel.appendChild(o);
  }
}
function collect() {
  model.title = $('st-title').value.trim();
  model.slug = $('st-slug').value.trim() || slugify(model.title);
  model.synopsis = $('st-synopsis').value.trim();
  const mapSel = $('st-map');
  model.mapId = mapSel.value || '';
  model.mapSlug = mapSel.selectedOptions[0]?.dataset.slug || '';
  return {
    title: model.title, slug: model.slug, synopsis: model.synopsis,
    mapId: model.mapId || undefined, mapSlug: model.mapSlug,
    characters: model.characters, beats: model.beats,
  };
}
async function save(status) {
  const payload = collect();
  if (!payload.title || !payload.slug) { setStatus('Title + slug required'); return; }
  if (status) payload.status = status;
  setStatus('Saving…');
  try {
    const res = model._id
      ? await api('/stories/' + model._id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      : await api('/stories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.success) { model._id = res.story._id; setStatus('✓ Saved (' + res.story.status + ')'); }
    else setStatus('✗ ' + (res.error || 'save failed'));
  } catch (e) { setStatus('✗ ' + e.message); }
}
async function load(id) {
  if (!id) return;
  const res = await api('/stories/' + id).catch(() => ({}));
  if (!res.success) { setStatus('load failed'); return; }
  const st = res.story;
  model._id = st._id; model.characters = st.characters || []; model.beats = (st.beats || []);
  $('st-title').value = st.title || ''; $('st-slug').value = st.slug || ''; $('st-synopsis').value = st.synopsis || '';
  if (st.mapId) $('st-map').value = st.mapId;
  renderChars(); renderBeats();
  setStatus('Loaded "' + st.title + '"');
}

function setStatus(t) { $('st-status').textContent = t; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

/* ---------------- boot ---------------- */
$('st-add-char').addEventListener('click', () => addCharacter());
$('st-add-beat').addEventListener('click', () => addBeat());
$('st-save').addEventListener('click', () => save());
$('st-submit').addEventListener('click', () => save('submitted'));
$('st-load').addEventListener('click', () => load($('st-existing').value));
$('st-title').addEventListener('input', () => { if (!$('st-slug').value) $('st-slug').value = slugify($('st-title').value); });

loadMaps();
loadExisting();
// seed with a default commander + an opening beat so the builder isn't empty
addCharacter({ slug: 'vesk', name: 'Vesk', role: 'Hexwarden', color: '#33ddff', portraitUrl: '/assets/img/vesk-portrait.png' });
addBeat({ trigger: { type: 'run-start' }, speaker: 'vesk', lines: ['Towers up, Architect. The core must not fall.'] });
