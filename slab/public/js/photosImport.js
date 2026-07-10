/*
 * photosImport.js — Google Photos import for the Asset Control Center.
 *
 * Google no longer allows browsing a whole library, so picking happens on
 * Google's own UI: we create a Picker session, open its pickerUri, poll until the
 * user finishes, then preview + import the picked items via /admin/assets/photos/*.
 * Reuses the .drive-* modal styles injected by driveImport.js.
 */
(function () {
  'use strict';

  var modal, acctEl, connectEl, pickEl, previewEl, statusEl, gridEl,
      openBtn, importGoBtn, disconnectBtn, countEl, targetEl;

  var session = null;      // { id, pickerUri, pollIntervalMs, timeoutMs }
  var pollTimer = null;
  var pollDeadline = 0;
  var items = [];

  function grab() {
    modal = document.getElementById('photosModal');
    acctEl = document.getElementById('photosAcct');
    connectEl = document.getElementById('photosConnect');
    pickEl = document.getElementById('photosPick');
    previewEl = document.getElementById('photosPreview');
    statusEl = document.getElementById('photosStatus');
    gridEl = document.getElementById('photosGrid');
    openBtn = document.getElementById('photosOpenBtn');
    importGoBtn = document.getElementById('photosImportGo');
    disconnectBtn = document.getElementById('photosDisconnectBtn');
    countEl = document.getElementById('photosCount');
    targetEl = document.getElementById('photosTargetFolder');
  }

  function show(el) {
    [connectEl, pickEl, previewEl].forEach(function (e) { if (e) e.hidden = (e !== el); });
  }

  function openModal() { modal.hidden = false; refreshStatus(); }
  function closeModal() { stopPolling(); modal.hidden = true; }

  async function refreshStatus() {
    try {
      var s = await (await fetch('/admin/assets/photos/status')).json();
      if (!s.configured) {
        show(connectEl); disconnectBtn.hidden = true; importGoBtn.hidden = true;
        connectEl.querySelector('p').textContent = 'Google Photos import is not configured on this platform yet.';
        connectEl.querySelector('a').style.display = 'none';
        return;
      }
      if (s.connected) {
        acctEl.textContent = s.email ? ('Connected as ' + s.email) : 'Connected';
        disconnectBtn.hidden = false;
        show(pickEl);
        statusEl.textContent = '';
        importGoBtn.hidden = true;
      } else {
        acctEl.textContent = '';
        show(connectEl); disconnectBtn.hidden = true; importGoBtn.hidden = true;
      }
    } catch (e) {
      acctEl.textContent = 'Could not reach Photos: ' + e.message;
    }
  }

  async function startPicking() {
    // Open a blank tab synchronously (inside the click gesture) to dodge popup
    // blockers, then point it at the pickerUri once the session exists.
    var win = window.open('', '_blank');
    openBtn.disabled = true;
    statusEl.textContent = 'Creating a picking session…';
    try {
      session = await (await fetch('/admin/assets/photos/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      })).json();
      if (!session || !session.pickerUri) throw new Error(session && session.error || 'Could not start session');
      if (win) win.location = session.pickerUri; else window.open(session.pickerUri, '_blank');
      statusEl.textContent = 'Waiting for you to finish picking in Google Photos…';
      pollDeadline = Date.now() + (session.timeoutMs || 300000);
      poll();
    } catch (e) {
      if (win) win.close();
      statusEl.textContent = 'Error: ' + e.message;
      openBtn.disabled = false;
    }
  }

  function stopPolling() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

  function poll() {
    stopPolling();
    pollTimer = setTimeout(async function () {
      if (!session) return;
      if (Date.now() > pollDeadline) {
        statusEl.textContent = 'Timed out waiting for a selection. Try again.';
        openBtn.disabled = false;
        return;
      }
      try {
        var s = await (await fetch('/admin/assets/photos/session/' + encodeURIComponent(session.id))).json();
        if (s.mediaItemsSet) { loadItems(); return; }
      } catch (e) { /* transient — keep polling */ }
      poll();
    }, Math.max(session.pollIntervalMs || 3000, 2000));
  }

  async function loadItems() {
    show(previewEl);
    gridEl.innerHTML = '<div class="grid-loading">Loading your picks…</div>';
    importGoBtn.hidden = false; importGoBtn.disabled = true;
    try {
      var data = await (await fetch('/admin/assets/photos/session/' + encodeURIComponent(session.id) + '/items')).json();
      items = (data.items || []);
      var images = items.filter(function (i) { return i.isImage; });
      gridEl.innerHTML = '';
      if (!images.length) { gridEl.innerHTML = '<div class="drive-empty">No images in your selection.</div>'; return; }
      images.forEach(function (i) {
        var d = document.createElement('div');
        d.className = 'drive-tile sel';
        var img = document.createElement('img');
        img.loading = 'lazy'; img.src = i.thumb;
        img.onerror = function () { img.style.display = 'none'; };
        d.appendChild(img);
        var nm = document.createElement('div'); nm.className = 'dt-name'; nm.textContent = i.filename;
        d.appendChild(nm);
        gridEl.appendChild(d);
      });
      countEl.textContent = images.length + ' photo' + (images.length === 1 ? '' : 's') + ' selected';
      importGoBtn.disabled = false;
      importGoBtn.textContent = 'Import ' + images.length;
    } catch (e) {
      gridEl.innerHTML = '<div class="drive-empty">' + escapeHtml(e.message) + '</div>';
    }
  }

  async function doImport() {
    if (!session) return;
    importGoBtn.disabled = true;
    importGoBtn.textContent = 'Importing…';
    try {
      var data = await (await fetch('/admin/assets/photos/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, folder: targetEl.value })
      })).json();
      var n = data.importedCount || 0;
      if (data.errors && data.errors.length) {
        alert('Imported ' + n + ' photo(s). ' + data.errors.length + ' skipped: ' +
              data.errors.map(function (e) { return (e.name || e.id) + ' — ' + e.error; }).join('; '));
      }
      window.location.href = '/admin/assets?imported=' + n;
    } catch (e) {
      alert('Import failed: ' + e.message);
      importGoBtn.disabled = false;
    }
  }

  async function doDisconnect() {
    if (!confirm('Disconnect Google Photos from this site?')) return;
    try {
      await fetch('/admin/assets/photos/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch (e) { /* ignore */ }
    session = null; stopPolling();
    refreshStatus();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function wire() {
    var btn = document.getElementById('photosImportBtn');
    if (btn) btn.addEventListener('click', openModal);
    Array.prototype.forEach.call(modal.querySelectorAll('[data-photos-close]'), function (el) {
      el.addEventListener('click', closeModal);
    });
    if (openBtn) openBtn.addEventListener('click', startPicking);
    if (importGoBtn) importGoBtn.addEventListener('click', doImport);
    if (disconnectBtn) disconnectBtn.addEventListener('click', doDisconnect);

    var p = new URLSearchParams(window.location.search);
    if (p.get('photos') === 'error') alert('Google Photos connect failed: ' + (p.get('msg') || 'unknown error'));
    if (p.get('photos') === 'connected') openModal();
  }

  document.addEventListener('DOMContentLoaded', function () {
    grab();
    if (modal) wire();
  });
})();
