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
  'Quick Checks': [
    { name: 'Quick DB Check', file: 'quick-db-check.js', description: 'Fast database health check' },
    { name: 'Check Galaxies', file: 'check-galaxies.js', description: 'List all galaxies' },
    { name: 'Check Zones', file: 'check-zones.js', description: 'List all zones and hubs' },
    { name: 'Check Character Locations', file: 'check-character-locations.js', description: 'View all character positions' },
    { name: 'Check Asset Types', file: 'check-asset-types.js', description: 'View asset type distribution' }
  ],
  'Galaxy & Universe': [
    { name: 'Seed All Galaxies', file: 'seed-all-galaxies.js', description: 'Create all galaxy systems', confirm: true },
    { name: 'Seed Andromeda', file: 'seed-andromeda.js', description: 'Populate Andromeda Spiral' },
    { name: 'Seed Elysium Cluster', file: 'seed-elysium-cluster.js', description: 'Populate Elysium Cluster' },
    { name: 'Seed Crimson Nebula Stars', file: 'seed-crimson-nebula-stars.js', description: 'Add stars to Crimson Nebula' },
    { name: 'Seed Quantum Singularity', file: 'seed-quantum-singularity.js', description: 'Create Quantum Singularity galaxy' },
    { name: 'Publish Galaxies & Stars', file: 'publish-galaxies-stars.js', description: 'Make galaxies/stars visible' }
  ],
  'Asset Management': [
    { name: 'Sync Assets to Tome', file: 'sync-assets-to-tome.js', description: 'Update Tome archive with approved assets' },
    { name: 'Create Field Test Assets', file: 'seed-field-test-assets.js', description: 'Create starter equipment' },
    { name: 'Equip All Characters', file: 'equip-all-characters.js', description: 'Give field test gear to all characters' },
    { name: 'Create Space Hubs', file: 'create-space-hubs.js', description: 'Generate faction hubs' }
  ],
  'User Management': [
    { name: 'Make Admin', file: 'make-admin.js', description: 'Grant admin privileges', requiresInput: 'username' },
    { name: 'Remove Admin', file: 'remove-admin.js', description: 'Revoke admin privileges', requiresInput: 'username' },
    { name: 'Get User Info', file: 'get-user-info.js', description: 'View user details', requiresInput: 'username' },
    { name: 'Add User Roles', file: 'add-user-roles.js', description: 'Initialize user role system' },
    { name: 'Initialize User Analytics', file: 'initialize-user-analytics.js', description: 'Set up analytics tracking' }
  ],
  'Critical Operations': [
    { name: 'Full Galaxy Reset', file: 'full-galaxy-reset.js', description: 'Complete galaxy & character reset', confirm: true },
    { name: 'Reset Galactic Map', file: 'reset-galactic-map.js', description: 'Reset positions & sync game state', confirm: true },
    { name: 'Reset Planet Generation', file: 'reset-planet-generation.js', description: 'Clear planet chunks', confirm: true },
    { name: 'Sync Characters to Game State', file: 'sync-characters-to-game-state.js', description: 'Sync all characters to game state service' },
    { name: 'Cleanup Space', file: 'cleanup-space.js', description: 'Free up MongoDB storage', confirm: true }
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
