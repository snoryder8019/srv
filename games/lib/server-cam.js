/**
 * Server Camera — 2D Map Overlay System
 * Provides real-time player positions + events for broadcast overlay
 *
 * Rust: RCON playerlistpos for positions on procedural map
 * 7DTD: Web dashboard already handles this (port 8080)
 * L4D2: SourceTV handles spectating (port 27020)
 * Valheim: Log-based player tracking (no position data without mod)
 */

const rust = require('./rust');

// Rust map config (from start-rust.sh defaults)
const RUST_WORLD_SIZE = parseInt(process.env.RUST_WORLD_SIZE) || 2500;
const RUST_SEED = parseInt(process.env.RUST_SEED) || 12345;

// Cache player positions (updated by polling)
let rustPlayers = [];
let rustEvents = [];
let lastPoll = 0;
const MAX_EVENTS = 50;

// Poll player positions via RCON
async function pollRustPositions() {
  if (!rust.isRunning()) {
    rustPlayers = [];
    return;
  }
  try {
    // playerlistpos returns: SteamID DisplayName Pos(x, y, z) Rot(x, y, z)
    const raw = await rust.rconCommand('playerlistpos');
    rustPlayers = parsePlayerPositions(raw);
    lastPoll = Date.now();
  } catch {
    // RCON not available
  }
}

function parsePlayerPositions(raw) {
  const players = [];
  const lines = (raw || '').split('\n');
  for (const line of lines) {
    // Format: SteamID "DisplayName" Pos(x, y, z) Rot(x, y, z)
    const match = line.match(/(\d{17})\s+"(.+?)"\s+Pos\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/i);
    if (match) {
      players.push({
        steamId: match[1],
        name: match[2],
        x: parseFloat(match[3]),
        y: parseFloat(match[4]),
        z: parseFloat(match[5]),
      });
    }
  }
  return players;
}

// Track kill/death events from stats collector
function addEvent(event) {
  if (event.game !== 'rust') return;
  if (!['kill', 'death', 'chat'].includes(event.type)) return;
  rustEvents.push({
    type: event.type,
    ts: event.ts || Date.now(),
    name: event.name || event.attacker || null,
    victim: event.victim || null,
    message: event.message || null,
    x: event.x || null,
    z: event.z || null,
  });
  if (rustEvents.length > MAX_EVENTS) rustEvents = rustEvents.slice(-MAX_EVENTS);
}

// Get current state for the overlay
function getRustMapState() {
  return {
    game: 'rust',
    worldSize: RUST_WORLD_SIZE,
    seed: RUST_SEED,
    mapUrl: `https://rustmaps.com/map/${RUST_WORLD_SIZE}_${RUST_SEED}`,
    mapImage: '/static/img/rust-map.png',
    players: rustPlayers,
    events: rustEvents.slice(-20),
    serverRunning: rust.isRunning(),
    lastPoll,
    ts: Date.now(),
  };
}

// Get overview for all games with server-cam capability
function getCamStatus() {
  return {
    rust: {
      type: 'map-overlay',
      available: rust.isRunning(),
      playerCount: rustPlayers.length,
      endpoint: '/server-cam/rust',
    },
    '7dtd': {
      type: 'web-dashboard',
      available: true,
      endpoint: 'http://localhost:8080',
      note: 'Built-in 7DTD web dashboard with live map',
    },
    l4d2: {
      type: 'sourcetv',
      available: true,
      port: 27020,
      note: 'SourceTV spectator — connect via game client to port 27020',
    },
  };
}

let pollInterval = null;

function init() {
  if (pollInterval) return;
  // Poll every 5 seconds when Rust is running
  pollInterval = setInterval(() => {
    if (rust.isRunning()) pollRustPositions();
  }, 5000);
  // Initial poll
  pollRustPositions();
  console.log('[server-cam] Initialized — polling Rust positions every 5s');
}

module.exports = {
  init,
  pollRustPositions,
  addEvent,
  getRustMapState,
  getCamStatus,
};
