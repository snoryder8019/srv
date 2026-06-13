/**
 * 3D Ship Builder with Three.js
 * Dynamically assembles ships from GLTF components with texture customization
 */

class ShipBuilder3D {
  constructor(containerId = 'shipCanvas3D') {
    this.container = document.getElementById(containerId);

    // Three.js core objects
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // Ship building
    this.componentManifest = null;
    this.currentShip = {
      name: 'Unnamed Vessel',
      class: 'fighter',
      description: '',
      hull: null,
      engine: null,
      weapons: [],
      customization: {
        primaryColor: '#888888',
        secondaryColor: '#444444',
        accentColor: '#00ffaa',
        materialType: 'metal',
        pattern: null
      },
      stats: {
        hp: 0,
        shield: 0,
        speed: 0,
        maneuverability: 0,
        firepower: 0,
        mass: 0,
        power: 0,
        powerUsed: 0,
        crew: 0
      }
    };

    // Scene groups
    this.shipGroup = new THREE.Group();
    this.hullMesh = null;
    this.engineMeshes = [];
    this.weaponMeshes = [];

    // Loaders
    this.gltfLoader = null;
    this.textureLoader = new THREE.TextureLoader();

    // Lighting
    this.lights = [];

    // Animation
    this.animationId = null;

    this.init();
  }

  async init() {
    console.log('🚀 Initializing 3D Ship Builder...');

    // Setup Three.js scene
    this.setupScene();
    this.setupCamera();
    this.setupRenderer();
    this.setupLighting();
    this.setupControls();

    // Setup loaders
    this.gltfLoader = new THREE.GLTFLoader();

    // Load component manifest
    await this.loadComponentManifest();

    // Add grid helper
    this.addGridHelper();

    // Start animation loop
    this.animate();

    console.log('✅ 3D Ship Builder initialized');
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);
    this.scene.fog = new THREE.Fog(0x0a0a1a, 10, 100);

