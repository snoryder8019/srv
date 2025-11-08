/**
 * Linode Bucket Manager - Client-side JavaScript
 * Handles upload, directory tree, asset management, metadata editing, drag & drop
 */

let currentBucket = null;
let currentSubdirectory = null;
let selectedAsset = null;
let directoryTree = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadDirectoryTree();
  setupUploadZone();
  setupSearch();
});

/**
 * Load statistics
 */
async function loadStats() {
  try {
    const response = await fetch('/api/v1/bucket/stats');
    const data = await response.json();

    if (data.success) {
      document.getElementById('stat-total').textContent = data.stats.totalAssets;
      document.getElementById('stat-size').textContent = formatBytes(data.stats.totalSize);
    }
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

/**
 * Load directory tree
 */
async function loadDirectoryTree() {
  try {
    const response = await fetch('/api/v1/bucket/directories');
    const data = await response.json();

    if (data.success) {
      directoryTree = data.tree;
      renderDirectoryTree(data.tree);
    }
  } catch (error) {
    console.error('Error loading directory tree:', error);
    document.getElementById('directory-tree').innerHTML = '<div class="empty-state">Error loading directories</div>';
  }
}

/**
 * Render directory tree
 */
function renderDirectoryTree(tree) {
  const container = document.getElementById('directory-tree');
  container.innerHTML = '';

  tree.forEach(bucket => {
    // Bucket node
    const bucketEl = document.createElement('div');
    bucketEl.className = 'tree-item bucket';
    bucketEl.innerHTML = `
      <span>📦 ${bucket.name}</span>
      <span class="count">${bucket.count}</span>
    `;
    bucketEl.onclick = () => selectDirectory(bucket.name, '');
    container.appendChild(bucketEl);

    // Subdirectories
    bucket.children.forEach(subdir => {
      const subdirEl = document.createElement('div');
      subdirEl.className = 'tree-item subdirectory';
      subdirEl.innerHTML = `
        <span>📁 ${subdir.name}</span>
        <span class="count">${subdir.count}</span>
      `;
      subdirEl.onclick = (e) => {
        e.stopPropagation();
        selectDirectory(bucket.name, subdir.name);
      };
      container.appendChild(subdirEl);
    });
  });
}

/**
 * Select directory and load assets
 */
async function selectDirectory(bucket, subdirectory) {
  currentBucket = bucket;
  currentSubdirectory = subdirectory;

  // Update active state
  document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');

  // Update header
  const path = subdirectory ? `${bucket}/${subdirectory}` : bucket;
  document.getElementById('current-path').textContent = `📍 ${path}`;

  // Load assets
  await loadAssets();
}

/**
 * Load assets for current directory
 */
async function loadAssets() {
  const grid = document.getElementById('asset-grid');
  grid.innerHTML = '<div class="loading">Loading assets...</div>';

  try {
    let url = `/api/v1/bucket/assets?bucket=${currentBucket}`;
    if (currentSubdirectory) {
      url += `&subdirectory=${currentSubdirectory}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.success) {
      renderAssets(data.assets);
    }
  } catch (error) {
    console.error('Error loading assets:', error);
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div>Error loading assets</div>';
  }
}

/**
 * Render assets in grid
 */
function renderAssets(assets) {
  const grid = document.getElementById('asset-grid');

  if (assets.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div>No assets yet. Upload some files!</div></div>';
    return;
  }

  grid.innerHTML = '';

  assets.forEach(asset => {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.onclick = () => showAssetDetail(asset);

    const thumbnail = renderThumbnail(asset);

    card.innerHTML = `
      <div class="asset-thumbnail">${thumbnail}</div>
      <div class="asset-info">
        <div class="asset-name" title="${asset.originalName}">${asset.originalName}</div>
        <div class="asset-meta">${formatBytes(asset.size)} • ${formatDate(asset.uploadedAt)}</div>
      </div>
    `;

    grid.appendChild(card);
  });
}

/**
 * Render thumbnail based on file type
 */
function renderThumbnail(asset) {
  if (asset.fileType === 'image') {
    return `<img src="${asset.publicUrl}" alt="${asset.originalName}">`;
  } else if (asset.fileType === 'video') {
    return '<div class="icon">🎬</div>';
  } else if (asset.fileType === 'object') {
    return '<div class="icon">🎲</div>';
  } else if (asset.fileType === 'document') {
    return '<div class="icon">📄</div>';
  } else {
    return '<div class="icon">📦</div>';
  }
}

/**
 * Show asset detail panel
 */
async function showAssetDetail(asset) {
  selectedAsset = asset;

  // Load full asset details
  try {
    const response = await fetch(`/api/v1/bucket/asset/${asset._id}`);
    const data = await response.json();

    if (data.success) {
      selectedAsset = data.asset;
      renderAssetDetail(data.asset);
    }
  } catch (error) {
    console.error('Error loading asset details:', error);
    showAlert('Error loading asset details', 'error');
  }
}

/**
 * Render asset detail panel
 */
function renderAssetDetail(asset) {
  const panel = document.getElementById('detail-panel');
  const preview = document.getElementById('detail-preview');

  // Show panel
  panel.classList.add('active');

  // Render preview
  if (asset.fileType === 'image') {
    preview.innerHTML = `<img src="${asset.publicUrl}" alt="${asset.originalName}">`;
  } else if (asset.fileType === 'video') {
    preview.innerHTML = `<video src="${asset.publicUrl}" controls></video>`;
  } else if (asset.fileType === 'object') {
    preview.innerHTML = '<div class="icon" style="font-size: 100px;">🎲</div>';
  } else if (asset.fileType === 'document') {
    preview.innerHTML = '<div class="icon" style="font-size: 100px;">📄</div>';
  } else {
    preview.innerHTML = '<div class="icon" style="font-size: 100px;">📦</div>';
  }

  // Fill in fields
  document.getElementById('detail-filename').value = asset.originalName;
  document.getElementById('detail-title').value = asset.title || '';
  document.getElementById('detail-description').value = asset.description || '';
  document.getElementById('detail-tags').value = asset.tags ? asset.tags.join(', ') : '';
  document.getElementById('detail-visibility').value = asset.visibility;
  document.getElementById('detail-url').value = asset.publicUrl;
  document.getElementById('detail-info').value = `${asset.fileType} • ${formatBytes(asset.size)} • ${asset.mimeType}`;

  // Highlight selected card
  document.querySelectorAll('.asset-card').forEach(card => card.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
}

/**
 * Close detail panel
 */
function closeDetail() {
  document.getElementById('detail-panel').classList.remove('active');
  document.querySelectorAll('.asset-card').forEach(card => card.classList.remove('selected'));
  selectedAsset = null;
}

/**
 * Save metadata changes
 */
async function saveMetadata() {
  if (!selectedAsset) return;

  if (!confirm('💾 Save changes to this asset?')) return;

  const title = document.getElementById('detail-title').value;
  const description = document.getElementById('detail-description').value;
  const tags = document.getElementById('detail-tags').value;
  const visibility = document.getElementById('detail-visibility').value;

  try {
    const response = await fetch(`/api/v1/bucket/asset/${selectedAsset._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, tags, visibility })
    });

    const data = await response.json();

    if (data.success) {
      showAlert('✅ Metadata saved successfully!');
      selectedAsset = data.asset;
    } else {
      showAlert('❌ ' + (data.error || 'Failed to save'), 'error');
    }
  } catch (error) {
    console.error('Error saving metadata:', error);
    showAlert('❌ Error saving metadata', 'error');
  }
}

