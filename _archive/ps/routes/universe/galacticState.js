// Galactic State - 5000x5000 2D figurative space with moving zones and orbitals
// ASCII map visualization with basic dots
// NOW WITH DATABASE PERSISTENCE - survives server restarts!

import express from 'express';
const router = express.Router();
import { GalacticState } from '../../api/v1/models/GalacticState.js';

// Configuration
const VIEW_WIDTH = 80;  // Terminal width for ASCII display
const VIEW_HEIGHT = 40; // Terminal height for ASCII display

// Load state from database on startup
let zones = [];
let SPACE_WIDTH = 5000;
let SPACE_HEIGHT = 5000;
let lastSaveTime = 0;
const SAVE_INTERVAL = 5000; // Save to DB every 5 seconds

// Initialize state (DB loading disabled - using static zones for legacy route)
async function initializeState() {
  // This route is deprecated - use /universe/galactic-map for new physics map
  // Using static zones for legacy ASCII display only
  zones = [
    { id: 1, x: 1250, y: 1250, vx: 0.5, vy: 0.3, symbol: '●', name: 'Alpha' },
    { id: 2, x: 3750, y: 1250, vx: -0.3, vy: 0.5, symbol: '◆', name: 'Beta' },
    { id: 3, x: 1250, y: 3750, vx: 0.4, vy: -0.4, symbol: '■', name: 'Gamma' },
    { id: 4, x: 3750, y: 3750, vx: -0.5, vy: -0.3, symbol: '★', name: 'Delta' }
  ];
  console.log('✓ Legacy galactic state initialized (static zones)');
}

// Initialize on module load
initializeState();

// Update zone positions (DB saving disabled - using new galactic map system)
async function updateZones() {
    zones.forEach(zone => {
        zone.x += zone.vx;
        zone.y += zone.vy;

        // Bounce off boundaries
        if (zone.x <= 0 || zone.x >= SPACE_WIDTH) {
            zone.vx *= -1;
            zone.x = Math.max(0, Math.min(SPACE_WIDTH, zone.x));
        }
        if (zone.y <= 0 || zone.y >= SPACE_HEIGHT) {
            zone.vy *= -1;
            zone.y = Math.max(0, Math.min(SPACE_HEIGHT, zone.y));
        }
    });

    // DB saving disabled - this old route is deprecated
    // Use /universe/galactic-map for the new physics-based map
}

// Helper function to draw a line between two points (Bresenham's algorithm)
function drawLine(map, x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
        // Don't overwrite zone symbols
        if (x >= 0 && x < VIEW_WIDTH && y >= 0 && y < VIEW_HEIGHT) {
            const current = map[y][x];
            if (current === '·' || current === '─' || current === '│' || current === '┼') {
                // Determine line character based on direction
                if (Math.abs(x1 - x0) > Math.abs(y1 - y0)) {
                    map[y][x] = '─';
                } else {
                    map[y][x] = '│';
                }
                // Mark intersections
                if (current === '─' && map[y][x] === '│') {
                    map[y][x] = '┼';
                } else if (current === '│' && map[y][x] === '─') {
                    map[y][x] = '┼';
                }
            }
        }

        if (x === x1 && y === y1) break;

        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x += sx;
        }
        if (e2 < dx) {
            err += dx;
            y += sy;
        }
    }
}

// Helper function to write text on map
function writeText(map, x, y, text) {
    for (let i = 0; i < text.length; i++) {
        const tx = x + i;
        if (tx >= 0 && tx < VIEW_WIDTH && y >= 0 && y < VIEW_HEIGHT) {
            map[y][tx] = text[i];
        }
    }
}

