/**
 * Community Voting Script
 */

let currentUserId = null;
let allAssets = [];
let currentFilter = 'all';

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Get user from window (passed from server)
  if (window.currentUser) {
    currentUserId = window.currentUser._id;
    console.log('User authenticated:', window.currentUser.username, 'ID:', currentUserId);
  } else {
    console.log('User not authenticated, window.currentUser:', window.currentUser);
  }

  // Setup filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Update active state
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      // Apply filter
      currentFilter = e.target.dataset.type;
      filterAndDisplayAssets();
    });
  });

  loadApprovedAssets();
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
 * Load approved assets
 */
async function loadApprovedAssets() {
  try {
    const response = await fetch('/api/v1/assets/approved/list', {
      credentials: 'same-origin'
    });
    const data = await response.json();

    if (data.success) {
      allAssets = data.assets;
      filterAndDisplayAssets();
    } else {
      showAlert('Failed to load assets', 'error');
    }
  } catch (error) {
    console.error('Error loading assets:', error);
    showAlert('An error occurred while loading assets', 'error');
  }
}

/**
 * Filter assets and display them
 */
function filterAndDisplayAssets() {
  let filteredAssets = allAssets;

  if (currentFilter !== 'all') {
    filteredAssets = allAssets.filter(asset =>
      asset.assetType.toLowerCase() === currentFilter.toLowerCase()
    );
  }

  displayAssets(filteredAssets);
}

/**
 * Display voting assets
 */
function displayAssets(assets) {
  const grid = document.getElementById('votingGrid');

  console.log('Displaying assets, currentUserId:', currentUserId);

  if (assets.length === 0) {
    grid.innerHTML = '<p>No approved assets yet. Be the first to submit one!</p>';
    return;
  }

  grid.innerHTML = assets.map(asset => {
    // Convert voter IDs to strings for comparison
    const voterIds = asset.voters ? asset.voters.map(v => typeof v === 'string' ? v : v.toString()) : [];
    const hasVoted = currentUserId && voterIds.includes(currentUserId);
    console.log(`Asset ${asset.title}: hasVoted=${hasVoted}, currentUserId=${currentUserId}, voters=`, voterIds);

    return `
      <div class="vote-card">
        <div class="vote-card-images">
          ${asset.images && asset.images.pixelArt ? `
            <img src="${asset.images.pixelArt}" alt="${asset.title} - Pixel Art" class="vote-card-image">
          ` : ''}
          ${asset.images && asset.images.fullscreen ? `
            <img src="${asset.images.fullscreen}" alt="${asset.title} - Fullscreen" class="vote-card-image">
          ` : ''}
          ${asset.images && asset.images.indexCard ? `
            <img src="${asset.images.indexCard}" alt="${asset.title} - Index Card" class="vote-card-image">
          ` : ''}
        </div>

        <div class="vote-card-content">
          <h2 class="vote-card-title">${asset.title}</h2>
          <p class="vote-card-author">Type: ${asset.assetType}${asset.subType ? ` - ${asset.subType}` : ''}</p>
          ${asset.createdBy && asset.createdBy.username ? `
            <p class="vote-card-author">Created by: ${asset.createdBy.username}</p>
          ` : ''}
          <p class="vote-card-description">${asset.description || 'No description provided'}</p>

          <div class="vote-card-footer">
            <div class="vote-count">
              👍 <span id="votes-${asset._id}">${asset.votes || 0}</span>
            </div>

            ${currentUserId ? `
              <button
                class="vote-button ${hasVoted ? 'voted' : ''}"
                id="vote-btn-${asset._id}"
                onclick="toggleVote('${asset._id}', ${hasVoted})">
                ${hasVoted ? '✓ Voted' : 'Vote'}
              </button>
            ` : `
              <a href="/auth" class="vote-button" style="text-decoration: none; display: inline-block; text-align: center;">Login to Vote</a>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Toggle vote
 */
async function toggleVote(assetId, hasVoted) {
  if (!currentUserId) {
    showAlert('Please log in to vote', 'error');
    return;
  }

  const button = document.getElementById(`vote-btn-${assetId}`);
  const votesSpan = document.getElementById(`votes-${assetId}`);

  try {
    button.disabled = true;

    const method = hasVoted ? 'DELETE' : 'POST';
    const response = await fetch(`/api/v1/assets/${assetId}/vote`, {
      method: method,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (data.success) {
      // Update UI
      votesSpan.textContent = data.votes;

      if (hasVoted) {
        button.textContent = 'Vote';
        button.classList.remove('voted');
        button.onclick = () => toggleVote(assetId, false);
        showAlert('Vote removed', 'info');
      } else {
        button.textContent = '✓ Voted';
        button.classList.add('voted');
        button.onclick = () => toggleVote(assetId, true);
        showAlert('Vote added!', 'success');
      }
    } else {
      showAlert(data.error || 'Failed to vote', 'error');
    }
  } catch (error) {
    console.error('Error voting:', error);
    showAlert('An error occurred while voting', 'error');
  } finally {
    button.disabled = false;
  }
}
