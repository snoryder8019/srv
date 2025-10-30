import express from 'express';
import { Asset } from '../../api/v1/models/Asset.js';
import { UserAnalytics } from '../../api/v1/models/UserAnalytics.js';
import os from 'os';
import axios from 'axios';
import scriptsRouter from './scripts.js';
import { physicsService } from '../../services/physics-service.js';

const router = express.Router();

// Middleware to check if user is admin
function isAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // You can add your admin check logic here
  // For now, just checking if user exists
  if (req.user.isAdmin !== true) {
    return res.status(403).json({ error: 'Forbidden - Admin access required' });
  }

  next();
}

// Admin dashboard home
router.get('/', isAdmin, function(req, res, next) {
  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    user: req.user
  });
});

// User management page
router.get('/users', isAdmin, function(req, res, next) {
  res.render('admin/users', {
    title: 'User Management',
    user: req.user
  });
});

// Asset generation page
router.get('/generate', isAdmin, function(req, res, next) {
  res.render('admin/generate', {
    title: 'Generate Assets',
    user: req.user
  });
});

// Asset approval page
router.get('/assets', isAdmin, function(req, res, next) {
  res.render('admin/assets', {
    title: 'Asset Approvals',
    user: req.user
  });
});

// API endpoint to create assets
router.post('/api/generate', isAdmin, async function(req, res, next) {
  try {
    const { assetType, assetData } = req.body;

    // Here you'll add logic to create different types of assets
    // based on assetType (characters, zones, items, etc.)

    switch(assetType) {
      case 'character':
        // Add character creation logic
        res.json({
          success: true,
          message: 'Character created successfully',
          data: assetData
        });
        break;

      case 'zone':
        // Add zone creation logic
        res.json({
          success: true,
          message: 'Zone created successfully',
          data: assetData
        });
        break;

      case 'item':
        // Add item creation logic
        res.json({
          success: true,
          message: 'Item created successfully',
          data: assetData
        });
        break;

      case 'species':
        // Add species creation logic
        res.json({
          success: true,
          message: 'Species created successfully',
          data: assetData
        });
        break;

      default:
        res.status(400).json({
          success: false,
          error: 'Invalid asset type'
        });
    }
  } catch (error) {
    console.error('Error generating asset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate asset'
    });
  }
});