    this.scene.add(this.shipGroup);
  }

  setupCamera() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.set(8, 5, 8);
    this.camera.lookAt(0, 0, 0);
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.container.appendChild(this.renderer.domElement);
  }

  setupLighting() {
    // Ambient light
    const ambient = new THREE.AmbientLight(0x404060, 0.5);
    this.scene.add(ambient);
    this.lights.push(ambient);

    // Main directional light (key light)
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(5, 10, 7);
    mainLight.castShadow = true;
    mainLight.shadow.camera.near = 0.1;
    mainLight.shadow.camera.far = 50;
    mainLight.shadow.camera.left = -20;
    mainLight.shadow.camera.right = 20;
    mainLight.shadow.camera.top = 20;
    mainLight.shadow.camera.bottom = -20;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    this.scene.add(mainLight);
    this.lights.push(mainLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
    fillLight.position.set(-5, 3, -5);
    this.scene.add(fillLight);
    this.lights.push(fillLight);

    // Rim light
    const rimLight = new THREE.DirectionalLight(0xff88ff, 0.6);
    rimLight.position.set(0, -2, -8);
    this.scene.add(rimLight);
    this.lights.push(rimLight);

    // Accent point lights for dramatic effect
    const accentLight1 = new THREE.PointLight(0x00ffaa, 0.8, 20);
    accentLight1.position.set(5, 2, 5);
    this.scene.add(accentLight1);
    this.lights.push(accentLight1);

    const accentLight2 = new THREE.PointLight(0x8a4fff, 0.6, 15);
    accentLight2.position.set(-4, 1, -4);
    this.scene.add(accentLight2);
    this.lights.push(accentLight2);
  }

  setupControls() {
    if (typeof THREE.OrbitControls === 'undefined') {
      console.warn('⚠️ OrbitControls not loaded, using basic controls');
      return;
    }

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 50;
    this.controls.maxPolarAngle = Math.PI * 0.9;
    this.controls.target.set(0, 0, 0);
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;
  }

  addGridHelper() {
    const gridHelper = new THREE.GridHelper(20, 20, 0x444488, 0x222244);
    gridHelper.position.y = -2;
    this.scene.add(gridHelper);
  }

  async loadComponentManifest() {
    try {
      const response = await fetch('/models/ships/component-manifest.json');
      this.componentManifest = await response.json();
      console.log('✅ Component manifest loaded', this.componentManifest);
      return this.componentManifest;
    } catch (error) {
      console.error('❌ Failed to load component manifest:', error);
      this.componentManifest = this.getDefaultManifest();
      return this.componentManifest;
    }
  }

  getDefaultManifest() {
    // Fallback manifest if file doesn't load
    return {
      hulls: {},
      engines: {},
      weapons: {},
      textures: { materials: { metal: { metalness: 0.8, roughness: 0.3 } } }
    };
  }

  /**
   * Create procedural geometry for components when GLTF not available
   */
  createProceduralHull(hullType) {
    let geometry;
    const material = this.createCustomMaterial();

    switch (hullType) {
      case 'fighter':
        // Sleek fighter shape
        geometry = new THREE.ConeGeometry(0.8, 3, 8);
        geometry.rotateX(Math.PI / 2);
        break;

      case 'corvette':
        // Boxy corvette
        geometry = new THREE.BoxGeometry(2, 1, 4);
        // Add nose cone
        const noseGeom = new THREE.ConeGeometry(0.5, 1.5, 6);
        noseGeom.translate(0, 0, 2.75);
        noseGeom.rotateX(Math.PI / 2);
        geometry = THREE.BufferGeometryUtils.mergeBufferGeometries([geometry, noseGeom]);
        break;

      case 'frigate':
        // Large wedge shape
        const vertices = new Float32Array([
          // Front point
          0, 0, 5,
          // Front edges
          -3, -0.5, 5, 3, -0.5, 5,
          -3, 0.5, 5, 3, 0.5, 5,
          // Back edges
          -3, -1, -5, 3, -1, -5,
          -3, 1, -5, 3, 1, -5
        ]);
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        break;

      case 'cruiser':
        // Massive capital ship
        const mainHull = new THREE.BoxGeometry(4, 2, 10);
        const bridge = new THREE.BoxGeometry(3, 1.5, 3);
        bridge.translate(0, 1.5, 2);
        const nacelle1 = new THREE.CylinderGeometry(0.6, 0.6, 8, 8);
        nacelle1.rotateZ(Math.PI / 2);
        nacelle1.translate(-3, -0.5, -1);
        const nacelle2 = new THREE.CylinderGeometry(0.6, 0.6, 8, 8);
        nacelle2.rotateZ(Math.PI / 2);
        nacelle2.translate(3, -0.5, -1);
        geometry = THREE.BufferGeometryUtils.mergeBufferGeometries([mainHull, bridge, nacelle1, nacelle2]);
        break;

      default:
        geometry = new THREE.BoxGeometry(2, 1, 3);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  createProceduralEngine(engineType) {
    const material = this.createCustomMaterial();

    // Engine body
    const body = new THREE.CylinderGeometry(0.4, 0.5, 1.5, 8);
    body.rotateX(Math.PI / 2);

    // Engine nozzle
    const nozzle = new THREE.CylinderGeometry(0.5, 0.3, 0.5, 8);
    nozzle.rotateX(Math.PI / 2);
    nozzle.translate(0, 0, -1);

    const geometry = THREE.BufferGeometryUtils.mergeBufferGeometries([body, nozzle]);
    const mesh = new THREE.Mesh(geometry, material);

    // Add engine glow
    const glowGeometry = new THREE.CylinderGeometry(0.3, 0.1, 0.3, 8);
    glowGeometry.rotateX(Math.PI / 2);
    glowGeometry.translate(0, 0, -1.2);

    const engineConfig = this.componentManifest?.engines?.[engineType];
    const glowColor = engineConfig?.glowColor || '#4488ff';
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.8
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);

    mesh.add(glow);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  createProceduralWeapon(weaponType) {
    const material = this.createCustomMaterial();

    // Weapon barrel
    const barrel = new THREE.CylinderGeometry(0.1, 0.15, 1.2, 8);
    barrel.rotateX(Math.PI / 2);

    // Weapon mount
    const mount = new THREE.BoxGeometry(0.3, 0.3, 0.4);
    mount.translate(0, 0, -0.4);

    const geometry = THREE.BufferGeometryUtils.mergeBufferGeometries([barrel, mount]);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  createCustomMaterial() {
    const customization = this.currentShip.customization;
    const materialConfig = this.componentManifest?.textures?.materials?.[customization.materialType] || {
      metalness: 0.8,
      roughness: 0.3
    };

    return new THREE.MeshStandardMaterial({
      color: customization.primaryColor,
      metalness: materialConfig.metalness,
      roughness: materialConfig.roughness,
      envMapIntensity: 1.0
    });
  }

  /**
   * Select and add hull component
   */
  async selectHull(hullId) {
    console.log('🛸 Selecting hull:', hullId);

    // Remove existing hull
    if (this.hullMesh) {
      this.shipGroup.remove(this.hullMesh);
      this.hullMesh = null;
    }

    this.currentShip.hull = hullId;

    // Try to load GLTF, fall back to procedural
    const hullConfig = this.componentManifest?.hulls?.[hullId];
    if (hullConfig?.model) {
      try {
        const gltf = await this.loadGLTF(hullConfig.model);
        this.hullMesh = gltf.scene;
      } catch (error) {
        console.warn('⚠️ GLTF not found, using procedural geometry');
        this.hullMesh = this.createProceduralHull(hullId);
      }
    } else {
      this.hullMesh = this.createProceduralHull(hullId);
    }

    this.shipGroup.add(this.hullMesh);
    this.applyCustomization();
    this.calculateStats();

    return this.hullMesh;
  }

  /**
   * Select and add engine component
   */
  async selectEngine(engineId) {
    console.log('⚡ Selecting engine:', engineId);

    // Remove existing engines
    this.engineMeshes.forEach(mesh => this.shipGroup.remove(mesh));
    this.engineMeshes = [];

    this.currentShip.engine = engineId;

    if (!this.currentShip.hull) {
      console.warn('⚠️ Select a hull first');
      return null;
    }

    const hullConfig = this.componentManifest?.hulls?.[this.currentShip.hull];
    const engineConfig = this.componentManifest?.engines?.[engineId];

    if (!hullConfig?.mountPoints) {
      console.warn('⚠️ Hull has no mount points');
      return null;
    }

    // Find engine mount points
    const engineMounts = Object.entries(hullConfig.mountPoints)
      .filter(([key]) => key.startsWith('engine'));

    // Create engine mesh for each mount point
    for (const [mountName, mountData] of engineMounts) {
      let engineMesh;

      // Try to load GLTF
      if (engineConfig?.model) {
        try {
          const gltf = await this.loadGLTF(engineConfig.model);
          engineMesh = gltf.scene.clone();
        } catch (error) {
          engineMesh = this.createProceduralEngine(engineId);
        }
      } else {
        engineMesh = this.createProceduralEngine(engineId);
      }

      // Position at mount point
      if (mountData.position) {
        engineMesh.position.set(...mountData.position);
      }
      if (mountData.rotation) {
        engineMesh.rotation.set(...mountData.rotation);
      }
      if (engineConfig?.scale) {
        engineMesh.scale.setScalar(engineConfig.scale);
      }

      this.shipGroup.add(engineMesh);
      this.engineMeshes.push(engineMesh);
    }

    this.applyCustomization();
    this.calculateStats();

    return this.engineMeshes;
  }

  /**
   * Select and add weapon component
   */
  async selectWeapon(weaponId) {
    console.log('🔫 Selecting weapon:', weaponId);

    // Remove existing weapons
    this.weaponMeshes.forEach(mesh => this.shipGroup.remove(mesh));
    this.weaponMeshes = [];

    // Add weapon to list (support multiple)
    if (!this.currentShip.weapons.includes(weaponId)) {
      this.currentShip.weapons.push(weaponId);
    }

    if (!this.currentShip.hull) {
      console.warn('⚠️ Select a hull first');
      return null;
    }

    const hullConfig = this.componentManifest?.hulls?.[this.currentShip.hull];
    const weaponConfig = this.componentManifest?.weapons?.[weaponId];

    if (!hullConfig?.mountPoints) {
      console.warn('⚠️ Hull has no weapon mount points');
      return null;
    }

    // Find weapon mount points
    const weaponMounts = Object.entries(hullConfig.mountPoints)
      .filter(([key]) => key.startsWith('weapon') || key.startsWith('turret'));

    // Create weapon mesh for each mount point
    for (const [mountName, mountData] of weaponMounts) {
      let weaponMesh;

      // Try to load GLTF
      if (weaponConfig?.model) {
        try {
          const gltf = await this.loadGLTF(weaponConfig.model);
          weaponMesh = gltf.scene.clone();
        } catch (error) {
          weaponMesh = this.createProceduralWeapon(weaponId);
        }
      } else {
        weaponMesh = this.createProceduralWeapon(weaponId);
      }

      // Position at mount point
      if (mountData.position) {
        weaponMesh.position.set(...mountData.position);
      }
      if (mountData.rotation) {
        weaponMesh.rotation.set(...mountData.rotation);
      }
      if (weaponConfig?.scale) {
        weaponMesh.scale.setScalar(weaponConfig.scale);
      }

      this.shipGroup.add(weaponMesh);
      this.weaponMeshes.push(weaponMesh);
    }

    this.applyCustomization();
    this.calculateStats();

    return this.weaponMeshes;
  }

  /**
   * Load GLTF model
   */
  loadGLTF(url) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => resolve(gltf),
        (progress) => {
          const percent = (progress.loaded / progress.total) * 100;
          console.log(`Loading ${url}: ${percent.toFixed(1)}%`);
        },
        (error) => reject(error)
      );
    });
  }

  /**
   * Apply color and material customization
   */
  applyCustomization() {
    const customization = this.currentShip.customization;

    // Update all meshes in ship group
    this.shipGroup.traverse((child) => {
      if (child.isMesh) {
        // Skip engine glow materials
        if (child.material.transparent) return;

        const materialConfig = this.componentManifest?.textures?.materials?.[customization.materialType] || {
          metalness: 0.8,
          roughness: 0.3
        };

        child.material = new THREE.MeshStandardMaterial({
          color: customization.primaryColor,
          metalness: materialConfig.metalness,
          roughness: materialConfig.roughness,
          envMapIntensity: 1.0
        });
      }
    });

    console.log('🎨 Customization applied');
  }

  /**
   * Calculate ship stats based on components
   */
  calculateStats() {
    const stats = this.currentShip.stats;

    // Reset stats
    stats.hp = 0;
    stats.shield = 0;
    stats.speed = 0;
    stats.maneuverability = 0;
    stats.firepower = 0;
    stats.mass = 0;
    stats.power = 0;
    stats.powerUsed = 0;
    stats.crew = 0;

    // Add hull stats
    if (this.currentShip.hull && this.componentManifest?.hulls?.[this.currentShip.hull]) {
      const hullStats = this.componentManifest.hulls[this.currentShip.hull].stats;
      stats.hp = hullStats.hp || 0;
      stats.shield = hullStats.shield || 0;
      stats.mass += hullStats.mass || 0;
      stats.crew = hullStats.crew || 0;
      stats.power = hullStats.power || 0;
    }

    // Add engine stats
    if (this.currentShip.engine && this.componentManifest?.engines?.[this.currentShip.engine]) {
      const engineStats = this.componentManifest.engines[this.currentShip.engine].stats;
      stats.speed = engineStats.speed || 0;
      stats.maneuverability = engineStats.maneuverability || 0;
      stats.powerUsed += engineStats.powerDraw || 0;
    }

    // Add weapon stats
    this.currentShip.weapons.forEach(weaponId => {
      if (this.componentManifest?.weapons?.[weaponId]) {
        const weaponStats = this.componentManifest.weapons[weaponId].stats;
        stats.firepower += weaponStats.dps || 0;
        stats.powerUsed += weaponStats.powerDraw || 0;
      }
    });

    // Dispatch event for UI update
    this.dispatchStatsUpdate();

    return stats;
  }

  dispatchStatsUpdate() {
    const event = new CustomEvent('shipStatsUpdated', {
      detail: { stats: this.currentShip.stats, ship: this.currentShip }
    });
    window.dispatchEvent(event);
  }

  /**
   * Set customization options
   */
  setCustomization(options) {
    Object.assign(this.currentShip.customization, options);
    this.applyCustomization();
    console.log('🎨 Customization updated:', this.currentShip.customization);
  }

  /**
   * Export ship configuration
   */
  exportShipConfig() {
    return JSON.parse(JSON.stringify(this.currentShip));
  }

  /**
   * Export ship as GLTF
   */
  async exportGLTF() {
    if (typeof THREE.GLTFExporter === 'undefined') {
      console.error('❌ GLTFExporter not loaded');
      return null;
    }

    return new Promise((resolve, reject) => {
      const exporter = new THREE.GLTFExporter();
      exporter.parse(
        this.shipGroup,
        (gltf) => resolve(gltf),
        (error) => reject(error),
        { binary: false }
      );
    });
  }

  /**
   * Reset ship to empty state
   */
  reset() {
    // Clear meshes
    this.shipGroup.clear();
    this.hullMesh = null;
    this.engineMeshes = [];
    this.weaponMeshes = [];

    // Reset ship data
    this.currentShip = {
      name: 'Unnamed Vessel',
      class: 'fighter',
      description: '',
      hull: null,
      engine: null,
      weapons: [],
      customization: {
        primaryColor: '#888888',
        secondaryColor: '#444444',
        accentColor: '#00ffaa',
        materialType: 'metal',
        pattern: null
      },
      stats: {
        hp: 0, shield: 0, speed: 0, maneuverability: 0,
        firepower: 0, mass: 0, power: 0, powerUsed: 0, crew: 0
      }
    };

    this.dispatchStatsUpdate();
    console.log('🔄 Ship builder reset');
  }

  /**
   * Toggle auto-rotation
   */
  toggleAutoRotate(enabled) {
    if (this.controls) {
      this.controls.autoRotate = enabled;
    }
  }

  /**
   * Animation loop
   */
  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    if (this.controls) {
      this.controls.update();
    }

    // Gentle rotation of engine glows
    this.engineMeshes.forEach((engine, index) => {
      engine.traverse((child) => {
        if (child.material?.transparent) {
          child.rotation.z += 0.02 * (index % 2 ? 1 : -1);
        }
      });
    });

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Handle window resize
   */
  onWindowResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }

  /**
   * Cleanup
   */
  dispose() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }

    this.scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(material => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });

    this.renderer.dispose();

    if (this.controls) {
      this.controls.dispose();
    }

    console.log('🗑️ Ship builder disposed');
  }
}

// Export for use in browser
if (typeof window !== 'undefined') {
  window.ShipBuilder3D = ShipBuilder3D;
}
