/* Asset Control Center — assetManager.js */
(function () {
  'use strict';

  let currentFolder = 'all';
  let currentType = 'all';
  let currentSearch = '';
  let currentSort = 'newest';
  let currentClientId = null;
  let selectedAsset = null;
  let searchTimeout = null;
  let folderCounts = {};
  let clientsList = [];
  let customFolders = [];
  let bulkMode = false;
  let bulkSelected = new Set();
  const BUILTIN_FOLDERS = ['general', 'sections', 'portfolio', 'blog', 'pages', 'clients'];

  const grid = document.getElementById('assetGrid');
  const metaBody = document.getElementById('metaBody');
  const metaFooter = document.getElementById('metaFooter');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const saveMetaBtn = document.getElementById('saveMetaBtn');
  const deleteAssetBtn = document.getElementById('deleteAssetBtn');
  const downloadAssetBtn = document.getElementById('downloadAssetBtn');
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const progressEl = document.getElementById('uploadProgress');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const folderStats = document.getElementById('folderStats');
  const uploadFolderLabel = document.getElementById('uploadFolderLabel');

  /* ── LOAD CLIENTS ── */
  async function loadClients() {
    try {
      const r = await fetch('/admin/assets/clients');
      const data = await r.json();
      clientsList = data.clients || [];
    } catch (e) { clientsList = []; }
  }

  /* ── CUSTOM FOLDERS ── */
  async function loadCustomFolders() {
    try {
      const r = await fetch('/admin/assets/folders');
      const data = await r.json();
      customFolders = data.folders || [];
    } catch { customFolders = []; }
    renderCustomFolders();
  }

  function renderCustomFolders() {
    const container = document.getElementById('customFolderList');
    if (!container) return;
    container.innerHTML = '';
    customFolders.forEach(f => {
      const el = document.createElement('div');
      el.className = 'folder-item';
      el.dataset.folder = f.slug;
      el.innerHTML = `<span class="fi-icon">▪</span><span class="folder-label">${escHtml(f.name)}</span> <span class="fi-count" id="cnt-${f.slug}">—</span><button class="folder-rename" data-id="${f._id}" title="Rename folder">✎</button><button class="folder-del" data-id="${f._id}" title="Delete folder">&times;</button>`;

      // Click to browse
      el.addEventListener('click', (e) => {
        if (e.target.closest('.folder-del') || e.target.closest('.folder-rename')) return;
        document.querySelectorAll('.folder-item').forEach(fi => fi.classList.remove('active'));
        el.classList.add('active');
        currentFolder = f.slug;
        currentClientId = null;
        uploadFolderLabel.textContent = f.name;
        loadAssets();
      });

      // Rename button
      el.querySelector('.folder-rename').addEventListener('click', (e) => {
        e.stopPropagation();
        const labelSpan = el.querySelector('.folder-label');
        const oldName = f.name;
        // Replace label with input
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'folder-create-input';
        input.value = oldName;
        input.style.cssText = 'width:90px;padding:2px 6px;font-size:0.75rem;';
        labelSpan.replaceWith(input);
        input.focus();
        input.select();

        async function commitRename() {
          const newName = input.value.trim();
          if (!newName || newName === oldName) {
            // Revert
            const span = document.createElement('span');
            span.className = 'folder-label';
            span.textContent = oldName;
            input.replaceWith(span);
            return;
          }
          try {
            const r = await fetch(`/admin/assets/folders/${f._id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: newName }),
            });
            const data = await r.json();
            if (data.success) {
              // Update local state and re-render
              if (currentFolder === f.slug) currentFolder = data.folder.slug;
              await loadCustomFolders();
              loadAssets();
              loadFolderCounts();
            } else {
              alert(data.error || 'Rename failed');
              const span = document.createElement('span');
              span.className = 'folder-label';
              span.textContent = oldName;
              input.replaceWith(span);
            }
          } catch (err) {
            alert('Error: ' + err.message);
            const span = document.createElement('span');
            span.className = 'folder-label';
            span.textContent = oldName;
            input.replaceWith(span);
          }
        }

        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') commitRename();
          if (ev.key === 'Escape') {
            const span = document.createElement('span');
            span.className = 'folder-label';
            span.textContent = oldName;
            input.replaceWith(span);
          }
        });
        input.addEventListener('blur', commitRename);
      });

      // Delete button
      el.querySelector('.folder-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        // Get count of assets that will be fully deleted
        let count = 0;
        try {
          const cr = await fetch(`/admin/assets/list?folder=${f.slug}&limit=0`);
          const cd = await cr.json();
          count = cd.total || 0;
        } catch {}
        const msg = count
          ? `Delete folder "${f.name}"?\n\n${count} asset${count !== 1 ? 's' : ''} and ${count !== 1 ? 'their' : 'its'} files will be permanently deleted.\nAssets also tagged in other folders will keep those tags but lose this one.`
          : `Delete folder "${f.name}"?\n\nNo assets are in this folder.`;
        if (!confirm(msg)) return;
        try {
          const r = await fetch(`/admin/assets/folders/${f._id}`, { method: 'DELETE' });
          const data = await r.json();
          if (data.success) {
            if (currentFolder === f.slug) {
              currentFolder = 'all';
              document.querySelector('.folder-item[data-folder="all"]')?.classList.add('active');
            }
            await loadCustomFolders();
            loadAssets();
            loadFolderCounts();
          }
        } catch (err) { alert('Error: ' + err.message); }
      });
      container.appendChild(el);
    });
    // Update bulk-move dropdown with custom folders
    const bulkSel = document.getElementById('bulkMoveFolder');
    if (bulkSel) {
      bulkSel.querySelectorAll('option[data-custom]').forEach(o => o.remove());
      customFolders.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.slug;
        opt.textContent = f.name;
        opt.dataset.custom = '1';
        bulkSel.appendChild(opt);
      });
    }
  }

  // Add folder button
  const addFolderBtn = document.getElementById('addFolderBtn');
  if (addFolderBtn) {
    addFolderBtn.addEventListener('click', () => {
      const container = document.getElementById('customFolderList');
      if (container.querySelector('.folder-create-row')) return; // already open
      const row = document.createElement('div');
      row.className = 'folder-create-row';
      row.innerHTML = `<input type="text" class="folder-create-input" placeholder="Folder name..." maxlength="40" autofocus><button class="folder-create-ok" title="Create">OK</button><button class="folder-create-cancel" title="Cancel">&times;</button>`;
      container.prepend(row);
      const input = row.querySelector('input');
      input.focus();

      async function createFolder() {
        const name = input.value.trim();
        if (!name) { row.remove(); return; }
        try {
          const r = await fetch('/admin/assets/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          const data = await r.json();
          if (data.success) {
            row.remove();
            await loadCustomFolders();
            loadFolderCounts();
          } else {
            alert(data.error || 'Error creating folder');
          }
        } catch (err) { alert('Error: ' + err.message); }
      }

      row.querySelector('.folder-create-ok').addEventListener('click', createFolder);
      row.querySelector('.folder-create-cancel').addEventListener('click', () => row.remove());
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createFolder();
        if (e.key === 'Escape') row.remove();
      });
    });
  }

  /* ── FOLDER COUNTS ── */
  async function loadFolderCounts() {
    try {
      const allFolderSlugs = ['all', ...BUILTIN_FOLDERS, ...customFolders.map(f => f.slug)];
      await Promise.all(allFolderSlugs.map(async (f) => {
        const qs = f === 'all' ? '' : `?folder=${f}`;
        const r = await fetch(`/admin/assets/list${qs}&limit=0`);
        const data = await r.json();
        const el = document.getElementById(`cnt-${f}`);
        if (el) el.textContent = data.total ?? '—';
        folderCounts[f] = data.total ?? 0;
      }));
      // Also count per active client
      clientsList.filter(c => c.status !== 'inactive').forEach(async (c) => {
        try {
          const r = await fetch(`/admin/assets/list?clientId=${c._id}&limit=0`);
          const data = await r.json();
          const el = document.getElementById(`cnt-client-${c._id}`);
          if (el) el.textContent = data.total ?? '—';
        } catch {}
      });
      const total = folderCounts['all'] || 0;
      folderStats.textContent = `${total} total asset${total !== 1 ? 's' : ''}`;
    } catch (e) {
      folderStats.textContent = 'Error loading stats';
    }
  }

  /* ── FOLDER CLICKS ── */
  document.querySelectorAll('.folder-item').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active'));
      el.classList.add('active');
      currentFolder = el.dataset.folder;
      currentClientId = null; // reset client filter on main folder click
      uploadFolderLabel.textContent = currentFolder === 'all' ? 'general' : currentFolder;
      loadAssets();
    });
  });

  /* ── TYPE TABS ── */
  document.querySelectorAll('.type-tab').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      currentType = el.dataset.type;
      loadAssets();
    });
  });

  /* ── SORT ── */
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      currentSort = sortSelect.value;
      loadAssets();
    });
  }

  /* ── SEARCH ── */
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    currentSearch = e.target.value.trim();
    searchTimeout = setTimeout(loadAssets, 300);
  });

  /* ── BULK MODE ── */
  const bulkToggle = document.getElementById('bulkToggle');
  const bulkBar = document.getElementById('bulkBar');
  if (bulkToggle) {
    bulkToggle.addEventListener('click', () => {
      bulkMode = !bulkMode;
      bulkSelected.clear();
      bulkToggle.classList.toggle('active', bulkMode);
      if (bulkBar) bulkBar.style.display = bulkMode ? 'flex' : 'none';
      updateBulkCount();
      if (bulkMode) renderBulkMeta();
      else clearSelection();
      // Re-render cards with checkboxes
      loadAssets();
    });
  }

  function updateBulkCount() {
    const cnt = document.getElementById('bulkCount');
    if (cnt) cnt.textContent = bulkSelected.size;
  }

  // ── Thumbnail backfill ──
  // Show the button only when some images still lack thumbnails, then loop the
  // batch endpoint until none remain.
  const thumbBtn = document.getElementById('thumbBackfillBtn');
  async function refreshThumbStatus() {
    if (!thumbBtn) return;
    try {
      const r = await fetch('/admin/assets/thumbnails/status');
      const { remaining = 0 } = await r.json();
      if (remaining > 0) {
        thumbBtn.style.display = '';
        thumbBtn.textContent = `⚡ Thumbnails (${remaining})`;
      } else {
        thumbBtn.style.display = 'none';
      }
    } catch { /* non-fatal */ }
  }
  if (thumbBtn) {
    thumbBtn.addEventListener('click', async () => {
      if (thumbBtn.disabled) return;
      thumbBtn.disabled = true;
      try {
        let remaining = Infinity;
        while (remaining > 0) {
          const r = await fetch('/admin/assets/thumbnails/backfill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 20 }),
          });
          if (!r.ok) throw new Error('Backfill request failed');
          const data = await r.json();
          remaining = data.remaining;
          thumbBtn.textContent = remaining > 0 ? `⚡ Generating… (${remaining} left)` : '⚡ Done';
        }
        loadAssets(); // re-render with fresh thumbnails
      } catch (e) {
        thumbBtn.textContent = '⚡ Thumbnails (retry)';
        console.warn('Thumbnail backfill error:', e.message);
      } finally {
        thumbBtn.disabled = false;
        refreshThumbStatus();
      }
    });
    refreshThumbStatus();
  }

  /* ── BULK META PANEL ── */
  function renderBulkMeta() {
    if (!bulkMode) return;
    copyUrlBtn.style.display = 'none';

    if (bulkSelected.size === 0) {
      metaBody.innerHTML = '<div class="meta-preview"><div class="no-select">Bulk mode active<br>Select assets to edit</div></div>';
      metaFooter.style.display = 'none';
      return;
    }

    // Folder checkboxes (built-in + custom)
    const folderOptions = [...BUILTIN_FOLDERS, ...customFolders.map(f => f.slug)];
    let folderChecks = '';
    folderOptions.forEach(f => {
      const cf = customFolders.find(c => c.slug === f);
      const label = cf ? cf.name : (f.charAt(0).toUpperCase() + f.slice(1));
      folderChecks += `<label class="meta-folder-check"><input type="checkbox" name="bulkFolders" value="${f}"> ${escHtml(label)}</label>`;
    });

    // Client dropdown — "Keep current" is the default so save doesn't blank it out
    let clientOpts = '<option value="__keep__" selected>— Keep current —</option><option value="">— No Client —</option>';
    clientsList.forEach(c => {
      const label = c.company ? `${c.name} (${c.company})` : c.name;
      clientOpts += `<option value="${c._id}">${escHtml(label)}</option>`;
    });

    // Preview strip — pull thumbs from already-rendered cards (max 12)
    const selectedIds = [...bulkSelected];
    const previewCap = 12;
    let stripHtml = '';
    for (let i = 0; i < Math.min(selectedIds.length, previewCap); i++) {
      const card = document.querySelector(`.asset-card[data-id="${selectedIds[i]}"]`);
      const media = card?.querySelector('.asset-thumb > img, .asset-thumb > video');
      if (media) {
        const src = media.getAttribute('src');
        stripHtml += `<div class="bulk-thumb">${media.tagName === 'IMG'
          ? `<img src="${src}" alt="">`
          : `<video src="${src}" muted></video>`}</div>`;
      } else {
        stripHtml += '<div class="bulk-thumb"><span style="color:var(--slate);font-size:0.7rem;">◻</span></div>';
      }
    }
    if (selectedIds.length > previewCap) {
      stripHtml += `<div class="bulk-thumb bulk-thumb-more">+${selectedIds.length - previewCap}</div>`;
    }

    metaBody.innerHTML = `
      <div class="bulk-meta-header">
        <div class="bulk-meta-count">${bulkSelected.size} selected</div>
        <div class="bulk-meta-strip">${stripHtml}</div>
        <button class="btn btn-ghost btn-sm" id="bulkClearBtn" style="font-size:0.65rem;margin-top:8px;">Clear selection</button>
      </div>
      <div class="meta-field">
        <label class="meta-label">Assign Folders</label>
        <div class="meta-info" style="margin-bottom:6px;font-size:0.65rem;">Checked folders are <strong>added</strong> to each selected asset — existing folder tags are kept. Leave all unchecked to keep folders as-is.</div>
        <div class="meta-folder-grid">${folderChecks}</div>
        <label class="meta-folder-check" style="margin-top:6px;"><input type="checkbox" id="bulkReplaceFolders"> Replace existing folders instead of adding</label>
      </div>
      <div class="meta-field">
        <label class="meta-label">Attach to Client</label>
        <select class="meta-select" id="bulkClient">${clientOpts}</select>
      </div>
      <div class="meta-field">
        <label class="meta-label">Broadcast Alt Text <span style="text-transform:none;letter-spacing:0;font-weight:500;color:var(--slate);">(applies to all selected on save)</span></label>
        <input type="text" class="meta-input" id="bulkAlt" maxlength="250" placeholder="Leave blank to keep each asset's current alt">
      </div>
      <div class="meta-field">
        <label class="meta-label">Broadcast Caption <span style="text-transform:none;letter-spacing:0;font-weight:500;color:var(--slate);">(optional)</span></label>
        <textarea class="meta-input" id="bulkCaption" maxlength="500" rows="2" style="resize:vertical;min-height:54px;" placeholder="Leave blank to keep each asset's current caption"></textarea>
      </div>`;

    document.getElementById('bulkClearBtn')?.addEventListener('click', () => {
      bulkSelected.clear();
      updateBulkCount();
      document.querySelectorAll('.asset-card.selected').forEach(c => c.classList.remove('selected'));
      document.querySelectorAll('.bulk-check.checked').forEach(c => c.classList.remove('checked'));
      renderBulkMeta();
    });

    metaFooter.style.display = '';
    // Open the meta drawer on mobile so the user sees the editor
    if (isMobile()) openDrawer(metaPanel);
  }

  /* ── SHARED BULK ACTIONS (used by bulk-bar + meta footer) ── */
  async function performBulkDelete() {
    if (!bulkSelected.size) return;
    if (!confirm(`Delete ${bulkSelected.size} asset${bulkSelected.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      const r = await fetch('/admin/assets/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...bulkSelected] }),
      });
      const data = await r.json();
      if (data.success) {
        bulkSelected.clear();
        updateBulkCount();
        renderBulkMeta();
        loadAssets();
        loadFolderCounts();
      }
    } catch (err) { alert('Error: ' + err.message); }
  }

  function performBulkDownload() {
    if (!bulkSelected.size) return;
    if (bulkSelected.size > 20 && !confirm(`Download ${bulkSelected.size} files? Your browser may prompt to allow multiple downloads.`)) return;
    const ids = [...bulkSelected];
    ids.forEach((id, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = `/admin/assets/${id}/download`;
        a.download = '';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 1000);
      }, i * 250);
    });
  }

  async function performBulkSave() {
    if (!bulkSelected.size) return;
    const folders = [...document.querySelectorAll('input[name="bulkFolders"]:checked')].map(cb => cb.value);
    const replaceFolders = document.getElementById('bulkReplaceFolders')?.checked;
    const clientSel = document.getElementById('bulkClient');
    const clientVal = clientSel ? clientSel.value : '__keep__';
    const altVal = document.getElementById('bulkAlt')?.value?.trim() || '';
    const captionVal = document.getElementById('bulkCaption')?.value?.trim() || '';
    if (!folders.length && clientVal === '__keep__' && !altVal && !captionVal) {
      return alert('Pick folders, a client, alt text, or a caption to apply.');
    }
    const body = { ids: [...bulkSelected] };
    // Default: add checked folders to each asset (keep existing tags).
    // Replace mode wipes & sets exactly the checked folders.
    if (folders.length) {
      if (replaceFolders) body.folders = folders;
      else body.addFolders = folders;
    }
    if (clientVal !== '__keep__') body.clientId = clientVal || null;
    if (altVal) body.altText = altVal;
    if (captionVal) body.caption = captionVal;

    try {
      saveMetaBtn.textContent = 'Saving...';
      saveMetaBtn.disabled = true;
      const r = await fetch('/admin/assets/bulk-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.success) {
        saveMetaBtn.textContent = `✓ Saved ${data.updated || bulkSelected.size}`;
        setTimeout(() => { saveMetaBtn.textContent = 'Save'; saveMetaBtn.disabled = false; }, 1500);
        bulkSelected.clear();
        updateBulkCount();
        renderBulkMeta();
        loadAssets();
        loadFolderCounts();
      } else {
        alert(data.error || 'Save failed');
        saveMetaBtn.textContent = 'Save';
        saveMetaBtn.disabled = false;
      }
    } catch (err) {
      alert('Error: ' + err.message);
      saveMetaBtn.textContent = 'Save';
      saveMetaBtn.disabled = false;
    }
  }

  // Bulk-bar buttons (top action strip) — wire to shared functions
  document.getElementById('bulkDownloadBtn')?.addEventListener('click', performBulkDownload);
  document.getElementById('bulkDeleteBtn')?.addEventListener('click', performBulkDelete);
  document.getElementById('bulkMoveBtn')?.addEventListener('click', async () => {
    if (!bulkSelected.size) return;
    const folder = document.getElementById('bulkMoveFolder')?.value;
    const clientId = document.getElementById('bulkMoveClient')?.value || null;
    if (!folder && !clientId) return alert('Select a folder or client');
    try {
      const body = { ids: [...bulkSelected] };
      if (folder) body.folder = folder;
      if (clientId !== null) body.clientId = clientId;
      const r = await fetch('/admin/assets/bulk-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.success) {
        bulkSelected.clear();
        updateBulkCount();
        renderBulkMeta();
        loadAssets();
        loadFolderCounts();
      }
    } catch (err) { alert('Error: ' + err.message); }
  });

  /* ── INTERSECTION-OBSERVER LAZY LOAD ── */
  // Holds off setting img.src / video.src until the card scrolls within ~400px
  // of the viewport. Heavy thumbs would otherwise all decode at once on load.
  let thumbObserver = null;
  function getThumbObserver() {
    if (thumbObserver) return thumbObserver;
    if (!('IntersectionObserver' in window)) return null;
    thumbObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const src = el.dataset.src;
        if (src) { el.setAttribute('src', src); el.removeAttribute('data-src'); }
        thumbObserver.unobserve(el);
      });
    }, { rootMargin: '400px 0px', threshold: 0.01 });
    return thumbObserver;
  }

  /* ── LOAD ASSETS ── */
  const PAGE_SIZE = 60;
  let allAssetsCache = [];
  let renderedCount = 0;

  async function loadAssets() {
    grid.innerHTML = '<div class="grid-loading">Loading...</div>';
    clearSelection();
    // Reset observer so stale entries don't linger
    if (thumbObserver) { thumbObserver.disconnect(); thumbObserver = null; }
    try {
      const params = new URLSearchParams({ limit: 500 });
      if (currentFolder !== 'all') params.set('folder', currentFolder);
      if (currentType !== 'all') params.set('type', currentType);
      if (currentSearch) params.set('search', currentSearch);
      if (currentSort !== 'newest') params.set('sort', currentSort);
      if (currentClientId) params.set('clientId', currentClientId);

      const r = await fetch(`/admin/assets/list?${params}`);
      const data = await r.json();

      if (!data.assets?.length) {
        grid.innerHTML = '<div class="grid-empty">No assets found.<br><small>Upload files above to get started.</small></div>';
        return;
      }

      allAssetsCache = data.assets;
      renderedCount = 0;
      grid.innerHTML = '';
      renderNextPage();
    } catch (err) {
      grid.innerHTML = `<div class="grid-empty">Error: ${err.message}</div>`;
    }
  }

  // Render the next PAGE_SIZE cards and append a "Show more" sentinel
  function renderNextPage() {
    const slice = allAssetsCache.slice(renderedCount, renderedCount + PAGE_SIZE);
    slice.forEach(asset => grid.appendChild(buildCard(asset)));
    renderedCount += slice.length;

    // Remove any prior sentinel
    grid.querySelector('.grid-more-sentinel')?.remove();

    if (renderedCount < allAssetsCache.length) {
      const sentinel = document.createElement('div');
      sentinel.className = 'grid-more-sentinel';
      sentinel.innerHTML = `<button class="btn btn-ghost btn-sm" type="button">Show ${Math.min(PAGE_SIZE, allAssetsCache.length - renderedCount)} more (${allAssetsCache.length - renderedCount} remaining)</button>`;
      sentinel.querySelector('button').addEventListener('click', renderNextPage);
      grid.appendChild(sentinel);
    }
  }

  function buildCard(asset) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.dataset.id = asset._id;
    if (bulkMode && bulkSelected.has(asset._id)) card.classList.add('selected');

    let thumbHtml = '';
    const isSvg = asset.mimeType === 'image/svg+xml' || /\.svg$/i.test(asset.originalName || '');
    if (asset.fileType === 'image') {
      // Don't fill src — IntersectionObserver swaps data-src→src on near-viewport.
      // Prefer the lightweight thumbnail; fall back to the original if not yet generated.
      thumbHtml = `<img data-src="${asset.thumbUrl || asset.publicUrl}" alt="${escHtml(asset.title)}" loading="lazy" decoding="async">`;
    } else if (asset.fileType === 'video') {
      // Static placeholder. Full video plays in the meta-panel preview.
      thumbHtml = `<div class="asset-icon" style="background:var(--ivory);">▶</div>`;
    } else {
      thumbHtml = `<div class="asset-icon">◻</div>`;
    }

    const badge = asset.fileType === 'video' ? 'badge-video' : 'badge-image';
    const clientBadge = asset.clientId ? '<span class="asset-client-dot" title="Linked to client">●</span>' : '';
    const checkHtml = bulkMode ? `<div class="bulk-check ${bulkSelected.has(asset._id) ? 'checked' : ''}">✓</div>` : '';

    card.innerHTML = `
      ${checkHtml}
      <div class="asset-thumb${isSvg ? ' is-svg' : ''}">${thumbHtml}</div>
      <div class="asset-name">
        <span class="asset-type-badge ${badge}">${asset.fileType}</span>${clientBadge}${escHtml(asset.title || asset.originalName)}
      </div>`;

    card.addEventListener('click', (e) => {
      if (bulkMode) {
        e.stopPropagation();
        if (bulkSelected.has(asset._id)) {
          bulkSelected.delete(asset._id);
          card.classList.remove('selected');
          card.querySelector('.bulk-check')?.classList.remove('checked');
        } else {
          bulkSelected.add(asset._id);
          card.classList.add('selected');
          card.querySelector('.bulk-check')?.classList.add('checked');
        }
        updateBulkCount();
        renderBulkMeta();
        return;
      }
      selectAsset(asset, card);
    });

    // Register thumbnail for IntersectionObserver lazy load
    const lazyImg = card.querySelector('img[data-src]');
    if (lazyImg) {
      const obs = getThumbObserver();
      if (obs) obs.observe(lazyImg);
      else { lazyImg.src = lazyImg.dataset.src; lazyImg.removeAttribute('data-src'); }
    }
    return card;
  }

  /* ── SELECT ASSET ── */
  function selectAsset(asset, card) {
    document.querySelectorAll('.asset-card').forEach(c => c.classList.remove('selected'));
    if (card) card.classList.add('selected');
    selectedAsset = asset;
    copyUrlBtn.style.display = '';
    metaFooter.style.display = '';
    if (downloadAssetBtn) {
      downloadAssetBtn.href = `/admin/assets/${asset._id}/download`;
      downloadAssetBtn.setAttribute('download', asset.originalName || asset.title || 'download');
    }
    renderMeta(asset);
  }

  function clearSelection() {
    selectedAsset = null;
    copyUrlBtn.style.display = 'none';
    metaFooter.style.display = 'none';
    if (downloadAssetBtn) { downloadAssetBtn.href = '#'; downloadAssetBtn.removeAttribute('download'); }
    metaBody.innerHTML = '<div class="meta-preview"><div class="no-select">Select an asset<br>to view details</div></div>';
    // In bulk mode the right-panel is the bulk editor — restore it instead of the empty placeholder
    if (bulkMode) renderBulkMeta();
  }

  function renderMeta(asset) {
    const sizeStr = formatBytes(asset.size);
    const dateStr = asset.uploadedAt ? new Date(asset.uploadedAt).toLocaleDateString() : '—';
    // Normalise folders
    const assetFolders = asset.folders || (asset.folder ? [asset.folder] : ['general']);
    let previewHtml = '';
    if (asset.fileType === 'image') {
      previewHtml = `<img src="${asset.publicUrl}" alt="${escHtml(asset.title)}">`;
    } else if (asset.fileType === 'video') {
      previewHtml = `<video src="${asset.publicUrl}" controls></video>`;
    } else {
      previewHtml = `<div class="no-select">◻ ${asset.fileType}</div>`;
    }

    // Client options
    let clientOpts = '<option value="">— No Client —</option>';
    clientsList.forEach(c => {
      const sel = asset.clientId === c._id ? 'selected' : '';
      const label = c.company ? `${c.name} (${c.company})` : c.name;
      clientOpts += `<option value="${c._id}" ${sel}>${escHtml(label)}</option>`;
    });

    const shareHtml = asset.shareToken
      ? `<div class="meta-share-active"><span class="meta-share-label">Shared</span><button class="btn btn-ghost btn-sm" id="revokeShareBtn" style="font-size:0.68rem;">Revoke</button></div>`
      : `<button class="btn btn-ghost btn-sm" id="shareAssetBtn" style="font-size:0.7rem;margin-top:4px;">Share Link</button>`;

    // Multi-folder checkboxes (built-in + custom)
    const folderOptions = [...BUILTIN_FOLDERS, ...customFolders.map(f => f.slug)];
    let folderChecks = '';
    folderOptions.forEach(f => {
      const checked = assetFolders.includes(f) ? 'checked' : '';
      const cf = customFolders.find(c => c.slug === f);
      const label = cf ? cf.name : (f.charAt(0).toUpperCase() + f.slice(1));
      folderChecks += `<label class="meta-folder-check"><input type="checkbox" name="metaFolders" value="${f}" ${checked}> ${escHtml(label)}</label>`;
    });

    metaBody.innerHTML = `
      <div class="meta-preview">${previewHtml}</div>
      <div class="meta-url" id="assetUrlDisplay" title="Click to copy URL">${asset.publicUrl}</div>
      <div class="meta-info">${assetFolders.join(', ')} · ${sizeStr} · ${dateStr}</div>
      ${shareHtml}
      <div class="meta-field">
        <label class="meta-label">Title</label>
        <input type="text" class="meta-input" id="metaTitle" value="${escHtml(asset.title || '')}">
      </div>
      <div class="meta-field">
        <label class="meta-label">Alt Text <span style="text-transform:none;letter-spacing:0;font-weight:500;color:var(--slate);">(SEO / accessibility — describe the image)</span></label>
        <input type="text" class="meta-input" id="metaAlt" maxlength="250" value="${escHtml(asset.altText || '')}" placeholder="e.g. Sleek black coffee machine on marble counter">
      </div>
      <div class="meta-field">
        <label class="meta-label">Caption <span style="text-transform:none;letter-spacing:0;font-weight:500;color:var(--slate);">(optional — shown under image)</span></label>
        <textarea class="meta-input" id="metaCaption" maxlength="500" rows="2" style="resize:vertical;min-height:54px;">${escHtml(asset.caption || '')}</textarea>
      </div>
      <div class="meta-field">
        <label class="meta-label">Tags (comma separated)</label>
        <input type="text" class="meta-input" id="metaTags" value="${escHtml((asset.tags || []).join(', '))}">
      </div>
      <div class="meta-field">
        <label class="meta-label">Folders</label>
        <div class="meta-folder-grid" id="metaFolderGrid">${folderChecks}</div>
      </div>
      <div class="meta-field">
        <label class="meta-label">Attach to Client</label>
        <select class="meta-select" id="metaClient">${clientOpts}</select>
      </div>`;

    document.getElementById('assetUrlDisplay').addEventListener('click', () => copyToClipboard(asset.publicUrl, 'URL copied'));

    // Share button
    const shareBtn = document.getElementById('shareAssetBtn');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        try {
          const r = await fetch(`/admin/assets/${asset._id}/share`, { method: 'POST' });
          const data = await r.json();
          if (data.success) {
            asset.shareToken = data.shareToken;
            const fullUrl = window.location.origin + data.shareUrl;
            navigator.clipboard.writeText(fullUrl);
            shareBtn.textContent = '✓ Link Copied';
            setTimeout(() => renderMeta(asset), 1500);
          }
        } catch (err) { alert('Error: ' + err.message); }
      });
    }

    // Revoke share
    const revokeBtn = document.getElementById('revokeShareBtn');
    if (revokeBtn) {
      revokeBtn.addEventListener('click', async () => {
        try {
          await fetch(`/admin/assets/${asset._id}/share`, { method: 'DELETE' });
          asset.shareToken = null;
          renderMeta(asset);
        } catch (err) { alert('Error: ' + err.message); }
      });
    }
  }

  /* ── COPY URL ── */
  copyUrlBtn.addEventListener('click', () => {
    if (selectedAsset) copyToClipboard(selectedAsset.publicUrl, 'URL copied');
  });

  // Download button in meta footer — in bulk mode, fan out per selected asset
  if (downloadAssetBtn) {
    downloadAssetBtn.addEventListener('click', (e) => {
      if (bulkMode) {
        e.preventDefault();
        performBulkDownload();
      }
    });
  }

  /* ── SAVE META ── */
  saveMetaBtn.addEventListener('click', async () => {
    if (bulkMode) return performBulkSave();
    if (!selectedAsset) return;
    const title = document.getElementById('metaTitle')?.value?.trim() || '';
    const altText = document.getElementById('metaAlt')?.value?.trim() || '';
    const caption = document.getElementById('metaCaption')?.value?.trim() || '';
    const tags = document.getElementById('metaTags')?.value || '';
    // Collect checked folders
    const folderChecks = document.querySelectorAll('input[name="metaFolders"]:checked');
    const folders = [...folderChecks].map(cb => cb.value);
    if (!folders.length) folders.push('general');
    const clientId = document.getElementById('metaClient')?.value || '';
    try {
      saveMetaBtn.textContent = 'Saving...';
      saveMetaBtn.disabled = true;
      const r = await fetch(`/admin/assets/${selectedAsset._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, altText, caption, tags, folders, clientId }),
      });
      const data = await r.json();
      if (data.success) {
        selectedAsset.title = title;
        selectedAsset.altText = altText;
        selectedAsset.caption = caption;
        selectedAsset.folders = folders;
        selectedAsset.folder = folders[0];
        selectedAsset.clientId = clientId || null;
        selectedAsset.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
        // Refresh the card label
        const card = document.querySelector(`.asset-card[data-id="${selectedAsset._id}"] .asset-name`);
        if (card) {
          const badge = selectedAsset.fileType === 'video' ? 'badge-video' : 'badge-image';
          const clientDot = selectedAsset.clientId ? '<span class="asset-client-dot" title="Linked to client">●</span>' : '';
          card.innerHTML = `<span class="asset-type-badge ${badge}">${selectedAsset.fileType}</span>${clientDot}${escHtml(title || selectedAsset.originalName)}`;
        }
        saveMetaBtn.textContent = '✓ Saved';
        setTimeout(() => { saveMetaBtn.textContent = 'Save'; saveMetaBtn.disabled = false; }, 1500);
        // Reload if current folder no longer matches
        if (currentFolder !== 'all' && !folders.includes(currentFolder)) {
          loadAssets();
        }
        loadFolderCounts();
      }
    } catch (err) {
      alert('Error saving: ' + err.message);
      saveMetaBtn.textContent = 'Save';
      saveMetaBtn.disabled = false;
    }
  });

  /* ── DELETE ── */
  deleteAssetBtn.addEventListener('click', async () => {
    if (bulkMode) return performBulkDelete();
    if (!selectedAsset) return;
    if (!confirm(`Delete "${selectedAsset.title || selectedAsset.originalName}"? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/admin/assets/${selectedAsset._id}`, { method: 'DELETE' });
      const data = await r.json();
      if (data.success) {
        document.querySelector(`.asset-card[data-id="${selectedAsset._id}"]`)?.remove();
        clearSelection();
        loadFolderCounts();
      }
    } catch (err) {
      alert('Error deleting: ' + err.message);
    }
  });

  /* ── UPLOAD ── */
  uploadZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleUpload(e.target.files));

  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    handleUpload(e.dataTransfer.files);
  });

  async function handleUpload(files) {
    if (!files?.length) return;
    const folder = currentFolder === 'all' ? 'general' : currentFolder;
    const total = files.length;

    progressEl.style.display = '';
    progressBar.style.width = '0%';
    progressLabel.textContent = `Uploading 0 / ${total}...`;

    const formData = new FormData();
    formData.append('folder', folder);
    for (const f of files) formData.append('files', f);

    try {
      const r = await fetch('/admin/assets/upload', { method: 'POST', body: formData });
      const data = await r.json();

      if (data.success) {
        progressBar.style.width = '100%';
        progressLabel.textContent = `✓ Uploaded ${data.assets.length} file${data.assets.length > 1 ? 's' : ''}`;
        // Prepend new cards
        data.assets.forEach(asset => {
          const card = buildCard(asset);
          grid.prepend(card);
        });
        setTimeout(() => { progressEl.style.display = 'none'; }, 2000);
        loadFolderCounts();
        fileInput.value = '';
      } else {
        progressLabel.textContent = 'Error: ' + (data.error || 'Upload failed');
      }
    } catch (err) {
      progressLabel.textContent = 'Upload error: ' + err.message;
    }
  }

  /* ── HELPERS ── */
  function formatBytes(b) {
    if (!b) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function copyToClipboard(text, msg) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = copyUrlBtn;
      const orig = btn.textContent;
      btn.textContent = '✓ ' + msg;
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  }

  /* ── MOBILE DRAWERS ── */
  const folderPanel = document.querySelector('.folder-panel');
  const metaPanel = document.querySelector('.meta-panel');
  const drawerOverlay = document.getElementById('drawerOverlay');
  const mobFolderBtn = document.getElementById('mobFolderBtn');
  const mobInfoBtn = document.getElementById('mobInfoBtn');
  const mobUploadBtn = document.getElementById('mobUploadBtn');

  function isMobile() { return window.innerWidth <= 820; }

  function openDrawer(panel) {
    if (!panel) return;
    panel.classList.add('drawer-mode', 'open');
    if (drawerOverlay) drawerOverlay.classList.add('active');
  }
  function closeDrawers() {
    [folderPanel, metaPanel].forEach(p => {
      if (p) { p.classList.remove('open'); setTimeout(() => p.classList.remove('drawer-mode'), 300); }
    });
    if (drawerOverlay) drawerOverlay.classList.remove('active');
  }

  if (mobFolderBtn) mobFolderBtn.addEventListener('click', () => { closeDrawers(); openDrawer(folderPanel); });
  if (mobInfoBtn) mobInfoBtn.addEventListener('click', () => { closeDrawers(); openDrawer(metaPanel); });
  if (mobUploadBtn) mobUploadBtn.addEventListener('click', () => {
    closeDrawers();
    const uz = document.getElementById('uploadZone');
    if (uz) { uz.scrollIntoView({ behavior: 'smooth', block: 'center' }); uz.click(); }
  });
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawers);
  document.getElementById('closeFolderDrawer')?.addEventListener('click', closeDrawers);
  document.getElementById('closeMetaDrawer')?.addEventListener('click', closeDrawers);

  // Auto-open meta drawer on mobile when asset selected
  const origSelectAsset = selectAsset;
  selectAsset = function(asset, card) {
    origSelectAsset(asset, card);
    if (isMobile()) openDrawer(metaPanel);
  };

  /* ── INIT ── */
  // Read initial folder/client from URL params (sidebar deep links)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('folder')) {
    currentFolder = urlParams.get('folder');
    // Activate the correct folder item
    document.querySelectorAll('.folder-item').forEach(f => {
      f.classList.toggle('active', f.dataset.folder === currentFolder);
    });
    uploadFolderLabel.textContent = currentFolder;
  }
  if (urlParams.get('clientId')) {
    currentClientId = urlParams.get('clientId');
  }

  Promise.all([loadClients(), loadCustomFolders()]).then(() => {
    // Populate bulk move client dropdown
    const bulkClientSel = document.getElementById('bulkMoveClient');
    if (bulkClientSel) {
      clientsList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c._id;
        opt.textContent = c.company ? `${c.name} (${c.company})` : c.name;
        bulkClientSel.appendChild(opt);
      });
    }
    // Build client sub-items under Clients folder
    const clientsFolder = document.querySelector('.folder-item[data-folder="clients"]');
    if (clientsFolder) {
      const activeClients = clientsList.filter(c => c.status !== 'inactive');
      activeClients.forEach(c => {
        const el = document.createElement('div');
        el.className = 'folder-item folder-sub';
        el.dataset.folder = 'clients';
        el.dataset.clientId = c._id;
        const label = c.company || c.name;
        el.innerHTML = `<span class="fi-icon" style="font-size:0.7rem;">·</span> ${escHtml(label)} <span class="fi-count" id="cnt-client-${c._id}">—</span>`;
        clientsFolder.insertAdjacentElement('afterend', el);
        el.addEventListener('click', () => {
          document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active'));
          el.classList.add('active');
          currentFolder = 'clients';
          currentClientId = c._id;
          uploadFolderLabel.textContent = 'clients';
          loadAssets();
        });
      });
    }
    loadFolderCounts();
    loadAssets();
  });
})();
