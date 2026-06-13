/**
 * Interior Map Builder - Roguelite Interior Space Designer
 * For starships, space stations, pubs, and planetary buildings
 */

// ===== STATE =====
let canvas = null;
let ctx = null;
let parentAsset = null; // Parent asset from URL parameters
let mapData = {
  name: '',
  type: 'starship',
  description: '',
  width: 64,
  height: 64,
  tiles: [],
  metadata: {
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    linkedAsset: null,
    tags: []
  }
};

let currentTool = 'draw';
let currentTile = 'floor';
let tileSize = 12;
let zoom = 1.0;
let showGrid = true;
let isDrawing = false;
let history = [];
let historyIndex = -1;
let maxHistory = 50;

// Tile colors mapping
const tileColors = {
  'empty': '#000000',
  'floor': '#2d2d2d',
  'wall': '#4a4a4a',
  'door': '#8b5a00',
  'window': '#4169e1',
  'spawn': '#00ff00',
  'exit': '#ff0000',
  'hazard': '#ff6600',
  'loot': '#ffd700',
  'npc': '#9370db',
  'interactive': '#00ffff',
  'teleport': '#ff00ff',
  'furniture': '#8b4513'
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
  console.log('🗺️ Interior Map Builder initializing...');

  canvas = document.getElementById('mapCanvas');
  ctx = canvas.getContext('2d');

  // Check for parent asset in URL parameters
  loadParentAssetFromURL();

  // Load available parent assets for linking
  loadAvailableParentAssets();

  // Initialize map
  initializeMap();

  // Setup event listeners
  setupEventListeners();

  // Initial render
  renderMap();

  // Load from localStorage if exists
  loadAutoSave();

  console.log('✅ Interior Map Builder ready!');
});

/**
 * Initialize empty map grid
 */
function initializeMap() {
  mapData.tiles = [];
  for (let y = 0; y < mapData.height; y++) {
    mapData.tiles[y] = [];
    for (let x = 0; x < mapData.width; x++) {
      mapData.tiles[y][x] = 'empty';
    }
  }

  // Set canvas size
  updateCanvasSize();

  // Save to history
  saveToHistory();
}

/**
 * Update canvas dimensions based on map size and zoom
 */
function updateCanvasSize() {
  const displayWidth = mapData.width * tileSize * zoom;
  const displayHeight = mapData.height * tileSize * zoom;

  canvas.width = displayWidth;
  canvas.height = displayHeight;

  // Update canvas style for container scrolling
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Tool buttons
  document.querySelectorAll('.tool-button[data-tool]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tool = e.currentTarget.dataset.tool;
      selectTool(tool);
    });
  });

  // Tile type buttons
  document.querySelectorAll('.tile-type[data-tile]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tile = e.currentTarget.dataset.tile;
      selectTileType(tile);
    });
  });

  // Canvas drawing
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseleave', stopDrawing);

  // Touch support
  canvas.addEventListener('touchstart', handleTouchStart);
  canvas.addEventListener('touchmove', handleTouchMove);
  canvas.addEventListener('touchend', stopDrawing);

  // Form inputs
  document.getElementById('mapName').addEventListener('input', (e) => {
    mapData.name = e.target.value;
    autoSave();
  });

  document.getElementById('mapType').addEventListener('change', (e) => {
    mapData.type = e.target.value;
    autoSave();
  });

  document.getElementById('mapDescription').addEventListener('input', (e) => {
    mapData.description = e.target.value;
    autoSave();
  });

  document.getElementById('mapTags').addEventListener('input', (e) => {
    const tags = e.target.value.split(',').map(t => t.trim()).filter(t => t);
    mapData.metadata.tags = tags;
    autoSave();
  });

  document.getElementById('linkedAsset').addEventListener('change', async (e) => {
    const value = e.target.value;
    mapData.metadata.linkedAsset = value;

    // If user selected an actual asset (not "create" or empty)
    if (value && value !== 'create' && value !== '') {
      const [assetId, assetType] = value.split('|');

      if (assetId && assetType) {
        try {
          console.log(`🔗 Selected parent asset: ${assetId} (${assetType})`);

          // Get asset details from cached dropdown data instead of fetching again
          const selectedOption = e.target.options[e.target.selectedIndex];
          const assetName = selectedOption.textContent;

          // Use the data we already have from the dropdown population
          // We'll fetch full details if needed when saving
          parentAsset = {
            id: assetId,
            name: assetName,
            type: assetType,
            data: null // Will be fetched on save if needed
          };

          console.log('✅ Parent asset selected:', parentAsset);
          showAlert(`Linked to ${assetName}`, 'success');
        } catch (error) {
          console.error('❌ Error selecting parent asset:', error);
          showAlert('Error selecting parent asset', 'error');
        }
      }
    } else if (value === '' || !value) {
      // User deselected - clear parent asset
      parentAsset = null;
      console.log('🔗 Parent asset cleared');
    }

    autoSave();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);

  // Auto-save every 30 seconds
  setInterval(autoSave, 30000);
}

