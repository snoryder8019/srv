/**
 * My Assets Management
 * View and manage user's assets and suggestions
 */

let userAssets = [];

document.addEventListener('DOMContentLoaded', () => {
  loadUserAssets();
});

async function loadUserAssets() {
  try {
    const response = await fetch('/api/v1/assets', {
      credentials: 'same-origin'
    });

    if (!response.ok) {
      throw new Error('Failed to load assets');
    }

    const data = await response.json();
    userAssets = data.assets || [];

    displayAssets();
  } catch (error) {
    console.error('Error loading assets:', error);
    showAlert('Failed to load your assets', 'error');
  }
}

function displayAssets() {
  const container = document.getElementById('myAssetsContainer');

  if (userAssets.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 3rem;">' +
      '<p style="color: #888; font-size: 1.125rem;">You haven\'t created any assets yet.</p>' +
      '<a href="/assets" class="btn btn-primary" style="margin-top: 1rem;">Create Your First Asset</a>' +
    '</div>';
    return;
  }

  container.innerHTML = '<div class="assets-grid">' +
    userAssets.map(asset => createAssetCard(asset)).join('') +
  '</div>';
}

function createAssetCard(asset) {
  let imageUrl = 'data:image/svg+xml,%3Csvg%20width%3D%22400%22%20height%3D%22400%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%22400%22%20height%3D%22400%22%20fill%3D%22%23e5e7eb%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%20font-family%3D%22Arial%22%20font-size%3D%2224%22%20fill%3D%22%239ca3af%22%3ENo%20Image%3C%2Ftext%3E%3C%2Fsvg%3E';

  if (asset.images) {
    if (asset.images.pixelArt) {
      imageUrl = asset.images.pixelArt;
    }
  }

  const assetName = asset.title || asset.name || 'Untitled';
  const assetType = asset.assetType || asset.type || 'unknown';
  const typeSpecificInfo = formatTypeSpecificInfo(asset);

  const pendingSuggestions = asset.suggestions ? asset.suggestions.filter(s => s.status === 'pending').length : 0;

  let statusBadge = '';
  if (asset.status === 'draft') {
    statusBadge = '<span class="status-badge status-draft">Draft</span>';
  } else if (asset.status === 'submitted') {
    statusBadge = '<span class="status-badge status-submitted">Pending Review</span>';
  } else if (asset.status === 'approved') {
    statusBadge = '<span class="status-badge status-approved">Approved</span>';
  }

  return '<div class="asset-card my-asset-card">' +
    '<img class="asset-card-image" src="' + imageUrl + '" alt="' + assetName + '">' +
    '<div class="asset-card-content">' +
      '<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">' +
        '<h3 class="asset-card-title" style="margin: 0;">' + assetName + '</h3>' +
        statusBadge +
      '</div>' +
      '<p class="asset-card-description">' + (asset.description || 'No description') + '</p>' +
      (typeSpecificInfo ? '<div style="margin: 0.5rem 0; padding: 0.5rem; background: #f9fafb; border-radius: 4px; font-size: 0.875rem;">' + typeSpecificInfo + '</div>' : '') +
      '<div class="asset-card-meta">' +
        '<span class="asset-type-badge">' + assetType + '</span>' +
        (pendingSuggestions > 0 ?
          '<span class="suggestions-badge">' + pendingSuggestions + ' pending suggestion' + (pendingSuggestions !== 1 ? 's' : '') + '</span>' :
          '<span style="color: #888; font-size: 0.875rem;">No pending suggestions</span>') +
      '</div>' +
      '<div class="asset-card-actions" style="margin-top: 1rem;">' +
        '<button class="btn btn-primary" onclick="viewAssetDetails(\'' + asset._id + '\')" style="width: 100%;">✏️ Edit</button>' +
        (pendingSuggestions > 0 ?
          '<button class="btn btn-secondary" onclick="viewSuggestions(\'' + asset._id + '\')" style="width: 100%; margin-top: 0.5rem;">Review Suggestions (' + pendingSuggestions + ')</button>' :
          '') +
      '</div>' +
    '</div>' +
  '</div>';
}

