/**
 * Optimized Galactic Map Renderer
 * Reduced clutter, proper drag, 4 main factions, asset-driven updates
 */

class GalacticMap {
  constructor(canvasId, width = 5000, height = 5000) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.width = width;
    this.height = height;
    this.scale = 0.3; // Start zoomed out to see larger grid
    this.offsetX = 0;
    this.offsetY = 0;

    // Set canvas dimensions
    this.canvas.width = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;

    // Dragging state
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.lastOffsetX = 0;
    this.lastOffsetY = 0;
    this.dragThreshold = 10; // Pixels moved before considered a drag

    // Touch/pinch state
    this.touches = [];
    this.lastPinchDistance = 0;
    this.touchStartTime = 0;
    this.touchStartPos = { x: 0, y: 0 };

    // Faction centers and zones
    this.factionCenters = [];
    this.publishedAssets = []; // Assets that appear as zones
    this.stars = [];

    // Characters
    this.characters = []; // All characters in galactic space
    this.currentCharacter = null; // Selected character for this session
    this.hoveredCharacter = null;

    // Mouse interaction
    this.hoveredAsset = null;
    this.selectedAsset = null;

    // Only 4 main factions (excluding Independent Systems)
    this.mainFactions = [
      'Silicate Consortium',
      'Lantern Collective',
      'Devan Empire',
      'Human Federation'
    ];

    // Colors for factions
    this.factionColors = {
      'Silicate Consortium': '#667eea',
      'Lantern Collective': '#f59e0b',
      'Devan Empire': '#ef4444',
      'Human Federation': '#10b981'
    };

    // Performance settings
    this.showGrid = false;
    this.showConnections = true; // Show travel routes by default
    this.fps = 30; // Lower frame rate
    this.lastFrameTime = 0;

    // Admin-controlled settings
    this.movementSpeed = 0.1; // Default to very slow (0.1x)
    this.gridSize = 100;
    this.brownNoiseStrength = 0.05;
    this.brownNoiseFrequency = 0.5;
    this.brownNoiseEnabled = true;

    // Brown noise state
    this.brownNoiseTime = 0;
    this.brownNoiseOffset = Math.random() * 1000; // Random phase offset

    // Travel animation state
    this.isTraveling = false;
    this.travelPath = [];
    this.currentLeg = 0;
    this.travelProgress = 0;
    this.travelStartTime = 0;
    this.legDuration = 15000; // 15 seconds per leg
    this.travelStartPos = { x: 0, y: 0 };
    this.travelEndPos = { x: 0, y: 0 };

    // Spatial service integration
    this.spatialServiceUrl = 'https://svc.madladslab.com';
    this.travelConnections = [];
    this.maxTravelDistance = 300; // Maximum distance for travel routes