/**
 * Select drawing tool
 */
function selectTool(tool) {
  currentTool = tool;

  // Update UI
  document.querySelectorAll('.tool-button[data-tool]').forEach(btn => {
    btn.classList.remove('active');
  });

  const selectedBtn = document.querySelector(`.tool-button[data-tool="${tool}"]`);
  if (selectedBtn) {
    selectedBtn.classList.add('active');
  }

  console.log(`🛠️ Tool selected: ${tool}`);
}

/**
 * Select tile type
 */
function selectTileType(tile) {
  currentTile = tile;

  // Update UI
  document.querySelectorAll('.tile-type').forEach(btn => {
    btn.classList.remove('selected');
  });

  const selectedBtn = document.querySelector(`.tile-type[data-tile="${tile}"]`);
  if (selectedBtn) {
    selectedBtn.classList.add('selected');
  }

  console.log(`🎨 Tile type selected: ${tile}`);
}

/**
 * Start drawing
 */
function startDrawing(e) {
  isDrawing = true;
  draw(e);
}

/**
 * Stop drawing
 */
function stopDrawing() {
  if (isDrawing) {
    isDrawing = false;
    saveToHistory();
    autoSave();
  }
}

/**
 * Draw on canvas
 */
function draw(e) {
  if (!isDrawing && currentTool !== 'fill') return;

  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / (tileSize * zoom));
  const y = Math.floor((e.clientY - rect.top) / (tileSize * zoom));

  // Check bounds
  if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) return;

  // Apply tool
  switch (currentTool) {
    case 'draw':
      mapData.tiles[y][x] = currentTile;
      break;
    case 'erase':
      mapData.tiles[y][x] = 'empty';
      break;
    case 'fill':
      if (isDrawing) return; // Fill only on click, not drag
      floodFill(x, y, mapData.tiles[y][x], currentTile);
      saveToHistory();
      autoSave();
      break;
    case 'select':
      // TODO: Implement selection tool
      break;
  }

  renderMap();
}

/**
 * Flood fill algorithm
 */
function floodFill(x, y, targetTile, replacementTile) {
  if (targetTile === replacementTile) return;
  if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) return;
  if (mapData.tiles[y][x] !== targetTile) return;

  mapData.tiles[y][x] = replacementTile;

  // Recursively fill adjacent tiles
  floodFill(x + 1, y, targetTile, replacementTile);
  floodFill(x - 1, y, targetTile, replacementTile);
  floodFill(x, y + 1, targetTile, replacementTile);
  floodFill(x, y - 1, targetTile, replacementTile);
}

/**
 * Touch event handlers
 */
function handleTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const mouseEvent = new MouseEvent('mousedown', {
    clientX: touch.clientX,
    clientY: touch.clientY
  });
  canvas.dispatchEvent(mouseEvent);
}

function handleTouchMove(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const mouseEvent = new MouseEvent('mousemove', {
    clientX: touch.clientX,
    clientY: touch.clientY
  });
  canvas.dispatchEvent(mouseEvent);
}

