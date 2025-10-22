/**
 * Enhanced Asset Builder Client Script
 * Supports stats, lore, and community features
 */

let pixelEditor = null;
let currentAssetId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Initialize pixel editor
  pixelEditor = new PixelEditor('pixelEditorContainer', {
    gridSize: 32,
    pixelSize: 12,
    defaultColor: '#000000'
  });

  // Setup file upload previews
  setupFilePreview('pixelArtFile', 'pixelArtPreview');
  setupFilePreview('fullscreenFile', 'fullscreenPreview');
  setupFilePreview('indexCardFile', 'indexCardPreview');

  // Setup form handlers
  document.getElementById('resetBtn').addEventListener('click', resetForm);
  document.getElementById('saveDraftBtn').addEventListener('click', saveDraft);
  document.getElementById('submitBtn').addEventListener('click', submitForApproval);

  // Setup asset type change handler
  document.getElementById('assetType').addEventListener('change', handleAssetTypeChange);

  // Load user's assets
  loadAssets();
});

/**
 * Setup file upload preview
 */
function setupFilePreview(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        preview.innerHTML = `
          <img src="${event.target.result}" class="preview-image" alt="Preview">
          <p class="file-info">${file.name} (${(file.size / 1024).toFixed(2)} KB)</p>
        `;
      };
      reader.readAsDataURL(file);
    }
  });
}

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
 * Handle asset type change - show/hide type-specific fields
 */
function handleAssetTypeChange(e) {
  const assetType = e.target.value;
  const container = document.getElementById('typeSpecificFields');

  // Clear existing fields
  container.innerHTML = '';

  if (!assetType) return;

  let fieldsHTML = '<div class="form-section"><h3>Type-Specific Properties</h3>';

  switch(assetType) {
    case 'environment':
      fieldsHTML += `
        <div class="form-group">
          <label for="environmentType">Environment Type *</label>
          <select id="environmentType" name="environmentType">
            <option value="">Select Environment Type</option>
            <option value="planet">Planet</option>
            <option value="moon">Moon</option>
            <option value="station">Space Station</option>
            <option value="asteroid">Asteroid</option>
            <option value="nebula">Nebula</option>
            <option value="ship">Ship Interior</option>
            <option value="habitat">Habitat</option>
            <option value="void">Void Space</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label for="climate">Climate</label>
          <input type="text" id="climate" name="climate" placeholder="e.g., Arid, Tropical, Frozen, Volcanic">
        </div>
        <div class="form-group">
          <label for="atmosphere">Atmosphere</label>
          <input type="text" id="atmosphere" name="atmosphere" placeholder="e.g., Breathable, Toxic, None, Thin">
        </div>
        <div class="form-group">
          <label for="gravity">Gravity</label>
          <input type="text" id="gravity" name="gravity" placeholder="e.g., Low (0.3g), Normal (1g), High (2.5g)">
        </div>
        <div class="form-group">
          <label for="resources">Resources (comma-separated)</label>
          <input type="text" id="resources" name="resources" placeholder="e.g., Water, Minerals, Fuel, Exotic Matter">
        </div>
      `;
      break;

    case 'object':
      fieldsHTML += `
        <div class="form-group">
          <label for="objectType">Object Type *</label>
          <select id="objectType" name="objectType">
            <option value="">Select Object Type</option>
            <option value="furniture">Furniture</option>
            <option value="decoration">Decoration</option>
            <option value="tool">Tool</option>
            <option value="machine">Machine</option>
            <option value="weapon">Weapon</option>
            <option value="container">Container</option>
            <option value="terminal">Terminal/Console</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="isInteractive" name="isInteractive">
            Is Interactive
          </label>
        </div>
        <div class="form-group" id="interactionTypeGroup" style="display: none;">
          <label for="interactionType">Interaction Type</label>
          <input type="text" id="interactionType" name="interactionType" placeholder="e.g., Open, Use, Activate, Examine">
        </div>
      `;
      break;

    case 'weapon':
    case 'armor':
    case 'item':
    case 'consumable':
      fieldsHTML += `
        <div class="form-group">
          <label for="buffs">
            Buffs/Effects (JSON array)
            <a href="/help/asset-json-guide#buffs" target="_blank" class="help-link" title="View JSON format guide">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom;">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM8 7a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V8a1 1 0 0 0-1-1zm0-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
              </svg>
            </a>
          </label>
          <textarea id="buffs" name="buffs" rows="3" placeholder='[{"type": "health", "value": 10, "duration": 60}]'></textarea>
          <small>Special effects this item provides when used/equipped</small>
        </div>
      `;
      break;

    case 'character':
      fieldsHTML += `
        <div class="form-group">
          <label for="characterBuffs">
            Character Traits (JSON array)
            <a href="/help/asset-json-guide#buffs" target="_blank" class="help-link" title="View JSON format guide">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom;">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM8 7a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V8a1 1 0 0 0-1-1zm0-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
              </svg>
            </a>
          </label>
          <textarea id="characterBuffs" name="buffs" rows="3" placeholder='[{"type": "defense", "value": 5}]'></textarea>
          <small>Innate character abilities and traits</small>
        </div>
      `;
      break;

    case 'species':
      fieldsHTML += `
        <div class="form-group">
          <label for="speciesBuffs">
            Racial Traits (JSON array)
            <a href="/help/asset-json-guide#buffs" target="_blank" class="help-link" title="View JSON format guide">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom;">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM8 7a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V8a1 1 0 0 0-1-1zm0-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
              </svg>
            </a>
          </label>
          <textarea id="speciesBuffs" name="buffs" rows="3" placeholder='[{"type": "night_vision", "value": 1}, {"type": "radiation_resistance", "value": 50}]'></textarea>
          <small>Species-specific abilities and resistances</small>
        </div>
      `;
      break;
  }

  fieldsHTML += '</div>';
  container.innerHTML = fieldsHTML;

  // Add event listeners for conditional fields
  setupConditionalFields(assetType);
}

