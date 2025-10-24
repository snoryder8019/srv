/**
 * Community Voting System with Admin Filters
 * Simple voting interface using window.USER_ID for authentication
 */

let allAssets = [];
let currentTypeFilter = 'all';
let currentStatusFilter = 'submitted';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  console.log('Vote.js loaded');
  console.log('User ID:', window.USER_ID);
  console.log('Username:', window.USERNAME);
  console.log('Is Admin:', window.IS_ADMIN);

  loadAssets();
  setupFilterButtons();
});

/**
 * Load assets from API based on current status filter
 */
async function loadAssets() {
  try {
    let endpoint = '/api/v1/assets/community';

    if (window.IS_ADMIN) {
      if (currentStatusFilter === 'approved') {
        endpoint = '/api/v1/assets/approved/list';
      } else if (currentStatusFilter === 'all') {
        endpoint = '/api/v1/assets/approved/list';
      }
    }

    const response = await fetch(endpoint, {
      credentials: 'same-origin'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    allAssets = data.assets || [];

    if (currentStatusFilter === 'all' && window.IS_ADMIN) {
      const communityResponse = await fetch('/api/v1/assets/community', {
        credentials: 'same-origin'
      });

      if (communityResponse.ok) {
        const communityData = await communityResponse.json();
        allAssets = allAssets.concat(communityData.assets || []);
      }
    }

    console.log(`Loaded ${allAssets.length} assets`);
    displayAssets();
  } catch (error) {
    console.error('Error loading assets:', error);
    showAlert('Failed to load assets. Please refresh the page.', 'error');
  }
}

/**
 * Display assets based on current filters
 */
function displayAssets() {
  const grid = document.getElementById('votingGrid');

  let filteredAssets = allAssets;

  if (currentTypeFilter !== 'all') {
    filteredAssets = filteredAssets.filter(asset => {
      const assetType = asset.type || asset.assetType;
      return assetType === currentTypeFilter;
    });
  }

  if (filteredAssets.length === 0) {
    grid.innerHTML = '<p style="text-align: center; padding: 3rem; color: #888;">No assets found for the selected filters.</p>';
    return;
  }

  grid.innerHTML = filteredAssets.map(asset => createAssetCard(asset)).join('');
}

/**
 * Create HTML for a single asset card
 */
function createAssetCard(asset) {
  let imageUrl = 'data:image/svg+xml,%3Csvg%20width%3D%22400%22%20height%3D%22400%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%22400%22%20height%3D%22400%22%20fill%3D%22%23e5e7eb%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%20font-family%3D%22Arial%22%20font-size%3D%2224%22%20fill%3D%22%239ca3af%22%3ENo%20Image%3C%2Ftext%3E%3C%2Fsvg%3E';

  if (asset.images) {
    if (asset.images.pixelArt) {
      imageUrl = asset.images.pixelArt;
    }
  }

  let hasVoted = false;
  if (window.USER_ID) {
    if (asset.votes) {
      if (Array.isArray(asset.votes)) {
        hasVoted = asset.votes.some(vote => vote.userId === window.USER_ID);
      }
    }
  }

  let netVotes = asset.votes || 0;
  let upvotes = asset.upvotes || 0;
  let downvotes = asset.downvotes || 0;

  const assetName = asset.name || asset.title || 'Untitled';
  const assetType = asset.type || asset.assetType || 'unknown';
  const statusBadge = asset.status === 'approved' ? '<span style="background: #10b981; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">✅ LIVE</span>' : '<span style="background: #f59e0b; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">🚧 IN DEV</span>';

  return `
    <div class="asset-card">
      <img class="asset-card-image" src="${imageUrl}" alt="${assetName}">
      <div class="asset-card-content">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h3 class="asset-card-title" style="margin: 0;">${assetName}</h3>
          ${statusBadge}
        </div>
        <p class="asset-card-description">${asset.description || 'No description'}</p>
        <div class="asset-card-meta">
          <span class="asset-type-badge">${assetType}</span>
          <span class="vote-count" style="color: ${netVotes >= 0 ? '#10b981' : '#ef4444'};">
            ${netVotes >= 0 ? '▲' : '▼'} ${Math.abs(netVotes)}
            <span style="font-size: 0.75rem; color: #888;">(${upvotes}↑ ${downvotes}↓)</span>
          </span>
        </div>
        <p style="color: #888; font-size: 0.875rem; margin: 0.5rem 0;">By: ${asset.creatorUsername || 'System'}</p>
        <div class="asset-card-actions">
          ${createVoteButton(asset._id, hasVoted)}
          ${createSuggestButton(asset._id, assetName)}
          ${createAdminButtons(asset)}
        </div>
      </div>
    </div>
  `;
}

/**
 * Create suggest button HTML
 */
function createSuggestButton(assetId, assetName) {
  if (!window.USER_ID) {
    return '';
  }

  return '<button class="btn btn-secondary" onclick="openSuggestionModal(\'' + assetId + '\', \'' + assetName.replace(/'/g, "\\'") + '\')" style="width: 100%; margin-top: 0.5rem;">Suggest Improvement</button>';
}

/**
 * Create admin action buttons (only visible to admins)
 */
function createAdminButtons(asset) {
  if (!window.USER_ID) {
    return '';
  }

  if (!window.IS_ADMIN) {
    return '';
  }

  let buttons = '';

  if (asset.status === 'submitted') {
    buttons = '<button class="btn" onclick="approveAsset(\'' + asset._id + '\')" style="width: 100%; margin-top: 0.5rem; background: #10b981; color: white;">✓ Approve for Game</button>';
  } else if (asset.status === 'draft') {
    buttons = '<button class="btn btn-secondary" onclick="submitForVoting(\'' + asset._id + '\')" style="width: 100%; margin-top: 0.5rem;">Submit for Voting</button>';
  } else if (asset.status === 'approved') {
    buttons = '<span style="display: block; width: 100%; margin-top: 0.5rem; padding: 0.5rem; background: #d1fae5; color: #065f46; border-radius: 4px; text-align: center; font-size: 0.875rem; font-weight: 500;">✓ Approved</span>';
  }

  return buttons;
}

/**
 * Approve asset for game (admin only)
 */
async function approveAsset(assetId) {
  if (!confirm('Approve this asset for the game? It will be added to the universe.')) {
    return;
  }

  try {
    const response = await fetch('/api/v1/assets/' + assetId + '/approve', {
      method: 'POST',
      credentials: 'same-origin'
    });

    const data = await response.json();

    if (response.ok) {
      alert('Asset approved! It has been added to the game.');
      loadAssets();
    } else {
      alert('Error: ' + (data.error || 'Failed to approve asset'));
    }
  } catch (error) {
    console.error('Error approving asset:', error);
    alert('Failed to approve asset');
  }
}

/**
 * Submit asset for voting (admin only)
 */
async function submitForVoting(assetId) {
  if (!confirm('Submit this asset for community voting?')) {
    return;
  }

  try {
    const response = await fetch('/api/v1/assets/' + assetId + '/submit', {
      method: 'POST',
      credentials: 'same-origin'
    });

    const data = await response.json();

    if (response.ok) {
      alert('Asset submitted for voting!');
      loadAssets();
    } else {
      alert('Error: ' + (data.error || 'Failed to submit asset'));
    }
  } catch (error) {
    console.error('Error submitting asset:', error);
    alert('Failed to submit asset');
  }
}

/**
 * Create vote button HTML based on authentication and vote status
 */
function createVoteButton(assetId, hasVoted) {
  if (!window.USER_ID) {
    return '<a href="/auth" class="btn btn-secondary" style="width: 100%; text-align: center;">Login to Vote</a>';
  }

  if (hasVoted) {
    return '<div style="display: flex; gap: 0.5rem; opacity: 0.5;"><button class="btn" disabled style="flex: 1; background: #10b981; cursor: not-allowed;">▲ Voted</button><button class="btn" disabled style="flex: 1; background: #ef4444; cursor: not-allowed;">▼</button></div>';
  }

  return `<div style="display: flex; gap: 0.5rem;">
    <button class="btn btn-primary" onclick="vote('${assetId}', 1)" style="flex: 1; background: #10b981;">▲ Upvote</button>
    <button class="btn btn-secondary" onclick="vote('${assetId}', -1)" style="flex: 1; background: #ef4444; color: white;">▼ Downvote</button>
  </div>`;
}

/**
 * Submit a vote for an asset
 * @param {string} assetId - Asset ID
 * @param {number} voteType - 1 for upvote, -1 for downvote
 */
async function vote(assetId, voteType = 1) {
  if (!window.USER_ID) {
    showAlert('Please log in to vote', 'error');
    return;
  }

  try {
    const voteLabel = voteType === 1 ? 'Upvoting' : 'Downvoting';
    console.log(`${voteLabel} asset ${assetId} as user ${window.USER_ID}`);

    const response = await fetch(`/api/v1/assets/${assetId}/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        userId: window.USER_ID,
        voteType: voteType
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to vote');
    }

    console.log('Vote successful:', data);
    showAlert(data.message || 'Vote recorded successfully!', 'success');

    await loadAssets();

  } catch (error) {
    console.error('Error voting:', error);
    showAlert(error.message || 'Failed to vote. Please try again.', 'error');
  }
}

/**
 * Setup filter button and dropdown handlers
 */
function setupFilterButtons() {
  // Handle dropdown type filter
  const typeFilterDropdown = document.getElementById('assetTypeFilter');
  if (typeFilterDropdown) {
    typeFilterDropdown.addEventListener('change', (e) => {
      currentTypeFilter = e.target.value;
      displayAssets();
    });
  }

  // Handle status filter buttons
  const statusFilterButtons = document.querySelectorAll('.status-filter');
  statusFilterButtons.forEach(button => {
    button.addEventListener('click', () => {
      statusFilterButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      currentStatusFilter = button.dataset.status;
      loadAssets();
    });
  });
}

/**
 * Show alert message to user
 */
function showAlert(message, type) {
  const container = document.getElementById('alertContainer');

  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;

  container.appendChild(alert);

  setTimeout(() => {
    alert.remove();
  }, 3000);
}
