# 3D Galactic Map Migration Plan
## Converting 2D Canvas to Three.js 3D Space

**Date:** October 27, 2025
**Status:** 🚧 Planning Phase
**Priority:** CRITICAL - Major System Overhaul

---

## Executive Summary

**Goal:** Convert the entire galactic map from 2D canvas rendering to full 3D Three.js scene with Z-axis depth.

**Impact:** This affects:
- All database schemas (Assets, Characters, Ships, etc.)
- State manager
- Rendering engine
- Camera controls
- Physics/collision
- UI/HUD overlays

**Timeline:** Multi-phase migration with backwards compatibility

---

## Current State (2D)

### Coordinate System
```javascript
position: {
  x: Number, // Horizontal position
  y: Number  // Vertical position
}
```

### Rendering
- **Engine:** HTML5 Canvas 2D
- **File:** `/srv/ps/public/javascripts/galactic-map-optimized.js`
- **View:** Top-down orthographic
- **Movement:** Pan/Zoom (camera transform)

### Database Models Using 2D
1. **Assets** - ✅ Already has Z! (`coordinates.x, y, z`)
2. **Characters** - Need to check
3. **Ships** - Need to check
4. **Stations** - Need to check
5. **Planets** - Need to check

---

## Target State (3D)

### Coordinate System
```javascript
position: {
  x: Number, // Horizontal position (left/right)
  y: Number, // Vertical position (up/down)
  z: Number  // Depth position (forward/back)
}
```

### Rendering
- **Engine:** Three.js WebGL
- **File:** `/srv/ps/public/javascripts/galactic-map-3d.js` (new)
- **View:** Perspective camera (free rotation)
- **Movement:** WASD + Mouse Look (FPS-style) or Orbit Controls

### Visual Enhancements
- ✨ Depth perception (objects closer = larger)
- ✨ Parallax scrolling (stars at different Z depths)
- ✨ 3D planet models (textured spheres)
- ✨ 3D ship models (GLTF imports)
- ✨ Lighting system (suns emit light)
- ✨ Particle effects (engine trails, explosions)
- ✨ Fog/atmospheric effects
- ✨ Shadows (optional - performance)

---

## Phase 1: Asset Builder Enhancement

### 1.1 GLTF Upload Support

**Add to `/srv/ps/views/assets/builder-enhanced.ejs`:**

```html
<!-- 3D Model Upload (Ships, Weapons, etc.) -->
<div class="form-group" id="gltfUploadSection">
  <label for="gltfFile">3D Model (GLTF/GLB)</label>
  <input type="file" id="gltfFile" accept=".gltf,.glb">
  <small>Upload 3D model in GLTF or GLB format (max 10MB)</small>

  <!-- 3D Preview -->
  <div id="gltfPreview" class="three-viewer" style="display:none;">
    <canvas id="preview Canvas"></canvas>
    <div class="viewer-controls">
      <button onclick="resetCamera()">Reset View</button>
      <button onclick="toggleWireframe()">Wireframe</button>
    </div>
  </div>
</div>
```

**Processing:**
- Upload to Linode: `assets/models/{assetId}.glb`
- Store URL in Asset document
- Generate thumbnail (render screenshot)

### 1.2 Planet Texture Upload

**Add texture upload for planets:**

```html
<!-- Planet Textures -->
<div class="form-group" id="planetTextureSection">
  <label for="planetTexture">Surface Texture</label>
  <input type="file" id="planetTexture" accept="image/png,image/jpeg">
  <small>Equirectangular projection (2:1 ratio, e.g., 4096×2048)</small>

  <label for="normalMap">Normal Map (Optional)</label>
  <input type="file" id="normalMap" accept="image/png">

  <label for="roughnessMap">Roughness Map (Optional)</label>
  <input type="file" id="roughnessMap" accept="image/png">

  <!-- 3D Planet Preview -->
  <div id="planetPreview" class="three-viewer">
    <canvas id="planetCanvas"></canvas>
  </div>
</div>
```

### 1.3 Three.js Preview Viewer

**New file:** `/srv/ps/public/javascripts/three-asset-viewer.js`

