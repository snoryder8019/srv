# Builder Enhanced - Development Guide

## Overview

The Enhanced Asset Builder is the primary tool for creating and managing all asset types in the Stringborn Universe. It provides a comprehensive interface for creating hierarchically-linked assets with type-specific fields, visual editors, and parent-child relationship management.

**File Locations:**
- View: `/srv/ps/views/assets/builder-enhanced.ejs`
- Client Script: `/srv/ps/public/javascripts/asset-builder-enhanced.js`
- API Routes: `/srv/ps/api/v1/assets/index.js`
- Model: `/srv/ps/api/v1/models/Asset.js`

## Architecture

### Data Flow

```
┌─────────────────┐
│   User Input    │
│  (Form Fields)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Client-Side    │
│  Validation &   │
│  Form Builder   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  POST/PUT       │
│  /api/v1/assets │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Asset Model    │
│  - Validation   │
│  - Hierarchy    │
│  - Save to DB   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  MongoDB        │
│  assets coll.   │
└─────────────────┘
```

## Core Features

### 1. Hierarchical Parent Selection

**Purpose:** Dynamically shows valid parent assets based on the selected asset type.

**Implementation:**
- Located in: `asset-builder-enhanced.js` lines 1248-1495
- Triggered by: Asset type selection change event

**Hierarchy Map:**
```javascript
const hierarchyMap = {
  'galaxy': {
    parentTypes: ['anomaly'],
    label: 'Parent Anomaly',
    hint: '(optional)'
  },
  'star': {
    parentTypes: ['galaxy'],
    label: 'Parent Galaxy',
    hint: '(required)',
    required: true
  },
  'planet': {
    parentTypes: ['star'],
    label: 'Parent Star System',
    hint: '(required)',
    required: true
  },
  'orbital': {
    parentTypes: ['star', 'planet'],
    label: 'Parent Location',
    hint: '(star or planet)',
    required: true
  },
  'environment': {
    parentTypes: ['planet', 'orbital', 'star'],
    label: 'Parent Location'
  },
  'zone': {
    parentTypes: ['planet', 'orbital', 'environment'],
    label: 'Parent Location'
  }
};
```

**API Integration:**
- Fetches parent options: `GET /api/v1/assets?assetType={type}&limit=1000`
- Returns: `{ success: true, assets: [...] }`

**UI Updates:**
1. Updates label text based on hierarchy map
2. Shows/hides hint text (required/optional)
3. Populates dropdown with fetched parent assets
4. Shows hierarchy breadcrumb for selected parent

### 2. Hierarchy Breadcrumb Display

**Purpose:** Visual representation of the asset's position in the hierarchy tree.

**Location:** `builder-enhanced.ejs` lines 125-130

**Structure:**
```html
<div id="hierarchyBreadcrumb" style="display: none; ...">
  <span>Hierarchy Path:</span>
  <div id="breadcrumbPath">
    <!-- Dynamically populated with: -->
    <!-- Universe → Galaxy → Star → (This Asset) -->
  </div>
</div>
```

**Display Logic:**
- Fetches parent asset: `GET /api/v1/assets/{parentId}`
- Recursively fetches ancestors via `hierarchy.path` array
- Renders breadcrumb: `Universe → Anomaly → Galaxy → This Asset`

### 3. Build Interior Button

**Purpose:** Quick navigation to Interior Map Builder for spatial assets.

**Location:** `builder-enhanced.ejs` lines 144-150

**Visibility Rules:**
```javascript
// Show for these asset types:
const spatialAssets = ['planet', 'orbital', 'environment', 'zone'];
if (spatialAssets.includes(selectedAssetType)) {
  document.getElementById('buildInteriorGroup').style.display = 'block';
}
```

**Functionality:**
1. **Existing Asset**: `window.location.href = '/universe/interior-map-builder?parentAssetId={id}&parentAssetType={type}'`
2. **New Asset (Draft)**:
   - Saves draft first
   - Waits for save completion
   - Redirects with new asset ID

**Code Reference:** `asset-builder-enhanced.js` lines 1457-1495

### 4. Type-Specific Field Generation

**Purpose:** Dynamically generates form fields based on selected asset type.

**Implementation:** `asset-builder-enhanced.js` lines 200-800

