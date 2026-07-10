/*
 * driveImport.js — Google Drive import browser for the Asset Control Center.
 *
 * Talks to /admin/assets/drive/* (status, list, thumb, import, disconnect).
 * The connect flow itself is a plain link to /auth/google/drive (OAuth redirect).
 */
(function () {
  'use strict';

  var modal, grid, crumbEl, searchEl, targetEl, selCountEl, importGoBtn,
      moreWrap, moreBtn, acctEl, connectEl, browserEl, disconnectBtn;

  var stack = [];            // [{ id, name }] folder navigation (empty = all images)
  var pageToken = null;
  var searchTimer = null;
  var currentSearch = '';
  var selected = new Map();  // fileId -> { id, name }
  var loading = false;

  function injectStyles() {
    if (document.getElementById('driveImportStyles')) return;
    var s = document.createElement('style');
    s.id = 'driveImportStyles';
    s.textContent = [
      '.drive-modal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;}',
      '.drive-modal[hidden]{display:none;}',
      '.drive-modal-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.55);}',
      '.drive-modal-card{position:relative;background:var(--panel,#fff);color:var(--navy,#1c2b4a);width:min(920px,94vw);max-height:88vh;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;}',
      '.drive-modal-head{display:flex;align-items:flex-start;justify-content:space-between;padding:16px 18px;border-bottom:1px solid rgba(0,0,0,.08);}',
      '.drive-modal-title{font-weight:700;font-size:1rem;}',
      '.drive-modal-sub{font-size:.72rem;color:var(--slate,#64748b);margin-top:2px;}',
      '.drive-connect{padding:32px 20px;text-align:center;}',
      '.drive-connect p{color:var(--slate,#64748b);font-size:.85rem;margin-bottom:16px;}',
      '.drive-browser{display:flex;flex-direction:column;min-height:0;flex:1;}',
      '.drive-toolbar{display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(0,0,0,.06);flex-wrap:wrap;}',
      '.drive-breadcrumb{font-size:.75rem;color:var(--slate,#64748b);flex:1;min-width:120px;}',
      '.drive-breadcrumb a{color:var(--navy,#1c2b4a);cursor:pointer;text-decoration:none;}',
      '.drive-breadcrumb a:hover{text-decoration:underline;}',
      '.drive-grid{flex:1;overflow-y:auto;padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;align-content:start;}',
      '.drive-tile{position:relative;border:2px solid transparent;border-radius:8px;overflow:hidden;cursor:pointer;background:rgba(0,0,0,.04);aspect-ratio:1;display:flex;align-items:center;justify-content:center;}',
      '.drive-tile img{width:100%;height:100%;object-fit:cover;}',
      '.drive-tile.sel{border-color:var(--gold,#c9a227);}',
      '.drive-tile.sel:after{content:"\\2713";position:absolute;top:4px;right:6px;background:var(--gold,#c9a227);color:#fff;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;}',
      '.drive-tile .dt-name{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);color:#fff;font-size:.62rem;padding:3px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.drive-folder{cursor:pointer;border-radius:8px;padding:14px 8px;background:rgba(0,0,0,.04);text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;aspect-ratio:1;}',
      '.drive-folder:hover{background:rgba(0,0,0,.08);}',
      '.drive-folder .df-ico{font-size:1.6rem;}',
      '.drive-folder .df-name{font-size:.66rem;color:var(--navy,#1c2b4a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}',
      '.drive-more{padding:8px 16px 14px;text-align:center;}',
      '.drive-modal-foot{display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid rgba(0,0,0,.08);}',
      '.drive-selcount{font-size:.75rem;color:var(--slate,#64748b);}',
      '.drive-empty{grid-column:1/-1;text-align:center;color:var(--slate,#64748b);font-size:.8rem;padding:30px 0;}'
    ].join('');
    document.head.appendChild(s);
  }

  function grab() {
    modal = document.getElementById('driveModal');
    grid = document.getElementById('driveGrid');
    crumbEl = document.getElementById('driveCrumb');
    searchEl = document.getElementById('driveSearch');
    targetEl = document.getElementById('driveTargetFolder');
    selCountEl = document.getElementById('driveSelCount');
    importGoBtn = document.getElementById('driveImportGo');
    moreWrap = document.getElementById('driveMore');
    moreBtn = document.getElementById('driveMoreBtn');
    acctEl = document.getElementById('driveAcct');
    connectEl = document.getElementById('driveConnect');
    browserEl = document.getElementById('driveBrowser');
    disconnectBtn = document.getElementById('driveDisconnectBtn');
  }

  function openModal() {
    modal.hidden = false;
    refreshStatus();
  }
  function closeModal() { modal.hidden = true; }

  async function refreshStatus() {
    try {
      var r = await fetch('/admin/assets/drive/status');
      var s = await r.json();
      if (!s.configured) {
        connectEl.hidden = false; browserEl.hidden = true; disconnectBtn.hidden = true;
        connectEl.querySelector('p').textContent = 'Google Drive import is not configured on this platform yet.';
        connectEl.querySelector('a').style.display = 'none';
        return;
      }
      if (s.connected) {
        acctEl.textContent = s.email ? ('Connected as ' + s.email) : 'Connected';
        connectEl.hidden = true; browserEl.hidden = false; disconnectBtn.hidden = false;
        resetAndLoad();
      } else {
        acctEl.textContent = '';
        connectEl.hidden = false; browserEl.hidden = true; disconnectBtn.hidden = true;
      }
    } catch (e) {
      acctEl.textContent = 'Could not reach Drive: ' + e.message;
    }
  }

  function resetAndLoad() {
    stack = []; pageToken = null; currentSearch = ''; selected.clear();
    if (searchEl) searchEl.value = '';
    updateSelCount();
    loadPage(true);
  }

  function currentFolderId() { return stack.length ? stack[stack.length - 1].id : ''; }

  function renderCrumb() {
    var parts = ['<a data-crumb="-1">All images</a>'];
    stack.forEach(function (f, i) { parts.push('<span> / </span><a data-crumb="' + i + '">' + escapeHtml(f.name) + '</a>'); });
    crumbEl.innerHTML = parts.join('');
    Array.prototype.forEach.call(crumbEl.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function () {
        var idx = parseInt(a.getAttribute('data-crumb'), 10);
        stack = idx < 0 ? [] : stack.slice(0, idx + 1);
        pageToken = null; loadPage(true);
      });
    });
  }

  async function loadPage(reset) {
    if (loading) return;
    loading = true;
    if (reset) { grid.innerHTML = '<div class="grid-loading">Loading…</div>'; renderCrumb(); }
    try {
      var params = new URLSearchParams();
      if (currentFolderId()) params.set('folderId', currentFolderId());
      if (currentSearch) params.set('search', currentSearch);
      if (pageToken) params.set('pageToken', pageToken);
      var r = await fetch('/admin/assets/drive/list?' + params.toString());
      if (r.status === 409) { loading = false; return refreshStatus(); }
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'List failed');
      if (reset) grid.innerHTML = '';
      renderItems(data.folders || [], data.files || []);
      pageToken = data.nextPageToken || null;
      moreWrap.hidden = !pageToken;
      if (!grid.children.length) grid.innerHTML = '<div class="drive-empty">No images here.</div>';
    } catch (e) {
      grid.innerHTML = '<div class="drive-empty">' + escapeHtml(e.message) + '</div>';
    }
    loading = false;
  }

  function renderItems(folders, files) {
    // Folders only make sense when not searching (search is global/flat).
    if (!currentSearch) {
      folders.forEach(function (f) {
        var d = document.createElement('div');
        d.className = 'drive-folder';
        d.innerHTML = '<div class="df-ico">📁</div><div class="df-name">' + escapeHtml(f.name) + '</div>';
        d.addEventListener('click', function () { stack.push({ id: f.id, name: f.name }); pageToken = null; loadPage(true); });
        grid.appendChild(d);
      });
    }
    files.forEach(function (f) {
      var d = document.createElement('div');
      d.className = 'drive-tile' + (selected.has(f.id) ? ' sel' : '');
      d.setAttribute('data-id', f.id);
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.src = '/admin/assets/drive/thumb/' + encodeURIComponent(f.id);
      img.onerror = function () { img.style.display = 'none'; };
      d.appendChild(img);
      var nm = document.createElement('div');
      nm.className = 'dt-name'; nm.textContent = f.name;
      d.appendChild(nm);
      d.addEventListener('click', function () { toggleSelect(f, d); });
      grid.appendChild(d);
    });
  }

  function toggleSelect(f, el) {
    if (selected.has(f.id)) { selected.delete(f.id); el.classList.remove('sel'); }
    else { selected.set(f.id, { id: f.id, name: f.name }); el.classList.add('sel'); }
    updateSelCount();
  }

  function updateSelCount() {
    var n = selected.size;
    selCountEl.textContent = n ? (n + ' selected') : '';
    importGoBtn.disabled = n === 0;
    importGoBtn.textContent = n ? ('Import ' + n) : 'Import selected';
  }

  async function doImport() {
    if (!selected.size) return;
    var ids = Array.from(selected.keys());
    importGoBtn.disabled = true;
    importGoBtn.textContent = 'Importing…';
    try {
      var r = await fetch('/admin/assets/drive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: ids, folder: targetEl.value })
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Import failed');
      var n = data.importedCount || 0;
      if (data.errors && data.errors.length) {
        alert('Imported ' + n + ' file(s). ' + data.errors.length + ' failed: ' +
              data.errors.map(function (e) { return (e.name || e.fileId) + ' — ' + e.error; }).join('; '));
      }
      // Reload so the main grid picks up the new assets.
      window.location.href = '/admin/assets?imported=' + n;
    } catch (e) {
      alert('Import failed: ' + e.message);
      updateSelCount();
    }
  }

  async function doDisconnect() {
    if (!confirm('Disconnect Google Drive from this site?')) return;
    try {
      await fetch('/admin/assets/drive/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch (e) { /* ignore */ }
    refreshStatus();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function wire() {
    var openBtn = document.getElementById('driveImportBtn');
    if (openBtn) openBtn.addEventListener('click', openModal);
    Array.prototype.forEach.call(modal.querySelectorAll('[data-drive-close]'), function (el) {
      el.addEventListener('click', closeModal);
    });
    if (moreBtn) moreBtn.addEventListener('click', function () { loadPage(false); });
    if (importGoBtn) importGoBtn.addEventListener('click', doImport);
    if (disconnectBtn) disconnectBtn.addEventListener('click', doDisconnect);
    if (searchEl) searchEl.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        currentSearch = searchEl.value.trim();
        stack = []; pageToken = null; loadPage(true);
      }, 350);
    });
    // Surface the OAuth redirect outcome.
    var p = new URLSearchParams(window.location.search);
    if (p.get('drive') === 'error') alert('Google Drive connect failed: ' + (p.get('msg') || 'unknown error'));
    if (p.get('drive') === 'connected') openModal();
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectStyles();
    grab();
    if (modal) wire();
  });
})();
