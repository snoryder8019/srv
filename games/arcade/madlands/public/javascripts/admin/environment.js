/* Environment builder — posts manual notes to the focused agent and renders the
   structured artifact it returns. */
const $ = (id) => document.getElementById(id);

$('run').addEventListener('click', async () => {
  const payload = {
    name:  $('f-name').value.trim(),
    tier:  $('f-tier').value,
    hexKey: $('f-hex').value.trim() || null,
    mood:  $('f-mood').value.trim(),
    biome: $('f-biome').value.trim(),
    notes: $('f-notes').value.trim(),
  };
  setStatus('running agent on the gpu tunnel…', 'busy');
  $('run').disabled = true;
  try {
    const res = await fetch('/admin/environment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.ok) {
      setStatus('agent error: ' + (json.error || res.status), 'err');
      $('out').textContent = json.raw ? String(json.raw) : JSON.stringify(json, null, 2);
      return;
    }
    $('out').textContent = JSON.stringify(json.data, null, 2);
    renderSwatch(json.data.palette);
    setStatus(json.persisted ? 'saved build ' + json.buildId : 'generated (not persisted — db offline)', 'ok');
  } catch (e) {
    setStatus('request failed: ' + e.message, 'err');
  } finally {
    $('run').disabled = false;
  }
});

function setStatus(msg, kind) {
  const s = $('status');
  s.textContent = msg;
  s.className = 'status ' + (kind || '');
}

function renderSwatch(palette) {
  const el = $('swatch');
  el.innerHTML = '';
  (Array.isArray(palette) ? palette : []).forEach((c) => {
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = c;
    sw.title = c;
    el.appendChild(sw);
  });
}