**Asset Type Definitions:**
```javascript
const assetTypeFields = {
  galaxy: {
    icon: '🌌',
    fields: [
      {
        name: 'size',
        label: 'Galaxy Size',
        type: 'select',
        options: ['dwarf', 'small', 'medium', 'large', 'giant'],
        required: true
      },
      {
        name: 'starCount',
        label: 'Star Count',
        type: 'number',
        min: 1,
        max: 1000000,
        required: true
      },
      // ... more fields
    ]
  },
  planet: {
    icon: '🌍',
    fields: [
      { name: 'climate', label: 'Climate', type: 'select', options: [...] },
      { name: 'atmosphere', label: 'Atmosphere', type: 'select', options: [...] },
      { name: 'gravity', label: 'Gravity', type: 'number', step: 0.1 },
      { name: 'population', label: 'Population', type: 'number' },
      // ... more fields
    ]
  },
  // ... more asset types
};
```

**Field Types:**
- `text`: Standard text input
- `number`: Numeric input with min/max/step
- `select`: Dropdown with predefined options
- `textarea`: Multi-line text
- `checkbox`: Boolean toggle
- `color`: Color picker

**Rendering Process:**
1. User selects asset type
2. `generateTypeSpecificFields(assetType)` called
3. Clears `#typeSpecificFields` container
4. Iterates through field definitions
5. Creates HTML for each field
6. Inserts into container

### 5. Visual Asset Editors

#### Pixel Editor
**Purpose:** Create pixel art sprites for 2D assets
**Location:** `/srv/ps/public/javascripts/pixel-editor.js`

**Features:**
- Grid-based drawing canvas (16x16 to 128x128)
- Color palette selection
- Drawing tools: pencil, eraser, fill bucket
- Export as PNG or base64
- Import existing sprites

#### 3D Asset Viewer
**Purpose:** Preview and upload 3D models
**Location:** `/srv/ps/public/javascripts/three-asset-viewer.js`

**Features:**
- Three.js integration
- GLTF/GLB model loading
- Orbit controls for viewing
- Lighting setup
- Model upload via drag & drop

### 6. Image Management

**Upload Handlers:**
```javascript
// Fullscreen image upload
document.getElementById('fullscreenImage').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch('/api/v1/upload/image', {
    method: 'POST',
    body: formData
  });

  const data = await response.json();
  if (data.success) {
    document.getElementById('fullscreenImageUrl').value = data.url;
  }
});

// Index card image upload
// Similar implementation for preview/thumbnail images
```

**Image Preview:**
- Shows thumbnail of uploaded/selected image
- Click to view full size
- Replace or remove options

### 7. Form Submission & Validation

**Client-Side Validation:**
```javascript
function validateAssetForm() {
  const errors = [];

  // Required fields
  const name = document.getElementById('name').value.trim();
  if (!name) {
    errors.push('Asset name is required');
  }

  const assetType = document.getElementById('assetType').value;
  if (!assetType) {
    errors.push('Asset type is required');
  }

  // Hierarchy validation
  const hierarchyConfig = hierarchyMap[assetType];
  if (hierarchyConfig?.required) {
    const parentId = document.getElementById('parentAsset').value;
    if (!parentId) {
      errors.push(`Parent ${hierarchyConfig.label} is required for ${assetType}`);
    }
  }

  // Type-specific validation
  const typeFields = assetTypeFields[assetType]?.fields || [];
  typeFields.forEach(field => {
    if (field.required) {
      const value = document.getElementById(field.name)?.value;
      if (!value) {
        errors.push(`${field.label} is required`);
      }
    }
  });

  return errors;
}
```

