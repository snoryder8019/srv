/* Builds manager — change status, delete. */
const status = (m, k) => { const s = document.getElementById('bstatus'); s.textContent = m; s.className = 'status ' + (k || ''); };

document.querySelectorAll('tr[data-id]').forEach((tr) => {
  const id = tr.dataset.id;
  tr.querySelector('.st')?.addEventListener('change', async (e) => {
    try {
      const r = await fetch(`/admin/build/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: e.target.value }) });
      const j = await r.json();
      status(j.ok ? `set ${id} → ${j.status}` : 'failed: ' + (j.error || r.status), j.ok ? 'ok' : 'err');
    } catch { status('request failed', 'err'); }
  });
  tr.querySelector('.del')?.addEventListener('click', async () => {
    if (!confirm('Delete this build?')) return;
    try {
      const r = await fetch(`/admin/build/${id}/delete`, { method: 'POST' });
      const j = await r.json();
      if (j.ok) { tr.remove(); status('deleted ' + id, 'ok'); } else status('delete failed', 'err');
    } catch { status('request failed', 'err'); }
  });
});
