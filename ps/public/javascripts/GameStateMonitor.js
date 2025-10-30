/**
 * GameStateMonitor Service
 *
 * Centralized coordinate and state management for all game views.
 * This service acts as the single source of truth for player positions,
 * asset locations, and real-time spatial updates.
 *
 * Key Features:
 * - Centralized coordinate tracking for all entities
 * - Real-time updates via Socket.IO
 * - State perpetuation across views
 * - Physics integration with server-side physics service
 * - Event-driven architecture for view updates
 *
 * Authority Model:
 * - galactic-map-3d is the AUTHORITATIVE view for real-time spatial updates
 * - All other views CONSUME coordinates from this service
 * - Physics calculations happen server-side and are propagated here
 */

class GameStateMonitor {
  constructor() {
    // State storage
    this.players = new Map(); // characterId -> player state
    this.assets = new Map(); // assetId -> asset state
    this.celestialBodies = new Map(); // bodyId -> celestial body state

    // Connection state
    this.socket = null;
    this.connected = false;
    this.currentCharacterId = null;

    // Update tracking
    this.lastUpdateTime = Date.now();
    this.updateInterval = null;
    this.tickRate = 25; // 40 updates per second (2x faster for smoother updates)

    // Event listeners for views to subscribe to
    this.listeners = {
      playerPositionUpdate: [],
      playerJoined: [],
      playerLeft: [],
      assetUpdate: [],
      stateSync: []
    };

    console.log('🎮 GameStateMonitor initialized');
  }

  /**
   * Initialize the monitor with socket connection
   */
  init(socket, currentCharacterId) {
    if (this.connected) {
      console.warn('⚠️ GameStateMonitor already initialized');
      return;
    }

    this.socket = socket;
    this.currentCharacterId = currentCharacterId;
    this.connected = true;

    this.setupSocketListeners();
    this.startUpdateLoop();
    this.startPolling();

    console.log('✅ GameStateMonitor connected for character:', currentCharacterId);
  }

  /**
   * Setup socket event listeners
   */
  setupSocketListeners() {
    if (!this.socket) return;

    // Player movement updates (real-time from galactic-map-3d)
    this.socket.on('playerMoved', (data) => {
      this.updatePlayerPosition(data.characterId, data.location, data.characterName);
    });

    // Character location updates (from server physics)
    this.socket.on('characterLocationUpdate', (data) => {
      this.updatePlayerPosition(data.characterId, data.location, data.characterName);
    });

    // Online players list
    this.socket.on('onlinePlayers', (players) => {
      players.forEach(player => {
        if (player.characterId !== this.currentCharacterId && player.location) {
          this.updatePlayerPosition(player.characterId, player.location, player.characterName);
        }
      });

      // Notify listeners of state sync
      this.emit('stateSync', { players: Array.from(this.players.values()) });
    });

    // Character joined
    this.socket.on('characterJoined', (data) => {
      if (data.characterId !== this.currentCharacterId && data.location) {
        this.updatePlayerPosition(data.characterId, data.location, data.characterName);
        this.emit('playerJoined', data);
      }
    });

    // Character left
    this.socket.on('characterLeft', (data) => {
      if (this.players.has(data.characterId)) {
        this.players.delete(data.characterId);
        this.emit('playerLeft', data);
      }
    });

    // Character docked
    this.socket.on('characterDocked', (data) => {
      if (data.characterId !== this.currentCharacterId) {
        this.updatePlayerPosition(data.characterId, data.location, data.characterName);
      }
    });

    // Character undocked
    this.socket.on('characterUndocked', (data) => {
      if (data.characterId !== this.currentCharacterId) {
        this.updatePlayerPosition(data.characterId, data.location, data.characterName);
      }
    });

    console.log('🔌 Socket listeners registered');
  }

