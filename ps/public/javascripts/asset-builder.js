/**
 * Asset Builder Client Script
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
  document.getElementById('saveDraftBtn').addEventListener('click', saveDraft);
  document.getElementById('submitBtn').addEventListener('click', submitForApproval);

  // Setup asset type change handler
  document.getElementById('assetType').addEventListener('change', handleAssetTypeChange);

  // Load user's assets
  loadAssets();
});

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
            <option value="ship">Ship Interior</option>
            <option value="habitat">Habitat</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label for="climate">Climate</label>
          <input type="text" id="climate" name="climate" placeholder="e.g., Arid, Tropical, Frozen">
        </div>
        <div class="form-group">
          <label for="atmosphere">Atmosphere</label>
          <input type="text" id="atmosphere" name="atmosphere" placeholder="e.g., Breathable, Toxic, None">
        </div>
        <div class="form-group">
          <label for="gravity">Gravity</label>
          <input type="text" id="gravity" name="gravity" placeholder="e.g., Low, Normal, High">
        </div>
        <div class="form-group">
          <label for="resources">Resources (comma-separated)</label>
          <input type="text" id="resources" name="resources" placeholder="e.g., Water, Minerals, Fuel">
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
          <input type="text" id="interactionType" name="interactionType" placeholder="e.g., Open, Use, Activate">
        </div>
      `;
      break;

    case 'item':
      fieldsHTML += `
        <div class="form-group">
          <label for="rarity">Rarity</label>
          <select id="rarity" name="rarity">
            <option value="">Select Rarity</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="epic">Epic</option>
            <option value="legendary">Legendary</option>
          </select>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="stackable" name="stackable">
            Stackable
          </label>
        </div>
        <div class="form-group" id="maxStackGroup" style="display: none;">
          <label for="maxStack">Max Stack Size</label>
          <input type="number" id="maxStack" name="maxStack" value="1" min="1">
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="tradeable" name="tradeable" checked>
            Tradeable
          </label>
        </div>
        <div class="form-group">
          <label for="buffs">
            Buffs (JSON array)
            <a href="/help/asset-json-guide#buffs" target="_blank" class="help-link" title="View JSON format guide">ℹ️</a>
          </label>
          <textarea id="buffs" name="buffs" placeholder='[{"type": "health", "value": 10}]'></textarea>
        </div>
        <div class="form-group">
          <label for="effects">
            Effects (JSON array)
            <a href="/help/asset-json-guide#effects" target="_blank" class="help-link" title="View JSON format guide">ℹ️</a>
          </label>
          <textarea id="effects" name="effects" placeholder='[{"type": "heal", "duration": 5}]'></textarea>
        </div>
      `;
      break;

    case 'character':
    case 'npc':
      fieldsHTML += `
        <div class="form-group">
          <label for="stats">
            Stats (JSON object)
            <a href="/help/asset-json-guide#stats" target="_blank" class="help-link" title="View JSON format guide">ℹ️</a>
          </label>
          <textarea id="stats" name="stats" placeholder='{"health": 100, "strength": 10, "speed": 5}'></textarea>
        </div>
        <div class="form-group">
          <label for="buffs">
            Buffs (JSON array)
            <a href="/help/asset-json-guide#buffs" target="_blank" class="help-link" title="View JSON format guide">ℹ️</a>
          </label>
          <textarea id="buffs" name="buffs" placeholder='[{"type": "defense", "value": 5}]'></textarea>
        </div>
        <div class="form-group">
          <label for="backstory">Backstory</label>
          <textarea id="backstory" name="backstory"></textarea>
        </div>
      `;
      break;

    case 'species':
      fieldsHTML += `
        <div class="form-group">
          <label for="stats">
            Base Stats (JSON object)
            <a href="/help/asset-json-guide#stats" target="_blank" class="help-link" title="View JSON format guide">ℹ️</a>
          </label>
          <textarea id="stats" name="stats" placeholder='{"health": 100, "strength": 10}'></textarea>
        </div>
        <div class="form-group">
          <label for="buffs">
            Racial Traits (JSON array)
            <a href="/help/asset-json-guide#buffs" target="_blank" class="help-link" title="View JSON format guide">ℹ️</a>
          </label>
          <textarea id="buffs" name="buffs" placeholder='[{"type": "night_vision", "value": 1}]'></textarea>
        </div>
        <div class="form-group">
          <label for="lore">Lore</label>
          <textarea id="lore" name="lore"></textarea>
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

  if (assetType === 'item') {
    const stackable = document.getElementById('stackable');
    const maxStackGroup = document.getElementById('maxStackGroup');

    if (stackable && maxStackGroup) {
      stackable.addEventListener('change', (e) => {
        maxStackGroup.style.display = e.target.checked ? 'block' : 'none';
      });
    }
  }
}

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
  const assetType = document.getElementById('assetType').value;
  formData.append('assetType', assetType);
  formData.append('status', status);

  // Type-specific fields
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
      if (interactionType && isInteractive.checked) data.interactionType = interactionType.value;
      break;

    case 'item':
      const rarity = document.getElementById('rarity');
      const stackable = document.getElementById('stackable');
      const maxStack = document.getElementById('maxStack');
      const tradeable = document.getElementById('tradeable');
      const buffs = document.getElementById('buffs');
      const effects = document.getElementById('effects');

      if (rarity) data.rarity = rarity.value;
      if (stackable) data.stackable = stackable.checked;
      if (maxStack && stackable.checked) data.maxStack = parseInt(maxStack.value);
      if (tradeable) data.tradeable = tradeable.checked;
      if (buffs && buffs.value) {
        try {
          data.buffs = JSON.parse(buffs.value);
        } catch(e) {
          console.error('Invalid buffs JSON:', e);
        }
      }
      if (effects && effects.value) {
        try {
          data.effects = JSON.parse(effects.value);
        } catch(e) {
          console.error('Invalid effects JSON:', e);
        }
      }
      break;

    case 'character':
    case 'npc':
      const stats = document.getElementById('stats');
      const charBuffs = document.getElementById('buffs');
      const backstory = document.getElementById('backstory');

      if (stats && stats.value) {
        try {
          data.stats = JSON.parse(stats.value);
        } catch(e) {
          console.error('Invalid stats JSON:', e);
        }
      }
      if (charBuffs && charBuffs.value) {
        try {
          data.buffs = JSON.parse(charBuffs.value);
        } catch(e) {
          console.error('Invalid buffs JSON:', e);
        }
      }
      if (backstory) data.backstory = backstory.value;
      break;

    case 'species':
      const speciesStats = document.getElementById('stats');
      const speciesBuffs = document.getElementById('buffs');
      const lore = document.getElementById('lore');

      if (speciesStats && speciesStats.value) {
        try {
          data.stats = JSON.parse(speciesStats.value);
        } catch(e) {
          console.error('Invalid stats JSON:', e);
        }
      }
      if (speciesBuffs && speciesBuffs.value) {
        try {
          data.buffs = JSON.parse(speciesBuffs.value);
        } catch(e) {
          console.error('Invalid buffs JSON:', e);
        }
      }
      if (lore) data.lore = lore.value;
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

  assetList.innerHTML = assets.map(asset => `
    <div class="asset-card">
      <img src="${asset.images.indexCard || asset.images.fullscreen || '/images/placeholder.png'}"
           alt="${asset.title}"
           class="asset-card-image">
      <div class="asset-card-content">
        <h3 class="asset-card-title">${asset.title}</h3>
        <p class="asset-card-description">${asset.description || 'No description'}</p>
        <div class="asset-card-meta">
          <span class="asset-status ${asset.status}">${asset.status}</span>
          <span>${new Date(asset.createdAt).toLocaleDateString()}</span>
        </div>
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
  `).join('');
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

      // Fill basic form fields
      document.getElementById('title').value = asset.title;
      document.getElementById('description').value = asset.description || '';
      document.getElementById('assetType').value = asset.assetType;

      // Trigger type-specific fields to show
      handleAssetTypeChange({ target: { value: asset.assetType } });

      // Wait a moment for fields to be created
      setTimeout(() => {
        populateTypeSpecificFields(asset);
      }, 100);

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
 * Populate type-specific fields when editing
 */
