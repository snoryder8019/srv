/**
 * Zone Renderer
 * Renders interior zones with 2D canvas
 * Handles player movement and sprite rendering
 */

class ZoneRenderer {
  constructor() {
    this.canvas = document.getElementById('zone-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.loadingScreen = document.getElementById('loading-screen');

    // Zone data - check if it exists
    if (!window.zoneData) {
      console.error('❌ No zone data found!');
      alert('Failed to load zone data');
      return;
    }

    this.zone = window.zoneData;
    this.sprites = window.spritesData || [];
    this.parentAnomaly = window.parentAnomalyData;

    console.log('📦 Zone data loaded:', this.zone);

    // Zone dimensions
    this.zoneWidth = this.zone.zoneData?.width || 50;
    this.zoneHeight = this.zone.zoneData?.height || 30;
    this.tileSize = this.zone.zoneData?.tileSize || 32;

    // Get spawn point from zoneData
    const spawnPoints = this.zone.zoneData?.spawnPoints || [];
    const spawnPoint = spawnPoints.find(sp => sp.type === 'player') || spawnPoints[0];
    const spawnX = spawnPoint?.x ?? (this.zoneWidth / 2);
    const spawnY = spawnPoint?.y ?? (this.zoneHeight / 2);

    console.log('🎯 Spawn point:', spawnX, spawnY);

    // Player
    this.player = {
      x: spawnX + 0.5,  // Center of spawn tile
      y: spawnY + 0.5,
      width: 0.8,  // Slightly smaller than tile
      height: 0.8,
      speed: 0.1,  // tiles per frame
      color: '#00ff88'
    };

    // Camera
    this.camera = {
      x: 0,
      y: 0,
      zoom: 1
    };

    // Input
    this.keys = {};

    // Touch controls (virtual joystick)
    this.touch = {
      active: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      identifier: null
    };

    // Animation
    this.lastTime = 0;
    this.running = false;
    this.frameCount = 0;

    // Multiplayer
    this.socket = null;
    this.otherPlayers = new Map(); // characterId -> {name, x, y, color, vx, vy}
    this.characterData = window.characterData || null;

    this.init();
  }

  init() {
    console.log('🎮 Initializing Zone Renderer...');
    console.log('Zone:', this.zone.title);
    console.log('Sprites:', this.sprites.length);
    console.log('Zone dimensions:', this.zoneWidth, 'x', this.zoneHeight);
    console.log('Character:', this.characterData?.name);

    this.setupCanvas();
    this.setupInput();
    this.setupSocket();
    this.hideLoading();
    this.start();
  }

  setupCanvas() {
    // Set canvas to full window size
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    // Handle window resize
    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    });
  }

  setupInput() {
    // Keyboard input
    document.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;

      // Arrow keys
      if (e.key === 'ArrowUp') this.keys['w'] = true;
      if (e.key === 'ArrowDown') this.keys['s'] = true;
      if (e.key === 'ArrowLeft') this.keys['a'] = true;
      if (e.key === 'ArrowRight') this.keys['d'] = true;
    });

    document.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;

      // Arrow keys
      if (e.key === 'ArrowUp') this.keys['w'] = false;
      if (e.key === 'ArrowDown') this.keys['s'] = false;
      if (e.key === 'ArrowLeft') this.keys['a'] = false;
      if (e.key === 'ArrowRight') this.keys['d'] = false;
    });

    // Touch controls - virtual joystick
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.touch.active) return; // Already have a touch active

      const touch = e.changedTouches[0];
      this.touch.active = true;
      this.touch.identifier = touch.identifier;
      this.touch.startX = touch.clientX;
      this.touch.startY = touch.clientY;
      this.touch.currentX = touch.clientX;
      this.touch.currentY = touch.clientY;

      console.log('🎮 Touch started at', this.touch.startX, this.touch.startY);
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!this.touch.active) return;

      const touch = Array.from(e.changedTouches).find(t => t.identifier === this.touch.identifier);
      if (!touch) return;

      this.touch.currentX = touch.clientX;
      this.touch.currentY = touch.clientY;
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      const touch = Array.from(e.changedTouches).find(t => t.identifier === this.touch.identifier);
      if (!touch) return;

      console.log('🎮 Touch ended');
      this.touch.active = false;
      this.touch.identifier = null;
    }, { passive: false });

    this.canvas.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      const touch = Array.from(e.changedTouches).find(t => t.identifier === this.touch.identifier);
      if (!touch) return;

      console.log('🎮 Touch cancelled');
      this.touch.active = false;
      this.touch.identifier = null;
    }, { passive: false });
  }

  setupSocket() {
    if (!this.characterData) {
      console.warn('⚠️ No character data, skipping Socket.IO setup');
      return;
    }

    console.log('🔌 Connecting to Socket.IO...');

    // Connect to Socket.IO server
    this.socket = io();

    // Enter zone
    this.socket.emit('zone:enter', {
      characterId: this.characterData._id,
      characterName: this.characterData.name,
      zoneId: this.zone._id,
      zoneName: this.zone.title || this.zone.name,
      x: this.player.x,
      y: this.player.y
    });

    console.log('🚪 Entering zone:', this.zone.title);

    // Receive list of players already in zone
    this.socket.on('zone:playersInZone', (players) => {
      console.log('👥 Players in zone:', players.length);
      players.forEach(p => {
        if (p.characterId !== this.characterData._id) {
          this.otherPlayers.set(p.characterId, {
            name: p.characterName,
            x: p.location?.x || 0,
            y: p.location?.y || 0,
            vx: 0,
            vy: 0,
            color: this.randomPlayerColor()
          });
        }
      });
    });

    // Player joined zone
    this.socket.on('zone:playerJoined', (data) => {
      console.log('✅ Player joined:', data.characterName);
      this.otherPlayers.set(data.characterId, {
        name: data.characterName,
        x: data.x,
        y: data.y,
        vx: 0,
        vy: 0,
        color: this.randomPlayerColor()
      });
      this.showNotification(`${data.characterName} entered the zone`);
    });

    // Player moved
    this.socket.on('zone:playerMoved', (data) => {
      if (this.otherPlayers.has(data.characterId)) {
        const player = this.otherPlayers.get(data.characterId);
        player.x = data.x;
        player.y = data.y;
        player.vx = data.vx || 0;
        player.vy = data.vy || 0;
      }
    });

    // Player left zone
    this.socket.on('zone:playerLeft', (data) => {
      console.log('👋 Player left:', data.characterName);
      this.otherPlayers.delete(data.characterId);
      this.showNotification(`${data.characterName} left the zone`);
    });

    // Chat message
    this.socket.on('zone:chatMessage', (data) => {
      console.log(`💬 ${data.characterName}: ${data.message}`);
      this.addChatMessage(data.characterName, data.message);
    });

    // Handle disconnect
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });
  }

  randomPlayerColor() {
    const colors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24',
      '#6c5ce7', '#fd79a8', '#fdcb6e', '#00b894'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  showNotification(message) {
    // TODO: Add UI notification
    console.log('📢', message);
  }

  addChatMessage(name, message) {
    // TODO: Add chat UI
    console.log(`💬 ${name}: ${message}`);
  }

  cleanup() {
    if (this.socket && this.characterData) {
      this.socket.emit('zone:exit', {
        characterId: this.characterData._id,
        zoneId: this.zone._id,
        galacticLocation: null  // Will be set by server
      });
      this.socket.disconnect();
    }
  }

  hideLoading() {
    setTimeout(() => {
      this.loadingScreen.classList.add('hidden');
    }, 500);
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this.gameLoop();
  }

  stop() {
    this.running = false;
  }

  gameLoop = (currentTime) => {
    if (!this.running) return;

    const deltaTime = (currentTime - this.lastTime) / 16.67; // Normalize to 60fps
    this.lastTime = currentTime;

    this.update(deltaTime);
    this.render();

    requestAnimationFrame(this.gameLoop);
  }

  update(deltaTime) {
    // Update player position based on input with collision detection
    const moveSpeed = this.player.speed * deltaTime;
    const oldX = this.player.x;
    const oldY = this.player.y;

    // Keyboard controls
    if (this.keys['w']) {
      this.player.y -= moveSpeed;
      if (this.checkCollision(this.player.x, this.player.y)) {
        this.player.y = oldY; // Revert if collision
      }
    }
    if (this.keys['s']) {
      this.player.y += moveSpeed;
      if (this.checkCollision(this.player.x, this.player.y)) {
        this.player.y = oldY;
      }
    }
    if (this.keys['a']) {
      this.player.x -= moveSpeed;
      if (this.checkCollision(this.player.x, this.player.y)) {
        this.player.x = oldX;
      }
    }
    if (this.keys['d']) {
      this.player.x += moveSpeed;
      if (this.checkCollision(this.player.x, this.player.y)) {
        this.player.x = oldX;
      }
    }

    // Touch controls - virtual joystick
    if (this.touch.active) {
      const deltaX = this.touch.currentX - this.touch.startX;
      const deltaY = this.touch.currentY - this.touch.startY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // Only move if drag is significant (> 10px)
      if (distance > 10) {
        // Normalize direction
        const dirX = deltaX / distance;
        const dirY = deltaY / distance;

        // Apply movement with strength based on distance (max 100px = full speed)
        const strength = Math.min(distance / 100, 1.0);
        const touchMoveSpeed = moveSpeed * strength;

        this.player.x += dirX * touchMoveSpeed;
        if (this.checkCollision(this.player.x, this.player.y)) {
          this.player.x = oldX;
        }

        this.player.y += dirY * touchMoveSpeed;
        if (this.checkCollision(this.player.x, this.player.y)) {
          this.player.y = oldY;
        }
      }
    }

    // Clamp player to zone bounds
    this.player.x = Math.max(this.player.width / 2, Math.min(this.zoneWidth - this.player.width / 2, this.player.x));
    this.player.y = Math.max(this.player.height / 2, Math.min(this.zoneHeight - this.player.height / 2, this.player.y));

    // Update camera to follow player
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;

    // Send position update to server (throttled to ~10x/second at 60fps)
    this.frameCount++;
    if (this.socket && this.characterData && this.frameCount % 6 === 0) {
      const vx = this.player.x !== oldX ? (this.player.x - oldX) / deltaTime : 0;
      const vy = this.player.y !== oldY ? (this.player.y - oldY) / deltaTime : 0;

      this.socket.emit('zone:move', {
        characterId: this.characterData._id,
        x: this.player.x,
        y: this.player.y,
        vx: vx,
        vy: vy
      });
    }

    // Update HUD
    const playerCount = this.otherPlayers.size + 1; // +1 for self
    document.getElementById('player-position').textContent =
      `Position: (${Math.floor(this.player.x)}, ${Math.floor(this.player.y)}) | Players: ${playerCount}`;
  }

  render() {
    const ctx = this.ctx;
    const canvas = this.canvas;

    // Clear canvas
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate world-to-screen transform
    const screenTileSize = this.tileSize * this.camera.zoom;
    const offsetX = canvas.width / 2 - this.camera.x * screenTileSize;
    const offsetY = canvas.height / 2 - this.camera.y * screenTileSize;

    ctx.save();

    // Render zone floor (grid or solid color)
    if (this.zone.zoneData && this.zone.zoneData.layers) {
      this.renderFloormap(ctx, offsetX, offsetY, screenTileSize);
    } else {
      this.renderDefaultFloor(ctx, offsetX, offsetY, screenTileSize);
    }

    // Render sprites if they exist
    if (this.sprites.length > 0) {
      this.renderSprites(ctx, offsetX, offsetY, screenTileSize);
    }

    // Render markers (loot, NPCs, exits, hazards)
    this.renderMarkers(ctx, offsetX, offsetY, screenTileSize);

    // Render other players (multiplayer)
    this.renderOtherPlayers(ctx, offsetX, offsetY, screenTileSize);

    // Render player (on top)
    this.renderPlayer(ctx, offsetX, offsetY, screenTileSize);

    // Render zone boundaries
    this.renderBoundaries(ctx, offsetX, offsetY, screenTileSize);

    ctx.restore();

    // Render virtual joystick (on top of everything, in screen space)
    if (this.touch.active) {
      this.renderVirtualJoystick(ctx);
    }
  }

  renderDefaultFloor(ctx, offsetX, offsetY, tileSize) {
    // Render a grid pattern for the default floor
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.1)';
    ctx.lineWidth = 1;

    for (let x = 0; x <= this.zoneWidth; x++) {
      const screenX = offsetX + x * tileSize;
      ctx.beginPath();
      ctx.moveTo(screenX, offsetY);
      ctx.lineTo(screenX, offsetY + this.zoneHeight * tileSize);
      ctx.stroke();
    }

    for (let y = 0; y <= this.zoneHeight; y++) {
      const screenY = offsetY + y * tileSize;
      ctx.beginPath();
      ctx.moveTo(offsetX, screenY);
      ctx.lineTo(offsetX + this.zoneWidth * tileSize, screenY);
      ctx.stroke();
    }

    // Add some visual interest - random floor tiles
    ctx.fillStyle = 'rgba(0, 255, 136, 0.05)';
    for (let i = 0; i < 50; i++) {
      const x = Math.floor(Math.random() * this.zoneWidth);
      const y = Math.floor(Math.random() * this.zoneHeight);
      const screenX = offsetX + x * tileSize;
      const screenY = offsetY + y * tileSize;
      ctx.fillRect(screenX, screenY, tileSize, tileSize);
    }
  }

  renderFloormap(ctx, offsetX, offsetY, tileSize) {
    // Render tilemap from zoneData
    const layers = this.zone.zoneData.layers;

    // Render ground layer
    if (layers.ground && Array.isArray(layers.ground)) {
      for (let y = 0; y < layers.ground.length; y++) {
        const row = layers.ground[y];
        if (!Array.isArray(row)) continue;

        for (let x = 0; x < row.length; x++) {
          const tileId = row[x];
          if (tileId === 0) continue; // Empty tile

          const screenX = offsetX + x * tileSize;
          const screenY = offsetY + y * tileSize;

          // Render tile (for now, just colored squares based on ID)
          ctx.fillStyle = this.getTileColor(tileId);
          ctx.fillRect(screenX, screenY, tileSize, tileSize);
        }
      }
    }

    // Render walls layer
    if (layers.walls && Array.isArray(layers.walls)) {
      for (let y = 0; y < layers.walls.length; y++) {
        const row = layers.walls[y];
        if (!Array.isArray(row)) continue;

        for (let x = 0; x < row.length; x++) {
          const tileId = row[x];
          if (tileId === 0) continue; // Empty tile

          const screenX = offsetX + x * tileSize;
          const screenY = offsetY + y * tileSize;

          // Render wall
          ctx.fillStyle = '#666';
          ctx.fillRect(screenX, screenY, tileSize, tileSize);
          ctx.strokeStyle = '#444';
          ctx.strokeRect(screenX, screenY, tileSize, tileSize);
        }
      }
    }
  }

  getTileColor(tileId) {
    // Simple color mapping for tile IDs
    const colors = [
      '#1a1a1a', // 0 - empty
      '#2a2a2a', // 1 - dark floor
      '#3a3a3a', // 2 - medium floor
      '#4a4a4a', // 3 - light floor
    ];
    return colors[tileId % colors.length] || '#2a2a2a';
  }

  renderSprites(ctx, offsetX, offsetY, tileSize) {
    // Render sprites from sprite data
    // For now, render as colored rectangles until sprite images are loaded
    this.sprites.forEach((sprite, index) => {
      // Get sprite position from zoneData.layers.sprites or default to grid
      let x, y;

      if (this.zone.zoneData?.layers?.sprites) {
        const spritePos = this.zone.zoneData.layers.sprites.find(s => s.spriteId === sprite._id);
        if (spritePos) {
          x = spritePos.x;
          y = spritePos.y;
        } else {
          // Default grid position
          x = (index % this.zoneWidth);
          y = Math.floor(index / this.zoneWidth);
        }
      } else {
        // Default grid position
        x = (index % this.zoneWidth);
        y = Math.floor(index / this.zoneWidth);
      }

      const screenX = offsetX + x * tileSize;
      const screenY = offsetY + y * tileSize;

      // Render sprite (placeholder)
      ctx.fillStyle = sprite.spriteData?.solid ? '#ff6600' : '#00ccff';
      ctx.fillRect(screenX, screenY, tileSize, tileSize);

      if (sprite.spriteData?.solid) {
        ctx.strokeStyle = '#ff3300';
        ctx.strokeRect(screenX, screenY, tileSize, tileSize);
      }
    });
  }

  renderPlayer(ctx, offsetX, offsetY, tileSize) {
    const screenX = offsetX + this.player.x * tileSize;
    const screenY = offsetY + this.player.y * tileSize;
    const size = this.player.width * tileSize;

    // Player body
    ctx.fillStyle = this.player.color;
    ctx.beginPath();
    ctx.arc(screenX, screenY, size / 2, 0, Math.PI * 2);
    ctx.fill();

    // Player glow
    ctx.strokeStyle = this.player.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screenX, screenY, size / 2 + 2, 0, Math.PI * 2);
    ctx.stroke();

    // Direction indicator (facing right by default)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(screenX + size / 4, screenY, 2, 0, Math.PI * 2);
    ctx.fill();

    // Player name (if character data exists)
    if (this.characterData) {
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.characterData.name, screenX, screenY - size);
    }
  }

  renderOtherPlayers(ctx, offsetX, offsetY, tileSize) {
    // Render all other players in the zone
    this.otherPlayers.forEach((player, characterId) => {
      const screenX = offsetX + player.x * tileSize;
      const screenY = offsetY + player.y * tileSize;
      const size = 0.8 * tileSize; // Same size as local player

      // Player body
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(screenX, screenY, size / 2, 0, Math.PI * 2);
      ctx.fill();

      // Player glow
      ctx.strokeStyle = player.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screenX, screenY, size / 2 + 2, 0, Math.PI * 2);
      ctx.stroke();

      // Direction indicator
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(screenX + size / 4, screenY, 2, 0, Math.PI * 2);
      ctx.fill();

      // Player name
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(player.name, screenX, screenY - size);

      // Velocity indicator (if moving)
      if (player.vx !== 0 || player.vy !== 0) {
        const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
        if (speed > 0.01) {
          ctx.strokeStyle = player.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(screenX, screenY);
          ctx.lineTo(
            screenX + (player.vx / speed) * size,
            screenY + (player.vy / speed) * size
          );
          ctx.stroke();
        }
      }
    });
  }

  renderVirtualJoystick(ctx) {
    // Render touch joystick visualization
    const baseRadius = 50;
    const stickRadius = 25;

    // Base circle (where finger touched)
    ctx.fillStyle = 'rgba(138, 79, 255, 0.2)';
    ctx.strokeStyle = 'rgba(138, 79, 255, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.touch.startX, this.touch.startY, baseRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Stick circle (current touch position)
    const deltaX = this.touch.currentX - this.touch.startX;
    const deltaY = this.touch.currentY - this.touch.startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Clamp stick to base radius
    let stickX = this.touch.currentX;
    let stickY = this.touch.currentY;
    if (distance > baseRadius) {
      const angle = Math.atan2(deltaY, deltaX);
      stickX = this.touch.startX + Math.cos(angle) * baseRadius;
      stickY = this.touch.startY + Math.sin(angle) * baseRadius;
    }

    ctx.fillStyle = 'rgba(0, 255, 136, 0.5)';
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stickX, stickY, stickRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Direction line
    if (distance > 10) {
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(this.touch.startX, this.touch.startY);
      ctx.lineTo(stickX, stickY);
      ctx.stroke();
    }

    // Center dot
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(this.touch.startX, this.touch.startY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  checkCollision(x, y) {
    // Check if position collides with walls
    if (!this.zone.zoneData?.layers?.walls) {
      return false; // No walls layer, no collision
    }

    // Check all corners of the player bounding box
    const halfWidth = this.player.width / 2;
    const halfHeight = this.player.height / 2;
    const corners = [
      { x: x - halfWidth, y: y - halfHeight }, // Top-left
      { x: x + halfWidth, y: y - halfHeight }, // Top-right
      { x: x - halfWidth, y: y + halfHeight }, // Bottom-left
      { x: x + halfWidth, y: y + halfHeight }  // Bottom-right
    ];

    const walls = this.zone.zoneData.layers.walls;

    for (const corner of corners) {
      const tileX = Math.floor(corner.x);
      const tileY = Math.floor(corner.y);

      // Check bounds
      if (tileY >= 0 && tileY < walls.length &&
          tileX >= 0 && tileX < walls[tileY].length) {
        // If wall tile exists (non-zero value), collision!
        if (walls[tileY][tileX] !== 0) {
          return true;
        }
      }
    }

    return false;
  }

  renderMarkers(ctx, offsetX, offsetY, tileSize) {
    // Render loot, NPC, exit, and hazard markers from zoneData
    if (!this.zone.zoneData) return;

    const markers = [
      { points: this.zone.zoneData.lootPoints || [], color: '#ffff00', symbol: '💰', label: 'LOOT' },
      { points: this.zone.zoneData.npcPoints || [], color: '#ff00ff', symbol: '👤', label: 'NPC' },
      { points: this.zone.zoneData.exitPoints || [], color: '#00ffff', symbol: '🚪', label: 'EXIT' },
      { points: this.zone.zoneData.hazardPoints || [], color: '#ff0000', symbol: '⚠️', label: 'HAZARD' }
    ];

    markers.forEach(markerType => {
      markerType.points.forEach(point => {
        const screenX = offsetX + (point.x + 0.5) * tileSize;
        const screenY = offsetY + (point.y + 0.5) * tileSize;

        // Draw marker circle
        ctx.fillStyle = markerType.color;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(screenX, screenY, tileSize * 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Draw border
        ctx.strokeStyle = markerType.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(screenX, screenY, tileSize * 0.3, 0, Math.PI * 2);
        ctx.stroke();

        // Draw label (small text)
        ctx.fillStyle = '#000';
        ctx.font = `${tileSize * 0.25}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(markerType.label[0], screenX, screenY);
        ctx.globalAlpha = 1;
      });
    });
  }

  renderBoundaries(ctx, offsetX, offsetY, tileSize) {
    // Render zone boundaries
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(
      offsetX,
      offsetY,
      this.zoneWidth * tileSize,
      this.zoneHeight * tileSize
    );
  }
}

// Initialize renderer when page loads
window.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Starting Zone Renderer...');
  window.zoneRenderer = new ZoneRenderer();
});
