/**
 * Space Combat System
 * Complete ship physics, weapons, shields, and combat mechanics
 */

class SpaceCombatSystem {
  constructor(scene, camera, galacticMap) {
    this.scene = scene;
    this.camera = camera;
    this.galacticMap = galacticMap;

    // Player ship state
    this.playerShip = {
      position: new THREE.Vector3(85000, 0, 85000), // Start at OUTER EDGE beyond furthest planet at 75k
      velocity: new THREE.Vector3(0, 0, 0),
      acceleration: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Euler(0, 0, 0),
      angularVelocity: 0,
      yaw: 0, // Ship's yaw rotation (Y axis)
      pitch: 0, // Ship's pitch rotation (X axis)
      roll: 0, // Ship's roll rotation (Z axis)

      // Combat stats
      hull: 100,
      hullMax: 100,
      shields: 100,
      shieldsMax: 100,
      shieldRechargeRate: 2, // per second
      energy: 100,
      energyMax: 100,
      energyRechargeRate: 5, // per second

      // Weapons
      primaryWeapon: {
        damage: 10,
        cooldown: 0.2, // seconds
        energyCost: 5,
        lastFired: 0,
        projectileSpeed: 500
      },

      // Physics - 6 directional thrusters + 2 boosters
      singleThruster: 100, // Single thruster power - enough to stabilize/orbit
      boosterPower: 300, // Booster jets - powerful acceleration
      maxSpeed: 5000, // High max speed
      drag: 0.9995, // Extremely low drag - realistic space physics (0.05% loss per frame)
      turnSpeed: 2.0, // radians per second
      mass: 1000 // Ship mass for gravitational calculations
    };

    // G-force tracking for display
    this.gForces = {
      gravity: new THREE.Vector3(0, 0, 0),
      thrust: new THREE.Vector3(0, 0, 0),
      total: new THREE.Vector3(0, 0, 0),
      magnitude: 0,
      objects: [] // List of objects affecting the ship with their individual forces
    };

    // Ship mesh
    this.shipMesh = null;
    this.createPlayerShip();

    // Target system
    this.targetedEnemy = null;
    this.targetLockIndicator = null;
    this.targetReticle = null;

    // Warp system
    this.selectedPlanet = null;
    this.warpCooldown = 0; // Time until next warp available (seconds)
    this.warpCooldownMax = 30; // 30 second cooldown
    this.warpEnergyCost = 30; // Energy cost per warp
    this.warpInProgress = false;

    // Projectiles
    this.projectiles = [];
    this.projectileGroup = new THREE.Group();
    this.scene.add(this.projectileGroup);

    // Enemy ships
    this.enemies = [];
    this.enemyGroup = new THREE.Group();
    this.scene.add(this.enemyGroup);

    // Trajectory system
    this.trajectoryPath = null;
    this.trajectoryTarget = null;
    this.autopilotActive = false;
    this.trajectoryLine = null;

    // Thrust lock system
    this.thrustLocked = false;
    this.lockedThrust = {};

    // Gravitational systems
    this.gravitationalDampener = false; // X key - maintain orbital height from star
    this.orbitLock = false; // F key - lock orbit on strongest G-force body
    this.orbitLockTarget = null;
    this.orbitLockRadius = 0;
    this.orbitLockRing = null; // Visual ring around locked planet
    this.dampenerRing = null; // Visual ring around star for dampener

    // Camera orbit system
    this.cameraOrbitAngle = 0; // Horizontal rotation (yaw)
    this.cameraOrbitPitch = Math.PI / 6; // Vertical rotation (pitch) - start at 30 degrees
    this.cameraOrbitDistance = 500; // Increased default distance for better view of larger system

    // Controls
    this.keys = {};
    this.setupControls();

    // Raycaster for double-click
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // HUD
    this.setupHUD();

    // Expose to window for button callbacks
    window.combatSystem = this;

    // Setup global enter planet explorer function
    window.enterPlanetExplorer = () => {
      if (this.orbitLockTarget) {
        const planetId = this.orbitLockTarget.userData._id;
        const planetName = this.orbitLockTarget.userData.title;
        console.log(`Entering planetary explorer for ${planetName} (${planetId})`);
        // Navigate to planetary explorer
        window.location.href = `/universe/planet/${planetId}`;
      }
    };

    // Animation
    this.clock = new THREE.Clock();
    this.animate();
  }

  /**
   * Create player ship mesh
   */
  createPlayerShip() {
    const shipGroup = new THREE.Group();

    // ELONGATED NOSE/FUSELAGE - Angular box-based nose (4-sided pyramid)
    const noseGeometry = new THREE.ConeGeometry(2.5, 20, 4); // 4 sides = box-like
    const noseMaterial = new THREE.MeshStandardMaterial({
      color: 0x00aaff,
      metalness: 0.7,
      roughness: 0.3,
      emissive: 0x0044aa,
      emissiveIntensity: 0.5,
      flatShading: true // Makes edges visible
    });
    const nose = new THREE.Mesh(noseGeometry, noseMaterial);
    // Align nose properly with ship axis (Z-forward)
    nose.rotation.set(-Math.PI / 2, 0, 0.0000); // X rotation points forward
    nose.position.set(0, 0, 2.5); // Centered on origin, forward
    shipGroup.add(nose);

    // Main body/cockpit - cylinder section
    const bodyGeometry = new THREE.CylinderGeometry(2.4, 2.4, 2.5, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x0088cc,
      metalness: 0.6,
      roughness: 0.4,
      emissive: 0x003366,
      emissiveIntensity: 0.3
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.rotation.set(Math.PI / 2, 0, 0); // Align cylinder with Z-axis (ship forward)
    body.position.set(0, 0, -2); // Centered on origin, behind nose
    shipGroup.add(body);

    // WINGS - Proper wing shape (thin trapezoids)
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(8, 0); // Wing tip
    wingShape.lineTo(7, -2); // Back of wing tip
    wingShape.lineTo(0, -1.5); // Back of wing root
    wingShape.lineTo(0, 0); // Close shape

    const wingExtrudeSettings = {
      depth: 0.3,
      bevelEnabled: false
    };

    const wingGeometry = new THREE.ExtrudeGeometry(wingShape, wingExtrudeSettings);
    const wingMaterial = new THREE.MeshStandardMaterial({
      color: 0x0066aa,
      metalness: 0.6,
      roughness: 0.4
    });

    // Left wing
    const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
    leftWing.rotation.set(Math.PI / 2, 0, Math.PI); // Align flat with ship, flip for left side
    leftWing.position.set(-1.8, 0, -2.5); // Attach to left side of body
    shipGroup.add(leftWing);

    // Right wing
    const rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
    rightWing.rotation.set(Math.PI / 2, 0, 0); // Align flat with ship
    rightWing.position.set(1.8, 0, -2.5); // Attach to right side of body
    shipGroup.add(rightWing);

    // WINGTIP FLASHING LIGHTS
    const wingtipLightGeometry = new THREE.SphereGeometry(0.3, 8, 8);

    // Left wingtip light (red) - at actual wingtip (wing attach at -1.8, span 8 = tip at -9.8)
    const leftWingtipMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 1
    });
    this.leftWingtipLight = new THREE.Mesh(wingtipLightGeometry, leftWingtipMaterial);
    this.leftWingtipLight.position.set(-9.8, 0, -2.5);
    shipGroup.add(this.leftWingtipLight);

