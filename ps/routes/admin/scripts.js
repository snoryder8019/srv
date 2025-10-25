/**
 * Admin Script Execution API
 * Provides endpoints to execute database and seeding scripts
 */
import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(__dirname, '../../scripts');

// Middleware to check if user is admin
function isAdmin(req, res, next) {
  if (!req.user || req.user.isAdmin !== true) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Script categories with their scripts
const SCRIPT_CATEGORIES = {
  'Database Checks': [
    { name: 'Check Asset Coordinates', file: 'check-asset-coords.js', description: 'View asset positions in database' },
    { name: 'Check Galaxies', file: 'check-galaxies.js', description: 'List all galaxies' },
    { name: 'Check Galaxy Stars', file: 'check-galaxy-stars.js', description: 'View stars in each galaxy' },
    { name: 'Check Zones', file: 'check-zones.js', description: 'List all zones and hubs' },
    { name: 'Check Star Status', file: 'check-star-status.js', description: 'View star approval status' },
    { name: 'Check Character Location', file: 'check-character-location.js', description: 'View character positions' }
  ],
  'Galaxy Seeding': [
    { name: 'Seed All Galaxies', file: 'seed-all-galaxies.js', description: 'Create all galaxy systems', confirm: true },
    { name: 'Seed Andromeda', file: 'seed-andromeda.js', description: 'Populate Andromeda Spiral' },
    { name: 'Seed Elysium Cluster', file: 'seed-elysium-cluster.js', description: 'Populate Elysium Cluster' },
    { name: 'Seed Elysium Planets', file: 'seed-elysium-planets.js', description: 'Add planets to Elysium' },
    { name: 'Seed Crimson Nebula Stars', file: 'seed-crimson-nebula-stars.js', description: 'Add stars to Crimson Nebula' },
    { name: 'Seed Crimson Planets', file: 'seed-crimson-planets.js', description: 'Add planets to Crimson stars' },
    { name: 'Seed Quantum Singularity', file: 'seed-quantum-singularity.js', description: 'Create Quantum Singularity galaxy' }
  ],
  'Asset Management': [
    { name: 'Create Field Test Assets', file: 'seed-field-test-assets.js', description: 'Create starter equipment' },
    { name: 'Equip All Characters', file: 'equip-all-characters.js', description: 'Give field test gear to all characters' },
    { name: 'Publish Galaxies & Stars', file: 'publish-galaxies-stars.js', description: 'Make galaxies/stars visible' },
    { name: 'Create Space Hubs', file: 'create-space-hubs.js', description: 'Generate faction hubs' },
    { name: 'Create Sample Assets', file: 'create-sample-assets.js', description: 'Generate test assets' }
  ],
  'Database Fixes': [
    { name: 'Fix Galaxy Coordinates', file: 'fix-galaxy-coordinates.js', description: 'Set proper galaxy positions', confirm: true },
    { name: 'Fix Crimson Stars Status', file: 'fix-crimson-stars-status.js', description: 'Approve Crimson Nebula stars' },
    { name: 'Fix Hub Status', file: 'fix-hub-status.js', description: 'Repair hub data' },
    { name: 'Fix Orbital Relationships', file: 'fix-orbital-planetary-relationships-v2.js', description: 'Link orbitals to planets' },
    { name: 'Add Missing Locations', file: 'add-missing-locations.js', description: 'Add location data to assets' }
  ],
  'User Management': [
    { name: 'Make Admin', file: 'make-admin.js', description: 'Grant admin privileges', requiresInput: 'username' },
    { name: 'Remove Admin', file: 'remove-admin.js', description: 'Revoke admin privileges', requiresInput: 'username' },
    { name: 'Add User Roles', file: 'add-user-roles.js', description: 'Initialize user role system' },
    { name: 'Initialize User Analytics', file: 'initialize-user-analytics.js', description: 'Set up analytics tracking' },
    { name: 'Get User Info', file: 'get-user-info.js', description: 'View user details', requiresInput: 'username' }
  ],
  'Database Maintenance': [
    { name: 'Cleanup Space', file: 'cleanup-space.js', description: 'Free up MongoDB storage', confirm: true },
    { name: 'Reset Planet Generation', file: 'reset-planet-generation.js', description: 'Clear planet chunks', confirm: true },
    { name: 'Reset Galactic Map', file: 'reset-galactic-map.js', description: 'Clear all positions', confirm: true },
    { name: 'Reset All Characters', file: 'reset-all-characters.js', description: 'Reset character data', confirm: true }
  ],
  'Verification': [
    { name: 'Verify Elysium Planets', file: 'verify-elysium-planets.js', description: 'Check Elysium seeding' },
    { name: 'Verify Crimson Nebula', file: 'verify-crimson-nebula.js', description: 'Check Crimson seeding' },
    { name: 'Verify Distributed Assets', file: 'verify-distributed-assets.js', description: 'Check asset distribution' },
    { name: 'List Zones Detailed', file: 'list-zones-detailed.js', description: 'Show detailed zone info' }
  ]
};

/**
 * GET /admin/scripts/categories
 * Get all script categories and their scripts
 */
router.get('/categories', isAdmin, (req, res) => {
  res.json({
    success: true,
    categories: SCRIPT_CATEGORIES
  });
});

/**
 * POST /admin/scripts/execute
 * Execute a script by filename
 */
router.post('/execute', isAdmin, async (req, res) => {
  const { scriptFile, args = [] } = req.body;

  if (!scriptFile) {
    return res.status(400).json({ error: 'Script file is required' });
  }

  // Security: Only allow scripts from our defined categories
  const allScripts = Object.values(SCRIPT_CATEGORIES).flat();
  const scriptConfig = allScripts.find(s => s.file === scriptFile);

  if (!scriptConfig) {
    return res.status(400).json({ error: 'Invalid script file' });
  }

  const scriptPath = path.join(scriptsDir, scriptFile);

  try {
    // Stream response for real-time output
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

    const nodeProcess = spawn('node', [scriptPath, ...args], {
      cwd: path.join(__dirname, '../..'),
      env: { ...process.env }
    });

    // Send output in real-time
    nodeProcess.stdout.on('data', (data) => {
      res.write(data.toString());
    });

    nodeProcess.stderr.on('data', (data) => {
      res.write(`ERROR: ${data.toString()}`);
    });

    nodeProcess.on('close', (code) => {
      res.write(`\n\n--- Script completed with exit code ${code} ---`);
      res.end();
    });

    nodeProcess.on('error', (error) => {
      res.write(`\n\nERROR: ${error.message}`);
      res.end();
    });

  } catch (error) {
    res.write(`\n\nEXECUTION ERROR: ${error.message}`);
    res.end();
  }
});

export default router;