/**
 * Keyboard shortcuts
 */
function handleKeyboard(e) {
  // Ctrl/Cmd + Z = Undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undoAction();
  }

  // Ctrl/Cmd + Shift + Z = Redo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
    e.preventDefault();
    redoAction();
  }

  // Ctrl/Cmd + Y = Redo (alternate)
  if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
    e.preventDefault();
    redoAction();
  }

  // G = Toggle Grid
  if (e.key === 'g') {
    toggleGrid();
  }

  // Number keys = Select tool
  if (e.key >= '1' && e.key <= '4') {
    const tools = ['draw', 'erase', 'fill', 'select'];
    selectTool(tools[parseInt(e.key) - 1]);
  }
}

/**
 * Render the map
 */
function renderMap() {
  // Clear canvas
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw tiles
  for (let y = 0; y < mapData.height; y++) {
    for (let x = 0; x < mapData.width; x++) {
      const tile = mapData.tiles[y][x];
      const color = tileColors[tile] || '#000000';

      ctx.fillStyle = color;
      ctx.fillRect(
        x * tileSize * zoom,
        y * tileSize * zoom,
        tileSize * zoom,
        tileSize * zoom
      );
    }
  }

  // Draw grid
  if (showGrid) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    // Vertical lines
    for (let x = 0; x <= mapData.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * tileSize * zoom, 0);
      ctx.lineTo(x * tileSize * zoom, canvas.height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y <= mapData.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * tileSize * zoom);
      ctx.lineTo(canvas.width, y * tileSize * zoom);
      ctx.stroke();
    }
  }
}

/**
 * History management
 */
function saveToHistory() {
  // Remove any history after current index
  history = history.slice(0, historyIndex + 1);

  // Add current state
  history.push(JSON.parse(JSON.stringify(mapData.tiles)));

  // Limit history size
  if (history.length > maxHistory) {
    history.shift();
  } else {
    historyIndex++;
  }
}

function undoAction() {
  if (historyIndex > 0) {
    historyIndex--;
    mapData.tiles = JSON.parse(JSON.stringify(history[historyIndex]));
    renderMap();
    autoSave();
    showAlert('Undo successful', 'info');
  } else {
    showAlert('Nothing to undo', 'info');
  }
}

function redoAction() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    mapData.tiles = JSON.parse(JSON.stringify(history[historyIndex]));
    renderMap();
    autoSave();
    showAlert('Redo successful', 'info');
  } else {
    showAlert('Nothing to redo', 'info');
  }
}

/**
 * Zoom controls
 */
function zoomIn() {
  if (zoom < 3.0) {
    zoom += 0.25;
    updateCanvasSize();
    renderMap();
    updateZoomDisplay();
  }
}

function zoomOut() {
  if (zoom > 0.5) {
    zoom -= 0.25;
    updateCanvasSize();
    renderMap();
    updateZoomDisplay();
  }
}

function resetZoom() {
  zoom = 1.0;
  updateCanvasSize();
  renderMap();
  updateZoomDisplay();
}

function updateZoomDisplay() {
  document.getElementById('zoomLevel').textContent = `${Math.round(zoom * 100)}%`;
}

/**
 * Toggle grid visibility
 */
function toggleGrid() {
  showGrid = !showGrid;
  renderMap();
  showAlert(`Grid ${showGrid ? 'enabled' : 'disabled'}`, 'info');
}

/**
 * Clear entire map
 */
function clearMap() {
  if (!confirm('Clear entire map? This cannot be undone.')) return;

  initializeMap();
  renderMap();
  showAlert('Map cleared', 'info');
}

/**
 * Set map size (presets)
 */
function setMapSize(width, height) {
  if (!confirm(`Change map size to ${width}x${height}? Current map will be lost.`)) return;

  mapData.width = width;
  mapData.height = height;
  initializeMap();
  renderMap();
  showAlert(`Map size set to ${width}x${height}`, 'success');
}

