/**
 * Sprite Creator Client Script
 * Handles JSON import, manual creation, and zone assignment
 */

let currentMode = 'json-import';
let spriteSheetImage = null;
let selectedSprites = new Set();
let collisionBoxState = { x: 0, y: 0, w: 32, h: 32 };

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  setupModeTabs();
  setupJsonImportMode();
  setupManualMode();
  setupZoneAssignMode();
});

/**
 * Setup mode tabs switching
 */
function setupModeTabs() {
  const tabs = document.querySelectorAll('.mode-tab');
  const contents = document.querySelectorAll('.mode-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active content
      contents.forEach(c => c.classList.remove('active'));
      document.getElementById(`${mode}-mode`).classList.add('active');

      currentMode = mode;
    });
  });
}

/**
 * JSON Import Mode Setup
 */
function setupJsonImportMode() {
  const uploadZone = document.getElementById('spriteSheetUploadZone');
  const fileInput = document.getElementById('spriteSheetUpload');
  const jsonTextarea = document.getElementById('jsonDefinition');
  const validateBtn = document.getElementById('validateJsonBtn');
  const importBtn = document.getElementById('importSpritesBtn');

  // File upload via click
  uploadZone.addEventListener('click', () => fileInput.click());

  // Drag and drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleSpriteSheetUpload(file);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleSpriteSheetUpload(e.target.files[0]);
    }
  });

  // Validate JSON button
  validateBtn.addEventListener('click', () => validateJsonDefinition());

  // Import sprites button
  importBtn.addEventListener('click', () => importSprites());
}

/**
 * Handle sprite sheet image upload
 */