**Submission Flow:**
```javascript
async function submitAssetForm(isDraft = false) {
  // 1. Validate form
  const errors = validateAssetForm();
  if (errors.length > 0 && !isDraft) {
    showErrors(errors);
    return;
  }

  // 2. Gather form data
  const formData = new FormData(document.getElementById('assetBuilderForm'));

  // 3. Add hierarchy data
  formData.append('hierarchy', JSON.stringify({
    parent: document.getElementById('hierarchyParent').value,
    parentType: document.getElementById('hierarchyParentType').value,
    depth: parseInt(document.getElementById('hierarchyDepth').value) || 0
  }));

  // 4. Add type-specific fields
  const typeSpecificData = {};
  const assetType = formData.get('assetType');
  const fields = assetTypeFields[assetType]?.fields || [];

  fields.forEach(field => {
    const value = document.getElementById(field.name)?.value;
    if (value) {
      typeSpecificData[field.name] = value;
    }
  });

  formData.append('typeSpecificData', JSON.stringify(typeSpecificData));

  // 5. Set draft status
  formData.append('published', !isDraft);

  // 6. Submit to API
  const method = currentAssetId ? 'PUT' : 'POST';
  const url = currentAssetId
    ? `/api/v1/assets/${currentAssetId}`
    : '/api/v1/assets';

  const response = await fetch(url, {
    method,
    body: formData
  });

  const data = await response.json();

  // 7. Handle response
  if (data.success) {
    showSuccessMessage('Asset saved successfully!');
    if (!isDraft) {
      // Redirect to asset view or list
      window.location.href = `/assets/my-assets`;
    } else {
      // Update current asset ID for further edits
      currentAssetId = data.asset._id;
    }
  } else {
    showErrorMessage(data.error || 'Failed to save asset');
  }
}
```

## API Integration

### Asset Creation
**Endpoint:** `POST /api/v1/assets`

**Request Body:**
```javascript
{
  name: "string",
  description: "string",
  assetType: "galaxy|star|planet|orbital|environment|zone|item|weapon|...",
  published: boolean,

  // Images
  images: {
    fullscreen: "url",
    indexCard: "url"
  },

  // Hierarchy
  hierarchy: {
    parent: "ObjectId",
    parentType: "string",
    depth: number
  },

  // Coordinates (for galactic assets)
  coordinates: {
    x: number,
    y: number,
    z: number
  },

  // Type-specific data
  galaxyData: { ... },
  planetData: { ... },
  // etc.

  // Lore
  lore: {
    history: "string",
    culture: "string",
    significance: "string"
  },

  // Tags
  tags: ["string"]
}
```

**Response:**
```javascript
{
  success: true,
  asset: {
    _id: "ObjectId",
    userId: "ObjectId",
    name: "string",
    assetType: "string",
    // ... all asset fields
    hierarchy: {
      parent: "ObjectId",
      parentType: "string",
      children: [],
      depth: number,
      path: ["ObjectId"]
    },
    createdAt: "ISODate",
    updatedAt: "ISODate"
  }
}
```

### Asset Update
**Endpoint:** `PUT /api/v1/assets/:id`

**Request/Response:** Same as creation

### Fetch Parent Options
**Endpoint:** `GET /api/v1/assets?assetType={type}&limit={limit}`

**Response:**
```javascript
{
  success: true,
  assets: [
    {
      _id: "ObjectId",
      name: "string",
      title: "string",
      assetType: "string",
      hierarchy: { ... }
    }
  ]
}
```

### Fetch Single Asset
**Endpoint:** `GET /api/v1/assets/:id`

**Response:**
```javascript
{
  success: true,
  asset: { /* full asset object */ }
}
```

## Database Schema

### Asset Document Structure

```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  name: String,
  title: String, // Alternative to name
  description: String,
  assetType: String, // galaxy, star, planet, etc.
  published: Boolean,

  // Visual assets
  images: {
    fullscreen: String, // URL or path
    indexCard: String   // URL or path
  },

  // 3D models
  models: {
    gltf: String, // URL or path
    preview: String
  },

  // Hierarchy relationships
  hierarchy: {
    parent: ObjectId,      // Parent asset ID
    parentType: String,    // Parent asset type
    children: [ObjectId],  // Child asset IDs
    depth: Number,         // Depth in hierarchy tree (0 = root)
    path: [ObjectId]       // Array of ancestor IDs from root to parent
  },

  // Spatial positioning
  coordinates: {
    x: Number,
    y: Number,
    z: Number
  },

  // Type-specific data
  galaxyData: {
    size: String,
    starCount: Number,
    blackHolePresent: Boolean,
    // ... more fields
  },

  planetData: {
    climate: String,
    atmosphere: String,
    gravity: Number,
    population: Number,
    // ... more fields
  },

  orbitalData: { ... },
  environmentData: { ... },
  zoneData: {
    type: String, // dungeon, interior, etc.
    difficulty: Number,
    width: Number,
    height: Number,
    tileSize: Number,
    layers: {
      ground: [[Number]],
      walls: [[Number]],
      objects: [[Object]],
      sprites: [{ spriteId: ObjectId, x: Number, y: Number }]
    },
    spawnPoints: [{ x: Number, y: Number, type: String }],
    lootTables: [{ rarity: String, items: [ObjectId] }],
    enemyPatterns: [{ type: String, count: Number }]
  },

  // Lore and story
  lore: {
    history: String,
    culture: String,
    significance: String
  },

  // Tags and categorization
  tags: [String],

  // Metadata
  createdAt: Date,
  updatedAt: Date,
  version: Number
}
```

