const dlg = document.getElementById('eventDialog');
const newBtn = document.getElementById('newEvent');
const form = document.getElementById('eventForm');

newBtn?.addEventListener('click', () => dlg.showModal());

form?.addEventListener('submit', async (e) => {
  if (e.submitter?.value === 'cancel') return;
  e.preventDefault();
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  body.allDay = fd.has('allDay');
  const res = await fetch('/calendar/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    dlg.close();
    location.reload();
  } else {
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'Failed to save');
  }
});

(async () => {
  try {
    const r = await fetch('/feed/today');
    const data = await r.json();
    const strip = document.getElementById('feed');
    if (!strip) return;
    strip.innerHTML = (data.items || []).map(i =>
      `<div class="feed-card"><strong>[${i.type}]</strong> ${i.payload?.title || ''}</div>`
    ).join('');
  } catch {}
})();

if (window.io) {
  const socket = io();
  socket.on('connect', () => {
    const fid = document.body.dataset.familyId;
    if (fid) socket.emit('family:join', fid);
  });
  socket.on('event:created', () => location.reload());
  socket.on('event:updated', () => location.reload());
  socket.on('event:deleted', () => location.reload());
}