function handleSpriteSheetUpload(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById('spriteSheetImg');
    img.src = e.target.result;
    document.getElementById('spriteSheetPreview').style.display = 'block';

    // Store image data
    spriteSheetImage = {
      file: file,
      dataUrl: e.target.result,
      width: 0,
      height: 0
    };

    // Get image dimensions
    const tempImg = new Image();
    tempImg.onload = () => {
      spriteSheetImage.width = tempImg.width;
      spriteSheetImage.height = tempImg.height;
      showAlert(`Sprite sheet loaded: ${tempImg.width}x${tempImg.height}px`, 'success');
    };
    tempImg.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/**
 * Validate JSON definition
 */
function validateJsonDefinition() {
  const jsonText = document.getElementById('jsonDefinition').value;

  if (!jsonText.trim()) {
    showAlert('Please enter a JSON definition', 'warning');
    return false;
  }

  try {
    const data = JSON.parse(jsonText);

    // Validate required fields
    if (!data.name) {
      showAlert('JSON missing required field: name', 'error');
      return false;
    }
    if (!data.tileWidth || !data.tileHeight) {
      showAlert('JSON missing required fields: tileWidth, tileHeight', 'error');
      return false;
    }
    if (!Array.isArray(data.sprites) || data.sprites.length === 0) {
      showAlert('JSON missing or empty sprites array', 'error');
      return false;
    }

    // Validate each sprite
    for (let i = 0; i < data.sprites.length; i++) {
      const sprite = data.sprites[i];
      if (!sprite.name) {
        showAlert(`Sprite ${i} missing required field: name`, 'error');
        return false;
      }
    }

    // Show preview
    showJsonPreview(data);
    showAlert(`✅ Valid JSON! Found ${data.sprites.length} sprites`, 'success');
    return true;

  } catch (error) {
    showAlert(`Invalid JSON: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Show preview of sprites from JSON
 */
function showJsonPreview(data) {
  const previewDiv = document.getElementById('jsonImportPreview');
  const grid = document.getElementById('jsonPreviewGrid');
  const countSpan = document.getElementById('previewCount');

  grid.innerHTML = '';
  countSpan.textContent = data.sprites.length;

  data.sprites.forEach((sprite, index) => {
    const item = document.createElement('div');
    item.className = 'sprite-preview-item';
    item.innerHTML = `
      <div class="sprite-preview-img" style="background: #333; display: flex; align-items: center; justify-content: center;">
        <span style="font-size: 0.75rem;">${index}</span>
      </div>
      <div style="font-size: 0.75rem; margin-top: 0.25rem; overflow: hidden; text-overflow: ellipsis;">
        ${sprite.name}
      </div>
      ${sprite.solid ? '<div style="font-size: 0.6rem; color: #ef4444;">🚫 Solid</div>' : ''}
      ${sprite.interactive ? '<div style="font-size: 0.6rem; color: #10b981;">✨ Interactive</div>' : ''}
    `;
    grid.appendChild(item);
  });

  previewDiv.style.display = 'block';
}

/**
 * Import all sprites from JSON
 */
async function importSprites() {
  if (!spriteSheetImage) {
    showAlert('Please upload a sprite sheet image first', 'warning');
    return;
  }

  if (!validateJsonDefinition()) {
    return;
  }

  const jsonText = document.getElementById('jsonDefinition').value;
  const data = JSON.parse(jsonText);
  const zoneId = document.getElementById('jsonImportZone').value;

  try {
    showAlert('Importing sprites...', 'info');

    // Create FormData for upload
    const formData = new FormData();
    formData.append('spriteSheet', spriteSheetImage.file);
    formData.append('definition', jsonText);
    if (zoneId) formData.append('zoneId', zoneId);

    const response = await fetch('/api/v1/sprites/import', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (result.success) {
      showAlert(`✅ Successfully imported ${result.count} sprites!`, 'success');
      // Clear form
      document.getElementById('spriteSheetUpload').value = '';
      document.getElementById('spriteSheetPreview').style.display = 'none';
      document.getElementById('jsonDefinition').value = '';
      document.getElementById('jsonImportPreview').style.display = 'none';
      spriteSheetImage = null;
    } else {
      showAlert(`Import failed: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error importing sprites:', error);
    showAlert('Failed to import sprites', 'error');
  }
}

/**
 * Manual Mode Setup
 */
function setupManualMode() {
  const form = document.getElementById('manualSpriteForm');
  const sourceSelect = document.getElementById('spriteSource');
  const interactiveCheckbox = document.getElementById('spriteInteractive');
  const resetBtn = document.getElementById('resetManualFormBtn');

  // Toggle source type
  sourceSelect.addEventListener('change', (e) => {
    const uploadGroup = document.getElementById('uploadSourceGroup');
    const sheetGroup = document.getElementById('sheetSourceGroup');

    if (e.target.value === 'upload') {
      uploadGroup.style.display = 'block';
      sheetGroup.style.display = 'none';
    } else {
      uploadGroup.style.display = 'none';
      sheetGroup.style.display = 'block';
    }
  });

  // Toggle interaction type
  interactiveCheckbox.addEventListener('change', (e) => {
    const interactionGroup = document.getElementById('interactionTypeGroup');
    interactionGroup.style.display = e.target.checked ? 'block' : 'none';
  });

  // Setup collision editor
  setupCollisionEditor();

  // Reset button
  resetBtn.addEventListener('click', () => {
    form.reset();
    resetCollisionBox();
  });

  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createManualSprite();
  });
}

/**
 * Setup collision box editor
 */
function setupCollisionEditor() {
  const editor = document.getElementById('collisionEditor');
  const canvas = document.getElementById('collisionCanvas');
  const box = document.getElementById('collisionBox');
  const ctx = canvas.getContext('2d');

  canvas.width = 200;
  canvas.height = 200;

  let drawing = false;
  let startX = 0;
  let startY = 0;

  // Draw grid
  function drawGrid() {
    ctx.clearRect(0, 0, 200, 200);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 200; i += 20) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 200);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(200, i);
      ctx.stroke();
    }
  }

  drawGrid();

  // Mouse events
  editor.addEventListener('mousedown', (e) => {
    const rect = editor.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    drawing = true;
  });

  editor.addEventListener('mousemove', (e) => {
    if (!drawing) return;

    const rect = editor.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    updateCollisionBox(x, y, w, h);
  });

  editor.addEventListener('mouseup', () => {
    drawing = false;
  });

  // Input changes
  ['collisionX', 'collisionY', 'collisionW', 'collisionH'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const x = parseInt(document.getElementById('collisionX').value) || 0;
      const y = parseInt(document.getElementById('collisionY').value) || 0;
      const w = parseInt(document.getElementById('collisionW').value) || 32;
      const h = parseInt(document.getElementById('collisionH').value) || 32;
      updateCollisionBox(x, y, w, h);
    });
  });
}

