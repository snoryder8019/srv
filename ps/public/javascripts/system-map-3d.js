/**
 * 3D Galactic Map Renderer
 *
 * A colorful, map-like view of the galaxy using Three.js
 * - Points for stars, planets, and assets
 * - Wireframe connections between systems
 * - Top-down view with Z-depth for visual interest
 * - Pan/zoom controls (map-style, NOT 3rd person)
 *
 * Note: Full 3D navigation is for solar system view only
 */

class GalacticMap3D {
  constructor(containerId = 'mapContainer') {
    this.container = document.getElementById(containerId);
    this.combatModeActive = false; // Track if combat system has taken over

    // Scene setup
    this.scene = new THREE.Scene();

    // Pure black background - starfield will provide depth
    this.scene.background = new THREE.Color(0x000000);

    // NO FOG - was blinding the view
    // this.scene.fog = new THREE.Fog(0x000814, 50000, 80000); // DISABLED

    // Camera setup (orthographic for map-like view)
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 2500; // Large enough to see galaxies at -2000 to +2000
    this.camera = new THREE.OrthographicCamera(
      frustumSize * aspect / -2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      150000 // Far plane increased to show entire system (75,000+ unit radius)
    );
    this.camera.position.set(0, 1000, 1500); // High up for better galactic overview
    this.camera.lookAt(0, 0, 0);

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    // CSS2D Renderer for text labels (pilot names)
    if (typeof THREE.CSS2DRenderer !== 'undefined') {
      this.labelRenderer = new THREE.CSS2DRenderer();
      this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
      this.labelRenderer.domElement.style.position = 'absolute';
      this.labelRenderer.domElement.style.top = '0';
      this.labelRenderer.domElement.style.pointerEvents = 'none';
      this.container.appendChild(this.labelRenderer.domElement);
      console.log('✅ CSS2D Label Renderer initialized for pilot names');
    } else {
      console.warn('⚠️ CSS2DRenderer not available - pilot name labels will not be displayed');
      this.labelRenderer = null;
    }

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0x404060, 1.5); // Soft ambient
    this.scene.add(this.ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 200, 100);
    this.scene.add(directionalLight);

    // Asset containers
    this.assets = new Map();
    this.stars = new Map();
    this.planets = new Map();
    this.connections = new Map();

    // Groups for organization
    this.starfieldGroup = new THREE.Group();
    this.assetsGroup = new THREE.Group();
    this.connectionsGroup = new THREE.Group();
    this.selectionGroup = new THREE.Group(); // For selection line and effects
    this.scene.add(this.starfieldGroup);
    this.scene.add(this.assetsGroup);
    this.scene.add(this.connectionsGroup);
    this.scene.add(this.selectionGroup);

    // Interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.selectedObject = null;
    this.selectionLine = null; // Track the selection line

    // Camera lock modes: 'ship', 'planet', 'free'
    this.cameraLockMode = 'ship'; // Default to ship
    this.cameraLockTarget = null; // Object to lock camera on

    // Create a simple player ship object for camera tracking
    this.playerShip = null; // Will be initialized after assets load