    // Right wingtip light (green) - at actual wingtip (wing attach at 1.8, span 8 = tip at 9.8)
    const rightWingtipMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 1
    });
    this.rightWingtipLight = new THREE.Mesh(wingtipLightGeometry, rightWingtipMaterial);
    this.rightWingtipLight.position.set(9.8, 0, -2.5);
    shipGroup.add(this.rightWingtipLight);

    // Engine glows at rear (main thrusters) - at back of body
    const engineGeometry = new THREE.SphereGeometry(0.8, 8, 8);
    const engineMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.8
    });

    // Left engine - positioned at body radius (2.4) at rear
    const leftEngine = new THREE.Mesh(engineGeometry, engineMaterial.clone());
    leftEngine.position.set(-1.5, 0, -3.5);
    shipGroup.add(leftEngine);

    // Right engine - positioned at body radius (2.4) at rear
    const rightEngine = new THREE.Mesh(engineGeometry, engineMaterial.clone());
    rightEngine.position.set(1.5, 0, -3.5);
    shipGroup.add(rightEngine);

    // Shield sphere (invisible until hit)
    const shieldGeometry = new THREE.SphereGeometry(5, 16, 16);
    const shieldMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    });
    const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
    shipGroup.add(shield);
    this.shieldMesh = shield;

    // THRUSTER VISUAL INDICATORS (6 directional + 2 boosters)
    // These will glow when thrusters fire
    this.thrusterIndicators = {};

    // Rear thrusters (A, S, D) - at back of body (body center at z=-2, length 2.5)
    this.thrusterIndicators.rearLeft = this.createThrusterIndicator(-2.4, 0, -3.5, 0xff6600);
    this.thrusterIndicators.rearCenter = this.createThrusterIndicator(0, 0, -3.5, 0xff6600);
    this.thrusterIndicators.rearRight = this.createThrusterIndicator(2.4, 0, -3.5, 0xff6600);

    // Front thrusters (Q, W, E) - at front of nose (nose tip at z=12.5)
    this.thrusterIndicators.frontLeft = this.createThrusterIndicator(-2, 0.5, 11, 0x00ffff);
    this.thrusterIndicators.frontCenter = this.createThrusterIndicator(0, 0.5, 11, 0x00ffff);
    this.thrusterIndicators.frontRight = this.createThrusterIndicator(2, 0.5, 11, 0x00ffff);

    // Booster jets (Z, C) - at wingtips (wings attach at ±1.8, span 8 = tips at ±9.8)
    this.thrusterIndicators.boostLeft = this.createThrusterIndicator(-9.8, 0, -2.5, 0xffff00);
    this.thrusterIndicators.boostRight = this.createThrusterIndicator(9.8, 0, -2.5, 0xffff00);

    // Add all thruster indicators to ship
    Object.values(this.thrusterIndicators).forEach(indicator => {
      shipGroup.add(indicator);
    });

    shipGroup.position.copy(this.playerShip.position);
    this.scene.add(shipGroup);
    this.shipMesh = shipGroup;
  }

  /**
   * Create a thruster indicator (small glowing sphere)
   */
  createThrusterIndicator(x, y, z, color) {
    const geometry = new THREE.SphereGeometry(0.3, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0 // Start invisible
    });
    const indicator = new THREE.Mesh(geometry, material);
    indicator.position.set(x, y, z);
    return indicator;
  }

  /**
   * Update thruster visual indicators based on key presses
   */
  updateThrusterVisuals() {
    if (!this.thrusterIndicators) return;

    // Rear thrusters (orange glow)
    this.thrusterIndicators.rearLeft.material.opacity = this.keys['a'] ? 1.0 : 0;
    this.thrusterIndicators.rearCenter.material.opacity = this.keys['s'] ? 1.0 : 0;
    this.thrusterIndicators.rearRight.material.opacity = this.keys['d'] ? 1.0 : 0;

    // Front thrusters (cyan glow)
    this.thrusterIndicators.frontLeft.material.opacity = this.keys['q'] ? 1.0 : 0;
    this.thrusterIndicators.frontCenter.material.opacity = this.keys['w'] ? 1.0 : 0;
    this.thrusterIndicators.frontRight.material.opacity = this.keys['e'] ? 1.0 : 0;

    // Boosters (yellow glow)
    this.thrusterIndicators.boostLeft.material.opacity = this.keys['z'] ? 1.0 : 0;
    this.thrusterIndicators.boostRight.material.opacity = this.keys['c'] ? 1.0 : 0;
  }

  /**
   * Setup keyboard controls
   */
  setupControls() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;

      // Fire weapon (Space)
      if (e.code === 'Space') {
        e.preventDefault();
        this.fireWeapon();
      }

      // Target nearest enemy (T)
      if (e.key.toLowerCase() === 't') {
        this.targetNearestEnemy();
      }

      // Cycle targets (Tab)
      if (e.key === 'Tab') {
        e.preventDefault();
        this.cycleTarget();
      }

      // Warp to selected planet (Shift)
      if (e.key === 'Shift') {
        e.preventDefault();
        this.initiateWarp();
      }

      // Lock/unlock thrust (G)
      if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        this.toggleThrustLock();
      }

      // Toggle gravitational dampener (X) - maintain orbital height from star
      if (e.key.toLowerCase() === 'x') {
        e.preventDefault();
        this.toggleGravitationalDampener();
      }

      // Toggle orbit lock (F) - lock orbit on strongest G-force body
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this.toggleOrbitLock();
      }
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();

      // Don't clear keys if thrust is locked
      if (this.thrustLocked) {
        return;
      }

      this.keys[key] = false;
    });

    // Get the renderer canvas element for event attachment
    const canvas = this.galacticMap.renderer.domElement;

    // Single click to select planets
    canvas.addEventListener('click', (e) => {
      this.handleClick(e);
    });

    // Double-click for trajectory
    canvas.addEventListener('dblclick', (e) => {
      this.handleDoubleClick(e);
    });

    // Mouse drag - stored in class for persistence
    this.isLeftMouseDown = false;
    this.isRightMouseDown = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left mouse button - rotate ship
        this.isLeftMouseDown = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        e.preventDefault();
        e.stopPropagation();
      } else if (e.button === 2) { // Right mouse button - rotate camera
        this.isRightMouseDown = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        e.preventDefault();
        e.stopPropagation();
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.isLeftMouseDown) {
        // Left drag: Rotate the ship (yaw and pitch)
        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;

        // Horizontal drag = yaw (turn left/right)
        this.playerShip.yaw -= deltaX * 0.003;

        // Vertical drag = pitch (nose up/down)
        this.playerShip.pitch -= deltaY * 0.003;
        // Clamp pitch to prevent full loops
        this.playerShip.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.playerShip.pitch));

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        e.preventDefault();
        e.stopPropagation();
      } else if (this.isRightMouseDown) {
        // Right drag: Rotate camera orbit
        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;

        // Horizontal drag rotates orbit angle (yaw)
        this.cameraOrbitAngle -= deltaX * 0.01;

        // Vertical drag changes pitch (perspective angle)
        this.cameraOrbitPitch += deltaY * 0.01;
        this.cameraOrbitPitch = Math.max(0.1, Math.min(Math.PI - 0.1, this.cameraOrbitPitch));

        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        e.preventDefault();
        e.stopPropagation();
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isLeftMouseDown = false;
        e.preventDefault();
        e.stopPropagation();
      } else if (e.button === 2) {
        this.isRightMouseDown = false;
        e.preventDefault();
        e.stopPropagation();
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault(); // Disable context menu on right-click
      e.stopPropagation();
    });

    // Mouse wheel for camera distance
    window.addEventListener('wheel', (e) => {
      this.cameraOrbitDistance += e.deltaY * 2; // Increased zoom speed for large scale
      this.cameraOrbitDistance = Math.max(50, Math.min(5000, this.cameraOrbitDistance)); // Huge zoom range for solar system
      e.preventDefault();
    }, { passive: false });

    // Touch controls - single finger touch = camera orbit (like right-click drag)
    this.isTouchActive = false;
    this.lastTouchX = 0;
    this.lastTouchY = 0;

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isTouchActive = true;
        this.lastTouchX = e.touches[0].clientX;
        this.lastTouchY = e.touches[0].clientY;
        e.preventDefault();
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (this.isTouchActive && e.touches.length === 1) {
        const deltaX = e.touches[0].clientX - this.lastTouchX;
        const deltaY = e.touches[0].clientY - this.lastTouchY;

        // Touch drag = camera orbit (same as right-click drag)
        this.cameraOrbitAngle -= deltaX * 0.01;
        this.cameraOrbitPitch += deltaY * 0.01;
        this.cameraOrbitPitch = Math.max(0.1, Math.min(Math.PI - 0.1, this.cameraOrbitPitch));

        this.lastTouchX = e.touches[0].clientX;
        this.lastTouchY = e.touches[0].clientY;
        e.preventDefault();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      this.isTouchActive = false;
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchcancel', (e) => {
      this.isTouchActive = false;
      e.preventDefault();
    }, { passive: false });

    // Arrow keys for camera orbit rotation (alternative to mouse drag)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        this.cameraOrbitAngle += 0.05;
      } else if (e.key === 'ArrowRight') {
        this.cameraOrbitAngle -= 0.05;
      } else if (e.key === 'ArrowUp') {
        this.cameraOrbitPitch -= 0.05; // Tilt camera up
        this.cameraOrbitPitch = Math.max(0.1, this.cameraOrbitPitch);
      } else if (e.key === 'ArrowDown') {
        this.cameraOrbitPitch += 0.05; // Tilt camera down
        this.cameraOrbitPitch = Math.min(Math.PI - 0.1, this.cameraOrbitPitch);
      }
    });
  }

  /**
   * Setup combat HUD - Now integrates with sidebar (HUD elements already exist in sidebar)
   */
  setupHUD() {
    // Sidebar integration - HUD elements are already in the EJS template
    // Just need to show the shape controls section when in combat mode
    const shapeControlsSection = document.getElementById('shapeControlsSection');
    if (shapeControlsSection) {
      shapeControlsSection.style.display = 'block';
      console.log('✅ Ship HUD integrated with sidebar');
    } else {
      console.warn('⚠️ Sidebar not found, HUD elements may not be available');
    }

    // Setup shape controls
    this.setupShapeControls();
  }

  /**
   * Setup interactive shape controls for ship model tuning
   */
  setupShapeControls() {
    const container = document.getElementById('shapeControlsContainer');

    if (!container) {
      console.warn('⚠️ Shape controls container not found in sidebar');
      return;
    }

    // Inject shape controls HTML into sidebar container
    const controlsHTML = `
        <!-- Nose Controls -->
        <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #00ffaa;">
          <div style="font-size: 12px; font-weight: bold; color: #ff6600; margin-bottom: 8px;">NOSE CONE</div>

          <div style="margin-bottom: 8px;">
            <label style="font-size: 10px; display: block; margin-bottom: 3px;">Length: <span id="noseLengthValue">20</span></label>
            <input type="range" id="noseLength" min="5" max="20" value="20" step="0.5" style="width: 100%;">
          </div>

          <div style="margin-bottom: 8px;">
            <label style="font-size: 10px; display: block; margin-bottom: 3px;">Width: <span id="noseWidthValue">2.5</span></label>
            <input type="range" id="noseWidth" min="0.5" max="3" value="2.5" step="0.1" style="width: 100%;">
          </div>

          <div style="margin-bottom: 8px;">
            <label style="font-size: 10px; display: block; margin-bottom: 3px;">Position Z: <span id="nosePosZValue">2.5</span></label>
            <input type="range" id="nosePosZ" min="-2" max="8" value="2.5" step="0.5" style="width: 100%;">
          </div>

          <div style="margin-bottom: 8px;">
            <label style="font-size: 10px; display: block; margin-bottom: 3px;">Rotation Z: <span id="noseRotZValue">0</span>°</label>
            <input type="range" id="noseRotZ" min="0" max="90" value="0" step="5" style="width: 100%;">
          </div>
        </div>

        <!-- Body Controls -->
        <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #00ffaa;">
          <div style="font-size: 12px; font-weight: bold; color: #ff6600; margin-bottom: 8px;">BODY/COCKPIT</div>

          <div style="margin-bottom: 8px;">
            <label style="font-size: 10px; display: block; margin-bottom: 3px;">Length: <span id="bodyLengthValue">2.5</span></label>
            <input type="range" id="bodyLength" min="2" max="8" value="2.5" step="0.5" style="width: 100%;">
          </div>

          <div style="margin-bottom: 8px;">
            <label style="font-size: 10px; display: block; margin-bottom: 3px;">Radius: <span id="bodyRadiusValue">2.4</span></label>
            <input type="range" id="bodyRadius" min="1" max="3" value="2.4" step="0.1" style="width: 100%;">
          </div>

          <div style="margin-bottom: 8px;">
            <label style="font-size: 10px; display: block; margin-bottom: 3px;">Position Z: <span id="bodyPosZValue">-2</span></label>
            <input type="range" id="bodyPosZ" min="-6" max="2" value="-2" step="0.5" style="width: 100%;">
          </div>
        </div>

        <!-- Wing Controls -->
        <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #00ffaa;">
          <div style="font-size: 12px; font-weight: bold; color: #ff6600; margin-bottom: 8px;">WINGS</div>

          <div style="margin-bottom: 8px;">
            <label style="font-size: 10px; display: block; margin-bottom: 3px;">Span: <span id="wingSpanValue">8</span></label>
            <input type="range" id="wingSpan" min="3" max="8" value="8" step="0.5" style="width: 100%;">
          </div>

          <div style="margin-bottom: 8px;">
            <label style="font-size: 10px; display: block; margin-bottom: 3px;">Position X: <span id="wingPosXValue">1.8</span></label>
            <input type="range" id="wingPosX" min="1" max="3" value="1.8" step="0.1" style="width: 100%;">
          </div>

          <div style="margin-bottom: 8px;">
            <label style="font-size: 10px; display: block; margin-bottom: 3px;">Position Z: <span id="wingPosZValue">-2.5</span></label>
            <input type="range" id="wingPosZ" min="-4" max="2" value="-2.5" step="0.5" style="width: 100%;">
          </div>
        </div>
        </div>

        <!-- Export Button -->
        <div style="text-align: center;">
          <button id="exportShapeValues" style="
            background: #00ffaa;
            color: #000;
            border: none;
            padding: 8px 16px;
            border-radius: 5px;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            cursor: pointer;
            font-size: 11px;
          ">EXPORT TO CONSOLE</button>
        </div>
      </div>
    `;

    // Insert into sidebar container instead of body
    container.innerHTML = controlsHTML;

    // Store references to ship parts for live updates
    this.shipParts = {
      nose: null,
      body: null,
      leftWing: null,
      rightWing: null
    };

    // Find the ship parts from the shipMesh
    if (this.shipMesh) {
      this.shipMesh.children.forEach(child => {
        // Identify parts by their geometry type
        if (child.geometry && child.geometry.type === 'ConeGeometry') {
          this.shipParts.nose = child;
        } else if (child.geometry && child.geometry.type === 'CylinderGeometry') {
          this.shipParts.body = child;
        } else if (child.geometry && child.geometry.type === 'ExtrudeGeometry') {
          if (!this.shipParts.leftWing) {
            this.shipParts.leftWing = child;
          } else {
            this.shipParts.rightWing = child;
          }
        }
      });
    }

    // Add event listeners for real-time updates
    this.setupShapeControlListeners();
  }

  /**
   * Setup event listeners for shape control sliders
   */
  setupShapeControlListeners() {
    // Nose controls
    document.getElementById('noseLength').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('noseLengthValue').textContent = value;
      if (this.shipParts.nose) {
        this.shipParts.nose.scale.z = value / 10; // Original was 10
      }
    });

    document.getElementById('noseWidth').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('noseWidthValue').textContent = value;
      if (this.shipParts.nose) {
        const scale = value / 1.5; // Original was 1.5
        this.shipParts.nose.scale.x = scale;
        this.shipParts.nose.scale.y = scale;
      }
    });

    document.getElementById('nosePosZ').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('nosePosZValue').textContent = value;
      if (this.shipParts.nose) {
        this.shipParts.nose.position.z = value;
      }
    });

    document.getElementById('noseRotZ').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('noseRotZValue').textContent = value;
      if (this.shipParts.nose) {
        this.shipParts.nose.rotation.z = (value * Math.PI) / 180;
      }
    });

    // Body controls
    document.getElementById('bodyLength').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('bodyLengthValue').textContent = value;
      if (this.shipParts.body) {
        this.shipParts.body.scale.z = value / 4; // Original was 4
      }
    });

    document.getElementById('bodyRadius').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('bodyRadiusValue').textContent = value;
      if (this.shipParts.body) {
        const scale = value / 1.8; // Original was 1.8
        this.shipParts.body.scale.x = scale;
        this.shipParts.body.scale.y = scale;
      }
    });

    document.getElementById('bodyPosZ').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('bodyPosZValue').textContent = value;
      if (this.shipParts.body) {
        this.shipParts.body.position.z = value;
      }
    });

    // Wing controls
    document.getElementById('wingSpan').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('wingSpanValue').textContent = value;
      const scale = value / 5; // Original was 5
      if (this.shipParts.leftWing) {
        this.shipParts.leftWing.scale.x = scale;
      }
      if (this.shipParts.rightWing) {
        this.shipParts.rightWing.scale.x = scale;
      }
    });

    document.getElementById('wingPosX').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('wingPosXValue').textContent = value;
      if (this.shipParts.leftWing) {
        this.shipParts.leftWing.position.x = -value;
      }
      if (this.shipParts.rightWing) {
        this.shipParts.rightWing.position.x = value;
      }
    });

    document.getElementById('wingPosZ').addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById('wingPosZValue').textContent = value;
      if (this.shipParts.leftWing) {
        this.shipParts.leftWing.position.z = value;
      }
      if (this.shipParts.rightWing) {
        this.shipParts.rightWing.position.z = value;
      }
    });

    // Export button
    document.getElementById('exportShapeValues').addEventListener('click', () => {
      const values = {
        nose: {
          length: parseFloat(document.getElementById('noseLength').value),
          width: parseFloat(document.getElementById('noseWidth').value),
          positionZ: parseFloat(document.getElementById('nosePosZ').value),
          rotationZ: parseFloat(document.getElementById('noseRotZ').value)
        },
        body: {
          length: parseFloat(document.getElementById('bodyLength').value),
          radius: parseFloat(document.getElementById('bodyRadius').value),
          positionZ: parseFloat(document.getElementById('bodyPosZ').value)
        },
        wings: {
          span: parseFloat(document.getElementById('wingSpan').value),
          positionX: parseFloat(document.getElementById('wingPosX').value),
          positionZ: parseFloat(document.getElementById('wingPosZ').value)
        }
      };

      console.log('=== SHIP SHAPE VALUES ===');
      console.log(JSON.stringify(values, null, 2));
      console.log('\nCopy these values for permanent implementation:');
      console.log(`
// Nose
const noseGeometry = new THREE.ConeGeometry(${values.nose.width}, ${values.nose.length}, 4);
nose.position.set(0, 0, ${values.nose.positionZ});
nose.rotation.set(-Math.PI / 2, 0, ${(values.nose.rotationZ * Math.PI / 180).toFixed(4)});

// Body
const bodyGeometry = new THREE.CylinderGeometry(${values.body.radius}, ${values.body.radius}, ${values.body.length}, 8);
body.position.set(0, 0, ${values.body.positionZ});

// Wings
wingShape.lineTo(${values.wings.span}, 0);
leftWing.position.set(-${values.wings.positionX}, 0, ${values.wings.positionZ});
rightWing.position.set(${values.wings.positionX}, 0, ${values.wings.positionZ});
      `);
    });
  }

  /**
   * Update HUD display
   */
  updateHUD() {
    const hull = (this.playerShip.hull / this.playerShip.hullMax * 100).toFixed(0);
    const shields = (this.playerShip.shields / this.playerShip.shieldsMax * 100).toFixed(0);
    const energy = (this.playerShip.energy / this.playerShip.energyMax * 100).toFixed(0);
    const velocity = this.playerShip.velocity.length().toFixed(1);

    document.getElementById('hullValue').textContent = hull + '%';
    document.getElementById('hullBar').style.width = hull + '%';

    document.getElementById('shieldValue').textContent = shields + '%';
    document.getElementById('shieldBar').style.width = shields + '%';

    document.getElementById('energyValue').textContent = energy + '%';
    document.getElementById('energyBar').style.width = energy + '%';

    // Check if any thruster keys are pressed
    const thrustersActive = this.keys['w'] || this.keys['s'] || this.keys['a'] ||
                            this.keys['d'] || this.keys['q'] || this.keys['e'] ||
                            this.keys['z'] || this.keys['c'];

    // Show max velocity marker only when thrusters are not active
    if (thrustersActive) {
      document.getElementById('velocityValue').textContent = velocity + ' m/s';
    } else {
      document.getElementById('velocityValue').textContent = velocity + ' m/s / ' + this.playerShip.maxSpeed + ' m/s';
    }

    if (this.targetedEnemy) {
      const distance = this.playerShip.position.distanceTo(this.targetedEnemy.position);
      document.getElementById('targetValue').textContent = `ENEMY (${distance.toFixed(0)}m)`;
      document.getElementById('targetValue').style.color = '#ff0000';
    } else {
      document.getElementById('targetValue').textContent = 'NONE';
      document.getElementById('targetValue').style.color = '#666';
    }

    // Update selected planet
    if (this.selectedPlanet) {
      const planetName = this.selectedPlanet.userData.title || 'Unknown';
      document.getElementById('planetValue').textContent = planetName;
      document.getElementById('planetValue').style.color = '#ffaa00';
    } else {
      document.getElementById('planetValue').textContent = 'NONE';
      document.getElementById('planetValue').style.color = '#666';
    }

    // Update warp status
    if (this.warpInProgress) {
      document.getElementById('warpValue').textContent = 'WARPING...';
      document.getElementById('warpValue').style.color = '#00ffff';
    } else if (this.warpCooldown > 0) {
      document.getElementById('warpValue').textContent = `COOLDOWN ${this.warpCooldown.toFixed(1)}s`;
      document.getElementById('warpValue').style.color = '#ff6600';
    } else {
      document.getElementById('warpValue').textContent = 'READY';
      document.getElementById('warpValue').style.color = '#00ff00';
    }

    // Update thrust lock status
    if (this.thrustLocked) {
      document.getElementById('thrustLockValue').textContent = '🔒 LOCKED';
      document.getElementById('thrustLockValue').style.color = '#ffaa00';
    } else {
      document.getElementById('thrustLockValue').textContent = 'MANUAL';
      document.getElementById('thrustLockValue').style.color = '#00ffaa';
    }

    // Update gravitational dampener status
    if (this.gravitationalDampener) {
      document.getElementById('dampenerValue').textContent = '⚖️ ON';
      document.getElementById('dampenerValue').style.color = '#00ff00';
    } else {
      document.getElementById('dampenerValue').textContent = 'OFF';
      document.getElementById('dampenerValue').style.color = '#666';
    }

    // Update orbit lock status
    if (this.orbitLock && this.orbitLockTarget) {
      const targetName = this.orbitLockTarget.userData.title || 'Unknown';
      document.getElementById('orbitLockValue').textContent = `🔄 ${targetName}`;
      document.getElementById('orbitLockValue').style.color = '#00ff00';
    } else {
      document.getElementById('orbitLockValue').textContent = 'OFF';
      document.getElementById('orbitLockValue').style.color = '#666';
    }

    // Update G-forces display
    const gTotal = this.gForces.magnitude.toFixed(2);
    const gThrust = this.gForces.thrust.length().toFixed(2);

    document.getElementById('gForceTotal').textContent = gTotal;
    document.getElementById('gForceThrust').textContent = gThrust;

    // Update objects list
    const objectsList = document.getElementById('gForceObjectsList');
    if (this.gForces.objects && this.gForces.objects.length > 0) {
      objectsList.innerHTML = this.gForces.objects.map(obj => {
        const icon = obj.type === 'star' ? '⭐' : '🪐';
        const color = obj.type === 'star' ? '#ffaa00' : '#00aaff';
        return `<div style="margin: 2px 0; color: ${color};">
          ${icon} ${obj.name}: ${obj.force.toFixed(1)}G @ ${obj.distance.toFixed(0)}m
        </div>`;
      }).join('');
    } else {
      objectsList.innerHTML = '<div style="color: #666;">No gravitational forces</div>';
    }
  }

  /**
   * Calculate gravitational forces from all celestial bodies
   */
  calculateGravitationalForces() {
    const G = 6.674e-11; // Gravitational constant (scaled for game)
    const gravityScale = 1e7; // EXTREMELY REDUCED - was causing 2000 m/s falls (was 1e9)

    const totalGravity = new THREE.Vector3(0, 0, 0);
    const objectsAffectingShip = []; // Track each object's contribution

    // Get all assets from the galactic map
    if (this.galacticMap && this.galacticMap.assets) {
      this.galacticMap.assets.forEach((asset) => {
        if (!asset.mesh || !asset.mesh.userData) return;

        const bodyType = asset.mesh.userData.type;
        const bodyName = asset.mesh.userData.title || 'Unknown';
        const bodyPos = asset.mesh.position;

        // ONLY planets have gravity - stars removed so ship can orbit planets naturally
        // Skip stars completely - they don't pull on the ship
        if (bodyType !== 'planet') return;

        // Calculate distance vector
        const distanceVector = new THREE.Vector3().subVectors(bodyPos, this.playerShip.position);
        const distance = distanceVector.length();

        // Skip if too close (avoid division by zero)
        if (distance < 10) return;

        // Only planets have gravity now - estimate mass
        const bodyMass = 1e16; // Planets have moderate mass

        // Calculate gravitational force magnitude: F = G * M * m / r^2
        const forceMagnitude = (G * bodyMass * this.playerShip.mass * gravityScale) / (distance * distance);

        // Calculate force vector (pointing toward the body)
        const forceDirection = distanceVector.clone().normalize();
        const forceVector = forceDirection.multiplyScalar(forceMagnitude);

        // Add to total
        totalGravity.add(forceVector);

        // Track this object's contribution
        objectsAffectingShip.push({
          name: bodyName,
          type: bodyType,
          distance: distance,
          force: forceMagnitude,
          forceVector: forceVector.clone()
        });
      });
    }

    // Sort by force magnitude (strongest first)
    objectsAffectingShip.sort((a, b) => b.force - a.force);

    // Store for HUD display
    this.gForces.objects = objectsAffectingShip;

    return totalGravity;
  }

  /**
   * Handle thrust controls - 6 DIRECTIONAL THRUSTERS + 2 BOOSTERS
   * Rear thrusters: A S D (left, back, right)
   * Front thrusters: Q W E (up-left, up, up-right)
   * Boosters: Z (left), C (right)
   */
  updateThrust(deltaTime) {
    const singleThrust = this.playerShip.singleThruster;
    const boostThrust = this.playerShip.boosterPower;

    // Thrust acceleration in ship's LOCAL space
    const localThrust = new THREE.Vector3(0, 0, 0);

    // REAR THRUSTERS (back of ship) - Push you FORWARD (+Z)
    if (this.keys['s']) localThrust.z += singleThrust; // S = Rear center -> propels FORWARD
    if (this.keys['a']) {
      localThrust.z += singleThrust; // A = Rear left -> propels FORWARD
      localThrust.x += singleThrust * 0.3; // + slight left push
    }
    if (this.keys['d']) {
      localThrust.z += singleThrust; // D = Rear right -> propels FORWARD
      localThrust.x -= singleThrust * 0.3; // + slight right push
    }

    // FRONT THRUSTERS (front of ship) - BRAKES, push you BACKWARD (-Z)
    if (this.keys['w']) localThrust.z -= singleThrust; // W = Front center -> braking
    if (this.keys['q']) {
      localThrust.z -= singleThrust; // Q = Front left -> braking
      localThrust.x -= singleThrust * 0.3; // + slight left push
      localThrust.y -= singleThrust * 0.3; // + slight down push
    }
    if (this.keys['e']) {
      localThrust.z -= singleThrust; // E = Front right -> braking
      localThrust.x += singleThrust * 0.3; // + slight right push
      localThrust.y -= singleThrust * 0.3; // + slight down push
    }

    // BOOSTER JETS (powerful lateral thrust)
    if (this.keys['z']) localThrust.x -= boostThrust; // Z = Left booster -> pushes you LEFT (-X)
    if (this.keys['c']) localThrust.x += boostThrust; // C = Right booster -> pushes you RIGHT (+X)

    // UPDATE THRUSTER VISUAL INDICATORS
    this.updateThrusterVisuals();

    // Convert local thrust to world space using ship rotation
    const worldThrust = new THREE.Vector3();
    if (this.shipMesh) {
      // Apply ship's actual rotation quaternion to thrust vector
      worldThrust.copy(localThrust);
      worldThrust.applyQuaternion(this.shipMesh.quaternion);
    } else {
      worldThrust.copy(localThrust);
    }

    // Store thrust force for G-force display
    this.gForces.thrust.copy(worldThrust);

    // GRAVITY DISABLED - was inescapable even at 2000 m/s
    // Calculate gravitational forces (for display only)
    const gravityForce = this.calculateGravitationalForces();
    this.gForces.gravity.copy(gravityForce);

    // Total acceleration = THRUST ONLY (gravity disabled)
    const totalAcceleration = worldThrust.clone(); // NO GRAVITY ADDED
    this.gForces.total.copy(totalAcceleration);
    this.gForces.magnitude = totalAcceleration.length();

    // Apply thrust acceleration only (no gravity)
    this.playerShip.velocity.add(totalAcceleration.multiplyScalar(deltaTime));

    // Apply drag (space friction)
    this.playerShip.velocity.multiplyScalar(this.playerShip.drag);

    // Clamp to max speed
    if (this.playerShip.velocity.length() > this.playerShip.maxSpeed) {
      this.playerShip.velocity.normalize().multiplyScalar(this.playerShip.maxSpeed);
    }

    // Update position
    this.playerShip.position.add(this.playerShip.velocity.clone().multiplyScalar(deltaTime));

    // Apply gravitational dampener (X key) - maintain orbital height from star
    if (this.gravitationalDampener && this.galacticMap && this.galacticMap.assets) {
      // Find the star (center of system)
      let star = null;
      this.galacticMap.assets.forEach((asset) => {
        if (asset.mesh.userData.type === 'star') {
          star = asset.mesh;
        }
      });

      if (star) {
        const currentDistance = this.playerShip.position.distanceTo(star.position);
        const targetDistance = currentDistance; // Maintain current distance
        const toStar = new THREE.Vector3().subVectors(star.position, this.playerShip.position);
        const radialVelocity = this.playerShip.velocity.clone().projectOnVector(toStar.normalize());

        // Counter the radial velocity component to maintain orbital height
        this.playerShip.velocity.sub(radialVelocity.multiplyScalar(0.95)); // 95% dampening
      }
    }

    // Apply orbit lock (F key) - maintain circular orbit around strongest body
    if (this.orbitLock && this.orbitLockTarget) {
      const currentDistance = this.playerShip.position.distanceTo(this.orbitLockTarget.position);
      const distanceError = currentDistance - this.orbitLockRadius;

      // Apply corrective force to maintain orbital radius
      if (Math.abs(distanceError) > 1) { // Only correct if off by more than 1 unit
        const toBody = new THREE.Vector3().subVectors(this.orbitLockTarget.position, this.playerShip.position);
        const correction = toBody.normalize().multiplyScalar(distanceError * 0.1); // Gentle correction
        this.playerShip.velocity.add(correction);
      }
    }
  }

  /**
   * Fire primary weapon with auto-lock
   */
  fireWeapon() {
    const weapon = this.playerShip.primaryWeapon;
    const now = Date.now() / 1000;

    // Check cooldown
    if (now - weapon.lastFired < weapon.cooldown) {
      return;
    }

    // Check energy
    if (this.playerShip.energy < weapon.energyCost) {
      console.log('Insufficient energy!');
      return;
    }

    // Consume energy
    this.playerShip.energy -= weapon.energyCost;
    weapon.lastFired = now;

    // Calculate firing direction
    let firingDirection = new THREE.Vector3(0, 0, 1); // Default: forward

    // Auto-lock: aim at targeted enemy with lead prediction
    if (this.targetedEnemy) {
      const aimDirection = this.calculateLeadTarget(this.targetedEnemy);
      if (aimDirection) {
        firingDirection = aimDirection;
      }
    } else if (this.shipMesh) {
      // No target: fire in ship's forward direction
      this.shipMesh.getWorldDirection(firingDirection);
    }

    // Create projectile
    const projectile = {
      position: this.playerShip.position.clone(),
      velocity: firingDirection.normalize().multiplyScalar(weapon.projectileSpeed).add(this.playerShip.velocity),
      damage: weapon.damage,
      lifetime: 5, // seconds
      createdAt: now
    };

    // Create visual
    const geometry = new THREE.SphereGeometry(0.5, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: this.targetedEnemy ? 0xff0000 : 0x00ff00, // Red if locked, green if free-fire
      emissive: this.targetedEnemy ? 0xff0000 : 0x00ff00,
      emissiveIntensity: 2
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(projectile.position);
    this.projectileGroup.add(mesh);
    projectile.mesh = mesh;

    this.projectiles.push(projectile);

    console.log(this.targetedEnemy ? '🎯 Auto-lock fired!' : '🔫 Weapon fired!');
  }

  /**
   * Calculate lead target for moving enemy
   * Returns direction to fire to hit enemy at predicted future position
   */
  calculateLeadTarget(enemy) {
    if (!enemy || !enemy.position) return null;

    const weapon = this.playerShip.primaryWeapon;
    const projectileSpeed = weapon.projectileSpeed;

    // Vector from ship to enemy
    const toEnemy = new THREE.Vector3().subVectors(enemy.position, this.playerShip.position);
    const distance = toEnemy.length();

    // Enemy velocity (currently enemies don't move, but this is future-proof)
    const enemyVelocity = enemy.velocity || new THREE.Vector3(0, 0, 0);

    // Time for projectile to reach enemy
    const timeToHit = distance / projectileSpeed;

    // Predict enemy's future position
    const futurePosition = enemy.position.clone().add(
      enemyVelocity.clone().multiplyScalar(timeToHit)
    );

    // Direction to future position
    const leadDirection = new THREE.Vector3().subVectors(futurePosition, this.playerShip.position);

    return leadDirection.normalize();
  }

  /**
   * Target nearest enemy
   */
  targetNearestEnemy() {
    if (this.enemies.length === 0) {
      console.log('No enemies to target');
      return;
    }

    let nearest = null;
    let minDist = Infinity;

    this.enemies.forEach(enemy => {
      const dist = this.playerShip.position.distanceTo(enemy.position);
      if (dist < minDist) {
        minDist = dist;
        nearest = enemy;
      }
    });

    this.targetedEnemy = nearest;
    this.createTargetReticle();
    console.log(`🎯 Targeted enemy at ${minDist.toFixed(0)}m`);
  }

  /**
   * Create visual targeting reticle
   */
  createTargetReticle() {
    // Remove old reticle
    if (this.targetReticle) {
      this.scene.remove(this.targetReticle);
    }

    if (!this.targetedEnemy) return;

    // Create reticle ring around target
    const ringGeometry = new THREE.RingGeometry(8, 10, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);

    // Add crosshairs
    const crosshairGroup = new THREE.Group();

    // Horizontal line
    const hLineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-12, 0, 0),
      new THREE.Vector3(12, 0, 0)
    ]);
    const hLine = new THREE.Line(hLineGeometry, new THREE.LineBasicMaterial({ color: 0xff0000 }));
    crosshairGroup.add(hLine);

    // Vertical line
    const vLineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -12, 0),
      new THREE.Vector3(0, 12, 0)
    ]);
    const vLine = new THREE.Line(vLineGeometry, new THREE.LineBasicMaterial({ color: 0xff0000 }));
    crosshairGroup.add(vLine);

    // Combine ring and crosshairs
    const reticle = new THREE.Group();
    reticle.add(ring);
    reticle.add(crosshairGroup);

    this.scene.add(reticle);
    this.targetReticle = reticle;
  }

  /**
   * Cycle through targets
   */
  cycleTarget() {
    if (this.enemies.length === 0) return;

    const currentIndex = this.enemies.indexOf(this.targetedEnemy);
    const nextIndex = (currentIndex + 1) % this.enemies.length;
    this.targetedEnemy = this.enemies[nextIndex];
    this.createTargetReticle();
  }

  /**
   * Handle click to select planets
   */
  handleClick(event) {
    // Convert mouse position to normalized device coordinates
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Raycast to find clicked objects
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Get all planet meshes from galacticMap
    const planetMeshes = [];
    if (this.galacticMap && this.galacticMap.assets) {
      this.galacticMap.assets.forEach((asset) => {
        if (asset.mesh && asset.mesh.userData.type === 'planet') {
          planetMeshes.push(asset.mesh);
        }
      });
    }

    // Check for intersections
    const intersects = this.raycaster.intersectObjects(planetMeshes, false);

    if (intersects.length > 0) {
      const clickedPlanet = intersects[0].object;
      this.selectPlanet(clickedPlanet);
    } else {
      // Clicked empty space - deselect
      this.deselectPlanet();
    }
  }

  /**
   * Select a planet for warping
   */
  selectPlanet(planetMesh) {
    this.selectedPlanet = planetMesh;
    console.log(`🪐 Selected planet: ${planetMesh.userData.title || 'Unknown'}`);

    // Visual feedback - make planet pulse
    if (planetMesh.material) {
      planetMesh.material.emissive = new THREE.Color(0xffaa00);
      planetMesh.material.emissiveIntensity = 0.5;
    }
  }

  /**
   * Deselect planet
   */
  deselectPlanet() {
    if (this.selectedPlanet && this.selectedPlanet.material) {
      this.selectedPlanet.material.emissive = new THREE.Color(0x000000);
      this.selectedPlanet.material.emissiveIntensity = 0;
    }
    this.selectedPlanet = null;
    console.log('🪐 Planet deselected');
  }

  /**
   * Initiate warp to selected planet
   */
  initiateWarp() {
    // Check if planet is selected
    if (!this.selectedPlanet) {
      console.log('⚠️ No planet selected! Click a planet first.');
      return;
    }

    // Check if already warping
    if (this.warpInProgress) {
      console.log('⚠️ Warp already in progress!');
      return;
    }

    // Check cooldown
    if (this.warpCooldown > 0) {
      console.log(`⚠️ Warp drive cooling down: ${this.warpCooldown.toFixed(1)}s remaining`);
      return;
    }

    // Check energy
    if (this.playerShip.energy < this.warpEnergyCost) {
      console.log(`⚠️ Insufficient energy! Need ${this.warpEnergyCost}, have ${this.playerShip.energy.toFixed(0)}`);
      return;
    }

    // Check if in combat (near enemies)
    const nearbyEnemy = this.enemies.find(enemy => {
      const dist = this.playerShip.position.distanceTo(enemy.position);
      return dist < 2000; // Can't warp if enemy within 2000 units
    });

    if (nearbyEnemy) {
      console.log('⚠️ Cannot warp during combat!');
      return;
    }

    // All checks passed - WARP!
    this.executeWarp();
  }

  /**
   * Execute the warp
   */
  executeWarp() {
    this.warpInProgress = true;

    // Consume energy
    this.playerShip.energy -= this.warpEnergyCost;

    // Get target position (planet position)
    const targetPos = this.selectedPlanet.position.clone();

    // Offset position slightly so we don't spawn inside the planet
    const offset = new THREE.Vector3(150, 0, 150);
    targetPos.add(offset);

    console.log(`🌟 WARPING to ${this.selectedPlanet.userData.title}!`);

    // Warp flash effect
    this.createWarpFlash();

    // Teleport ship after brief delay
    setTimeout(() => {
      this.playerShip.position.copy(targetPos);
      this.playerShip.velocity.set(0, 0, 0); // Stop all momentum

      // Warp arrival effect
      this.createWarpArrival();

      // Start cooldown
      this.warpCooldown = this.warpCooldownMax;
      this.warpInProgress = false;

      console.log(`✅ Warp complete! Position: (${targetPos.x.toFixed(0)}, ${targetPos.y.toFixed(0)}, ${targetPos.z.toFixed(0)})`);
    }, 500); // 0.5 second warp animation
  }

  /**
   * Create warp flash effect
   */
  createWarpFlash() {
    // Create expanding sphere around ship
    const geometry = new THREE.SphereGeometry(10, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.8
    });
    const flash = new THREE.Mesh(geometry, material);
    flash.position.copy(this.playerShip.position);
    this.scene.add(flash);

    // Animate expansion and fade
    let scale = 1;
    const expandInterval = setInterval(() => {
      scale += 0.5;
      flash.scale.set(scale, scale, scale);
      material.opacity -= 0.1;

      if (material.opacity <= 0) {
        clearInterval(expandInterval);
        this.scene.remove(flash);
        geometry.dispose();
        material.dispose();
      }
    }, 50);
  }

  /**
   * Create warp arrival effect
   */
  createWarpArrival() {
    // Create particle burst at arrival
    const geometry = new THREE.SphereGeometry(20, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 1
    });
    const burst = new THREE.Mesh(geometry, material);
    burst.position.copy(this.playerShip.position);
    this.scene.add(burst);

    // Fade out
    let opacity = 1;
    const fadeInterval = setInterval(() => {
      opacity -= 0.1;
      material.opacity = opacity;

      if (opacity <= 0) {
        clearInterval(fadeInterval);
        this.scene.remove(burst);
        geometry.dispose();
        material.dispose();
      }
    }, 50);
  }

  /**
   * Handle double-click for trajectory
   */
  handleDoubleClick(event) {
    // Convert mouse position to normalized device coordinates
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Create raycast from camera
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Create an invisible plane at current ship position to raycast against
    const planeNormal = new THREE.Vector3(0, 1, 0); // XZ plane
    const plane = new THREE.Plane(planeNormal, -this.playerShip.position.y);
    const targetPoint = new THREE.Vector3();

    this.raycaster.ray.intersectPlane(plane, targetPoint);

    if (targetPoint) {
      this.setAutopilotTarget(targetPoint);
      console.log(`🎯 Autopilot engaged! Target: (${targetPoint.x.toFixed(0)}, ${targetPoint.y.toFixed(0)}, ${targetPoint.z.toFixed(0)})`);
    }
  }

  /**
   * Toggle thrust lock - locks current thrust settings
   */
  toggleThrustLock() {
    this.thrustLocked = !this.thrustLocked;

    if (this.thrustLocked) {
      // Lock current thrust state
      this.lockedThrust = {
        w: this.keys['w'] || false,
        a: this.keys['a'] || false,
        s: this.keys['s'] || false,
        d: this.keys['d'] || false,
        q: this.keys['q'] || false,
        e: this.keys['e'] || false,
        z: this.keys['z'] || false,
        c: this.keys['c'] || false
      };

      // Apply locked thrust to keys
      Object.keys(this.lockedThrust).forEach(key => {
        this.keys[key] = this.lockedThrust[key];
      });

      console.log('🔒 Thrust LOCKED');
    } else {
      // Unlock - clear all thrust keys
      this.keys['w'] = false;
      this.keys['a'] = false;
      this.keys['s'] = false;
      this.keys['d'] = false;
      this.keys['q'] = false;
      this.keys['e'] = false;
      this.keys['z'] = false;
      this.keys['c'] = false;
      this.lockedThrust = {};

      console.log('🔓 Thrust UNLOCKED');
    }
  }

  /**
   * Toggle gravitational dampener - maintains orbital height from star
   */
  toggleGravitationalDampener() {
    this.gravitationalDampener = !this.gravitationalDampener;

    if (this.gravitationalDampener) {
      // Find the star and create visual ring
      let star = null;
      if (this.galacticMap && this.galacticMap.assets) {
        this.galacticMap.assets.forEach((asset) => {
          if (asset.mesh.userData.type === 'star') {
            star = asset.mesh;
          }
        });
      }

      if (star) {
        const distance = this.playerShip.position.distanceTo(star.position);
        this.createDampenerRing(star, distance);
      }

      console.log('⚖️ GRAVITATIONAL DAMPENER ENGAGED - Maintaining orbital height from star');
    } else {
      // Remove dampener ring
      if (this.dampenerRing) {
        this.scene.remove(this.dampenerRing);
        this.dampenerRing = null;
      }
      console.log('⚖️ GRAVITATIONAL DAMPENER DISENGAGED');
    }
  }

  /**
   * Toggle orbit lock - locks orbit around strongest G-force body
   */
  toggleOrbitLock() {
    this.orbitLock = !this.orbitLock;

    if (this.orbitLock) {
      // Find the strongest gravitational body
      if (this.gForces.objects && this.gForces.objects.length > 0) {
        const strongestBody = this.gForces.objects[0]; // Already sorted by force magnitude

        // Find the actual mesh for this body
        let targetMesh = null;
        if (this.galacticMap && this.galacticMap.assets) {
          this.galacticMap.assets.forEach((asset) => {
            if (asset.mesh.userData.title === strongestBody.name) {
              targetMesh = asset.mesh;
            }
          });
        }

        if (targetMesh) {
          this.orbitLockTarget = targetMesh;
          this.orbitLockRadius = this.playerShip.position.distanceTo(targetMesh.position);

          // Create visual ring around locked planet
          this.createOrbitLockRing(targetMesh);

          // Create 3D orbit lock label in scene
          this.createOrbitLockLabel(targetMesh);

          console.log(`🔄 ORBIT LOCK ENGAGED on ${strongestBody.name} at ${this.orbitLockRadius.toFixed(0)}m`);
        } else {
          console.log('❌ No gravitational body found to lock onto');
          this.orbitLock = false;
        }
      } else {
        console.log('❌ No gravitational forces detected');
        this.orbitLock = false;
      }
    } else {
      this.orbitLockTarget = null;
      this.orbitLockRadius = 0;

      // Remove orbit lock ring
      if (this.orbitLockRing) {
        this.scene.remove(this.orbitLockRing);
        this.orbitLockRing = null;
      }

      // Hide orbit lock label
      this.hideOrbitLockPanel();

      console.log('🔄 ORBIT LOCK DISENGAGED');
    }
  }

  /**
   * Create dampener visual ring around star
   */
  createDampenerRing(star, radius) {
    // Remove old ring
    if (this.dampenerRing) {
      this.scene.remove(this.dampenerRing);
    }

    // Create double ring (two thin rings)
    const ringGroup = new THREE.Group();

    // Inner ring
    const innerGeometry = new THREE.RingGeometry(radius - 2, radius - 1, 64);
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6
    });
    const innerRing = new THREE.Mesh(innerGeometry, innerMaterial);
    innerRing.rotation.x = Math.PI / 2;
    ringGroup.add(innerRing);

    // Outer ring
    const outerGeometry = new THREE.RingGeometry(radius + 1, radius + 2, 64);
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6
    });
    const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
    outerRing.rotation.x = Math.PI / 2;
    ringGroup.add(outerRing);

    // Position at star
    ringGroup.position.copy(star.position);

    this.scene.add(ringGroup);
    this.dampenerRing = ringGroup;
  }

  /**
   * Create orbit lock visual ring around planet
   */
  createOrbitLockRing(planet) {
    // Remove old ring
    if (this.orbitLockRing) {
      this.scene.remove(this.orbitLockRing);
    }

    // Get planet radius from mesh scale or default
    const planetRadius = planet.geometry ? planet.geometry.parameters.radius * planet.scale.x : 10;
    const ringRadius = planetRadius + 5;

    // Create double ring (two thin rings)
    const ringGroup = new THREE.Group();

    // Inner ring (cyan/blue)
    const innerGeometry = new THREE.RingGeometry(ringRadius, ringRadius + 1, 64);
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ddff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7
    });
    const innerRing = new THREE.Mesh(innerGeometry, innerMaterial);
    innerRing.rotation.x = Math.PI / 2;
    ringGroup.add(innerRing);

    // Outer ring (green/cyan)
    const outerGeometry = new THREE.RingGeometry(ringRadius + 2, ringRadius + 3, 64);
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7
    });
    const outerRing = new THREE.Mesh(outerGeometry, outerMaterial);
    outerRing.rotation.x = Math.PI / 2;
    ringGroup.add(outerRing);

    // Position at planet
    ringGroup.position.copy(planet.position);

    this.scene.add(ringGroup);
    this.orbitLockRing = ringGroup;
  }

  /**
   * Create 3D orbit lock label sprite in scene
   */
  createOrbitLockLabel(planet) {
    // Remove existing label if any
    if (this.orbitLockLabel) {
      this.scene.remove(this.orbitLockLabel);
      this.orbitLockLabel = null;
    }

    // Create canvas for label
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 256;

    // Function to update canvas text
    this.updateOrbitLockLabelCanvas = (planetName, distance, radius, status) => {
      // Clear canvas
      context.clearRect(0, 0, canvas.width, canvas.height);

      // Background
      context.fillStyle = 'rgba(0, 0, 0, 0.9)';
      context.strokeStyle = '#00ddff';
      context.lineWidth = 4;
      const padding = 10;
      context.fillRect(padding, padding, canvas.width - padding * 2, canvas.height - padding * 2);
      context.strokeRect(padding, padding, canvas.width - padding * 2, canvas.height - padding * 2);

      // Header
      context.fillStyle = '#00ddff';
      context.font = 'bold 24px Courier New';
      context.fillText('◉ ORBIT LOCK', 30, 50);

      // Planet name
      context.fillStyle = '#00ffaa';
      context.font = 'bold 28px Courier New';
      context.fillText(planetName, 30, 90);

      // Stats
      context.fillStyle = '#888';
      context.font = '18px Courier New';
      context.fillText('DIST:', 30, 130);
      context.fillStyle = '#00ddff';
      context.font = 'bold 18px Courier New';
      context.fillText(distance, 120, 130);

      context.fillStyle = '#888';
      context.font = '18px Courier New';
      context.fillText('RADIUS:', 30, 160);
      context.fillStyle = '#00ddff';
      context.font = 'bold 18px Courier New';
      context.fillText(radius, 140, 160);

      context.fillStyle = '#888';
      context.font = '18px Courier New';
      context.fillText('STATUS:', 30, 190);
      context.fillStyle = status === 'READY' ? '#00ff9f' : '#ffaa00';
      context.font = 'bold 18px Courier New';
      context.fillText(status, 140, 190);

      // Update texture
      if (this.orbitLockTexture) {
        this.orbitLockTexture.needsUpdate = true;
      }
    };

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    this.orbitLockTexture = texture;

    // Create sprite material
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    // Create sprite
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(100, 50, 1);

    // Position above planet
    const offset = 50;
    sprite.position.set(
      planet.position.x,
      planet.position.y + offset,
      planet.position.z
    );

    this.scene.add(sprite);
    this.orbitLockLabel = sprite;

    // Initial update
    const planetName = planet.userData.title || 'Unknown Planet';
    const distance = this.playerShip.position.distanceTo(planet.position);
    this.updateOrbitLockLabelCanvas(planetName, distance.toFixed(0) + 'm', this.orbitLockRadius.toFixed(0) + 'm', 'MAINTAINING');

    this.orbitLockPanelVisible = true;
  }

  /**
   * Hide orbit lock label
   */
  hideOrbitLockPanel() {
    if (this.orbitLockLabel) {
      this.scene.remove(this.orbitLockLabel);
      this.orbitLockLabel = null;
    }
    this.orbitLockPanelVisible = false;
  }

  /**
   * Update orbit lock label info
   */
  updateOrbitLockPanel() {
    if (!this.orbitLockPanelVisible || !this.orbitLockTarget || !this.updateOrbitLockLabelCanvas) return;

    const distance = this.playerShip.position.distanceTo(this.orbitLockTarget.position);
    const planetName = this.orbitLockTarget.userData.title || 'Unknown Planet';
    const status = distance < 500 ? 'READY' : 'MAINTAINING';

    this.updateOrbitLockLabelCanvas(planetName, distance.toFixed(0) + 'm', this.orbitLockRadius.toFixed(0) + 'm', status);

    // Update sprite position to follow planet
    if (this.orbitLockLabel && this.orbitLockTarget) {
      const offset = 50;
      this.orbitLockLabel.position.set(
        this.orbitLockTarget.position.x,
        this.orbitLockTarget.position.y + offset,
        this.orbitLockTarget.position.z
      );
    }
  }

  /**
   * Create star gravity notification HUD (THREE.js sprite)
   */
  createStarGravityNotification() {
    // Create canvas for label
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 128;

    // Function to update canvas text
    this.updateStarGravityCanvas = () => {
      // Clear canvas
      context.clearRect(0, 0, canvas.width, canvas.height);

      // Background
      context.fillStyle = 'rgba(0, 0, 0, 0.9)';
      context.strokeStyle = '#ff6b6b';
      context.lineWidth = 4;
      const padding = 10;
      context.fillRect(padding, padding, canvas.width - padding * 2, canvas.height - padding * 2);
      context.strokeRect(padding, padding, canvas.width - padding * 2, canvas.height - padding * 2);

      // Warning icon and text
      context.fillStyle = '#ff6b6b';
      context.font = 'bold 24px Courier New';
      context.fillText('⚠ STAR GRAVITY', 30, 50);

      context.fillStyle = '#ffaa00';
      context.font = '18px Courier New';
      context.fillText('The star system is pulling us in.', 30, 85);

      // Update texture
      if (this.starGravityTexture) {
        this.starGravityTexture.needsUpdate = true;
      }
    };

    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    this.starGravityTexture = texture;

    // Create sprite material
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    // Create sprite
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(100, 25, 1);

    // Position near ship (upper left area)
    sprite.position.set(
      this.playerShip.position.x - 80,
      this.playerShip.position.y + 40,
      this.playerShip.position.z
    );

    this.scene.add(sprite);
    this.starGravityLabel = sprite;

    // Create line to star center
    const lineGeometry = new THREE.BufferGeometry();
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xff6b6b,
      linewidth: 2,
      transparent: true,
      opacity: 0.6
    });

    const starCenter = new THREE.Vector3(0, 0, 0);
    const points = [
      sprite.position.clone(),
      starCenter
    ];
    lineGeometry.setFromPoints(points);

    this.starGravityLine = new THREE.Line(lineGeometry, lineMaterial);
    this.scene.add(this.starGravityLine);

    // Initial update
    this.updateStarGravityCanvas();
  }

  /**
   * Hide star gravity notification
   */
  hideStarGravityNotification() {
    if (this.starGravityLabel) {
      this.scene.remove(this.starGravityLabel);
      this.starGravityLabel = null;
    }
    if (this.starGravityLine) {
      this.scene.remove(this.starGravityLine);
      this.starGravityLine = null;
    }
  }

  /**
   * Update star gravity notification position
   */
  updateStarGravityNotification() {
    if (!this.starGravityLabel) return;

    // Position near ship
    this.starGravityLabel.position.set(
      this.playerShip.position.x - 80,
      this.playerShip.position.y + 40,
      this.playerShip.position.z
    );

    // Flicker opacity effect (0.4 to 1.0)
    const time = Date.now() / 1000;
    const flickerSpeed = 3; // Flickers per second
    const opacity = 0.4 + Math.abs(Math.sin(time * flickerSpeed)) * 0.6;
    this.starGravityLabel.material.opacity = opacity;

    // Update line to star center with matching opacity
    if (this.starGravityLine) {
      const starCenter = new THREE.Vector3(0, 0, 0);
      const points = [
        this.starGravityLabel.position.clone(),
        starCenter
      ];
      this.starGravityLine.geometry.setFromPoints(points);
      this.starGravityLine.material.opacity = opacity * 0.6; // Line slightly more transparent
    }
  }

  /**
   * Set autopilot destination
   */
  setAutopilotTarget(target) {
    this.trajectoryTarget = target.clone();
    this.autopilotActive = true;

    // Remove old trajectory line
    if (this.trajectoryLine) {
      this.scene.remove(this.trajectoryLine);
    }

    // Create visual trajectory line
    const points = [
      this.playerShip.position.clone(),
      this.trajectoryTarget.clone()
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: 0x00ffaa,
      dashSize: 10,
      gapSize: 5,
      linewidth: 2
    });
    this.trajectoryLine = new THREE.Line(geometry, material);
    this.trajectoryLine.computeLineDistances();
    this.scene.add(this.trajectoryLine);
  }

  /**
   * Update autopilot system
   */
  updateAutopilot(deltaTime) {
    if (!this.autopilotActive || !this.trajectoryTarget) return;

    const toTarget = new THREE.Vector3().subVectors(this.trajectoryTarget, this.playerShip.position);
    const distance = toTarget.length();

    // Arrived at destination (within 10 units)
    if (distance < 10) {
      this.autopilotActive = false;
      console.log('✅ Destination reached!');

      // Remove trajectory line
      if (this.trajectoryLine) {
        this.scene.remove(this.trajectoryLine);
        this.trajectoryLine = null;
      }
      return;
    }

    // Point ship at target
    const direction = toTarget.normalize();

    // Calculate target rotation to face the direction
    const targetQuaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const matrix = new THREE.Matrix4();
    matrix.lookAt(this.playerShip.position, this.trajectoryTarget, up);
    targetQuaternion.setFromRotationMatrix(matrix);

    // Smoothly rotate ship toward target
    if (this.shipMesh) {
      this.shipMesh.quaternion.slerp(targetQuaternion, 0.05); // Smooth rotation
    }

    // Fire center rear thruster (S key equivalent)
    this.keys['s'] = true; // Simulate S key press for center thrust

    // Update trajectory line start point
    if (this.trajectoryLine) {
      const positions = this.trajectoryLine.geometry.attributes.position.array;
      positions[0] = this.playerShip.position.x;
      positions[1] = this.playerShip.position.y;
      positions[2] = this.playerShip.position.z;
      this.trajectoryLine.geometry.attributes.position.needsUpdate = true;
      this.trajectoryLine.computeLineDistances();
    }
  }

  /**
   * Update projectiles
   */
  updateProjectiles(deltaTime) {
    const now = Date.now() / 1000;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];

      // Update position
      proj.position.add(proj.velocity.clone().multiplyScalar(deltaTime));
      proj.mesh.position.copy(proj.position);

      // Check lifetime
      if (now - proj.createdAt > proj.lifetime) {
        this.projectileGroup.remove(proj.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }

      // Check enemy collisions
      for (let j = 0; j < this.enemies.length; j++) {
        const enemy = this.enemies[j];
        const dist = proj.position.distanceTo(enemy.position);

        if (dist < 5) {
          // Hit!
          this.damageEnemy(enemy, proj.damage);
          this.projectileGroup.remove(proj.mesh);
          this.projectiles.splice(i, 1);
          break;
        }
      }
    }
  }

  /**
   * Damage an enemy
   */
  damageEnemy(enemy, damage) {
    enemy.shields -= damage;

    if (enemy.shields < 0) {
      enemy.hull += enemy.shields; // Overflow to hull
      enemy.shields = 0;
    }

    console.log(`💥 Enemy hit! Hull: ${enemy.hull}, Shields: ${enemy.shields}`);

    if (enemy.hull <= 0) {
      this.destroyEnemy(enemy);
    }
  }

  /**
   * Destroy enemy ship
   */
  destroyEnemy(enemy) {
    console.log('💥 Enemy destroyed!');
    this.enemyGroup.remove(enemy.mesh);
    const index = this.enemies.indexOf(enemy);
    if (index > -1) {
      this.enemies.splice(index, 1);
    }

    if (this.targetedEnemy === enemy) {
      this.targetedEnemy = null;
      // Remove reticle
      if (this.targetReticle) {
        this.scene.remove(this.targetReticle);
        this.targetReticle = null;
      }
    }
  }

  /**
   * Apply star gravity pulse system
   * Unique physics: short pulse pulls ship back toward system edge at max 200m/s
   */
  applyStarGravity(deltaTime) {
    // Initialize gravity pulse tracking if not exists
    if (!this.gravityPulse) {
      this.gravityPulse = {
        active: false,
        cooldown: 0,
        duration: 2.0, // 2 second pulse
        cooldownTime: 3.0, // 3 second cooldown between pulses
        timer: 0
      };
    }

    // Find the star (center of system at 0,0,0)
    const starPosition = new THREE.Vector3(0, 0, 0);

    // Find furthest planet orbit radius (cached for performance)
    if (!this.systemBoundary) {
      let maxOrbitRadius = 0;
      if (this.galacticMap && this.galacticMap.assets) {
        this.galacticMap.assets.forEach(asset => {
          if (asset.mesh && asset.mesh.userData.type === 'planet') {
            const distanceFromStar = asset.mesh.position.length();
            if (distanceFromStar > maxOrbitRadius) {
              maxOrbitRadius = distanceFromStar;
            }
          }
        });
      }
      // Default to 75000 if no planets found
      if (maxOrbitRadius === 0) {
        maxOrbitRadius = 75000;
      }
      this.systemBoundary = maxOrbitRadius;
    }

    // Calculate distance from star
    const distanceFromStar = this.playerShip.position.length();

    // Update pulse cooldown
    if (this.gravityPulse.cooldown > 0) {
      this.gravityPulse.cooldown -= deltaTime;
    }

    // Check if beyond system boundary
    const beyondBoundary = distanceFromStar > this.systemBoundary;

    // Activate pulse if beyond boundary and not on cooldown
    if (beyondBoundary && !this.gravityPulse.active && this.gravityPulse.cooldown <= 0) {
      this.gravityPulse.active = true;
      this.gravityPulse.timer = 0;
      // Show gravity notification
      if (!this.starGravityLabel) {
        this.createStarGravityNotification();
      }
    }

    // Apply pulse if active
    if (this.gravityPulse.active) {
      this.gravityPulse.timer += deltaTime;

      // Direction from ship toward system edge (not star center)
      const directionToStar = starPosition.clone().sub(this.playerShip.position).normalize();
      const targetPosition = directionToStar.multiplyScalar(this.systemBoundary);
      const pullDirection = targetPosition.sub(this.playerShip.position).normalize();

      // Calculate target velocity (750m/s toward system edge)
      const maxPullSpeed = 750; // m/s
      const targetVelocity = pullDirection.multiplyScalar(maxPullSpeed);

      // Smoothly transition velocity toward target (ease in/out)
      const pulseProgress = this.gravityPulse.timer / this.gravityPulse.duration;
      const easeInOut = pulseProgress < 0.5
        ? 2 * pulseProgress * pulseProgress // Ease in
        : 1 - Math.pow(-2 * pulseProgress + 2, 2) / 2; // Ease out

      // Blend current velocity with target velocity (don't stack, replace component)
      const blendFactor = easeInOut * 0.15; // 15% blend per frame at peak
      this.playerShip.velocity.lerp(targetVelocity, blendFactor * deltaTime * 60); // Normalized to 60fps

      // Update G-force display
      const gravityForce = targetVelocity.clone().multiplyScalar(blendFactor);
      this.gForces.gravity.copy(gravityForce);

      // Update notification position
      this.updateStarGravityNotification();

      // End pulse after duration
      if (this.gravityPulse.timer >= this.gravityPulse.duration) {
        this.gravityPulse.active = false;
        this.gravityPulse.cooldown = this.gravityPulse.cooldownTime;
        this.gForces.gravity.set(0, 0, 0);
        // Hide notification after pulse ends
        this.hideStarGravityNotification();
      }
    } else if (!beyondBoundary) {
      // Inside boundary - reset pulse system
      this.gravityPulse.active = false;
      this.gravityPulse.cooldown = 0;
      this.gForces.gravity.set(0, 0, 0);
      // Hide notification
      this.hideStarGravityNotification();
    }
  }

  /**
   * Regenerate shields and energy
   */
  updateRegeneration(deltaTime) {
    // Shield regen
    if (this.playerShip.shields < this.playerShip.shieldsMax) {
      this.playerShip.shields += this.playerShip.shieldRechargeRate * deltaTime;
      this.playerShip.shields = Math.min(this.playerShip.shields, this.playerShip.shieldsMax);
    }

    // Energy regen
    if (this.playerShip.energy < this.playerShip.energyMax) {
      this.playerShip.energy += this.playerShip.energyRechargeRate * deltaTime;
      this.playerShip.energy = Math.min(this.playerShip.energy, this.playerShip.energyMax);
    }
  }

  /**
   * Main animation loop
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    const deltaTime = this.clock.getDelta();

    // Update warp cooldown
    if (this.warpCooldown > 0) {
      this.warpCooldown -= deltaTime;
      if (this.warpCooldown < 0) this.warpCooldown = 0;
    }

    // Maintain locked thrust if active
    if (this.thrustLocked) {
      Object.keys(this.lockedThrust).forEach(key => {
        this.keys[key] = this.lockedThrust[key];
      });
    }

    // Check for manual control BEFORE autopilot updates (but not if thrust locked)
    const manualControl = !this.thrustLocked && (
      this.keys['w'] || this.keys['s'] || this.keys['a'] ||
      this.keys['d'] || this.keys['q'] || this.keys['e'] ||
      this.keys['z'] || this.keys['c']
    );

    if (manualControl && this.autopilotActive) {
      this.autopilotActive = false; // Manual control disables autopilot
      if (this.trajectoryLine) {
        this.scene.remove(this.trajectoryLine);
        this.trajectoryLine = null;
      }
    }

    // Update autopilot (will set keys['s'] if active)
    this.updateAutopilot(deltaTime);

    // Update thrust from controls
    this.updateThrust(deltaTime);

    // Apply star gravity (keeps ships from escaping too far)
    this.applyStarGravity(deltaTime);

    // Clear autopilot key after thrust update
    if (this.autopilotActive && this.keys['s']) {
      // Only clear if it was set by autopilot (no manual input)
      if (!manualControl) {
        this.keys['s'] = false;
      }
    }
    this.updateRegeneration(deltaTime);

    // Update ship mesh
    if (this.shipMesh) {
      this.shipMesh.position.copy(this.playerShip.position);

      // Apply ship rotation (yaw, pitch, roll)
      this.shipMesh.rotation.set(
        this.playerShip.pitch,
        this.playerShip.yaw,
        this.playerShip.roll,
        'YXZ' // Rotation order: Yaw -> Pitch -> Roll
      );
    }

    // Update wingtip flashing lights (alternating flash)
    if (this.leftWingtipLight && this.rightWingtipLight) {
      const flashSpeed = 2; // Flashes per second
      const time = Date.now() / 1000;
      const flashPhase = (time * flashSpeed) % 2;

      if (flashPhase < 1) {
        // Left on, right off
        this.leftWingtipLight.material.opacity = 1;
        this.rightWingtipLight.material.opacity = 0.2;
      } else {
        // Right on, left off
        this.leftWingtipLight.material.opacity = 0.2;
        this.rightWingtipLight.material.opacity = 1;
      }
    }

    // Update projectiles
    this.updateProjectiles(deltaTime);

    // Update target reticle position
    if (this.targetReticle && this.targetedEnemy) {
      this.targetReticle.position.copy(this.targetedEnemy.position);
      this.targetReticle.lookAt(this.camera.position); // Face camera
      this.targetReticle.rotation.z += deltaTime; // Rotate for effect
    } else if (this.targetReticle) {
      this.scene.remove(this.targetReticle);
      this.targetReticle = null;
    }

    // Update HUD
    this.updateHUD();

    // Update orbit lock label
    this.updateOrbitLockPanel();

    // Orbiting camera system with spherical coordinates
    if (this.camera && this.shipMesh) {
      // Spherical coordinates:
      // theta = horizontal angle (around Y-axis)
      // phi = vertical angle (pitch from horizon)
      // radius = distance from ship

      const theta = this.cameraOrbitAngle;
      const phi = this.cameraOrbitPitch;
      const radius = this.cameraOrbitDistance;

      // Convert to Cartesian (standard spherical coordinate system)
      // Y is up, XZ is the horizontal plane
      const x = radius * Math.sin(phi) * Math.sin(theta);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(phi) * Math.cos(theta);

      const targetPos = new THREE.Vector3(
        this.playerShip.position.x + x,
        this.playerShip.position.y + y,
        this.playerShip.position.z + z
      );

      // Direct positioning (no lerp) for immediate response
      this.camera.position.copy(targetPos);

      // Always look at ship
      this.camera.lookAt(this.playerShip.position);
    }

    // Render the scene
    if (this.galacticMap && this.galacticMap.renderer) {
      this.galacticMap.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Spawn enemy ship
   */
  spawnEnemy(position) {
    const enemy = {
      position: position.clone(),
      velocity: new THREE.Vector3(0, 0, 0),
      hull: 50,
      hullMax: 50,
      shields: 50,
      shieldsMax: 50
    };

    // Create enemy mesh (red)
    const geometry = new THREE.ConeGeometry(2, 6, 4);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      metalness: 0.7,
      roughness: 0.3,
      emissive: 0xaa0000,
      emissiveIntensity: 0.5
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position);
    this.enemyGroup.add(mesh);
    enemy.mesh = mesh;

    this.enemies.push(enemy);
    console.log('👾 Enemy spawned!');
    return enemy;
  }
}

// Export for use in system-map-3d
window.SpaceCombatSystem = SpaceCombatSystem;
