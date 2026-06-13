/**
 * Planetary Chunk Manager
 * Handles procedural terrain loading, chunking, and rendering
 */

class PlanetaryChunkManager {
  constructor(planetId, canvasId) {
    this.planetId = planetId;
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    // Planet state
    this.status = 'loading'; // loading, seeding, ready, error
    this.seedingProgress = 0;
    this.pioneer = null;
    this.parameters = null;

    // Chunk management
    this.chunkSize = 64; // Tiles per chunk
    this.tileSize = 16; // Pixels per tile
    this.loadRadius = 2; // Chunks to load around player
    this.chunks = new Map(); // Map of "x,y" => chunk data
    this.loadedChunks = new Set();

    // Player state
    this.player = {
      x: 0, // World pixel position
      y: 0,
      chunkX: 0, // Current chunk coordinates
      chunkY: 0,
      speed: 120, // pixels per second
      size: 14
    };

    // Camera
    this.camera = {
      x: 0,
      y: 0
    };

    // Input
    this.keys = {};
    this.lastUpdate = performance.now();

    // Stats
    this.stats = {
      oxygen: 100,
      energy: 100,
      resources: 0,
      discoveries: 0,
      scans: 0
    };

    // Inventory
    this.inventory = {
      items: [],
      maxSlots: 32,
      maxWeight: 100,
      currentWeight: 0
    };

    // UI References
    this.minimapCanvas = null;
    this.minimapCtx = null;
    this.fullMapCanvas = null;
    this.fullMapCtx = null;
  }

  /**
   * Initialize the planet
   */
  async initialize() {
    try {
      // Check if planet is initialized
      const statusResponse = await fetch(`/api/v1/planet-generation/${this.planetId}/status`);
      const statusData = await statusResponse.json();

      if (statusData.data.status === 'not_initialized') {
        // Initialize planet for first time
        await this.initializePlanet();
      } else {
        this.status = statusData.data.status;
        this.seedingProgress = statusData.data.percentage;
        this.pioneer = statusData.data.pioneer;
        this.parameters = statusData.data.parameters;

        if (this.status === 'seeding') {
          // Show seeding UI and start background seeding
          this.showSeedingUI();
          await this.backgroundSeed();
        } else if (this.status === 'ready') {
          // Load initial chunks around player
          await this.loadChunksAroundPlayer();
          this.start();
        }
      }
    } catch (error) {
      console.error('Error initializing planet:', error);
      this.status = 'error';
      this.showError(error.message);
    }
  }