/**
 * Apply custom map size
 */
function applyCustomSize() {
  const width = parseInt(document.getElementById('customWidth').value);
  const height = parseInt(document.getElementById('customHeight').value);

  if (!width || !height || width < 16 || width > 256 || height < 16 || height > 256) {
    showAlert('Invalid size. Width and height must be between 16 and 256.', 'error');
    return;
  }

  setMapSize(width, height);
}

/**
 * Create new map
 */
function newMap() {
  if (!confirm('Create new map? Unsaved changes will be lost.')) return;

  // Reset all data
  mapData = {
    name: '',
    type: 'starship',
    description: '',
    width: 64,
    height: 64,
    tiles: [],
    metadata: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      linkedAsset: null,
      tags: []
    }
  };

  // Reset form
  document.getElementById('mapName').value = '';
  document.getElementById('mapType').value = 'starship';
  document.getElementById('mapDescription').value = '';
  document.getElementById('mapTags').value = '';
  document.getElementById('linkedAsset').value = '';

  // Reset history
  history = [];
  historyIndex = -1;

  // Initialize new map
  initializeMap();
  renderMap();

  showAlert('New map created', 'success');
}

/**
 * Save draft to localStorage
 */
function saveDraft() {
  mapData.metadata.modified = new Date().toISOString();
  localStorage.setItem('interiorMapBuilder_draft', JSON.stringify(mapData));
  showAlert('Draft saved to browser storage', 'success');
}

/**
 * Auto-save to localStorage
 */
function autoSave() {
  mapData.metadata.modified = new Date().toISOString();
  localStorage.setItem('interiorMapBuilder_autosave', JSON.stringify(mapData));
}

/**
 * Load auto-save from localStorage
 */
function loadAutoSave() {
  const saved = localStorage.getItem('interiorMapBuilder_autosave');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      mapData = data;

      // Update form
      document.getElementById('mapName').value = mapData.name || '';
      document.getElementById('mapType').value = mapData.type || 'starship';
      document.getElementById('mapDescription').value = mapData.description || '';
      document.getElementById('mapTags').value = mapData.metadata.tags.join(', ');
      if (mapData.metadata.linkedAsset) {
        document.getElementById('linkedAsset').value = mapData.metadata.linkedAsset;
      }

      updateCanvasSize();
      renderMap();

      console.log('📂 Auto-save loaded');
    } catch (e) {
      console.error('Failed to load auto-save:', e);
    }
  }
}

/**
 * Export map as JSON
 */
function exportMap() {
  const mapName = mapData.name || 'untitled_map';
  const filename = `${mapName.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.json`;

  const dataStr = JSON.stringify(mapData, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);

  showAlert(`Map exported as ${filename}`, 'success');
}

/**
 * Import map from JSON
 */
function importMap() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);

        // Validate structure
        if (!imported.tiles || !Array.isArray(imported.tiles)) {
          throw new Error('Invalid map format');
        }

        mapData = imported;

        // Update form
        document.getElementById('mapName').value = mapData.name || '';
        document.getElementById('mapType').value = mapData.type || 'starship';
        document.getElementById('mapDescription').value = mapData.description || '';
        document.getElementById('mapTags').value = (mapData.metadata.tags || []).join(', ');

        // Update canvas
        updateCanvasSize();
        renderMap();

        // Save to history
        saveToHistory();
        autoSave();

        showAlert('Map imported successfully', 'success');
      } catch (error) {
        console.error('Import error:', error);
        showAlert('Failed to import map: ' + error.message, 'error');
      }
    };

    reader.readAsText(file);
  };

  input.click();
}

/**
 * Show alert message
 */
function showAlert(message, type = 'info') {
  const container = document.getElementById('alertContainer');

  const alert = document.createElement('div');
  alert.className = `alert ${type}`;
  alert.textContent = message;

  container.appendChild(alert);

  setTimeout(() => {
    alert.remove();
  }, 3000);
}

/**
 * Load available parent assets for linking
 * Populates the "Link to World Asset" dropdown with anomalies, planets, stations
 */