function viewAssetDetails(assetId) {
  const asset = userAssets.find(a => a._id === assetId);

  if (!asset) {
    showAlert('Asset not found', 'error');
    return;
  }

  // Route to appropriate editor based on asset type
  let editorUrl;

  switch(asset.assetType) {
    case 'zone':
      // Zone interior editor (in universe routes)
      editorUrl = `/universe/interior-map-builder?zoneId=${assetId}`;
      break;

    case 'sprite':
      // Sprite/pixel art builder
      editorUrl = `/assets/builder?assetId=${assetId}`;
      break;

    case 'planet':
    case 'galaxy':
    case 'star':
    case 'anomaly':
    case 'anomoly':
    case 'station':
    case 'starship':
    case 'orbital':
    case 'asteroid':
    case 'nebula':
    case 'localGroup':
      // Enhanced asset builder for celestial objects
      editorUrl = `/assets/builder-enhanced?assetId=${assetId}`;
      break;

    case 'environment':
    case 'object':
    case 'item':
    case 'weapon':
    case 'armor':
    case 'consumable':
    case 'character':
    case 'species':
    case 'npc':
    case 'quest':
    case 'location':
    case 'arc':
    default:
      // Enhanced builder for all other types
      editorUrl = `/assets/builder-enhanced?assetId=${assetId}`;
      break;
  }

  console.log(`📝 Opening editor for ${asset.assetType}: ${editorUrl}`);
  window.location.href = editorUrl;
}

function viewSuggestions(assetId) {
  const asset = userAssets.find(a => a._id === assetId);

  if (!asset) {
    return;
  }

  const pendingSuggestions = asset.suggestions ? asset.suggestions.filter(s => s.status === 'pending') : [];

  if (pendingSuggestions.length === 0) {
    showAlert('No pending suggestions for this asset', 'info');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'suggestionsModal';

  modal.innerHTML = '<div class="modal-content" style="max-width: 900px;">' +
    '<div class="modal-header">' +
      '<h2>Suggestions for ' + (asset.title || asset.name) + '</h2>' +
      '<button class="modal-close" onclick="closeSuggestionsModal()">&times;</button>' +
    '</div>' +
    '<div style="padding: 1.5rem;">' +
      pendingSuggestions.map(suggestion => createSuggestionCard(suggestion, assetId, asset)).join('') +
    '</div>' +
  '</div>';

  document.body.appendChild(modal);
}

function createSuggestionCard(suggestion, assetId, currentAsset) {
  const hasFieldChanges = suggestion.fieldChanges && Object.keys(suggestion.fieldChanges).length > 0;
  const hasImages = suggestion.images && Object.keys(suggestion.images).length > 0;

  return '<div class="suggestion-card" style="background: white; border: 2px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem;">' +
    '<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">' +
      '<div>' +
        '<h3 style="margin: 0 0 0.5rem 0;">Suggestion by ' + suggestion.username + '</h3>' +
        '<p style="color: #888; font-size: 0.875rem; margin: 0;">' + new Date(suggestion.createdAt).toLocaleDateString() + '</p>' +
      '</div>' +
      '<div style="display: flex; gap: 0.5rem;">' +
        '<button class="btn btn-primary" onclick="approveSuggestion(\'' + assetId + '\', \'' + suggestion._id + '\')">Approve</button>' +
        '<button class="btn btn-secondary" onclick="rejectSuggestion(\'' + assetId + '\', \'' + suggestion._id + '\')">Reject</button>' +
      '</div>' +
    '</div>' +

    (suggestion.text ? '<div style="margin-bottom: 1rem;"><strong>Description:</strong><p style="margin: 0.5rem 0;">' + suggestion.text + '</p></div>' : '') +

    (hasFieldChanges ?
      '<div style="margin-bottom: 1rem;">' +
        '<strong>Proposed Field Changes:</strong>' +
        '<div style="margin-top: 0.5rem;">' +
          Object.entries(suggestion.fieldChanges).map(([field, value]) => {
            const currentValue = currentAsset[field] || 'Not set';
            return '<div style="background: #f9fafb; padding: 0.75rem; border-radius: 4px; margin-bottom: 0.5rem;">' +
              '<div style="font-weight: 500; color: #374151;">' + field.charAt(0).toUpperCase() + field.slice(1) + '</div>' +
              '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.5rem;">' +
                '<div>' +
                  '<div style="font-size: 0.75rem; color: #888; margin-bottom: 0.25rem;">Current</div>' +
                  '<div style="color: #6b7280;">' + currentValue + '</div>' +
                '</div>' +
                '<div>' +
                  '<div style="font-size: 0.75rem; color: #888; margin-bottom: 0.25rem;">Suggested</div>' +
                  '<div style="color: #10b981; font-weight: 500;">' + value + '</div>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' : '') +

    (hasImages ?
      '<div>' +
        '<strong>Proposed Images:</strong>' +
        '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 0.5rem;">' +
          Object.entries(suggestion.images).map(([type, url]) =>
            '<div style="border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.5rem;">' +
              '<div style="font-weight: 500; margin-bottom: 0.5rem;">' + type + '</div>' +
              '<img src="' + url + '" style="width: 100%; height: auto; border-radius: 4px;">' +
            '</div>'
          ).join('') +
        '</div>' +
      '</div>' : '') +
  '</div>';
}

function closeSuggestionsModal() {
  const modal = document.getElementById('suggestionsModal');
  if (modal) {
    modal.remove();
  }
}

async function approveSuggestion(assetId, suggestionId) {
  if (!confirm('Approve this suggestion? The changes will be applied to your asset.')) {
    return;
  }

  try {
    const response = await fetch('/api/v1/assets/' + assetId + '/suggestions/' + suggestionId + '/approve', {
      method: 'POST',
      credentials: 'same-origin'
    });

    const data = await response.json();

    if (response.ok) {
      showAlert('Suggestion approved and applied!', 'success');
      closeSuggestionsModal();
      loadUserAssets();
    } else {
      showAlert('Error: ' + (data.error || 'Failed to approve suggestion'), 'error');
    }
  } catch (error) {
    console.error('Error approving suggestion:', error);
    showAlert('Failed to approve suggestion', 'error');
  }
}

async function rejectSuggestion(assetId, suggestionId) {
  const reason = prompt('Reason for rejection (optional):');

  if (reason === null) {
    return;
  }

  try {
    const response = await fetch('/api/v1/assets/' + assetId + '/suggestions/' + suggestionId + '/reject', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason: reason || 'No reason provided' })
    });

    const data = await response.json();

    if (response.ok) {
      showAlert('Suggestion rejected', 'success');
      closeSuggestionsModal();
      loadUserAssets();
    } else {
      showAlert('Error: ' + (data.error || 'Failed to reject suggestion'), 'error');
    }
  } catch (error) {
    console.error('Error rejecting suggestion:', error);
    showAlert('Failed to reject suggestion', 'error');
  }
}