```javascript
class AssetViewer {
  constructor(canvasId) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById(canvasId),
      antialias: true
    });

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.init();
  }

  loadGLTF(url) {
    const loader = new THREE.GLTFLoader();
    loader.load(url, (gltf) => {
      this.scene.add(gltf.scene);
      this.fitCameraToObject(gltf.scene);
    });
  }

  loadPlanet(textureUrl, normalUrl, roughnessUrl) {
    const geometry = new THREE.SphereGeometry(5, 64, 64);
    const material = new THREE.MeshStandardMaterial({
      map: new THREE.TextureLoader().load(textureUrl),
      normalMap: normalUrl ? new THREE.TextureLoader().load(normalUrl) : null,
      roughnessMap: roughnessUrl ? new THREE.TextureLoader().load(roughnessUrl) : null,
    });

    const planet = new THREE.Mesh(geometry, material);
    this.scene.add(planet);
  }
}
```

---

## Phase 2: Database Schema Migration

### 2.1 Add Z Coordinate to Collections

**Collections needing Z coordinate:**

```javascript
// Characters collection
{
  position: {
    x: Number,
    y: Number,
    z: Number // ADD THIS
  }
}

// Ships collection (if separate from Assets)
{
  position: {
    x: Number,
    y: Number,
    z: Number // ADD THIS
  }
}

// Any other movable entities...
```

### 2.2 Migration Script

**New file:** `/srv/ps/scripts/migrate-to-3d-coordinates.js`

```javascript
import { getDb } from '../plugins/mongo/mongo.js';

async function migrateCoordinates() {
  const db = getDb();

  // Add Z=0 to all existing documents
  const collections = ['characters', 'ships', 'stations'];

  for (const collName of collections) {
    const result = await db.collection(collName).updateMany(
      { 'position.z': { $exists: false } },
      { $set: { 'position.z': 0 } }
    );

    console.log(`✓ Migrated ${result.modifiedCount} documents in ${collName}`);
  }

  // Assets already have Z, but default old ones to 0
  await db.collection('assets').updateMany(
    { 'coordinates.z': { $exists: false } },
    { $set: { 'coordinates.z': 0 } }
  );
}

migrateCoordinates();
```

**Run once:**
```bash
node scripts/migrate-to-3d-coordinates.js
```

---

## Phase 3: Three.js Galactic Map

### 3.1 New Rendering Engine

**New file:** `/srv/ps/public/javascripts/galactic-map-3d.js`

```javascript
class GalacticMap3D {
  constructor() {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000011);

    // Camera setup
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      10000
    );
    this.camera.position.set(0, 0, 100);

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('mapContainer').appendChild(this.renderer.domElement);

    // Controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0x404040);
    this.scene.add(this.ambientLight);

    // Asset containers
    this.assets = new Map();
    this.characters = new Map();
    this.ships = new Map();

    this.init();
  }

  init() {
    this.createStarfield();
    this.setupEventListeners();
    this.animate();
  }

  createStarfield() {
    const starsGeometry = new THREE.BufferGeometry();
    const starsMaterial = new THREE.PointsMaterial({ color: 0xFFFFFF, size: 0.7 });

    const starsVertices = [];
    for (let i = 0; i < 10000; i++) {
      const x = (Math.random() - 0.5) * 2000;
      const y = (Math.random() - 0.5) * 2000;
      const z = (Math.random() - 0.5) * 2000;
      starsVertices.push(x, y, z);
    }

    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
    const starField = new THREE.Points(starsGeometry, starsMaterial);
    this.scene.add(starField);
  }

  addAsset(assetData) {
    const { _id, assetType, coordinates, modelUrl, textureUrl } = assetData;

    let mesh;

    if (assetType === 'planet' && textureUrl) {
      // Create planet sphere
      const geometry = new THREE.SphereGeometry(assetData.radius || 5, 32, 32);
      const material = new THREE.MeshStandardMaterial({
        map: new THREE.TextureLoader().load(textureUrl)
      });
      mesh = new THREE.Mesh(geometry, material);
    } else if (modelUrl) {
      // Load GLTF model
      const loader = new THREE.GLTFLoader();
      loader.load(modelUrl, (gltf) => {
        mesh = gltf.scene;
        mesh.position.set(coordinates.x, coordinates.y, coordinates.z);
        this.scene.add(mesh);
        this.assets.set(_id, mesh);
      });
      return; // Async load
    } else {
      // Fallback: colored sphere
      const geometry = new THREE.SphereGeometry(1, 16, 16);
      const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      mesh = new THREE.Mesh(geometry, material);
    }

    mesh.position.set(coordinates.x, coordinates.y, coordinates.z);
    mesh.userData = assetData;
    this.scene.add(mesh);
    this.assets.set(_id, mesh);
  }

  updateCharacterPosition(characterId, position) {
    const character = this.characters.get(characterId);
    if (character) {
      character.position.set(position.x, position.y, position.z);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// Initialize
const galacticMap = new GalacticMap3D();
```

