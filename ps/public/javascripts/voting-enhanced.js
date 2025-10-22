/**
 * Enhanced Community Voting Script
 * Includes suggestions, collaboration features, and type filtering
 */

let currentUserId = null;
let currentUsername = null;
let allAssets = [];
let currentFilter = 'all';

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Get user from window (passed from server)
  if (window.currentUser) {
    currentUserId = window.currentUser._id;
    currentUsername = window.currentUser.username;
    console.log('User authenticated:', currentUsername, 'ID:', currentUserId);
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

    const statsCount = Object.keys(asset.stats || {}).length;
    const suggestionsCount = (asset.suggestions || []).length;

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
          <p class="vote-card-author">Type: ${asset.assetType}${asset.subType ? ` - ${asset.subType}` : ''}${asset.rarity ? ` | ${asset.rarity}` : ''}</p>
          ${asset.createdBy && asset.createdBy.username ? `
            <p class="vote-card-author">Created by: ${asset.createdBy.username}</p>
          ` : ''}
          <p class="vote-card-description">${asset.description || 'No description provided'}</p>

          ${statsCount > 0 ? `<p style="font-size: 0.9rem; color: #666;">📊 ${statsCount} stat${statsCount !== 1 ? 's' : ''}</p>` : ''}
          ${suggestionsCount > 0 ? `<p style="font-size: 0.9rem; color: #666;">💡 ${suggestionsCount} suggestion${suggestionsCount !== 1 ? 's' : ''}</p>` : ''}

          <button class="btn btn-secondary btn-sm" style="margin-top: 0.5rem;" onclick="viewDetails('${asset._id}')">
            View Details & Stats
          </button>

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
 * View asset details
 */
async function viewDetails(assetId) {
  try {
    const response = await fetch(`/api/v1/assets/${assetId}`, {
      credentials: 'same-origin'
    });
    const data = await response.json();

    if (data.success) {
      const asset = data.asset;
      const modalBody = document.getElementById('modalBody');

      // Build stats display
      let statsHTML = '';
      if (asset.stats && Object.keys(asset.stats).length > 0) {
        statsHTML = '<div class="stats-display"><h4>Stats</h4><ul>';
        for (const [key, value] of Object.entries(asset.stats)) {
          const displayName = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
          statsHTML += `<li><strong>${displayName}:</strong> ${value}</li>`;
        }
        statsHTML += '</ul></div>';
      }

      // Build effects display
      let effectsHTML = '';
      if (asset.effects && asset.effects.length > 0) {
        effectsHTML = '<div class="effects-display"><h4>Special Effects</h4><ul>';
        asset.effects.forEach(effect => {
          effectsHTML += `<li>${effect}</li>`;
        });
        effectsHTML += '</ul></div>';
      }

      // Build lore display
      let loreHTML = '';
      if (asset.lore || asset.backstory || asset.flavor) {
        loreHTML = '<div class="lore-display"><h4>Lore</h4>';
        if (asset.flavor) loreHTML += `<p class="flavor-text">"${asset.flavor}"</p>`;
        if (asset.lore) loreHTML += `<p><strong>History:</strong> ${asset.lore}</p>`;
        if (asset.backstory) loreHTML += `<p><strong>Backstory:</strong> ${asset.backstory}</p>`;
        loreHTML += '</div>';
      }

      // Build suggestions display
      let suggestionsHTML = '<div class="suggestions-section"><h4>Community Suggestions</h4>';

      if (asset.suggestions && asset.suggestions.length > 0) {
        suggestionsHTML += asset.suggestions.map(s => `
          <div class="suggestion-item">
            <div class="suggestion-header">
              <span class="suggestion-author">${s.username}</span>
              <span class="suggestion-date">${new Date(s.createdAt).toLocaleDateString()}</span>
            </div>
            <div class="suggestion-text">${s.text}</div>
            <div class="suggestion-upvote">
              <span>👍 ${s.upvotes || 0}</span>
              ${currentUserId ? `
                <button class="btn btn-secondary btn-sm" onclick="upvoteSuggestion('${asset._id}', '${s._id}')">
                  Upvote
                </button>
              ` : ''}
            </div>
          </div>
        `).join('');
      } else {
        suggestionsHTML += '<p>No suggestions yet. Be the first!</p>';
      }

      // Add suggestion form
      if (currentUserId) {
        suggestionsHTML += `
          <div class="suggestion-form">
            <h5>Add Your Suggestion</h5>
            <textarea id="suggestionText-${asset._id}" placeholder="Suggest improvements, additional features, or pixel art changes..."></textarea>
            <button class="btn btn-primary" onclick="submitSuggestion('${asset._id}')">Submit Suggestion</button>
          </div>
        `;
      }

      suggestionsHTML += '</div>';

      modalBody.innerHTML = `
        <h2>${asset.title}</h2>
        <p>${asset.description}</p>
        <div style="margin: 1rem 0;">
          <strong>Type:</strong> ${asset.assetType}${asset.rarity ? ` | <span class="rarity-${asset.rarity}">${asset.rarity}</span>` : ''}
        </div>
        ${loreHTML}
        ${statsHTML}
        ${effectsHTML}
        ${suggestionsHTML}
      `;

      document.getElementById('assetModal').style.display = 'flex';
    }
  } catch (error) {
    console.error('Error loading asset details:', error);
    showAlert('Failed to load asset details', 'error');
  }
}

/**
 * Close modal
 */
function closeModal() {
  document.getElementById('assetModal').style.display = 'none';
}

/**
 * Submit suggestion
 */
async function submitSuggestion(assetId) {
  const textarea = document.getElementById(`suggestionText-${assetId}`);
  const text = textarea.value.trim();

  if (!text) {
    showAlert('Please enter a suggestion', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/v1/assets/${assetId}/suggestions`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Suggestion added!', 'success');
      textarea.value = '';
      viewDetails(assetId); // Refresh the modal
    } else {
      showAlert(data.error || 'Failed to add suggestion', 'error');
    }
  } catch (error) {
    console.error('Error adding suggestion:', error);
    showAlert('An error occurred', 'error');
  }
}

/**
 * Upvote suggestion
 */
async function upvoteSuggestion(assetId, suggestionId) {
  try {
    const response = await fetch(`/api/v1/assets/${assetId}/suggestions/${suggestionId}/upvote`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Suggestion upvoted!', 'success');
      viewDetails(assetId); // Refresh the modal
    } else {
      showAlert(data.error || 'Failed to upvote', 'error');
    }
  } catch (error) {
    console.error('Error upvoting suggestion:', error);
    showAlert('An error occurred', 'error');
  }
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

// Close modal when clicking outside
window.onclick = function(event) {
  const modal = document.getElementById('assetModal');
  if (event.target === modal) {
    closeModal();
  }
}
