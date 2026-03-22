/* Asset Control Center — assetManager.js */
(function () {
  'use strict';

  let currentFolder = 'all';
  let currentType = 'all';
  let currentSearch = '';
  let selectedAsset = null;
  let searchTimeout = null;
  let folderCounts = {};

  const grid = document.getElementById('assetGrid');
  const metaBody = document.getElementById('metaBody');
  const metaFooter = document.getElementById('metaFooter');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const saveMetaBtn = document.getElementById('saveMetaBtn');
  const deleteAssetBtn = document.getElementById('deleteAssetBtn');
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const progressEl = document.getElementById('uploadProgress');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const folderStats = document.getElementById('folderStats');
  const uploadFolderLabel = document.getElementById('uploadFolderLabel');

  /* ── FOLDER COUNTS ── */
  async function loadFolderCounts() {
    try {
      const folders = ['all', 'general', 'sections', 'portfolio', 'blog', 'pages', 'clients'];
      await Promise.all(folders.map(async (f) => {
        const qs = f === 'all' ? '' : `?folder=${f}`;
        const r = await fetch(`/admin/assets/list${qs}&limit=0`);
        const data = await r.json();
        const el = document.getElementById(`cnt-${f}`);
        if (el) el.textContent = data.total ?? '—';
        folderCounts[f] = data.total ?? 0;
      }));
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

  /* ── SEARCH ── */
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    currentSearch = e.target.value.trim();
    searchTimeout = setTimeout(loadAssets, 300);
  });

  /* ── LOAD ASSETS ── */
  async function loadAssets() {
    grid.innerHTML = '<div class="grid-loading">Loading...</div>';
    clearSelection();
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (currentFolder !== 'all') params.set('folder', currentFolder);
      if (currentType !== 'all') params.set('type', currentType);
      if (currentSearch) params.set('search', currentSearch);

      const r = await fetch(`/admin/assets/list?${params}`);
      const data = await r.json();

      if (!data.assets?.length) {
        grid.innerHTML = '<div class="grid-empty">No assets found.<br><small>Upload files above to get started.</small></div>';
        return;
      }

      grid.innerHTML = '';
      data.assets.forEach(asset => {
        const card = buildCard(asset);
        grid.appendChild(card);
      });
    } catch (err) {
      grid.innerHTML = `<div class="grid-empty">Error: ${err.message}</div>`;
    }
  }

  function buildCard(asset) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.dataset.id = asset._id;

    let thumbHtml = '';
    if (asset.fileType === 'image') {
      thumbHtml = `<img src="${asset.publicUrl}" alt="${asset.title}" loading="lazy">`;
    } else if (asset.fileType === 'video') {
      thumbHtml = `<video src="${asset.publicUrl}" muted preload="metadata" style="pointer-events:none;"></video>`;
    } else {
      thumbHtml = `<div class="asset-icon">◻</div>`;
    }

    const badge = asset.fileType === 'video' ? 'badge-video' : 'badge-image';
    card.innerHTML = `
      <div class="asset-thumb">${thumbHtml}</div>
      <div class="asset-name">
        <span class="asset-type-badge ${badge}">${asset.fileType}</span>${asset.title || asset.originalName}
      </div>`;

    card.addEventListener('click', () => selectAsset(asset, card));
    return card;
  }

  /* ── SELECT ASSET ── */
  function selectAsset(asset, card) {
    document.querySelectorAll('.asset-card').forEach(c => c.classList.remove('selected'));
    if (card) card.classList.add('selected');
    selectedAsset = asset;
    copyUrlBtn.style.display = '';
    metaFooter.style.display = '';
    renderMeta(asset);
  }

  function clearSelection() {
    selectedAsset = null;
    copyUrlBtn.style.display = 'none';
    metaFooter.style.display = 'none';
    metaBody.innerHTML = '<div class="meta-preview"><div class="no-select">Select an asset<br>to view details</div></div>';
  }

  function renderMeta(asset) {
    const sizeStr = formatBytes(asset.size);
    const dateStr = asset.uploadedAt ? new Date(asset.uploadedAt).toLocaleDateString() : '—';
    let previewHtml = '';
    if (asset.fileType === 'image') {
      previewHtml = `<img src="${asset.publicUrl}" alt="${asset.title}">`;
    } else if (asset.fileType === 'video') {
      previewHtml = `<video src="${asset.publicUrl}" controls></video>`;
    } else {
      previewHtml = `<div class="no-select">◻ ${asset.fileType}</div>`;
    }

    metaBody.innerHTML = `
      <div class="meta-preview">${previewHtml}</div>
      <div class="meta-url" id="assetUrlDisplay" title="Click to copy URL">${asset.publicUrl}</div>
      <div class="meta-info">📁 ${asset.folder} · ${sizeStr} · ${dateStr}</div>
      <div class="meta-field">
        <label class="meta-label">Title</label>
        <input type="text" class="meta-input" id="metaTitle" value="${escHtml(asset.title || '')}">
      </div>
      <div class="meta-field">
        <label class="meta-label">Tags (comma separated)</label>
        <input type="text" class="meta-input" id="metaTags" value="${escHtml((asset.tags || []).join(', '))}">
      </div>
      <div class="meta-field">
        <label class="meta-label">Move to Folder</label>
        <select class="meta-select" id="metaFolder">
          <option value="general" ${asset.folder === 'general' ? 'selected' : ''}>General</option>
          <option value="sections" ${asset.folder === 'sections' ? 'selected' : ''}>Sections</option>
          <option value="portfolio" ${asset.folder === 'portfolio' ? 'selected' : ''}>Portfolio</option>
          <option value="blog" ${asset.folder === 'blog' ? 'selected' : ''}>Blog</option>
          <option value="pages" ${asset.folder === 'pages' ? 'selected' : ''}>Pages</option>
          <option value="clients" ${asset.folder === 'clients' ? 'selected' : ''}>Clients</option>
        </select>
      </div>`;

    document.getElementById('assetUrlDisplay').addEventListener('click', () => copyToClipboard(asset.publicUrl, 'URL copied'));
  }

  /* ── COPY URL ── */
  copyUrlBtn.addEventListener('click', () => {
    if (selectedAsset) copyToClipboard(selectedAsset.publicUrl, 'URL copied');
  });

  /* ── SAVE META ── */
  saveMetaBtn.addEventListener('click', async () => {
    if (!selectedAsset) return;
    const title = document.getElementById('metaTitle')?.value?.trim() || '';
    const tags = document.getElementById('metaTags')?.value || '';
    const folder = document.getElementById('metaFolder')?.value || selectedAsset.folder;
    try {
      saveMetaBtn.textContent = 'Saving...';
      saveMetaBtn.disabled = true;
      const r = await fetch(`/admin/assets/${selectedAsset._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, tags, folder }),
      });
      const data = await r.json();
      if (data.success) {
        selectedAsset.title = title;
        selectedAsset.folder = folder;
        selectedAsset.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
        // Refresh the card label
        const card = document.querySelector(`.asset-card[data-id="${selectedAsset._id}"] .asset-name`);
        if (card) card.lastChild.textContent = title || selectedAsset.originalName;
        saveMetaBtn.textContent = '✓ Saved';
        setTimeout(() => { saveMetaBtn.textContent = 'Save'; saveMetaBtn.disabled = false; }, 1500);
        if (folder !== currentFolder && currentFolder !== 'all') {
          loadAssets();
          loadFolderCounts();
        }
      }
    } catch (err) {
      alert('Error saving: ' + err.message);
      saveMetaBtn.textContent = 'Save';
      saveMetaBtn.disabled = false;
    }
  });

  /* ── DELETE ── */
  deleteAssetBtn.addEventListener('click', async () => {
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
    let done = 0;

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

  /* ── INIT ── */
  loadAssets();
  loadFolderCounts();
})();