async function loadAvailableParentAssets() {
  const dropdown = document.getElementById('linkedAsset');
  if (!dropdown) return;

  try {
    console.log('📦 Loading available parent assets...');

    // Fetch anomalies, planets, and stations
    const assetTypes = ['anomaly', 'planet', 'station'];
    const allAssets = [];

    for (const assetType of assetTypes) {
      const response = await fetch(`/api/v1/assets?assetType=${assetType}&limit=100`, {
        credentials: 'same-origin'
      });
      const data = await response.json();

      if (data.success && data.assets) {
        allAssets.push(...data.assets.map(a => ({
          ...a,
          assetType: assetType
        })));
      }
    }

    console.log(`✅ Found ${allAssets.length} available parent assets`);

    // Clear existing options except the first two
    dropdown.innerHTML = `
      <option value="">Select a world asset...</option>
      <option value="create">➕ Create New World Asset</option>
    `;

    // Add assets grouped by type
    if (allAssets.length > 0) {
      // Group by asset type
      const groups = {
        anomaly: allAssets.filter(a => a.assetType === 'anomaly'),
        planet: allAssets.filter(a => a.assetType === 'planet'),
        station: allAssets.filter(a => a.assetType === 'station')
      };

      // Add anomalies
      if (groups.anomaly.length > 0) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = '🌀 Anomalies (Starship Colonies)';
        groups.anomaly.forEach(asset => {
          const option = document.createElement('option');
          option.value = `${asset._id}|anomaly`;
          option.textContent = asset.title || asset.name;
          optgroup.appendChild(option);
        });
        dropdown.appendChild(optgroup);
      }

      // Add planets
      if (groups.planet.length > 0) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = '🌍 Planets';
        groups.planet.forEach(asset => {
          const option = document.createElement('option');
          option.value = `${asset._id}|planet`;
          option.textContent = asset.title || asset.name;
          optgroup.appendChild(option);
        });
        dropdown.appendChild(optgroup);
      }

      // Add stations
      if (groups.station.length > 0) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = '🛰️ Stations';
        groups.station.forEach(asset => {
          const option = document.createElement('option');
          option.value = `${asset._id}|station`;
          option.textContent = asset.title || asset.name;
          optgroup.appendChild(option);
        });
        dropdown.appendChild(optgroup);
      }
    }

    // If parent asset loaded from URL, select it
    if (parentAsset) {
      dropdown.value = `${parentAsset.id}|${parentAsset.type}`;
    }

  } catch (error) {
    console.error('❌ Error loading parent assets:', error);
  }
}

/**
 * Load existing zone data for editing
 */
