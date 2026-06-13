/* Environment SD art — generate sky + ground from the filled prompts, save the
   build with the image URLs, and show thumbnails. SD is slow (~1–2 min). */
const FIELDS = JSON.parse(document.getElementById('fielddefs').textContent);
const LIST = FIELDS.filter((f) => f.type === 'list' || f.type === 'colorlist').map((f) => f.key);
const $ = (id) => document.getElementById(id);
const setStatus = (m, k) => { const s = $('status'); s.textContent = m; s.className = 'status ' + (k || ''); };

function collect() {
  const o = {};
  for (const f of FIELDS) {
    const el = $('f-' + f.key); if (!el) continue;
    o[f.key] = LIST.includes(f.key) ? String(el.value || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : el.value;
  }
  return o;
}

$('genart')?.addEventListener('click', async () => {
  const data = collect();
  if (!data.skyPrompt && !data.groundPrompt) { setStatus('run the agent first to get sky/ground prompts', 'err'); return; }
  setStatus('generating sky + ground on the GPU (Stable Diffusion, ~1–2 min)…', 'busy');
  $('genart').disabled = true;
  try {
    const res = await fetch('/admin/environment/art', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const j = await res.json();
    if (!j.ok) { setStatus('art failed: ' + (j.error || res.status), 'err'); return; }
    const box = $('art'); box.innerHTML = '';
    [['sky', j.skyUrl], ['ground', j.groundUrl]].forEach(([label, url]) => {
      if (!url) return;
      const fig = document.createElement('figure');
      fig.innerHTML = `<img src="${url}" alt="${label}"/><figcaption>${label}</figcaption>`;
      box.appendChild(fig);
    });
    setStatus('art generated' + (j.buildId ? ' · saved build ' + j.buildId : '') + ' — descend into this hex on the map to see it', 'ok');
  } catch (e) { setStatus('art failed: ' + e.message, 'err'); }
  finally { $('genart').disabled = false; }
});