## UI Components

### Form Layout Structure

```html
<div class="asset-builder-container">
  <!-- Header -->
  <div class="builder-header">
    <h1>Enhanced Asset Builder</h1>
    <div class="action-buttons">
      <button id="saveDraftBtn">Save Draft</button>
      <button id="publishBtn">Publish Asset</button>
    </div>
  </div>

  <!-- Form -->
  <form id="assetBuilderForm">
    <!-- Basic Info Section -->
    <div class="form-section">
      <h3>Basic Information</h3>
      <div class="form-row">
        <div class="form-group">
          <label for="assetType">Asset Type *</label>
          <select id="assetType" name="assetType" required>
            <option value="">Select Asset Type</option>
            <option value="galaxy">🌌 Galaxy</option>
            <option value="star">⭐ Star</option>
            <option value="planet">🌍 Planet</option>
            <!-- ... more types -->
          </select>
        </div>

        <div class="form-group">
          <label for="name">Asset Name *</label>
          <input type="text" id="name" name="name" required>
        </div>
      </div>

      <div class="form-group">
        <label for="description">Description</label>
        <textarea id="description" name="description" rows="3"></textarea>
      </div>
    </div>

    <!-- Location & Hierarchy Section -->
    <div class="form-section">
      <h3>🌌 Location & Hierarchy</h3>

      <!-- Hierarchy Breadcrumb -->
      <div id="hierarchyBreadcrumb" style="display: none;">
        <span>Hierarchy Path:</span>
        <div id="breadcrumbPath"></div>
      </div>

      <!-- Parent Selection -->
      <div class="form-group">
        <label for="parentAsset">
          <span id="parentAssetLabel">Parent Asset</span>
          <span id="parentAssetHint"></span>
        </label>
        <select id="parentAsset" name="parentAsset">
          <option value="">None (Standalone Asset)</option>
        </select>
        <small id="parentAssetHelp">Select an asset type first</small>
      </div>

      <!-- Build Interior Button -->
      <div class="form-group" id="buildInteriorGroup" style="display: none;">
        <button type="button" id="buildInteriorBtn">
          🏗️ Build Interior / Zone
        </button>
      </div>

      <!-- Coordinates -->
      <div class="form-row" id="coordinatesRow" style="display: none;">
        <div class="form-group">
          <label for="coordX">X Coordinate</label>
          <input type="number" id="coordX" name="coordX" step="0.1">
        </div>
        <div class="form-group">
          <label for="coordY">Y Coordinate</label>
          <input type="number" id="coordY" name="coordY" step="0.1">
        </div>
        <div class="form-group">
          <label for="coordZ">Z Coordinate</label>
          <input type="number" id="coordZ" name="coordZ" step="0.1">
        </div>
      </div>

      <!-- Hidden fields -->
      <input type="hidden" id="hierarchyParent" name="hierarchy_parent">
      <input type="hidden" id="hierarchyParentType" name="hierarchy_parentType">
      <input type="hidden" id="hierarchyDepth" name="hierarchy_depth">
    </div>

    <!-- Type-Specific Fields (Dynamic) -->
    <div id="typeSpecificFields"></div>

    <!-- Visual Assets Section -->
    <div class="form-section">
      <h3>🎨 Visual Assets</h3>

      <div class="form-row">
        <!-- Fullscreen Image -->
        <div class="form-group">
          <label for="fullscreenImage">Fullscreen Image</label>
          <input type="file" id="fullscreenImage" accept="image/*">
          <input type="hidden" id="fullscreenImageUrl" name="fullscreenImageUrl">
          <div id="fullscreenPreview" class="image-preview"></div>
        </div>

        <!-- Index Card Image -->
        <div class="form-group">
          <label for="indexCardImage">Index Card (Preview)</label>
          <input type="file" id="indexCardImage" accept="image/*">
          <input type="hidden" id="indexCardImageUrl" name="indexCardImageUrl">
          <div id="indexCardPreview" class="image-preview"></div>
        </div>
      </div>

      <!-- Pixel Editor -->
      <div class="form-group">
        <button type="button" id="openPixelEditorBtn">
          🎨 Open Pixel Editor
        </button>
      </div>

      <!-- 3D Model Upload -->
      <div class="form-group">
        <label for="modelFile">3D Model (GLTF/GLB)</label>
        <input type="file" id="modelFile" accept=".gltf,.glb">
        <input type="hidden" id="modelUrl" name="modelUrl">
        <div id="modelPreview" class="model-preview"></div>
      </div>
    </div>

    <!-- Lore & Story Section -->
    <div class="form-section">
      <h3>📖 Lore & Story</h3>

      <div class="form-group">
        <label for="loreHistory">History</label>
        <textarea id="loreHistory" name="lore_history" rows="4"></textarea>
      </div>

      <div class="form-group">
        <label for="loreCulture">Culture</label>
        <textarea id="loreCulture" name="lore_culture" rows="4"></textarea>
      </div>

      <div class="form-group">
        <label for="loreSignificance">Significance</label>
        <textarea id="loreSignificance" name="lore_significance" rows="4"></textarea>
      </div>
    </div>

    <!-- Tags Section -->
    <div class="form-section">
      <h3>🏷️ Tags</h3>
      <div class="form-group">
        <label for="tags">Tags (comma-separated)</label>
        <input type="text" id="tags" name="tags" placeholder="e.g., sci-fi, laser, energy">
      </div>
    </div>
  </form>
</div>

<!-- Pixel Editor Modal -->
<div id="pixelEditorModal" class="modal" style="display: none;">
  <div class="modal-content">
    <span class="close">&times;</span>
    <div id="pixelEditorContainer"></div>
  </div>
</div>
```