async function loadExistingZone(zoneId) {
  try {
    console.log(`📂 Loading existing zone: ${zoneId}`);
    showAlert('Loading zone...', 'info');

    const response = await fetch(`/api/v1/assets/${zoneId}`, {
      credentials: 'same-origin'
    });
    const data = await response.json();

    if (!data.success || !data.asset) {
      throw new Error('Zone not found');
    }

    const zone = data.asset;
    console.log('✅ Zone loaded:', zone);

    // Load zone metadata
    document.getElementById('mapName').value = zone.title || '';
    document.getElementById('mapDescription').value = zone.description || '';
    document.getElementById('mapTags').value = (zone.tags || []).join(', ');
    document.getElementById('mapType').value = zone.zoneData?.type || 'interior';

    // Load parent asset info
    if (zone.hierarchy?.parent) {
      try {
        const parentResponse = await fetch(`/api/v1/assets/${zone.hierarchy.parent}`, {
          credentials: 'same-origin'
        });
        const parentData = await parentResponse.json();

        if (parentData.success && parentData.asset) {
          parentAsset = {
            id: zone.hierarchy.parent,
            type: zone.hierarchy.parentType,
            name: parentData.asset.title || parentData.asset.name,
            data: parentData.asset
          };

          document.getElementById('parentAssetInfo').style.display = 'block';
          document.getElementById('parentAssetName').textContent = parentAsset.name;
          document.getElementById('parentAssetType').textContent = `(${parentAsset.type})`;

          // Select in dropdown
          const dropdown = document.getElementById('linkedAsset');
          dropdown.value = `${parentAsset.id}|${parentAsset.type}`;

          console.log('✅ Loaded parent asset:', parentAsset);
        }
      } catch (error) {
        console.warn('Could not load parent asset:', error);
      }
    }

    // Load zoneData if it exists
    if (zone.zoneData) {
      // Set dimensions
      if (zone.zoneData.width && zone.zoneData.height) {
        document.getElementById('mapWidth').value = zone.zoneData.width;
        document.getElementById('mapHeight').value = zone.zoneData.height;
        mapData.width = zone.zoneData.width;
        mapData.height = zone.zoneData.height;
      }

      // Initialize empty tiles array
      initializeMap();

      // Load tiles from layers
      if (zone.zoneData.layers) {
        // Load from ground, walls, objects layers
        const layers = zone.zoneData.layers;

        let groundCount = 0;
        let wallCount = 0;

        for (let y = 0; y < mapData.height; y++) {
          for (let x = 0; x < mapData.width; x++) {
            // Check each layer and set tile type
            if (layers.walls && layers.walls[y] && layers.walls[y][x]) {
              mapData.tiles[y][x] = 'wall';
              wallCount++;
            } else if (layers.ground && layers.ground[y] && layers.ground[y][x]) {
              mapData.tiles[y][x] = 'floor';
              groundCount++;
            } else if (layers.objects && layers.objects[y] && layers.objects[y][x]) {
              const objType = layers.objects[y][x];
              if (objType === 'window') mapData.tiles[y][x] = 'window';
              else if (objType === 'door') mapData.tiles[y][x] = 'door';
            }
          }
        }

        console.log(`✅ Loaded ${groundCount} floor tiles and ${wallCount} wall tiles`);

        // Load markers from spawnPoints array (all markers stored here with type field)
        if (zone.zoneData.spawnPoints) {
          zone.zoneData.spawnPoints.forEach(point => {
            if (point.x >= 0 && point.x < mapData.width && point.y >= 0 && point.y < mapData.height) {
              // Map the type from zoneData to builder tile names
              let tileType;
              switch(point.type) {
                case 'player':
                  tileType = 'spawn';
                  break;
                case 'npc':
                  tileType = 'npc';
                  break;
                case 'loot':
                  tileType = 'loot';
                  break;
                case 'exit':
                  tileType = 'exit';
                  break;
                case 'hazard':
                  tileType = 'hazard';
                  break;
                default:
                  tileType = 'spawn'; // fallback
              }
              mapData.tiles[point.y][point.x] = tileType;
            }
          });
        }

        // Also check individual point arrays if they exist (for backwards compatibility)
        if (zone.zoneData.lootPoints) {
          zone.zoneData.lootPoints.forEach(lp => {
            if (lp.x >= 0 && lp.x < mapData.width && lp.y >= 0 && lp.y < mapData.height) {
              mapData.tiles[lp.y][lp.x] = 'loot';
            }
          });
        }

        if (zone.zoneData.npcPoints) {
          zone.zoneData.npcPoints.forEach(np => {
            if (np.x >= 0 && np.x < mapData.width && np.y >= 0 && np.y < mapData.height) {
              mapData.tiles[np.y][np.x] = 'npc';
            }
          });
        }

        if (zone.zoneData.exitPoints) {
          zone.zoneData.exitPoints.forEach(ep => {
            if (ep.x >= 0 && ep.x < mapData.width && ep.y >= 0 && ep.y < mapData.height) {
              mapData.tiles[ep.y][ep.x] = 'exit';
            }
          });
        }

        if (zone.zoneData.hazardPoints) {
          zone.zoneData.hazardPoints.forEach(hp => {
            if (hp.x >= 0 && hp.x < mapData.width && hp.y >= 0 && hp.y < mapData.height) {
              mapData.tiles[hp.y][hp.x] = 'hazard';
            }
          });
        }
      }

      // Store the zone ID for updates
      mapData.metadata.zoneId = zoneId;

      // Redraw the map
      renderMap();

      showAlert(`Loaded zone: ${zone.title}`, 'success');
      console.log('✅ Zone data loaded into builder');
    } else {
      console.warn('⚠️ Zone has no zoneData, starting with empty map');
      initializeMap();
      renderMap();
      showAlert(`Loaded zone: ${zone.title} (empty - create floormap)`, 'info');
    }

  } catch (error) {
    console.error('❌ Error loading zone:', error);
    showAlert('Failed to load zone: ' + error.message, 'error');
  }
}