/**
 * Setup conditional field visibility
 */
function setupConditionalFields(assetType) {
  if (assetType === 'object') {
    const isInteractive = document.getElementById('isInteractive');
    const interactionTypeGroup = document.getElementById('interactionTypeGroup');

    if (isInteractive && interactionTypeGroup) {
      isInteractive.addEventListener('change', (e) => {
        interactionTypeGroup.style.display = e.target.checked ? 'block' : 'none';
      });
    }
  }
}

/**
 * Collect stats from form
 */
function collectStats() {
  const stats = {};

  // Collect all stat fields
  const statFields = [
    'damage', 'defense', 'accuracy', 'critChance',
    'health', 'energy', 'speed', 'weight',
    'value', 'durability', 'range', 'fireRate',
    'capacity', 'level'
  ];

  statFields.forEach(field => {
    const value = document.getElementById(`stat_${field}`)?.value;
    if (value && value !== '' && value !== '0') {
      stats[field] = parseFloat(value);
    }
  });

  return stats;
}

/**
 * Collect effects from form
 */
function collectEffects() {
  const effectsText = document.getElementById('effects').value;
  if (!effectsText.trim()) return [];

  return effectsText.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/**
 * Save as draft
 */
async function saveDraft() {
  try {
    const formData = await buildFormData('draft');
    const method = currentAssetId ? 'PUT' : 'POST';
    const url = currentAssetId ? `/api/v1/assets/${currentAssetId}` : '/api/v1/assets';

    const response = await fetch(url, {
      method: method,
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Asset saved as draft!', 'success');
      currentAssetId = data.asset._id;
      loadAssets();
    } else {
      showAlert(data.error || 'Failed to save asset', 'error');
    }
  } catch (error) {
    console.error('Error saving draft:', error);
    showAlert('An error occurred while saving', 'error');
  }
}

/**
 * Submit for approval
 */
async function submitForApproval() {
  try {
    // First save as draft if not already saved
    if (!currentAssetId) {
      await saveDraft();
      // Wait a moment for the save to complete
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Then submit
    const response = await fetch(`/api/v1/assets/${currentAssetId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Asset submitted for approval!', 'success');
      loadAssets();
      resetForm();
    } else {
      showAlert(data.error || 'Failed to submit asset', 'error');
    }
  } catch (error) {
    console.error('Error submitting asset:', error);
    showAlert('An error occurred while submitting', 'error');
  }
}

/**
 * Build FormData object from form
 */
async function buildFormData(status) {
  const formData = new FormData();

  // Basic fields
  formData.append('title', document.getElementById('title').value);
  formData.append('description', document.getElementById('description').value);
  formData.append('assetType', document.getElementById('assetType').value);
  formData.append('rarity', document.getElementById('rarity').value);
  formData.append('status', status);

  // Tags
  const tagsValue = document.getElementById('tags').value;
  if (tagsValue) {
    const tags = tagsValue.split(',').map(t => t.trim()).filter(t => t);
    formData.append('tags', JSON.stringify(tags));
  }

  // Lore fields
  formData.append('lore', document.getElementById('lore').value);
  formData.append('backstory', document.getElementById('backstory').value);
  formData.append('flavor', document.getElementById('flavor').value);

  // Stats
  const stats = collectStats();
  formData.append('stats', JSON.stringify(stats));

  // Effects
  const effects = collectEffects();
  formData.append('effects', JSON.stringify(effects));

  // Stackable
  formData.append('stackable', document.getElementById('stackable').value);
  formData.append('maxStack', document.getElementById('maxStack').value);

  // Type-specific fields
  const assetType = document.getElementById('assetType').value;
  const typeSpecificData = getTypeSpecificData(assetType);
  for (const [key, value] of Object.entries(typeSpecificData)) {
    if (value !== null && value !== undefined) {
      if (typeof value === 'object') {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, value);
      }
    }
  }

  // Pixel editor data
  const pixelData = pixelEditor.getData();
  formData.append('pixelData', JSON.stringify(pixelData));

  // Add pixel art from editor as blob if no file uploaded
  const pixelArtFile = document.getElementById('pixelArtFile').files[0];
  if (!pixelArtFile) {
    const pixelBlob = await pixelEditor.exportToBlob();
    formData.append('pixelArt', pixelBlob, 'pixel-art.png');
  } else {
    formData.append('pixelArt', pixelArtFile);
  }

  // File uploads
  const fullscreenFile = document.getElementById('fullscreenFile').files[0];
  if (fullscreenFile) {
    formData.append('fullscreen', fullscreenFile);
  }

  const indexCardFile = document.getElementById('indexCardFile').files[0];
  if (indexCardFile) {
    formData.append('indexCard', indexCardFile);
  }

  return formData;
}

/**
 * Get type-specific data based on asset type
 */
function getTypeSpecificData(assetType) {
  const data = {};

  switch(assetType) {
    case 'environment':
      const environmentType = document.getElementById('environmentType');
      const climate = document.getElementById('climate');
      const atmosphere = document.getElementById('atmosphere');
      const gravity = document.getElementById('gravity');
      const resources = document.getElementById('resources');

      if (environmentType) data.environmentType = environmentType.value;
      if (climate) data.climate = climate.value;
      if (atmosphere) data.atmosphere = atmosphere.value;
      if (gravity) data.gravity = gravity.value;
      if (resources && resources.value) {
        data.resources = resources.value.split(',').map(r => r.trim()).filter(r => r);
      }
      break;

    case 'object':
      const objectType = document.getElementById('objectType');
      const isInteractive = document.getElementById('isInteractive');
      const interactionType = document.getElementById('interactionType');

      if (objectType) data.objectType = objectType.value;
      if (isInteractive) data.isInteractive = isInteractive.checked;
      if (interactionType && isInteractive?.checked) data.interactionType = interactionType.value;
      break;

    case 'weapon':
    case 'armor':
    case 'item':
    case 'consumable':
      const buffs = document.getElementById('buffs');
      if (buffs && buffs.value) {
        try {
          data.buffs = JSON.parse(buffs.value);
        } catch(e) {
          console.error('Invalid buffs JSON:', e);
        }
      }
      break;

    case 'character':
      const charBuffs = document.getElementById('characterBuffs');
      if (charBuffs && charBuffs.value) {
        try {
          data.buffs = JSON.parse(charBuffs.value);
        } catch(e) {
          console.error('Invalid character buffs JSON:', e);
        }
      }
      break;

    case 'species':
      const speciesBuffs = document.getElementById('speciesBuffs');
      if (speciesBuffs && speciesBuffs.value) {
        try {
          data.buffs = JSON.parse(speciesBuffs.value);
        } catch(e) {
          console.error('Invalid species buffs JSON:', e);
        }
      }
      break;
  }

  return data;
}

/**
 * Load user's assets
 */
async function loadAssets() {
  try {
    const response = await fetch('/api/v1/assets');
    const data = await response.json();

    if (data.success) {
      displayAssets(data.assets);
    } else {
      showAlert('Failed to load assets', 'error');
    }
  } catch (error) {
    console.error('Error loading assets:', error);
    showAlert('An error occurred while loading assets', 'error');
  }
}

/**
 * Display assets in list
 */
function displayAssets(assets) {
  const assetList = document.getElementById('assetList');

  if (assets.length === 0) {
    assetList.innerHTML = '<p>No assets yet. Create your first one!</p>';
    return;
  }

  assetList.innerHTML = assets.map(asset => {
    const statsCount = Object.keys(asset.stats || {}).length;
    const effectsCount = (asset.effects || []).length;

    return `
    <div class="asset-card">
      <img src="${asset.images.indexCard || asset.images.fullscreen || '/images/placeholder.png'}"
           alt="${asset.title}"
           class="asset-card-image">
      <div class="asset-card-content">
        <h3 class="asset-card-title">${asset.title}</h3>
        <p class="asset-card-description">${asset.description || 'No description'}</p>
        <div class="asset-card-meta">
          <span class="asset-status ${asset.status}">${asset.status}</span>
          <span>${asset.assetType}</span>
        </div>
        ${asset.rarity ? `<div style="margin: 0.5rem 0;"><span class="badge rarity-${asset.rarity}">${asset.rarity}</span></div>` : ''}
        ${statsCount > 0 ? `<div style="font-size: 0.85rem; color: #666; margin: 0.5rem 0;">📊 ${statsCount} stats</div>` : ''}
        ${effectsCount > 0 ? `<div style="font-size: 0.85rem; color: #666; margin: 0.5rem 0;">✨ ${effectsCount} effects</div>` : ''}
        ${asset.adminNotes ? `
          <div class="alert alert-info" style="margin-bottom: 1rem; padding: 0.5rem; font-size: 0.875rem;">
            <strong>Admin Notes:</strong> ${asset.adminNotes}
          </div>
        ` : ''}
        <div class="asset-card-actions">
          ${asset.status === 'draft' || asset.status === 'rejected' ? `
            <button class="btn btn-secondary btn-sm" onclick="editAsset('${asset._id}')">Edit</button>
          ` : ''}
          ${asset.status === 'draft' ? `
            <button class="btn btn-success btn-sm" onclick="submitAsset('${asset._id}')">Submit</button>
          ` : ''}
          ${asset.status === 'approved' ? `
            <span class="vote-count">👍 ${asset.votes} votes</span>
          ` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteAsset('${asset._id}')">Delete</button>
        </div>
      </div>
    </div>
  `}).join('');
}

/**
 * Edit asset
 */
async function editAsset(assetId) {
  try {
    const response = await fetch(`/api/v1/assets/${assetId}`);
    const data = await response.json();

    if (data.success) {
      const asset = data.asset;
      currentAssetId = assetId;

      // Fill basic fields
      document.getElementById('title').value = asset.title;
      document.getElementById('description').value = asset.description || '';
      document.getElementById('assetType').value = asset.assetType;
      document.getElementById('rarity').value = asset.rarity || '';

      // Fill tags
      if (asset.tags && asset.tags.length > 0) {
        document.getElementById('tags').value = asset.tags.join(', ');
      }

      // Fill lore fields
      document.getElementById('lore').value = asset.lore || '';
      document.getElementById('backstory').value = asset.backstory || '';
      document.getElementById('flavor').value = asset.flavor || '';

      // Fill stats
      if (asset.stats) {
        Object.keys(asset.stats).forEach(key => {
          const field = document.getElementById(`stat_${key}`);
          if (field) {
            field.value = asset.stats[key];
          }
        });
      }

      // Fill effects
      if (asset.effects && asset.effects.length > 0) {
        document.getElementById('effects').value = asset.effects.join('\n');
      }

      // Fill stackable
      document.getElementById('stackable').value = asset.stackable ? 'true' : 'false';
      document.getElementById('maxStack').value = asset.maxStack || 1;

      // Load pixel data
      if (asset.pixelData) {
        pixelEditor.loadData(asset.pixelData);
      }

      // Scroll to form
      document.getElementById('assetForm').scrollIntoView({ behavior: 'smooth' });
      showAlert('Asset loaded for editing', 'info');
    }
  } catch (error) {
    console.error('Error loading asset:', error);
    showAlert('Failed to load asset', 'error');
  }
}

/**
 * Submit asset for approval
 */
async function submitAsset(assetId) {
  if (!confirm('Submit this asset for approval?')) return;

  try {
    const response = await fetch(`/api/v1/assets/${assetId}/submit`, {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Asset submitted for approval!', 'success');
      loadAssets();
    } else {
      showAlert(data.error || 'Failed to submit', 'error');
    }
  } catch (error) {
    console.error('Error submitting asset:', error);
    showAlert('An error occurred', 'error');
  }
}

/**
 * Delete asset
 */
async function deleteAsset(assetId) {
  if (!confirm('Are you sure you want to delete this asset? This cannot be undone.')) return;

  try {
    const response = await fetch(`/api/v1/assets/${assetId}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Asset deleted', 'success');
      loadAssets();

      if (currentAssetId === assetId) {
        resetForm();
      }
    } else {
      showAlert(data.error || 'Failed to delete', 'error');
    }
  } catch (error) {
    console.error('Error deleting asset:', error);
    showAlert('An error occurred', 'error');
  }
}

/**
 * Reset form
 */
function resetForm() {
  if (!confirm('Clear all form data?')) return;

  document.getElementById('builderForm').reset();
  document.getElementById('pixelArtPreview').innerHTML = '';
  document.getElementById('fullscreenPreview').innerHTML = '';
  document.getElementById('indexCardPreview').innerHTML = '';
  pixelEditor.clear();
  currentAssetId = null;
  showAlert('Form reset', 'info');
}