/**
 * Delete asset
 */
async function deleteAsset() {
  if (!selectedAsset) return;

  if (!confirm(`🗑️ Are you sure you want to DELETE this asset?\n\n"${selectedAsset.originalName}"\n\nThis action CANNOT be undone!`)) {
    return;
  }

  try {
    const response = await fetch(`/api/v1/bucket/asset/${selectedAsset._id}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      showAlert('✅ Asset deleted successfully!');
      closeDetail();
      loadAssets();
      loadStats();
      loadDirectoryTree();
    } else {
      showAlert('❌ ' + (data.error || 'Failed to delete'), 'error');
    }
  } catch (error) {
    console.error('Error deleting asset:', error);
    showAlert('❌ Error deleting asset', 'error');
  }
}

/**
 * Copy URL to clipboard
 */
function copyUrl() {
  const urlInput = document.getElementById('detail-url');
  urlInput.select();
  document.execCommand('copy');
  showAlert('📋 URL copied to clipboard!');
}

/**
 * Setup upload zone (drag & drop)
 */
function setupUploadZone() {
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');

  // Click to browse
  zone.addEventListener('click', () => {
    if (!currentBucket) {
      alert('⚠️ Please select a bucket first!');
      return;
    }
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
  });

  // Drag & drop
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');

    if (!currentBucket) {
      alert('⚠️ Please select a bucket first!');
      return;
    }

    handleFiles(e.dataTransfer.files);
  });
}

/**
 * Handle file uploads
 */
async function handleFiles(files) {
  if (files.length === 0) return;

  const zone = document.getElementById('upload-zone');
  zone.classList.add('uploading');
  zone.querySelector('.upload-zone-text').textContent = `Uploading ${files.length} file(s)...`;

  const formData = new FormData();
  for (let file of files) {
    formData.append('files', file);
  }

  formData.append('bucket', currentBucket);
  if (currentSubdirectory) {
    formData.append('subdirectory', currentSubdirectory);
  }
  formData.append('visibility', 'public');

  try {
    const response = await fetch('/api/v1/bucket/upload', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      showAlert(`✅ Uploaded ${data.assets.length} file(s) successfully!`);
      loadAssets();
      loadStats();
      loadDirectoryTree();
    } else {
      showAlert('❌ ' + (data.error || 'Upload failed'), 'error');
    }
  } catch (error) {
    console.error('Upload error:', error);
    showAlert('❌ Upload failed: ' + error.message, 'error');
  } finally {
    zone.classList.remove('uploading');
    zone.querySelector('.upload-zone-text').textContent = 'Drag & drop files here';
    document.getElementById('file-input').value = '';
  }
}

/**
 * Setup search
 */
function setupSearch() {
  const searchInput = document.getElementById('search-input');
  let searchTimeout;

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch(e.target.value);
    }, 300);
  });
}

/**
 * Perform search
 */
async function performSearch(query) {
  if (!currentBucket) return;

  const grid = document.getElementById('asset-grid');
  grid.innerHTML = '<div class="loading">Searching...</div>';

  try {
    let url = `/api/v1/bucket/assets?bucket=${currentBucket}`;
    if (currentSubdirectory) {
      url += `&subdirectory=${currentSubdirectory}`;
    }
    if (query) {
      url += `&search=${encodeURIComponent(query)}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.success) {
      renderAssets(data.assets);
    }
  } catch (error) {
    console.error('Search error:', error);
    grid.innerHTML = '<div class="empty-state">Search error</div>';
  }
}