  /**
   * Start the update loop for interpolation and state management
   */
  startUpdateLoop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.tick();
    }, this.tickRate);

    console.log(`⏱️ Update loop started at ${1000 / this.tickRate} ticks/sec`);
  }

  /**
   * Update tick - called every tickRate milliseconds
   */
  tick() {
    const now = Date.now();
    const deltaTime = (now - this.lastUpdateTime) / 1000; // Convert to seconds
    this.lastUpdateTime = now;

    // Interpolate player positions based on velocity
    this.players.forEach((player, characterId) => {
      if (player.velocity && (player.velocity.x || player.velocity.y || player.velocity.z)) {
        // Apply velocity to position
        player.position.x += player.velocity.x * deltaTime;
        player.position.y += player.velocity.y * deltaTime;
        player.position.z += player.velocity.z * deltaTime;

        // Notify listeners of position update
        this.emit('playerPositionUpdate', {
          characterId,
          position: { ...player.position },
          velocity: { ...player.velocity },
          characterName: player.characterName
        });
      }
    });
  }

  /**
   * Update a player's position
   */
  updatePlayerPosition(characterId, location, characterName = null) {
    if (!characterId || !location) return;

    const existingPlayer = this.players.get(characterId);

    const playerState = {
      characterId,
      characterName: characterName || existingPlayer?.characterName || 'Unknown',
      position: {
        x: location.x || 0,
        y: location.y || 0,
        z: location.z || 0
      },
      velocity: {
        x: location.vx || 0,
        y: location.vy || 0,
        z: location.vz || 0
      },
      assetId: location.assetId || null,
      lastUpdated: Date.now()
    };

    this.players.set(characterId, playerState);

    // Notify listeners
    this.emit('playerPositionUpdate', playerState);
  }

  /**
   * Update current player position (from authoritative galactic-map-3d)
   */
  updateCurrentPlayerPosition(position, velocity = null) {
    if (!this.currentCharacterId) return;

    const location = {
      x: position.x,
      y: position.y,
      z: position.z,
      vx: velocity?.x || 0,
      vy: velocity?.y || 0,
      vz: velocity?.z || 0
    };

    // Emit to server for other players
    if (this.socket) {
      this.socket.emit('playerMove', {
        characterId: this.currentCharacterId,
        characterName: window.currentCharacter?.name || 'Unknown',
        location
      });
    }

    // Update local state
    this.updatePlayerPosition(this.currentCharacterId, location);
  }

  /**
   * Get a player's current state
   */
  getPlayerState(characterId) {
    return this.players.get(characterId);
  }

  /**
   * Get all players
   */
  getAllPlayers() {
    return Array.from(this.players.values());
  }

  /**
   * Get all players except current
   */
  getOtherPlayers() {
    return this.getAllPlayers().filter(p => p.characterId !== this.currentCharacterId);
  }

  /**
   * Register an asset's position
   */
  registerAsset(assetId, position, assetData = {}) {
    this.assets.set(assetId, {
      assetId,
      position: {
        x: position.x || 0,
        y: position.y || 0,
        z: position.z || 0
      },
      ...assetData,
      lastUpdated: Date.now()
    });
  }

  /**
   * Get asset position
   */
  getAssetPosition(assetId) {
    const asset = this.assets.get(assetId);
    return asset ? asset.position : null;
  }

  /**
   * Subscribe to an event
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    } else {
      console.warn(`⚠️ Unknown event: ${event}`);
    }
  }

  /**
   * Unsubscribe from an event
   */
  off(event, callback) {
    if (this.listeners[event]) {
      const index = this.listeners[event].indexOf(callback);
      if (index > -1) {
        this.listeners[event].splice(index, 1);
      }
    }
  }

  /**
   * Emit an event to all listeners
   */
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Start perpetual polling for state sync (backup to socket updates)
   */
  startPolling() {
    // Poll server every 5 seconds for full state sync
    this.pollingInterval = setInterval(async () => {
      try {
        const response = await fetch('/api/v1/state/galactic-state');
        const data = await response.json();

        if (data.success) {
          // Update galaxy positions from server
          if (data.galaxies && window.galacticMap) {
            data.galaxies.forEach(galaxy => {
              const asset = window.galacticMap.assets.get(galaxy._id);
              if (asset && asset.mesh) {
                asset.mesh.position.set(
                  galaxy.coordinates.x,
                  galaxy.coordinates.y,
                  galaxy.coordinates.z
                );

                // Update physics if available
                if (galaxy.physics && !asset.physics) {
                  asset.physics = {};
                }
                if (galaxy.physics) {
                  asset.physics.vx = galaxy.physics.vx || 0;
                  asset.physics.vy = galaxy.physics.vy || 0;
                  asset.physics.vz = galaxy.physics.vz || 0;
                }
              }
            });
            console.log('🔄 Polled and synced galaxy states from server');
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 5000); // Every 5 seconds

    console.log('🔄 State polling started (every 5s)');
  }

  /**
   * Cleanup and disconnect
   */
  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.connected = false;
    this.players.clear();
    this.assets.clear();

    // Clear all listeners
    Object.keys(this.listeners).forEach(event => {
      this.listeners[event] = [];
    });

    console.log('🛑 GameStateMonitor destroyed');
  }

  /**
   * Get monitoring statistics
   */
  getStats() {
    return {
      connected: this.connected,
      playerCount: this.players.size,
      assetCount: this.assets.size,
      currentCharacterId: this.currentCharacterId,
      tickRate: this.tickRate,
      uptime: Date.now() - this.lastUpdateTime
    };
  }
}

// Create singleton instance
if (!window.gameStateMonitor) {
  window.gameStateMonitor = new GameStateMonitor();
  console.log('🌐 Global GameStateMonitor instance created');
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameStateMonitor;
}