// Generate ASCII map
function generateASCIIMap(centerX = SPACE_WIDTH / 2, centerY = SPACE_HEIGHT / 2, scale = 1) {
    const map = [];

    // Initialize empty map
    for (let row = 0; row < VIEW_HEIGHT; row++) {
        map[row] = new Array(VIEW_WIDTH).fill('·');
    }

    // Calculate viewport bounds
    const viewPortWidth = (VIEW_WIDTH / 2) * scale;
    const viewPortHeight = (VIEW_HEIGHT / 2) * scale;

    const minX = centerX - viewPortWidth;
    const maxX = centerX + viewPortWidth;
    const minY = centerY - viewPortHeight;
    const maxY = centerY + viewPortHeight;

    // Store zone screen positions for later reference
    const zonePositions = [];

    // Plot zones
    zones.forEach(zone => {
        // Convert world coordinates to screen coordinates
        const screenX = Math.floor(((zone.x - minX) / (maxX - minX)) * VIEW_WIDTH);
        const screenY = Math.floor(((zone.y - minY) / (maxY - minY)) * VIEW_HEIGHT);

        // Check if zone is visible in viewport
        if (screenX >= 0 && screenX < VIEW_WIDTH && screenY >= 0 && screenY < VIEW_HEIGHT) {
            zonePositions.push({ zone, screenX, screenY });
        }
    });

    // Draw telemetry lines from zones to edges (different edge per zone)
    zonePositions.forEach(({ zone, screenX, screenY }, idx) => {
        let targetX, targetY;

        // Different anchor points for each zone
        switch (zone.id) {
            case 1: // Alpha - top left
                targetX = 5;
                targetY = 2;
                break;
            case 2: // Beta - top right
                targetX = VIEW_WIDTH - 10;
                targetY = 2;
                break;
            case 3: // Gamma - bottom left
                targetX = 5;
                targetY = VIEW_HEIGHT - 3;
                break;
            case 4: // Delta - bottom right
                targetX = VIEW_WIDTH - 10;
                targetY = VIEW_HEIGHT - 3;
                break;
            default:
                targetX = VIEW_WIDTH - 10;
                targetY = 5 + (idx * 8);
        }

        // Draw line from zone to target
        drawLine(map, screenX, screenY, targetX, targetY);

        // Write zone label near the target
        const label = `${zone.symbol} ${zone.name}`;
        writeText(map, targetX + 2, targetY, label);

        // Write coordinates next to label
        const coords = `(${Math.floor(zone.x)},${Math.floor(zone.y)})`;
        writeText(map, targetX + 2, targetY + 1, coords);
    });

    // Draw zones last so they appear on top
    zonePositions.forEach(({ zone, screenX, screenY }) => {
        map[screenY][screenX] = zone.symbol;
    });

    // Convert to string
    let output = '';
    output += '┌' + '─'.repeat(VIEW_WIDTH) + '┐\n';

    for (let row = 0; row < VIEW_HEIGHT; row++) {
        output += '│' + map[row].join('') + '│\n';
    }

    output += '└' + '─'.repeat(VIEW_WIDTH) + '┘\n';

    return output;
}

// Generate status info
function generateStatus() {
    let status = '\nZone Status:\n';
    zones.forEach(zone => {
        status += `${zone.symbol} ${zone.name} (ID:${zone.id}): `;
        status += `Position: (${Math.floor(zone.x)}, ${Math.floor(zone.y)}) `;
        status += `Velocity: (${zone.vx.toFixed(2)}, ${zone.vy.toFixed(2)})\n`;
    });
    return status;
}

// API Routes

// Get ASCII map
router.get('/map', (req, res) => {
    const centerX = parseFloat(req.query.x) || SPACE_WIDTH / 2;
    const centerY = parseFloat(req.query.y) || SPACE_HEIGHT / 2;
    const scale = parseFloat(req.query.scale) || 25;

    const map = generateASCIIMap(centerX, centerY, scale);
    const status = generateStatus();

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(`Galactic State - ${SPACE_WIDTH}x${SPACE_HEIGHT} Space\nScale: ${scale}x | Center: (${Math.floor(centerX)}, ${Math.floor(centerY)})\n\n${map}${status}`);
});

// Get current state as JSON
router.get('/state', (req, res) => {
    res.json({
        spaceWidth: SPACE_WIDTH,
        spaceHeight: SPACE_HEIGHT,
        zones: zones,
        timestamp: Date.now()
    });
});

// Update simulation (call this periodically)
router.post('/tick', (req, res) => {
    updateZones();
    res.json({ success: true, zones: zones });
});

// Reset zones to initial positions
router.post('/reset', async (req, res) => {
    try {
      const state = await GalacticState.resetState();
      zones = state.zones;
      SPACE_WIDTH = state.spaceWidth;
      SPACE_HEIGHT = state.spaceHeight;
      res.json({ success: true, message: 'Zones reset to initial positions', zones: zones });
    } catch (error) {
      console.error('Failed to reset galactic state:', error);
      res.status(500).json({ success: false, error: 'Failed to reset state' });
    }
});

// Auto-update zones every 100ms
setInterval(updateZones, 100);

export default router;