function populateTypeSpecificFields(asset) {
  switch(asset.assetType) {
    case 'environment':
      setFieldValue('environmentType', asset.environmentType);
      setFieldValue('climate', asset.climate);
      setFieldValue('atmosphere', asset.atmosphere);
      setFieldValue('gravity', asset.gravity);
      if (asset.resources && Array.isArray(asset.resources)) {
        setFieldValue('resources', asset.resources.join(', '));
      }
      break;

    case 'object':
      setFieldValue('objectType', asset.objectType);
      setCheckboxValue('isInteractive', asset.isInteractive);
      if (asset.isInteractive) {
        document.getElementById('interactionTypeGroup').style.display = 'block';
        setFieldValue('interactionType', asset.interactionType);
      }
      break;

    case 'item':
      setFieldValue('rarity', asset.rarity);
      setCheckboxValue('stackable', asset.stackable);
      if (asset.stackable) {
        document.getElementById('maxStackGroup').style.display = 'block';
        setFieldValue('maxStack', asset.maxStack);
      }
      setCheckboxValue('tradeable', asset.tradeable);
      if (asset.buffs) {
        setFieldValue('buffs', JSON.stringify(asset.buffs, null, 2));
      }
      if (asset.effects) {
        setFieldValue('effects', JSON.stringify(asset.effects, null, 2));
      }
      break;

    case 'character':
    case 'npc':
      if (asset.stats) {
        setFieldValue('stats', JSON.stringify(asset.stats, null, 2));
      }
      if (asset.buffs) {
        setFieldValue('buffs', JSON.stringify(asset.buffs, null, 2));
      }
      setFieldValue('backstory', asset.backstory);
      break;

    case 'species':
      if (asset.stats) {
        setFieldValue('stats', JSON.stringify(asset.stats, null, 2));
      }
      if (asset.buffs) {
        setFieldValue('buffs', JSON.stringify(asset.buffs, null, 2));
      }
      setFieldValue('lore', asset.lore);
      break;
  }
}

/**
 * Helper to set field value safely
 */
function setFieldValue(fieldId, value) {
  const field = document.getElementById(fieldId);
  if (field && value !== null && value !== undefined) {
    field.value = value;
  }
}

/**
 * Helper to set checkbox value safely
 */
function setCheckboxValue(fieldId, value) {
  const field = document.getElementById(fieldId);
  if (field) {
    field.checked = !!value;
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
  document.getElementById('builderForm').reset();
  document.getElementById('pixelArtPreview').innerHTML = '';
  document.getElementById('fullscreenPreview').innerHTML = '';
  document.getElementById('indexCardPreview').innerHTML = '';
  pixelEditor.clear();
  currentAssetId = null;
}