### CSS Styling Guide

**Color Scheme:**
```css
:root {
  --primary-purple: #8a4fff;
  --primary-green: #00ff88;
  --bg-dark: rgba(20, 20, 40, 0.95);
  --bg-darker: rgba(10, 10, 20, 0.98);
  --border-color: #444;
  --text-primary: #fff;
  --text-secondary: #aaa;
  --error-red: #ff4444;
  --success-green: #00ff88;
}
```

**Form Section Styling:**
```css
.form-section {
  background: var(--bg-dark);
  border: 2px solid var(--primary-purple);
  border-radius: 12px;
  padding: 2rem;
  margin-bottom: 2rem;
}

.form-section h3 {
  color: var(--primary-purple);
  font-size: 1.5rem;
  margin-bottom: 1.5rem;
  border-bottom: 2px solid var(--primary-purple);
  padding-bottom: 0.5rem;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  margin-bottom: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 0.95rem;
}

.form-group input,
.form-group select,
.form-group textarea {
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 0.75rem;
  font-size: 1rem;
  transition: all 0.2s;
}

.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--primary-purple);
  box-shadow: 0 0 10px rgba(138, 79, 255, 0.3);
}

.form-group small {
  color: var(--text-secondary);
  font-size: 0.85rem;
}
```

## JavaScript Architecture

### Module Structure

