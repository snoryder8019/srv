/**
 * Admin Asset Approval Script
 */

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadPendingAssets();
});

/**
 * Show alert message
 */
function showAlert(message, type = 'info') {
  const alertContainer = document.getElementById('alertContainer');
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  alertContainer.appendChild(alert);

  setTimeout(() => {
    alert.remove();
  }, 5000);
}

/**
 * Load statistics
 */
async function loadStats() {
  try {
    const response = await fetch('/admin/api/assets/stats');
    const data = await response.json();

    if (data.success) {
      document.getElementById('pendingCount').textContent = data.stats.pending || 0;
      document.getElementById('approvedCount').textContent = data.stats.approved || 0;
      document.getElementById('rejectedCount').textContent = data.stats.rejected || 0;
    }
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

/**
 * Load pending assets
 */
async function loadPendingAssets() {
  try {
    const response = await fetch('/admin/api/assets/pending');
    const data = await response.json();

    if (data.success) {
      displayPendingAssets(data.assets);
    } else {
      showAlert('Failed to load pending assets', 'error');
    }
  } catch (error) {
    console.error('Error loading pending assets:', error);
    showAlert('An error occurred while loading assets', 'error');
  }
}

/**
 * Display pending assets
 */
function displayPendingAssets(assets) {
  const container = document.getElementById('pendingAssets');

  if (assets.length === 0) {
    container.innerHTML = '<p>No pending assets to review.</p>';
    return;
  }

  container.innerHTML = assets.map(asset => `
    <div class="approval-item" id="asset-${asset._id}">
      <div class="approval-item-header">
        <div>
          <h2>${asset.title}</h2>
          <p><strong>Type:</strong> ${asset.assetType}</p>
          <p><strong>Submitted:</strong> ${new Date(asset.createdAt).toLocaleString()}</p>
          <p><strong>Description:</strong> ${asset.description || 'No description provided'}</p>
        </div>
        <div class="asset-status ${asset.status}">${asset.status}</div>
      </div>

      <div class="approval-item-images">
        ${asset.images.pixelArt ? `
          <div>
            <h4>Pixel Art</h4>
            <img src="${asset.images.pixelArt}" alt="Pixel Art" class="approval-image">
          </div>
        ` : ''}
        ${asset.images.fullscreen ? `
          <div>
            <h4>Fullscreen</h4>
            <img src="${asset.images.fullscreen}" alt="Fullscreen" class="approval-image">
          </div>
        ` : ''}
        ${asset.images.indexCard ? `
          <div>
            <h4>Index Card</h4>
            <img src="${asset.images.indexCard}" alt="Index Card" class="approval-image">
          </div>
        ` : ''}
      </div>

      <div>
        <label for="notes-${asset._id}">Admin Notes:</label>
        <textarea
          id="notes-${asset._id}"
          class="approval-notes"
          placeholder="Enter notes for the user (optional for approval, required for rejection)..."></textarea>
      </div>

      <div class="approval-actions">
        <button class="btn btn-success" onclick="approveAsset('${asset._id}')">
          ✓ Approve
        </button>
        <button class="btn btn-danger" onclick="rejectAsset('${asset._id}')">
          ✗ Reject
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * Approve asset
 */
async function approveAsset(assetId) {
  if (!confirm('Approve this asset?')) return;

  try {
    const notes = document.getElementById(`notes-${assetId}`).value;

    const response = await fetch(`/admin/api/assets/${assetId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ adminNotes: notes })
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Asset approved successfully!', 'success');
      document.getElementById(`asset-${assetId}`).remove();
      loadStats();

      // Check if no more pending assets
      const pendingContainer = document.getElementById('pendingAssets');
      if (pendingContainer.children.length === 0) {
        pendingContainer.innerHTML = '<p>No pending assets to review.</p>';
      }
    } else {
      showAlert(data.error || 'Failed to approve asset', 'error');
    }
  } catch (error) {
    console.error('Error approving asset:', error);
    showAlert('An error occurred while approving', 'error');
  }
}

/**
 * Reject asset
 */
async function rejectAsset(assetId) {
  const notes = document.getElementById(`notes-${assetId}`).value;

  if (!notes.trim()) {
    showAlert('Please provide rejection notes for the user', 'error');
    return;
  }

  if (!confirm('Reject this asset? The user will be able to edit and resubmit.')) return;

  try {
    const response = await fetch(`/admin/api/assets/${assetId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ adminNotes: notes })
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Asset rejected', 'success');
      document.getElementById(`asset-${assetId}`).remove();
      loadStats();

      // Check if no more pending assets
      const pendingContainer = document.getElementById('pendingAssets');
      if (pendingContainer.children.length === 0) {
        pendingContainer.innerHTML = '<p>No pending assets to review.</p>';
      }
    } else {
      showAlert(data.error || 'Failed to reject asset', 'error');
    }
  } catch (error) {
    console.error('Error rejecting asset:', error);
    showAlert('An error occurred while rejecting', 'error');
  }
}
