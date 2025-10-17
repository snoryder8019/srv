// Galactic State - 1000x1000 2D figurative space with moving zones
// ASCII map visualization with basic dots

import express from 'express';
const router = express.Router();

// Configuration
const SPACE_WIDTH = 1000;
const SPACE_HEIGHT = 1000;
const VIEW_WIDTH = 80;  // Terminal width for ASCII display
const VIEW_HEIGHT = 40; // Terminal height for ASCII display

// Four zones with initial positions and velocities
let zones = [
    { id: 1, x: 250, y: 250, vx: 0.5, vy: 0.3, symbol: '●', name: 'Alpha' },
    { id: 2, x: 750, y: 250, vx: -0.3, vy: 0.5, symbol: '◆', name: 'Beta' },
    { id: 3, x: 250, y: 750, vx: 0.4, vy: -0.4, symbol: '■', name: 'Gamma' },
    { id: 4, x: 750, y: 750, vx: -0.5, vy: -0.3, symbol: '★', name: 'Delta' }
];

// Update zone positions
function updateZones() {
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
    res.send(`Galactic State - 1000x1000 Space\nScale: ${scale}x | Center: (${Math.floor(centerX)}, ${Math.floor(centerY)})\n\n${map}${status}`);
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
router.post('/reset', (req, res) => {
    zones = [
        { id: 1, x: 250, y: 250, vx: 0.5, vy: 0.3, symbol: '●', name: 'Alpha' },
        { id: 2, x: 750, y: 250, vx: -0.3, vy: 0.5, symbol: '◆', name: 'Beta' },
        { id: 3, x: 250, y: 750, vx: 0.4, vy: -0.4, symbol: '■', name: 'Gamma' },
        { id: 4, x: 750, y: 750, vx: -0.5, vy: -0.3, symbol: '★', name: 'Delta' }
    ];
    res.json({ success: true, message: 'Zones reset to initial positions' });
});

// Auto-update zones every 100ms
setInterval(updateZones, 100);

export default router;
