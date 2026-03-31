'use strict';

const express = require('express');
const { ObjectId } = require('mongodb');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Max plugin file size: 2MB
const MAX_FILE_SIZE = 2 * 1024 * 1024;

// Game-specific plugin handlers
const GAME_LIBS = {
  rust: () => require('../lib/rust'),
  valheim: () => require('../lib/valheim'),
  l4d2: () => require('../lib/l4d2'),
  '7dtd': () => require('../lib/7dtd'),
};

const GAME_EXTENSIONS = {
  rust: '.cs',
  valheim: '.dll',
  l4d2: '.smx',
  '7dtd': '', // folder-based, handled differently
};

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Login required' });
}

function requireSuperAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
  if (req.user.isAdmin !== true) return res.status(403).json({ error: 'Superadmin only' });
  next();
}

function requireSubscriber(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
  const u = req.user;
  const sub = u.subscription || 'free';
  if (u.isAdmin || sub === 'admin' || sub === 'lifetime' ||
      (u.permissions && u.permissions.games === 'admin')) return next();
  res.status(403).json({ error: 'Subscription required (Admin tier or higher)' });
}

// ── Plugin Library page ──
router.get('/', requireAuth, (req, res) => {
  res.sendFile('plugins.html', { root: __dirname + '/../public' });
});