/**
 * Open create directory modal
 */
function openCreateDirModal() {
  document.getElementById('create-dir-modal').classList.add('active');
  if (currentBucket) {
    document.getElementById('new-dir-bucket').value = currentBucket;
  }
}

/**
 * Close create directory modal
 */
function closeCreateDirModal() {
  document.getElementById('create-dir-modal').classList.remove('active');
  document.getElementById('new-dir-name').value = '';
}

/**
 * Create directory
 */
async function createDirectory() {
  const bucket = document.getElementById('new-dir-bucket').value;
  const subdirectory = document.getElementById('new-dir-name').value.trim();

  if (!subdirectory) {
    alert('⚠️ Please enter a subdirectory name');
    return;
  }

  if (!/^[a-zA-Z0-9\-_\/]+$/.test(subdirectory)) {
    alert('⚠️ Invalid subdirectory name. Use only letters, numbers, dashes, underscores, and slashes.');
    return;
  }

  if (!confirm(`📁 Create subdirectory "${bucket}/${subdirectory}"?`)) {
    return;
  }

  try {
    const response = await fetch('/api/v1/bucket/directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, subdirectory })
    });

    const data = await response.json();

    if (data.success) {
      showAlert('✅ Subdirectory created! Upload files to populate it.');
      closeCreateDirModal();
      loadDirectoryTree();
    } else {
      showAlert('❌ ' + (data.error || 'Failed to create directory'), 'error');
    }
  } catch (error) {
    console.error('Create directory error:', error);
    showAlert('❌ Error creating directory', 'error');
  }
}

/**
 * Show alert notification
 */
function showAlert(message, type = 'success') {
  const alert = document.getElementById('alert');
  alert.textContent = message;
  alert.className = `alert ${type} active`;

  setTimeout(() => {
    alert.classList.remove('active');
  }, 3000);
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format date
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Toggle mobile tree panel
 */
function toggleMobileTree() {
  const treePanel = document.querySelector('.tree-panel');
  const toggleBtn = document.querySelector('.mobile-tree-toggle');

  if (treePanel.classList.contains('mobile-open')) {
    treePanel.classList.remove('mobile-open');
    toggleBtn.textContent = '📁 Show Buckets';
  } else {
    treePanel.classList.add('mobile-open');
    toggleBtn.textContent = '✕ Hide Buckets';
  }
}

/**
 * Close detail panel on mobile (clicking the ::before element)
 */
document.addEventListener('click', (e) => {
  const detailPanel = document.getElementById('detail-panel');
  if (!detailPanel) return;

  // Check if click is on the mobile close button (::before element area)
  if (window.innerWidth <= 768 && detailPanel.classList.contains('active')) {
    const rect = detailPanel.getBoundingClientRect();
    const clickY = e.clientY - rect.top;

    // If click is in the top 50px (where ::before close button is)
    if (clickY >= 0 && clickY <= 50 && e.clientX > rect.right - 100) {
      closeDetail();
    }
  }
});

/**
 * Auto-hide mobile tree when bucket is selected
 */
const originalSelectDirectory = selectDirectory;
selectDirectory = async function(bucket, subdirectory) {
  await originalSelectDirectory.call(this, bucket, subdirectory);

  // Auto-hide tree on mobile after selection
  if (window.innerWidth <= 768) {
    const treePanel = document.querySelector('.tree-panel');
    const toggleBtn = document.querySelector('.mobile-tree-toggle');
    if (treePanel && toggleBtn) {
      treePanel.classList.remove('mobile-open');
      toggleBtn.textContent = '📁 Show Buckets';
    }
  }
};