    // OrbitControls for camera (3D navigation)
    // Wait for OrbitControls to be loaded from module
    if (window.OrbitControls) {
      this.controls = new window.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableRotate = true; // Enable rotation for 3D view
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.screenSpacePanning = false; // Use orbit panning
      this.controls.minZoom = 0.1;
      this.controls.maxZoom = 10;
      this.controls.target.set(0, 0, 0);

      // Rotation constraints for better UX
      this.controls.minPolarAngle = 0; // Allow full vertical rotation
      this.controls.maxPolarAngle = Math.PI; // Allow full vertical rotation

      // Mouse button mappings
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,   // Left click rotates
        MIDDLE: THREE.MOUSE.DOLLY,  // Middle click zooms
        RIGHT: THREE.MOUSE.PAN      // Right click pans
      };
    } else {
      console.warn('OrbitControls not loaded yet, using basic controls');
      this.controls = null;
    }

    // Camera zoom level for UI
    this.zoomLevel = 1;

    this.init();
  }

  init() {
    this.createStarfield();
    // this.createTestSpheres(); // Debug helper - disabled
    this.setupControls();
    this.setupEventListeners();
    this.animate();

    console.log('✅ 3D Galactic Map initialized');
  }

  /**
   * Create test spheres at known positions (for debugging)
   */
  createTestSpheres() {
    console.log('🔍 Creating test spheres for debugging...');

    const testPositions = [
      { x: 0, y: 0, z: 0, color: 0xff0000, size: 10 },      // Red at origin
      { x: 50, y: 0, z: 0, color: 0x00ff00, size: 8 },      // Green +X
      { x: -50, y: 0, z: 0, color: 0x0000ff, size: 8 },     // Blue -X
      { x: 0, y: 0, z: 50, color: 0xffff00, size: 8 },      // Yellow +Z
      { x: 0, y: 0, z: -50, color: 0xff00ff, size: 8 }      // Magenta -Z
    ];

    testPositions.forEach((pos, i) => {
      const geometry = new THREE.SphereGeometry(pos.size, 16, 16);
      const material = new THREE.MeshBasicMaterial({ color: pos.color });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(pos.x, pos.y, pos.z);
      this.scene.add(mesh);
      console.log(`Test sphere ${i}: ${pos.color.toString(16)} at (${pos.x}, ${pos.y}, ${pos.z})`);
    });

    console.log('✅ Test spheres created');
  }

  /**
   * Create 3D starfield sphere surrounding the camera
   * Stars distributed in a spherical volume for immersive background
   * MASSIVE scale for solar system view
   */
  createStarfield() {
    const layers = [
      { count: 5000, size: 1.5, radius: 80000, color: 0x4466aa }, // Very distant dim blue stars
      { count: 4000, size: 2.0, radius: 70000, color: 0x6688cc }, // Distant stars
      { count: 3000, size: 2.5, radius: 60000, color: 0x8899dd }  // Medium distance stars
    ];

    layers.forEach(layer => {
      const geometry = new THREE.BufferGeometry();
      const positions = [];

      for (let i = 0; i < layer.count; i++) {
        // Generate random point on/in sphere using spherical coordinates
        const theta = Math.random() * Math.PI * 2; // Azimuth angle (0 to 2π)
        const phi = Math.acos((Math.random() * 2) - 1); // Polar angle (0 to π)
        const r = layer.radius * (0.9 + Math.random() * 0.1); // Radius with slight variation

        // Convert spherical to Cartesian coordinates
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        positions.push(x, y, z);
      }

      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

      const material = new THREE.PointsMaterial({
        color: layer.color,
        size: layer.size,
        sizeAttenuation: false, // Keep constant size regardless of distance
        transparent: true,
        opacity: 0.7 // Enhanced visibility for motion orientation
      });

      const stars = new THREE.Points(geometry, material);
      this.starfieldGroup.add(stars);
    });

    console.log('✨ Starfield created with pinpoint stars on distant sphere');
  }

  /**
   * Add asset to the map (planets, stations, etc.)
   * @param {Object} assetData - Asset data from API
   */
  addAsset(assetData) {
    const { _id, assetType, coordinates, title, stats } = assetData;

    // Skip assets without any coordinates at all
    if (!coordinates && !assetData.coordinates3D) {
      console.warn(`⚠️ Asset "${title}" (${assetType}) has no coordinates`);
      return;
    }

    // For system view: prioritize coordinates3D for proper 3D positioning
    let position;

    if (assetType === 'star') {
      // USE REAL STAR COORDINATES - planets are positioned relative to their actual positions
      if (assetData.coordinates3D && (assetData.coordinates3D.x !== undefined || assetData.coordinates3D.y !== undefined || assetData.coordinates3D.z !== undefined)) {
        position = new THREE.Vector3(
          assetData.coordinates3D.x || 0,
          assetData.coordinates3D.y || 0,
          assetData.coordinates3D.z || 0
        );
        console.log(`✅ Adding ${assetType}: ${title} at 3D coords (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
      } else if (assetData.localCoordinates) {
        position = new THREE.Vector3(
          assetData.localCoordinates.x || 0,
          assetData.localCoordinates.y || 0,
          assetData.localCoordinates.z || 0
        );
        console.log(`✅ Adding ${assetType}: ${title} at local coords (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
      } else {
        // Fallback to universal coordinates
        position = new THREE.Vector3(
          coordinates?.x || 0,
          coordinates?.y || 0,
          coordinates?.z || 0
        );
        console.log(`✅ Adding ${assetType}: ${title} at universal (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
      }
    } else if (assetData.coordinates3D && (assetData.coordinates3D.x !== undefined || assetData.coordinates3D.y !== undefined || assetData.coordinates3D.z !== undefined)) {
      // USE coordinates3D - this is the proper scattered position!
      position = new THREE.Vector3(
        assetData.coordinates3D.x || 0,
        assetData.coordinates3D.y || 0,
        assetData.coordinates3D.z || 0
      );
      console.log(`✅ Adding ${assetType}: ${title} at 3D coords (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
    } else if ((assetType === 'planet' || assetType === 'orbital' || assetType === 'station') && assetData.localCoordinates) {
      // Fallback: use local coordinates
      position = new THREE.Vector3(
        assetData.localCoordinates.x,
        assetData.localCoordinates.y,
        assetData.localCoordinates.z || 0
      );
      console.log(`✅ Adding ${assetType}: ${title} at local (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
    } else {
      // Final fallback to universal coordinates
      position = new THREE.Vector3(
        coordinates?.x || 0,
        coordinates?.y || 0,
        coordinates?.z || 0
      );
      console.log(`✅ Adding ${assetType}: ${title} at universal (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
    }

    // Color by asset type
    const colorMap = {
      // Celestial Bodies
      galaxy: 0xbb88ff,    // Purple - Large galactic structures
      star: 0xffff00,      // Yellow - Stars
      planet: 0x00ff88,    // Green - Planets
      orbital: 0xff6600,   // Orange - Moons, stations, orbitals

      // Structures & Stations
      station: 0xff6600,   // Orange - Space stations
      structure: 0xcc9966, // Brown - Structures

      // Anomalies & Zones
      anomaly: 0xff00ff,   // Magenta - Anomalies (temporal, quantum)
      zone: 0x00ffff,      // Cyan - Zones
      environment: 0x88ff88, // Light green - Environments
      nebula: 0xff00ff,    // Magenta - Nebulae

      // Ships & Characters
      ship: 0x00aaff,      // Blue - Ships
      character: 0x0088ff, // Darker blue - Characters

      // Items & Equipment
      weapon: 0xff4444,    // Red - Weapons
      armor: 0x888888,     // Gray - Armor
      module: 0x44ff44,    // Light green - Ship modules
      consumable: 0xffaa44, // Orange - Consumables
      item: 0xaaaaaa,      // Light gray - Generic items

      // Other
      asteroid: 0x666666,  // Dark gray - Asteroids
      default: 0xffffff    // White - Unknown
    };

    const color = colorMap[assetType] || colorMap.default;

    // Size by asset type or stats (realistic solar system scale)
    let size = 1.5;
    if (assetType === 'galaxy') size = 4;        // Largest
    else if (assetType === 'star') size = 50;    // MASSIVE - sun is huge compared to everything
    else if (assetType === 'planet') size = 2;   // Small - planets are tiny compared to star
    else if (assetType === 'orbital') size = 0.8; // Very small - moons
    else if (assetType === 'station') size = 0.8; // Very small - stations
    else if (assetType === 'anomaly') size = 2.5; // Large (notable)
    else if (assetType === 'zone') size = 3;      // Large area
    else if (assetType === 'ship') size = 0.3;    // Minuscule compared to planets
    else if (assetType === 'character') size = 1; // Smallest
    else if (stats && stats.size) size = stats.size;

    // Create geometry based on asset type
    let geometry, material, mesh, glow;

    if (assetType === 'zone') {
      // Zones: Wireframe torus ring for visual distinction
      geometry = new THREE.TorusGeometry(size * 8, size * 0.5, 8, 24);
      material = new THREE.MeshBasicMaterial({
        color: color,
        wireframe: true,
        transparent: true,
        opacity: 0.6
      });

      mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.rotation.x = Math.PI / 2; // Lay flat

      // Zone glow: larger torus ring
      const glowGeometry = new THREE.TorusGeometry(size * 9, size * 0.8, 8, 24);
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: color,
        wireframe: true,
        transparent: true,
        opacity: 0.2
      });
      glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.position.copy(position);
      glow.rotation.x = Math.PI / 2;

    } else {
      // Regular assets: HUGE, ULTRA-BRIGHT spheres for system view
      const adjustedSize = size * 8; // Make them 8x bigger for close-up system view
      geometry = new THREE.SphereGeometry(adjustedSize, 32, 32); // Very high resolution

      // SUPER brighten colors to almost neon
      const colorObj = new THREE.Color(color);
      colorObj.multiplyScalar(3.0); // Ultra bright - neon-like

      material = new THREE.MeshBasicMaterial({
        color: colorObj,
        transparent: false,
        opacity: 1.0,
        depthTest: true,
        depthWrite: true
      });

      mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);

      // Add bright outer glow sphere for extra visibility
      // But make it smaller for stars to avoid clutter at center
      const glowMultiplier = assetType === 'star' ? 1.1 : 1.4; // Stars get smaller glow
      const glowOpacity = assetType === 'star' ? 0.2 : 0.5; // Stars get fainter glow

      const glowGeometry = new THREE.SphereGeometry(adjustedSize * glowMultiplier, 32, 32);
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: colorObj,
        transparent: true,
        opacity: glowOpacity,
        side: THREE.BackSide
      });
      glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.position.copy(position);
    }

    // Store metadata
    mesh.userData = {
      id: _id,
      type: assetType,
      title: title,
      data: assetData
    };

    // Copy userData to glow so it can also be clicked
    if (glow) {
      glow.userData = {
        id: _id,
        type: assetType,
        title: title,
        data: assetData
      };
    }

    this.assetsGroup.add(mesh);
    if (glow) this.assetsGroup.add(glow);
    this.assets.set(_id, { mesh, glow });

    // Separate tracking by type
    if (assetType === 'star') {
      this.stars.set(_id, mesh);
    } else if (assetType === 'planet') {
      this.planets.set(_id, mesh);
    }

    console.log(`✅ Added to scene. Assets in group: ${this.assetsGroup.children.length}, Total tracked: ${this.assets.size}`);
  }

  /**
   * Create wireframe connection between two assets
   * @param {String} fromId - Source asset ID
   * @param {String} toId - Target asset ID
   * @param {Number} color - Line color (hex)
   */
  addConnection(fromId, toId, color = 0x4488ff) {
    const fromAsset = this.assets.get(fromId);
    const toAsset = this.assets.get(toId);

    if (!fromAsset || !toAsset) {
      console.warn(`Cannot create connection: ${fromId} -> ${toId}`);
      return;
    }

    const points = [
      fromAsset.mesh.position,
      toAsset.mesh.position
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.4,
      linewidth: 1
    });

    const line = new THREE.Line(geometry, material);
    this.connectionsGroup.add(line);

    const connectionId = `${fromId}-${toId}`;
    this.connections.set(connectionId, line);
  }

  /**
   * Update character position (for real-time movement)
   * @param {String} characterId - Character ID
   * @param {Object} position - {x, y, z} coordinates
   */
  updateCharacterPosition(characterId, position) {
    const asset = this.assets.get(characterId);
    if (asset) {
      asset.mesh.position.set(position.x, position.y, position.z);
      asset.glow.position.set(position.x, position.y, position.z);
    }
  }

  /**
   * Setup camera controls and interactions
   */
  setupControls() {
    const canvas = this.renderer.domElement;

    // Update mouse position for raycasting
    canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    // Click to select (only when not dragging)
    let mouseDownPos = null;
    canvas.addEventListener('mousedown', (e) => {
      mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('click', (e) => {
      // Only trigger click if mouse didn't move (not dragging)
      if (mouseDownPos) {
        const dist = Math.sqrt(
          Math.pow(e.clientX - mouseDownPos.x, 2) +
          Math.pow(e.clientY - mouseDownPos.y, 2)
        );
        if (dist < 5) { // 5px threshold
          this.handleClick(e);
        }
      }
      mouseDownPos = null;
    });
  }

  /**
   * Handle object selection
   */
  handleClick(event) {
    console.log('🖱️ Click detected, checking for intersections...');
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects(this.assetsGroup.children, true);
    console.log(`Found ${intersects.length} intersections`);

    if (intersects.length > 0) {
      const object = intersects[0].object;
      console.log('Clicked object:', object.userData);

      if (object.userData && object.userData.id) {
        console.log('✅ Valid object clicked, selecting...');
        this.selectObject(object);
      } else {
        console.log('⚠️ Object has no valid userData.id');
      }
    } else {
      console.log('No intersections, deselecting');
      this.deselectObject();
    }
  }

  /**
   * Select an object
   */
  selectObject(object) {
    // Deselect previous
    if (this.selectedObject) {
      if (this.selectedObject.material.emissive) {
        this.selectedObject.material.emissive.setHex(0x000000);
      }
      // Restore original opacity for wireframe
      if (this.selectedObject.material.wireframe) {
        this.selectedObject.material.opacity = 0.6;
      }
    }

    // Remove old selection line if it exists
    if (this.selectionLine) {
      this.selectionGroup.remove(this.selectionLine);
      this.selectionLine.geometry.dispose();
      this.selectionLine.material.dispose();
      this.selectionLine = null;
    }

    // Select new
    this.selectedObject = object;

    // Highlight based on material type
    if (object.material.emissive) {
      object.material.emissive.setHex(0x00d4ff); // Neon blue highlight
    } else if (object.material.wireframe) {
      // For wireframe (zones), increase opacity
      object.material.opacity = 1.0;
    }

    // Create 3D line connector from SHIP to planet (not camera)
    const objectPos = object.position.clone();

    // Try to get ship position from combat system
    let shipPos;
    if (window.shipCombatSystem && window.shipCombatSystem.playerShip && window.shipCombatSystem.playerShip.position) {
      shipPos = new THREE.Vector3(
        window.shipCombatSystem.playerShip.position.x,
        window.shipCombatSystem.playerShip.position.y,
        window.shipCombatSystem.playerShip.position.z
      );
      console.log(`📍 Drawing line from ship at (${shipPos.x.toFixed(1)}, ${shipPos.y.toFixed(1)}, ${shipPos.z.toFixed(1)}) to planet`);
    } else {
      // Fallback to camera if ship not available
      shipPos = this.camera.position.clone();
      console.log(`📍 Ship not found, drawing line from camera position`);
    }

    const points = [shipPos, objectPos];
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);

    // Neon blue glowing line material
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00d4ff, // Light neon blue
      transparent: true,
      opacity: 0.6,
      linewidth: 2
    });

    this.selectionLine = new THREE.Line(lineGeometry, lineMaterial);
    this.selectionGroup.add(this.selectionLine);

    // Focus camera on selected object
    this.focusCameraOn(object.position);

    // Auto-switch to planet lock mode when planet is selected
    this.setCameraLockMode('planet');

    // Emit event for UI to handle with proper coordinate structure
    const event = new CustomEvent('assetSelected', {
      detail: {
        title: object.userData.title,
        type: object.userData.type,
        data: {
          _id: object.userData.id,
          coordinates: {
            x: object.position.x,
            y: object.position.y,
            z: object.position.z
          },
          description: object.userData.data?.description,
          stats: object.userData.data?.stats
        }
      }
    });
    window.dispatchEvent(event);

    console.log('Selected:', object.userData.title);
  }

  /**
   * Focus camera on a specific position
   * @param {THREE.Vector3} position - Target position
   * @param {Number} duration - Animation duration in ms
   */
  focusCameraOn(position, duration = 1000) {
    if (!this.controls) return;

    console.log(`🎯 Focusing camera on (${position.x}, ${position.y}, ${position.z})`);

    // Animate controls target
    const startTarget = this.controls.target.clone();
    const endTarget = position.clone();
    const startTime = Date.now();

    const animateCamera = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-in-out function
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Interpolate target
      this.controls.target.lerpVectors(startTarget, endTarget, eased);
      this.controls.update();

      if (progress < 1) {
        requestAnimationFrame(animateCamera);
      } else {
        console.log('✅ Camera focus complete');
      }
    };

    animateCamera();
  }

  /**
   * Deselect current object
   */
  deselectObject() {
    if (this.selectedObject) {
      // Reset highlight based on material type
      if (this.selectedObject.material.emissive) {
        this.selectedObject.material.emissive.setHex(0x000000);
      }
      // Restore original opacity for wireframe
      if (this.selectedObject.material.wireframe) {
        this.selectedObject.material.opacity = 0.6;
      }
      this.selectedObject = null;
    }

    // Remove selection line
    if (this.selectionLine) {
      this.selectionGroup.remove(this.selectionLine);
      this.selectionLine.geometry.dispose();
      this.selectionLine.material.dispose();
      this.selectionLine = null;
    }

    const event = new CustomEvent('assetDeselected');
    window.dispatchEvent(event);
  }

  /**
   * Set camera lock mode
   * @param {String} mode - 'ship', 'planet', or 'free'
   */
  setCameraLockMode(mode) {
    console.log(`📷 Switching camera lock to: ${mode}`);
    this.cameraLockMode = mode;

    if (mode === 'ship') {
      // Lock to ship
      this.cameraLockTarget = null;

      // Immediately start transitioning camera to ship
      if (window.shipCombatSystem && window.shipCombatSystem.playerShip) {
        const shipPos = window.shipCombatSystem.playerShip.position;
        console.log(`🚀 Camera locked to ship at (${shipPos.x.toFixed(1)}, ${shipPos.y.toFixed(1)}, ${shipPos.z.toFixed(1)})`);

        // Set orbit target to ship immediately for responsive feel
        if (this.controls) {
          this.controls.target.set(shipPos.x, shipPos.y, shipPos.z);
        }
      } else {
        console.log('🚀 Camera locked to ship (ship will load)');
      }
    } else if (mode === 'planet' && this.selectedObject) {
      // Lock to selected planet
      this.cameraLockTarget = this.selectedObject;
      console.log(`🪐 Camera locked to planet: ${this.selectedObject.userData.title}`);
    } else if (mode === 'free') {
      // Free camera movement
      this.cameraLockTarget = null;
      console.log('🆓 Camera in free mode');
    }

    // Emit event for UI updates
    window.dispatchEvent(new CustomEvent('cameraLockChanged', { detail: { mode } }));
  }

  /**
   * Setup window resize handler
   */
  setupEventListeners() {
    window.addEventListener('resize', () => {
      const aspect = window.innerWidth / window.innerHeight;
      const frustumSize = 200 * this.zoomLevel;

      this.camera.left = frustumSize * aspect / -2;
      this.camera.right = frustumSize * aspect / 2;
      this.camera.top = frustumSize / 2;
      this.camera.bottom = frustumSize / -2;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(window.innerWidth, window.innerHeight);

      // Update label renderer size too
      if (this.labelRenderer) {
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
      }
    });
  }

  /**
   * Animation loop
   */
  animate() {
    // Skip if combat system has taken over
    if (this.combatModeActive) {
      return;
    }

    requestAnimationFrame(() => this.animate());

    // Update OrbitControls (if available and enabled)
    if (this.controls && this.controls.enabled) {
      // Handle camera lock modes
      if (this.cameraLockMode === 'ship' && window.shipCombatSystem && window.shipCombatSystem.playerShip) {
        // Lock camera orbit target to ship position
        const shipPos = window.shipCombatSystem.playerShip.position;

        // Smoothly transition camera to orbit the ship
        const currentTarget = this.controls.target;
        const distance = currentTarget.distanceTo(shipPos);

        if (distance > 10) {
          // If far from ship, smoothly interpolate camera and target
          currentTarget.lerp(shipPos, 0.05); // Smooth transition to ship position

          // Also move camera to maintain relative offset
          const offset = new THREE.Vector3().subVectors(this.camera.position, currentTarget);
          const desiredCameraPos = new THREE.Vector3().addVectors(shipPos, offset);
          this.camera.position.lerp(desiredCameraPos, 0.05);
        } else {
          // Close enough, just set target directly
          this.controls.target.set(shipPos.x, shipPos.y, shipPos.z);
        }
      } else if (this.cameraLockMode === 'planet' && this.cameraLockTarget) {
        // Lock camera orbit target to selected planet
        const planetPos = this.cameraLockTarget.position;
        this.controls.target.set(planetPos.x, planetPos.y, planetPos.z);
      }
      // 'free' mode doesn't change the target

      this.controls.update();
    }

    // Update selection line position when ship/camera moves
    if (this.selectionLine && this.selectedObject) {
      const positions = this.selectionLine.geometry.attributes.position.array;
      const objectPos = this.selectedObject.position;

      // Use ship position if available, otherwise camera
      let shipPos;
      if (window.shipCombatSystem && window.shipCombatSystem.playerShip && window.shipCombatSystem.playerShip.position) {
        shipPos = window.shipCombatSystem.playerShip.position;
      } else {
        shipPos = this.camera.position;
      }

      positions[0] = shipPos.x;
      positions[1] = shipPos.y;
      positions[2] = shipPos.z;
      positions[3] = objectPos.x;
      positions[4] = objectPos.y;
      positions[5] = objectPos.z;

      this.selectionLine.geometry.attributes.position.needsUpdate = true;
    }

    // Update zoom level for UI (based on camera zoom)
    this.zoomLevel = this.camera.zoom;

    // Move starfield to follow camera (so it acts as distant background)
    this.starfieldGroup.position.copy(this.camera.position);

    // Animate starfield (very slow rotation for depth)
    this.starfieldGroup.children.forEach((stars, index) => {
      stars.rotation.y += 0.00005 * (index + 1); // Slow rotation around Y axis
    });

    // Animate zones only (no glow effects)
    this.assets.forEach(asset => {
      // Animate zone rings
      if (asset.mesh && asset.mesh.userData.type === 'zone') {
        asset.mesh.rotation.z += 0.002; // Slow rotation
        if (asset.glow && asset.glow.rotation) {
          asset.glow.rotation.z -= 0.001; // Counter-rotate glow ring
        }
      }
    });

    // Update combat system if it exists
    if (window.shipCombatSystem && typeof window.shipCombatSystem.update === 'function') {
      try {
        window.shipCombatSystem.update();
      } catch (error) {
        console.error('Combat system update error:', error);
      }
    }

    // Render with error handling for material issues
    try {
      this.renderer.render(this.scene, this.camera);

      // Render CSS2D labels (pilot names) if available
      if (this.labelRenderer) {
        this.labelRenderer.render(this.scene, this.camera);
      }
    } catch (error) {
      // Log error once (not every frame)
      if (!this.renderErrorLogged) {
        console.error('Render error - hiding ship to prevent crash:', error.message);
        this.renderErrorLogged = true;

        // Hide the ship mesh which has broken materials
        if (window.shipCombatSystem && window.shipCombatSystem.shipMesh) {
          window.shipCombatSystem.shipMesh.visible = false;
          console.log('🚀 Ship hidden due to material error - will reload on next page load');
        }
      }
      // Skip render this frame but continue animation loop
    }
  }

  /**
   * Load assets for a SPECIFIC STAR SYSTEM
   * SYSTEM LEVEL - Show star + its planets/orbitals only
   */
  async loadAssets() {
    try {
      // Get star ID from URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      const starId = urlParams.get('star');

      if (!starId) {
        console.warn('⚠️ No star ID provided in URL. Showing all orbital bodies.');
      }

      console.log(`📡 Fetching system for star: ${starId || 'ALL'}...`);
      const response = await fetch('/api/v1/state/map-state-3d');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📦 State Manager Response:', data);

      // Check if data has assets array
      if (!data || !data.assets || !Array.isArray(data.assets)) {
        console.error('Invalid State Manager response structure:', data);
        throw new Error('State Manager response missing assets array');
      }

      console.log(`Filtering ${data.assets.length} assets for star system...`);

      // Transform State Manager format to asset format
      this.allAssets = data.assets.map(asset => ({
        _id: asset.id,
        title: asset.title,
        assetType: asset.type,
        coordinates: {
          x: asset.x,
          y: asset.y,
          z: asset.z
        },
        renderData: asset.renderData,
        radius: asset.radius,
        parentId: asset.parentId,
        parentStar: asset.parentStar,
        parentGalaxy: asset.parentGalaxy,
        orbitRadius: asset.orbitRadius,
        orbitAngle: asset.orbitAngle,
        orbitInclination: asset.orbitInclination,
        orbitAscendingNode: asset.orbitAscendingNode,
        localCoordinates: asset.localCoordinates,
        universalCoordinates: asset.universalCoordinates,
        coordinates3D: asset.coordinates3D
      }));

      // If starId provided, show ONLY that star and its planets/orbitals
      let systemAssets;
      if (starId) {
        console.log(`Filtering for star ID: "${starId}"`);
        console.log(`Total assets to filter: ${this.allAssets.length}`);

        // Debug: Check a sample planet
        const samplePlanet = this.allAssets.find(a => a.assetType === 'planet');
        if (samplePlanet) {
          console.log(`Sample planet:`, {
            id: samplePlanet._id,
            title: samplePlanet.title,
            parentStar: samplePlanet.parentStar,
            parentId: samplePlanet.parentId
          });
        }

        systemAssets = this.allAssets.filter(asset => {
          // Include the star itself
          if (asset._id === starId && asset.assetType === 'star') {
            console.log(`  ✓ Including star: ${asset.title}`);
            return true;
          }

          // Include planets/orbitals orbiting this star
          // Support both parentId (new schema) and parentStar (legacy schema)
          const parent = asset.parentId || asset.parentStar;
          if ((asset.assetType === 'planet' || asset.assetType === 'orbital' || asset.assetType === 'station')
              && parent === starId) {
            console.log(`  ✓ Including ${asset.assetType}: ${asset.title} (parent: ${parent})`);
            return true;
          }

          return false;
        });

        console.log(`Filtered to ${systemAssets.length} assets for this star system`);
      } else {
        // No star ID - show ALL orbital bodies
        systemAssets = this.allAssets.filter(asset =>
          ['star', 'planet', 'orbital', 'station', 'ship'].includes(asset.assetType)
        );
      }

      let loadedCount = 0;
      let with3D = 0;
      systemAssets.forEach(asset => {
        if (asset.coordinates && (asset.coordinates.x !== undefined || asset.coordinates.y !== undefined)) {
          this.addAsset(asset);
          loadedCount++;
          if (asset.coordinates.z !== undefined && asset.coordinates.z !== 0) {
            with3D++;
          }
        }
      });

      console.log(`✅ Loaded ${loadedCount} bodies in system`);
      console.log(`   ${with3D} have 3D coordinates (Z != 0)`);
      console.log(`   Filtered out ${data.assets.length - systemAssets.length} bodies from other systems`);

      // Center camera on the star if viewing a specific system
      if (starId && this.stars.has(starId)) {
        const starMesh = this.stars.get(starId);
        const starPos = starMesh.position;
        console.log(`📍 Centering camera on star at (${starPos.x.toFixed(1)}, ${starPos.y.toFixed(1)}, ${starPos.z.toFixed(1)})`);

        // Position camera above and back from the star
        this.camera.position.set(
          starPos.x,
          starPos.y + 500,
          starPos.z + 800
        );

        // Point camera at star
        if (this.controls) {
          this.controls.target.set(starPos.x, starPos.y, starPos.z);
          this.controls.update();
        }
      }

      // Create colorful neon connections between orbital bodies
      this.createNeonConnections(starId);

      // Initialize player ship for camera tracking
      this.initializePlayerShip(starId);

      // Populate system object selector dropdown if the function exists
      if (window.populateSystemObjectSelector) {
        setTimeout(() => {
          window.populateSystemObjectSelector();
        }, 100); // Small delay to ensure planets Map is populated
      }

    } catch (error) {
      console.error('❌ Failed to load assets:', error);
      console.error('Error details:', error.message, error.stack);
    }
  }

  /**
   * Initialize combat system for ship controls and physics
   */
  initializePlayerShip(starId) {
    // Only initialize if combat system is available
    if (!window.SpaceCombatSystem) {
      console.warn('⚠️ SpaceCombatSystem not loaded, ship controls will not be available');
      return;
    }

    console.log('🚀 Initializing combat system for ship...');

    // Initialize combat system WITHOUT disabling OrbitControls
    // This gives us the full ship model and controls while keeping camera flexibility
    const combatSystem = new window.SpaceCombatSystem(
      this.scene,
      this.camera,
      this,
      true // Pass flag to prevent combat system from starting its own animation loop
    );

    window.shipCombatSystem = combatSystem;
    window.combatSystem = combatSystem; // Legacy reference

    // Get the star position to place ship at far edge
    if (starId && this.stars.has(starId)) {
      const starMesh = this.stars.get(starId);
      const starPos = starMesh.position;

      // Find the furthest planet to determine scene edge
      let maxDistance = 1000; // Default minimum distance
      this.planets.forEach(planet => {
        const dist = planet.position.distanceTo(starPos);
        if (dist > maxDistance) {
          maxDistance = dist;
        }
      });

      // Place ship at far edge (beyond furthest planet + buffer)
      const edgeDistance = maxDistance + 500;
      combatSystem.playerShip.position.set(
        starPos.x + edgeDistance,
        starPos.y,
        starPos.z + edgeDistance
      );

      // Update ship mesh position
      if (combatSystem.shipMesh) {
        combatSystem.shipMesh.position.copy(combatSystem.playerShip.position);
      }

      console.log(`🚀 Ship spawned at far edge (${combatSystem.playerShip.position.x.toFixed(1)}, ${combatSystem.playerShip.position.y.toFixed(1)}, ${combatSystem.playerShip.position.z.toFixed(1)}) - ${edgeDistance.toFixed(0)} units from star`);
    }

    console.log('✅ Combat system initialized - ship controls active');
  }

  /**
   * Start syncing with state manager for real-time updates
   */
  startStateManagerSync() {
    console.log('🔄 Starting state manager sync for orbital bodies and characters...');

    // Initial fetch
    this.fetchOrbitalBodies();
    this.fetchCharacters();

    // Poll for updates every 10 seconds
    this.stateManagerInterval = setInterval(() => {
      this.fetchOrbitalBodies();
      this.fetchCharacters();
    }, 10000);
  }

  /**
   * Fetch characters from database for 3D positioning
   */
  async fetchCharacters() {
    try {
      const response = await fetch('/api/v1/characters');

      if (!response.ok) {
        console.warn('Failed to fetch characters');
        return;
      }

      const data = await response.json();

      if (!data.success || !data.characters) {
        return;
      }

      console.log(`🚀 Fetched ${data.characters.length} characters`);

      // Update or add characters to the map
      data.characters.forEach(character => {
        if (character.location && character.location.x !== undefined) {
          const charData = {
            _id: character._id,
            title: character.name,
            assetType: 'ship', // Show as ship icon
            coordinates: {
              x: character.location.x,
              y: character.location.y,
              z: character.location.z || 0 // Use Z coordinate!
            },
            stats: {
              velocity: {
                x: character.location.vx || 0,
                y: character.location.vy || 0,
                z: character.location.vz || 0
              }
            }
          };

          if (this.assets.has(character._id)) {
            // Update existing position
            this.updateAssetPosition(character._id, charData.coordinates);
          } else {
            // Add new character
            this.addAsset(charData);
          }
        }
      });

    } catch (error) {
      console.error('Failed to fetch characters:', error);
    }
  }

  /**
   * Fetch orbital bodies (planets, orbitals, stations) from state manager
   */
  async fetchOrbitalBodies() {
    try {
      // Fetch both approved and submitted assets (like state manager does)
      const [approvedResponse, submittedResponse] = await Promise.all([
        fetch('/api/v1/assets/approved/list?limit=500'),
        fetch('/api/v1/assets/community?limit=500')
      ]);

      let allAssets = [];

      if (approvedResponse.ok) {
        const approvedData = await approvedResponse.json();
        if (approvedData.success && approvedData.assets) {
          allAssets = allAssets.concat(approvedData.assets);
        }
      }

      if (submittedResponse.ok) {
        const submittedData = await submittedResponse.json();
        if (submittedData.success && submittedData.assets) {
          allAssets = allAssets.concat(submittedData.assets);
        }
      }

      // Filter for orbital bodies (planets, orbitals, stations)
      const orbitalBodies = allAssets.filter(a =>
        a.assetType === 'planet' ||
        a.assetType === 'orbital' ||
        a.assetType === 'station'
      );

      // Update existing or add new orbital bodies
      orbitalBodies.forEach(body => {
        if (this.assets.has(body._id)) {
          // Update existing
          this.updateAssetPosition(body._id, body.coordinates);
        } else {
          // Add new
          this.addAsset(body);
        }
      });

      console.log(`🔄 Synced ${orbitalBodies.length} orbital bodies`);

    } catch (error) {
      console.error('Failed to fetch orbital bodies:', error);
    }
  }

  /**
   * Update an existing asset's position
   * @param {String} assetId - Asset ID
   * @param {Object} coordinates - {x, y, z} coordinates
   */
  updateAssetPosition(assetId, coordinates) {
    const asset = this.assets.get(assetId);
    if (asset && coordinates) {
      const newPos = new THREE.Vector3(
        coordinates.x || 0,
        coordinates.y || 0,
        coordinates.z || 0
      );

      asset.mesh.position.copy(newPos);
      if (asset.glow) {
        asset.glow.position.copy(newPos);
      }

      // Update connections that involve this asset
      this.updateConnectionsForAsset(assetId);
    }
  }

  /**
   * Update all connections involving a specific asset
   * @param {String} assetId - Asset ID
   */
  updateConnectionsForAsset(assetId) {
    // Find and update connections
    this.connections.forEach((line, connectionId) => {
      if (connectionId.includes(assetId)) {
        // Rebuild the connection
        const [fromId, toId] = connectionId.split('-');
        const fromAsset = this.assets.get(fromId);
        const toAsset = this.assets.get(toId);

        if (fromAsset && toAsset) {
          const points = [
            fromAsset.mesh.position,
            toAsset.mesh.position
          ];
          line.geometry.setFromPoints(points);
        }
      }
    });
  }

  /**
   * Create individual orbital path rings for each planet
   * Shows the elliptical orbit path for each planet based on its actual position and eccentricity
   */
  createNeonConnections(starId) {
    console.log('🌈 Creating orbital path rings for each planet...');

    // Find the central star
    const starAsset = starId ? Array.from(this.assets.values()).find(a =>
      a.mesh.userData.id === starId
    ) : null;

    if (!starAsset) {
      console.log('No central star found - skipping orbital rings');
      return;
    }

    let ringCount = 0;

    // Create individual orbital ring for EACH planet
    this.assets.forEach((asset, assetId) => {
      const assetType = asset.mesh.userData.type;
      const planetData = asset.mesh.userData;

      // Only create rings for planets
      if (assetType !== 'planet') return;

      // Get planet's actual distance from star
      const distance = asset.mesh.position.distanceTo(starAsset.mesh.position);
      if (distance < 1) return; // Skip if too close

      // Get eccentricity from planet data (0 = circle, >0 = ellipse)
      const eccentricity = planetData.eccentricity || 0;

      // Calculate semi-major and semi-minor axes for ellipse
      const semiMajor = distance; // Current distance is semi-major axis
      const semiMinor = semiMajor * Math.sqrt(1 - eccentricity * eccentricity);

      // Create elliptical curve
      const curve = new THREE.EllipseCurve(
        0, 0,                    // Center at star
        semiMajor, semiMinor,    // Ellipse radii
        0, 2 * Math.PI,          // Full orbit
        false,                   // Clockwise
        0                        // Rotation
      );

      const points = curve.getPoints(128); // High resolution for smooth ellipses
      const geometry = new THREE.BufferGeometry().setFromPoints(points);

      // FADE DISTANT ORBITS - closer orbits are brighter
      const maxDistance = 75000; // System boundary
      const distanceFactor = 1 - (distance / maxDistance); // 1 at center, 0 at edge
      const baseOpacity = 0.15 + (distanceFactor * 0.35); // 0.15 to 0.5 based on distance

      // Additional opacity from eccentricity
      const eccentricityBonus = eccentricity * 0.2;
      const finalOpacity = Math.min(baseOpacity + eccentricityBonus, 0.6);

      const material = new THREE.LineBasicMaterial({
        color: 0x00ffff,  // Cyan orbital paths
        transparent: true,
        opacity: finalOpacity,
        linewidth: 1
      });

      const orbitRing = new THREE.Line(geometry, material);

      // Position at star's location (center at 0,0,0)
      orbitRing.position.copy(starAsset.mesh.position);

      // Apply orbital inclination and ascending node rotation
      const inclination = planetData.data?.orbitInclination || 0;
      const ascendingNode = planetData.data?.orbitAscendingNode || 0;

      // Apply rotations to match the planet's orbital plane
      // 1. Rotate around X-axis for inclination (tilt)
      // 2. Rotate around Y-axis for ascending node (plane rotation)
      orbitRing.rotation.x = inclination;
      orbitRing.rotation.y = ascendingNode;

      this.connectionsGroup.add(orbitRing);
      this.connections.set(`orbit-ring-planet-${assetId}`, orbitRing);

      ringCount++;
    });

    console.log(`✅ Created ${ringCount} individual orbital path rings`);
  }

  /**
   * Create connections between nearby assets
   * This is a simple example - you can customize the logic
   */
  createNearbyConnections() {
    const maxDistance = 50; // Maximum connection distance
    const assetArray = Array.from(this.assets.values());

    for (let i = 0; i < assetArray.length; i++) {
      for (let j = i + 1; j < assetArray.length; j++) {
        const dist = assetArray[i].mesh.position.distanceTo(assetArray[j].mesh.position);

        if (dist < maxDistance) {
          const fromId = assetArray[i].mesh.userData.id;
          const toId = assetArray[j].mesh.userData.id;
          this.addConnection(fromId, toId);
        }
      }
    }

    console.log(`✅ Created ${this.connections.size} connections`);
  }

  /**
   * Clear all assets and connections
   */
  clear() {
    // Clear groups
    this.assetsGroup.children.forEach(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    this.assetsGroup.clear();

    this.connectionsGroup.children.forEach(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    this.connectionsGroup.clear();

    // Clear maps
    this.assets.clear();
    this.stars.clear();
    this.planets.clear();
    this.connections.clear();
  }

  /**
   * Stop state manager sync
   */
  stopStateManagerSync() {
    if (this.stateManagerInterval) {
      clearInterval(this.stateManagerInterval);
      this.stateManagerInterval = null;
      console.log('⏸️ Stopped state manager sync');
    }
  }

  /**
   * Add orbital body with specific rendering
   * @param {Object} orbitalData - Orbital data with parentPlanet reference
   */
  addOrbitalBody(orbitalData) {
    // Add the orbital as a regular asset
    this.addAsset(orbitalData);

    // If it has a parent planet, create a connection
    if (orbitalData.planetId) {
      const planetAsset = this.assets.get(orbitalData.planetId);
      if (planetAsset) {
        // Create orbital connection (dotted line to parent planet)
        this.addConnection(orbitalData._id, orbitalData.planetId, 0x00ffaa);
      }
    }
  }

  /**
   * Dispose of all resources
   */
  dispose() {
    this.stopStateManagerSync();
    this.clear();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

// Auto-initialize when DOM is ready
let galacticMap;
let combatSystem;

document.addEventListener('DOMContentLoaded', () => {
  galacticMap = new GalacticMap3D('mapContainer');
  galacticMap.loadAssets();

  // Make globally accessible
  window.galacticMap = galacticMap;

  // Initialize combat system after a short delay to let the map load
  // TEMPORARILY DISABLED to test planet selection HUD
  // Combat system is now initialized in galacticMap.initializePlayerShip()
  // called during asset loading (see loadAssets method)
});