/**
 * Load parent asset from URL parameters
 */
async function loadParentAssetFromURL() {
  const params = new URLSearchParams(window.location.search);

  // Check if loading an existing zone
  const zoneId = params.get('zoneId');
  if (zoneId) {
    await loadExistingZone(zoneId);
    return; // Exit early, zone loading handles everything
  }

  // Otherwise, check for parent asset to create new zone
  const parentAssetId = params.get('parentAssetId');
  const parentAssetType = params.get('parentAssetType');

  if (parentAssetId) {
    try {
      const response = await fetch(`/api/v1/assets/${parentAssetId}`, {
        credentials: 'same-origin'
      });
      const data = await response.json();

      if (data.success && data.asset) {
        parentAsset = {
          id: parentAssetId,
          type: parentAssetType || data.asset.assetType,
          name: data.asset.title || data.asset.name,
          data: data.asset
        };

        // Update UI
        document.getElementById('parentAssetInfo').style.display = 'block';
        document.getElementById('parentAssetName').textContent = parentAsset.name;
        document.getElementById('parentAssetType').textContent = `(${parentAsset.type})`;

        // Pre-fill map name
        document.getElementById('mapName').value = `${parentAsset.name} - Interior`;

        console.log('✅ Loaded parent asset:', parentAsset);
      }
    } catch (error) {
      console.error('Error loading parent asset:', error);
    }
  }
}

/**
 * Save map as Zone asset in database
 */