    this.initStarfield();
    this.setupEventListeners();
  }

  /**
   * Initialize starfield background (reduced count)
   */
  initStarfield() {
    const starCount = 750; // More stars for larger grid (5000x5000)
    const starChars = ['·', '•', '*', '+'];

    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: Math.random() * 1.5 + 0.5,
        char: starChars[Math.floor(Math.random() * starChars.length)],
        brightness: Math.random() * 0.4 + 0.3,
        twinkleSpeed: Math.random() * 0.01 + 0.005
      });
    }
  }

  /**
   * Setup mouse and touch event listeners
   */
  setupEventListeners() {
    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });

    // Resize
    window.addEventListener('resize', () => this.handleResize());
  }

  /**
   * Handle mouse down - start dragging
   */
  handleMouseDown(e) {
    this.isDragging = true;
    const rect = this.canvas.getBoundingClientRect();
    this.dragStartX = e.clientX - rect.left;
    this.dragStartY = e.clientY - rect.top;
    this.lastOffsetX = this.offsetX;
    this.lastOffsetY = this.offsetY;
    this.canvas.style.cursor = 'grabbing';
  }

  /**
   * Handle mouse move - drag or hover
   */
  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();

    if (this.isDragging) {
      // Update pan offset
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;
      this.offsetX = this.lastOffsetX + (currentX - this.dragStartX);
      this.offsetY = this.lastOffsetY + (currentY - this.dragStartY);
    } else {
      // Check hover
      const x = (e.clientX - rect.left - this.offsetX) / this.scale;
      const y = (e.clientY - rect.top - this.offsetY) / this.scale;
      this.hoveredAsset = this.getAssetAt(x, y);
      this.canvas.style.cursor = this.hoveredAsset ? 'pointer' : 'grab';
    }
  }

  /**
   * Handle mouse up - end dragging
   */
  handleMouseUp(e) {
    this.isDragging = false;
    this.canvas.style.cursor = 'grab';
  }

  /**
   * Handle click for selection
   */
  handleClick(e) {
    if (!this.isDragging) {
      // Get all assets at click position
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - this.offsetX) / this.scale;
      const y = (e.clientY - rect.top - this.offsetY) / this.scale;

      const assets = this.getAssetsAt(x, y);

      if (assets && assets.length > 0) {
        this.selectedAsset = assets[0];
        // Pass assets array and screen coordinates for menu positioning
        this.onAssetSelect?.(assets, e.clientX, e.clientY);
      }
    }
  }

  /**
   * Handle mouse wheel for zoom
   */
  handleWheel(e) {
    e.preventDefault();

    // Get mouse position relative to canvas
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Get world position before zoom
    const worldX = (mouseX - this.offsetX) / this.scale;
    const worldY = (mouseY - this.offsetY) / this.scale;

    // Apply zoom
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const oldScale = this.scale;
    this.scale *= delta;
    this.scale = Math.max(0.1, Math.min(5, this.scale)); // Allow 0.1x to 5x zoom for larger grid

    // Adjust offset to keep world position under mouse
    this.offsetX = mouseX - worldX * this.scale;
    this.offsetY = mouseY - worldY * this.scale;

    // Update last offsets for dragging
    this.lastOffsetX = this.offsetX;
    this.lastOffsetY = this.offsetY;
  }

  /**
   * Handle touch start - begin drag or pinch
   */
  handleTouchStart(e) {
    e.preventDefault();
    this.touches = Array.from(e.touches);

    if (this.touches.length === 1) {
      // Single touch - track start position for tap detection
      const touch = this.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      this.touchStartTime = Date.now();
      this.touchStartPos = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      };
      this.dragStartX = touch.clientX - rect.left;
      this.dragStartY = touch.clientY - rect.top;
      this.lastOffsetX = this.offsetX;
      this.lastOffsetY = this.offsetY;
      // Don't set isDragging yet - wait for movement
    } else if (this.touches.length === 2) {
      // Two fingers - prepare for pinch
      this.lastPinchDistance = this.getPinchDistance();
      this.isDragging = false;
    }
  }

  /**
   * Handle touch move - drag or pinch zoom
   */
  handleTouchMove(e) {
    e.preventDefault();
    this.touches = Array.from(e.touches);

    if (this.touches.length === 1) {
      // Single touch - check if moved enough to be a drag
      const touch = this.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const currentX = touch.clientX - rect.left;
      const currentY = touch.clientY - rect.top;

      // Calculate distance moved
      const dx = currentX - this.touchStartPos.x;
      const dy = currentY - this.touchStartPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // If moved more than threshold, it's a drag
      if (distance > this.dragThreshold) {
        this.isDragging = true;
      }

      if (this.isDragging) {
        this.offsetX = this.lastOffsetX + (currentX - this.dragStartX);
        this.offsetY = this.lastOffsetY + (currentY - this.dragStartY);
      }
    } else if (this.touches.length === 2) {
      // Pinch zoom - anchor to center of pinch
      const currentDistance = this.getPinchDistance();

      if (this.lastPinchDistance > 0) {
        // Get center point of pinch
        const rect = this.canvas.getBoundingClientRect();
        const centerX = ((this.touches[0].clientX + this.touches[1].clientX) / 2) - rect.left;
        const centerY = ((this.touches[0].clientY + this.touches[1].clientY) / 2) - rect.top;

        // Get world position before zoom
        const worldX = (centerX - this.offsetX) / this.scale;
        const worldY = (centerY - this.offsetY) / this.scale;

        // Apply zoom
        const delta = currentDistance / this.lastPinchDistance;
        this.scale *= delta;
        this.scale = Math.max(0.1, Math.min(5, this.scale));

        // Adjust offset to keep world position under pinch center
        this.offsetX = centerX - worldX * this.scale;
        this.offsetY = centerY - worldY * this.scale;

        // Update last offsets
        this.lastOffsetX = this.offsetX;
        this.lastOffsetY = this.offsetY;
      }

      this.lastPinchDistance = currentDistance;
      this.isDragging = false;
    }
  }

  /**
   * Handle touch end - check for tap or end drag
   */
  handleTouchEnd(e) {
    e.preventDefault();

    const lastTouch = e.changedTouches[0];
    const touchDuration = Date.now() - this.touchStartTime;

    // Check for tap (not dragging and quick touch)
    if (!this.isDragging && touchDuration < 300 && lastTouch) {
      const rect = this.canvas.getBoundingClientRect();
      const canvasX = lastTouch.clientX - rect.left;
      const canvasY = lastTouch.clientY - rect.top;

      // Transform to world coordinates
      const worldX = (canvasX - this.offsetX) / this.scale;
      const worldY = (canvasY - this.offsetY) / this.scale;

      // Get all assets at tap position
      const assets = this.getAssetsAt(worldX, worldY);

      if (assets && assets.length > 0) {
        this.selectedAsset = assets[0];
        console.log(`✓ Asset(s) tapped: ${assets.map(a => a.title).join(', ')} (${assets.length} total)`);
        // Call the selection callback with screen coordinates
        if (this.onAssetSelect) {
          this.onAssetSelect(assets, lastTouch.clientX, lastTouch.clientY);
        }
      } else {
        console.log('✗ No asset at tap location:', Math.round(worldX), Math.round(worldY));
      }
    }

    this.touches = Array.from(e.touches);
    if (this.touches.length === 0) {
      this.isDragging = false;
      this.lastPinchDistance = 0;
    }
  }

  /**
   * Get distance between two touch points (for pinch zoom)
   */
  getPinchDistance() {
    if (this.touches.length < 2) return 0;

    const dx = this.touches[0].clientX - this.touches[1].clientX;
    const dy = this.touches[0].clientY - this.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Handle canvas resize
   */
  handleResize() {
    this.canvas.width = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;
  }

  /**
   * Get asset at coordinates (returns first match)
   */
  getAssetAt(x, y) {
    for (let i = this.publishedAssets.length - 1; i >= 0; i--) {
      const asset = this.publishedAssets[i];
      const dx = x - asset.x;
      const dy = y - asset.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < asset.radius) {
        return asset;
      }
    }
    return null;
  }

  /**
   * Get ALL assets at coordinates (for overlapping detection)
   */
  getAssetsAt(x, y) {
    const matches = [];

    for (let i = this.publishedAssets.length - 1; i >= 0; i--) {
      const asset = this.publishedAssets[i];
      const dx = x - asset.x;
      const dy = y - asset.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < asset.radius) {
        matches.push(asset);
      }
    }

    return matches;
  }

  /**
   * Update faction centers from game state (4 factions only)
   */
  updateFactionCenters(factions) {
    this.factionCenters = [];

    this.mainFactions.forEach((name, index) => {
      const faction = factions[name];
      if (!faction) return;

      // Position in corners/center pattern
      const positions = [
        { x: this.width * 0.25, y: this.height * 0.25 }, // Top-left
        { x: this.width * 0.75, y: this.height * 0.25 }, // Top-right
        { x: this.width * 0.25, y: this.height * 0.75 }, // Bottom-left
        { x: this.width * 0.75, y: this.height * 0.75 }  // Bottom-right
      ];

      const pos = positions[index];

      this.factionCenters.push({
        name: name,
        x: pos.x,
        y: pos.y,
        power: faction.power,
        territory: faction.territory,
        influence: faction.influence,
        radius: 30 + (faction.power / 100) * 20,
        color: this.factionColors[name]
      });
    });
  }

  /**
   * Load published assets from API
   */
  async loadPublishedAssets() {
    try {
      const response = await fetch('/api/v1/assets/approved/list');
      if (!response.ok) return;

      const data = await response.json();
      if (data.success && data.assets) {
        await this.updatePublishedAssets(data.assets);
      }
    } catch (error) {
      console.error('Error loading published assets:', error);
    }
  }

  /**
   * Load admin settings for map
   */
  async loadSettings() {
    try {
      const response = await fetch('/admin/api/galactic-map/settings');
      if (!response.ok) return;

      const data = await response.json();
      if (data.success && data.settings) {
        this.movementSpeed = data.settings.movementSpeed || 0.1;
        this.gridSize = data.settings.gridSize || 100;
        this.edgeGravityStrength = data.settings.edgeGravityStrength || 0.15;
        this.edgeGravityDistance = data.settings.edgeGravityDistance || 400;
        this.staticChargeBuildup = data.settings.staticChargeBuildup || 0.02;
        this.staticGravityThreshold = data.settings.staticGravityThreshold || 1.0;
        this.maxVelocity = data.settings.maxVelocity || 8;
        this.damping = data.settings.damping || 0.999;
        this.brownNoiseStrength = data.settings.brownNoiseStrength !== undefined ? data.settings.brownNoiseStrength : 0.05;
        this.brownNoiseFrequency = data.settings.brownNoiseFrequency !== undefined ? data.settings.brownNoiseFrequency : 0.5;
        this.brownNoiseEnabled = data.settings.brownNoiseEnabled !== undefined ? data.settings.brownNoiseEnabled : true;
      }
    } catch (error) {
      console.error('Error loading map settings:', error);
    }
  }

  /**
   * Load spatial positions from game state service
   */
  async loadSpatialPositions() {
    try {
      const response = await fetch(`${this.spatialServiceUrl}/api/spatial/assets`);
      if (!response.ok) return null;

      const data = await response.json();
      if (data.success && data.assets) {
        return data.assets;
      }
    } catch (error) {
      console.error('Error loading spatial positions:', error);
    }
    return null;
  }

  /**
   * Save spatial positions to game state service
   */
  async saveSpatialPositions() {
    try {
      const assets = this.publishedAssets.map(asset => ({
        _id: asset._id,
        title: asset.title,
        assetType: asset.assetType,
        x: asset.x,
        y: asset.y,
        vx: asset.vx,
        vy: asset.vy,
        radius: asset.radius,
        isStationary: asset.isStationary
      }));

      const response = await fetch(`${this.spatialServiceUrl}/api/spatial/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets })
      });

      if (!response.ok) {
        console.warn('Failed to save spatial positions');
      }
    } catch (error) {
      console.error('Error saving spatial positions:', error);
    }
  }

  /**
   * Generate local travel connections based on actual asset positions
   */
  async loadTravelConnections() {
    // Generate travel routes based on actual orbital and hub positions
    this.travelConnections = this.generateTravelRoutes();
  }

  /**
   * Generate travel routes with TRAJECTORY-BASED color coding
   * BLUE = converging (objects getting closer)
   * GREEN = stable (maintaining distance)
   * RED = breaking (objects moving apart, link will snap)
   */
  generateTravelRoutes() {
    const connections = [];
    const assets = this.publishedAssets;

    const MAX_CONNECTION_DISTANCE = 800; // Reduced for easier breaking
    const CRITICAL_DISTANCE = 650; // Warning threshold
    const FUTURE_PREDICTION_FRAMES = 50; // Predict 50 frames ahead

    // Calculate current distance
    const distance = (a, b) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Predict future distance based on velocity
    const futureDistance = (a, b) => {
      const futureAX = a.x + (a.vx || 0) * FUTURE_PREDICTION_FRAMES;
      const futureAY = a.y + (a.vy || 0) * FUTURE_PREDICTION_FRAMES;
      const futureBX = b.x + (b.vx || 0) * FUTURE_PREDICTION_FRAMES;
      const futureBY = b.y + (b.vy || 0) * FUTURE_PREDICTION_FRAMES;
      const dx = futureAX - futureBX;
      const dy = futureAY - futureBY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Determine connection status based on trajectory
    const getConnectionStatus = (a, b, currentDist) => {
      const futureDist = futureDistance(a, b);
      const distanceRatio = currentDist / MAX_CONNECTION_DISTANCE;

      // RED: Link approaching break distance
      if (currentDist > CRITICAL_DISTANCE || futureDist > MAX_CONNECTION_DISTANCE) {
        const criticalityRatio = (currentDist - CRITICAL_DISTANCE) / (MAX_CONNECTION_DISTANCE - CRITICAL_DISTANCE);
        return {
          status: 'breaking',
          stability: Math.max(0.1, 1 - criticalityRatio),
          willBreak: futureDist > MAX_CONNECTION_DISTANCE
        };
      }

      // BLUE: Objects getting closer (converging trajectories)
      if (futureDist < currentDist - 5) {
        const closingSpeed = (currentDist - futureDist) / FUTURE_PREDICTION_FRAMES;
        const convergenceStrength = Math.min(1, closingSpeed / 2);
        return {
          status: 'converging',
          stability: 0.6 + (convergenceStrength * 0.3)
        };
      }

      // GREEN: Stable distance (parallel trajectories)
      return {
        status: 'stable',
        stability: 0.5 + (0.5 * (1 - distanceRatio))
      };
    };

    // Connect ALL nearby assets within range (distance-based connections)
    for (let i = 0; i < assets.length; i++) {
      for (let j = i + 1; j < assets.length; j++) {
        const a = assets[i];
        const b = assets[j];
        const dist = distance(a, b);

        // Only connect if within max distance
        if (dist < MAX_CONNECTION_DISTANCE) {
          const connectionInfo = getConnectionStatus(a, b, dist);

          connections.push({
            fromX: a.x,
            fromY: a.y,
            toX: b.x,
            toY: b.y,
            fromAsset: a,
            toAsset: b,
            distance: dist,
            ...connectionInfo
          });
        }
      }
    }

    return connections;
  }

  /**
   * Update published assets display - only galaxy, orbital, anomaly
   * PERPETUAL: Maintains existing positions, only adds new assets
   */
  async updatePublishedAssets(assets, forceRandomize = false) {
    // Filter to only show galaxy, orbital, and anomaly types
    const validTypes = ['galaxy', 'orbital', 'anomaly'];
    const filteredAssets = assets.filter(asset =>
      validTypes.includes(asset.assetType)
    );

    // Count space hubs
    const hubCount = filteredAssets.filter(a => a.hubData?.isStartingLocation).length;
    console.log(`Loading ${filteredAssets.length} assets (${hubCount} space hubs)`);

    // Try to load existing positions from spatial service (skip if forcing randomization)
    const spatialAssets = forceRandomize ? null : await this.loadSpatialPositions();
    const spatialMap = new Map();
    if (spatialAssets && !forceRandomize) {
      spatialAssets.forEach(sa => spatialMap.set(sa._id, sa));
    }

    // Create a map of current assets to check what's new
    const currentAssetIds = new Set(this.publishedAssets.map(a => a._id));
    const newAssetList = [];

    filteredAssets.forEach((asset, index) => {
      // Check if asset already exists in our current list
      const existingAsset = forceRandomize ? null : this.publishedAssets.find(a => a._id === asset._id);

      if (existingAsset && !forceRandomize) {
        // KEEP EXISTING POSITION - just update metadata
        const isHub = asset.hubData?.isStartingLocation;
        newAssetList.push({
          ...existingAsset,
          title: asset.title,
          description: asset.description,
          votes: asset.votes,
          radius: isHub ? 50 : (8 + (asset.votes || 0) * 0.15), // DECREASED: was 10 + 0.3
          color: this.getFactionColorForAsset(asset)
        });
      } else {
        // Check if we have saved position in SVC
        const savedPosition = spatialMap.get(asset._id);

        if (savedPosition) {
          // Restore from SVC (perpetual!)
          const isHub = asset.hubData?.isStartingLocation;
          newAssetList.push({
            ...asset,
            x: savedPosition.x,
            y: savedPosition.y,
            vx: savedPosition.vx,
            vy: savedPosition.vy,
            radius: isHub ? 50 : (8 + (asset.votes || 0) * 0.15), // DECREASED
            color: this.getFactionColorForAsset(asset),
            mass: 1 + (asset.votes || 0) * 0.1,
            isStationary: savedPosition.isStationary
          });
        } else {
          // Completely new asset - generate initial position
          let x, y, vx, vy, assetRadius, isStationary;

          // Check if this is a space hub with fixed location
          if (asset.hubData?.location) {
            // SPACE HUB - use fixed corner location
            x = asset.hubData.location.x;
            y = asset.hubData.location.y;
            vx = 0;
            vy = 0;
            assetRadius = 50; // Larger for hubs
            isStationary = true;
          } else if (asset.initialPosition) {
            // Asset with predefined position from database
            x = asset.initialPosition.x;
            y = asset.initialPosition.y;

            // Anomalies are stationary, galaxies and orbitals move
            isStationary = asset.assetType === 'anomaly';

            if (isStationary) {
              vx = 0;
              vy = 0;
            } else {
              // Calculate initial velocity for trajectory
              const velocityMagnitude = Math.random() * 0.04 + 0.01;
              const velocityAngle = Math.random() * Math.PI * 2;
              vx = Math.cos(velocityAngle) * velocityMagnitude;
              vy = Math.sin(velocityAngle) * velocityMagnitude;
            }

            assetRadius = 8 + (asset.votes || 0) * 0.15;
          } else {
            // Regular asset - generate fully random position across entire map
            // Use padding to avoid spawning too close to edges
            const padding = 200;
            x = padding + Math.random() * (this.width - padding * 2);
            y = padding + Math.random() * (this.height - padding * 2);

            // Anomalies are stationary, galaxies and orbitals move
            isStationary = asset.assetType === 'anomaly';

            // Calculate initial velocity for trajectory (0 for anomalies)
            const velocityMagnitude = isStationary ? 0 : (Math.random() * 0.04 + 0.01);
            const velocityAngle = Math.random() * Math.PI * 2;

            vx = Math.cos(velocityAngle) * velocityMagnitude;
            vy = Math.sin(velocityAngle) * velocityMagnitude;
            assetRadius = 8 + (asset.votes || 0) * 0.15; // DECREASED: was 10 + 0.3
          }

          newAssetList.push({
            ...asset,
            x,
            y,
            radius: assetRadius,
            color: this.getFactionColorForAsset(asset),
            vx,
            vy,
            mass: 1 + (asset.votes || 0) * 0.1,
            isStationary: isStationary
          });
        }
      }
    });

    this.publishedAssets = newAssetList;

    // Save positions after update
    await this.saveSpatialPositions();
    // Load travel connections
    await this.loadTravelConnections();
  }

  /**
   * Get faction color for an asset
   */
  getFactionColorForAsset(asset) {
    // Could be based on asset creator's faction, or random
    const factionIndex = asset.userId ? asset.userId.charCodeAt(0) % 4 : 0;
    return this.factionColors[this.mainFactions[factionIndex]] || '#667eea';
  }

  /**
   * Update physics for assets - trajectory and movement
   * NEW: Edge gravity and static charge mechanics
   */
  updatePhysics() {
    // Track if we need to save (every 60 frames = ~2 seconds at 30fps)
    if (!this.physicsTicks) this.physicsTicks = 0;
    this.physicsTicks++;

    // Update brown noise time (oscillates over time)
    this.brownNoiseTime += 1 / this.fps; // Increment by frame time

    // Use admin-controlled settings (with fallback defaults)
    const EDGE_GRAVITY_DISTANCE = this.edgeGravityDistance || 400;
    const EDGE_GRAVITY_STRENGTH = this.edgeGravityStrength || 0.15;
    const STATIC_CHARGE_BUILDUP = this.staticChargeBuildup || 0.02;
    const STATIC_DISCHARGE_RATE = 0.005; // Always 1/4 of buildup
    const STATIC_GRAVITY_THRESHOLD = this.staticGravityThreshold || 1.0;

    this.publishedAssets.forEach(asset => {
      // Skip stationary assets (anomalies)
      if (asset.isStationary) return;

      // Initialize static charge if not present
      if (asset.staticCharge === undefined) asset.staticCharge = 0;
      if (asset.touchingEdge === undefined) asset.touchingEdge = false;

      // Apply movement speed multiplier
      const speedMultiplier = this.movementSpeed;

      // Update position based on velocity
      asset.x += asset.vx * speedMultiplier;
      asset.y += asset.vy * speedMultiplier;

      // Calculate distances to edges
      const distToLeft = asset.x - asset.radius;
      const distToRight = this.width - (asset.x + asset.radius);
      const distToTop = asset.y - asset.radius;
      const distToBottom = this.height - (asset.y + asset.radius);
      const minDistToEdge = Math.min(distToLeft, distToRight, distToTop, distToBottom);

      // Check if currently touching edge
      const nowTouchingEdge = minDistToEdge <= 0;

      // EDGE REPULSION - Push AWAY from edges (not towards center)
      // This keeps objects in the playable area without clustering in center
      if (minDistToEdge < EDGE_GRAVITY_DISTANCE && minDistToEdge > 0) {
        let pushX = 0;
        let pushY = 0;

        // Left edge - push right
        if (distToLeft < EDGE_GRAVITY_DISTANCE) {
          const proximity = 1 - (distToLeft / EDGE_GRAVITY_DISTANCE);
          pushX += proximity * EDGE_GRAVITY_STRENGTH * speedMultiplier;
        }
        // Right edge - push left
        if (distToRight < EDGE_GRAVITY_DISTANCE) {
          const proximity = 1 - (distToRight / EDGE_GRAVITY_DISTANCE);
          pushX -= proximity * EDGE_GRAVITY_STRENGTH * speedMultiplier;
        }
        // Top edge - push down
        if (distToTop < EDGE_GRAVITY_DISTANCE) {
          const proximity = 1 - (distToTop / EDGE_GRAVITY_DISTANCE);
          pushY += proximity * EDGE_GRAVITY_STRENGTH * speedMultiplier;
        }
        // Bottom edge - push up
        if (distToBottom < EDGE_GRAVITY_DISTANCE) {
          const proximity = 1 - (distToBottom / EDGE_GRAVITY_DISTANCE);
          pushY -= proximity * EDGE_GRAVITY_STRENGTH * speedMultiplier;
        }

        asset.vx += pushX;
        asset.vy += pushY;
      }

      // STATIC CHARGE BUILD-UP when touching edge
      if (nowTouchingEdge) {
        asset.staticCharge = Math.min(STATIC_GRAVITY_THRESHOLD, asset.staticCharge + STATIC_CHARGE_BUILDUP);

        // Bounce off edges with energy loss
        if (distToLeft <= 0 || distToRight <= 0) {
          asset.vx *= -0.8;
          asset.x = Math.max(asset.radius, Math.min(this.width - asset.radius, asset.x));
        }
        if (distToTop <= 0 || distToBottom <= 0) {
          asset.vy *= -0.8;
          asset.y = Math.max(asset.radius, Math.min(this.height - asset.radius, asset.y));
        }
      } else {
        // STATIC DISCHARGE when not touching
        asset.staticCharge = Math.max(0, asset.staticCharge - STATIC_DISCHARGE_RATE);
      }

      // STATIC GRAVITY - Once charge reaches threshold, push AWAY from edges strongly
      if (asset.staticCharge >= STATIC_GRAVITY_THRESHOLD) {
        // Calculate direction away from all nearby edges
        let pushX = 0;
        let pushY = 0;
        const staticForce = 0.5 * speedMultiplier; // Strong push

        if (distToLeft < EDGE_GRAVITY_DISTANCE) {
          pushX += staticForce;
        }
        if (distToRight < EDGE_GRAVITY_DISTANCE) {
          pushX -= staticForce;
        }
        if (distToTop < EDGE_GRAVITY_DISTANCE) {
          pushY += staticForce;
        }
        if (distToBottom < EDGE_GRAVITY_DISTANCE) {
          pushY -= staticForce;
        }

        asset.vx += pushX;
        asset.vy += pushY;

        // Reset charge after applying force
        asset.staticCharge = 0;
      }

      // Update touching state
      asset.touchingEdge = nowTouchingEdge;

      // BROWN NOISE OSCILLATION - Add natural turbulence
      if (this.brownNoiseEnabled && this.brownNoiseStrength > 0) {
        // Generate unique oscillation for each asset using its ID as seed
        const assetSeed = asset._id ? asset._id.charCodeAt(0) : 0;
        const timePhase = (this.brownNoiseTime + this.brownNoiseOffset + assetSeed) * this.brownNoiseFrequency;

        // Use multiple sine waves at different frequencies for brown noise effect
        // Brown noise has more low-frequency components
        const noise1 = Math.sin(timePhase) * 1.0;
        const noise2 = Math.sin(timePhase * 2.3 + assetSeed) * 0.5;
        const noise3 = Math.sin(timePhase * 0.7 + assetSeed * 2) * 0.25;
        const noise4 = Math.cos(timePhase * 1.5 + assetSeed * 3) * 0.15;

        const brownNoiseX = (noise1 + noise2 + noise3) / 1.75;
        const brownNoiseY = (noise1 + noise2 + noise4) / 1.75;

        // Apply brown noise force
        asset.vx += brownNoiseX * this.brownNoiseStrength * speedMultiplier;
        asset.vy += brownNoiseY * this.brownNoiseStrength * speedMultiplier;
      }

      // Apply damping to prevent infinite acceleration (admin-controlled)
      const dampingValue = this.damping || 0.999;
      asset.vx *= dampingValue;
      asset.vy *= dampingValue;

      // Cap maximum velocity (admin-controlled)
      const maxVel = this.maxVelocity || 8;
      const vel = Math.sqrt(asset.vx * asset.vx + asset.vy * asset.vy);
      if (vel > maxVel) {
        asset.vx = (asset.vx / vel) * maxVel;
        asset.vy = (asset.vy / vel) * maxVel;
      }
    });

    // Save positions every 60 frames (~2 seconds)
    if (this.physicsTicks >= 60) {
      this.physicsTicks = 0;
      this.saveSpatialPositions(); // Async, fire and forget
      this.loadTravelConnections(); // Update connections
    }
  }

  /**
   * Render the entire map (throttled to target FPS)
   */
  render(timestamp = 0) {
    // Throttle to target FPS
    const elapsed = timestamp - this.lastFrameTime;
    const targetInterval = 1000 / this.fps;

    if (elapsed < targetInterval) return;

    this.lastFrameTime = timestamp;

    // Update physics or travel animation
    if (!this.isTraveling) {
      this.updatePhysics();
    } else {
      this.updateTravelAnimation();
    }

    const ctx = this.ctx;

    // Clear canvas
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Save context
    ctx.save();

    // Apply transformations
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // Draw ASCII starfield (static, no twinkling for performance)
    this.renderStarfield();

    // Draw grid (optional)
    if (this.showGrid) {
      this.renderGrid();
    }

    // Draw faction influence zones
    this.renderInfluenceZones();

    // Draw published assets
    this.renderPublishedAssets();

    // Draw faction centers
    this.renderFactionCenters();

    // Draw connections (optional)
    if (this.showConnections) {
      this.renderConnections();
    }

    // Draw current character
    if (this.currentCharacter && this.currentCharacter.location) {
      this.renderCharacter(this.currentCharacter);
    }

    // Draw travel animation overlay (before restoring context for proper positioning)
    if (this.isTraveling) {
      this.renderTravelAnimation();
    }

    // Restore context
    ctx.restore();

    // Draw UI overlays
    this.renderUI();
  }

  /**
   * Render starfield background (simplified)
   */
  renderStarfield() {
    const ctx = this.ctx;

    this.stars.forEach(star => {
      ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`;
      ctx.font = `${star.size * 8}px monospace`;
      ctx.fillText(star.char, star.x, star.y);
    });
  }

  /**
   * Render grid
   */
  renderGrid() {
    const ctx = this.ctx;
    const gridSize = this.gridSize; // Use admin-controlled grid size

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    for (let x = 0; x <= this.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }

    for (let y = 0; y <= this.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  /**
   * Render faction influence zones
   */
  renderInfluenceZones() {
    const ctx = this.ctx;

    this.factionCenters.forEach(center => {
      const influenceRadius = center.radius * 4;

      const gradient = ctx.createRadialGradient(
        center.x, center.y, 0,
        center.x, center.y, influenceRadius
      );

      gradient.addColorStop(0, `${center.color}30`);
      gradient.addColorStop(0.5, `${center.color}15`);
      gradient.addColorStop(1, `${center.color}00`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(center.x, center.y, influenceRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /**
   * Render published assets
   */
  renderPublishedAssets() {
    const ctx = this.ctx;

    this.publishedAssets.forEach(asset => {
      const isHovered = this.hoveredAsset === asset;
      const isSelected = this.selectedAsset === asset;
      const isSpaceHub = asset.hubData?.isStartingLocation;

      if (isSpaceHub) {
        // Special rendering for space hubs
        this.renderSpaceHub(asset, isHovered, isSelected);
      } else {
        // Regular asset rendering
        ctx.fillStyle = asset.color + (isSelected ? 'ff' : '80');
        ctx.strokeStyle = asset.color;
        ctx.lineWidth = isHovered || isSelected ? 3 : 1;

        ctx.beginPath();
        ctx.arc(asset.x, asset.y, asset.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw pulse effect for selected
        if (isSelected) {
          ctx.strokeStyle = asset.color + '40';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(asset.x, asset.y, asset.radius + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    });
  }

  /**
   * Render space hub with special styling
   */
  renderSpaceHub(hub, isHovered, isSelected) {
    const ctx = this.ctx;
    const radius = 50; // Larger radius for hubs
    const color = hub.hubData?.color || hub.color || '#667eea';

    // Outer rotating ring
    const time = Date.now() / 1000;
    ctx.save();
    ctx.translate(hub.x, hub.y);
    ctx.rotate(time * 0.2);

    // Outer glow
    const glowGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 2);
    glowGradient.addColorStop(0, color + '40');
    glowGradient.addColorStop(1, color + '00');
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 2, 0, Math.PI * 2);
    ctx.fill();

    // Rotating ring segments
    ctx.strokeStyle = color + '60';
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const angle1 = (Math.PI * 2 / 8) * i;
      const angle2 = angle1 + Math.PI / 12;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.3, angle1, angle2);
      ctx.stroke();
    }

    ctx.restore();

    // Main hub circle
    const mainGradient = ctx.createRadialGradient(
      hub.x, hub.y, 0,
      hub.x, hub.y, radius
    );
    mainGradient.addColorStop(0, color + 'ff');
    mainGradient.addColorStop(0.7, color + 'cc');
    mainGradient.addColorStop(1, color + '80');

    ctx.fillStyle = mainGradient;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = isHovered || isSelected ? 4 : 2;

    ctx.beginPath();
    ctx.arc(hub.x, hub.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Hub icon
    const icon = hub.hubData?.icon || '✦';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 8;
    ctx.fillText(icon, hub.x, hub.y);
    ctx.shadowBlur = 0;

    // Hub name label
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 6;
    ctx.fillText(hub.title, hub.x, hub.y + radius + 30);

    // String domain subtitle
    ctx.font = '12px monospace';
    ctx.fillStyle = color;
    ctx.fillText(hub.hubData?.stringDomain || '', hub.x, hub.y + radius + 50);
    ctx.shadowBlur = 0;

    // Pulse effect when selected
    if (isSelected) {
      ctx.strokeStyle = color + '60';
      ctx.lineWidth = 2;
      const pulseRadius = radius + 10 + Math.sin(time * 3) * 5;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, pulseRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Hover glow
    if (isHovered) {
      ctx.strokeStyle = '#ffffff80';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * Render faction centers
   */
  renderFactionCenters() {
    const ctx = this.ctx;

    this.factionCenters.forEach(center => {
      // Outer glow
      const glowGradient = ctx.createRadialGradient(
        center.x, center.y, 0,
        center.x, center.y, center.radius * 1.5
      );
      glowGradient.addColorStop(0, `${center.color}ff`);
      glowGradient.addColorStop(1, `${center.color}00`);

      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(center.x, center.y, center.radius * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Main circle
      ctx.fillStyle = center.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(center.x, center.y, center.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // ASCII symbol
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', center.x, center.y);

      // Label
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(center.name, center.x, center.y + center.radius + 20);
      ctx.shadowBlur = 0;
    });
  }

  /**
   * Render travel connections with dynamic color coding
   * RED = about to break (high distance/low stability)
   * GREEN = stable connection
   * BLUE = future/planned connection
   */
  renderConnections() {
    if (this.travelConnections.length === 0) return;

    const ctx = this.ctx;

    this.travelConnections.forEach(conn => {
      // Determine color based on trajectory status
      let color, glowColor, lineWidth, alpha, dashPattern;

      if (conn.status === 'converging') {
        // BLUE - Objects getting closer (future paths near)
        const intensity = Math.max(0.5, conn.stability);
        const blueValue = Math.floor(180 + (intensity * 75)); // 180-255
        color = `rgb(30, 144, ${blueValue})`;
        glowColor = `rgba(30, 144, 255, ${intensity * 0.6})`;
        lineWidth = 2 + intensity * 2;
        alpha = 0.5 + (intensity * 0.3);
        dashPattern = [8, 8]; // Converging dashes
      } else if (conn.status === 'breaking') {
        // RED - Link BREAKING (approaching max distance threshold)
        const breakIntensity = 1 - conn.stability; // Higher = closer to breaking
        const greenValue = Math.floor(Math.max(0, 100 - (breakIntensity * 100))); // 100 -> 0
        color = `rgb(255, ${greenValue}, 0)`;
        glowColor = `rgba(255, ${greenValue}, 0, ${0.5 + breakIntensity * 0.4})`;
        lineWidth = 2 + breakIntensity * 4; // Much thicker when about to break
        alpha = 0.7 + (breakIntensity * 0.3); // More visible when critical
        dashPattern = [6, 6]; // Broken/warning dashes
      } else {
        // GREEN - Stable distance (parallel trajectories)
        const greenIntensity = Math.floor(150 + (conn.stability * 105));
        color = `rgb(16, ${greenIntensity}, 129)`;
        glowColor = `rgba(16, 185, 129, ${conn.stability * 0.4})`;
        lineWidth = 2 + (conn.stability * 1.5);
        alpha = 0.6 + (conn.stability * 0.2);
        dashPattern = [4, 4]; // Stable dashes
      }

      // Draw glow effect
      ctx.save();
      ctx.shadowBlur = 12;
      ctx.shadowColor = glowColor;
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = lineWidth + 3;
      ctx.setLineDash(dashPattern);

      ctx.beginPath();
      ctx.moveTo(conn.fromX, conn.fromY);
      ctx.lineTo(conn.toX, conn.toY);
      ctx.stroke();
      ctx.restore();

      // Draw main line
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(dashPattern);

      ctx.beginPath();
      ctx.moveTo(conn.fromX, conn.fromY);
      ctx.lineTo(conn.toX, conn.toY);
      ctx.stroke();

      // Draw midpoint marker with status color
      const midX = (conn.fromX + conn.toX) / 2;
      const midY = (conn.fromY + conn.toY) / 2;

      ctx.shadowBlur = 6;
      ctx.shadowColor = glowColor;
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha + 0.2;
      ctx.beginPath();
      ctx.arc(midX, midY, 2 + lineWidth * 0.5, 0, Math.PI * 2);
      ctx.fill();

      // Add animated pulse for breaking connections (links about to snap)
      if (conn.status === 'breaking') {
        const pulseSize = 5 + Math.sin(Date.now() / 150) * 4;
        const breakIntensity = 1 - conn.stability;
        ctx.globalAlpha = breakIntensity * 0.6;
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(midX, midY, pulseSize, 0, Math.PI * 2);
        ctx.stroke();

        // Add warning flash for links that will break soon
        if (conn.willBreak) {
          const flashIntensity = (Math.sin(Date.now() / 100) + 1) / 2;
          ctx.globalAlpha = flashIntensity * 0.8;
          ctx.strokeStyle = 'rgba(255, 255, 0, 1)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(midX, midY, pulseSize + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Add animated pulse for converging connections (future paths forming)
      if (conn.status === 'converging' && conn.stability > 0.7) {
        const pulseSize = 3 + Math.sin(Date.now() / 300) * 2;
        ctx.globalAlpha = conn.stability * 0.3;
        ctx.strokeStyle = 'rgba(30, 144, 255, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(midX, midY, pulseSize, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  /**
   * Render UI overlays
   */
  renderUI() {
    const ctx = this.ctx;

    // Zoom level
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, this.canvas.height - 30, 120, 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.fillText(`Zoom: ${(this.scale * 100).toFixed(0)}% | Assets: ${this.publishedAssets.length}`, 15, this.canvas.height - 15);

    // Hovered asset info
    if (this.hoveredAsset) {
      this.renderAssetTooltip(this.hoveredAsset);
    }
  }

  /**
   * Render asset tooltip
   */
  renderAssetTooltip(asset) {
    const ctx = this.ctx;
    const padding = 10;
    const lineHeight = 16;

    const lines = [
      `${asset.title || 'Asset'}`,
      `Type: ${asset.assetType || 'unknown'}`,
      `Votes: ${asset.votes || 0}`
    ];

    const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
    const boxWidth = maxWidth + padding * 2;
    const boxHeight = lines.length * lineHeight + padding * 2;

    const x = Math.min(this.canvas.width - boxWidth - 10, this.canvas.width - 220);
    const y = 10;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(x, y, boxWidth, boxHeight);

    // Border
    ctx.strokeStyle = asset.color || '#667eea';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, boxWidth, boxHeight);

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    lines.forEach((line, index) => {
      ctx.fillText(line, x + padding, y + padding + (index + 1) * lineHeight);
    });
  }

  /**
   * Animation loop (throttled)
   */
  animate(timestamp) {
    this.render(timestamp);
    requestAnimationFrame((ts) => this.animate(ts));
  }

  /**
   * Render character on map
   */
  renderCharacter(character) {
    const ctx = this.ctx;
    const x = character.location.x;
    const y = character.location.y;

    // Character marker - ship icon
    const size = 15;

    // Draw ship triangle pointing up
    ctx.save();
    ctx.translate(x, y);

    // Glow effect
    ctx.shadowColor = '#00ff00';
    ctx.shadowBlur = 15;

    // Ship body
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(-size * 0.6, size * 0.6);
    ctx.lineTo(0, size * 0.3);
    ctx.lineTo(size * 0.6, size * 0.6);
    ctx.closePath();
    ctx.fill();

    // Ship outline
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Name label
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 4;
    ctx.fillText(character.name, 0, size + 25);

    ctx.restore();
  }

  /**
   * Start travel animation along a path
   */
  startTravelAnimation(path, finalX, finalY, finalZone) {
    if (path.length < 2) {
      console.warn('Travel path too short');
      return;
    }

    this.isTraveling = true;
    this.travelPath = path;
    this.currentLeg = 0;
    this.travelProgress = 0;
    this.travelStartTime = Date.now();

    // Set up first leg
    this.travelStartPos = {
      x: this.currentCharacter.location.x,
      y: this.currentCharacter.location.y
    };
    this.travelEndPos = {
      x: path[0].x,
      y: path[0].y
    };

    // Store final destination
    this.travelFinalDestination = {
      x: finalX,
      y: finalY,
      zone: finalZone
    };

    console.log(`🚀 Starting travel: ${path.length} waypoints`);
  }

  /**
   * Update travel animation
   */
  updateTravelAnimation() {
    if (!this.isTraveling) return;

    const now = Date.now();
    const elapsed = now - this.travelStartTime;
    this.travelProgress = Math.min(elapsed / this.legDuration, 1);

    // Check if current leg is complete
    if (this.travelProgress >= 1) {
      this.currentLeg++;

      // Check if all legs are complete
      if (this.currentLeg >= this.travelPath.length) {
        this.completeTravelAnimation();
        return;
      }

      // Start next leg
      this.travelStartTime = now;
      this.travelProgress = 0;
      this.travelStartPos = {
        x: this.travelPath[this.currentLeg - 1].x,
        y: this.travelPath[this.currentLeg - 1].y
      };
      this.travelEndPos = {
        x: this.travelPath[this.currentLeg].x,
        y: this.travelPath[this.currentLeg].y
      };

      console.log(`Moving to leg ${this.currentLeg + 1}/${this.travelPath.length}`);
    }

    // Update character position (interpolate)
    const t = this.easeInOutQuad(this.travelProgress);
    this.currentCharacter.location.x = this.travelStartPos.x + (this.travelEndPos.x - this.travelStartPos.x) * t;
    this.currentCharacter.location.y = this.travelStartPos.y + (this.travelEndPos.y - this.travelStartPos.y) * t;
  }

  /**
   * Complete travel animation
   */
  async completeTravelAnimation() {
    this.isTraveling = false;

    // Set final position
    this.currentCharacter.location.x = this.travelFinalDestination.x;
    this.currentCharacter.location.y = this.travelFinalDestination.y;
    this.currentCharacter.location.zone = this.travelFinalDestination.zone;

    console.log(`✅ Travel complete: ${this.travelFinalDestination.zone}`);

    // Update server using the dedicated location endpoint
    try {
      await fetch(`/api/v1/characters/${this.currentCharacter._id}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies for authentication
        body: JSON.stringify({
          x: this.currentCharacter.location.x,
          y: this.currentCharacter.location.y,
          type: this.currentCharacter.location.type,
          zone: this.currentCharacter.location.zone,
          assetId: this.travelFinalDestination.assetId
        })
      });

      // Show completion notification
      if (window.showTravelNotification) {
        window.showTravelNotification(`✅ Arrived at ${this.travelFinalDestination.zone}!`);
      }
    } catch (error) {
      console.error('Failed to update character location:', error);
      if (window.showTravelNotification) {
        window.showTravelNotification(`❌ Travel failed: ${error.message}`);
      }
    }
  }

  /**
   * Easing function for smooth animation
   */
  easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  /**
   * Render travel animation overlay
   */
  renderTravelAnimation() {
    if (!this.isTraveling) return;

    const ctx = this.ctx;

    // Draw completed path segments (in green)
    ctx.save();
    for (let i = 0; i < this.currentLeg; i++) {
      const start = i === 0 ? this.travelStartPos : this.travelPath[i - 1];
      const end = this.travelPath[i];

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.8)';
      ctx.lineWidth = 4;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }

    // Draw current leg with progress
    if (this.currentLeg < this.travelPath.length) {
      const currentX = this.currentCharacter.location.x;
      const currentY = this.currentCharacter.location.y;

      // Completed portion of current leg
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(this.travelStartPos.x, this.travelStartPos.y);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();

      // Remaining portion (dimmed)
      ctx.strokeStyle = 'rgba(156, 163, 175, 0.3)';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 5]);
      ctx.beginPath();
      ctx.moveTo(currentX, currentY);
      ctx.lineTo(this.travelEndPos.x, this.travelEndPos.y);
      ctx.stroke();

      // Future legs (dimmed dashed)
      for (let i = this.currentLeg + 1; i < this.travelPath.length; i++) {
        const start = this.travelPath[i - 1];
        const end = this.travelPath[i];

        ctx.strokeStyle = 'rgba(156, 163, 175, 0.3)';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
    }

    // Draw waypoint markers
    this.travelPath.forEach((waypoint, i) => {
      const isCompleted = i < this.currentLeg;
      const isCurrent = i === this.currentLeg;

      ctx.fillStyle = isCompleted ? 'rgba(16, 185, 129, 0.6)' :
                      isCurrent ? 'rgba(251, 191, 36, 0.8)' :
                      'rgba(156, 163, 175, 0.4)';
      ctx.beginPath();
      ctx.arc(waypoint.x, waypoint.y, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Draw traveling character with trail effect
    const currentX = this.currentCharacter.location.x;
    const currentY = this.currentCharacter.location.y;
    const size = 20;

    // Pulsing glow effect
    const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
    ctx.shadowColor = '#10b981';
    ctx.shadowBlur = 20 * pulse;

    // Ship body (bright green while traveling)
    ctx.fillStyle = '#10b981';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.arc(currentX, currentY, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Direction arrow
    const dx = this.travelEndPos.x - this.travelStartPos.x;
    const dy = this.travelEndPos.y - this.travelStartPos.y;
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(currentX, currentY);
    ctx.rotate(angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(size * 0.5, 0);
    ctx.lineTo(-size * 0.3, -size * 0.3);
    ctx.lineTo(-size * 0.3, size * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /**
   * Randomize all asset positions (force reset)
   */
  async randomizeAllPositions() {
    console.log('🎲 Randomizing all asset positions...');

    // Clear spatial service data
    try {
      await fetch(`${this.spatialServiceUrl}/api/spatial/assets`, {
        method: 'DELETE'
      });
      console.log('✅ Cleared spatial service data');
    } catch (error) {
      console.warn('Could not clear spatial service:', error);
    }

    // Force reload assets with randomization
    try {
      const response = await fetch('/api/v1/assets/approved/list');
      if (!response.ok) return;

      const data = await response.json();
      if (data.success && data.assets) {
        await this.updatePublishedAssets(data.assets, true); // true = force randomize
        console.log('✅ All positions randomized!');
      }
    } catch (error) {
      console.error('Error randomizing positions:', error);
    }
  }

  /**
   * Start animation
   */
  start() {
    console.log('Galactic Map Starting - Size:', this.width, 'x', this.height);
    this.animate(0);
    // Load published assets
    this.loadPublishedAssets();
    // Load admin settings
    this.loadSettings();
    // Refresh assets every 30 seconds
    setInterval(() => this.loadPublishedAssets(), 30000);
    // Refresh settings every 5 seconds
    setInterval(() => this.loadSettings(), 5000);
  }
}

export default GalacticMap;