/**
 * Update collision box visual
 */
function updateCollisionBox(x, y, w, h) {
  const box = document.getElementById('collisionBox');
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;

  document.getElementById('collisionX').value = Math.round(x);
  document.getElementById('collisionY').value = Math.round(y);
  document.getElementById('collisionW').value = Math.round(w);
  document.getElementById('collisionH').value = Math.round(h);

  collisionBoxState = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Reset collision box to default
 */
function resetCollisionBox() {
  updateCollisionBox(0, 0, 32, 32);
}

/**
 * Create sprite manually
 */
async function createManualSprite() {
  const name = document.getElementById('spriteName').value;
  const description = document.getElementById('spriteDescription').value;
  const sourceType = document.getElementById('spriteSource').value;
  const width = parseInt(document.getElementById('spriteWidth').value);
  const height = parseInt(document.getElementById('spriteHeight').value);
  const frame = parseInt(document.getElementById('spriteFrame').value);
  const frameCount = parseInt(document.getElementById('frameCount').value);
  const animationSpeed = parseInt(document.getElementById('animationSpeed').value);
  const solid = document.getElementById('spriteSolid').checked;
  const interactive = document.getElementById('spriteInteractive').checked;
  const interactionType = document.getElementById('interactionType').value;
  const zoneId = document.getElementById('manualZoneAssign').value;

  if (!name) {
    showAlert('Please enter a sprite name', 'warning');
    return;
  }

  try {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);
    formData.append('width', width);
    formData.append('height', height);
    formData.append('frame', frame);
    formData.append('frameCount', frameCount);
    formData.append('animationSpeed', animationSpeed);
    formData.append('solid', solid);
    formData.append('interactive', interactive);
    if (interactive) formData.append('interactionType', interactionType);
    formData.append('collision', JSON.stringify(collisionBoxState));
    if (zoneId) formData.append('zoneId', zoneId);

    // Add image source
    if (sourceType === 'upload') {
      const fileInput = document.getElementById('manualSpriteUpload');
      if (fileInput.files[0]) {
        formData.append('spriteImage', fileInput.files[0]);
      }
    } else {
      const sheetId = document.getElementById('existingSpriteSheet').value;
      if (sheetId) {
        formData.append('spriteSheetId', sheetId);
      }
    }

    const response = await fetch('/api/v1/sprites/create', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (result.success) {
      showAlert(`✅ Sprite "${name}" created successfully!`, 'success');
      document.getElementById('manualSpriteForm').reset();
      resetCollisionBox();
    } else {
      showAlert(`Failed to create sprite: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error creating sprite:', error);
    showAlert('Failed to create sprite', 'error');
  }
}

/**
 * Zone Assignment Mode Setup
 */
function setupZoneAssignMode() {
  const zoneSelect = document.getElementById('targetZone');
  const searchInput = document.getElementById('spriteSearch');
  const clearBtn = document.getElementById('clearSelectionBtn');
  const assignBtn = document.getElementById('assignToZoneBtn');

  // Load sprites when zone is selected
  zoneSelect.addEventListener('change', async (e) => {
    if (e.target.value) {
      await loadSpriteLibrary();
    }
  });

  // Search sprites
  searchInput.addEventListener('input', (e) => {
    filterSpriteLibrary(e.target.value);
  });

  // Clear selection
  clearBtn.addEventListener('click', () => {
    selectedSprites.clear();
    updateSelectedSpritesDisplay();
  });

  // Assign to zone
  assignBtn.addEventListener('click', async () => {
    await assignSpritesToZone();
  });
}

/**
 * Load sprite library
 */
async function loadSpriteLibrary() {
  try {
    const response = await fetch('/api/v1/sprites/library');
    const result = await response.json();

    if (result.success) {
      displaySpriteLibrary(result.sprites);
    } else {
      showAlert('Failed to load sprite library', 'error');
    }
  } catch (error) {
    console.error('Error loading sprite library:', error);
    showAlert('Failed to load sprite library', 'error');
  }
}

/**
 * Display sprite library
 */
function displaySpriteLibrary(sprites) {
  const library = document.getElementById('spriteLibrary');

  if (sprites.length === 0) {
    library.innerHTML = '<p style="color: #888;">No sprites available</p>';
    return;
  }

  library.innerHTML = '';
  sprites.forEach(sprite => {
    const item = document.createElement('div');
    item.className = 'sprite-item';
    item.dataset.spriteId = sprite._id;
    item.dataset.spriteName = sprite.name || sprite.title;

    const isSelected = selectedSprites.has(sprite._id);
    if (isSelected) {
      item.style.background = 'rgba(59, 130, 246, 0.2)';
    }

    item.innerHTML = `
      <div style="width: 48px; height: 48px; background: #333; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
        ${sprite.spriteData?.frame !== undefined ? sprite.spriteData.frame : '🎨'}
      </div>
      <div style="flex: 1;">
        <div style="font-weight: 600;">${sprite.name || sprite.title}</div>
        <div style="font-size: 0.75rem; color: #888;">
          ${sprite.spriteData?.width || 32}x${sprite.spriteData?.height || 32}px
          ${sprite.spriteData?.solid ? '• Solid' : ''}
          ${sprite.spriteData?.interactive ? '• Interactive' : ''}
        </div>
      </div>
      <button class="btn btn-sm ${isSelected ? 'btn-secondary' : 'btn-primary'}" data-action="toggle">
        ${isSelected ? 'Remove' : 'Add'}
      </button>
    `;

    // Toggle selection
    item.querySelector('[data-action="toggle"]').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSpriteSelection(sprite._id);
    });

    library.appendChild(item);
  });
}

/**
 * Toggle sprite selection
 */
function toggleSpriteSelection(spriteId) {
  if (selectedSprites.has(spriteId)) {
    selectedSprites.delete(spriteId);
  } else {
    selectedSprites.add(spriteId);
  }
  updateSelectedSpritesDisplay();
  loadSpriteLibrary(); // Refresh to update button states
}

/**
 * Update selected sprites display
 */
function updateSelectedSpritesDisplay() {
  const grid = document.getElementById('selectedSpritesGrid');
  const count = document.getElementById('selectedCount');

  count.textContent = selectedSprites.size;

  if (selectedSprites.size === 0) {
    grid.innerHTML = '<p style="color: #888;">No sprites selected</p>';
    return;
  }

  grid.innerHTML = Array.from(selectedSprites).map(id => `
    <div class="sprite-preview-item" data-sprite-id="${id}">
      <div class="sprite-preview-img" style="background: #333; display: flex; align-items: center; justify-content: center;">
        ✓
      </div>
    </div>
  `).join('');
}

/**
 * Filter sprite library by search term
 */
function filterSpriteLibrary(searchTerm) {
  const items = document.querySelectorAll('#spriteLibrary .sprite-item');
  const term = searchTerm.toLowerCase();

  items.forEach(item => {
    const name = item.dataset.spriteName.toLowerCase();
    if (name.includes(term)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}

/**
 * Assign sprites to zone
 */
async function assignSpritesToZone() {
  const zoneId = document.getElementById('targetZone').value;

  if (!zoneId) {
    showAlert('Please select a target zone', 'warning');
    return;
  }

  if (selectedSprites.size === 0) {
    showAlert('Please select at least one sprite', 'warning');
    return;
  }

  try {
    const response = await fetch('/api/v1/sprites/assign-to-zone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zoneId,
        spriteIds: Array.from(selectedSprites)
      })
    });

    const result = await response.json();

    if (result.success) {
      showAlert(`✅ Assigned ${selectedSprites.size} sprites to zone!`, 'success');
      selectedSprites.clear();
      updateSelectedSpritesDisplay();
    } else {
      showAlert(`Failed to assign sprites: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error assigning sprites:', error);
    showAlert('Failed to assign sprites', 'error');
  }
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
