/* Shell — director focus + the completion task board (per-hex progress + tasks). */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const ALL = ['environment', 'level', 'object', 'npc', 'storyline', 'music'];

async function loadDirector() {
  const list = document.getElementById('dir-list');
  list.innerHTML = '<p class="muted">Asking the director…</p>';
  try {
    const j = await (await fetch('/admin/director/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    list.innerHTML = '';
    if (j.focus) { const f = document.createElement('p'); f.className = 'dir-focus'; f.textContent = '“' + j.focus + '”'; list.appendChild(f); }
    (j.suggestions || []).forEach((it, i) => list.appendChild(suggestionEl(it, i)));
  } catch (e) { list.innerHTML = '<p class="muted">Director unavailable.</p>'; }
}

async function loadBoard() {
  const hexBox = document.getElementById('board-hexes');
  const taskBox = document.getElementById('task-list');
  try {
    const j = await (await fetch('/admin/director/board')).json();
    document.getElementById('board-totals').textContent =
      `· ${j.totals.hexes} hex(es) · ${j.totals.playable} playable · ${j.totals.complete} complete · ${j.totals.openTasks} open`;
    hexBox.innerHTML = '';
    if (!j.hexes.length) hexBox.innerHTML = '<p class="muted">No placed builds yet — give a build a hex key to start a hex.</p>';
    j.hexes.forEach((h) => hexBox.appendChild(hexRow(h)));
    taskBox.innerHTML = '';
    if (!j.tasks.length) taskBox.innerHTML = '<p class="muted">No open tasks — every hex is complete.</p>';
    j.tasks.forEach((t, i) => taskBox.appendChild(taskEl(t, i)));
  } catch (e) { hexBox.innerHTML = '<p class="muted">Board unavailable.</p>'; }
}

function hexRow(h) {
  const el = document.createElement('div');
  el.className = 'hexrow';
  const dots = ALL.map((k) => `<span class="dot ${h.done.includes(k) ? 'on' : ''}" title="${k}">${k[0]}</span>`).join('');
  el.innerHTML =
    `<span class="hx">@${esc(h.hexKey)}</span>` +
    `<span class="bar"><span class="bar-fill" style="width:${h.pct}%"></span></span>` +
    `<span class="pct">${h.pct}%</span>` +
    `<span class="dots">${dots}</span>` +
    (h.playable ? '<span class="tag tier">playable</span>' : '');
  return el;
}
function taskEl(t, i) {
  const a = document.createElement('a');
  a.className = 'dir-item'; a.href = t.action || '/admin';
  a.innerHTML = `<span class="dir-n">${i + 1}</span><span class="dir-body"><b>${esc(t.title)}</b><span class="muted">${esc(t.priority)}</span></span><span class="tag">${esc(t.kind)}</span>`;
  return a;
}
function suggestionEl(it, i) {
  const a = document.createElement('a');
  a.className = 'dir-item'; a.href = it.action || '/admin';
  a.innerHTML = `<span class="dir-n">${i + 1}</span><span class="dir-body"><b>${esc(it.title)}</b><span class="muted">${esc(it.why)}</span></span>` + (it.kind ? `<span class="tag">${esc(it.kind)}</span>` : '');
  return a;
}

document.getElementById('dir-refresh')?.addEventListener('click', () => { loadDirector(); loadBoard(); });
loadDirector();
loadBoard();
