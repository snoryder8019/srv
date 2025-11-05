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

    // Camera state storage for transitions between view levels
    this.savedGalacticCameraPosition = null;
    this.savedGalacticCameraZoom = null;
    this.savedGalacticControlsTarget = null;

    // Scene setup (MUST be first)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000814); // Deep space blue-black
    // No fog - clear view of entire universe

    // Physics system for galaxy orbital mechanics (after scene creation)
    this.physicsEnabled = true;
    this.physicsTimeStep = 1 / 30; // 2x faster physics simulation
    this.lastPhysicsUpdate = Date.now();

    // Physics constants - reduced gravity for stable orbits
    this.GRAVITATIONAL_CONSTANT = 5000; // Reduced from 50000 for weaker pull
    this.ANOMALY_CAPTURE_DISTANCE = 800;
    this.ANOMALY_MASS = 1000000;
    this.GALAXY_MASS = 100000;
    this.MAX_VELOCITY = 50; // Increased from 5 to allow faster orbital speeds

    // Force visualization
    this.forceArrows = new Map();
    this.forceArrowsGroup = new THREE.Group();
    this.scene.add(this.forceArrowsGroup);
    this.showForceArrows = true;

    console.log('⚙️ Galaxy orbital physics system initialized');

    // Camera setup (perspective for immersive 3D view with visible starfield)
    const aspect = window.innerWidth / window.innerHeight;
    const fov = 75; // Wider field of view for immersive space feel
    this.camera = new THREE.PerspectiveCamera(
      fov,       // Field of view
      aspect,    // Aspect ratio
      10,        // Near clipping plane - clip anything closer than 10 units
      450000     // Far clipping plane - just inside starfield cube (400k)
    );

    // Store FOV for reference
    this.cameraFOV = fov;

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

    // Lighting - dimmer ambient for better star light contrast
    this.ambientLight = new THREE.AmbientLight(0x202040, 0.4); // Very dim blue ambient
    this.scene.add(this.ambientLight);

    // Dim directional light for overall scene visibility
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight.position.set(100, 200, 100);
    this.scene.add(directionalLight);

    // Asset containers
    this.assets = new Map();
    this.stars = new Map();
    this.planets = new Map();
    this.connections = new Map();
    this.players = new Map(); // Player characters
    this.galaxyOrbits = []; // Galaxy orbital trails (purple pen stripes)
    this.assetsLoaded = false; // Flag to track when galaxies/anomalies are loaded

    // Groups for organization
    this.starfieldGroup = new THREE.Group();
    this.assetsGroup = new THREE.Group();
    this.connectionsGroup = new THREE.Group();
    this.playersGroup = new THREE.Group(); // Group for all player markers
    this.playersGroup.renderOrder = 1000; // Ensure players render on top
    this.scene.add(this.starfieldGroup);
    this.scene.add(this.assetsGroup);
    this.scene.add(this.connectionsGroup);
    this.scene.add(this.playersGroup);

    // Terminal-style HUD for info display (Three.js-based, not CSS)
    this.infoHUD = null;
    this.infoHUDSprite = null;
    this.infoHUDVisible = false;

    // Interaction
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points.threshold = 15; // Larger threshold for easier clicking on particles
    this.mouse = new THREE.Vector2();
    this.selectedObject = null;
    this.selectedStar = null; // Track selected star for camera following and HUD
    this.followingStar = false; // Whether camera should follow the selected star

    // Touch control state
    this.touchStartTime = 0;
    this.touchMoved = false;
    this.lastTouchDistance = 0;

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

    // DEBUG test sphere REMOVED

    // Camera zoom level for UI
    this.zoomLevel = 1;

    this.init();
  }

  init() {
    this.createFixedStarfieldCube(); // Fixed starfield background
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
   * Create fixed starfield cube - a skybox with stars on the inside faces
   * Creates the effect of being surrounded by distant stars
   */
  createFixedStarfieldCube() {
    console.log('🌟 Creating fixed starfield cube skybox...');

    // Size of the cube (very large to encompass entire universe)
    const cubeSize = 400000;

    // Create 6 canvas textures for each face of the cube
    const createStarfieldTexture = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 2048;
      const ctx = canvas.getContext('2d');

      // Black background
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Add stars
      const starCount = 3000; // Dense starfield
      for (let i = 0; i < starCount; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const radius = Math.random() * 1.5 + 0.5; // 0.5-2px stars
        const brightness = Math.random() * 0.5 + 0.5; // 50-100% brightness

        // Variety of star colors (blue-white to yellow-white)
        const colors = [
          `rgba(255, 255, 255, ${brightness})`,      // White
          `rgba(200, 220, 255, ${brightness})`,      // Blue-white
          `rgba(255, 250, 220, ${brightness})`,      // Yellow-white
          `rgba(255, 200, 150, ${brightness * 0.8})` // Orange (rare)
        ];
        const color = colors[Math.floor(Math.random() * colors.length)];

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Add glow to some stars
        if (Math.random() > 0.85) {
          ctx.fillStyle = `rgba(255, 255, 255, ${brightness * 0.3})`;
          ctx.beginPath();
          ctx.arc(x, y, radius * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      return new THREE.CanvasTexture(canvas);
    };

    // Create materials for each face (each face gets unique stars)
    const materials = [
      new THREE.MeshBasicMaterial({ map: createStarfieldTexture(), side: THREE.BackSide }), // right
      new THREE.MeshBasicMaterial({ map: createStarfieldTexture(), side: THREE.BackSide }), // left
      new THREE.MeshBasicMaterial({ map: createStarfieldTexture(), side: THREE.BackSide }), // top
      new THREE.MeshBasicMaterial({ map: createStarfieldTexture(), side: THREE.BackSide }), // bottom
      new THREE.MeshBasicMaterial({ map: createStarfieldTexture(), side: THREE.BackSide }), // front
      new THREE.MeshBasicMaterial({ map: createStarfieldTexture(), side: THREE.BackSide })  // back
    ];

    // Create cube geometry
    const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    const starfieldCube = new THREE.Mesh(geometry, materials);

    // Position at origin (cube surrounds everything)
    starfieldCube.position.set(0, 0, 0);

    // Add to scene (not to starfieldGroup, this is static background)
    this.scene.add(starfieldCube);
    this.starfieldCube = starfieldCube;

    console.log(`✅ Fixed starfield cube created (${cubeSize} units)`);
  }

  /**
   * Create 3D starfield sphere surrounding the camera (OLD - replaced by cube)
   * Stars distributed in a spherical volume for immersive background
   */
  createStarfield() {
    // Create fluorescent gradient background sphere (outermost layer)
    const bgGeometry = new THREE.SphereGeometry(190000, 32, 32); // Behind stars
    const bgMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x0a0015) }, // Deep purple
        bottomColor: { value: new THREE.Color(0x000000) }, // Black
        offset: { value: 33 },
        exponent: { value: 0.6 }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          float t = max(pow(max(h, 0.0), exponent), 0.0);

          // Add fluorescent glow effect
          vec3 midColor = vec3(0.2, 0.05, 0.4); // Purple/magenta fluorescent
          vec3 color = mix(bottomColor, midColor, t * 0.5);
          color = mix(color, topColor, t);

          gl_FragColor = vec4(color, 1.0);
        }
      `
    });
    const bgSphere = new THREE.Mesh(bgGeometry, bgMaterial);
    this.scene.add(bgSphere);

    // Stars on the OUTER SURFACE only (skybox style) - far distant edge
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = [];
    const starColors = [];
    const starCount = 8000;

    for (let i = 0; i < starCount; i++) {
      // Points ON the sphere surface at maximum radius
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      const r = 180000; // Extended to near camera far plane (200k)

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      starPositions.push(x, y, z);

      // Dimmer star colors
      const colorChoice = Math.random();
      if (colorChoice < 0.7) {
        starColors.push(0.6, 0.6, 0.6); // Dim white
      } else if (colorChoice < 0.9) {
        starColors.push(0.5, 0.55, 0.6); // Dim blue-white
      } else {
        starColors.push(0.6, 0.6, 0.5); // Dim yellow-white
      }
    }

    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));

    // Use shader material to enable custom depth clipping for stars only
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCameraPosition: { value: this.camera.position },
        minDistance: { value: 50000 }, // Don't render stars closer than this
        pointSize: { value: 1.0 },
        opacity: { value: 0.2 }
      },
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
        uniform vec3 uCameraPosition;
        uniform float minDistance;
        uniform float pointSize;
        varying vec3 vColor;
        varying float vDistance;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

          // Calculate distance from camera to star
          vDistance = length(position - uCameraPosition);

          gl_PointSize = pointSize;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float minDistance;
        uniform float opacity;
        varying vec3 vColor;
        varying float vDistance;

        void main() {
          // Clip stars that are too close to camera
          if (vDistance < minDistance) {
            discard;
          }

          // Circular point shape
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          if (dist > 0.5) {
            discard;
          }

          gl_FragColor = vec4(vColor, opacity);
        }
      `
    });

    const starField = new THREE.Points(starGeometry, starMaterial);
    this.starField = starField; // Store reference for camera position updates
    this.scene.add(starField);

    // Floating particles INSIDE the 3D space (dust/debris)
    this.floatingParticles = [];
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = [];
    const particleCount = 500;

    for (let i = 0; i < particleCount; i++) {
      // Random positions throughout the scene volume
      const x = (Math.random() - 0.5) * 30000;
      const y = (Math.random() - 0.5) * 30000;
      const z = (Math.random() - 0.5) * 30000;

      particlePositions.push(x, y, z);

      // Store particle data for animation
      this.floatingParticles.push({
        velocity: {
          x: (Math.random() - 0.5) * 2,
          y: (Math.random() - 0.5) * 2,
          z: (Math.random() - 0.5) * 2
        }
      });
    }

    particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(particlePositions, 3));

    const particleMaterial = new THREE.PointsMaterial({
      color: 0xaaaacc,
      size: 4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending
    });

    this.floatingParticlesMesh = new THREE.Points(particleGeometry, particleMaterial);
    this.scene.add(this.floatingParticlesMesh);

    // Comet system (spawns every few minutes)
    this.comets = [];
    this.lastCometSpawn = Date.now();
    this.cometSpawnInterval = 120000 + Math.random() * 60000; // 2-3 minutes

    console.log('✨ Created outer surface starfield, floating particles, and comet system');
  }

  /**
   * Create or update Three.js-based terminal HUD
   * @param {Object} data - Data to display {title, type, info}
   */
  createTerminalHUD(data) {
    // Remove old HUD if exists
    if (this.infoHUDSprite) {
      this.scene.remove(this.infoHUDSprite);
      if (this.infoHUDSprite.material.map) {
        this.infoHUDSprite.material.map.dispose();
      }
      this.infoHUDSprite.material.dispose();
      this.infoHUDSprite = null;
    }

    if (!data) {
      this.infoHUDVisible = false;
      return;
    }

    // Create canvas for terminal-style display
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 600;
    canvas.height = 400;

    // Terminal background - dark with green glow
    ctx.fillStyle = 'rgba(0, 20, 10, 0.95)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border - classic green terminal style
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

    // Inner glow effect
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

    // Scanline effect
    for (let y = 0; y < canvas.height; y += 4) {
      ctx.fillStyle = 'rgba(0, 255, 0, 0.02)';
      ctx.fillRect(0, y, canvas.width, 2);
    }

    // Title
    ctx.font = 'bold 32px "Courier New", monospace';
    ctx.fillStyle = '#00ff00';
    ctx.shadowColor = '#00ff00';
    ctx.shadowBlur = 10;
    ctx.fillText(`> ${data.title || 'UNKNOWN'}`, 20, 50);

    // Type badge
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillStyle = '#00ff00';
    ctx.shadowBlur = 5;
    ctx.fillText(`[${(data.type || 'object').toUpperCase()}]`, 20, 85);

    // Reset shadow for info text
    ctx.shadowBlur = 0;

    // Info lines
    ctx.font = '18px "Courier New", monospace';
    ctx.fillStyle = '#00dd00';
    let yPos = 120;
    const lineHeight = 25;

    if (data.info) {
      Object.entries(data.info).forEach(([key, value]) => {
        ctx.fillStyle = '#00ff00';
        ctx.fillText(`${key}:`, 30, yPos);
        ctx.fillStyle = '#88ff88';
        ctx.fillText(`${value}`, 200, yPos);
        yPos += lineHeight;
      });
    }

    // Create sprite from canvas
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false
    });

    this.infoHUDSprite = new THREE.Sprite(material);

    // Position HUD in screen space (always visible)
    // We'll update this position in the animate loop to keep it screen-aligned
    this.infoHUDSprite.scale.set(1200, 800, 1);
    this.infoHUDSprite.renderOrder = 999; // Always on top

    this.scene.add(this.infoHUDSprite);
    this.infoHUDVisible = true;

    console.log('🖥️ Terminal HUD created');
  }

  /**
   * Update HUD position to stay in screen space
   */
  updateHUDPosition() {
    if (!this.infoHUDSprite || !this.infoHUDVisible) return;

    // Calculate screen-space position (bottom-right corner)
    const distance = 3000; // Distance from camera
    const widthHalf = window.innerWidth / 2;
    const heightHalf = window.innerHeight / 2;

    // Position offset from screen edge
    const offsetX = widthHalf - 350; // Right side
    const offsetY = -heightHalf + 250; // Bottom side

    // Convert screen coordinates to world position
    const vector = new THREE.Vector3(offsetX, offsetY, -distance);
    vector.unproject(this.camera);

    this.infoHUDSprite.position.copy(vector);
  }

  /**
   * Create galaxy shape particles based on type
   * @param {THREE.Group} galaxyGroup - Galaxy group to add particles to
   * @param {Number} size - Base size of galaxy
   * @param {String} shapeType - Type of galaxy shape ('spiral-3', 'spiral-4', 'spiral-6')
   * @param {Object} params - Shape parameters {dimension, trim, curvature}
   * @param {Boolean} isInteriorView - If true, make particles very transparent
   */
  createGalaxyShape(galaxyGroup, size, shapeType, params, isInteriorView = false) {
    // Galaxy shapes disabled - just simple orbs, no particles
    // This function is now a no-op
  }

  /**
   * Update galaxy shape in real-time
   * @param {String} galaxyId - Galaxy asset ID
   * @param {String} shapeType - New shape type
   * @param {Object} params - New parameters
   */
  updateGalaxyShape(galaxyId, shapeType, params) {
    const asset = this.assets.get(galaxyId);
    if (!asset || asset.mesh.userData.type !== 'galaxy') return;

    // Update stored parameters
    asset.mesh.userData.galaxyShape = shapeType;
    asset.mesh.userData.galaxyDimension = params.dimension;
    asset.mesh.userData.galaxyTrim = params.trim;
    asset.mesh.userData.galaxyCurvature = params.curvature;

    // Recreate the shape
    const size = 25; // Galaxy base size
    const isInteriorView = this.currentLevel === 'galaxy' && this.selectedGalaxyId === galaxyId;
    this.createGalaxyShape(asset.mesh, size, shapeType, params, isInteriorView);
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
      // When viewing galaxy interior, use ONLY local coordinates (centered at origin)
      // Scale up by 3x to spread out star systems and prevent planetary orbit overlap
      const GALAXY_INTERIOR_SCALE = 3.0;
      position = new THREE.Vector3(
        assetData.localCoordinates.x * GALAXY_INTERIOR_SCALE,
        assetData.localCoordinates.y * GALAXY_INTERIOR_SCALE,
        (assetData.localCoordinates.z || 0) * GALAXY_INTERIOR_SCALE
      );
      console.log(`  ⭐ Adding star "${title}" at local position: (${position.x.toFixed(0)}, ${position.y.toFixed(0)}, ${position.z.toFixed(0)})`);
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

    // Minimal logging for performance
    if (this.currentLevel === 'galaxy' && assetType === 'star') {
      // Only log stars in galaxy view for debugging
    } else if (assetType === 'galaxy') {
      // Only log galaxy positioning
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

    // Size by asset type or stats (balanced for universe scale)
    let size = 5;
    if (assetType === 'galaxy') {
      // Galaxies are smaller when in galaxy view (we're inside it)
      size = this.currentLevel === 'galaxy' ? 15 : 50; // Increased from 25 to 50 for better visibility
    }
    else if (assetType === 'star') {
      // Stars are MUCH larger when viewing galaxy interior
      size = this.currentLevel === 'galaxy' ? 500 : 8; // GIGANTIC stars for maximum visibility
      console.log(`⭐ Star size calculation: currentLevel='${this.currentLevel}', size=${size}`);
    }
    else if (assetType === 'planet') size = 8;    // Small-medium
    else if (assetType === 'orbital') size = 5;   // Small
    else if (assetType === 'station') size = 5;   // Small
    else if (assetType === 'anomaly') size = 40;  // Increased from 15 to 40 for visibility
    else if (assetType === 'zone') size = 20;     // Large area
    else if (assetType === 'ship') size = 5;      // Small
    else if (assetType === 'character') size = 3; // Very small
    else if (stats && stats.size) size = stats.size * 3;

    // Create geometry based on asset type
    let geometry, material, mesh, glow;

    if (assetType === 'galaxy') {
      // Galaxies: Simple colorful point
      // When in galaxy view, make the current galaxy clearly visible and keep it centered
      const isCurrentGalaxy = this.currentLevel === 'galaxy' &&
                             this.selectedGalaxyId &&
                             (assetData._id?.toString() === this.selectedGalaxyId?.toString());

      // In galaxy view, the current galaxy should be at origin (0,0,0)
      if (isCurrentGalaxy) {
        position = new THREE.Vector3(0, 0, 0);
        console.log(`  🌌 Current galaxy "${title}" positioned at origin for interior view`);
      }

      geometry = new THREE.SphereGeometry(size, 16, 16);
      material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: isCurrentGalaxy || this.currentLevel === 'galaxy',
        opacity: isCurrentGalaxy ? 0.05 : (this.currentLevel === 'galaxy' ? 0.2 : 1.0)
      });

      // Create a group to hold both the mesh and label together
      const galaxyGroup = new THREE.Group();
      galaxyGroup.position.copy(position);

      // Add mesh to group (at local origin)
      mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, 0, 0); // Relative to group
      galaxyGroup.add(mesh);

      // Add purple text label above galaxy (as child of group)
      const labelCanvas = document.createElement('canvas');
      const context = labelCanvas.getContext('2d');
      labelCanvas.width = 512;
      labelCanvas.height = 128;
      context.fillStyle = 'rgba(0, 0, 0, 0.7)';
      context.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
      context.font = 'Bold 48px Arial';
      context.fillStyle = '#8A4FFF'; // Purple text for galaxies
      context.textAlign = 'center';
      context.fillText(title, 256, 80);

      const labelTexture = new THREE.CanvasTexture(labelCanvas);
      const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture });
      const label = new THREE.Sprite(labelMaterial);
      label.scale.set(800, 200, 1); // Large readable labels
      label.position.set(0, size * 2.0, 0); // Above mesh, relative to group
      label.frustumCulled = false; // Always render
      label.raycast = () => {}; // Disable raycasting on label so clicks pass through
      galaxyGroup.add(label);

      console.log(`🏷️ Added purple label "${title}" above galaxy at y=${size * 2.0} (relative to galaxy)`);

      // Create purple orbital trail in galactic view (only if not the current galaxy we're inside)
      if (this.currentLevel === 'galactic' && !isCurrentGalaxy && assetData.physics && assetData.physics.vx !== undefined) {
        // We'll create the trail once we know the galaxy's parent anomaly
        // For now, just mark that this galaxy should have a trail
        galaxyGroup.userData.needsTrail = true;
      }

      // Use the group as the mesh (will be added to scene later)
      mesh = galaxyGroup;

      // No glow
      glow = null;

    } else if (assetType === 'zone') {
      // Zones: Simple torus ring
      geometry = new THREE.TorusGeometry(size * 8, size * 0.5, 8, 24);
      material = new THREE.MeshBasicMaterial({
        color: color,
        wireframe: true,
        transparent: true,
        opacity: 0.6
      });

      mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.rotation.x = Math.PI / 2;

      // No glow
      glow = null;

    } else if (assetType === 'anomaly') {
      // Anomaly: Simple orb only
      const dimmed = this.currentLevel === 'galaxy';

      geometry = new THREE.SphereGeometry(size, 16, 16);
      material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: dimmed,
        opacity: dimmed ? 0.15 : 1.0
      });

      mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);

      // Add white text label above anomaly
      const labelCanvas = document.createElement('canvas');
      const context = labelCanvas.getContext('2d');
      labelCanvas.width = 512;
      labelCanvas.height = 128;
      context.fillStyle = 'rgba(0, 0, 0, 0.7)';
      context.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
      context.font = 'Bold 48px Arial';
      context.fillStyle = 'white'; // White text for anomalies
      context.textAlign = 'center';
      context.fillText(title, 256, 80);

      const labelTexture = new THREE.CanvasTexture(labelCanvas);
      const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture });
      const label = new THREE.Sprite(labelMaterial);
      label.scale.set(800, 200, 1); // Large readable labels
      label.position.copy(position);
      label.position.y += size * 2.0; // Higher above orb
      label.frustumCulled = false; // Always render
      label.raycast = () => {}; // Disable raycasting on label so clicks pass through
      this.assetsGroup.add(label);

      console.log(`🏷️ Added white label "${title}" above anomaly at y=${position.y + size * 2.0}`);

      // No glow
      glow = null;
    } else if (assetType === 'star') {
      // Stars: Bright orbs with visible haze/glow in galaxy view
      const adjustedSize = size * 5.0;
      const colorObj = new THREE.Color(0xFFFF00);

      // Simple sphere
      const sphereGeometry = new THREE.SphereGeometry(adjustedSize, 16, 16);
      const starMaterial = new THREE.MeshBasicMaterial({
        color: colorObj,
        depthTest: true,
        depthWrite: true
      });

      mesh = new THREE.Mesh(sphereGeometry, starMaterial);
      mesh.position.copy(position);
      mesh.frustumCulled = false;
      mesh.visible = true;

      console.log(`🌟 Star orb: ${title} at (${position.x.toFixed(0)}, ${position.y.toFixed(0)}, ${position.z.toFixed(0)})`);

      // Add simple text label
      const labelCanvas = document.createElement('canvas');
      const context = labelCanvas.getContext('2d');
      labelCanvas.width = 512;
      labelCanvas.height = 128;
      context.fillStyle = 'rgba(0, 0, 0, 0.7)';
      context.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
      context.font = 'Bold 48px Arial';
      context.fillStyle = 'white';
      context.textAlign = 'center';
      context.fillText(title, 256, 80);

      const labelTexture = new THREE.CanvasTexture(labelCanvas);
      const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture });
      const label = new THREE.Sprite(labelMaterial);
      label.scale.set(adjustedSize * 4, adjustedSize, 1);
      label.position.copy(position);
      label.position.y += adjustedSize * 1.5;
      label.raycast = () => {}; // Disable raycasting on label so clicks pass through
      this.assetsGroup.add(label);

      // No glow effects
      glow = null;

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

      // Add simple text label for galaxies and anomalies
      if (assetType === 'galaxy' || assetType === 'anomaly') {
        const labelCanvas = document.createElement('canvas');
        const context = labelCanvas.getContext('2d');
        labelCanvas.width = 512;
        labelCanvas.height = 128;
        context.fillStyle = 'rgba(0, 0, 0, 0.7)';
        context.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
        context.font = 'Bold 48px Arial';
        // Purple text for galaxies, white for anomalies
        context.fillStyle = assetType === 'galaxy' ? '#8A4FFF' : 'white';
        context.textAlign = 'center';
        context.fillText(title, 256, 80);

        const labelTexture = new THREE.CanvasTexture(labelCanvas);
        const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture });
        const label = new THREE.Sprite(labelMaterial);
        // Much larger labels - fixed size instead of relative to orb
        label.scale.set(800, 200, 1); // Large readable labels
        label.position.copy(position);
        label.position.y += adjustedSize * 2.0; // Higher above orb
        label.frustumCulled = false; // Always render
        label.raycast = () => {}; // Disable raycasting on label so clicks pass through
        this.assetsGroup.add(label);

        console.log(`🏷️ Added label "${title}" above ${assetType} at y=${position.y + adjustedSize * 2.0}`);
      }

      // NO GLOW - solid spheres only for maximum visibility
      glow = new THREE.Object3D(); // Empty placeholder
    }

    // Store metadata - preserve existing userData (like galaxyShape params)
    mesh.userData = {
      ...mesh.userData, // Preserve existing userData
      id: _id,
      type: assetType,
      title: title,
      data: assetData
    };

    // Add physics properties for galaxies
    if (assetType === 'galaxy') {
      // Initialize with orbital velocity perpendicular to nearest anomaly
      // This allows galaxies to orbit rather than fall straight in
      let initialVelocity = new THREE.Vector3(0, 0, 0);

      // Find nearest anomaly to calculate orbital velocity
      const anomalies = Array.from(this.assets.values()).filter(a => a.mesh?.userData.type === 'anomaly');
      if (anomalies.length > 0) {
        // Find closest anomaly
        let nearestAnomaly = null;
        let minDistance = Infinity;

        anomalies.forEach(anomaly => {
          const dist = position.distanceTo(anomaly.mesh.position);
          if (dist < minDistance) {
            minDistance = dist;
            nearestAnomaly = anomaly.mesh;
          }
        });

        if (nearestAnomaly && minDistance > 10) {
          // Calculate orbital velocity: v = sqrt(G * M / r)
          const toAnomaly = new THREE.Vector3().subVectors(nearestAnomaly.position, position);
          const distance = toAnomaly.length();

          // Orbital speed formula
          const orbitalSpeed = Math.sqrt(this.GRAVITATIONAL_CONSTANT * this.ANOMALY_MASS / distance);

          // Velocity perpendicular to the line connecting galaxy to anomaly
          // Use cross product with up vector to get tangent direction
          const up = new THREE.Vector3(0, 1, 0);
          const tangent = new THREE.Vector3().crossVectors(toAnomaly, up).normalize();

          // Apply orbital velocity with some randomness (0.7 to 1.3 of ideal)
          const velocityFactor = 0.7 + Math.random() * 0.6;
          initialVelocity = tangent.multiplyScalar(orbitalSpeed * velocityFactor);

          console.log(`🌌 Galaxy ${title} initialized with orbital velocity ${orbitalSpeed.toFixed(2)} at distance ${distance.toFixed(1)} from anomaly`);
        }
      }

      mesh.userData.velocity = initialVelocity;
      mesh.userData.parentAnomaly = assetData.parentId || null; // Which anomaly it orbits
      mesh.userData.mass = this.GALAXY_MASS;
      console.log(`🌌 Galaxy ${title} initialized with physics (parent: ${mesh.userData.parentAnomaly || 'none'})`);
    }

    // Anomalies are static gravitational anchors
    if (assetType === 'anomaly') {
      mesh.userData.mass = this.ANOMALY_MASS;
      mesh.userData.isStatic = true; // Anomalies don't move
      console.log(`⚫ Anomaly ${title} initialized as static gravitational anchor`);
    }

    this.assetsGroup.add(mesh);
    // No glow effects - all removed
    if (glow) {
      this.assetsGroup.add(glow);
    }
    this.assets.set(_id, { mesh, glow });

    // Separate tracking by type
    if (assetType === 'star') {
      this.stars.set(_id, mesh);
      console.log(`  ✅ Star "${title}" added to scene at position (${mesh.position.x.toFixed(0)}, ${mesh.position.y.toFixed(0)}, ${mesh.position.z.toFixed(0)}) with size ${size}`);
    } else if (assetType === 'planet') {
      this.planets.set(_id, mesh);
    }
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
   * Rules:
   * - Each galaxy connects to its parent anomaly (1 connection per galaxy)
   * - Each anomaly can have up to 5 galaxy connections
   * - Each galaxy can have up to 3 connections to other galaxies
   */
  createGalacticConnections() {
    console.log('🌌 Creating travelable routes with connection limits...');

    // Collect all anomalies
    const anomalies = [];
    for (const [id, asset] of this.assets) {
      if (asset.mesh.userData.type === 'anomaly') {
        anomalies.push({
          id: id,
          pos: asset.mesh.position.clone(),
          title: asset.mesh.userData.title,
          connectionCount: 0,
          maxConnections: 5
        });
      }
    }

    // Collect all galaxies with their parent anomaly info
    const galaxies = [];
    for (const [id, asset] of this.assets) {
      if (asset.mesh.userData.type === 'galaxy') {
        galaxies.push({
          id: id,
          pos: asset.mesh.position.clone(),
          title: asset.mesh.userData.title,
          parentAnomaly: asset.mesh.userData.parentAnomaly || null,
          mesh: asset.mesh,
          galaxyConnectionCount: 0,
          maxGalaxyConnections: 3
        });
      }
    }

    console.log(`  📍 Found ${anomalies.length} anomalies`);
    console.log(`  🌌 Found ${galaxies.length} galaxies`);

    let connectionCount = 0;

    // 1. Connect each galaxy to its parent anomaly (if it has one)
    for (const galaxy of galaxies) {
      if (!galaxy.parentAnomaly) {
        console.log(`  ⚠️ Galaxy ${galaxy.title} has no parent anomaly`);
        continue;
      }

      const parentAnomaly = anomalies.find(a => a.id === galaxy.parentAnomaly);
      if (!parentAnomaly) {
        console.log(`  ⚠️ Galaxy ${galaxy.title} parent anomaly ${galaxy.parentAnomaly} not found`);
        continue;
      }

      // Check anomaly connection limit
      if (parentAnomaly.connectionCount >= parentAnomaly.maxConnections) {
        console.log(`  ⚠️ Anomaly ${parentAnomaly.title} has reached max connections (${parentAnomaly.maxConnections})`);
        continue;
      }

      this.createTravelRoute(
        parentAnomaly.pos,
        galaxy.pos,
        0x00ff88,
        `${parentAnomaly.title} ↔ ${galaxy.title}`
      );
      parentAnomaly.connectionCount++;
      connectionCount++;
      console.log(`  ✅ Connected ${galaxy.title} to parent ${parentAnomaly.title}`);
    }

    // 2. Connect galaxies to each other (limited to 3 connections per galaxy)
    // Use nearest neighbor approach to create meaningful connections
    for (let i = 0; i < galaxies.length; i++) {
      const galaxy = galaxies[i];

      // Find nearest galaxies and connect up to max limit
      const distances = galaxies
        .map((other, idx) => ({
          index: idx,
          galaxy: other,
          distance: galaxy.pos.distanceTo(other.pos)
        }))
        .filter(d => d.index !== i) // Exclude self
        .sort((a, b) => a.distance - b.distance); // Sort by distance

      for (const {galaxy: otherGalaxy} of distances) {
        // Check if we've hit our connection limit
        if (galaxy.galaxyConnectionCount >= galaxy.maxGalaxyConnections) {
          break;
        }

        // Check if other galaxy has hit its limit
        if (otherGalaxy.galaxyConnectionCount >= otherGalaxy.maxGalaxyConnections) {
          continue;
        }

        // Check if connection already exists (avoid duplicates)
        const existingConnection = this.findExistingConnection(galaxy.id, otherGalaxy.id);
        if (existingConnection) {
          continue;
        }

        // Create the connection
        this.createTravelRoute(
          galaxy.pos,
          otherGalaxy.pos,
          0x00aaff,  // Blue for galaxy-to-galaxy
          `${galaxy.title} ↔ ${otherGalaxy.title}`
        );

        galaxy.galaxyConnectionCount++;
        otherGalaxy.galaxyConnectionCount++;
        connectionCount++;
      }
    }

    console.log(`✅ Created ${connectionCount} travelable routes`);
    console.log(`   Anomaly connections: ${anomalies.reduce((sum, a) => sum + a.connectionCount, 0)}`);
    console.log(`   Galaxy-to-galaxy connections: ${galaxies.reduce((sum, g) => sum + g.galaxyConnectionCount, 0) / 2}`);
  }

  /**
   * Check if a connection already exists between two objects
   */
  findExistingConnection(idA, idB) {
    // We store connections in userData of line objects
    for (const child of this.connectionsGroup.children) {
      if (child.userData.isConnection && child.userData.routeLabel) {
        const label = child.userData.routeLabel;
        // Check if both IDs are in the route label (bidirectional check)
        if ((label.includes(idA) && label.includes(idB)) ||
            (label.includes(idB) && label.includes(idA))) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if player can travel to a given asset based on connections
   * @param {string} targetAssetId - ID of the destination asset
   * @param {Object} playerLocation - Current player location {x, y, z}
   * @returns {boolean} - True if destination is reachable
   */
  canTravelToAsset(targetAssetId, playerLocation) {
    if (!playerLocation) {
      console.warn('No player location provided');
      return false;
    }

    // Get target asset
    const targetAsset = this.assets.get(targetAssetId);
    if (!targetAsset) {
      console.warn(`Target asset ${targetAssetId} not found`);
      return false;
    }

    const targetType = targetAsset.mesh.userData.type;
    const targetPos = targetAsset.mesh.position;

    // Find which asset the player is currently at (within range)
    const LOCATION_THRESHOLD = 100; // How close to be "at" a location
    let currentAssetId = null;
    let currentAssetType = null;

    for (const [id, asset] of this.assets) {
      const distance = new THREE.Vector3(
        playerLocation.x,
        playerLocation.y,
        playerLocation.z || 0
      ).distanceTo(asset.mesh.position);

      if (distance < LOCATION_THRESHOLD) {
        currentAssetId = id;
        currentAssetType = asset.mesh.userData.type;
        break;
      }
    }

    // If not at any specific location, allow travel to anomalies only
    if (!currentAssetId) {
      console.log('Player not at any specific location');
      return targetType === 'anomaly';
    }

    // Check if there's a connection between current location and target
    const hasConnection = this.findExistingConnection(currentAssetId, targetAssetId);

    if (hasConnection) {
      console.log(`✅ Connection exists from ${currentAssetId} to ${targetAssetId}`);
      return true;
    }

    console.log(`⛔ No connection from ${currentAssetId} to ${targetAssetId}`);
    return false;
  }

  /**
   * Get list of connected destinations from current location
   * @param {Object} playerLocation - Current player location {x, y, z}
   * @returns {Array} - Array of asset IDs that can be traveled to
   */
  getConnectedDestinations(playerLocation) {
    if (!playerLocation) {
      return [];
    }

    // Find current asset
    const LOCATION_THRESHOLD = 100;
    let currentAssetId = null;

    for (const [id, asset] of this.assets) {
      const distance = new THREE.Vector3(
        playerLocation.x,
        playerLocation.y,
        playerLocation.z || 0
      ).distanceTo(asset.mesh.position);

      if (distance < LOCATION_THRESHOLD) {
        currentAssetId = id;
        break;
      }
    }

    if (!currentAssetId) {
      // If not at a location, can only travel to anomalies
      const anomalies = [];
      for (const [id, asset] of this.assets) {
        if (asset.mesh.userData.type === 'anomaly') {
          anomalies.push(id);
        }
      }
      return anomalies;
    }

    // Find all connected destinations
    const connected = [];
    for (const [id, asset] of this.assets) {
      if (id === currentAssetId) continue;

      if (this.findExistingConnection(currentAssetId, id)) {
        connected.push(id);
      }
    }

    return connected;
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

    // Enhanced touch controls for mobile
    let touchStartPos = null;
    let touchStartTime = 0;
    let controlsWereMoving = false;

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        touchStartTime = Date.now();
        this.touchMoved = false;
        controlsWereMoving = false;

        // Update mouse position for raycasting
        this.mouse.x = (e.touches[0].clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.touches[0].clientY / window.innerHeight) * 2 + 1;

        console.log('👆 Touch start at:', this.mouse);
      } else if (e.touches.length === 2) {
        // Track pinch zoom distance
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
        this.touchMoved = true; // Multi-touch is always movement
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && touchStartPos) {
        const dist = Math.sqrt(
          Math.pow(e.touches[0].clientX - touchStartPos.x, 2) +
          Math.pow(e.touches[0].clientY - touchStartPos.y, 2)
        );
        if (dist > 10) {
          this.touchMoved = true;
          controlsWereMoving = true;
        }
      }
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1 && touchStartPos) {
        const touchDuration = Date.now() - touchStartTime;
        const dist = Math.sqrt(
          Math.pow(e.changedTouches[0].clientX - touchStartPos.x, 2) +
          Math.pow(e.changedTouches[0].clientY - touchStartPos.y, 2)
        );

        console.log(`👆 Touch end - Duration: ${touchDuration}ms, Distance: ${dist}px, Moved: ${this.touchMoved}`);

        // Treat as tap if short duration and minimal movement
        // More lenient thresholds for better mobile UX
        if (touchDuration < 400 && dist < 20 && !controlsWereMoving) {
          // Update mouse position and trigger click
          this.mouse.x = (e.changedTouches[0].clientX / window.innerWidth) * 2 - 1;
          this.mouse.y = -(e.changedTouches[0].clientY / window.innerHeight) * 2 + 1;

          console.log('✅ Tap detected! Triggering selection...');
          this.handleClick({ clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY });
        } else {
          console.log('❌ Not a tap - treated as drag/pan');
        }
      }
      touchStartPos = null;
      controlsWereMoving = false;
    }, { passive: true });
  }

  /**
   * Handle object selection
   */
  handleClick(event) {
    try {
      // Update mouse position from the click event
      if (event && event.clientX !== undefined && event.clientY !== undefined) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      }

      console.log('🎯 handleClick called with mouse:', this.mouse);

      if (!this.raycaster || !this.camera || !this.mouse) {
        console.warn('⚠️ Missing required objects for raycasting');
        return;
      }

      this.raycaster.setFromCamera(this.mouse, this.camera);

      // Only raycast against assets group to avoid hitting UI elements or connections
      if (!this.assetsGroup || !this.assetsGroup.children) {
        console.warn('⚠️ Assets group not available');
        return;
      }

      const intersects = this.raycaster.intersectObjects(this.assetsGroup.children, true);
      console.log(`🔍 Raycaster found ${intersects.length} intersections`);

      if (intersects.length > 0) {
        let object = intersects[0].object;

        // If clicked object doesn't have userData.id, traverse up to find parent that does
        let traverseCount = 0;
        while (object && (!object.userData || !object.userData.id)) {
          if (!object.parent || object.parent === this.scene) {
            // Reached scene root without finding valid object
            break;
          }
          object = object.parent;
          traverseCount++;
          if (traverseCount > 10) {
            console.warn('⚠️ Too many parent traversals, stopping');
            break;
          }
        }

        // If we found a valid object with userData
        if (object && object.userData && object.userData.id) {
          console.log('✅ Selected object:', object.userData.title || object.userData.id);
          this.selectObject(object);
        } else {
          console.log('❌ No valid object found with userData.id');
          if (!this.justSelected) {
            console.log('🔴 Deselecting (no object)');
            this.deselectObject();
          } else {
            console.log('🛡️ PROTECTED: Not deselecting (justSelected=true)');
          }
        }
      } else {
        console.log('❌ No intersections found, deselecting');
        if (!this.justSelected) {
          console.log('🔴 Deselecting (no intersections)');
          this.deselectObject();
        } else {
          console.log('🛡️ PROTECTED: Not deselecting (justSelected=true)');
        }
      }
    } catch (error) {
      console.error('❌ Error in handleClick:', error);
      // Don't break the application, just log the error
    }
  }

  /**
   * Select an object and handle drill-down navigation
   */
  selectObject(object) {
    console.log('🔥 selectObject CALLED with:', object.userData?.title, 'type:', object.userData?.assetType);
    try {
      if (!object || !object.userData) {
        console.warn('⚠️ Invalid object for selection');
        return;
      }

      // Set flag to prevent immediate deselection
      this.justSelected = true;
      console.log('✅ Set justSelected=true, protection active for 500ms');
      setTimeout(() => {
        this.justSelected = false;
        console.log('⏰ Protection window expired, justSelected=false');
      }, 500); // 500ms protection window

      // Deselect previous
      if (this.selectedObject) {
        try {
          // Handle Groups (galaxies, anomalies, stars)
          if (this.selectedObject.isGroup) {
            this.selectedObject.traverse((child) => {
              if (child.material) {
                if (child.material.emissive) {
                  child.material.emissive.setHex(0x000000);
                }
                if (child.material.wireframe && child.material.opacity !== undefined) {
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
        } catch (err) {
          console.warn('⚠️ Error deselecting previous object:', err);
        }
      }

      // Select new
      this.selectedObject = object;

      // Highlight based on material type
      try {
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
      } catch (err) {
        console.warn('⚠️ Error highlighting object:', err);
      }

      // Focus camera on selected object
      if (object.position) {
        this.focusCameraOn(object.position);
      }

      // If selecting a star in galaxy view, enable camera following
      if (this.currentLevel === 'galaxy' && object.userData.assetType === 'star') {
        this.selectedStar = object;
        this.followingStar = true;
        console.log('⭐ Following star:', object.userData.title);

        // Show star info modal
        this.showStarInfoModal(object.userData);
      } else {
        this.selectedStar = null;
        this.followingStar = false;
        this.hideStarInfoModal();
      }

      // If selecting an anomaly or zone, show landable location modal
      // NOTE: userData uses 'type' not 'assetType'
      const assetType = object.userData.type || object.userData.assetType;
      console.log(`🔍 Checking modal trigger: type=${object.userData.type}, assetType=${object.userData.assetType}, resolved=${assetType}, title=${object.userData.title}`);
      if (assetType === 'anomaly' || assetType === 'zone') {
        console.log(`🎯 Selected landable location: ${object.userData.title} - CALLING showLandableLocationModal`);
        this.showLandableLocationModal(object.userData).catch(err => {
          console.error('❌ Error showing modal:', err);
        });
      } else {
        console.log(`ℹ️ Not anomaly/zone (type=${assetType}), hiding modal`);
        this.hideLandableLocationModal();
      }

      // Emit event for UI to handle
      try {
        const event = new CustomEvent('assetSelected', {
          detail: object.userData
        });
        window.dispatchEvent(event);
      } catch (err) {
        console.warn('⚠️ Error dispatching event:', err);
      }

      console.log('✅ Selected:', object.userData.title || object.userData.id);
    } catch (error) {
      console.error('❌ Error in selectObject:', error);
    }
  }

  /**
   * Show star info modal with system button
   */
  showStarInfoModal(starData) {
    let modal = document.getElementById('star-info-modal');
    if (!modal) {
      // Create modal if it doesn't exist
      modal = document.createElement('div');
      modal.id = 'star-info-modal';
      modal.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 20, 40, 0.95);
        border: 2px solid #6dd5ed;
        border-radius: 10px;
        padding: 20px;
        color: #6dd5ed;
        font-family: 'Courier New', monospace;
        z-index: 1000;
        min-width: 250px;
        box-shadow: 0 0 20px rgba(109, 213, 237, 0.5);
        backdrop-filter: blur(10px);
      `;
      document.body.appendChild(modal);
    }

    // Count planets for this star
    const planetCount = this.allAssets ? this.allAssets.filter(a =>
      a.assetType === 'planet' && a.parentId === starData.id
    ).length : 0;

    modal.innerHTML = `
      <h3 style="margin: 0 0 10px 0; color: #6dd5ed; text-shadow: 0 0 10px rgba(109, 213, 237, 0.5);">⭐ ${starData.title || 'Unknown Star'}</h3>
      <div style="margin: 10px 0; font-size: 14px; color: #6dd5ed;">
        <div>Type: Star</div>
        <div>Planets: ${planetCount}</div>
        <div style="margin-top: 10px; font-size: 12px; color: #2193b0;">Camera following star...</div>
      </div>
      <button id="view-system-btn" style="
        width: 100%;
        padding: 10px;
        margin-top: 15px;
        background: linear-gradient(45deg, #6dd5ed, #2193b0);
        border: none;
        border-radius: 5px;
        color: #000;
        font-weight: bold;
        cursor: pointer;
        font-size: 14px;
        box-shadow: 0 0 10px rgba(109, 213, 237, 0.3);
        transition: all 0.3s;
      ">
        🚀 View Solar System
      </button>
      <button id="stop-following-btn" style="
        width: 100%;
        padding: 8px;
        margin-top: 10px;
        background: rgba(0, 20, 40, 0.6);
        border: 1px solid #2193b0;
        border-radius: 5px;
        color: #6dd5ed;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.3s;
      ">
        ✋ Stop Following
      </button>
    `;

    modal.style.display = 'block';

    // Add button handlers
    const viewSystemBtn = document.getElementById('view-system-btn');
    if (viewSystemBtn) {
      viewSystemBtn.onclick = () => {
        window.location.href = `/universe/system-map-3d?star=${starData.id}`;
      };
    }

    const stopBtn = document.getElementById('stop-following-btn');
    if (stopBtn) {
      stopBtn.onclick = () => {
        this.followingStar = false;
        this.selectedStar = null;
        this.hideStarInfoModal();
      };
    }
  }

  /**
   * Hide star info modal
   */
  hideStarInfoModal() {
    const modal = document.getElementById('star-info-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * Show landable location modal (for anomalies, zones, etc.)
   */
  async showLandableLocationModal(assetData) {
    console.log('🚀 showLandableLocationModal CALLED with:', assetData);
    let modal = document.getElementById('landable-location-modal');
    if (!modal) {
      // Create modal if it doesn't exist
      modal = document.createElement('div');
      modal.id = 'landable-location-modal';
      modal.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(40, 0, 60, 0.95);
        border: 2px solid #ff00ff;
        border-radius: 10px;
        padding: 20px;
        color: #ff00ff;
        font-family: 'Courier New', monospace;
        z-index: 1000;
        min-width: 300px;
        box-shadow: 0 0 20px rgba(255, 0, 255, 0.5);
        backdrop-filter: blur(10px);
      `;
      document.body.appendChild(modal);
    }

    const assetType = assetData.type || assetData.assetType;
    const icon = assetType === 'anomaly' ? '🌀' : '🏛️';
    const typeName = assetType === 'anomaly' ? 'Anomaly' : 'Zone';

    // Check if anomaly has interior zones
    let hasInterior = true;
    let interiorInfo = '';
    if (assetType === 'anomaly') {
      try {
        const response = await fetch(`/api/v1/hierarchy/descendants/${assetData.id}?maxDepth=1`, {
          credentials: 'same-origin'
        });
        const data = await response.json();
        const zones = data.descendants?.filter(d => d.assetType === 'zone') || [];
        hasInterior = zones.length > 0;
        if (hasInterior) {
          interiorInfo = `<div style="font-size: 11px; color: #00ff88; margin-top: 5px;">✅ Interior zones: ${zones.length}</div>`;
        } else {
          interiorInfo = `<div style="font-size: 11px; color: #ffaa00; margin-top: 5px;">⚠️ No interior zones yet</div>`;
        }
      } catch (error) {
        console.error('Error checking interior zones:', error);
      }
    }

    modal.innerHTML = `
      <h3 style="margin: 0 0 10px 0; color: #ff00ff; text-shadow: 0 0 10px rgba(255, 0, 255, 0.5);">
        ${icon} ${assetData.title || 'Unknown Location'}
      </h3>
      <div style="margin: 10px 0; font-size: 14px; color: #ff00ff;">
        <div>Type: ${typeName}</div>
        <div>Status: <span style="color: #00ff88;">Landable</span></div>
        <div style="margin-top: 10px; font-size: 12px; color: #cc00cc;">
          ${assetType === 'anomaly' ? 'Interstellar Starship Colony' : 'Explorable Zone'}
        </div>
        ${interiorInfo}
      </div>
      <button id="land-location-btn" style="
        width: 100%;
        padding: 10px;
        margin-top: 15px;
        background: linear-gradient(45deg, #ff00ff, #cc00cc);
        border: none;
        border-radius: 5px;
        color: #fff;
        font-weight: bold;
        cursor: pointer;
        font-size: 14px;
        box-shadow: 0 0 10px rgba(255, 0, 255, 0.3);
        text-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
        transition: all 0.3s;
      ">
        🚀 ${hasInterior ? 'Enter Interior' : 'Land Here'}
      </button>
      <button id="close-location-btn" style="
        width: 100%;
        padding: 8px;
        margin-top: 10px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid #ff00ff;
        border-radius: 5px;
        color: #ff00ff;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.3s;
      ">
        Close
      </button>
    `;

    modal.style.display = 'block';

    // Stop click events from propagating to canvas
    modal.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    modal.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    modal.addEventListener('mouseup', (e) => {
      e.stopPropagation();
    });

    // Add event listeners
    const landBtn = document.getElementById('land-location-btn');
    if (landBtn) {
      landBtn.onclick = async () => {
        console.log(`🚀 Landing on ${assetData.title}`);

        // For anomalies, find the interior zone first
        const assetType = assetData.type || assetData.assetType;
        if (assetType === 'anomaly') {
          try {
            // Fetch direct children (zones) of this anomaly
            const response = await fetch(`/api/v1/hierarchy/descendants/${assetData.id}?maxDepth=1`, {
              credentials: 'same-origin'
            });
            const data = await response.json();

            if (data.success && data.descendants && data.descendants.length > 0) {
              // Prefer zones with actual zoneData (floormap), fallback to any zone
              let interiorZone = data.descendants.find(child =>
                child.assetType === 'zone' && child.zoneData
              );

              // If no zone has data, use the first zone found
              if (!interiorZone) {
                interiorZone = data.descendants.find(child => child.assetType === 'zone');
              }

              if (interiorZone) {
                const hasData = interiorZone.zoneData ? '✅' : '⚠️ (no floormap)';
                console.log(`✅ Found interior zone: ${interiorZone.title} (${interiorZone._id}) ${hasData}`);
                window.location.href = `/universe/zone/${interiorZone._id}`;
              } else {
                console.log('⚠️ No zone found in anomaly children');
                alert(`This anomaly doesn't have an interior zone yet!\n\nCreate one at: /universe/interior-map-builder?parentAssetId=${assetData.id}&parentAssetType=anomaly`);
              }
            } else {
              console.log('⚠️ No interior zone found for this anomaly');
              alert(`This anomaly doesn't have an interior zone yet!\n\nCreate one at: /universe/interior-map-builder?parentAssetId=${assetData.id}&parentAssetType=anomaly`);
            }
          } catch (error) {
            console.error('Error finding interior zone:', error);
            alert('Failed to find interior zone. Check console for details.');
          }
        } else {
          // For zones, navigate directly
          window.location.href = `/universe/zone/${assetData.id}`;
        }
      };
    }

    const closeBtn = document.getElementById('close-location-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        this.hideLandableLocationModal();
        this.deselectObject();
      };
    }
  }

  /**
   * Hide landable location modal
   */
  hideLandableLocationModal() {
    const modal = document.getElementById('landable-location-modal');
    if (modal) {
      modal.style.display = 'none';
    }
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
      // Inside galaxy view - stars spread across ~12000 units (-6000 to +6000) after 3x expansion
      // Camera should be close enough to see stars clearly but far enough to see many at once
      targetDistance = 8000; // Increased from 3000 to accommodate larger star spread
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
   * Animate camera to a specific saved state (position, zoom, target)
   * Used when returning to galactic level to restore previous view
   * @param {THREE.Vector3} targetPosition - Target camera position
   * @param {Number} targetZoom - Target zoom level
   * @param {THREE.Vector3} targetControlsTarget - Target controls focus point
   * @param {Number} duration - Animation duration in ms
   */
  animateCameraToState(targetPosition, targetZoom, targetControlsTarget, duration = 1500) {
    if (!this.controls) return;

    console.log(`🎬 Animating camera to saved state over ${duration}ms`);
    console.log(`   From: pos=(${this.camera.position.x.toFixed(1)}, ${this.camera.position.y.toFixed(1)}, ${this.camera.position.z.toFixed(1)}) zoom=${this.camera.zoom.toFixed(2)}`);
    console.log(`   To: pos=(${targetPosition.x.toFixed(1)}, ${targetPosition.y.toFixed(1)}, ${targetPosition.z.toFixed(1)}) zoom=${targetZoom.toFixed(2)}`);

    const startPosition = this.camera.position.clone();
    const startZoom = this.camera.zoom;
    const startTarget = this.controls.target.clone();

    const startTime = Date.now();

    // Temporarily disable user control during animation
    const wasEnabled = this.controls.enabled;
    this.controls.enabled = false;

    const animateCamera = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-in-out function for smooth animation
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Interpolate camera position
      this.camera.position.lerpVectors(startPosition, targetPosition, eased);

      // Interpolate zoom
      this.camera.zoom = startZoom + (targetZoom - startZoom) * eased;
      this.camera.updateProjectionMatrix();

      // Interpolate controls target
      this.controls.target.lerpVectors(startTarget, targetControlsTarget, eased);
      this.controls.update();

      if (progress < 1) {
        requestAnimationFrame(animateCamera);
      } else {
        // Re-enable controls when animation complete
        this.controls.enabled = wasEnabled;
        console.log('✅ Camera state restoration complete');
        console.log(`   Final: pos=(${this.camera.position.x.toFixed(1)}, ${this.camera.position.y.toFixed(1)}, ${this.camera.position.z.toFixed(1)}) zoom=${this.camera.zoom.toFixed(2)}`);
      }
    };

    animateCamera();
  }

  /**
   * Animate zoom-out from galaxy interior back to galactic view
   * Zooms out along the approach vector - starts tight on galaxy, pulls back hard
   * @param {THREE.Vector3} galaxyPositionInGalacticSpace - Where the galaxy is in the universe
   * @param {THREE.Vector3} targetPosition - Final camera position (saved from before zoom-in)
   * @param {Number} targetZoom - Final zoom level
   * @param {THREE.Vector3} targetControlsTarget - Final controls target
   */
  animateZoomOutFromGalaxy(galaxyPositionInGalacticSpace, targetPosition, targetZoom, targetControlsTarget) {
    if (!this.controls) return;

    console.log(`🎬 Starting zoom-out animation from galaxy interior`);
    console.log(`   Galaxy position in galactic space: (${galaxyPositionInGalacticSpace.x.toFixed(1)}, ${galaxyPositionInGalacticSpace.y.toFixed(1)}, ${galaxyPositionInGalacticSpace.z.toFixed(1)})`);
    console.log(`   Target camera position: (${targetPosition.x.toFixed(1)}, ${targetPosition.y.toFixed(1)}, ${targetPosition.z.toFixed(1)})`);

    // Calculate the zoom vector - direction from galaxy to where camera should end up
    const zoomVector = new THREE.Vector3()
      .subVectors(targetPosition, galaxyPositionInGalacticSpace)
      .normalize();

    // Start camera TIGHT on the galaxy (very close in galactic space)
    const startDistance = 200; // Very close to galaxy
    const startPosition = galaxyPositionInGalacticSpace.clone().add(
      zoomVector.clone().multiplyScalar(startDistance)
    );

    // Set initial camera state (tight on galaxy)
    this.camera.position.copy(startPosition);
    this.camera.zoom = 2.0; // Zoomed in tight
    this.camera.updateProjectionMatrix();

    // Point camera at galaxy
    this.controls.target.copy(galaxyPositionInGalacticSpace);
    this.controls.update();

    console.log(`   Starting camera (tight): (${startPosition.x.toFixed(1)}, ${startPosition.y.toFixed(1)}, ${startPosition.z.toFixed(1)})`);
    console.log(`   Zoom vector: (${zoomVector.x.toFixed(3)}, ${zoomVector.y.toFixed(3)}, ${zoomVector.z.toFixed(3)})`);

    const animationDuration = 750; // 750ms for snappy feel
    const animationStart = Date.now();

    // Disable controls during animation
    const wasEnabled = this.controls.enabled;
    this.controls.enabled = false;

    const animateZoomOut = () => {
      const elapsed = Date.now() - animationStart;
      const progress = Math.min(elapsed / animationDuration, 1);

      // Ease-in with snappy finish - starts slow, accelerates, then quick stop
      // Using quartic ease-in for smooth acceleration
      const eased = progress * progress * progress * progress;

      // Animate from tight on galaxy to final saved position (pull back hard along zoom vector)
      this.camera.position.lerpVectors(startPosition, targetPosition, eased);

      // Animate zoom from tight (2.0) to saved zoom
      this.camera.zoom = 2.0 + (targetZoom - 2.0) * eased;
      this.camera.updateProjectionMatrix();

      // Animate controls target from galaxy to saved target
      this.controls.target.lerpVectors(galaxyPositionInGalacticSpace, targetControlsTarget, eased);
      this.controls.update();

      // Render frame
      this.renderer.render(this.scene, this.camera);

      if (progress < 1) {
        requestAnimationFrame(animateZoomOut);
      } else {
        // Animation complete
        console.log(`✅ Zoom-out animation complete`);
        console.log(`   Final camera: pos=(${this.camera.position.x.toFixed(0)}, ${this.camera.position.y.toFixed(0)}, ${this.camera.position.z.toFixed(0)})`);
        console.log(`   Final zoom: ${this.camera.zoom.toFixed(2)}`);

        // Re-enable controls
        this.controls.enabled = wasEnabled;
        this.controls.update();
      }
    };

    // Start animation
    animateZoomOut();
  }

  /**
   * Deselect current object
   */
  deselectObject() {
    try {
      if (this.selectedObject) {
        // Handle Groups (galaxies, anomalies, stars)
        if (this.selectedObject.isGroup) {
          this.selectedObject.traverse((child) => {
            if (child.material) {
              if (child.material.emissive) {
                child.material.emissive.setHex(0x000000);
              }
              if (child.material.wireframe && child.material.opacity !== undefined) {
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

      // Hide landable location modal when deselecting
      this.hideLandableLocationModal();

      try {
        const event = new CustomEvent('assetDeselected');
        window.dispatchEvent(event);
      } catch (err) {
        console.warn('⚠️ Error dispatching deselect event:', err);
      }
    } catch (error) {
      console.error('❌ Error in deselectObject:', error);
    }
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
            // HUD disabled - just trigger CSS event
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
      console.log('🔄 Window resized, updating Three.js scene...');

      // Update camera aspect ratio for PerspectiveCamera
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(window.devicePixelRatio);

      // Update controls if they exist
      if (this.controls) {
        this.controls.update();
      }

      // Force a render
      this.renderer.render(this.scene, this.camera);

      console.log('✅ Scene updated for new size:', window.innerWidth, 'x', window.innerHeight);
    });
  }

  /**
   * Update galaxy physics - gravitational attraction to anomalies
   */
  updatePhysics(deltaTime) {
    if (!this.physicsEnabled || this.currentLevel !== 'galactic') return;

    // Get all anomalies and galaxies
    const anomalies = [];
    const galaxies = [];

    this.assets.forEach((asset, id) => {
      if (asset.mesh?.userData.type === 'anomaly') {
        anomalies.push({ id, mesh: asset.mesh });
      } else if (asset.mesh?.userData.type === 'galaxy') {
        galaxies.push({ id, mesh: asset.mesh });
      }
    });

    if (anomalies.length === 0) return; // No anomalies, no physics

    // Update each galaxy
    galaxies.forEach(galaxy => {
      const galaxyPos = galaxy.mesh.position;
      const galaxyVel = galaxy.mesh.userData.velocity || new THREE.Vector3(0, 0, 0);
      let totalForce = new THREE.Vector3(0, 0, 0);
      let nearestAnomaly = null;
      let nearestDistance = Infinity;

      // Calculate gravitational forces from all anomalies
      anomalies.forEach(anomaly => {
        const anomalyPos = anomaly.mesh.position;
        const direction = new THREE.Vector3().subVectors(anomalyPos, galaxyPos);
        const distance = direction.length();

        if (distance < 10) return; // Skip if too close (prevents extreme forces)

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestAnomaly = anomaly.id;
        }

        // F = G * (m1 * m2) / r^2
        const forceMagnitude = this.GRAVITATIONAL_CONSTANT *
          (this.GALAXY_MASS * this.ANOMALY_MASS) /
          (distance * distance);

        direction.normalize();
        const force = direction.multiplyScalar(forceMagnitude);
        totalForce.add(force);
      });

      // Galaxies orbit freely - no capture logic
      // They will naturally fall into elliptical orbits around anomalies

      // Apply force to velocity (F = ma, so a = F/m)
      const acceleration = totalForce.divideScalar(this.GALAXY_MASS);
      galaxyVel.add(acceleration.multiplyScalar(deltaTime));

      // Clamp velocity
      if (galaxyVel.length() > this.MAX_VELOCITY) {
        galaxyVel.normalize().multiplyScalar(this.MAX_VELOCITY);
      }

      // Update position
      const displacement = galaxyVel.clone().multiplyScalar(deltaTime);
      galaxyPos.add(displacement);

      // Store velocity back
      galaxy.mesh.userData.velocity = galaxyVel;

      // Update force arrow
      this.updateForceArrow(galaxy.id, galaxyPos, totalForce);

      // Update stars that belong to this galaxy (they move with it)
      this.updateStarsForGalaxy(galaxy.id);
    });
  }

  /**
   * Update force visualization arrow for a galaxy
   */
  updateForceArrow(galaxyId, position, force) {
    if (!this.showForceArrows) return;

    const forceMagnitude = force.length();
    if (forceMagnitude < 0.1) {
      // Remove arrow if force is negligible
      const arrow = this.forceArrows.get(galaxyId);
      if (arrow) {
        this.forceArrowsGroup.remove(arrow);
        this.forceArrows.delete(galaxyId);
      }
      return;
    }

    let arrow = this.forceArrows.get(galaxyId);

    if (!arrow) {
      // Create new arrow
      const dir = force.clone().normalize();
      const length = Math.min(forceMagnitude / 50, 300); // Scale for visibility
      const color = 0x00ffff; // Cyan for force vectors

      arrow = new THREE.ArrowHelper(dir, position, length, color, 30, 20);
      this.forceArrowsGroup.add(arrow);
      this.forceArrows.set(galaxyId, arrow);
    } else {
      // Update existing arrow
      const dir = force.clone().normalize();
      const length = Math.min(forceMagnitude / 50, 300);

      arrow.position.copy(position);
      arrow.setDirection(dir);
      arrow.setLength(length, 30, 20);
    }
  }

  /**
   * Update star positions to follow their parent galaxy
   */
  updateStarsForGalaxy(galaxyId) {
    const galaxyAsset = this.assets.get(galaxyId);
    if (!galaxyAsset || !galaxyAsset.mesh) return;

    const galaxyPosition = galaxyAsset.mesh.position;

    this.assets.forEach((asset, id) => {
      if (asset.mesh?.userData.type === 'star' && asset.mesh.userData.data?.parentGalaxy === galaxyId) {
        // Initialize local offset if not set
        if (!asset.mesh.userData.localOffset) {
          asset.mesh.userData.localOffset = new THREE.Vector3().subVectors(
            asset.mesh.position,
            galaxyPosition
          );
        }

        // Stars maintain their local offset from galaxy center
        const localOffset = asset.mesh.userData.localOffset;
        asset.mesh.position.copy(galaxyPosition).add(localOffset);

        if (asset.glow && asset.glow.parent !== asset.mesh) {
          asset.glow.position.copy(asset.mesh.position);
        }
      }
    });
  }

  /**
   * Update galaxy parent in database
   */
  async updateGalaxyParent(galaxyId, anomalyId) {
    try {
      const response = await fetch(`/api/v1/assets/${galaxyId}/parent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: anomalyId })
      });

      if (response.ok) {
        console.log(`✅ Updated galaxy ${galaxyId} parent to ${anomalyId} in database`);
      } else {
        console.warn(`⚠️ Failed to update galaxy parent: ${response.statusText}`);
      }
    } catch (err) {
      console.error('Failed to update galaxy parent:', err);
    }
  }

  /**
   * Handle physics updates from server
   * Updates galaxy positions based on authoritative server simulation
   */
  handleServerPhysicsUpdate(data) {
    console.log('⚡ handleServerPhysicsUpdate CALLED', {
      hasData: !!data,
      galaxies: data?.galaxies?.length || 0,
      stars: data?.stars?.length || 0,
      characters: data?.characters?.length || 0,
      connections: data?.connections?.length || 0
    });

    if (!data) return;

    // Update galaxy positions
    if (data.galaxies && data.galaxies.length > 0) {
      data.galaxies.forEach(galaxyUpdate => {
        const asset = this.assets.get(galaxyUpdate.id);
        if (!asset || !asset.mesh || asset.mesh.userData.type !== 'galaxy') return;

        const mesh = asset.mesh;
        const targetPos = galaxyUpdate.position;

        // Smooth interpolation to new position (lerp for smooth movement)
        // This prevents jumpy movement between server updates
        const lerpFactor = 0.1; // Adjust for smoothness vs responsiveness
        mesh.position.x += (targetPos.x - mesh.position.x) * lerpFactor;
        mesh.position.y += (targetPos.y - mesh.position.y) * lerpFactor;
        mesh.position.z += (targetPos.z - mesh.position.z) * lerpFactor;

        // Store velocity for debugging/visualization
        if (galaxyUpdate.velocity) {
          mesh.userData.velocity = new THREE.Vector3(
            galaxyUpdate.velocity.vx,
            galaxyUpdate.velocity.vy,
            galaxyUpdate.velocity.vz
          );
        }

        // Create/update purple orbital trail for galaxy
        this.createGalaxyTrail(mesh, galaxyUpdate.id);
      });
    }

    // Update star positions (stars orbit galaxies in galactic view)
    if (data.stars && data.stars.length > 0 && this.currentLevel === 'galactic') {
      data.stars.forEach(starUpdate => {
        const asset = this.assets.get(starUpdate.id);
        if (!asset || !asset.mesh || asset.mesh.userData.type !== 'star') return;

        const mesh = asset.mesh;
        const targetPos = starUpdate.position;

        // Smooth interpolation to new position
        const lerpFactor = 0.1;
        mesh.position.x += (targetPos.x - mesh.position.x) * lerpFactor;
        mesh.position.y += (targetPos.y - mesh.position.y) * lerpFactor;
        mesh.position.z += (targetPos.z - mesh.position.z) * lerpFactor;

        // Store velocity for debugging/visualization
        if (starUpdate.velocity) {
          mesh.userData.velocity = new THREE.Vector3(
            starUpdate.velocity.vx,
            starUpdate.velocity.vy,
            starUpdate.velocity.vz
          );
        }
      });
    }

    // Update connections if provided
    if (data.connections) {
      this.updateConnectionsFromServer(data.connections);
    }

    // OPTION B: Extract characters from nested structure
    const allCharacters = [];

    // Extract docked characters from galaxies
    if (data.galaxies && Array.isArray(data.galaxies)) {
      data.galaxies.forEach(galaxy => {
        if (galaxy.dockedCharacters && galaxy.dockedCharacters.length > 0) {
          console.log(`🌌 Galaxy ${galaxy.id}: ${galaxy.dockedCharacters.length} docked characters`);
          galaxy.dockedCharacters.forEach(char => {
            // Character position = galaxy position (they're docked!)
            allCharacters.push({
              _id: char._id,
              name: char.name,
              userId: char.userId,
              location: {
                x: galaxy.position.x,
                y: galaxy.position.y,
                z: galaxy.position.z
              },
              dockedGalaxyId: galaxy.id,
              isInTransit: false,
              activeInShip: char.activeInShip,
              ship: char.ship
            });
          });
        }
      });
    }

    // Extract in-transit characters
    if (data.inTransit && Array.isArray(data.inTransit)) {
      console.log(`🚀 ${data.inTransit.length} characters in transit`);
      data.inTransit.forEach(char => {
        allCharacters.push({
          _id: char._id,
          name: char.name,
          userId: char.userId,
          location: char.location,
          dockedGalaxyId: null,
          isInTransit: true,
          activeInShip: char.activeInShip,
          from: char.from,
          to: char.to,
          eta: char.eta
        });
      });
    }

    // Update character positions
    if (allCharacters.length > 0) {
      console.log(`📦 Total ${allCharacters.length} characters (nested structure)`);
      allCharacters.forEach(char => {
        if (char.location && char.location.x !== undefined) {
          console.log(`🎯 Creating pin for ${char.name} at (${char.location.x.toFixed(0)}, ${char.location.y.toFixed(0)}, ${char.location.z.toFixed(0)}) ${char.dockedGalaxyId ? 'DOCKED' : 'IN-TRANSIT'}`);
          this.createCharacterPin(char);

          // Detailed verification
          const playerData = this.players.get(char._id);
          if (playerData && playerData.mesh) {
            console.log(`   ✅ Pin at:`, playerData.mesh.position);
          }
        } else {
          console.warn(`⚠️ Character ${char.name} missing location`, char);
        }
      });

      // Camera info for debugging
      console.log(`🎬 Camera: pos=(${this.camera.position.x.toFixed(0)}, ${this.camera.position.y.toFixed(0)}, ${this.camera.position.z.toFixed(0)})`);
    } else {
      console.log('⚠️ No characters in physics update');
    }

    // Store simulation speed for UI
    if (data.simulationSpeed !== undefined) {
      this.simulationSpeed = data.simulationSpeed;
    }
  }

  /**
   * Update connection visualizations from server data
   */
  updateConnectionsFromServer(connections) {
    // Only render in galactic view (not in galaxy interior)
    if (this.currentLevel !== 'galactic') return;

    // Clear existing connections
    while (this.connectionsGroup.children.length > 0) {
      const child = this.connectionsGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
      this.connectionsGroup.remove(child);
    }

    // Create new connections
    console.log(`🔗 Rendering ${connections.length} connection lines`);
    connections.forEach(conn => {
      this.createConnection(conn);
    });
  }

  /**
   * Create a single connection line with appropriate styling
   */
  createConnection(conn) {
    const fromPos = new THREE.Vector3(conn.fromPos.x, conn.fromPos.y, conn.fromPos.z);
    const toPos = new THREE.Vector3(conn.toPos.x, conn.toPos.y, conn.toPos.z);

    const points = [fromPos, toPos];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    // Determine line style based on state
    let material;
    if (conn.state === 'stable') {
      // Green solid line for stable connections (3+ days)
      material = new THREE.LineBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.6,
        linewidth: conn.isPrimary ? 2 : 1
      });
    } else if (conn.state === 'breaking') {
      // Red-orange for connections about to break (<1 day)
      material = new THREE.LineBasicMaterial({
        color: 0xff4400,
        transparent: true,
        opacity: 0.5,
        linewidth: 1
      });
    } else if (conn.state === 'forming') {
      // Blue dashed for forming connections (<0.5 days)
      material = new THREE.LineDashedMaterial({
        color: 0x0088ff,
        transparent: true,
        opacity: 0.4,
        linewidth: 1,
        dashSize: 20,
        gapSize: 10
      });
    }

    const line = new THREE.Line(geometry, material);

    // For dashed lines, compute line distances
    if (conn.state === 'forming') {
      line.computeLineDistances();
    }

    // Store connection metadata
    line.userData = {
      connectionId: conn.id,
      state: conn.state,
      distance: conn.distance,
      daysToChange: conn.daysToChange,
      isPrimary: conn.isPrimary
    };

    this.connectionsGroup.add(line);
  }

  /**
   * Create or update purple orbital trail for a galaxy
   * Shows the galaxy's past orbital path as a tapered purple "pen stripe"
   */
  createGalaxyTrail(galaxyMesh, galaxyId) {
    // Only works in galactic level
    if (this.currentLevel !== 'galactic') return;

    const asset = this.assets.get(galaxyId);
    if (!asset || !galaxyMesh) {
      console.warn(`⚠️ Cannot create trail: asset or mesh missing for ${galaxyId}`);
      return;
    }

    // Find parent anomaly (galaxies orbit anomalies)
    const anomalies = Array.from(this.assets.values()).filter(a => a.mesh && a.mesh.userData.type === 'anomaly');
    if (anomalies.length === 0) {
      console.warn(`⚠️ Cannot create galaxy trail: No anomalies found (${this.assets.size} assets loaded)`);
      return;
    }

    // Use nearest anomaly as orbit center
    const galaxyPos = galaxyMesh.position;
    let nearestAnomaly = anomalies[0].mesh;
    let minDist = Infinity;

    for (const anomaly of anomalies) {
      const dist = galaxyPos.distanceTo(anomaly.mesh.position);
      if (dist < minDist) {
        minDist = dist;
        nearestAnomaly = anomaly.mesh;
      }
    }

    const orbitCenter = nearestAnomaly.position;
    const orbitRadius = galaxyPos.distanceTo(orbitCenter);

    // Calculate current angle
    const dx = galaxyPos.x - orbitCenter.x;
    const dz = galaxyPos.z - orbitCenter.z;
    const currentAngle = Math.atan2(dz, dx);

    // Create trail points (90-degree arc behind galaxy)
    const trailSegments = 64;
    const trailLength = Math.PI * 0.5; // 90 degrees
    const trailPoints = [];

    for (let i = 0; i < trailSegments; i++) {
      const t = i / (trailSegments - 1); // 0 to 1
      const trailAngle = currentAngle - (t * trailLength); // Go backwards from current angle

      const x = orbitCenter.x + Math.cos(trailAngle) * orbitRadius;
      const y = orbitCenter.y; // Keep at same Y level
      const z = orbitCenter.z + Math.sin(trailAngle) * orbitRadius;

      trailPoints.push(new THREE.Vector3(x, y, z));
    }

    // Create line geometry with tapering opacity
    const trailGeometry = new THREE.BufferGeometry().setFromPoints(trailPoints);

    // Create colors array for gradient (bright purple at galaxy, fade to transparent)
    const colors = [];
    for (let i = 0; i < trailSegments; i++) {
      const t = i / (trailSegments - 1);
      const opacity = 1.0 - t; // Fade from 1.0 to 0.0
      // Purple color (RGB: 138, 79, 255 normalized) with fading opacity
      colors.push(opacity * 0.541, opacity * 0.31, opacity * 1.0);
    }
    trailGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Create line material with vertex colors (purple pen stripe)
    const trailMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      linewidth: 3,
      blending: THREE.AdditiveBlending // Bright purple additive blending
    });

    const trailLine = new THREE.Line(trailGeometry, trailMaterial);
    trailLine.frustumCulled = false;
    this.assetsGroup.add(trailLine);

    // Store orbit data for animation
    const existingOrbit = this.galaxyOrbits.find(o => o.galaxyId === galaxyId);
    if (existingOrbit) {
      // Remove old trail
      if (existingOrbit.trail) {
        this.assetsGroup.remove(existingOrbit.trail);
        existingOrbit.trail.geometry.dispose();
        existingOrbit.trail.material.dispose();
      }
      // Update existing entry
      existingOrbit.trail = trailLine;
      existingOrbit.trailPoints = trailPoints;
      existingOrbit.orbitCenter = orbitCenter;
      existingOrbit.orbitRadius = orbitRadius;
    } else {
      // Add new entry
      this.galaxyOrbits.push({
        galaxyId: galaxyId,
        mesh: galaxyMesh,
        trail: trailLine,
        trailPoints: trailPoints,
        orbitCenter: orbitCenter,
        orbitRadius: orbitRadius
      });
    }
  }

  /**
   * Create or update character pin at galactic coordinates
   * Shows player/character location as a colored marker
   */
  createCharacterPin(character) {
    const characterId = character._id || character.id;

    // Remove existing pin if any
    const existingPin = this.players.get(characterId);
    if (existingPin && existingPin.mesh) {
      this.playersGroup.remove(existingPin.mesh);
      if (existingPin.mesh.geometry) existingPin.mesh.geometry.dispose();
      if (existingPin.mesh.material) existingPin.mesh.material.dispose();
    }

    // Get character location
    const location = character.location || character.galacticPosition;
    if (!location || !location.x) {
      console.warn(`⚠️ Character ${character.name} has no galactic position`);
      return;
    }

    // Check if this is the current player
    const isCurrentPlayer = (typeof window !== 'undefined' && window.currentCharacterId === characterId);

    // DEBUG: Log comparison
    console.log('🔍 Character ID comparison:', {
      characterId: characterId,
      currentCharacterId: window.currentCharacterId,
      isCurrentPlayer: isCurrentPlayer,
      characterName: character.name,
      windowExists: typeof window !== 'undefined'
    });

    // Color scheme based on player type
    const colors = isCurrentPlayer ? {
      core: 0xFFD700,      // Gold for current player
      glow: 0xFF8C00,      // Dark orange glow
      rings: [0xFFD700, 0xFFAA00, 0xFF8C00], // Gold gradient
      label: '#FFD700',    // Gold label
      scale: 1.2           // 20% larger
    } : {
      core: 0x00FF00,      // Green for other players
      glow: 0x00FF00,      // Green glow
      rings: [0x00FF00, 0x00DD00, 0x00BB00], // Green gradient
      label: '#00FFFF',    // Cyan label
      scale: 1.0           // Normal size
    };

    // Create character orb with orbital rings
    const pinGroup = new THREE.Group();

    // Core glowing orb (gold for you, green for others)
    const orbGeometry = new THREE.SphereGeometry(25 * colors.scale, 32, 32);
    const orbMaterial = new THREE.MeshStandardMaterial({
      color: colors.core,
      transparent: true,
      opacity: 0.85,
      emissive: colors.core,
      emissiveIntensity: 0.6,
      metalness: 0.5,
      roughness: 0.3
    });
    const orb = new THREE.Mesh(orbGeometry, orbMaterial);
    orb.frustumCulled = false; // Always render, even off-screen
    pinGroup.add(orb);

    // Outer glow sphere
    const glowGeometry = new THREE.SphereGeometry(35 * colors.scale, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: colors.glow,
      transparent: true,
      opacity: 0.2,
      side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.frustumCulled = false;
    pinGroup.add(glow);

    // Create 3 orbital rings at different angles
    const ringAngles = [0, 60, 120]; // Degrees

    for (let i = 0; i < 3; i++) {
      const ringGeometry = new THREE.TorusGeometry(60 * colors.scale, 2 * colors.scale, 16, 64);
      const ringMaterial = new THREE.MeshStandardMaterial({
        color: colors.rings[i],
        transparent: true,
        opacity: 0.5,
        emissive: colors.rings[i],
        emissiveIntensity: 0.3,
        metalness: 0.5,
        roughness: 0.3
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2; // Make horizontal
      ring.rotation.z = (ringAngles[i] * Math.PI) / 180;
      ring.frustumCulled = false;
      pinGroup.add(ring);
    }

    // Add pulsing animation for current player
    if (isCurrentPlayer) {
      pinGroup.userData.pulse = {
        orb: orb,
        glow: glow,
        time: 0,
        speed: 2.0 // Pulse frequency
      };
      console.log('✨ Added pulsing animation to current player');
    }

    // Label with character name (gold for you, cyan for others)
    const labelCanvas = document.createElement('canvas');
    const context = labelCanvas.getContext('2d');
    labelCanvas.width = 256;
    labelCanvas.height = 64;
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
    context.font = 'Bold 24px Arial';
    context.fillStyle = colors.label;
    context.textAlign = 'center';
    context.fillText(character.name || 'Player', 128, 40);

    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture });
    const label = new THREE.Sprite(labelMaterial);
    label.scale.set(400, 100, 1);
    label.position.set(0, 80, 0); // Above the cone
    label.frustumCulled = false;
    pinGroup.add(label);

    // Position the pin group
    // OPTION B: ALL characters use their actual galactic coordinates (galaxy position)
    // Characters are now nested under galaxies, so location = galaxy position
    pinGroup.position.set(location.x, location.y || 0, location.z || 0);

    if (isCurrentPlayer) {
      console.log(`📍 Created YOUR character pin for "${character.name}" at (${location.x.toFixed(0)}, ${location.y?.toFixed(0) || 0}, ${location.z?.toFixed(0) || 0})`);
    } else {
      console.log(`📍 Created OTHER player pin for "${character.name}" at (${location.x.toFixed(0)}, ${location.y?.toFixed(0) || 0}, ${location.z?.toFixed(0) || 0})`);
    }

    // Add to scene
    this.playersGroup.add(pinGroup);
    pinGroup.visible = true; // Ensure visibility
    this.playersGroup.visible = true; // Ensure parent group is visible

    // Store reference (keep actual location for potential future use)
    this.players.set(characterId, {
      character: character,
      mesh: pinGroup,
      galacticLocation: {x: location.x, y: location.y || 0, z: location.z || 0}, // Store real coords
      lastUpdate: Date.now()
    });

    console.log(`   👁️  Pin visible: ${pinGroup.visible}, playersGroup visible: ${this.playersGroup.visible}, in scene: ${this.playersGroup.parent === this.scene}`);
  }

  /**
   * Initialize socket connection for physics updates
   */
  initializeSocket(socket) {
    if (!socket) {
      console.warn('⚠️ No socket provided to GalacticMap3D');
      return;
    }

    this.socket = socket;

    // Listen for physics updates from server (OPTION B: nested structure)
    socket.on('galacticPhysicsUpdate', (data) => {
      const totalChars = (data.galaxies || []).reduce((sum, g) => sum + (g.dockedCharacters?.length || 0), 0) + (data.inTransit?.length || 0);
      console.log('🔔 galacticPhysicsUpdate EVENT FIRED!', {
        hasData: !!data,
        galaxies: data?.galaxies?.length || 0,
        dockedChars: (data.galaxies || []).reduce((sum, g) => sum + (g.dockedCharacters?.length || 0), 0),
        inTransit: data?.inTransit?.length || 0,
        totalChars: totalChars,
        timestamp: new Date().toISOString()
      });
      this.handleServerPhysicsUpdate(data);
    });

    // Listen for character position updates
    socket.on('characterPositionUpdate', (data) => {
      console.log(`📍 Received character position update:`, data);
      if (data.character) {
        this.createCharacterPin(data.character);
      }
    });

    // NOTE: charactersUpdate event removed - character data now comes only via galacticPhysicsUpdate
    // This eliminates duplicate broadcasts and reduces network traffic

    console.log('✅ GalacticMap3D listening for server physics and character updates');

    // Only fetch characters if assets are already loaded
    // Otherwise, they'll be loaded when showGalacticLevel() is called
    if (this.assetsLoaded) {
      console.log('📍 Assets already loaded, fetching characters now');
      this.fetchCharacters();
    } else {
      console.log('⏳ Waiting for assets to load before fetching characters');
    }
  }

  /**
   * Fetch all character positions from the server
   */
  async fetchCharacters() {
    try {
      console.log('🔍 Fetching character positions...');
      const response = await fetch('/api/v1/characters?map=true');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.characters && Array.isArray(data.characters)) {
        console.log(`👥 Fetched ${data.characters.length} characters with galactic positions`);

        // Create pins for all characters with galactic positions
        data.characters.forEach(char => {
          if (char.location || char.galacticPosition) {
            this.createCharacterPin(char);
          }
        });
      } else {
        console.warn('⚠️ No characters array in response:', data);
      }
    } catch (error) {
      console.error('❌ Failed to fetch characters:', error);
    }
  }

  /**
   * Animation loop
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    try {
      // Physics updates now come from server via socket.io
      // Client only renders what the server tells it

      // Update OrbitControls (if available)
      if (this.controls) {
        this.controls.update();
      }

    // Constrain camera to stay within starfield cube boundaries
    this.constrainCamera();

    // Update zoom level for UI (based on camera zoom)
    this.zoomLevel = this.camera.zoom;

    // Camera following - track selected star
    if (this.followingStar && this.selectedStar && this.selectedStar.position) {
      // Smoothly move camera target to follow the star
      this.controls.target.lerp(this.selectedStar.position, 0.05);
      this.controls.update();
    }

    // Hover detection - show info panel on hover in galaxy view
    this.checkHover();

    // Animate star orbits around galaxy center (galaxy-level view only)
    if (this.currentLevel === 'galaxy') {
      this.assetsGroup.children.forEach(child => {
        if (child.userData.assetType === 'star' && child.userData.orbitData) {
          const orbit = child.userData.orbitData;

          // Update angle based on speed
          orbit.angle += orbit.speed;

          // Calculate new position on circular orbit around galaxy center
          child.position.x = orbit.centerX + Math.cos(orbit.angle) * orbit.radius;
          child.position.z = orbit.centerZ + Math.sin(orbit.angle) * orbit.radius;
          child.position.y = orbit.centerY + orbit.yOffset;

          // Update associated light, glow, and label positions
          if (child.userData.light) {
            child.userData.light.position.copy(child.position);
          }
          if (child.userData.glow) {
            child.userData.glow.position.copy(child.position);
          }
        }

        // Update positions of lights, glows, and labels that follow stars
        if (child.userData.orbitParent) {
          const parent = child.userData.orbitParent;
          child.position.copy(parent.position);
          if (child.isSprite) {
            child.position.y += 30; // Keep label above star
          }
        }
      });
    }

    // Animate planet orbits (galaxy-level view only)
    if (this.currentLevel === 'galaxy' && this.planetOrbits && this.planetOrbits.length > 0) {
      this.planetOrbits.forEach(orbit => {
        // Update angle based on speed
        orbit.angle += orbit.speed;

        // Use parent star's CURRENT position (not cloned position)
        const center = orbit.parentStar.position;

        // Calculate new position on circular orbit around the moving star
        orbit.mesh.position.x = center.x + Math.cos(orbit.angle) * orbit.radius;
        orbit.mesh.position.z = center.z + Math.sin(orbit.angle) * orbit.radius;

        // Apply slight inclination to Y position
        orbit.mesh.position.y = center.y + Math.sin(orbit.angle) * orbit.radius * orbit.inclination;

        // Update orbital trail (pen stripe path)
        if (orbit.trail && orbit.trailPoints) {
          const trailSegments = orbit.trailPoints.length;
          const trailLength = Math.PI * 0.5; // Quarter orbit trail
          const positions = orbit.trail.geometry.attributes.position.array;

          for (let i = 0; i < trailSegments; i++) {
            const t = i / (trailSegments - 1);
            const trailAngle = orbit.angle - (t * trailLength); // Go backwards from current angle

            positions[i * 3] = center.x + Math.cos(trailAngle) * orbit.radius;
            positions[i * 3 + 1] = center.y + Math.sin(trailAngle) * orbit.radius * orbit.inclination;
            positions[i * 3 + 2] = center.z + Math.sin(trailAngle) * orbit.radius;
          }

          orbit.trail.geometry.attributes.position.needsUpdate = true;
        }

        // Real-time lighting update: Rotate planet to show day/night cycle
        // The MeshStandardMaterial automatically receives lighting from the parent star's PointLight
        // As the planet orbits AND rotates, different faces are illuminated by the star
        // This creates a realistic day/night effect visible in real-time
        orbit.mesh.rotation.y += 0.01; // Slow rotation to show different faces to the star
      });
    }

    // Animate star glows in galaxy view (pulsing effect)
    if (this.currentLevel === 'galaxy') {
      const time = Date.now() * 0.001; // Convert to seconds
      this.assetsGroup.children.forEach(child => {
        if (child.userData.assetType === 'star' && child.userData.glow) {
          // Gentle pulsing opacity (0.2 to 0.4)
          const pulseOpacity = 0.3 + Math.sin(time * 2) * 0.1;
          child.userData.glow.material.opacity = pulseOpacity;

          // Slight scale pulsing (0.95x to 1.05x)
          const pulseScale = 1.0 + Math.sin(time * 2) * 0.05;
          child.userData.glow.scale.setScalar(pulseScale);
        }
      });
    }

    // Animate starfield (slow parallax)
    this.starfieldGroup.children.forEach((stars, index) => {
      stars.rotation.z += 0.0001 * (index + 1);
    });

    // Animate zones, anomalies, and galaxies
    this.assets.forEach(asset => {
      // Animate galaxy rotation around center point
      if (asset.mesh && asset.mesh.userData.type === 'galaxy') {
        const rotationSpeed = asset.mesh.userData.rotationSpeed || 0.0002;
        asset.mesh.rotation.y += rotationSpeed; // Slow rotation around Y axis (vertical)
      }

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

    // Animate player character pins (pulsing for current player)
    this.players.forEach(player => {
      // Handle new pulse system for current player
      if (player.mesh && player.mesh.userData.pulse) {
        const pulse = player.mesh.userData.pulse;
        pulse.time += 0.016; // ~60 FPS increment

        // Pulsing scale for current player (gold orb)
        const pulseScale = 1.0 + Math.sin(pulse.time * pulse.speed) * 0.15;
        pulse.orb.scale.set(pulseScale, pulseScale, pulseScale);
        pulse.glow.scale.set(pulseScale, pulseScale, pulseScale);

        // Pulsing emissive intensity
        const pulseIntensity = 0.6 + Math.sin(pulse.time * pulse.speed) * 0.3;
        pulse.orb.material.emissiveIntensity = pulseIntensity;

        // Pulsing glow opacity
        const pulseOpacity = 0.2 + Math.sin(pulse.time * pulse.speed) * 0.1;
        pulse.glow.material.opacity = pulseOpacity;
      }

      // Handle old pulsing system (backwards compatibility)
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

    // Update all connection lines to follow asset positions
    this.connections.forEach((line, connectionId) => {
      const [fromId, toId] = connectionId.split('-');
      const fromAsset = this.assets.get(fromId);
      const toAsset = this.assets.get(toId);

      if (fromAsset && toAsset && line.geometry && line.geometry.attributes.position) {
        const positions = line.geometry.attributes.position.array;
        // Update start point (from asset)
        positions[0] = fromAsset.mesh.position.x;
        positions[1] = fromAsset.mesh.position.y;
        positions[2] = fromAsset.mesh.position.z;
        // Update end point (to asset)
        positions[3] = toAsset.mesh.position.x;
        positions[4] = toAsset.mesh.position.y;
        positions[5] = toAsset.mesh.position.z;
        line.geometry.attributes.position.needsUpdate = true;
      }
    });

    // Animate floating particles
    if (this.floatingParticlesMesh && this.floatingParticles) {
      const positions = this.floatingParticlesMesh.geometry.attributes.position.array;
      for (let i = 0; i < this.floatingParticles.length; i++) {
        const particle = this.floatingParticles[i];
        const idx = i * 3;

        // Update position based on velocity
        positions[idx] += particle.velocity.x;
        positions[idx + 1] += particle.velocity.y;
        positions[idx + 2] += particle.velocity.z;

        // Wrap particles around scene bounds
        if (Math.abs(positions[idx]) > 15000) particle.velocity.x *= -1;
        if (Math.abs(positions[idx + 1]) > 15000) particle.velocity.y *= -1;
        if (Math.abs(positions[idx + 2]) > 15000) particle.velocity.z *= -1;
      }
      this.floatingParticlesMesh.geometry.attributes.position.needsUpdate = true;
    }

    // Spawn and animate comets
    const currentTime = Date.now();
    if (currentTime - this.lastCometSpawn > this.cometSpawnInterval) {
      this.spawnComet();
      this.lastCometSpawn = currentTime;
      this.cometSpawnInterval = 120000 + Math.random() * 60000; // Next in 2-3 minutes
    }

    // Animate existing comets
    if (this.comets) {
      for (let i = this.comets.length - 1; i >= 0; i--) {
        const comet = this.comets[i];
        comet.position.add(comet.velocity);
        comet.trail.geometry.attributes.position.needsUpdate = true;

        // Remove comet if too far
        const dist = comet.position.length();
        if (dist > 50000) {
          this.scene.remove(comet.mesh);
          this.scene.remove(comet.trail);
          this.comets.splice(i, 1);
        }
      }
    }

    // Hide starfield in galaxy/star view, show in galactic view
    if (this.starField) {
      this.starField.visible = (this.currentLevel === 'galactic');
    }
    if (this.starfieldGroup) {
      this.starfieldGroup.visible = (this.currentLevel === 'galactic');
    }

    // Update starfield shader camera position for distance-based clipping
    if (this.starField && this.starField.material.uniforms) {
      this.starField.material.uniforms.uCameraPosition.value.copy(this.camera.position);
    }

    // DEBUG logging removed - too spammy

    this.renderer.render(this.scene, this.camera);
    } catch (error) {
      console.error('❌ Animation loop error:', error);
      // Continue animation even if error occurs
    }
  }

  /**
   * Constrain camera position to stay within starfield cube boundaries
   * Prevents camera from leaving the visible universe
   */
  constrainCamera() {
    // Starfield cube size (matches the cube we created)
    const cubeSize = 400000;
    const maxDistance = cubeSize / 2 - 5000; // 5000 unit buffer from edge

    // Clamp camera position to cube bounds
    this.camera.position.x = Math.max(-maxDistance, Math.min(maxDistance, this.camera.position.x));
    this.camera.position.y = Math.max(-maxDistance, Math.min(maxDistance, this.camera.position.y));
    this.camera.position.z = Math.max(-maxDistance, Math.min(maxDistance, this.camera.position.z));
  }

  /**
   * Spawn a comet that flies through the scene
   */
  spawnComet() {
    // Random starting position on outer edge
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos((Math.random() * 2) - 1);
    const startRadius = 20000;

    const startPos = new THREE.Vector3(
      startRadius * Math.sin(phi) * Math.cos(theta),
      startRadius * Math.sin(phi) * Math.sin(theta),
      startRadius * Math.cos(phi)
    );

    // Velocity toward center with some randomness
    const velocity = startPos.clone().normalize().multiplyScalar(-50);
    velocity.add(new THREE.Vector3(
      (Math.random() - 0.5) * 30,
      (Math.random() - 0.5) * 30,
      (Math.random() - 0.5) * 30
    ));

    // Comet head
    const headGeometry = new THREE.SphereGeometry(15, 8, 8);
    const headMaterial = new THREE.MeshBasicMaterial({
      color: 0xccffff,
      transparent: true,
      opacity: 0.9
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.copy(startPos);

    // Comet trail
    const trailGeometry = new THREE.BufferGeometry();
    const trailPositions = [];
    for (let i = 0; i < 20; i++) {
      trailPositions.push(startPos.x, startPos.y, startPos.z);
    }
    trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(trailPositions, 3));

    const trailMaterial = new THREE.LineBasicMaterial({
      color: 0xaaddff,
      transparent: true,
      opacity: 0.6,
      linewidth: 2
    });
    const trail = new THREE.Line(trailGeometry, trailMaterial);

    this.scene.add(head);
    this.scene.add(trail);

    this.comets.push({
      mesh: head,
      trail: trail,
      position: startPos,
      velocity: velocity
    });

    console.log('☄️ Comet spawned!');
  }

  /**
   * Load all assets from API
   * GALACTIC LEVEL - Only show galaxies and zones
   */
  async loadAssets() {
    try {
      // Show loading indicator
      if (window.showUniverseLoading) {
        window.showUniverseLoading();
      }

      console.log('📡 Fetching universe state from State Manager...');
      console.log('   Current allAssets before fetch:', this.allAssets.length, 'items');
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
        parentType: asset.parentType, // ADDED: Required for planet filtering
        parentGalaxy: asset.parentGalaxy,
        parentStar: asset.parentStar,
        orbitRadius: asset.orbitRadius,
        localCoordinates: asset.localCoordinates,
        universalCoordinates: asset.universalCoordinates
      }));

      console.log(`✅ Stored ${this.allAssets.length} total assets`);

      // GALACTIC MAP: Show only galactic-level assets
      // Uses mapLevel field to control which zoom level assets appear on
      // galactic = galaxies, anomalies, deep space objects
      // galaxy = stars, stations (shown when drilling into galaxy)
      // system = planets, asteroids (shown when drilling into system)
      // orbital = zones, close objects (shown near planets)
      const galacticAssets = this.allAssets.filter(asset =>
        asset.mapLevel === 'galactic' ||
        asset.assetType === 'galaxy' ||  // Fallback for assets without mapLevel
        asset.assetType === 'anomaly'
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

      // Create initial galaxy orbital trails (purple pen stripes)
      console.log(`🔍 Current level: ${this.currentLevel}, Assets loaded: ${this.assets.size}`);
      if (this.currentLevel === 'galactic') {
        console.log(`🎯 Scheduling galaxy trail creation in 500ms...`);
        setTimeout(() => {
          console.log(`⏰ Executing galaxy trail creation now...`);
          let createdCount = 0;
          Array.from(this.assets.values()).forEach(asset => {
            if (asset.mesh && asset.mesh.userData.type === 'galaxy') {
              this.createGalaxyTrail(asset.mesh, asset.mesh.userData.id);
              createdCount++;
            }
          });
          console.log(`💜 Created ${createdCount} galaxy orbital trails (stored: ${this.galaxyOrbits.length})`);
        }, 500); // Small delay to ensure all assets are positioned
      } else {
        console.warn(`⚠️ Not in galactic level! Current: ${this.currentLevel}`);
      }

      // DISABLED: Old static connection code - now using real-time server connections
      // this.createGalacticConnections();
      console.log('🔗 Connection lines will be rendered from real-time server physics data');

      // Populate asset selector in sidebar if function exists
      if (window.populateAssetSelector) {
        setTimeout(() => {
          window.populateAssetSelector();
        }, 100);
      }

      // Hide loading indicator after assets are loaded
      if (window.hideUniverseLoading) {
        setTimeout(() => {
          window.hideUniverseLoading();
        }, 600); // Small delay to show indicator briefly
      }

    } catch (error) {
      console.error('❌ Failed to load assets:', error);
      console.error('Error details:', error.message, error.stack);

      // Hide loading indicator on error too
      if (window.hideUniverseLoading) {
        window.hideUniverseLoading();
      }
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
      // Only update glow position if it's not a child (i.e., not a galaxy)
      if (asset.glow && asset.glow.parent !== asset.mesh) {
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
          // Clone positions to create new Vector3 objects
          const points = [
            fromAsset.mesh.position.clone(),
            toAsset.mesh.position.clone()
          ];
          line.geometry.setFromPoints(points);
          line.geometry.attributes.position.needsUpdate = true;
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
   * Stars are only shown when drilling into a specific galaxy interior
   */
  showGalacticLevel() {
    console.log('🌌 Showing GALACTIC level - galaxies, zones, and anomalies only');

    // Store the previous galaxy center before switching levels (for zoom-out animation)
    const previousGalaxyCenter = this.controls ? this.controls.target.clone() : new THREE.Vector3(0, 0, 0);
    const wasInGalaxyView = this.currentLevel === 'galaxy';

    this.currentLevel = 'galactic';
    this.selectedGalaxyId = null;
    this.selectedStarId = null;

    // Update breadcrumb navigation
    if (window.updateBreadcrumb) {
      window.updateBreadcrumb('galactic');
    }

    // Clear current scene
    this.clearAssets();

    // Show only top-level galactic objects (NO stars - stars only shown in galaxy interior)
    const galacticTypes = ['galaxy', 'zone', 'anomaly', 'nebula'];
    const galacticAssets = this.allAssets.filter(asset =>
      galacticTypes.includes(asset.assetType)
    );

    console.log(`   Found ${galacticAssets.length} galactic-level assets (galaxies and anomalies only)`);
    galacticAssets.forEach(asset => this.addAsset(asset));

    // Mark assets as loaded so characters can be rendered
    this.assetsLoaded = true;
    console.log('✅ Galactic assets loaded, characters can now be rendered');

    // Fetch characters if socket is already initialized
    if (this.socket) {
      console.log('📍 Socket already connected, fetching characters now');
      this.fetchCharacters();
    }

    // Create galaxy orbital trails after assets are loaded
    setTimeout(() => {
      Array.from(this.assets.values()).forEach(asset => {
        if (asset.mesh && asset.mesh.userData.type === 'galaxy') {
          this.createGalaxyTrail(asset.mesh, asset.mesh.userData.id);
        }
      });
      console.log(`💜 Recreated ${this.galaxyOrbits.length} galaxy orbital trails`);
    }, 500);

    // Restore saved camera position if available, otherwise use default
    if (this.savedGalacticCameraPosition && this.savedGalacticControlsTarget) {
      console.log('🎬 Restoring saved galactic camera state...');
      console.log(`   Restoring position: (${this.savedGalacticCameraPosition.x.toFixed(1)}, ${this.savedGalacticCameraPosition.y.toFixed(1)}, ${this.savedGalacticCameraPosition.z.toFixed(1)})`);
      console.log(`   Restoring zoom: ${this.savedGalacticCameraZoom.toFixed(2)}`);
      console.log(`   Restoring target: (${this.savedGalacticControlsTarget.x.toFixed(1)}, ${this.savedGalacticControlsTarget.y.toFixed(1)}, ${this.savedGalacticControlsTarget.z.toFixed(1)})`);

      // If returning from galaxy view, do a cinematic zoom-out animation
      if (wasInGalaxyView) {
        // Use saved galaxy position in galactic space (where it actually is in the universe)
        const galaxyPosInGalacticSpace = this.savedGalaxyPositionInGalacticSpace || previousGalaxyCenter;
        this.animateZoomOutFromGalaxy(
          galaxyPosInGalacticSpace,
          this.savedGalacticCameraPosition,
          this.savedGalacticCameraZoom,
          this.savedGalacticControlsTarget
        );
      } else {
        // Normal transition - just animate camera to saved position
        this.animateCameraToState(
          this.savedGalacticCameraPosition,
          this.savedGalacticCameraZoom,
          this.savedGalacticControlsTarget,
          1500 // 1.5 second animation
        );
      }
    } else {
      console.log('📍 No saved camera state, using default universe center view');
      // Default camera position (first time viewing galactic level)
      this.camera.position.set(
        this.universeCenter.x,
        this.universeCenter.y + 3000,
        this.universeCenter.z + 2000
      );
      this.camera.zoom = 1.0;
      this.camera.updateProjectionMatrix();
      if (this.controls) {
        this.controls.target.copy(this.universeCenter);
        this.controls.update();
      }
    }

    // Back button removed - using breadcrumb navigation instead
  }

  /**
   * Show universe-level view (all galaxies, stars, zones, anomalies)
   */
  showUniverseLevel() {
    // FUTURE FEATURE: Universe level (above galactic)
    // For now, redirect to galactic level
    console.log(`🌍 showUniverseLevel called - redirecting to GALACTIC level (universe not yet implemented)`);
    this.showGalacticLevel();
    return;

    // TODO: Implement universe level showing multiple galactic clusters
    /*
    console.log(`🌍 Showing UNIVERSE level - all galactic clusters`);

    this.currentLevel = 'universe';
    this.selectedGalaxyId = null;
    this.selectedStarId = null;

    // Clear current scene
    this.clearAssets();

    // Reload all universe-level assets (galactic clusters, dark matter, etc)
    const universeTypes = ['galacticCluster', 'darkMatter', 'cosmicWeb'];
    const universeAssets = this.allAssets.filter(asset =>
      universeTypes.includes(asset.assetType)
    );

    console.log(`   Loading ${universeAssets.length} universe-level assets`);
    universeAssets.forEach(asset => this.addAsset(asset));

    // Reset camera to universe center
    this.camera.position.set(
      this.universeCenter.x,
      this.universeCenter.y + 6000,
      this.universeCenter.z + 4000
    );
    if (this.controls) {
      this.controls.target.copy(this.universeCenter);
      this.controls.update();
    }
    */
  }

  /**
   * Show stars within a selected galaxy
   * First zooms into the galaxy in galactic view, then switches to interior
   */
  showGalaxyLevel(galaxyId) {
    console.log(`⭐ Showing GALAXY level - stars in galaxy ${galaxyId}`);
    console.log(`   GalaxyId type: ${typeof galaxyId}, value:`, galaxyId);

    // Normalize galaxyId to string for comparison
    const galaxyIdStr = galaxyId?.toString() || galaxyId;
    console.log(`   Normalized galaxyId: "${galaxyIdStr}" (type: ${typeof galaxyIdStr})`);

    // Get the galaxy object FIRST so we can save its position
    const galaxy = this.allAssets.find(a => {
      const assetId = a._id?.toString() || a._id;
      return assetId === galaxyIdStr;
    });

    if (!galaxy) {
      console.warn(`   ⚠️ Galaxy not found in allAssets!`);
      return;
    }

    // Save current galactic-level camera state before transitioning
    if (this.currentLevel === 'galactic') {
      console.log(`💾 Saving ${this.currentLevel} camera state before transition...`);
      this.savedGalacticCameraPosition = this.camera.position.clone();
      this.savedGalacticCameraZoom = this.camera.zoom;
      if (this.controls) {
        this.savedGalacticControlsTarget = this.controls.target.clone();
      }

      // Save the galaxy's position in galactic space for zoom vector calculation
      if (galaxy.coordinates) {
        this.savedGalaxyPositionInGalacticSpace = new THREE.Vector3(
          galaxy.coordinates.x,
          galaxy.coordinates.y,
          galaxy.coordinates.z || 0
        );
        console.log(`   Saved galaxy position: (${this.savedGalaxyPositionInGalacticSpace.x.toFixed(1)}, ${this.savedGalaxyPositionInGalacticSpace.y.toFixed(1)}, ${this.savedGalaxyPositionInGalacticSpace.z.toFixed(1)})`);
      }

      console.log(`   Saved position: (${this.savedGalacticCameraPosition.x.toFixed(1)}, ${this.savedGalacticCameraPosition.y.toFixed(1)}, ${this.savedGalacticCameraPosition.z.toFixed(1)})`);
      console.log(`   Saved zoom: ${this.savedGalacticCameraZoom.toFixed(2)}`);
      console.log(`   Saved target: (${this.savedGalacticControlsTarget?.x.toFixed(1)}, ${this.savedGalacticControlsTarget?.y.toFixed(1)}, ${this.savedGalacticControlsTarget?.z.toFixed(1)})`);

      // FIRST: Zoom hard into the galaxy center in galactic view
      this.zoomIntoGalaxyInGalacticView(galaxy, galaxyId);
    } else {
      // Already in a different level, just load galaxy interior directly
      this.loadGalaxyInterior(galaxyId);
    }
  }

  /**
   * Zoom into galaxy center in galactic view before switching to interior
   */
  zoomIntoGalaxyInGalacticView(galaxy, galaxyId) {
    console.log(`🎬 Zooming into galaxy in galactic view...`);

    const galaxyPosition = new THREE.Vector3(
      galaxy.coordinates.x,
      galaxy.coordinates.y,
      galaxy.coordinates.z || 0
    );

    // Calculate zoom vector from current camera to galaxy
    const startPosition = this.camera.position.clone();
    const startZoom = this.camera.zoom;
    const startTarget = this.controls.target.clone();

    // Target: very close to galaxy center, high zoom
    const zoomVector = new THREE.Vector3()
      .subVectors(galaxyPosition, startPosition)
      .normalize();

    const targetDistance = 100; // Very close to galaxy
    const targetPosition = galaxyPosition.clone().add(
      zoomVector.clone().multiplyScalar(-targetDistance)
    );
    const targetZoom = 3.0; // Zoomed in tight

    const animationDuration = 750; // 750ms
    const animationStart = Date.now();

    // Disable controls during animation
    const wasEnabled = this.controls.enabled;
    this.controls.enabled = false;

    const animateZoomIn = () => {
      const elapsed = Date.now() - animationStart;
      const progress = Math.min(elapsed / animationDuration, 1);

      // Ease-in with snappy finish
      const eased = progress * progress * progress * progress;

      // Animate camera toward galaxy
      this.camera.position.lerpVectors(startPosition, targetPosition, eased);

      // Animate zoom
      this.camera.zoom = startZoom + (targetZoom - startZoom) * eased;
      this.camera.updateProjectionMatrix();

      // Animate target to galaxy center
      this.controls.target.lerpVectors(startTarget, galaxyPosition, eased);
      this.controls.update();

      // Render frame
      this.renderer.render(this.scene, this.camera);

      if (progress < 1) {
        requestAnimationFrame(animateZoomIn);
      } else {
        // Zoom complete - now load galaxy interior
        console.log(`✅ Zoom into galaxy complete - loading interior...`);
        this.controls.enabled = wasEnabled;
        this.loadGalaxyInterior(galaxyId);
      }
    };

    animateZoomIn();
  }

  /**
   * Load the galaxy interior view (stars, anomalies, etc.)
   * Called after zoom-in animation completes
   */
  loadGalaxyInterior(galaxyId) {
    const galaxyIdStr = galaxyId?.toString() || galaxyId;

    this.currentLevel = 'galaxy';
    this.selectedGalaxyId = galaxyId;
    this.selectedStarId = null;

    // Update breadcrumb navigation
    if (window.updateBreadcrumb) {
      window.updateBreadcrumb('galaxy');
    }

    // Clear current scene
    this.clearAssets();

    // Get galaxy again
    const galaxy = this.allAssets.find(a => {
      const assetId = a._id?.toString() || a._id;
      return assetId === galaxyIdStr;
    });

    if (!galaxy) {
      console.error(`❌ Galaxy ${galaxyIdStr} not found`);
      return;
    }

    // Count resources before loading
    const stars = this.allAssets.filter(asset => {
      if (asset.assetType !== 'star') return false;
      const parentId = asset.parentGalaxy?.toString() || asset.parentGalaxy;
      return parentId === galaxyIdStr;
    });

    const planets = this.allAssets.filter(asset =>
      asset.assetType === 'planet' &&
      asset.parentType === 'star' &&
      asset.parentGalaxy?.toString() === galaxyIdStr
    );

    // Debug: Check what's in allAssets
    console.log('🔍 DEBUG allAssets:', {
      totalAssets: this.allAssets.length,
      assetTypes: this.allAssets.reduce((acc, a) => {
        acc[a.assetType] = (acc[a.assetType] || 0) + 1;
        return acc;
      }, {})
    });

    const allPlanets = this.allAssets.filter(a => a.assetType === 'planet');
    if (allPlanets.length > 0) {
      const samplePlanet = allPlanets[0];
      console.log('🪐 Sample planet object:', samplePlanet);
      console.log('🪐 Sample planet filter check:', {
        title: samplePlanet.title,
        assetType: samplePlanet.assetType,
        parentType: samplePlanet.parentType,
        parentGalaxy: samplePlanet.parentGalaxy,
        parentGalaxyToString: samplePlanet.parentGalaxy?.toString(),
        galaxyIdStr: galaxyIdStr,
        match: samplePlanet.parentGalaxy?.toString() === galaxyIdStr
      });
    } else {
      console.log('🪐 No planets found in allAssets - showing first 3 assets:', this.allAssets.slice(0, 3));
    }

    console.log(`\n🌌 Loading Galaxy: "${galaxy.title}" (ID: ${galaxyIdStr})`);
    console.log(`   └─ ${stars.length} stars`);
    console.log(`   └─ ${planets.length} planets (total planets in allAssets: ${allPlanets.length})`);

    if (stars.length === 0) {
      console.warn(`⚠️ No stars found for this galaxy!`);
      return;
    }

    this.addAsset(galaxy);

    // Add all stars to scene
    stars.forEach(star => this.addAsset(star));

    // Load zones and anomalies within this galaxy
    const galacticObjects = this.allAssets.filter(asset =>
      (asset.assetType === 'zone' || asset.assetType === 'anomaly') &&
      asset.parentGalaxy === galaxyId
    );
    if (galacticObjects.length > 0) {
      console.log(`🔮 Found ${galacticObjects.length} zones/anomalies`);
    }
    galacticObjects.forEach(obj => this.addAsset(obj));

    // Wait a frame to ensure all stars are added to the scene before focusing camera
    requestAnimationFrame(() => {
      // Calculate the actual center of the stars by examining their positions
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      // Use this.stars map to iterate through star meshes
      this.stars.forEach((mesh) => {
        minX = Math.min(minX, mesh.position.x);
        maxX = Math.max(maxX, mesh.position.x);
        minY = Math.min(minY, mesh.position.y);
        maxY = Math.max(maxY, mesh.position.y);
        minZ = Math.min(minZ, mesh.position.z);
        maxZ = Math.max(maxZ, mesh.position.z);
      });

      // Calculate center of star positions
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const centerZ = (minZ + maxZ) / 2;

      // Clear the assets group for rebuild
      while(this.assetsGroup.children.length > 0) {
        this.assetsGroup.remove(this.assetsGroup.children[0]);
      }

      // Re-add the parent galaxy as a semi-transparent glowing orb at center
      if (galaxy) {
        const galaxyGeo = new THREE.SphereGeometry(100, 16, 16);
        const galaxyMat = new THREE.MeshBasicMaterial({
          color: 0x8A4FFF,
          transparent: true,
          opacity: 0.4, // Slightly more visible
          depthTest: true,
          depthWrite: true
        });
        const galaxyMesh = new THREE.Mesh(galaxyGeo, galaxyMat);
        galaxyMesh.position.set(centerX, centerY, centerZ);
        galaxyMesh.userData.id = galaxyId;
        galaxyMesh.userData.type = 'galaxy';
        galaxyMesh.userData.assetType = 'galaxy';
        galaxyMesh.userData.assetId = galaxyId;
        galaxyMesh.userData.title = galaxy.title;
        galaxyMesh.userData.data = galaxy;
        this.assetsGroup.add(galaxyMesh);

        // Add gentle glow halo around galaxy center
        const glowGeo = new THREE.SphereGeometry(150, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
          color: 0x8A4FFF,
          transparent: true,
          opacity: 0.2,
          depthTest: true,
          depthWrite: false,
          side: THREE.BackSide // Render from inside for glow effect
        });
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        glowMesh.position.set(centerX, centerY, centerZ);
        this.assetsGroup.add(glowMesh);

        // Note: No point light at galaxy center - planets only lit by their parent stars
      }

      // Add anomalies in this galaxy
      const anomaliesInGalaxy = this.allAssets.filter(asset =>
        asset.assetType === 'anomaly' &&
        asset.parentGalaxy?.toString() === galaxyIdStr
      );
      anomaliesInGalaxy.forEach(anomaly => {
        const anomalyGeo = new THREE.SphereGeometry(60, 16, 16);
        const anomalyMat = new THREE.MeshBasicMaterial({
          color: 0xFF4444,
          depthTest: true,
          depthWrite: true
        });
        const anomalyMesh = new THREE.Mesh(anomalyGeo, anomalyMat);
        const anomalyPos = anomaly.localCoordinates || anomaly.coordinates || { x: 0, y: 0, z: 0 };
        anomalyMesh.position.set(anomalyPos.x, anomalyPos.y, anomalyPos.z);
        anomalyMesh.userData.id = anomaly._id;
        anomalyMesh.userData.type = 'anomaly';
        anomalyMesh.userData.assetType = 'anomaly';
        anomalyMesh.userData.assetId = anomaly._id;
        anomalyMesh.userData.title = anomaly.title;
        anomalyMesh.userData.data = anomaly;
        anomalyMesh.frustumCulled = false;
        this.assetsGroup.add(anomalyMesh);
      });

      // Create stars as simple yellow spheres with labels
      let starsAdded = 0;
      this.stars.forEach((mesh, starId) => {
        // Get star data for title
        const starData = mesh.userData.data || {};
        const starTitle = starData.title || starData.name || `Star ${starsAdded + 1}`;

        // Create simple sphere - radius 6-20 units for better visibility
        // Variable size based on star index for visual variety
        const starSize = 6 + (Math.random() * 14); // Random between 6-20 units
        const starGeo = new THREE.SphereGeometry(starSize, 12, 12); // Medium poly for visible stars

        // Use emissive material so star emits light
        const starMat = new THREE.MeshStandardMaterial({
          color: 0xFFFF00,
          emissive: 0xFFFF00,
          emissiveIntensity: 1.5,
          depthTest: true,
          depthWrite: true,
          roughness: 0.3,
          metalness: 0.1
        });

        const starSphere = new THREE.Mesh(starGeo, starMat);
        starSphere.position.copy(mesh.position);
        starSphere.userData.id = starId; // Required for raycasting
        starSphere.userData.type = 'star'; // Match standard format
        starSphere.userData.assetType = 'star';
        starSphere.userData.assetId = starId;
        starSphere.userData.title = starTitle;
        starSphere.userData.data = starData; // Store full star data
        starSphere.frustumCulled = false;
        starSphere.visible = true;

        // Add point light at star position for realistic illumination
        // Increased intensity (2→5) and distance (100→500) for stronger lighting
        const starLight = new THREE.PointLight(0xFFFF88, 5, 500, 2); // Warm yellow light
        starLight.position.copy(mesh.position);
        starLight.castShadow = false; // Disable shadows for performance
        this.assetsGroup.add(starLight);

        // Store light reference for cleanup
        starSphere.userData.light = starLight;

        // Add to assetsGroup so it persists
        this.assetsGroup.add(starSphere);

        // Create text label above star (scaled for 6-20 unit stars)
        const labelCanvas = document.createElement('canvas');
        const context = labelCanvas.getContext('2d');
        labelCanvas.width = 512;
        labelCanvas.height = 128;

        context.fillStyle = 'rgba(0, 0, 0, 0.7)';
        context.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
        context.font = 'Bold 32px Arial';
        context.fillStyle = '#FFFF00';
        context.textAlign = 'center';
        context.fillText(starTitle, 256, 80);

        const labelTexture = new THREE.CanvasTexture(labelCanvas);
        const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture });
        const label = new THREE.Sprite(labelMaterial);
        label.scale.set(200, 50, 1); // Scaled labels for 6-20 unit stars
        label.position.copy(starSphere.position);
        label.position.y += 30; // Positioned above star
        label.frustumCulled = false;
        label.raycast = () => {}; // Disable raycasting on label so clicks pass through

        // Add label to assetsGroup
        this.assetsGroup.add(label);

        // Add subtle glow halo around star for better visibility
        const glowGeo = new THREE.SphereGeometry(starSize * 1.5, 12, 12);
        const glowMat = new THREE.MeshBasicMaterial({
          color: 0xFFFF88,
          transparent: true,
          opacity: 0.3,
          depthTest: true,
          depthWrite: false,
          side: THREE.BackSide // Render from inside for glow effect
        });
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        glowMesh.position.copy(starSphere.position);
        this.assetsGroup.add(glowMesh);

        // Store glow reference for potential animation
        starSphere.userData.glow = glowMesh;

        // Store star orbit data for animation around galaxy center
        const starOrbitRadius = Math.sqrt(
          Math.pow(starSphere.position.x - centerX, 2) +
          Math.pow(starSphere.position.z - centerZ, 2)
        );
        const startAngle = Math.atan2(
          starSphere.position.z - centerZ,
          starSphere.position.x - centerX
        );

        starSphere.userData.orbitData = {
          centerX: centerX,
          centerY: centerY,
          centerZ: centerZ,
          radius: starOrbitRadius,
          angle: startAngle,
          speed: 0.00005 + (Math.random() * 0.00005), // Very slow orbit
          yOffset: starSphere.position.y - centerY
        };

        // Also store orbit data for the light and glow
        if (starLight) starLight.userData.orbitParent = starSphere;
        if (glowMesh) glowMesh.userData.orbitParent = starSphere;
        if (label) label.userData.orbitParent = starSphere;

        starsAdded++;
      });

      console.log(`⭐ Rendered ${starsAdded} stars with lighting & glows (orbiting galaxy center)`);

      // Add planets orbiting their parent stars (galaxy-level view)
      const planetsInGalaxy = this.allAssets.filter(asset =>
        asset.assetType === 'planet' &&
        asset.parentType === 'star' &&
        asset.parentGalaxy?.toString() === galaxyIdStr
      );

      // Store planet orbital data for animation
      this.planetOrbits = this.planetOrbits || [];
      this.planetOrbits.length = 0; // Clear previous orbits

      planetsInGalaxy.forEach(planet => {
        // Find parent star position
        const parentStarId = planet.parentId?.toString();
        const parentStar = this.assetsGroup.children.find(child =>
          child.userData.assetId?.toString() === parentStarId && child.userData.assetType === 'star'
        );

        if (parentStar) {
          // Create planet sphere (6-80 unit radius for high visibility)
          const planetSize = 6 + (Math.random() * 74); // Random between 6-80 units
          const planetGeo = new THREE.SphereGeometry(planetSize, 16, 16); // Higher poly for larger planets
          const planetColor = planet.renderData?.color || '#888888';

          // Use MeshStandardMaterial so planets receive light from stars
          // Brighter reflection: reduced roughness and increased metalness
          const planetMat = new THREE.MeshStandardMaterial({
            color: planetColor,
            depthTest: true,
            depthWrite: true,
            roughness: 0.3, // Smoother surfaces reflect more light (was 0.8)
            metalness: 0.5, // More metallic for better reflectivity (was 0.2)
            emissive: 0x000000, // No self-emission (planets don't emit light)
            emissiveIntensity: 0
          });

          const planetMesh = new THREE.Mesh(planetGeo, planetMat);

          // Position planet at its orbital distance from parent star
          // Very wide orbit radius for maximum separation and visibility
          const orbitRadius = (planet.orbitRadius || 100) * 4.0; // Increased to 4.0 for extremely wide orbits
          const angle = Math.random() * Math.PI * 2; // Random starting angle
          planetMesh.position.set(
            parentStar.position.x + Math.cos(angle) * orbitRadius,
            parentStar.position.y,
            parentStar.position.z + Math.sin(angle) * orbitRadius
          );

          planetMesh.userData.id = planet._id;
          planetMesh.userData.type = 'planet';
          planetMesh.userData.assetType = 'planet';
          planetMesh.userData.assetId = planet._id;
          planetMesh.userData.title = planet.title;
          planetMesh.userData.data = planet;
          planetMesh.frustumCulled = false;

          this.assetsGroup.add(planetMesh);

          // Create tapered orbital trail ring (pen stripe showing past path)
          // Trail fades from planet position back toward star
          const trailSegments = 64; // Number of segments in the trail
          const trailLength = Math.PI * 0.5; // Trail covers 90 degrees (quarter orbit)
          const trailPoints = [];

          for (let i = 0; i < trailSegments; i++) {
            const t = i / (trailSegments - 1); // 0 to 1
            const trailAngle = angle - (t * trailLength); // Go backwards from current angle

            const x = parentStar.position.x + Math.cos(trailAngle) * orbitRadius;
            const y = parentStar.position.y;
            const z = parentStar.position.z + Math.sin(trailAngle) * orbitRadius;

            trailPoints.push(new THREE.Vector3(x, y, z));
          }

          // Create line geometry with tapering opacity
          const trailGeometry = new THREE.BufferGeometry().setFromPoints(trailPoints);

          // Create colors array for gradient (bright white at planet, fade to transparent toward star)
          const colors = [];
          for (let i = 0; i < trailSegments; i++) {
            const t = i / (trailSegments - 1);
            const opacity = 1.0 - t; // Fade from 1.0 to 0.0
            // White color with fading opacity
            colors.push(opacity, opacity, opacity);
          }
          trailGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

          // Create line material with vertex colors (white pen stripe)
          const trailMaterial = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            linewidth: 3,
            blending: THREE.AdditiveBlending // Bright white additive blending
          });

          const trailLine = new THREE.Line(trailGeometry, trailMaterial);
          trailLine.frustumCulled = false;
          this.assetsGroup.add(trailLine);

          // Store orbit data for animation (including trail reference)
          this.planetOrbits.push({
            mesh: planetMesh,
            trail: trailLine,
            trailPoints: trailPoints,
            parentStar: parentStar, // Store reference to parent star (not clone!)
            radius: orbitRadius,
            speed: 0.001 + (Math.random() * 0.002), // Much faster: 10x faster than before
            angle: angle,
            inclination: planet.inclination || 0
          });
        }
      });

      console.log(`🌍 Loaded ${this.planetOrbits.length} orbiting planets (size: 6-80 units, speed: 10x slower)`);

      // Calculate final camera position to view all stars
      const spread = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
      const finalCameraDistance = spread * 1.5;

      // Store final star positions and set them all to center initially
      const starAnimationData = [];
      this.assetsGroup.children.forEach(child => {
        if (child.userData.assetType === 'star') {
          const finalPosition = child.position.clone();
          starAnimationData.push({
            mesh: child,
            finalPosition: finalPosition,
            startPosition: new THREE.Vector3(centerX, centerY, centerZ)
          });
          // Start at center
          child.position.copy(new THREE.Vector3(centerX, centerY, centerZ));
        }
        // Also animate labels
        if (child.isSprite) {
          const finalPosition = child.position.clone();
          starAnimationData.push({
            mesh: child,
            finalPosition: finalPosition,
            startPosition: new THREE.Vector3(centerX, centerY, centerZ + 800) // Offset for labels
          });
          // Start at center
          child.position.copy(new THREE.Vector3(centerX, centerY, centerZ + 800));
        }
      });

      // Set initial camera position (far from galaxy center)
      const startCameraDistance = finalCameraDistance * 3; // Start 3x farther
      const fixedCameraPosition = new THREE.Vector3(centerX, centerY, centerZ + startCameraDistance);
      const finalCameraPosition = new THREE.Vector3(centerX, centerY, centerZ + finalCameraDistance);

      this.camera.position.copy(fixedCameraPosition);
      this.camera.lookAt(centerX, centerY, centerZ);
      this.camera.zoom = 0.3; // Start zoomed out
      this.camera.updateProjectionMatrix();

      // Lock controls target to center and disable controls completely
      if (this.controls) {
        this.controls.target.set(centerX, centerY, centerZ);
        this.controls.enabled = false; // Disable during animation
        this.controls.update();
      }

      console.log(`🎬 Starting zoom-in animation with star expansion`);
      console.log(`📷 Camera will move from ${startCameraDistance.toFixed(0)} to ${finalCameraDistance.toFixed(0)} units`);
      console.log(`⭐ ${starAnimationData.length} objects will expand from center to final positions`);

      // Animate zoom-in and star expansion
      const animationDuration = 750; // 750ms for snappy feel
      const animationStart = Date.now();

      const animateZoomAndExpansion = () => {
        const elapsed = Date.now() - animationStart;
        const progress = Math.min(elapsed / animationDuration, 1);

        // Ease-in with snappy finish - starts slow, accelerates, then quick stop
        // Using quartic ease-in for smooth acceleration
        const eased = progress * progress * progress * progress;

        // Animate camera zoom (move closer) along fixed Z-axis only
        this.camera.position.lerpVectors(fixedCameraPosition, finalCameraPosition, eased);

        // Keep camera locked on center (no orbit)
        this.camera.lookAt(centerX, centerY, centerZ);

        // Animate camera zoom level
        this.camera.zoom = 0.3 + (1.0 - 0.3) * eased;
        this.camera.updateProjectionMatrix();

        // Animate stars expanding from center to final positions
        starAnimationData.forEach(({ mesh, startPosition, finalPosition }) => {
          mesh.position.lerpVectors(startPosition, finalPosition, eased);
        });

        // Don't update controls during animation to prevent any orbit drift
        // this.controls.update(); // REMOVED - prevents orbit

        // Render frame
        this.renderer.render(this.scene, this.camera);

        if (progress < 1) {
          requestAnimationFrame(animateZoomAndExpansion);
        } else {
          // Animation complete - show summary
          console.log(`✅ Galaxy view loaded successfully`);

          // Ensure final state is locked in before re-enabling controls
          this.camera.position.copy(finalCameraPosition);
          this.camera.lookAt(centerX, centerY, centerZ);
          this.camera.zoom = 1.0;
          this.camera.updateProjectionMatrix();

          // Re-enable controls and sync them to final camera state
          if (this.controls) {
            // Ensure target is locked to center
            this.controls.target.set(centerX, centerY, centerZ);
            this.controls.enabled = true;
            this.controls.update();
          }

          // Final render to ensure everything is in place
          this.renderer.render(this.scene, this.camera);
        }
      };

      // Start animation
      animateZoomAndExpansion()
    });

    // Back button removed - using breadcrumb navigation instead
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
    const starIdStr = starId?.toString();
    const orbitalBodies = this.allAssets.filter(asset =>
      (asset.assetType === 'planet' ||
       asset.assetType === 'orbital' ||
       asset.assetType === 'station') &&
      (asset.parentStar?.toString() === starIdStr || asset.parentId?.toString() === starIdStr)
    );

    console.log(`   Found ${orbitalBodies.length} orbital bodies in system`);
    orbitalBodies.forEach(body => {
      console.log(`   🌍 Loading planet: ${body.title}`);
      this.addAsset(body);
    });

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

    // Clear galaxy orbital trails
    if (this.galaxyOrbits) {
      this.galaxyOrbits.forEach(orbit => {
        if (orbit.trail) {
          this.assetsGroup.remove(orbit.trail);
          orbit.trail.geometry.dispose();
          orbit.trail.material.dispose();
        }
      });
      this.galaxyOrbits = [];
    }

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

    console.log(`👤 Adding player character via createCharacterPin:`, character.name);

    // Use the enhanced createCharacterPin method which handles current player detection
    this.createCharacterPin(character);

    // If this is the current player, focus camera on them
    if (window.currentCharacterId === character._id) {
      console.log('🎥 Focusing camera on current player');
      this.focusOnCurrentPlayer();
    }
  }

  /**
   * Focus camera on the current player's character
   */
  focusOnCurrentPlayer() {
    if (!window.currentCharacterId) {
      console.warn('⚠️ No current player ID set');
      return;
    }

    const playerData = this.players.get(window.currentCharacterId);
    if (!playerData || !playerData.mesh) {
      console.warn('⚠️ Current player not found in scene');
      return;
    }

    const playerPosition = playerData.mesh.position;
    console.log('📍 Player position:', playerPosition);

    // Animate camera to focus on player
    const distance = 800; // Distance from player
    const targetCameraPos = new THREE.Vector3(
      playerPosition.x,
      playerPosition.y + distance * 0.5,
      playerPosition.z + distance
    );

    // Smooth camera transition
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = 1500; // 1.5 seconds
    const startTime = Date.now();

    const animateCamera = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-in-out function
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      // Interpolate camera position
      this.camera.position.lerpVectors(startPos, targetCameraPos, eased);

      // Interpolate camera target (look at player)
      this.controls.target.lerpVectors(startTarget, playerPosition, eased);
      this.controls.update();

      if (progress < 1) {
        requestAnimationFrame(animateCamera);
      } else {
        console.log('✅ Camera focused on player');
      }
    };

    animateCamera();
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
      // Update existing player position
      // Players created by createCharacterPin have: {mesh, character, galacticLocation}
      if (player.mesh) {
        // Modern structure from createCharacterPin
        player.mesh.position.copy(position);
        player.galacticLocation = {x: location.x, y: location.y || 0, z: location.z || 0};
        console.log(`🔄 Updated player "${characterName || player.character?.name}" position to (${location.x.toFixed(0)}, ${location.y?.toFixed(0) || 0}, ${location.z?.toFixed(0) || 0})`);
      } else if (player.marker) {
        // Old structure (fallback for compatibility)
        player.marker.position.copy(position);
        if (player.glow) player.glow.position.copy(position);
        if (player.label) {
          player.label.position.copy(position);
          player.label.position.y += 70;
        }
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
   * Show back button to return to previous view level
   */
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

// Make class globally accessible for EJS initialization
window.GalacticMap3D = GalacticMap3D;
