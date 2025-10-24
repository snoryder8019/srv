import express from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import morgan from 'morgan';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import passport from 'passport';
import GoogleStrategy from 'passport-google-oauth20';
import { getDb } from '../madladslab/plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const execPromise = promisify(exec);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';
const PORT = process.env.PORT || 3600;

// Service configuration
const SERVICES = [
  { id: 'madladslab', name: 'MadLabs Lab', dir: '/srv/madladslab', port: 3000, session: 'madladslab_session' },
  { id: 'acm', name: 'ACM', dir: '/srv/acm', port: 3002, session: 'acm_session' },
  { id: 'sfg', name: 'SFG', dir: '/srv/sfg', port: 3003, session: 'sfg_session' },
  { id: 'ps', name: 'Project Stringborne', dir: '/srv/ps', port: 3399, session: 'ps_session' },
  { id: 'game-state', name: 'Game State Service', dir: '/srv/game-state-service', port: 3500, session: 'game_state_session' },
  { id: 'sna', name: 'SNA', dir: '/srv/sna', port: 3004, session: 'sna_session' },
  { id: 'twww', name: 'TWWW', dir: '/srv/twww', port: 3005, session: 'twww_session' },
  { id: 'madThree', name: 'MadThree', dir: '/srv/madThree', port: 3001, session: 'madThree_session' },
  { id: 'w2MongoClient', name: 'W2 Mongo Client', dir: '/srv/w2MongoClient', port: 3006, session: 'w2MongoClient_session' }
];

// Middleware
app.use(cors({
  origin: [
    'https://servers.madladslab.com',
    'https://madladslab.com',
    'http://localhost:3600'
  ],
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.JWT_SECRET || 'servers_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

// Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GGLCID,
      clientSecret: process.env.GGLSEC,
      callbackURL: 'https://servers.madladslab.com/auth/google/callback',
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const db = getDb();
        const users = db.collection('users');

        // Find user by email
        let user = await users.findOne({ email: profile.emails[0].value });

        if (!user) {
          // User doesn't exist
          return done(null, false, { message: 'No account found. Please register on madladslab.com first.' });
        }

        // Check if user is admin
        if (!user.isAdmin) {
          return done(null, false, { message: 'Access denied. Admin privileges required.' });
        }

        done(null, user);
      } catch (err) {
        console.error('Google auth error:', err);
        done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user._id.toString());
});

passport.deserializeUser(async (id, done) => {
  try {
    const db = getDb();
    const users = db.collection('users');
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (!user) return done(null, false);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware - check if user is logged in and is admin
const requireAdmin = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
};

// Routes

// Auth routes
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=auth_failed' }),
  (req, res) => {
    // Successful authentication, redirect to dashboard
    res.redirect('/?auth=success');
  }
);

app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    req.session.destroy();
    res.json({ success: true });
  });
});

app.get('/api/auth/status', (req, res) => {
  if (req.isAuthenticated() && req.user && req.user.isAdmin) {
    res.json({
      authenticated: true,
      user: {
        email: req.user.email,
        displayName: req.user.displayName,
        isAdmin: req.user.isAdmin
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Get all services status
app.get('/api/services', requireAdmin, async (req, res) => {
  try {
    const servicesStatus = await Promise.all(
      SERVICES.map(async (svc) => {
        const status = await checkServiceHealth(svc);
        const tmuxStatus = await checkTmuxSession(svc.session);
        return {
          ...svc,
          ...status,
          tmuxRunning: tmuxStatus
        };
      })
    );

    res.json({
      success: true,
      services: servicesStatus
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// Get system stats
app.get('/api/system', requireAdmin, async (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

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

    // Get disk usage
    let diskUsage = null;
    try {
      const { stdout } = await execPromise("df -h / | tail -1 | awk '{print $5}'");
      diskUsage = stdout.trim();
    } catch (err) {
      console.error('Error getting disk usage:', err);
    }

    // Get load average
    const loadAverage = os.loadavg();

    res.json({
      success: true,
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        uptime: os.uptime(),
        cpuCount: cpus.length,
        cpuUsagePercent: parseFloat(cpuUsagePercent),
        memUsagePercent: parseFloat(((usedMem / totalMem) * 100).toFixed(1)),
        memUsedMB: Math.round(usedMem / 1024 / 1024),
        memTotalMB: Math.round(totalMem / 1024 / 1024),
        diskUsage,
        loadAverage: loadAverage.map(l => l.toFixed(2))
      }
    });
  } catch (error) {
    console.error('Error fetching system stats:', error);
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
});

// Restart a service
app.post('/api/services/:serviceId/restart', requireAdmin, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const service = SERVICES.find(s => s.id === serviceId);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Kill existing tmux session
    try {
      await execPromise(`tmux kill-session -t ${service.session}`);
    } catch (err) {
      // Session might not exist, that's okay
    }

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 500));

    // Start new tmux session
    await execPromise(
      `tmux new-session -d -s ${service.session} -c ${service.dir} "npm run dev"`
    );

    res.json({
      success: true,
      message: `Service ${service.name} restarted successfully`
    });
  } catch (error) {
    console.error('Error restarting service:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stop a service
app.post('/api/services/:serviceId/stop', requireAdmin, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const service = SERVICES.find(s => s.id === serviceId);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    await execPromise(`tmux kill-session -t ${service.session}`);

    res.json({
      success: true,
      message: `Service ${service.name} stopped successfully`
    });
  } catch (error) {
    console.error('Error stopping service:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start a service
app.post('/api/services/:serviceId/start', requireAdmin, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const service = SERVICES.find(s => s.id === serviceId);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    await execPromise(
      `tmux new-session -d -s ${service.session} -c ${service.dir} "npm run dev"`
    );

    res.json({
      success: true,
      message: `Service ${service.name} started successfully`
    });
  } catch (error) {
    console.error('Error starting service:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get service logs
app.get('/api/services/:serviceId/logs', requireAdmin, async (req, res) => {
  try {
    const { serviceId } = req.params;
    const service = SERVICES.find(s => s.id === serviceId);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const lines = req.query.lines || 50;
    const { stdout } = await execPromise(
      `tmux capture-pane -t ${service.session} -p -S -${lines}`
    );

    res.json({
      success: true,
      logs: stdout
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs or session does not exist' });
  }
});

// Helper functions
async function checkServiceHealth(service) {
  try {
    let response;
    try {
      response = await axios.get(`http://localhost:${service.port}/health`, {
        timeout: 1000,
        validateStatus: () => true
      });
    } catch (err) {
      response = await axios.get(`http://localhost:${service.port}/`, {
        timeout: 1000,
        validateStatus: () => true
      });
    }

    return {
      status: response.status === 200 ? 'healthy' : 'degraded',
      statusCode: response.status,
      responding: true
    };
  } catch (error) {
    return {
      status: 'down',
      statusCode: null,
      responding: false
    };
  }
}

async function checkTmuxSession(sessionName) {
  try {
    await execPromise(`tmux has-session -t ${sessionName}`);
    return true;
  } catch (error) {
    return false;
  }
}

// Serve frontend (catch-all for HTML5 routing)
// Note: This must be last route
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🖥️  Servers Dashboard running on port ${PORT}`);
  console.log(`🔐 Google OAuth Authentication enabled`);
  console.log(`📊 Monitoring ${SERVICES.length} services`);
});