// Admin API: Get pending assets
router.get('/api/assets/pending', isAdmin, async function(req, res, next) {
  try {
    const assets = await Asset.findByStatus('pending');
    res.json({ success: true, assets });
  } catch (error) {
    console.error('Error fetching pending assets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin API: Get asset statistics
router.get('/api/assets/stats', isAdmin, async function(req, res, next) {
  try {
    const stats = await Asset.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching asset stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin API: Approve asset
router.post('/api/assets/:id/approve', isAdmin, async function(req, res, next) {
  try {
    const { adminNotes } = req.body;
    await Asset.approve(req.params.id, req.user._id, adminNotes);
    res.json({ success: true, message: 'Asset approved' });
  } catch (error) {
    console.error('Error approving asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin API: Reject asset
router.post('/api/assets/:id/reject', isAdmin, async function(req, res, next) {
  try {
    const { adminNotes } = req.body;

    if (!adminNotes) {
      return res.status(400).json({
        success: false,
        error: 'Admin notes required for rejection'
      });
    }

    await Asset.reject(req.params.id, req.user._id, adminNotes);
    res.json({ success: true, message: 'Asset rejected' });
  } catch (error) {
    console.error('Error rejecting asset:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Game State Controls page
router.get('/game-state', isAdmin, function(req, res, next) {
  res.render('admin/game-state-controls', {
    title: 'Game State Controls',
    user: req.user
  });
});

// Galactic Map Settings page
router.get('/galactic-map-settings', isAdmin, function(req, res, next) {
  res.render('admin/galactic-map-settings', {
    title: 'Galactic Map Settings',
    user: req.user
  });
});

// Orbital Systems Monitor page
router.get('/monitor/orbital-systems', isAdmin, async function(req, res, next) {
  try {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    // Get orbital counts
    const orbitalCount = await db.collection('assets').countDocuments({
      assetType: 'orbital',
      status: 'approved'
    });

    const planetCount = await db.collection('assets').countDocuments({
      assetType: 'planet',
      status: 'approved'
    });

    const zoneCount = await db.collection('zones').countDocuments({});

    res.render('admin/orbital-monitor', {
      title: 'Orbital Systems Monitor',
      user: req.user,
      stats: {
        orbitals: orbitalCount,
        planets: planetCount,
        zones: zoneCount
      }
    });
  } catch (error) {
    console.error('Error loading orbital monitor:', error);
    res.status(500).send('Error loading orbital monitor');
  }
});

// In-memory storage for galactic map settings (could be moved to DB later)
let galacticMapSettings = {
  movementSpeed: 0.1, // Default to very slow
  gridSize: 100,
  edgeGravityStrength: 0.15,
  edgeGravityDistance: 400,
  staticChargeBuildup: 0.02,
  staticGravityThreshold: 1.0,
  maxVelocity: 8,
  damping: 0.999,
  brownNoiseStrength: 0.05, // Brown noise force magnitude
  brownNoiseFrequency: 0.5, // Oscillation speed (cycles per second)
  brownNoiseEnabled: true,
  updatedAt: new Date(),
  updatedBy: null
};

// API: Get galactic map settings
router.get('/api/galactic-map/settings', function(req, res, next) {
  res.json({ success: true, settings: galacticMapSettings });
});

// API: Update galactic map settings
router.post('/api/galactic-map/settings', isAdmin, function(req, res, next) {
  try {
    const {
      movementSpeed,
      gridSize,
      edgeGravityStrength,
      edgeGravityDistance,
      staticChargeBuildup,
      staticGravityThreshold,
      maxVelocity,
      damping,
      brownNoiseStrength,
      brownNoiseFrequency,
      brownNoiseEnabled
    } = req.body;

    if (movementSpeed !== undefined) {
      if (typeof movementSpeed !== 'number' || movementSpeed < 0 || movementSpeed > 10) {
        return res.status(400).json({
          success: false,
          error: 'Movement speed must be a number between 0 and 10'
        });
      }
      galacticMapSettings.movementSpeed = movementSpeed;
    }

    if (gridSize !== undefined) {
      if (typeof gridSize !== 'number' || gridSize < 25 || gridSize > 1000) {
        return res.status(400).json({
          success: false,
          error: 'Grid size must be a number between 25 and 1000'
        });
      }
      galacticMapSettings.gridSize = gridSize;
    }

    if (edgeGravityStrength !== undefined) {
      if (typeof edgeGravityStrength !== 'number' || edgeGravityStrength < 0 || edgeGravityStrength > 1) {
        return res.status(400).json({
          success: false,
          error: 'Edge gravity strength must be between 0 and 1'
        });
      }
      galacticMapSettings.edgeGravityStrength = edgeGravityStrength;
    }

    if (edgeGravityDistance !== undefined) {
      if (typeof edgeGravityDistance !== 'number' || edgeGravityDistance < 100 || edgeGravityDistance > 1000) {
        return res.status(400).json({
          success: false,
          error: 'Edge gravity distance must be between 100 and 1000'
        });
      }
      galacticMapSettings.edgeGravityDistance = edgeGravityDistance;
    }

    if (staticChargeBuildup !== undefined) {
      if (typeof staticChargeBuildup !== 'number' || staticChargeBuildup < 0 || staticChargeBuildup > 0.1) {
        return res.status(400).json({
          success: false,
          error: 'Static charge buildup must be between 0 and 0.1'
        });
      }
      galacticMapSettings.staticChargeBuildup = staticChargeBuildup;
    }

    if (staticGravityThreshold !== undefined) {
      if (typeof staticGravityThreshold !== 'number' || staticGravityThreshold < 0.1 || staticGravityThreshold > 5) {
        return res.status(400).json({
          success: false,
          error: 'Static gravity threshold must be between 0.1 and 5'
        });
      }
      galacticMapSettings.staticGravityThreshold = staticGravityThreshold;
    }

    if (maxVelocity !== undefined) {
      if (typeof maxVelocity !== 'number' || maxVelocity < 1 || maxVelocity > 20) {
        return res.status(400).json({
          success: false,
          error: 'Max velocity must be between 1 and 20'
        });
      }
      galacticMapSettings.maxVelocity = maxVelocity;
    }

    if (damping !== undefined) {
      if (typeof damping !== 'number' || damping < 0.9 || damping > 1) {
        return res.status(400).json({
          success: false,
          error: 'Damping must be between 0.9 and 1'
        });
      }
      galacticMapSettings.damping = damping;
    }

    if (brownNoiseStrength !== undefined) {
      if (typeof brownNoiseStrength !== 'number' || brownNoiseStrength < 0 || brownNoiseStrength > 1) {
        return res.status(400).json({
          success: false,
          error: 'Brown noise strength must be between 0 and 1'
        });
      }
      galacticMapSettings.brownNoiseStrength = brownNoiseStrength;
    }

    if (brownNoiseFrequency !== undefined) {
      if (typeof brownNoiseFrequency !== 'number' || brownNoiseFrequency < 0.01 || brownNoiseFrequency > 5) {
        return res.status(400).json({
          success: false,
          error: 'Brown noise frequency must be between 0.01 and 5 Hz'
        });
      }
      galacticMapSettings.brownNoiseFrequency = brownNoiseFrequency;
    }

    if (brownNoiseEnabled !== undefined) {
      if (typeof brownNoiseEnabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Brown noise enabled must be a boolean'
        });
      }
      galacticMapSettings.brownNoiseEnabled = brownNoiseEnabled;
    }

    galacticMapSettings.updatedAt = new Date();
    galacticMapSettings.updatedBy = req.user._id;

    res.json({
      success: true,
      message: 'Galactic map settings updated',
      settings: galacticMapSettings
    });
  } catch (error) {
    console.error('Error updating galactic map settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Randomize galactic map positions
router.post('/api/galactic-map/randomize', isAdmin, async function(req, res, next) {
  try {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    // 1. Clear spatial service cache
    const svcUrl = process.env.GAME_STATE_SERVICE_URL || 'https://svc.madladslab.com';
    try {
      await fetch(`${svcUrl}/api/spatial/assets`, {
        method: 'DELETE'
      });
    } catch (err) {
      console.warn('Could not clear spatial service:', err.message);
    }

    // 2. Reset asset coordinates in database (set to null to force regeneration)
    const assetResult = await db.collection('assets').updateMany(
      { status: 'approved' },
      {
        $unset: {
          'coordinates': '',
          'initialPosition': ''
        }
      }
    );

    // 3. Reset all character locations to random positions
    const mapWidth = 5000;
    const mapHeight = 5000;
    const padding = 200;

    const characters = await db.collection('characters').find({}).toArray();
    let characterUpdateCount = 0;

    for (const char of characters) {
      const newLocation = {
        type: 'galactic',
        x: padding + Math.random() * (mapWidth - padding * 2),
        y: padding + Math.random() * (mapHeight - padding * 2)
      };

      await db.collection('characters').updateOne(
        { _id: char._id },
        { $set: { location: newLocation } }
      );

      characterUpdateCount++;
    }

    res.json({
      success: true,
      message: 'Galactic map reset complete',
      details: {
        assetsReset: assetResult.modifiedCount,
        charactersReset: characterUpdateCount,
        spatialCacheCleared: true
      }
    });
  } catch (error) {
    console.error('Error randomizing galactic map:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get platform analytics
router.get('/api/analytics', isAdmin, async function(req, res, next) {
  try {
    const days = parseInt(req.query.days) || 30;
    const analytics = await UserAnalytics.getPlatformAnalytics(days);

    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get user-specific analytics
router.get('/api/analytics/user/:userId', isAdmin, async function(req, res, next) {
  try {
    const analytics = await UserAnalytics.getUserAnalytics(req.params.userId);

    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Track user action (can be called from client-side)
router.post('/api/track-action', async function(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { actionType, metadata } = req.body;

    if (!actionType) {
      return res.status(400).json({ success: false, error: 'Action type required' });
    }

    await UserAnalytics.trackAction(req.user._id, actionType, metadata || {});

    res.json({ success: true, message: 'Action tracked' });
  } catch (error) {
    console.error('Error tracking action:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get all users (admin only)
router.get('/api/users', isAdmin, async function(req, res, next) {
  try {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const { collections } = await import('../../config/database.js');
    const db = getDb();

    const users = await db.collection(collections.users)
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// User analytics detail page
router.get('/analytics/user/:userId', isAdmin, function(req, res, next) {
  res.render('admin/user-analytics', {
    title: 'User Analytics',
    user: req.user,
    userId: req.params.userId
  });
});

// API: Restart a service
router.post('/api/monitor/restart/:service', isAdmin, async function(req, res) {
  const { service } = req.params;

  const serviceMap = {
    'madladslab': { dir: '/srv/madladslab', port: 3000, session: 'madladslab_session' },
    'acm': { dir: '/srv/acm', port: 3002, session: 'acm_session' },
    'sfg': { dir: '/srv/sfg', port: 3003, session: 'sfg_session' },
    'ps': { dir: '/srv/ps', port: 3399, session: 'ps_session' },
    'game-state': { dir: '/srv/game-state-service', port: 3500, session: 'game_state_session' }
  };

  if (!serviceMap[service]) {
    return res.status(400).json({
      success: false,
      error: 'Invalid service name'
    });
  }

  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execPromise = promisify(exec);

    const svc = serviceMap[service];

    // Kill existing tmux session
    try {
      await execPromise(`tmux kill-session -t ${svc.session}`);
    } catch (err) {
      // Session might not exist, that's okay
    }

    // Start new tmux session with npm run dev
    await execPromise(
      `tmux new-session -d -s ${svc.session} -c ${svc.dir} "npm run dev"`
    );

    // Wait a moment for the service to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    res.json({
      success: true,
      message: `Service ${service} restarted successfully`,
      service: svc
    });
  } catch (error) {
    console.error(`Error restarting service ${service}:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: System monitor status bar (lightweight - no auth required for admins to see it)
router.get('/api/monitor/status', async function(req, res) {
  try {
    // System metrics
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsagePercent = ((usedMem / totalMem) * 100).toFixed(1);

    // CPU usage - simple calculation
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const cpuUsagePercent = (100 - (totalIdle / totalTick) * 100).toFixed(1);

    // Service health checks
    const services = [];

    // Check game-state-service
    try {
      const svcUrl = process.env.GAME_STATE_SERVICE_URL || 'https://svc.madladslab.com';
      const svcResponse = await axios.get(`${svcUrl}/health`, { timeout: 2000 });
      services.push({
        name: 'Game State',
        status: svcResponse.status === 200 ? 'healthy' : 'degraded',
        url: svcUrl
      });
    } catch (error) {
      services.push({
        name: 'Game State',
        status: 'down',
        url: process.env.GAME_STATE_SERVICE_URL || 'https://svc.madladslab.com'
      });
    }

    // Check MongoDB
    try {
      const { getDb } = await import('../../plugins/mongo/mongo.js');
      const db = getDb();
      await db.admin().ping();
      services.push({
        name: 'MongoDB',
        status: 'healthy'
      });
    } catch (error) {
      services.push({
        name: 'MongoDB',
        status: 'down'
      });
    }

    // Check other services if configured
    const otherServices = [
      { name: 'madladslab', port: 3000 },
      { name: 'acm', port: 3002 },
      { name: 'sfg', port: 3003 }
    ];

    for (const svc of otherServices) {
      try {
        // Try /health first, fallback to root path
        let response;
        let status = 'down';

        try {
          response = await axios.get(`http://localhost:${svc.port}/health`, {
            timeout: 1000,
            validateStatus: () => true // Accept any status code
          });
          status = response.status === 200 ? 'healthy' : 'degraded';
        } catch (err) {
          // If /health doesn't exist, try root path
          try {
            response = await axios.get(`http://localhost:${svc.port}/`, {
              timeout: 1000,
              validateStatus: () => true // Accept any status code
            });
            // If we get ANY response, service is at least responding
            status = response.status === 200 ? 'healthy' : 'degraded';
          } catch (innerErr) {
            // Service is truly down
            status = 'down';
          }
        }

        services.push({
          name: svc.name,
          status: status,
          port: svc.port
        });
      } catch (error) {
        services.push({
          name: svc.name,
          status: 'down',
          port: svc.port
        });
      }
    }

    res.json({
      success: true,
      system: {
        memUsagePercent: parseFloat(memUsagePercent),
        memUsedMB: Math.round(usedMem / 1024 / 1024),
        memTotalMB: Math.round(totalMem / 1024 / 1024),
        cpuUsagePercent: parseFloat(cpuUsagePercent),
        cpuCount: cpus.length,
        uptime: os.uptime(),
        platform: os.platform(),
        hostname: os.hostname()
      },
      services,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching system status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch system status',
      timestamp: new Date().toISOString()
    });
  }
});

// Mount scripts router
router.use('/scripts', scriptsRouter);

// Script control panel page
router.get('/control-panel', isAdmin, function(req, res, next) {
  res.render('admin/control-panel', {
    title: 'Script Control Panel',
    user: req.user
  });
});

// API: Get cron jobs status
router.get('/api/cron/status', isAdmin, async function(req, res, next) {
  try {
    const { getJobsStatus } = await import('../../plugins/cron/index.js');
    const jobs = getJobsStatus();

    res.json({
      success: true,
      jobs
    });
  } catch (error) {
    console.error('Error fetching cron jobs status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Manually trigger a cron job
router.post('/api/cron/trigger/:jobName', isAdmin, async function(req, res, next) {
  try {
    const { triggerJob } = await import('../../plugins/cron/index.js');
    const jobName = decodeURIComponent(req.params.jobName);

    await triggerJob(jobName);

    res.json({
      success: true,
      message: `Job "${jobName}" triggered successfully`
    });
  } catch (error) {
    console.error('Error triggering cron job:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Live Dashboard page
router.get('/live-dashboard', isAdmin, function(req, res, next) {
  res.render('admin/live-dashboard', {
    title: 'Live Admin Dashboard',
    user: req.user
  });
});

// API: Run tests
router.post('/api/tests/run', isAdmin, async function(req, res, next) {
  try {
    const { suite } = req.body;
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execPromise = promisify(exec);

    let command = 'node /srv/ps/test/runner.js';
    if (suite) {
      command += ` --suite=${suite}`;
    }

    const { stdout, stderr } = await execPromise(command, {
      timeout: 60000 // 60 second timeout
    });

    // Read the latest test results
    const fs = await import('fs');
    const path = await import('path');
    const resultsPath = path.join('/srv/ps/test/results/latest.json');

    let results = {
      total: 0,
      passed: 0,
      failed: 0,
      duration: 0,
      suites: []
    };

    if (fs.existsSync(resultsPath)) {
      const resultsData = fs.readFileSync(resultsPath, 'utf8');
      results = JSON.parse(resultsData);
    }

    res.json({
      success: true,
      results,
      stdout,
      stderr: stderr || null
    });
  } catch (error) {
    console.error('Error running tests:', error);
    res.json({
      success: false,
      error: error.message,
      results: {
        total: 0,
        passed: 0,
        failed: 1,
        duration: 0,
        suites: []
      }
    });
  }
});

// API: Get test metrics and history
router.get('/api/tests/metrics', isAdmin, async function(req, res, next) {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const resultsDir = path.join('/srv/ps/test/results');

    // Read all test result files
    const files = fs.readdirSync(resultsDir)
      .filter(f => f.startsWith('test-results-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 20); // Last 20 test runs

    const history = files.map(file => {
      const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8'));
      return {
        timestamp: data.timestamp,
        total: data.total,
        passed: data.passed,
        failed: data.failed,
        duration: data.duration,
        suites: data.suites.map(s => ({
          name: s.name,
          passed: s.passed,
          failed: s.failed,
          duration: s.duration
        }))
      };
    });

    // Read latest results
    const latestPath = path.join(resultsDir, 'latest.json');
    const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));

    // Calculate metrics
    const passRate = latest.total > 0 ? ((latest.passed / latest.total) * 100).toFixed(1) : 0;
    const avgDuration = history.length > 0
      ? (history.reduce((sum, h) => sum + h.duration, 0) / history.length).toFixed(0)
      : 0;

    res.json({
      success: true,
      latest,
      history,
      metrics: {
        passRate,
        avgDuration,
        totalRuns: history.length,
        trend: calculateTrend(history)
      }
    });
  } catch (error) {
    console.error('Error fetching test metrics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to calculate trend
function calculateTrend(history) {
  if (history.length < 2) return 'stable';

  const recent = history.slice(0, 5);
  const older = history.slice(5, 10);

  if (recent.length === 0 || older.length === 0) return 'stable';

  const recentPassRate = recent.reduce((sum, h) => sum + (h.passed / h.total), 0) / recent.length;
  const olderPassRate = older.reduce((sum, h) => sum + (h.passed / h.total), 0) / older.length;

  if (recentPassRate > olderPassRate + 0.05) return 'improving';
  if (recentPassRate < olderPassRate - 0.05) return 'declining';
  return 'stable';
}

// API: Test database connection
router.get('/api/tests/database', isAdmin, async function(req, res, next) {
  try {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    // Simple ping test
    await db.admin().ping();

    res.json({
      success: true,
      message: 'Database connection successful'
    });
  } catch (error) {
    console.error('Database connection test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Get database metrics
router.get('/api/database/metrics', isAdmin, async function(req, res, next) {
  try {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const collections = await db.listCollections().toArray();
    const userCount = await db.collection('users').countDocuments();
    const characterCount = await db.collection('characters').countDocuments();
    const assetCount = await db.collection('assets').countDocuments();

    res.json({
      success: true,
      metrics: {
        collections: collections.length,
        users: userCount,
        characters: characterCount,
        assets: assetCount
      }
    });
  } catch (error) {
    console.error('Error fetching database metrics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Get detailed database usage analysis
router.get('/api/database/usage', isAdmin, async function(req, res, next) {
  try {
    const { analyzeDatabase } = await import('../../scripts/analyze-db-usage.js');
    const analysis = await analyzeDatabase();

    res.json({
      success: true,
      analysis
    });
  } catch (error) {
    console.error('Error analyzing database usage:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: List all MongoDB collections with stats
router.get('/api/database/collections', isAdmin, async function(req, res, next) {
  try {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    // Get all collections
    const collections = await db.listCollections().toArray();

    // Get stats for each collection
    const collectionData = [];

    for (const collection of collections) {
      try {
        const stats = await db.command({ collStats: collection.name });
        const count = await db.collection(collection.name).countDocuments();

        collectionData.push({
          name: collection.name,
          count: count,
          size: stats.size || 0,
          storageSize: stats.storageSize || 0,
          avgObjSize: stats.avgObjSize || 0,
          indexSize: stats.totalIndexSize || 0,
          totalSize: (stats.storageSize || 0) + (stats.totalIndexSize || 0),
          indexes: stats.nindexes || 0
        });
      } catch (err) {
        console.warn(`Could not get stats for ${collection.name}:`, err.message);
      }
    }

    // Sort by total size descending
    collectionData.sort((a, b) => b.totalSize - a.totalSize);

    res.json({
      success: true,
      collections: collectionData
    });
  } catch (error) {
    console.error('Error listing collections:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Get documents from a specific collection
router.get('/api/database/collections/:name/documents', isAdmin, async function(req, res, next) {
  try {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const collectionName = req.params.name;
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    // Get documents
    const documents = await db.collection(collectionName)
      .find({})
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count
    const total = await db.collection(collectionName).countDocuments();

    res.json({
      success: true,
      collection: collectionName,
      documents: documents,
      total: total,
      limit: limit,
      skip: skip,
      hasMore: (skip + limit) < total
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Drop an empty collection
router.delete('/api/database/collections/:name', isAdmin, async function(req, res, next) {
  try {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const collectionName = req.params.name;

    // Safety check - only allow dropping empty collections
    const count = await db.collection(collectionName).countDocuments();
    if (count > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot drop collection "${collectionName}" - it contains ${count} documents. Please empty it first.`
      });
    }

    // Drop the collection
    await db.collection(collectionName).drop();

    res.json({
      success: true,
      message: `Collection "${collectionName}" dropped successfully`
    });
  } catch (error) {
    console.error('Error dropping collection:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Get Linode server metrics (I/O, bandwidth, etc.)
router.get('/api/linode/metrics', isAdmin, async function(req, res, next) {
  try {
    const linodeToken = process.env.LINODE_API_TOKEN;

    if (!linodeToken) {
      return res.json({
        success: false,
        error: 'Linode API token not configured',
        metrics: null
      });
    }

    // Get Linode ID from environment or config
    const linodeId = process.env.LINODE_ID;

    if (!linodeId) {
      return res.json({
        success: false,
        error: 'Linode ID not configured',
        metrics: null
      });
    }

    // Fetch Linode stats
    const response = await axios.get(
      `https://api.linode.com/v4/linode/instances/${linodeId}/stats`,
      {
        headers: {
          'Authorization': `Bearer ${linodeToken}`
        }
      }
    );

    const stats = response.data;

    // Fetch Linode instance details for plan info
    const instanceResponse = await axios.get(
      `https://api.linode.com/v4/linode/instances/${linodeId}`,
      {
        headers: {
          'Authorization': `Bearer ${linodeToken}`
        }
      }
    );

    const instance = instanceResponse.data;

    // Extract useful metrics
    const metrics = {
      io: stats.data.io,
      netv4: stats.data.netv4,
      netv6: stats.data.netv6,
      cpu: stats.data.cpu,
      disk: stats.data.disk,
      instance: {
        type: instance.type,
        label: instance.label,
        region: instance.region,
        specs: instance.specs,
        status: instance.status
      }
    };

    res.json({
      success: true,
      metrics
    });
  } catch (error) {
    console.error('Error fetching Linode metrics:', error);
    res.json({
      success: false,
      error: error.message,
      metrics: null
    });
  }
});

// ===== SIMULATION CONTROL ENDPOINTS =====

// API: Get simulation status
router.get('/api/simulation/status', isAdmin, async function(req, res, next) {
  try {
    const status = physicsService.getStatus();

    // Get database stats
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    const assetCount = await db.collection('assets').countDocuments();
    const characterCount = await db.collection('characters').countDocuments();
    const galaxyCount = await db.collection('assets').countDocuments({ assetType: 'galaxy' });
    const starCount = await db.collection('assets').countDocuments({ assetType: 'star' });
    const planetCount = await db.collection('assets').countDocuments({ assetType: 'planet' });
    const anomalyCount = await db.collection('assets').countDocuments({ assetType: 'anomaly' });

    res.json({
      success: true,
      simulation: {
        running: status.running,
        tickRate: status.tickRate,
        ticksPerSecond: 1000 / status.tickRate,
        gravityRadius: status.gravityRadius
      },
      universe: {
        totalAssets: assetCount,
        characters: characterCount,
        anomalies: anomalyCount,
        galaxies: galaxyCount,
        stars: starCount,
        planets: planetCount
      }
    });
  } catch (error) {
    console.error('Error fetching simulation status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Start simulation
router.post('/api/simulation/start', isAdmin, function(req, res, next) {
  try {
    if (physicsService.isRunning) {
      return res.json({
        success: false,
        message: 'Simulation is already running'
      });
    }

    physicsService.start();

    res.json({
      success: true,
      message: 'Simulation started',
      status: physicsService.getStatus()
    });
  } catch (error) {
    console.error('Error starting simulation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Stop simulation
router.post('/api/simulation/stop', isAdmin, function(req, res, next) {
  try {
    if (!physicsService.isRunning) {
      return res.json({
        success: false,
        message: 'Simulation is not running'
      });
    }

    physicsService.stop();

    res.json({
      success: true,
      message: 'Simulation stopped',
      status: physicsService.getStatus()
    });
  } catch (error) {
    console.error('Error stopping simulation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Update simulation speed
router.post('/api/simulation/speed', isAdmin, function(req, res, next) {
  try {
    const { tickRate } = req.body;

    if (!tickRate || typeof tickRate !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'tickRate must be a number (milliseconds between ticks)'
      });
    }

    if (tickRate < 10 || tickRate > 10000) {
      return res.status(400).json({
        success: false,
        error: 'tickRate must be between 10ms (100 tps) and 10000ms (0.1 tps)'
      });
    }

    const wasRunning = physicsService.isRunning;

    // Stop if running
    if (wasRunning) {
      physicsService.stop();
    }

    // Update tick rate
    physicsService.tickRate = tickRate;

    // Restart if it was running
    if (wasRunning) {
      physicsService.start();
    }

    res.json({
      success: true,
      message: 'Simulation speed updated',
      status: physicsService.getStatus()
    });
  } catch (error) {
    console.error('Error updating simulation speed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Reset universe (clear all assets)
router.post('/api/simulation/reset', isAdmin, async function(req, res, next) {
  try {
    const { getDb } = await import('../../plugins/mongo/mongo.js');
    const db = getDb();

    // Stop simulation first
    const wasRunning = physicsService.isRunning;
    if (wasRunning) {
      physicsService.stop();
    }

    // Clear all assets (but keep built-in field test items)
    const result = await db.collection('assets').deleteMany({
      isBuiltIn: { $ne: true }
    });

    // Clear characters at galactic positions (keep docked characters)
    const charResult = await db.collection('characters').updateMany(
      { 'location.x': { $exists: true } },
      {
        $unset: {
          'location': '',
          'velocity': '',
          'navigation': ''
        }
      }
    );

    res.json({
      success: true,
      message: 'Universe reset successfully',
      deleted: {
        assets: result.deletedCount,
        charactersReset: charResult.modifiedCount
      },
      note: 'Simulation stopped. Start it again when ready.'
    });
  } catch (error) {
    console.error('Error resetting universe:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Simulation control page
router.get('/simulation', isAdmin, function(req, res, next) {
  res.render('admin/simulation', {
    title: 'Simulation Control',
    user: req.user
  });
});

export default router;
