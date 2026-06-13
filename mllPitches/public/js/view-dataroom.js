(function () {
  const data = JSON.parse(document.getElementById('dataroomData')?.textContent || '{}');
  const STORAGE_KEY = 'mllPitch:meridian:dr:uploads';

  // Flatten folders into a file list
  const baseFiles = [];
  (data.folders || []).forEach((f) => {
    (f.items || []).forEach((it) => {
      baseFiles.push({
        name: it.name,
        roles: it.roles || [],
        folder: f.name,
        status: f.status,
        size: estimateSize(it.name),
        owner: pickOwner(it.name),
      });
    });
  });

  let uploads = loadUploads();
  let activity = (data.activity || []).slice();
  let stats = Object.assign({ totalDocs: baseFiles.length, ready: 0, pending: 0, blocked: 0, activeViewers: 0, uploadsWeek: 0 }, data.stats || {});

  // ── Variant switching ──
  const variantSel = document.querySelector('[data-control="variant"]');
  const views = document.querySelectorAll('[data-dr-view]');
  function applyVariant() {
    const v = variantSel?.value || 'dashboard';
    views.forEach((el) => (el.hidden = el.dataset.drView !== v));
  }
  variantSel?.addEventListener('change', applyVariant);
  applyVariant();

  // ── Filters ──
  const searchEl = document.querySelector('[data-dr-search]');
  const roleEl = document.querySelector('[data-dr-role]');
  const statusEl = document.querySelector('[data-dr-status]');
  const filesEl = document.querySelector('[data-dr-files]');
  const countEl = document.querySelector('[data-dr-count]');
  const feedEl = document.querySelector('[data-dr-activity]');
  const statTotal = document.querySelector('[data-dr-stat="total"]');
  const statReady = document.querySelector('[data-dr-stat="ready"]');
  const statPending = document.querySelector('[data-dr-stat="pending"]');
  const statBlocked = document.querySelector('[data-dr-stat="blocked"]');

  function allFiles() { return baseFiles.concat(uploads); }
  function filter() {
    const q = (searchEl?.value || '').toLowerCase().trim();
    const role = roleEl?.value || '';
    const status = statusEl?.value || '';
    return allFiles().filter((f) => {
      if (q && !f.name.toLowerCase().includes(q)) return false;
      if (role && !f.roles.includes(role)) return false;
      if (status && f.status !== status) return false;
      return true;
    });
  }
  function renderFiles() {
    const files = filter();
    if (countEl) countEl.textContent = files.length;
    const ready = files.filter((f) => f.status === 'ready').length;
    const pending = files.filter((f) => f.status === 'pending').length;
    const blocked = files.filter((f) => f.status === 'blocked').length;
    if (statTotal) statTotal.textContent = files.length;
    if (statReady) statReady.textContent = ready;
    if (statPending) statPending.textContent = pending;
    if (statBlocked) statBlocked.textContent = blocked;
    if (!filesEl) return;
    if (!files.length) {
      filesEl.innerHTML = '<div class="mll-dr__empty">No files match these filters.</div>';
      return;
    }
    filesEl.innerHTML = files.map((f) => `
      <div class="mll-dr__row mll-dr__row--${f.status}">
        <div class="mll-dr__row-name">${escape(f.name)}</div>
        <div class="mll-dr__row-folder">${escape(f.folder)}</div>
        <div class="mll-dr__row-roles">${(f.roles || []).map((r) => `<span class="mll-tag">${escape(r)}</span>`).join('')}</div>
        <div class="mll-dr__row-size">${escape(f.size)}</div>
        <div class="mll-dr__row-status mll-dr__row-status--${f.status}">${escape(f.status)}</div>
      </div>
    `).join('');
  }
  function renderActivity() {
    if (!feedEl) return;
    feedEl.innerHTML = activity.slice(0, 10).map((a) => `
      <li class="mll-dr__feed-item mll-dr__feed-item--${a.action}">
        <div class="mll-dr__feed-actor">${escape(a.actor)}</div>
        <div class="mll-dr__feed-line"><strong>${escape(a.action)}</strong> ${escape(a.file)}</div>
        <div class="mll-dr__feed-meta">${escape(a.folder)} · ${fmtTime(a.ts)}</div>
      </li>
    `).join('');
  }
  function rerender() { renderFiles(); renderActivity(); }
  [searchEl, roleEl, statusEl].forEach((el) => {
    el?.addEventListener('input', rerender);
    el?.addEventListener('change', rerender);
  });

  // ── Upload mock ──
  const uploadBtn = document.querySelector('[data-dr-upload]');
  const zoneEl = document.querySelector('[data-dr-zone]');
  const fnameEl = document.querySelector('[data-dr-fname]');
  const fdestEl = document.querySelector('[data-dr-fdest]');
  const faddEl = document.querySelector('[data-dr-fadd]');
  const fcancelEl = document.querySelector('[data-dr-fcancel]');

  uploadBtn?.addEventListener('click', () => { zoneEl.hidden = !zoneEl.hidden; fnameEl?.focus(); });
  fcancelEl?.addEventListener('click', () => { zoneEl.hidden = true; });
  faddEl?.addEventListener('click', () => {
    const name = (fnameEl?.value || '').trim();
    if (!name) { fnameEl?.focus(); return; }
    const folder = fdestEl?.value || '03 · Customers';
    const file = {
      name, roles: ['buyer'], folder, status: 'ready',
      size: estimateSize(name), owner: 'You · just now',
    };
    uploads.unshift(file);
    saveUploads();
    activity.unshift({ ts: new Date().toISOString(), actor: 'You', action: 'uploaded', file: name, folder });
    fnameEl.value = '';
    zoneEl.hidden = true;
    rerender();
  });

  rerender();

  function loadUploads() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
  function saveUploads() { localStorage.setItem(STORAGE_KEY, JSON.stringify(uploads)); }
  function escape(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function estimateSize(name) {
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const kb = 50 + (h % 9500);
    return kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';
  }
  function pickOwner(name) {
    const owners = ['Buyer · J. Lin', 'Seller · M. Cho', 'Counsel · R. Patel', 'TechDD · A. Singh'];
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 17 + name.charCodeAt(i)) >>> 0;
    return owners[h % owners.length];
  }
  function fmtTime(iso) {
    const t = new Date(iso); const diff = (Date.now() - t.getTime()) / 60000;
    if (diff < 1) return 'just now';
    if (diff < 60) return Math.round(diff) + 'm ago';
    if (diff < 60 * 24) return Math.round(diff / 60) + 'h ago';
    return Math.round(diff / 60 / 24) + 'd ago';
  }
})();