function showAlert(message, type) {
  const container = document.getElementById('alertContainer');
  const alert = document.createElement('div');
  alert.className = 'alert alert-' + type;
  alert.textContent = message;
  alert.style.padding = '1rem';
  alert.style.borderRadius = '4px';
  alert.style.marginBottom = '1rem';

  if (type === 'success') {
    alert.style.background = '#d1fae5';
    alert.style.color = '#065f46';
    alert.style.border = '1px solid #10b981';
  } else if (type === 'error') {
    alert.style.background = '#fee2e2';
    alert.style.color = '#991b1b';
    alert.style.border = '1px solid #ef4444';
  } else {
    alert.style.background = '#dbeafe';
    alert.style.color = '#1e40af';
    alert.style.border = '1px solid #3b82f6';
  }

  container.appendChild(alert);

  setTimeout(() => {
    alert.remove();
  }, 5000);
}

/**
 * Format type-specific information for display
 */
function formatTypeSpecificInfo(asset) {
  const parts = [];

  switch(asset.assetType) {
    case 'environment':
      if (asset.environmentType) {
        parts.push('<strong>Type:</strong> ' + capitalizeFirst(asset.environmentType));
      }
      if (asset.climate) {
        parts.push('<strong>Climate:</strong> ' + asset.climate);
      }
      if (asset.atmosphere) {
        parts.push('<strong>Atmosphere:</strong> ' + asset.atmosphere);
      }
      if (asset.gravity) {
        parts.push('<strong>Gravity:</strong> ' + asset.gravity);
      }
      if (asset.resources && asset.resources.length > 0) {
        parts.push('<strong>Resources:</strong> ' + asset.resources.join(', '));
      }
      break;

    case 'object':
      if (asset.objectType) {
        parts.push('<strong>Type:</strong> ' + capitalizeFirst(asset.objectType));
      }
      if (asset.isInteractive) {
        parts.push('<strong>Interactive:</strong> ' + (asset.interactionType || 'Yes'));
      }
      break;

    case 'item':
    case 'weapon':
    case 'armor':
    case 'consumable':
      if (asset.rarity) {
        parts.push('<strong>Rarity:</strong> ' + capitalizeFirst(asset.rarity));
      }
      if (asset.stackable) {
        parts.push('<strong>Stackable:</strong> ' + (asset.maxStack || 1));
      }
      if (asset.buffs && asset.buffs.length > 0) {
        parts.push('<strong>Buffs:</strong> ' + asset.buffs.length + ' effect(s)');
      }
      break;

    case 'character':
    case 'species':
      if (asset.buffs && asset.buffs.length > 0) {
        parts.push('<strong>Traits:</strong> ' + asset.buffs.length + ' special trait(s)');
      }
      if (asset.stats && Object.keys(asset.stats).length > 0) {
        const statCount = Object.keys(asset.stats).length;
        parts.push('<strong>Stats:</strong> ' + statCount + ' stat(s) defined');
      }
      break;
  }

  return parts.length > 0 ? parts.join(' &bull; ') : '';
}

/**
 * Capitalize first letter of string
 */
function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
