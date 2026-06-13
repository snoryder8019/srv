/**
 * Game State Microservice
 * Provides real-time game state via REST API and SSE streaming
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GameStateManager } from './gameStateEnhanced.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3500;

// Initialize game state manager
const gameState = new GameStateManager();

// Middleware
// Allow all origins for now - this is a public read-only API
app.use(cors({
  origin: true,  // Reflects the origin back
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});

/**
 * GET /api/state
 * Get current game state snapshot
 */
app.get('/api/state', (req, res) => {
  res.json({
    success: true,
    state: gameState.getCurrentState(),
    timestamp: Date.now()
  });
});

/**
 * GET /api/state/galactic
 * Get galactic state
 */
app.get('/api/state/galactic', (req, res) => {
  res.json({
    success: true,
    galacticState: gameState.getGalacticState(),
    timestamp: Date.now()
  });
});

/**
 * GET /api/state/events
 * Get current active events
 */
app.get('/api/state/events', (req, res) => {
  res.json({
    success: true,
    events: gameState.getActiveEvents(),
    timestamp: Date.now()
  });
});

/**
 * GET /api/state/factions
 * Get faction standings
 */
app.get('/api/state/factions', (req, res) => {
  res.json({
    success: true,
    factions: gameState.getFactionStandings(),
    timestamp: Date.now()
  });
});

/**
 * GET /api/state/planetary
 * Get planetary grid data (chunked)
 */
app.get('/api/state/planetary', (req, res) => {
  const { chunk = 0, chunkSize = 50 } = req.query;
  const planetaryData = gameState.getPlanetaryData(parseInt(chunk), parseInt(chunkSize));

  res.json({
    success: true,
    chunk: parseInt(chunk),
    chunkSize: parseInt(chunkSize),
    total: planetaryData.total,
    hasMore: planetaryData.hasMore,
    zones: planetaryData.zones,
    timestamp: Date.now()
  });
});

/**
 * GET /api/config
 * Get current game configuration
 */
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    config: gameState.getConfig(),
    timestamp: Date.now()
  });
});

/**
 * POST /api/config
 * Update game configuration (Admin only - add auth later)
 */