async function saveAsZoneAsset() {
  const mapName = document.getElementById('mapName').value;
  const mapType = document.getElementById('mapType').value;
  const mapDescription = document.getElementById('mapDescription').value;
  const mapTags = document.getElementById('mapTags').value;

  if (!mapName) {
    showAlert('Please enter a map name before saving', 'warning');
    return;
  }

  // Check if we need to load parent asset from dropdown (if not already loaded from URL)
  if (!parentAsset) {
    const linkedAssetValue = document.getElementById('linkedAsset').value;
    if (linkedAssetValue && linkedAssetValue !== 'create' && linkedAssetValue !== '') {
      const [assetId, assetType] = linkedAssetValue.split('|');

      if (assetId && assetType) {
        // Get name from dropdown
        const dropdown = document.getElementById('linkedAsset');
        const selectedOption = dropdown.options[dropdown.selectedIndex];
        const assetName = selectedOption.textContent;

        parentAsset = {
          id: assetId,
          name: assetName,
          type: assetType,
          data: null // We don't need the full data, just ID and type for hierarchy
        };
        console.log('✅ Parent asset loaded from dropdown for save:', parentAsset);
      }
    }
  }

  // Warn if no parent asset is selected
  if (!parentAsset) {
    const confirmSave = confirm('No parent asset selected. This zone will not be linked to any world asset. Continue?');
    if (!confirmSave) {
      return;
    }
  }

  try {
    // Analyze map data for roguelite features
    const spawnPoints = [];
    const lootPoints = [];
    const npcPoints = [];
    const exitPoints = [];
    const hazardPoints = [];

    mapData.tiles.forEach((row, y) => {
      row.forEach((tile, x) => {
        switch(tile) {
          case 'spawn':
            spawnPoints.push({ x, y, type: 'player' });
            break;
          case 'loot':
            lootPoints.push({ x, y, type: 'loot' });
            break;
          case 'npc':
            npcPoints.push({ x, y, type: 'npc' });
            break;
          case 'exit':
            exitPoints.push({ x, y, type: 'exit' });
            break;
          case 'hazard':
            hazardPoints.push({ x, y, type: 'hazard' });
            break;
        }
      });
    });

    // Prepare zone data payload
    const zoneData = {
      title: mapName,
      description: mapDescription || `Interior zone for ${parentAsset ? parentAsset.name : 'location'}`,
      assetType: 'zone',
      zoneData: {
        type: mapType === 'dungeon' ? 'dungeon' : 'interior',
        difficulty: 1,
        width: mapData.width,
        height: mapData.height,
        tileSize: 32,
        layers: {
          ground: mapData.tiles.map(row => row.map(tile => tile === 'floor' ? 1 : 0)),
          walls: mapData.tiles.map(row => row.map(tile => tile === 'wall' ? 1 : 0)),
          objects: mapData.tiles.map(row => row.map(tile =>
            ['door', 'window', 'furniture', 'interactive'].includes(tile) ? 1 : 0
          )),
          sprites: []
        },
        spawnPoints: [
          ...spawnPoints,
          ...lootPoints,
          ...npcPoints,
          ...exitPoints,
          ...hazardPoints
        ],
        lootTables: lootPoints.length > 0 ? [{
          rarity: 'common',
          items: []
        }] : [],
        enemyPatterns: npcPoints.length > 0 ? [{
          type: 'patrol',
          count: npcPoints.length,
          patrol: []
        }] : [],
        lighting: 'normal',
        musicTrack: null,
        ambientSounds: []
      },
      tags: mapTags ? mapTags.split(',').map(t => t.trim()) : [],
      hierarchy: parentAsset ? {
        parent: parentAsset.id,
        parentType: parentAsset.type,
        depth: 1
      } : null,
      coordinates: parentAsset?.data?.coordinates || null
    };

    // Check if updating existing zone or creating new one
    const zoneId = mapData.metadata.zoneId;
    const isUpdate = !!zoneId;

    showAlert(isUpdate ? 'Updating zone...' : 'Creating zone asset...', 'info');

    const url = isUpdate ? `/api/v1/assets/${zoneId}` : '/api/v1/assets';
    const method = isUpdate ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(zoneData)
    });

    const result = await response.json();

    if (result.success) {
      showAlert(`✅ Zone asset "${mapName}" ${isUpdate ? 'updated' : 'created'} successfully!`, 'success');

      // Store zone ID for future updates
      if (!isUpdate && result.asset._id) {
        mapData.metadata.zoneId = result.asset._id;
      }

      // Link to parent if specified
      if (parentAsset) {
        try {
          await fetch('/api/v1/hierarchy/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              childId: result.asset._id,
              parentId: parentAsset.id,
              parentType: parentAsset.type
            })
          });
          showAlert(`✅ Zone linked to ${parentAsset.name}`, 'success');
        } catch (linkError) {
          console.error('Error linking to parent:', linkError);
        }
      }

      // Clear draft
      localStorage.removeItem('interiorMapBuilder_draft');
      localStorage.removeItem('interiorMapBuilder_autosave');

    } else {
      showAlert(`Failed to create zone: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error saving zone asset:', error);
    showAlert('Failed to save zone asset', 'error');
  }
}

// ===== GLOBAL FUNCTIONS (called from HTML onclick) =====
window.clearMap = clearMap;
window.toggleGrid = toggleGrid;
window.undoAction = undoAction;
window.redoAction = redoAction;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.resetZoom = resetZoom;
window.setMapSize = setMapSize;
window.applyCustomSize = applyCustomSize;
window.newMap = newMap;
window.saveDraft = saveDraft;
window.exportMap = exportMap;
window.importMap = importMap;
window.saveAsZoneAsset = saveAsZoneAsset;

console.log('🗺️ Interior Map Builder script loaded');