```javascript
// Global state
let currentAssetId = null;
let currentAssetType = null;
let hierarchyData = {};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  initializeAssetBuilder();
  setupEventListeners();
  loadAssetIfEditing();
});

// Core initialization
function initializeAssetBuilder() {
  // Set up asset type selector
  setupAssetTypeSelector();

  // Initialize visual editors
  initializePixelEditor();
  initializeThreeViewer();

  // Set up enhanced hierarchy
  setupEnhancedHierarchy();

  // Set up build interior button
  setupBuildInteriorButton();
}

// Event listeners
function setupEventListeners() {
  // Asset type change
  document.getElementById('assetType').addEventListener('change', handleAssetTypeChange);

  // Parent asset selection
  document.getElementById('parentAsset').addEventListener('change', handleParentAssetChange);

  // Form submission
  document.getElementById('saveDraftBtn').addEventListener('click', () => submitAssetForm(true));
  document.getElementById('publishBtn').addEventListener('click', () => submitAssetForm(false));

  // Image uploads
  document.getElementById('fullscreenImage').addEventListener('change', handleImageUpload);
  document.getElementById('indexCardImage').addEventListener('change', handleImageUpload);

  // Model upload
  document.getElementById('modelFile').addEventListener('change', handleModelUpload);
}

// Asset type handling
async function handleAssetTypeChange(e) {
  const assetType = e.target.value;
  currentAssetType = assetType;

  // Generate type-specific fields
  generateTypeSpecificFields(assetType);

  // Update parent selection
  await updateParentSelection(assetType);

  // Show/hide coordinate fields
  toggleCoordinateFields(assetType);

  // Show/hide build interior button
  toggleBuildInteriorButton(assetType);
}

// Enhanced hierarchy setup
function setupEnhancedHierarchy() {
  const hierarchyMap = {
    'galaxy': { parentTypes: ['anomaly'], label: 'Parent Anomaly', hint: '(optional)' },
    'star': { parentTypes: ['galaxy'], label: 'Parent Galaxy', hint: '(required)', required: true },
    'planet': { parentTypes: ['star'], label: 'Parent Star System', hint: '(required)', required: true },
    'orbital': { parentTypes: ['star', 'planet'], label: 'Parent Location', hint: '(star or planet)', required: true },
    'environment': { parentTypes: ['planet', 'orbital', 'star'], label: 'Parent Location' },
    'zone': { parentTypes: ['planet', 'orbital', 'environment'], label: 'Parent Location' }
  };

  // Store for later use
  window.hierarchyMap = hierarchyMap;
}

// Update parent selection dropdown
async function updateParentSelection(assetType) {
  const hierarchyConfig = window.hierarchyMap[assetType];
  if (!hierarchyConfig) {
    // Hide parent selection for non-hierarchical assets
    document.getElementById('parentAsset').closest('.form-group').style.display = 'none';
    return;
  }

  // Show parent selection
  document.getElementById('parentAsset').closest('.form-group').style.display = 'block';

  // Update label and hint
  document.getElementById('parentAssetLabel').textContent = hierarchyConfig.label;
  document.getElementById('parentAssetHint').textContent = hierarchyConfig.hint || '';

  // Mark as required if needed
  const parentSelect = document.getElementById('parentAsset');
  parentSelect.required = hierarchyConfig.required || false;

  // Fetch parent options
  const parentTypes = hierarchyConfig.parentTypes;
  const parents = [];

  for (const parentType of parentTypes) {
    try {
      const response = await fetch(`/api/v1/assets?assetType=${parentType}&limit=1000`);
      const data = await response.json();
      if (data.success && data.assets) {
        parents.push(...data.assets.map(asset => ({
          ...asset,
          type: parentType
        })));
      }
    } catch (error) {
      console.error(`Error fetching ${parentType} assets:`, error);
    }
  }

  // Populate dropdown
  parentSelect.innerHTML = '<option value="">None (Standalone Asset)</option>';
  parents.forEach(parent => {
    const option = document.createElement('option');
    option.value = parent._id;
    option.textContent = `${parent.title || parent.name} (${parent.type})`;
    option.dataset.parentType = parent.type;
    option.dataset.depth = parent.hierarchy?.depth || 0;
    parentSelect.appendChild(option);
  });
}

// Handle parent asset change
async function handleParentAssetChange(e) {
  const parentId = e.target.value;

  if (!parentId) {
    // Clear hierarchy breadcrumb
    document.getElementById('hierarchyBreadcrumb').style.display = 'none';
    document.getElementById('hierarchyParent').value = '';
    document.getElementById('hierarchyParentType').value = '';
    document.getElementById('hierarchyDepth').value = '0';
    return;
  }

  // Get selected option data
  const selectedOption = e.target.selectedOptions[0];
  const parentType = selectedOption.dataset.parentType;
  const parentDepth = parseInt(selectedOption.dataset.depth) || 0;

  // Update hidden fields
  document.getElementById('hierarchyParent').value = parentId;
  document.getElementById('hierarchyParentType').value = parentType;
  document.getElementById('hierarchyDepth').value = parentDepth + 1;

  // Fetch parent details for breadcrumb
  try {
    const response = await fetch(`/api/v1/assets/${parentId}`);
    const data = await response.json();

    if (data.success && data.asset) {
      displayHierarchyBreadcrumb(data.asset);
    }
  } catch (error) {
    console.error('Error fetching parent asset:', error);
  }
}

// Display hierarchy breadcrumb
function displayHierarchyBreadcrumb(parentAsset) {
  const breadcrumbContainer = document.getElementById('breadcrumbPath');
  breadcrumbContainer.innerHTML = '';

  // Build breadcrumb from parent's path
  const path = parentAsset.hierarchy?.path || [];

  // Add ancestors
  path.forEach((ancestorId, index) => {
    // In a production app, you'd fetch ancestor details
    // For now, show IDs
    const crumb = document.createElement('span');
    crumb.textContent = `Asset ${index + 1}`;
    crumb.style.color = '#888';
    breadcrumbContainer.appendChild(crumb);

    const separator = document.createElement('span');
    separator.textContent = ' → ';
    separator.style.color = '#666';
    breadcrumbContainer.appendChild(separator);
  });

  // Add parent
  const parentCrumb = document.createElement('span');
  parentCrumb.textContent = parentAsset.title || parentAsset.name;
  parentCrumb.style.color = '#00ff88';
  parentCrumb.style.fontWeight = 'bold';
  breadcrumbContainer.appendChild(parentCrumb);

  // Add current asset indicator
  const separator = document.createElement('span');
  separator.textContent = ' → ';
  separator.style.color = '#666';
  breadcrumbContainer.appendChild(separator);

  const currentCrumb = document.createElement('span');
  currentCrumb.textContent = '(This Asset)';
  currentCrumb.style.color = '#8a4fff';
  currentCrumb.style.fontStyle = 'italic';
  breadcrumbContainer.appendChild(currentCrumb);

  // Show breadcrumb
  document.getElementById('hierarchyBreadcrumb').style.display = 'block';
}

// Build interior button setup
function setupBuildInteriorButton() {
  const buildInteriorBtn = document.getElementById('buildInteriorBtn');

  buildInteriorBtn.addEventListener('click', async () => {
    const assetType = document.getElementById('assetType').value;

    if (currentAssetId) {
      // Existing asset - redirect directly
      window.location.href = `/universe/interior-map-builder?parentAssetId=${currentAssetId}&parentAssetType=${assetType}`;
      return;
    }

    // New asset - save as draft first
    showMessage('Saving asset as draft before opening Interior Map Builder...');

    await submitAssetForm(true);

    // Wait for save to complete and redirect
    setTimeout(() => {
      if (currentAssetId) {
        window.location.href = `/universe/interior-map-builder?parentAssetId=${currentAssetId}&parentAssetType=${assetType}`;
      } else {
        showErrorMessage('Failed to save asset. Please try again.');
      }
    }, 1000);
  });
}

// Toggle build interior button visibility
function toggleBuildInteriorButton(assetType) {
  const spatialAssets = ['planet', 'orbital', 'environment', 'zone'];
  const buildInteriorGroup = document.getElementById('buildInteriorGroup');

  if (spatialAssets.includes(assetType)) {
    buildInteriorGroup.style.display = 'block';
  } else {
    buildInteriorGroup.style.display = 'none';
  }
}
```

