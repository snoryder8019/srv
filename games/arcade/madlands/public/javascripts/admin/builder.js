/* Generic builder client — run fills the form, guardrails surface warnings,
   save persists (blocked on hard errors). Works for any agent kind. */
const KIND = document.body.dataset.kind;
const FIELDS = JSON.parse(document.getElementById('fielddefs').textContent);
const LIST_KEYS = FIELDS.filter((f) => f.type === 'list' || f.type === 'colorlist').map((f) => f.key);
const COLOR_KEYS = FIELDS.filter((f) => f.type === 'colorlist').map((f) => f.key);
const $ = (id) => document.getElementById(id);

const splitList = (v) => String(v || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
function collect() {
  const o = {};
  for (const f of FIELDS) { const el = $('f-' + f.key); if (!el) continue; o[f.key] = LIST_KEYS.includes(f.key) ? splitList(el.value) : el.value; }
  return o;
}
function fill(data) {
  for (const f of FIELDS) {
    if (f.key === 'hexKey' || f.key === 'tier') continue; // operator-owned, never agent-filled
    const el = $('f-' + f.key); if (!el || data[f.key] == null) continue;
    let v = data[f.key];
    if (Array.isArray(v)) v = v.join(', '); else if (typeof v === 'object') v = JSON.stringify(v);
    el.value = v;
  }
  COLOR_KEYS.forEach(renderSwatch);
}
function renderSwatch(key) {
  const box = $('sw-' + key); if (!box) return;
  box.innerHTML = '';
  splitList($('f-' + key).value).forEach((c) => { const s = document.createElement('span'); s.className = 'sw'; s.style.background = c; s.title = c; box.appendChild(s); });
}
COLOR_KEYS.forEach((k) => $('f-' + k)?.addEventListener('input', () => renderSwatch(k)));

function setStatus(m, k) { const s = $('status'); s.textContent = m; s.className = 'status ' + (k || ''); }
function showGuard(errors = [], warnings = []) {
  const g = $('guard'); g.innerHTML = '';
  const add = (cls, label, arr) => arr.forEach((m) => { const d = document.createElement('div'); d.className = 'g-' + cls; d.textContent = (label + ' ' + m); g.appendChild(d); });
  add('err', '✕', errors); add('warn', '!', warnings);
}

$('run').addEventListener('click', async () => {
  setStatus('running the ' + KIND + ' agent…', 'busy'); showGuard();
  $('run').disabled = true;
  try {
    const res = await fetch(`/admin/${KIND}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collect()) });
    const json = await res.json();
    if (!json.ok) { setStatus('agent error: ' + (json.error || res.status), 'err'); $('out').textContent = json.raw || JSON.stringify(json, null, 2); return; }
    fill(json.data);
    $('out').textContent = JSON.stringify(json.data, null, 2);
    showGuard(json.errors, json.warnings);
    $('save').disabled = (json.errors && json.errors.length) > 0;
    setStatus((json.errors && json.errors.length) ? 'fix the errors below before saving' : 'filled — review/edit, then save', (json.errors && json.errors.length) ? 'err' : 'ok');
  } catch (e) { setStatus('request failed: ' + e.message, 'err'); }
  finally { $('run').disabled = false; }
});

$('save').addEventListener('click', async () => {
  setStatus('saving…', 'busy'); $('save').disabled = true;
  try {
    const res = await fetch(`/admin/${KIND}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collect()) });
    const json = await res.json();
    if (!json.ok) {
      if (json.errors) showGuard(json.errors, json.warnings);
      setStatus('save blocked: ' + (json.error || res.status), 'err'); $('save').disabled = false; return;
    }
    showGuard([], json.warnings || []);
    setStatus('saved build ' + json.buildId, 'ok');
  } catch (e) { setStatus('save failed: ' + e.message, 'err'); $('save').disabled = false; }
});