### 3.2 Asset Loading from API

```javascript
async function loadAssets() {
  const response = await fetch('/api/v1/assets/approved/list?limit=1000');
  const data = await response.json();

  data.assets.forEach(asset => {
    galacticMap.addAsset(asset);
  });
}
```

---

## Phase 4: State Manager Update

### 4.1 Character Movement in 3D

**Update character location API:**

```javascript
// POST /api/v1/characters/:id/location
{
  position: {
    x: Number,
    y: Number,
    z: Number // NEW
  }
}
```

### 4.2 Movement Controls

**WASD + QE for Z-axis:**
- W: Forward (increase Z or move toward camera direction)
- S: Backward (decrease Z)
- A: Left (decrease X)
- D: Right (increase X)
- Q: Down (decrease Y)
- E: Up (increase Y)
- Mouse: Rotate camera

---

## Phase 5: Backwards Compatibility

### 5.1 Feature Flag

```javascript
const USE_3D_MAP = true; // Toggle in settings

if (USE_3D_MAP) {
  import('./galactic-map-3d.js');
} else {
  import('./galactic-map-optimized.js');
}
```

### 5.2 Fallback for Old Data

```javascript
// If Z is missing, default to 0
const position = {
  x: data.x,
  y: data.y,
  z: data.z || 0
};
```

---

## Required Dependencies

### npm Packages

```bash
npm install three
npm install three-gltf-loader
npm install three-orbit-controls
```

### CDN Alternative

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.150.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.150.0/examples/js/loaders/GLTFLoader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.150.0/examples/js/controls/OrbitControls.js"></script>
```

---

## Performance Considerations

### Optimization Strategies

1. **LOD (Level of Detail)**
   - Use lower poly models for distant objects
   - Switch to billboards/sprites at extreme distances

2. **Frustum Culling**
   - Only render objects in camera view
   - Three.js does this automatically

3. **Instance Rendering**
   - Use THREE.InstancedMesh for stars/asteroids
   - Batch similar objects

4. **Texture Compression**
   - Use compressed texture formats (KTX2, Basis)
   - Mipmaps for textures

5. **Lazy Loading**
   - Load assets on-demand
   - Unload far assets

---

## Testing Plan

### Phase 1: Asset Builder
- [ ] Upload GLTF model
- [ ] Preview in Three.js viewer
- [ ] Upload planet texture
- [ ] Preview textured sphere
- [ ] Save to database and Linode

### Phase 2: Database
- [ ] Run migration script
- [ ] Verify Z coordinates added
- [ ] Test API endpoints with Z

### Phase 3: Rendering
- [ ] Load 3D map
- [ ] Render assets in 3D space
- [ ] Camera controls work
- [ ] Character movement in 3D

### Phase 4: Integration
- [ ] Switching between 2D/3D works
- [ ] State syncs across clients
- [ ] Performance is acceptable

---

## Rollout Strategy

### Week 1: Preparation
- Asset Builder GLTF support
- Database migration script
- Three.js viewer prototype

### Week 2: Development
- Build 3D galactic map
- Migrate state manager
- Update APIs

### Week 3: Testing
- Internal testing with 3D map
- Performance profiling
- Bug fixes

### Week 4: Launch
- Feature flag to enable 3D
- Gradual rollout to users
- Monitor performance

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance issues | High | LOD, culling, optimization |
| Browser compatibility | Medium | WebGL fallback, feature detection |
| Learning curve | Low | Tutorial/help system |
| Data migration errors | High | Backup database, test script thoroughly |
| Three.js complexity | Medium | Start simple, iterate |

---

## Success Metrics

- ✅ All assets render in 3D
- ✅ Frame rate >30 FPS with 1000+ objects
- ✅ Camera controls are smooth
- ✅ No database migration errors
- ✅ Users can navigate 3D space intuitively

---

**End of Plan - Ready to Execute!**