// ── List plugin library (all approved plugins visible to subscribers, all to superadmin) ──
router.get('/api/library', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const game = req.query.game || null;
    const query = {};
    if (game) query.game = game;
    // Subscribers only see approved plugins; superadmins see all
    if (!req.user.isAdmin) query.approved = true;
    const plugins = await db.collection('plugin_library')
      .find(query)
      .sort({ game: 1, name: 1 })
      .toArray();
    res.json({ plugins });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Upload plugin to library (superadmin only) ──
router.post('/api/upload', requireSuperAdmin, express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const game = req.headers['x-game'];
    const filename = req.headers['x-filename'];
    const description = req.headers['x-description'] || '';
    const approved = req.headers['x-approved'] === 'true';

    if (!game || !GAME_EXTENSIONS.hasOwnProperty(game)) {
      return res.status(400).json({ error: 'Invalid game. Use: ' + Object.keys(GAME_EXTENSIONS).join(', ') });
    }
    if (!filename) return res.status(400).json({ error: 'X-Filename header required' });

    const ext = GAME_EXTENSIONS[game];
    if (ext && !filename.endsWith(ext)) {
      return res.status(400).json({ error: 'Plugin must be a ' + ext + ' file for ' + game });
    }

    const content = req.body;
    if (!content || !content.length) return res.status(400).json({ error: 'Empty file' });
    if (content.length > MAX_FILE_SIZE) return res.status(400).json({ error: 'File too large (max 2MB)' });

    // Store in MongoDB
    const pluginDoc = {
      game,
      name: filename.replace(ext, ''),
      filename,
      description,
      approved,
      fileData: content, // Buffer stored as Binary
      fileSize: content.length,
      uploadedBy: req.user._id.toString(),
      uploadedByName: req.user.displayName || req.user.email,
      uploadedAt: new Date(),
      updatedAt: new Date(),
      installs: 0,
    };

    // Upsert by game + filename
    await db.collection('plugin_library').updateOne(
      { game, filename },
      { $set: pluginDoc },
      { upsert: true }
    );

    res.json({ ok: true, name: pluginDoc.name, game, approved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Approve / unapprove plugin (superadmin only) ──
router.put('/api/:id/approve', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const approved = req.body.approved !== false;
    await db.collection('plugin_library').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { approved, updatedAt: new Date() } }
    );
    res.json({ ok: true, approved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete plugin from library (superadmin only) ──
router.delete('/api/:id', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    await db.collection('plugin_library').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Install plugin to game server (superadmin: any, subscriber: approved only) ──
router.post('/api/:id/install', requireSubscriber, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const plugin = await db.collection('plugin_library').findOne({ _id: new ObjectId(req.params.id) });
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });

    // Subscribers can only install approved plugins
    if (!req.user.isAdmin && !plugin.approved) {
      return res.status(403).json({ error: 'This plugin has not been approved yet' });
    }

    const game = plugin.game;

    if (game === 'rust') {
      const rust = GAME_LIBS.rust();
      rust.installPlugin(plugin.filename, plugin.fileData.buffer || plugin.fileData);

      // Trigger Carbon hot-reload via RCON so it compiles + generates config
      const pluginName = plugin.filename.replace('.cs', '');
      try {
        if (rust.isRunning()) {
          await rust.rconCommand('c.load ' + pluginName);
          // Give Carbon a moment to compile
          await new Promise(r => setTimeout(r, 3000));
          // Check if config was generated
          const configPath = '/srv/games/rust/carbon/configs/' + pluginName + '.json';
          const hasConfig = fs.existsSync(configPath);
          res.json({
            ok: true,
            message: pluginName + ' installed + loaded via Carbon',
            configReady: hasConfig,
            configPath: hasConfig ? pluginName + '.json' : null,
          });
          await db.collection('plugin_library').updateOne({ _id: plugin._id }, { $inc: { installs: 1 } });
          return;
        }
      } catch (e) {
        // RCON failed — server might be offline, plugin still installed
      }
    } else if (game === 'valheim') {
      const dir = '/srv/games/valheim/BepInEx/plugins';
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, plugin.filename), plugin.fileData.buffer || plugin.fileData);
    } else if (game === 'l4d2') {
      const dir = '/srv/games/l4d2/addons/sourcemod/plugins';
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, plugin.filename), plugin.fileData.buffer || plugin.fileData);
    } else if (game === '7dtd') {
      const dir = path.join('/srv/games/7dtd/Mods', plugin.filename.replace(/\.[^.]+$/, ''));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, plugin.filename), plugin.fileData.buffer || plugin.fileData);
    }

    // Increment install count
    await db.collection('plugin_library').updateOne(
      { _id: plugin._id },
      { $inc: { installs: 1 } }
    );

    res.json({ ok: true, message: plugin.name + ' installed to ' + game + ' server' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Uninstall plugin from game server (superadmin only) ──
router.post('/api/:id/uninstall', requireSuperAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const plugin = await db.collection('plugin_library').findOne({ _id: new ObjectId(req.params.id) });
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });

    const game = plugin.game;

    if (game === 'rust') {
      const rust = GAME_LIBS.rust();
      rust.removePlugin(plugin.filename);
    } else if (game === 'valheim') {
      const fp = path.join('/srv/games/valheim/BepInEx/plugins', plugin.filename);
      const dp = path.join('/srv/games/valheim/BepInEx/plugins/disabled', plugin.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      if (fs.existsSync(dp)) fs.unlinkSync(dp);
    } else if (game === 'l4d2') {
      const fp = path.join('/srv/games/l4d2/addons/sourcemod/plugins', plugin.filename);
      const dp = path.join('/srv/games/l4d2/addons/sourcemod/plugins/disabled', plugin.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      if (fs.existsSync(dp)) fs.unlinkSync(dp);
    }

    res.json({ ok: true, message: plugin.name + ' uninstalled from ' + game });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get installed plugins for a game (live from filesystem) ──
router.get('/api/installed/:game', requireAuth, (req, res) => {
  const game = req.params.game;
  try {
    const lib = GAME_LIBS[game]();
    const fn = game === '7dtd' ? 'getMods' : 'getPlugins';
    const plugins = lib[fn]();
    res.json({ plugins, framework: lib.getPluginFramework ? lib.getPluginFramework() : game });
  } catch (e) {
    res.json({ plugins: [], framework: game });
  }
});

// ── Reload plugin via RCON (Carbon: c.reload, triggers config regen) ──
router.post('/api/reload/:game/:pluginName', requireSuperAdmin, async (req, res) => {
  const { game, pluginName } = req.params;

  if (game === 'rust') {
    try {
      const rust = GAME_LIBS.rust();
      if (!rust.isRunning()) return res.status(400).json({ error: 'Rust server is offline' });

      const output = await rust.rconCommand('c.reload ' + pluginName);
      // Wait for Carbon to recompile
      await new Promise(r => setTimeout(r, 3000));

      const configPath = '/srv/games/rust/carbon/configs/' + pluginName + '.json';
      const dataPath = '/srv/games/rust/carbon/data/' + pluginName;
      const hasConfig = fs.existsSync(configPath);
      const hasData = fs.existsSync(dataPath);

      res.json({
        ok: true,
        message: 'Reloaded ' + pluginName,
        rconOutput: output || '(no output)',
        configReady: hasConfig,
        dataReady: hasData,
      });
    } catch (e) {
      res.status(500).json({ error: 'RCON failed: ' + e.message });
    }
  } else {
    res.status(400).json({ error: game + ' does not support hot-reload via RCON' });
  }
});

// ── List Carbon-loaded plugins via RCON ──
router.get('/api/carbon/status', requireSuperAdmin, async (req, res) => {
  try {
    const rust = GAME_LIBS.rust();
    if (!rust.isRunning()) return res.json({ online: false, plugins: [] });

    const output = await rust.rconCommand('c.plugins');
    res.json({ online: true, output: output || '(no output)' });
  } catch (e) {
    res.json({ online: false, error: e.message });
  }
});

// ── Plugin config management ──

const CONFIG_PATHS = {
  rust: '/srv/games/rust/carbon/configs',
  valheim: '/srv/games/valheim/BepInEx/config',
  l4d2: '/srv/games/l4d2/addons/sourcemod/configs',
  '7dtd': '/srv/games/7dtd/Mods',
};

const CONFIG_EXTENSIONS = ['.json', '.cfg', '.yaml', '.yml', '.xml', '.ini', '.txt', '.conf'];

// List config files for a plugin or all configs for a game
router.get('/api/configs/:game', requireAuth, (req, res) => {
  const game = req.params.game;
  const configDir = CONFIG_PATHS[game];
  if (!configDir || !fs.existsSync(configDir)) return res.json({ configs: [] });

  const pluginName = req.query.plugin || null;

  try {
    if (game === '7dtd' && pluginName) {
      // 7DTD: configs are inside mod folders
      const modDir = path.join(configDir, pluginName);
      if (!fs.existsSync(modDir)) return res.json({ configs: [] });
      const files = scanConfigFiles(modDir, modDir);
      return res.json({ configs: files });
    }

    // For other games: list all config files, optionally filter by plugin name
    const files = scanConfigFiles(configDir, configDir);
    const filtered = pluginName
      ? files.filter(f => f.name.toLowerCase().includes(pluginName.toLowerCase()))
      : files;
    res.json({ configs: filtered });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function scanConfigFiles(dir, baseDir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(baseDir, fullPath);
      if (entry.isFile() && CONFIG_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
        const stat = fs.statSync(fullPath);
        results.push({
          name: entry.name,
          path: relPath,
          size: stat.size,
          modified: stat.mtime,
        });
      }
    }
  } catch (e) {}
  return results;
}

// Read a config file
router.get('/api/configs/:game/read', requireSuperAdmin, (req, res) => {
  const game = req.params.game;
  const filePath = req.query.file;
  if (!filePath) return res.status(400).json({ error: 'file param required' });

  const configDir = CONFIG_PATHS[game];
  if (!configDir) return res.status(400).json({ error: 'Invalid game' });

  // Prevent directory traversal
  const resolved = path.resolve(configDir, filePath);
  if (!resolved.startsWith(path.resolve(configDir))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Config not found' });

  try {
    const content = fs.readFileSync(resolved, 'utf8');
    res.json({ ok: true, file: filePath, content, size: content.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Write a config file
router.put('/api/configs/:game/write', requireSuperAdmin, express.json({ limit: '1mb' }), (req, res) => {
  const game = req.params.game;
  const { file, content } = req.body;
  if (!file || content === undefined) return res.status(400).json({ error: 'file and content required' });

  const configDir = CONFIG_PATHS[game];
  if (!configDir) return res.status(400).json({ error: 'Invalid game' });

  const resolved = path.resolve(configDir, file);
  if (!resolved.startsWith(path.resolve(configDir))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    // Backup before overwriting
    if (fs.existsSync(resolved)) {
      fs.copyFileSync(resolved, resolved + '.bak');
    }
    fs.writeFileSync(resolved, content, 'utf8');
    res.json({ ok: true, message: 'Config saved (backup created)' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