app.post('/api/config', (req, res) => {
  try {
    const newConfig = gameState.updateConfig(req.body);
    res.json({
      success: true,
      message: 'Configuration updated and simulation restarted',
      config: newConfig,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/restart
 * Restart the simulation with current config
 */
app.post('/api/restart', (req, res) => {
  gameState.restart();
  res.json({
    success: true,
    message: 'Simulation restarted',
    config: gameState.getConfig(),
    timestamp: Date.now()
  });
});

/**
 * GET /api/spatial/assets
 * Get all spatial asset positions
 */
app.get('/api/spatial/assets', (req, res) => {
  res.json({
    success: true,
    assets: gameState.getSpatialAssets(),
    timestamp: Date.now()
  });
});

/**
 * POST /api/spatial/assets
 * Update spatial asset positions (from map client)
 */
app.post('/api/spatial/assets', (req, res) => {
  try {
    const { assets } = req.body;
    gameState.updateSpatialAssets(assets);
    res.json({
      success: true,
      message: 'Spatial assets updated',
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/spatial/assets
 * Clear all spatial asset positions (for reset/randomization)
 */
app.delete('/api/spatial/assets', (req, res) => {
  try {
    const result = gameState.clearSpatialAssets();
    res.json({
      success: true,
      message: 'All spatial assets cleared - map will regenerate random positions',
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/spatial/connections
 * Get travel connections between nearby assets
 */
app.get('/api/spatial/connections', (req, res) => {
  const { maxDistance = 300 } = req.query;
  res.json({
    success: true,
    connections: gameState.calculateTravelConnections(parseFloat(maxDistance)),
    timestamp: Date.now()
  });
});

// ===== CHARACTER ENDPOINTS =====

/**
 * GET /api/characters
 * Get all tracked characters
 */
app.get('/api/characters', (req, res) => {
  res.json({
    success: true,
    characters: gameState.getCharacters(),
    timestamp: Date.now()
  });
});

/**
 * GET /api/characters/:id
 * Get specific character by ID
 */
app.get('/api/characters/:id', (req, res) => {
  const character = gameState.getCharacter(req.params.id);
  if (!character) {
    return res.status(404).json({
      success: false,
      error: 'Character not found'
    });
  }
  res.json({
    success: true,
    character,
    timestamp: Date.now()
  });
});

/**
 * POST /api/characters
 * Update character(s) location and state
 */
app.post('/api/characters', (req, res) => {
  const { characters } = req.body;

  if (!characters || !Array.isArray(characters)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request body. Expected { characters: [...] }'
    });
  }

  gameState.updateCharacters(characters);

  res.json({
    success: true,
    message: `Updated ${characters.length} character(s)`,
    timestamp: Date.now()
  });
});

/**
 * POST /api/characters/:id
 * Update single character
 */
app.post('/api/characters/:id', (req, res) => {
  const characterId = req.params.id;
  const characterData = req.body;

  gameState.updateCharacter(characterId, characterData);

  res.json({
    success: true,
    message: 'Character updated',
    timestamp: Date.now()
  });
});

/**
 * DELETE /api/characters/:id
 * Remove character from tracking
 */
app.delete('/api/characters/:id', (req, res) => {
  const success = gameState.removeCharacter(req.params.id);
  if (!success) {
    return res.status(404).json({
      success: false,
      error: 'Character not found'
    });
  }
  res.json({
    success: true,
    message: 'Character removed from tracking',
    timestamp: Date.now()
  });
});

/**
 * GET /api/characters/:id/nearby
 * Get characters near a specific character
 */
app.get('/api/characters/:id/nearby', (req, res) => {
  const character = gameState.getCharacter(req.params.id);
  if (!character) {
    return res.status(404).json({
      success: false,
      error: 'Character not found'
    });
  }

  const radius = parseInt(req.query.radius) || 100;
  const nearby = gameState.getNearbyCharacters(
    character.location.x,
    character.location.y,
    radius
  );

  res.json({
    success: true,
    characters: nearby,
    radius,
    timestamp: Date.now()
  });
});

/**
 * GET /api/stream/state
 * Server-Sent Events stream for real-time state updates
 */
app.get('/api/stream/state', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial state
  res.write(`data: ${JSON.stringify({
    type: 'init',
    state: gameState.getCurrentState(),
    timestamp: Date.now()
  })}\n\n`);

  // Set up event listener for state changes
  const sendUpdate = (updateData) => {
    res.write(`data: ${JSON.stringify({
      type: 'update',
      ...updateData,
      timestamp: Date.now()
    })}\n\n`);
  };

  // Register this connection
  gameState.addListener(sendUpdate);

  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  // Clean up on close
  req.on('close', () => {
    clearInterval(heartbeat);
    gameState.removeListener(sendUpdate);
  });
});

/**
 * GET /api/stream/events
 * Stream active events
 */
app.get('/api/stream/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial events
  res.write(`data: ${JSON.stringify({
    type: 'init',
    events: gameState.getActiveEvents(),
    timestamp: Date.now()
  })}\n\n`);

  const sendEventUpdate = (event) => {
    res.write(`data: ${JSON.stringify({
      type: 'event',
      event: event,
      timestamp: Date.now()
    })}\n\n`);
  };

  gameState.addEventListener(sendEventUpdate);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    gameState.removeEventListener(sendEventUpdate);
  });
});

/**
 * GET /api/stream/planetary
 * Stream planetary data in chunks
 */
app.get('/api/stream/planetary', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const chunkSize = parseInt(req.query.chunkSize) || 50;
  let currentChunk = 0;

  // Send chunks periodically
  const sendChunk = () => {
    const data = gameState.getPlanetaryData(currentChunk, chunkSize);

    res.write(`data: ${JSON.stringify({
      type: 'chunk',
      chunk: currentChunk,
      total: data.total,
      hasMore: data.hasMore,
      zones: data.zones,
      timestamp: Date.now()
    })}\n\n`);

    if (data.hasMore) {
      currentChunk++;
    } else {
      currentChunk = 0; // Loop back to start
    }
  };

  // Send initial chunk
  sendChunk();

  // Send new chunk every 5 seconds
  const chunkInterval = setInterval(sendChunk, 5000);

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(chunkInterval);
    clearInterval(heartbeat);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎮 Game State Service running on port ${PORT}`);
  console.log(`📡 SSE Stream: http://localhost:${PORT}/api/stream/state`);
  console.log(`🌍 REST API: http://localhost:${PORT}/api/state`);

  // Start game state simulation
  gameState.start();
});

export default app;
