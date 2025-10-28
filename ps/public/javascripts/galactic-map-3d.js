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

    // Hierarchy state - track what level we're viewing
    this.currentLevel = 'galactic'; // 'galactic', 'galaxy', or 'system'
    this.selectedGalaxyId = null;
    this.selectedStarId = null;
    this.allAssets = []; // Store all loaded assets
    this.hoveredObjectId = null; // Track currently hovered object for info panel

    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000814); // Deep space blue-black
    // No fog - clear view of entire universe

    // Camera setup (orthographic for map-like view)
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 15000; // Extra large to see entire universe with no clipping
    this.camera = new THREE.OrthographicCamera(
      frustumSize * aspect / -2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      frustumSize / -2,
      -50000,  // Negative near plane to see objects "behind" camera in Z
      50000    // Symmetric far plane for full Z coverage
    );

    // Universe center (after doubling): X(-4202 to 4190), Y(-2400 to 2207), Z(-4062 to 1769)
    // Center point: X=-6, Y=-97, Z=-1146
    this.universeCenter = new THREE.Vector3(-6, -97, -1146);

    // Position camera high above universe center looking down
    this.camera.position.set(
      this.universeCenter.x,           // X: -6 (centered)
      this.universeCenter.y + 3000,    // Y: 2903 (high above)
      this.universeCenter.z + 2000     // Z: 854 (angled view)
    );
    this.camera.lookAt(this.universeCenter);

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

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
    this.players = new Map(); // Player characters

    // Groups for organization
    this.starfieldGroup = new THREE.Group();
    this.assetsGroup = new THREE.Group();
    this.connectionsGroup = new THREE.Group();
    this.playersGroup = new THREE.Group(); // Group for all player markers
    this.scene.add(this.starfieldGroup);
    this.scene.add(this.assetsGroup);
    this.scene.add(this.connectionsGroup);
    this.scene.add(this.playersGroup);

    // Interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.selectedObject = null;

    // OrbitControls for camera (3D navigation)
    // Wait for OrbitControls to be loaded from module
    if (window.OrbitControls) {
      this.controls = new window.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableRotate = true; // Enable rotation for 3D view
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.screenSpacePanning = false; // Use orbit panning
      this.controls.minZoom = 0.05; // Zoom out very far
      this.controls.maxZoom = 50; // Zoom in very close for detail
      this.controls.zoomSpeed = 1.2; // Faster zoom
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
   */
  createStarfield() {
    const layers = [
      { count: 2000, size: 0.3, radius: 2000, color: 0x4466aa }, // Distant dim stars
      { count: 1500, size: 0.4, radius: 1500, color: 0x556688 }, // Mid-distance
      { count: 1000, size: 0.5, radius: 1000, color: 0x778899 }  // Close dim stars
    ];

    layers.forEach(layer => {
      const geometry = new THREE.BufferGeometry();
      const positions = [];

      for (let i = 0; i < layer.count; i++) {
        // Generate random point on/in sphere using spherical coordinates
        const theta = Math.random() * Math.PI * 2; // Azimuth angle (0 to 2π)
        const phi = Math.acos((Math.random() * 2) - 1); // Polar angle (0 to π)
        const r = layer.radius * (0.8 + Math.random() * 0.2); // Radius with slight variation

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
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.25 // Much dimmer - just a subtle background effect
      });

      const stars = new THREE.Points(geometry, material);
      this.starfieldGroup.add(stars);
    });
  }

  /**
   * Add asset to the map (planets, stations, etc.)
   * @param {Object} assetData - Asset data from API
   */
  addAsset(assetData) {
    const { _id, assetType, coordinates, title, stats } = assetData;

    // Skip assets without coordinates - they need to be added via game state manager
    if (!coordinates || (coordinates.x === undefined && coordinates.y === undefined)) {
      console.warn(`⚠️ Asset "${title}" (${assetType}) has no coordinates - needs coordinates from game state`);
      return;
    }

    // Choose coordinate system based on view level
    let position;

    if (this.currentLevel === 'galaxy' && assetType === 'star' && assetData.localCoordinates) {
      // Use local coordinates when viewing galaxy interior (1000x1000 grid)
      const galaxy = this.allAssets?.find(a => a._id === this.selectedGalaxyId);
      if (galaxy && galaxy.coordinates) {
        // Galaxy center in universal coordinates
        const galaxyCenter = new THREE.Vector3(
          galaxy.coordinates.x,
          galaxy.coordinates.y,
          galaxy.coordinates.z || 0
        );

        // Star position = galaxy center + local offset
        position = galaxyCenter.clone().add(new THREE.Vector3(
          assetData.localCoordinates.x,
          assetData.localCoordinates.y,
          assetData.localCoordinates.z || 0
        ));

        console.log(`  ↳ Using local coords for ${title}: (${assetData.localCoordinates.x.toFixed(1)}, ${assetData.localCoordinates.y.toFixed(1)})`);
      } else {
        // Fallback to universal coordinates
        position = new THREE.Vector3(coordinates.x, coordinates.y, coordinates.z || 0);
      }
    } else if (this.currentLevel === 'system' && (assetType === 'planet' || assetType === 'orbital') && assetData.localCoordinates) {
      // Use local coordinates when viewing star system interior
      const star = this.allAssets?.find(a => a._id === this.selectedStarId);
      if (star && star.coordinates) {
        // Star center in universal coordinates
        const starCenter = new THREE.Vector3(
          star.coordinates.x,
          star.coordinates.y,
          star.coordinates.z || 0
        );

        // Planet position = star center + local offset
        position = starCenter.clone().add(new THREE.Vector3(
          assetData.localCoordinates.x,
          assetData.localCoordinates.y,
          assetData.localCoordinates.z || 0
        ));

        console.log(`  ↳ Using local coords for ${title}: (${assetData.localCoordinates.x.toFixed(1)}, ${assetData.localCoordinates.y.toFixed(1)})`);
      } else {
        // Fallback to universal coordinates
        position = new THREE.Vector3(coordinates.x, coordinates.y, coordinates.z || 0);
      }
    } else {
      // Use universal coordinates for universe-level view
      position = new THREE.Vector3(
        coordinates.x,
        coordinates.y,
        coordinates.z || 0
      );
    }

    console.log(`✅ Adding ${assetType}: ${title} at (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);

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

    // Size by asset type or stats (balanced for universe scale)
    let size = 5;
    if (assetType === 'galaxy') size = 25;        // Large - Largest celestial structures
    else if (assetType === 'star') size = 8;      // Increased from 4 - visible at galactic scale (stars spread 3000+ units)
    else if (assetType === 'planet') size = 8;    // Small-medium
    else if (assetType === 'orbital') size = 5;   // Small
    else if (assetType === 'station') size = 5;   // Small
    else if (assetType === 'anomaly') size = 15;  // Medium-large (notable)
    else if (assetType === 'zone') size = 20;     // Large area
    else if (assetType === 'ship') size = 5;      // Small
    else if (assetType === 'character') size = 3; // Very small
    else if (stats && stats.size) size = stats.size * 3;

    // Create geometry based on asset type
    let geometry, material, mesh, glow;

    if (assetType === 'galaxy') {
      // Galaxies: Spiral particle system with colorful particles
      mesh = new THREE.Group();
      mesh.position.copy(position);

      // Create spiral particle system - reduced density for cleaner look
      const particleCount = 600; // Reduced from 1000
      const positions = [];
      const colors = [];
      const spiralArms = 3; // Number of spiral arms

      // Generate colorful particles in spiral pattern
      for (let i = 0; i < particleCount; i++) {
        const t = i / particleCount;

        // Skip particles in the center to reduce clutter (start at 20% radius)
        if (t < 0.2) continue;

        const angle = t * Math.PI * 8; // 4 full rotations
        const armOffset = (i % spiralArms) * (Math.PI * 2 / spiralArms);
        const radius = t * size * 3;

        // Spiral position
        const x = Math.cos(angle + armOffset) * radius;
        const z = Math.sin(angle + armOffset) * radius;
        const y = (Math.random() - 0.5) * size * 0.2; // Reduced vertical spread from 0.3 to 0.2

        positions.push(x, y, z);

        // Colorful particles - mix of blues, purples, pinks, and whites
        const colorChoice = Math.random();
        let particleColor;
        if (colorChoice < 0.25) {
          particleColor = new THREE.Color(0x4488ff); // Blue
        } else if (colorChoice < 0.5) {
          particleColor = new THREE.Color(0xff44ff); // Pink/Magenta
        } else if (colorChoice < 0.75) {
          particleColor = new THREE.Color(0x8844ff); // Purple
        } else {
          particleColor = new THREE.Color(0xffffff); // White
        }

        // Add some brightness variation
        particleColor.multiplyScalar(0.8 + Math.random() * 0.4);

        colors.push(particleColor.r, particleColor.g, particleColor.b);
      }

      const particleGeometry = new THREE.BufferGeometry();
      particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      particleGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const particleMaterial = new THREE.PointsMaterial({
        size: size * 0.15, // Reduced from 0.3 to 0.15 - much smaller particles
        vertexColors: true,
        transparent: true,
        opacity: 0.7, // Reduced from 0.8 for more subtle appearance
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
      });

      const particles = new THREE.Points(particleGeometry, particleMaterial);
      particles.rotation.x = Math.PI / 2; // Lay flat
      mesh.add(particles);

      // Add central bright core - smaller and more subtle
      const coreGeometry = new THREE.SphereGeometry(size * 0.3, 16, 16); // Reduced from 0.5
      const coreMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff88,
        transparent: true,
        opacity: 0.6 // Reduced from 0.9 for less brightness
      });
      const core = new THREE.Mesh(coreGeometry, coreMaterial);
      mesh.add(core);

      // Add INVISIBLE HITBOX sphere for easier clicking
      const hitboxGeometry = new THREE.SphereGeometry(size * 3, 16, 16);
      const hitboxMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false
      });
      const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
      mesh.add(hitbox);

      // Decorative stars removed - only real star assets from database will be shown

      // Simple glow sphere around entire galaxy
      const glowGeometry = new THREE.SphereGeometry(size * 3.5, 16, 16);
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide
      });
      glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.position.copy(position);

    } else if (assetType === 'zone') {
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

    } else if (assetType === 'anomaly') {
      // Anomaly: Small core sphere with larger hitbox
      const adjustedSize = size * 2;

      // Create group for anomaly
      mesh = new THREE.Group();
      mesh.position.copy(position);

      // Core sphere
      const coreGeometry = new THREE.SphereGeometry(adjustedSize, 20, 20);
      const colorObj = new THREE.Color(color);
      colorObj.multiplyScalar(2.0);
      const coreMaterial = new THREE.MeshBasicMaterial({
        color: colorObj,
        transparent: false,
        opacity: 1.0
      });
      const core = new THREE.Mesh(coreGeometry, coreMaterial);
      mesh.add(core);

      // Invisible hitbox for easier clicking
      const hitboxGeometry = new THREE.SphereGeometry(adjustedSize * 3, 16, 16);
      const hitboxMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false
      });
      const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
      mesh.add(hitbox);

      // Glow sphere for pulsing effect (will be animated)
      const glowGeometry = new THREE.SphereGeometry(adjustedSize * 2, 20, 20);
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide
      });
      glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.position.copy(position);

      // Store for pulsing animation
      glow.userData.isPulsing = true;
      glow.userData.pulsePhase = Math.random() * Math.PI * 2;
      glow.userData.baseScale = 2.0;

    } else if (assetType === 'star') {
      // Stars: Simple sphere with bright glow
      const adjustedSize = size * 2.5;

      // Brighten star color
      const colorObj = new THREE.Color(color);
      colorObj.multiplyScalar(2.0);

      // Create simple sphere geometry
      const sphereGeometry = new THREE.SphereGeometry(adjustedSize * 0.8, 16, 16);
      const starMaterial = new THREE.MeshBasicMaterial({
        color: colorObj,
        transparent: false,
        opacity: 1.0
      });

      mesh = new THREE.Mesh(sphereGeometry, starMaterial);
      mesh.position.copy(position);

      // Astral aura - multiple transparent spheres centered on star
      const auraGroup = new THREE.Group();

      // Inner aura - centered on star
      const innerAuraGeo = new THREE.SphereGeometry(adjustedSize * 2, 16, 16);
      const innerAuraMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide
      });
      const innerAura = new THREE.Mesh(innerAuraGeo, innerAuraMat);
      innerAura.position.set(0, 0, 0); // Centered on star
      innerAura.raycast = () => {}; // Disable raycasting for aura - clicks should pass through
      auraGroup.add(innerAura);

      // Outer aura - centered on star
      const outerAuraGeo = new THREE.SphereGeometry(adjustedSize * 3, 16, 16);
      const outerAuraMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.15,
        side: THREE.BackSide
      });
      const outerAura = new THREE.Mesh(outerAuraGeo, outerAuraMat);
      outerAura.position.set(0, 0, 0); // Centered on star
      outerAura.raycast = () => {}; // Disable raycasting for aura - clicks should pass through
      auraGroup.add(outerAura);

      auraGroup.position.copy(position);
      glow = auraGroup;

      // Store for pulsing animation
      glow.userData.isPulsing = true;
      glow.userData.pulsePhase = Math.random() * Math.PI * 2;
      glow.userData.baseScale = 1.0;

    } else {
      // Regular assets: SOLID, BRIGHT spheres
      const adjustedSize = size * 2.5;
      geometry = new THREE.SphereGeometry(adjustedSize, 20, 20);

      // Brighten colors significantly
      const colorObj = new THREE.Color(color);
      colorObj.multiplyScalar(1.8);

      material = new THREE.MeshBasicMaterial({
        color: colorObj,
        transparent: false,
        opacity: 1.0,
        depthTest: true,
        depthWrite: true
      });

      mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);

      // NO GLOW - solid spheres only for maximum visibility
      glow = new THREE.Object3D(); // Empty placeholder
    }

    // Store metadata
    mesh.userData = {
      id: _id,
      type: assetType,
      title: title,
      data: assetData
    };

    this.assetsGroup.add(mesh);
    this.assetsGroup.add(glow);
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
   * REMOVED: Orbital paths should not be calculated/drawn.
   * All visual elements must be actual assets with coordinates from game state manager.
   */

  /**
   * Create velocity arrow showing movement direction
   * @param {Object} assetData - Asset with coordinates and velocity
   */
  createVelocityArrow(assetData) {
    const { _id, coordinates, velocity } = assetData;

    if (!velocity || (!velocity.x && !velocity.y && !velocity.z)) {
      return; // No velocity, skip
    }

    const position = new THREE.Vector3(coordinates.x, coordinates.y, coordinates.z || 0);
    const velocityVec = new THREE.Vector3(velocity.x, velocity.y, velocity.z || 0);

    // Normalize and scale for visibility
    const speed = velocityVec.length();
    const direction = velocityVec.normalize();
    const arrowLength = Math.min(speed * 100, 150); // Scale arrow length

    // Create arrow helper
    const arrow = new THREE.ArrowHelper(
      direction,
      position,
      arrowLength,
      0x00ffff,  // Cyan arrows
      arrowLength * 0.2,  // Head length
      arrowLength * 0.15   // Head width
    );

    arrow.line.material.transparent = true;
    arrow.line.material.opacity = 0.6;
    arrow.cone.material.transparent = true;
    arrow.cone.material.opacity = 0.6;

    arrow.userData.isVelocityArrow = true; // Flag for toggle control
    this.connectionsGroup.add(arrow);

    return arrow;
  }

  /**
   * Create connection lines for all travelable routes
   * Connects: anomaly ↔ galaxies AND galaxy ↔ galaxy
   */
  createGalacticConnections() {
    console.log('🌌 Creating travelable routes (anomaly ↔ galaxies, galaxy ↔ galaxy)...');

    // Find the anomaly (center)
    let anomalyId = null;
    let anomalyPos = null;

    for (const [id, asset] of this.assets) {
      if (asset.mesh.userData.type === 'anomaly') {
        anomalyId = id;
        anomalyPos = asset.mesh.position.clone();
        console.log(`  📍 Anomaly found at position:`, anomalyPos);
        break;
      }
    }

    // Collect all galaxies
    const galaxies = [];
    for (const [id, asset] of this.assets) {
      if (asset.mesh.userData.type === 'galaxy') {
        galaxies.push({
          id: id,
          pos: asset.mesh.position.clone(),
          title: asset.mesh.userData.title
        });
      }
    }

    console.log(`  🌌 Found ${galaxies.length} galaxies`);

    let connectionCount = 0;

    // 1. Connect anomaly to all galaxies (if anomaly exists)
    if (anomalyId && anomalyPos) {
      for (const galaxy of galaxies) {
        this.createTravelRoute(anomalyPos, galaxy.pos, 0x00ff88, `Anomaly → ${galaxy.title}`);
        connectionCount++;
      }
    }

    // 2. Connect each galaxy to every other galaxy (full mesh network)
    for (let i = 0; i < galaxies.length; i++) {
      for (let j = i + 1; j < galaxies.length; j++) {
        this.createTravelRoute(
          galaxies[i].pos,
          galaxies[j].pos,
          0x00aaff,  // Blue for galaxy-to-galaxy
          `${galaxies[i].title} ↔ ${galaxies[j].title}`
        );
        connectionCount++;
      }
    }

    console.log(`✅ Created ${connectionCount} travelable routes`);
  }

  /**
   * Create a travel route line between two points
   */
  createTravelRoute(posA, posB, color, label) {
    // Create connection line
    const points = [posA, posB];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.6,
      linewidth: 2
    });

    const line = new THREE.Line(geometry, material);
    line.userData.isConnection = true; // Flag for toggle control
    line.userData.routeLabel = label;
    this.connectionsGroup.add(line);

    // Add small markers at endpoints
    const markerSize = 12;
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.5
    });

    // Marker at start
    const markerA = new THREE.Mesh(
      new THREE.SphereGeometry(markerSize, 6, 6),
      markerMaterial
    );
    markerA.position.copy(posA);
    markerA.userData.isConnection = true;
    this.connectionsGroup.add(markerA);

    // Marker at end
    const markerB = new THREE.Mesh(
      new THREE.SphereGeometry(markerSize, 6, 6),
      markerMaterial
    );
    markerB.position.copy(posB);
    markerB.userData.isConnection = true;
    this.connectionsGroup.add(markerB);

    console.log(`    ✓ Route: ${label}`);
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
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects(this.assetsGroup.children, true);

    if (intersects.length > 0) {
      let object = intersects[0].object;

      // If clicked object doesn't have userData.id, traverse up to find parent that does
      while (object && (!object.userData || !object.userData.id)) {
        object = object.parent;
      }

      // If we found a valid object with userData
      if (object && object.userData && object.userData.id) {
        this.selectObject(object);
      } else {
        this.deselectObject();
      }
    } else {
      this.deselectObject();
    }
  }

  /**
   * Select an object and handle drill-down navigation
   */
  selectObject(object) {
    // Deselect previous
    if (this.selectedObject) {
      // Handle Groups (galaxies, anomalies, stars)
      if (this.selectedObject.isGroup) {
        this.selectedObject.traverse((child) => {
          if (child.material) {
            if (child.material.emissive) {
              child.material.emissive.setHex(0x000000);
            }
            if (child.material.wireframe && child.material.opacity) {
              child.material.opacity = Math.min(child.material.opacity, 0.6);
            }
          }
        });
      } else if (this.selectedObject.material) {
        // Handle single Meshes
        if (this.selectedObject.material.emissive) {
          this.selectedObject.material.emissive.setHex(0x000000);
        }
        if (this.selectedObject.material.wireframe) {
          this.selectedObject.material.opacity = 0.6;
        }
      }
    }

    // Select new
    this.selectedObject = object;

    // Highlight based on material type
    // Handle Groups (galaxies, anomalies, stars)
    if (object.isGroup) {
      object.traverse((child) => {
        if (child.material) {
          if (child.material.emissive) {
            child.material.emissive.setHex(0xff6600);
          } else if (child.material.wireframe) {
            child.material.opacity = 1.0;
          }
        }
      });
    } else if (object.material) {
      // Handle single Meshes
      if (object.material.emissive) {
        object.material.emissive.setHex(0xff6600);
      } else if (object.material.wireframe) {
        object.material.opacity = 1.0;
      }
    }

    // Focus camera on selected object
    this.focusCameraOn(object.position);

    // Emit event for UI to handle
    const event = new CustomEvent('assetSelected', {
      detail: object.userData
    });
    window.dispatchEvent(event);

    console.log('Selected:', object.userData.title);
  }

  /**
   * Focus camera on a specific position and zoom in
   * @param {THREE.Vector3} position - Target position
   * @param {Number} duration - Animation duration in ms
   */
  focusCameraOn(position, duration = 1000) {
    if (!this.controls) return;

    console.log(`🎯 Focusing camera on (${position.x}, ${position.y}, ${position.z})`);

    // Animate controls target AND camera zoom
    const startTarget = this.controls.target.clone();
    const endTarget = position.clone();

    // Calculate zoom: move camera closer to the target
    const startCameraPos = this.camera.position.clone();
    const directionToTarget = new THREE.Vector3().subVectors(endTarget, startCameraPos).normalize();

    // Calculate desired distance based on current level and object type
    let targetDistance = 500; // Default distance

    // Check current level first (for drill-down views)
    if (this.currentLevel === 'galaxy') {
      // Inside galaxy view - need VERY wide view to see all stars across 5000x5000 galactic space
      targetDistance = 8000; // Increased from 4000 for proper galactic scale (stars spread 3000+ units)
    } else if (this.currentLevel === 'system') {
      // Inside star system - medium view
      targetDistance = 1500; // Increased from 1000
    } else if (this.selectedObject) {
      // Individual object selection in universe view
      if (this.selectedObject.userData.type === 'star') {
        targetDistance = 300;
      } else if (this.selectedObject.userData.type === 'planet') {
        targetDistance = 200;
      } else if (this.selectedObject.userData.type === 'galaxy') {
        targetDistance = 800;
      } else if (this.selectedObject.userData.type === 'anomaly') {
        targetDistance = 600;
      }
    }

    // Calculate end camera position
    const endCameraPos = endTarget.clone().add(
      directionToTarget.clone().multiplyScalar(-targetDistance)
    );

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

      // Interpolate camera position (zoom in)
      this.camera.position.lerpVectors(startCameraPos, endCameraPos, eased);

      this.controls.update();

      if (progress < 1) {
        requestAnimationFrame(animateCamera);
      } else {
        console.log('✅ Camera focus and zoom complete');
      }
    };

    animateCamera();
  }

  /**
   * Deselect current object
   */
  deselectObject() {
    if (this.selectedObject) {
      // Handle Groups (galaxies, anomalies, stars)
      if (this.selectedObject.isGroup) {
        this.selectedObject.traverse((child) => {
          if (child.material) {
            if (child.material.emissive) {
              child.material.emissive.setHex(0x000000);
            }
            if (child.material.wireframe && child.material.opacity) {
              child.material.opacity = Math.min(child.material.opacity, 0.6);
            }
          }
        });
      } else if (this.selectedObject.material) {
        // Handle single Meshes
        if (this.selectedObject.material.emissive) {
          this.selectedObject.material.emissive.setHex(0x000000);
        }
        if (this.selectedObject.material.wireframe) {
          this.selectedObject.material.opacity = 0.6;
        }
      }
      this.selectedObject = null;
    }

    const event = new CustomEvent('assetDeselected');
    window.dispatchEvent(event);
  }

  /**
   * Check for hover over objects and show info panel
   */
  checkHover() {
    // Only in galaxy view - show star info on hover
    if (this.currentLevel !== 'galaxy') {
      return;
    }

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.assetsGroup.children, true);

    if (intersects.length > 0) {
      let object = intersects[0].object;

      // Traverse up to find parent with userData
      while (object && (!object.userData || !object.userData.id)) {
        object = object.parent;
      }

      // If hovering over a star, show its info
      if (object && object.userData && object.userData.type === 'star') {
        const starId = object.userData.id;

        // Only trigger if it's a different star than currently hovered
        if (this.hoveredObjectId !== starId) {
          this.hoveredObjectId = starId;

          // Find the star asset data
          const starAsset = this.allAssets.find(a => a._id === starId);
          if (starAsset) {
            // Trigger info panel to show
            const event = new CustomEvent('assetHovered', {
              detail: { asset: starAsset }
            });
            window.dispatchEvent(event);
          }
        }
      } else {
        // Not hovering over a star - clear hover state
        if (this.hoveredObjectId) {
          this.hoveredObjectId = null;
          const event = new CustomEvent('assetHoverEnd');
          window.dispatchEvent(event);
        }
      }
    } else {
      // Not hovering over anything
      if (this.hoveredObjectId) {
        this.hoveredObjectId = null;
        const event = new CustomEvent('assetHoverEnd');
        window.dispatchEvent(event);
      }
    }
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
    });
  }

  /**
   * Animation loop
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    // Update OrbitControls (if available)
    if (this.controls) {
      this.controls.update();
    }

    // Update zoom level for UI (based on camera zoom)
    this.zoomLevel = this.camera.zoom;

    // Hover detection - show info panel on hover in galaxy view
    this.checkHover();

    // Animate starfield (slow parallax)
    this.starfieldGroup.children.forEach((stars, index) => {
      stars.rotation.z += 0.0001 * (index + 1);
    });

    // Animate zones and anomalies
    this.assets.forEach(asset => {
      // Animate zone rings
      if (asset.mesh && asset.mesh.userData.type === 'zone') {
        asset.mesh.rotation.z += 0.002; // Slow rotation
        if (asset.glow && asset.glow.rotation) {
          asset.glow.rotation.z -= 0.001; // Counter-rotate glow ring
        }
      }

      // Animate anomaly pulsing aura
      if (asset.mesh && asset.mesh.userData.type === 'anomaly') {
        if (asset.glow && asset.glow.userData.isPulsing) {
          // Pulsing scale animation
          const time = Date.now() * 0.001; // Convert to seconds
          const phase = asset.glow.userData.pulsePhase;
          const pulseScale = 1.0 + Math.sin(time * 2 + phase) * 0.3; // Pulse between 0.7 and 1.3

          asset.glow.scale.set(pulseScale, pulseScale, pulseScale);

          // Pulse opacity
          const pulseOpacity = 0.2 + Math.sin(time * 2 + phase) * 0.15; // Pulse opacity
          if (asset.glow.material) {
            asset.glow.material.opacity = pulseOpacity;
          }

          // Slow rotation
          asset.glow.rotation.y += 0.005;
        }

        // Core sphere subtle pulse
        if (asset.mesh.material && asset.mesh.material.emissive) {
          const time = Date.now() * 0.001;
          const intensity = 0.3 + Math.sin(time * 3) * 0.2;
          asset.mesh.material.emissiveIntensity = intensity;
        }
      }

      // Animate star pulsing astral aura
      if (asset.mesh && asset.mesh.userData.type === 'star') {
        if (asset.glow && asset.glow.userData.isPulsing) {
          const time = Date.now() * 0.001;
          const phase = asset.glow.userData.pulsePhase;

          // Pulse auras
          asset.glow.children.forEach((aura, index) => {
            if (aura.material) {
              // Different pulse rates for inner/outer auras
              const speed = index === 0 ? 3 : 2;
              const baseOpacity = index === 0 ? 0.3 : 0.15;
              const pulseOpacity = baseOpacity + Math.sin(time * speed + phase) * (baseOpacity * 0.5);
              aura.material.opacity = pulseOpacity;
            }
          });

          // Slow rotation
          asset.glow.rotation.y += 0.003;
        }
      }
    });

    // Animate player character glows
    this.players.forEach(player => {
      if (player.glow && player.glow.userData.isPulsing) {
        const time = Date.now() * 0.001;
        const phase = player.glow.userData.pulsePhase;

        // Pulse scale
        const pulseScale = 1.0 + Math.sin(time * 4 + phase) * 0.2;
        player.glow.scale.set(pulseScale, pulseScale, pulseScale);

        // Pulse opacity - check glow color instead of marker
        const isGreen = player.glow.material.color.g > 0.5;
        const baseOpacity = isGreen ? 0.6 : 0.5; // Green vs Blue
        const pulseOpacity = baseOpacity + Math.sin(time * 4 + phase) * 0.2;
        player.glow.material.opacity = pulseOpacity;

        // Slow rotation
        player.glow.rotation.z += 0.01;
      }
    });

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Load all assets from API
   * GALACTIC LEVEL - Only show galaxies and zones
   */
  async loadAssets() {
    try {
      console.log('📡 Fetching universe state from State Manager...');
      const response = await fetch('/api/v1/state/map-state-3d');

      if (!response.ok) {
        console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📦 State Manager Response:', data);
      console.log('📦 Assets array length:', data.assets ? data.assets.length : 'NO ASSETS ARRAY');

      // Check if data has assets array
      if (!data || !data.assets || !Array.isArray(data.assets)) {
        console.error('Invalid State Manager response structure:', data);
        throw new Error('State Manager response missing assets array');
      }

      console.log(`Loading ${data.assets.length} assets from State Manager...`);

      // Transform State Manager format to legacy format for compatibility
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
        parentGalaxy: asset.parentGalaxy,
        parentStar: asset.parentStar,
        orbitRadius: asset.orbitRadius,
        localCoordinates: asset.localCoordinates,
        universalCoordinates: asset.universalCoordinates
      }));

      console.log(`✅ Stored ${this.allAssets.length} total assets`);

      // UNIVERSE MAP: Show only universe-level objects (NO stars, planets or moons)
      // Stars are shown when you drill into a galaxy
      const universeTypes = ['galaxy', 'zone', 'anomaly', 'nebula'];
      const galacticAssets = this.allAssets.filter(asset =>
        universeTypes.includes(asset.assetType)
      );

      let loadedCount = 0;
      let with3D = 0;
      galacticAssets.forEach(asset => {
        this.addAsset(asset);
        loadedCount++;
        if (asset.coordinates.z !== undefined && asset.coordinates.z !== 0) {
          with3D++;
        }
      });

      console.log(`✅ Loaded ${loadedCount} galactic-level assets (galaxies, stars, zones, anomalies)`);
      console.log(`   ${with3D} with 3D coordinates (Z != 0)`);
      console.log(`   Filtered out ${this.allAssets.length - galacticAssets.length} planets (use System Explorer for those)`);

      // Debug: Count by type
      const typeCounts = {};
      galacticAssets.forEach(a => {
        typeCounts[a.assetType] = (typeCounts[a.assetType] || 0) + 1;
      });
      console.log('   Asset breakdown:', typeCounts);

      // Create visual enhancements
      console.log('🎨 Creating visual enhancements...');

      // REMOVED: Orbital paths and velocity arrows - all visualization must come from
      // actual asset coordinates managed by game state manager, not calculated visuals

      // Create connection web from anomaly to galaxies (connections are asset relationships)
      this.createGalacticConnections();

      // Populate asset selector in sidebar if function exists
      if (window.populateAssetSelector) {
        setTimeout(() => {
          window.populateAssetSelector();
        }, 100);
      }

    } catch (error) {
      console.error('❌ Failed to load assets:', error);
      console.error('Error details:', error.message, error.stack);
    }
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
   * Show only galactic-level assets (galaxies, zones, anomalies)
   */
  showGalacticLevel() {
    console.log('🌌 Showing GALACTIC level - galaxies, zones, anomalies only');

    this.currentLevel = 'galactic';
    this.selectedGalaxyId = null;
    this.selectedStarId = null;

    // Clear current scene
    this.clearAssets();

    // Show only top-level galactic objects
    const galacticTypes = ['galaxy', 'zone', 'anomaly', 'nebula'];
    const galacticAssets = this.allAssets.filter(asset =>
      galacticTypes.includes(asset.assetType)
    );

    console.log(`   Found ${galacticAssets.length} galactic-level assets`);
    galacticAssets.forEach(asset => this.addAsset(asset));
  }

  /**
   * Show universe-level view (all galaxies, stars, zones, anomalies)
   */
  showUniverseLevel() {
    console.log(`🌍 Showing UNIVERSE level - all galaxies`);

    this.currentLevel = 'universe';
    this.selectedGalaxyId = null;
    this.selectedStarId = null;

    // Clear current scene
    this.clearAssets();

    // Reload all galactic-level assets
    const galacticTypes = ['galaxy', 'star', 'zone', 'anomaly', 'nebula', 'station', 'ship', 'character'];
    const galacticAssets = this.allAssets.filter(asset =>
      galacticTypes.includes(asset.assetType)
    );

    console.log(`   Loading ${galacticAssets.length} universe-level assets`);
    galacticAssets.forEach(asset => this.addAsset(asset));

    // Reset camera to universe center
    this.camera.position.set(
      this.universeCenter.x,
      this.universeCenter.y + 3000,
      this.universeCenter.z + 2000
    );
    if (this.controls) {
      this.controls.target.copy(this.universeCenter);
      this.controls.update();
    }
  }

  /**
   * Show stars within a selected galaxy
   */
  showGalaxyLevel(galaxyId) {
    console.log(`⭐ Showing GALAXY level - stars in galaxy ${galaxyId}`);

    this.currentLevel = 'galaxy';
    this.selectedGalaxyId = galaxyId;
    this.selectedStarId = null;

    // Clear current scene
    this.clearAssets();

    // Show the parent galaxy
    const galaxy = this.allAssets.find(a => a._id === galaxyId);
    if (galaxy) {
      this.addAsset(galaxy);
    }

    // Show stars that belong to this galaxy
    const stars = this.allAssets.filter(asset =>
      asset.assetType === 'star' && asset.parentGalaxy === galaxyId
    );

    console.log(`   Found ${stars.length} stars in galaxy`);
    console.log(`   Debug: First star data:`, stars[0]);
    stars.forEach(star => {
      console.log(`   Adding star ${star.title}:`, {
        hasLocalCoords: !!star.localCoordinates,
        localCoords: star.localCoordinates,
        parentGalaxy: star.parentGalaxy
      });
      this.addAsset(star);
    });

    // Also show zones and anomalies within this galaxy
    const galacticObjects = this.allAssets.filter(asset =>
      (asset.assetType === 'zone' || asset.assetType === 'anomaly') &&
      asset.parentGalaxy === galaxyId
    );
    console.log(`   Found ${galacticObjects.length} zones/anomalies in galaxy`);
    galacticObjects.forEach(obj => this.addAsset(obj));

    // Focus camera on galaxy
    if (galaxy && galaxy.coordinates) {
      this.focusCameraOn(new THREE.Vector3(
        galaxy.coordinates.x,
        galaxy.coordinates.y,
        galaxy.coordinates.z || 0
      ));
    }
  }

  /**
   * Show planets/orbitals around a selected star
   */
  showSystemLevel(starId) {
    console.log(`🪐 Showing SYSTEM level - planets around star ${starId}`);

    this.currentLevel = 'system';
    this.selectedStarId = starId;

    // Clear current scene
    this.clearAssets();

    // Show the parent star
    const star = this.allAssets.find(a => a._id === starId);
    if (star) {
      this.addAsset(star);
    }

    // Show planets and orbitals that orbit this star
    const orbitalBodies = this.allAssets.filter(asset =>
      (asset.assetType === 'planet' ||
       asset.assetType === 'orbital' ||
       asset.assetType === 'station') &&
      asset.parentStar === starId
    );

    console.log(`   Found ${orbitalBodies.length} orbital bodies in system`);
    orbitalBodies.forEach(body => this.addAsset(body));

    // Focus camera on star
    if (star && star.coordinates) {
      this.focusCameraOn(new THREE.Vector3(
        star.coordinates.x,
        star.coordinates.y,
        star.coordinates.z || 0
      ));
    }
  }

  /**
   * Clear only assets (keep starfield and scene)
   */
  clearAssets() {
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
   * Add player character to the 3D map
   * @param {Object} character - Character object with location {x, y, z}
   */
  addPlayerCharacter(character) {
    if (!character || !character.location) {
      console.warn('Invalid character or missing location');
      return;
    }

    const { _id, name, location } = character;

    // Check if player already exists - if so, just update position
    if (this.players.has(_id)) {
      console.log(`👤 Player ${name} already exists, updating position`);
      this.updatePlayerPosition(_id, location, name);
      return;
    }

    const position = new THREE.Vector3(
      location.x || 0,
      location.y || 0,
      location.z || 0
    );

    console.log(`👤 Adding new player character: ${name} at`, position);

    // Create player marker - arrow shape pointing up
    const arrowGroup = new THREE.Group();

    // Arrow shaft (cylinder)
    const shaftGeometry = new THREE.CylinderGeometry(8, 8, 40, 8);
    const shaftMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00, // Bright green for player
    });
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
    shaft.position.y = 0;
    arrowGroup.add(shaft);

    // Arrow head (cone)
    const headGeometry = new THREE.ConeGeometry(20, 30, 8);
    const headMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 35; // Above shaft
    arrowGroup.add(head);

    arrowGroup.position.copy(position);

    // Add glow ring around player
    const glowGeometry = new THREE.TorusGeometry(35, 8, 8, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.6
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.copy(position);
    glow.rotation.x = Math.PI / 2;

    // Create text sprite for player name
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;

    context.font = 'Bold 32px Arial';
    context.fillStyle = '#00ff00';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(100, 25, 1);
    sprite.position.copy(position);
    sprite.position.y += 70; // Position above arrow

    // Store marker, glow, and label
    this.players.set(_id, { marker: arrowGroup, glow, label: sprite, name });
    this.playersGroup.add(arrowGroup);
    this.playersGroup.add(glow);
    this.playersGroup.add(sprite);

    // Add pulsing animation
    glow.userData.isPulsing = true;
    glow.userData.pulsePhase = Math.random() * Math.PI * 2;

    console.log(`✅ Player character added: ${name}`);
  }

  /**
   * Update player position (for real-time movement)
   * @param {String} characterId - Character ID
   * @param {Object} location - {x, y, z} coordinates
   * @param {String} characterName - Character name
   */
  updatePlayerPosition(characterId, location, characterName) {
    if (!location) return;

    const position = new THREE.Vector3(
      location.x || 0,
      location.y || 0,
      location.z || 0
    );

    const player = this.players.get(characterId);

    if (player) {
      // Update existing player
      player.marker.position.copy(position);
      player.glow.position.copy(position);
      if (player.label) {
        player.label.position.copy(position);
        player.label.position.y += 70;
      }
    } else {
      // Add new player
      console.log(`👤 Adding other player: ${characterName}`);

      // Create arrow for other players - blue
      const arrowGroup = new THREE.Group();

      // Arrow shaft
      const shaftGeometry = new THREE.CylinderGeometry(8, 8, 40, 8);
      const shaftMaterial = new THREE.MeshBasicMaterial({
        color: 0x0088ff, // Blue for other players
      });
      const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
      shaft.position.y = 0;
      arrowGroup.add(shaft);

      // Arrow head
      const headGeometry = new THREE.ConeGeometry(20, 30, 8);
      const headMaterial = new THREE.MeshBasicMaterial({
        color: 0x0088ff,
      });
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.position.y = 35;
      arrowGroup.add(head);

      arrowGroup.position.copy(position);

      // Add glow
      const glowGeometry = new THREE.TorusGeometry(35, 8, 8, 16);
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0x0088ff,
        transparent: true,
        opacity: 0.5
      });
      const glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.position.copy(position);
      glow.rotation.x = Math.PI / 2;

      // Create name label
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = 256;
      canvas.height = 64;

      context.font = 'Bold 32px Arial';
      context.fillStyle = '#0088ff';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(characterName, 128, 32);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.scale.set(100, 25, 1);
      sprite.position.copy(position);
      sprite.position.y += 70;

      // Store and add to scene
      this.players.set(characterId, { marker: arrowGroup, glow, label: sprite, name: characterName });
      this.playersGroup.add(arrowGroup);
      this.playersGroup.add(glow);
      this.playersGroup.add(sprite);

      // Add pulsing
      glow.userData.isPulsing = true;
      glow.userData.pulsePhase = Math.random() * Math.PI * 2;
    }
  }

  /**
   * Find an object at or near the given position
   * @param {Object} position - {x, y, z} coordinates
   * @param {Number} tolerance - Search radius
   * @returns {Object|null} - The found object or null
   */
  findObjectAtPosition(position, tolerance = 50) {
    let closestObject = null;
    let closestDistance = tolerance;

    this.assetsGroup.children.forEach(obj => {
      if (obj.userData && obj.userData.id) {
        const distance = obj.position.distanceTo(new THREE.Vector3(position.x, position.y, position.z));
        if (distance < closestDistance) {
          closestDistance = distance;
          closestObject = obj;
        }
      }
    });

    return closestObject;
  }

  /**
   * Create a dramatic zoom-in spiral effect on arrival
   * @param {Object} targetObject - The object to focus on
   * @param {Function} onComplete - Callback when effect completes
   */
  createArrivalEffect(targetObject, onComplete) {
    if (!targetObject || !this.camera || !this.controls) return;

    const targetPos = targetObject.position.clone();
    const duration = 2000; // 2 seconds
    const startTime = Date.now();

    // Store initial camera state
    const startCameraPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();

    // Calculate final camera position (closer zoom)
    const targetDistance = 400; // Close zoom
    const direction = new THREE.Vector3().subVectors(startCameraPos, targetPos).normalize();
    const endCameraPos = targetPos.clone().add(direction.multiplyScalar(targetDistance));

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1.0);

      // Ease-in interpolation for smooth zoom
      const t = 1 - Math.pow(1 - progress, 3); // Cubic ease-in

      // Simple direct zoom - no spiral
      const currentCameraPos = new THREE.Vector3().lerpVectors(startCameraPos, endCameraPos, t);
      this.camera.position.copy(currentCameraPos);

      // Interpolate target
      this.controls.target.lerpVectors(startTarget, targetPos, t);
      this.controls.update();

      if (progress < 1.0) {
        requestAnimationFrame(animate);
      } else {
        console.log('✅ Arrival effect complete');
        if (onComplete) onComplete();
      }
    };

    animate();
  }

  /**
   * Animate travel from current position to destination over 15 seconds
   * @param {String} characterId - Character ID
   * @param {Object} startPos - {x, y, z} start position
   * @param {Object} endPos - {x, y, z} end position
   * @param {String} characterName - Character name
   * @param {Function} onProgress - Callback with current position
   * @param {Function} onComplete - Callback when travel completes
   */
  animateTravel(characterId, startPos, endPos, characterName, onProgress, onComplete) {
    const duration = 15000; // 15 seconds in milliseconds
    const startTime = Date.now();

    const start = new THREE.Vector3(startPos.x, startPos.y, startPos.z);
    const end = new THREE.Vector3(endPos.x, endPos.y, endPos.z);

    // Create travel path line
    const points = [];
    const segments = 50;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = new THREE.Vector3().lerpVectors(start, end, t);
      points.push(point);
    }

    const pathGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const pathMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      linewidth: 3,
      transparent: true,
      opacity: 0.8
    });
    const pathLine = new THREE.Line(pathGeometry, pathMaterial);
    this.scene.add(pathLine);

    // Animate
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1.0);

      // Ease-in-out interpolation
      const t = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Calculate current position
      const currentPos = new THREE.Vector3().lerpVectors(start, end, t);

      // Update player position
      this.updatePlayerPosition(characterId, {
        x: currentPos.x,
        y: currentPos.y,
        z: currentPos.z
      }, characterName);

      // Call progress callback
      if (onProgress) {
        onProgress({
          x: currentPos.x,
          y: currentPos.y,
          z: currentPos.z,
          progress: progress
        });
      }

      // Smoothly follow camera - directly update controls without animation
      if (this.controls && this.camera) {
        const cameraTarget = new THREE.Vector3().lerpVectors(start, end, t);
        this.controls.target.copy(cameraTarget);

        // Move camera to maintain a good viewing distance
        const directionToTarget = new THREE.Vector3().subVectors(cameraTarget, this.camera.position).normalize();
        const desiredDistance = 600;
        const desiredCameraPos = cameraTarget.clone().add(directionToTarget.clone().multiplyScalar(-desiredDistance));

        // Smoothly interpolate camera position
        this.camera.position.lerp(desiredCameraPos, 0.02);
        this.controls.update();
      }

      if (progress < 1.0) {
        requestAnimationFrame(animate);
      } else {
        // Travel complete
        this.scene.remove(pathLine);
        pathGeometry.dispose();
        pathMaterial.dispose();

        if (onComplete) {
          onComplete();
        }
      }
    };

    animate();
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

document.addEventListener('DOMContentLoaded', () => {
  galacticMap = new GalacticMap3D('mapContainer');
  galacticMap.loadAssets();

  // Make globally accessible
  window.galacticMap = galacticMap;
});