## Best Practices

### 1. Error Handling

```javascript
// Always wrap API calls in try-catch
async function fetchAsset(assetId) {
  try {
    const response = await fetch(`/api/v1/assets/${assetId}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Unknown error');
    }

    return data.asset;
  } catch (error) {
    console.error('Error fetching asset:', error);
    showErrorMessage(`Failed to load asset: ${error.message}`);
    return null;
  }
}
```

### 2. Form Validation

```javascript
// Validate all required fields before submission
function validateForm() {
  const errors = [];

  // Basic validation
  const requiredFields = ['name', 'assetType'];
  requiredFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (!field.value.trim()) {
      errors.push(`${field.previousElementSibling.textContent} is required`);
    }
  });

  // Hierarchy validation
  const assetType = document.getElementById('assetType').value;
  const hierarchyConfig = window.hierarchyMap[assetType];
  if (hierarchyConfig?.required && !document.getElementById('parentAsset').value) {
    errors.push(`${hierarchyConfig.label} is required for ${assetType}`);
  }

  return errors;
}
```

### 3. User Feedback

```javascript
// Always provide clear feedback
function showMessage(message, type = 'info') {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message message-${type}`;
  messageDiv.textContent = message;

  document.body.appendChild(messageDiv);

  setTimeout(() => {
    messageDiv.classList.add('fade-out');
    setTimeout(() => messageDiv.remove(), 300);
  }, 3000);
}

function showSuccessMessage(message) {
  showMessage(message, 'success');
}

function showErrorMessage(message) {
  showMessage(message, 'error');
}
```

### 4. State Management

```javascript
// Maintain consistent state
const state = {
  currentAssetId: null,
  currentAssetType: null,
  isDirty: false,
  hierarchyData: {},
  uploadedImages: {},

  // Update state
  updateAssetType(type) {
    this.currentAssetType = type;
    this.markDirty();
  },

  markDirty() {
    this.isDirty = true;
  },

  markClean() {
    this.isDirty = false;
  }
};

// Warn user before leaving if form is dirty
window.addEventListener('beforeunload', (e) => {
  if (state.isDirty) {
    e.preventDefault();
    e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
  }
});
```

## Testing

### Manual Testing Checklist

**Basic Functionality:**
- [ ] Asset type selection updates UI correctly
- [ ] Type-specific fields generate properly for all asset types
- [ ] Parent selection shows correct options based on asset type
- [ ] Hierarchy breadcrumb displays correctly
- [ ] Build Interior button appears for spatial assets
- [ ] Image uploads work and show previews
- [ ] Form validation catches missing required fields
- [ ] Save Draft creates unpublished asset
- [ ] Publish creates published asset
- [ ] Edit mode loads existing asset correctly

**Hierarchy Testing:**
- [ ] Creating galaxy with anomaly parent links correctly
- [ ] Creating star with galaxy parent links correctly
- [ ] Creating planet with star parent links correctly
- [ ] Hierarchy depth calculates correctly
- [ ] Hierarchy path array populates correctly
- [ ] Breadcrumb shows full ancestor chain
- [ ] Required parent validation works

**Integration Testing:**
- [ ] Build Interior button saves draft and redirects
- [ ] Build Interior button passes parentAssetId correctly
- [ ] Interior Map Builder receives parent data
- [ ] Save as Zone Asset in Interior Builder links back to parent

## Common Issues & Solutions

### Issue 1: Parent dropdown not populating
**Cause:** API request failing or asset type not in hierarchyMap
**Solution:** Check browser console for errors, verify hierarchyMap includes asset type

### Issue 2: Hierarchy breadcrumb not showing
**Cause:** Parent asset fetch failing or missing hierarchy.path
**Solution:** Ensure parent asset exists and has hierarchy data

### Issue 3: Build Interior button not appearing
**Cause:** Asset type not in spatialAssets array
**Solution:** Add asset type to spatialAssets in toggleBuildInteriorButton()

### Issue 4: Form submission fails with validation errors
**Cause:** Missing required fields or invalid hierarchy
**Solution:** Check validation logic, ensure all required fields have values

### Issue 5: Image uploads not working
**Cause:** Multer configuration or file size limits
**Solution:** Check multer setup in API routes, verify file size under 10MB

## Future Enhancements

### Planned Features:
1. **Undo/Redo functionality** - Track form state changes
2. **Auto-save drafts** - Periodic auto-save every 30 seconds
3. **Asset templates** - Pre-filled forms for common asset types
4. **Bulk import** - Import multiple assets from JSON/CSV
5. **Asset duplication** - Clone existing asset as template
6. **Version history** - Track and restore previous versions
7. **Collaborative editing** - Real-time multi-user editing
8. **Advanced search** - Filter parents by tags, properties
9. **Asset relationships graph** - Visual hierarchy tree viewer
10. **Export assets** - Download asset data as JSON

### Technical Debt:
- Refactor asset-builder-enhanced.js into smaller modules
- Add TypeScript definitions for better type safety
- Implement comprehensive unit tests
- Add E2E tests with Playwright or Cypress
- Optimize parent asset fetching with pagination
- Cache frequently accessed assets client-side
- Add loading states and skeleton screens
- Improve mobile responsiveness

---

**Last Updated:** 2025-11-04
**Version:** 1.0.0
**Maintainer:** Stringborn Development Team