  /**
   * Initialize planet (first visit)
   */
  async initializePlanet() {
    try {
      const response = await fetch(`/api/v1/planet-generation/${this.planetId}/initialize`, {
        method: 'POST'
      });

      const data = await response.json();

      if (data.success) {
        this.status = 'seeding';
        this.pioneer = { username: '<%= user ? user.username : "Unknown" %>' };
        this.parameters = data.data.parameters;

        // Show pioneer notification
        this.showPioneerNotification();

        // Start seeding UI
        this.showSeedingUI();
        await this.backgroundSeed();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Error initializing planet:', error);
      throw error;
    }
  }

  /**
   * Show pioneer achievement notification
   */
  showPioneerNotification() {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: linear-gradient(135deg, rgba(138, 79, 255, 0.95), rgba(74, 158, 255, 0.95));
      border: 3px solid #00ff88;
      padding: 30px 40px;
      border-radius: 10px;
      z-index: 10000;
      font-family: 'Orbitron', monospace;
      text-align: center;
      box-shadow: 0 0 40px rgba(138, 79, 255, 0.8);
      animation: pioneerPulse 2s infinite;
    `;

    notification.innerHTML = `
      <div style="font-size: 3em; margin-bottom: 10px;">🏆</div>
      <div style="font-size: 1.5em; color: #FFD700; font-weight: bold; margin-bottom: 10px;">PIONEER!</div>
      <div style="color: #fff; font-size: 1em;">You are the first visitor to this planet!</div>
      <div style="color: #00ff88; font-size: 0.9em; margin-top: 15px;">+1000 XP</div>
      <div style="color: #aaa; font-size: 0.7em; margin-top: 10px;">Planet seeding in progress...</div>
    `;

    document.body.appendChild(notification);

    // Remove after 5 seconds
    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.5s';
      setTimeout(() => notification.remove(), 500);
    }, 5000);
  }

  /**
   * Show seeding progress UI
   */
  showSeedingUI() {
    const seedingUI = document.createElement('div');
    seedingUI.id = 'seeding-ui';
    seedingUI.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.95);
      border: 2px solid #00ff88;
      padding: 30px 40px;
      border-radius: 10px;
      z-index: 9999;
      font-family: 'Courier New', monospace;
      text-align: center;
      min-width: 400px;
    `;

    seedingUI.innerHTML = `
      <div style="font-size: 1.5em; color: #00ff88; margin-bottom: 20px;">PLANETARY SEEDING</div>
      <div style="color: #aaa; margin-bottom: 20px;">Generating procedural terrain...</div>
      <div style="width: 100%; height: 20px; background: rgba(0, 0, 0, 0.5); border: 1px solid #00ff88; border-radius: 10px; overflow: hidden;">
        <div id="seeding-progress-bar" style="height: 100%; background: linear-gradient(90deg, #00ff88, #00d4ff); width: 0%; transition: width 0.5s;"></div>
      </div>
      <div id="seeding-percentage" style="color: #00ff88; font-size: 1.2em; margin-top: 15px;">0%</div>
      <div style="color: #666; font-size: 0.8em; margin-top: 10px;">Pioneer: <span style="color: #FFD700;">${this.pioneer?.username || 'You'}</span></div>
    `;

    document.body.appendChild(seedingUI);
  }

  /**
   * Update seeding progress
   */
  updateSeedingProgress(percentage) {
    this.seedingProgress = percentage;

    const progressBar = document.getElementById('seeding-progress-bar');
    const percentageText = document.getElementById('seeding-percentage');

    if (progressBar) {
      progressBar.style.width = `${percentage}%`;
    }

    if (percentageText) {
      percentageText.textContent = `${percentage}%`;
    }
  }

  /**
   * Background planet seeding
   */
  async backgroundSeed() {
    while (this.seedingProgress < 100 && this.status === 'seeding') {
      try {
        const response = await fetch(`/api/v1/planet-generation/${this.planetId}/seed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chunksToGenerate: 25 })
        });

        const data = await response.json();

        if (data.success) {
          this.updateSeedingProgress(data.data.percentage);

          if (data.data.status === 'ready') {
            this.status = 'ready';
            this.hideSeedingUI();
            await this.loadChunksAroundPlayer();
            this.start();
            break;
          }
        }

        // Wait 1 second between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Error during seeding:', error);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  /**
   * Hide seeding UI
   */
  hideSeedingUI() {
    const seedingUI = document.getElementById('seeding-ui');
    if (seedingUI) {
      seedingUI.style.animation = 'fadeOut 0.5s';
      setTimeout(() => seedingUI.remove(), 500);
    }
  }

  /**
   * Load chunks around player
   */
  async loadChunksAroundPlayer() {
    try {
      const response = await fetch(
        `/api/v1/planet-generation/${this.planetId}/chunks?chunkX=${this.player.chunkX}&chunkY=${this.player.chunkY}&radius=${this.loadRadius}`
      );

      const data = await response.json();

      if (data.success) {
        for (const chunk of data.data.chunks) {
          const key = `${chunk.chunkX},${chunk.chunkY}`;
          this.chunks.set(key, chunk);
          this.loadedChunks.add(key);
        }
      }
    } catch (error) {
      console.error('Error loading chunks:', error);
    }
  }

  /**
   * Start game loop
   */
  start() {
    // Hide loading screen
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';

    // Setup UI
    this.setupUI();

    // Setup controls
    this.setupControls();

    // Initialize inventory
    this.initializeInventory();

    // Start render loop
    this.gameLoop();
  }

  /**
   * Setup UI elements
   */
  setupUI() {
    // Get minimap canvases
    this.minimapCanvas = document.getElementById('minimapCanvas');
    this.minimapCtx = this.minimapCanvas?.getContext('2d');

    this.fullMapCanvas = document.getElementById('fullMapCanvas');
    this.fullMapCtx = this.fullMapCanvas?.getContext('2d');

    // Button event listeners
    const mapToggle = document.getElementById('mapToggle');
    if (mapToggle) {
      mapToggle.addEventListener('click', () => this.toggleFullMap());
      mapToggle.addEventListener('mouseenter', (e) => {
        e.target.style.background = 'rgba(74, 158, 255, 0.3)';
        e.target.style.borderColor = '#6dd5ed';
      });
      mapToggle.addEventListener('mouseleave', (e) => {
        e.target.style.background = 'rgba(5, 10, 20, 0.8)';
        e.target.style.borderColor = '#4a9eff';
      });
    }

    const inventoryToggle = document.getElementById('inventoryToggle');
    if (inventoryToggle) {
      inventoryToggle.addEventListener('click', () => this.toggleInventory());
      inventoryToggle.addEventListener('mouseenter', (e) => {
        e.target.style.background = 'rgba(255, 165, 0, 0.3)';
        e.target.style.borderColor = '#ffd700';
      });
      inventoryToggle.addEventListener('mouseleave', (e) => {
        e.target.style.background = 'rgba(5, 10, 20, 0.8)';
        e.target.style.borderColor = '#ffa500';
      });
    }

    const returnToOrbit = document.getElementById('returnToOrbit');
    if (returnToOrbit) {
      returnToOrbit.addEventListener('click', () => this.returnToOrbit());
      returnToOrbit.addEventListener('mouseenter', (e) => {
        e.target.style.background = 'rgba(255, 68, 68, 0.3)';
        e.target.style.borderColor = '#ff6666';
      });
      returnToOrbit.addEventListener('mouseleave', (e) => {
        e.target.style.background = 'rgba(5, 10, 20, 0.8)';
        e.target.style.borderColor = '#ff4444';
      });
    }

    const closeMapBtn = document.getElementById('closeMapBtn');
    if (closeMapBtn) {
      closeMapBtn.addEventListener('click', () => this.toggleFullMap());
    }

    const closeInventoryBtn = document.getElementById('closeInventoryBtn');
    if (closeInventoryBtn) {
      closeInventoryBtn.addEventListener('click', () => this.toggleInventory());
    }
  }

  /**
   * Toggle full map overlay
   */
  toggleFullMap() {
    const overlay = document.getElementById('fullMapOverlay');
    if (overlay) {
      const isVisible = overlay.style.display !== 'none';
      overlay.style.display = isVisible ? 'none' : 'flex';

      if (!isVisible) {
        this.renderFullMap();
      }
    }
  }

  /**
   * Toggle inventory overlay
   */
  toggleInventory() {
    const overlay = document.getElementById('inventoryOverlay');
    if (overlay) {
      const isVisible = overlay.style.display !== 'none';
      overlay.style.display = isVisible ? 'none' : 'flex';

      if (!isVisible) {
        this.updateInventoryUI();
      }
    }
  }

  /**
   * Return to orbit (go back to star system)
   */
  returnToOrbit() {
    if (confirm('Return to orbit? Your position will be saved.')) {
      // TODO: Save player position to database
      // For now, just go back to star system
      window.history.back();
    }
  }

  /**
   * Setup input controls
   */
  setupControls() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    // Resize handler
    window.addEventListener('resize', () => this.resizeCanvas());
    this.resizeCanvas();
  }

  /**
   * Resize canvas
   */
  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /**
   * Game loop
   */
  gameLoop() {
    const now = performance.now();
    const deltaTime = (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;

    this.update(deltaTime);
    this.render();

    requestAnimationFrame(() => this.gameLoop());
  }

  /**
   * Update game state
   */
  update(deltaTime) {
    // Update player position based on input
    let moveX = 0;
    let moveY = 0;

    if (this.keys['w'] || this.keys['arrowup']) moveY -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) moveY += 1;
    if (this.keys['a'] || this.keys['arrowleft']) moveX -= 1;
    if (this.keys['d'] || this.keys['arrowright']) moveX += 1;

    // Normalize diagonal movement
    if (moveX !== 0 && moveY !== 0) {
      moveX *= 0.707;
      moveY *= 0.707;
    }

    // Apply movement
    this.player.x += moveX * this.player.speed * deltaTime;
    this.player.y += moveY * this.player.speed * deltaTime;

    // Update current chunk
    const newChunkX = Math.floor(this.player.x / (this.chunkSize * this.tileSize));
    const newChunkY = Math.floor(this.player.y / (this.chunkSize * this.tileSize));

    if (newChunkX !== this.player.chunkX || newChunkY !== this.player.chunkY) {
      this.player.chunkX = newChunkX;
      this.player.chunkY = newChunkY;
      this.loadChunksAroundPlayer();
    }

    // Update camera to follow player
    this.camera.x = this.player.x - this.canvas.width / 2;
    this.camera.y = this.player.y - this.canvas.height / 2;

    // Update HUD
    this.updateHUD();
  }

  /**
   * Render game
   */
  render() {
    const ctx = this.ctx;

    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Render visible chunks
    this.renderChunks();

    // Render player
    this.renderPlayer();

    // Render minimap
    this.renderMinimap();
  }

  /**
   * Render all visible chunks
   */
  renderChunks() {
    const ctx = this.ctx;

    // Calculate visible chunk range
    const startChunkX = Math.floor(this.camera.x / (this.chunkSize * this.tileSize)) - 1;
    const endChunkX = Math.ceil((this.camera.x + this.canvas.width) / (this.chunkSize * this.tileSize)) + 1;
    const startChunkY = Math.floor(this.camera.y / (this.chunkSize * this.tileSize)) - 1;
    const endChunkY = Math.ceil((this.camera.y + this.canvas.height) / (this.chunkSize * this.tileSize)) + 1;

    for (let cy = startChunkY; cy <= endChunkY; cy++) {
      for (let cx = startChunkX; cx <= endChunkX; cx++) {
        const key = `${cx},${cy}`;
        const chunk = this.chunks.get(key);

        if (chunk && chunk.data && chunk.data.tiles) {
          this.renderChunk(chunk);
        }
      }
    }
  }

  /**
   * Render a single chunk
   */
  renderChunk(chunk) {
    const ctx = this.ctx;
    const tiles = chunk.data.tiles;

    for (const tile of tiles) {
      const screenX = tile.worldX * this.tileSize - this.camera.x;
      const screenY = tile.worldY * this.tileSize - this.camera.y;

      // Only render if on screen
      if (screenX + this.tileSize < 0 || screenX > this.canvas.width ||
          screenY + this.tileSize < 0 || screenY > this.canvas.height) {
        continue;
      }

      // Get terrain color
      const color = this.getTerrainColor(tile.terrain, tile.height);

      ctx.fillStyle = color;
      ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);

      // Render resource if present
      if (tile.resource) {
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(screenX + 4, screenY + 4, 4, 4);
      }
    }
  }

  /**
   * Get terrain color
   */
  getTerrainColor(terrain, height) {
    const colors = {
      'water': '#1e6bb8',
      'frozen': '#a8d8ff',
      'tundra': '#c0c0c0',
      'desert': '#d4a574',
      'volcanic': '#ff4400',
      'forest': '#228b22',
      'grassland': '#7cfc00',
      'plains': '#9acd32',
      'default': '#666'
    };

    return colors[terrain] || colors.default;
  }

  /**
   * Render player
   */
  renderPlayer() {
    const ctx = this.ctx;

    const screenX = this.player.x - this.camera.x;
    const screenY = this.player.y - this.camera.y;

    // Player body
    ctx.fillStyle = '#00ff88';
    ctx.fillRect(
      screenX - this.player.size / 2,
      screenY - this.player.size / 2,
      this.player.size,
      this.player.size
    );

    // Direction indicator
    ctx.fillStyle = '#fff';
    ctx.fillRect(screenX - 2, screenY - this.player.size / 2 - 4, 4, 4);
  }

  /**
   * Update HUD elements
   */
  updateHUD() {
    // Update position
    const coords = document.getElementById('coords');
    if (coords) {
      coords.textContent = `${Math.floor(this.player.x)}, ${Math.floor(this.player.y)}`;
    }

    // Update stats
    const oxygen = document.getElementById('oxygen');
    const oxygenBar = document.getElementById('oxygenBar');
    if (oxygen && oxygenBar) {
      oxygen.textContent = `${this.stats.oxygen}%`;
      oxygenBar.style.width = `${this.stats.oxygen}%`;
    }

    const energy = document.getElementById('energy');
    const energyBar = document.getElementById('energyBar');
    if (energy && energyBar) {
      energy.textContent = `${this.stats.energy}%`;
      energyBar.style.width = `${this.stats.energy}%`;
    }

    const resources = document.getElementById('resources');
    if (resources) {
      resources.textContent = this.stats.resources;
    }

    const discoveries = document.getElementById('discoveries');
    if (discoveries) {
      discoveries.textContent = this.stats.discoveries;
    }

    const scans = document.getElementById('scans');
    if (scans) {
      scans.textContent = this.stats.scans;
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    const error = document.createElement('div');
    error.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 0, 0, 0.9);
      border: 2px solid #ff4444;
      padding: 20px 30px;
      border-radius: 10px;
      z-index: 10000;
      color: #fff;
      font-family: 'Courier New', monospace;
      text-align: center;
    `;

    error.innerHTML = `
      <div style="font-size: 1.5em; margin-bottom: 10px;">ERROR</div>
      <div>${message}</div>
    `;

    document.body.appendChild(error);
  }

  /**
   * Render minimap
   */
  renderMinimap() {
    if (!this.minimapCtx) return;

    const ctx = this.minimapCtx;
    const size = 150;

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);

    // Calculate what to show (centered on player)
    const viewRange = 5; // Show 5 chunks in each direction
    const pixelsPerChunk = size / (viewRange * 2);

    // Draw chunks
    for (let cy = this.player.chunkY - viewRange; cy <= this.player.chunkY + viewRange; cy++) {
      for (let cx = this.player.chunkX - viewRange; cx <= this.player.chunkX + viewRange; cx++) {
        const key = `${cx},${cy}`;
        const chunk = this.chunks.get(key);

        const screenX = (cx - (this.player.chunkX - viewRange)) * pixelsPerChunk;
        const screenY = (cy - (this.player.chunkY - viewRange)) * pixelsPerChunk;

        if (chunk && chunk.data) {
          // Sample a few tiles from the chunk to get average color
          const tiles = chunk.data.tiles;
          if (tiles && tiles.length > 0) {
            const sampleTile = tiles[Math.floor(tiles.length / 2)];
            ctx.fillStyle = this.getTerrainColor(sampleTile.terrain, sampleTile.height);
            ctx.fillRect(screenX, screenY, pixelsPerChunk, pixelsPerChunk);
          }
        } else {
          // Unexplored
          ctx.fillStyle = '#222';
          ctx.fillRect(screenX, screenY, pixelsPerChunk, pixelsPerChunk);
        }
      }
    }

    // Draw player position
    const playerX = size / 2;
    const playerY = size / 2;
    ctx.fillStyle = '#00ff88';
    ctx.fillRect(playerX - 2, playerY - 2, 4, 4);

    // Draw border
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, size, size);
  }

  /**
   * Render full map
   */
  renderFullMap() {
    if (!this.fullMapCtx) return;

    const ctx = this.fullMapCtx;
    const size = 800;

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);

    // Calculate view
    const viewRange = 10; // Show more chunks on full map
    const pixelsPerChunk = size / (viewRange * 2);

    // Draw chunks
    for (let cy = this.player.chunkY - viewRange; cy <= this.player.chunkY + viewRange; cy++) {
      for (let cx = this.player.chunkX - viewRange; cx <= this.player.chunkX + viewRange; cx++) {
        const key = `${cx},${cy}`;
        const chunk = this.chunks.get(key);

        const screenX = (cx - (this.player.chunkX - viewRange)) * pixelsPerChunk;
        const screenY = (cy - (this.player.chunkY - viewRange)) * pixelsPerChunk;

        if (chunk && chunk.data) {
          const tiles = chunk.data.tiles;
          if (tiles && tiles.length > 0) {
            const sampleTile = tiles[Math.floor(tiles.length / 2)];
            ctx.fillStyle = this.getTerrainColor(sampleTile.terrain, sampleTile.height);
            ctx.fillRect(screenX, screenY, pixelsPerChunk, pixelsPerChunk);
          }
        } else {
          ctx.fillStyle = '#111';
          ctx.fillRect(screenX, screenY, pixelsPerChunk, pixelsPerChunk);
        }

        // Draw grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(screenX, screenY, pixelsPerChunk, pixelsPerChunk);
      }
    }

    // Draw player
    const playerX = size / 2;
    const playerY = size / 2;
    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.arc(playerX, playerY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Update coordinates display
    const mapCoords = document.getElementById('mapCoords');
    if (mapCoords) {
      mapCoords.textContent = `Chunk: ${this.player.chunkX}, ${this.player.chunkY}`;
    }
  }

  /**
   * Initialize inventory
   */
  initializeInventory() {
    this.updateInventoryUI();
  }

  /**
   * Update inventory UI
   */
  updateInventoryUI() {
    const grid = document.getElementById('inventoryGrid');
    if (!grid) return;

    // Clear grid
    grid.innerHTML = '';

    // Create slots
    for (let i = 0; i < this.inventory.maxSlots; i++) {
      const slot = document.createElement('div');
      slot.style.cssText = `
        aspect-ratio: 1;
        background: rgba(0, 0, 0, 0.5);
        border: 1px solid #666;
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
      `;

      const item = this.inventory.items[i];
      if (item) {
        slot.innerHTML = `
          <div style="text-align: center;">
            <div style="font-size: 1.5em;">${item.icon}</div>
            <div style="font-size: 0.6em; color: #aaa;">${item.quantity}</div>
          </div>
        `;
        slot.style.borderColor = '#ffa500';
      }

      slot.addEventListener('mouseenter', function() {
        this.style.background = 'rgba(255, 165, 0, 0.2)';
        this.style.borderColor = '#ffa500';
      });

      slot.addEventListener('mouseleave', function() {
        if (!item) {
          this.style.background = 'rgba(0, 0, 0, 0.5)';
          this.style.borderColor = '#666';
        }
      });

      grid.appendChild(slot);
    }

    // Update stats
    document.getElementById('inventoryWeight').textContent = this.inventory.currentWeight;
    document.getElementById('inventoryMaxWeight').textContent = this.inventory.maxWeight;
    document.getElementById('inventorySlotsUsed').textContent = this.inventory.items.length;
    document.getElementById('inventoryMaxSlots').textContent = this.inventory.maxSlots;
  }

  /**
   * Add item to inventory
   */
  addItem(item) {
    if (this.inventory.items.length >= this.inventory.maxSlots) {
      console.warn('Inventory full!');
      return false;
    }

    if (this.inventory.currentWeight + item.weight > this.inventory.maxWeight) {
      console.warn('Too heavy!');
      return false;
    }

    this.inventory.items.push(item);
    this.inventory.currentWeight += item.weight;
    this.stats.resources++;

    return true;
  }
}

// CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes pioneerPulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1); }
    50% { transform: translate(-50%, -50%) scale(1.05); }
  }

  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
`;
document.head.appendChild(style);
