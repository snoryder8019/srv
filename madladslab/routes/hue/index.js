import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const HUE_BASE = 'https://api.meethue.com';
const TOKEN_FILE = path.join(__dirname, '../../hue-tokens.json');

// --- Token storage ---
function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); }
  catch { return null; }
}
function saveTokens(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
}

// --- Refresh + return valid access token ---
async function getValidToken() {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Not authorized — visit /hue/auth');

  if (Date.now() < tokens.expires_at - 60000) return tokens.access_token;

  const creds = Buffer.from(`${process.env.HUE_CID}:${process.env.HUE_SEC}`).toString('base64');
  const res = await axios.post(`${HUE_BASE}/v2/oauth2/token`,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const updated = {
    ...tokens,
    access_token: res.data.access_token,
    refresh_token: res.data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + res.data.expires_in * 1000
  };
  saveTokens(updated);
  return updated.access_token;
}

// --- Hue CLIP v2 helper ---
async function hue(method, resource, data) {
  const token = await getValidToken();
  const { bridge_id = '0', app_key = '' } = loadTokens() || {};
  return axios({
    method,
    url: `${HUE_BASE}/route/${bridge_id}/clip/v2/resource${resource}`,
    headers: { Authorization: `Bearer ${token}`, 'hue-application-key': app_key },
    data
  });
}

// --- Error wrapper ---
function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      const msg = err.response?.data || err.message;
      res.status(err.response?.status || 500).json({ error: msg });
    }
  };
}

// ──────────────────────────────────────────────
// AUTH
// ──────────────────────────────────────────────

// GET /hue/auth — kick off OAuth
router.get('/auth', (req, res) => {
  const url = `${HUE_BASE}/v2/oauth2/authorize?client_id=${process.env.HUE_CID}&response_type=code&state=openclaw`;
  res.redirect(url);
});

// GET /hue/callback — Hue redirects here with ?code=
router.get('/callback', wrap(async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).json({ error });
  if (!code) return res.status(400).json({ error: 'No code in callback' });

  const creds = Buffer.from(`${process.env.HUE_CID}:${process.env.HUE_SEC}`).toString('base64');
  const tokenRes = await axios.post(`${HUE_BASE}/v2/oauth2/token`,
    new URLSearchParams({ grant_type: 'authorization_code', code }),
    { headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  saveTokens({
    access_token: tokenRes.data.access_token,
    refresh_token: tokenRes.data.refresh_token,
    expires_at: Date.now() + tokenRes.data.expires_in * 1000,
    bridge_id: null,
    app_key: null
  });

  res.json({ success: true, next: 'Press link button on bridge, then GET /hue/setup' });
}));

// GET /hue/bridges — list bridges linked to this Hue account (useful for debug)
router.get('/bridges', wrap(async (_req, res) => {
  const token = await getValidToken();
  const r = await axios.get(`${HUE_BASE}/v2/bridges`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  res.json(r.data);
}));

// GET /hue/setup — discover bridge ID from account, then create app key
// Press link button on bridge at home first, then hit this.
router.get('/setup', wrap(async (req, res) => {
  const token = await getValidToken();

  // Step 1: get the bridge ID linked to this Hue account
  const bridgesRes = await axios.get(`${HUE_BASE}/v2/bridges`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const bridges = bridgesRes.data;
  if (!bridges || bridges.length === 0) {
    return res.status(404).json({ error: 'No bridges linked to this Hue account' });
  }

  const bridgeId = bridges[0].id;

  // Step 2: create app key via remote API (CLIP v1 endpoint, no link button needed remotely)
  const appRes = await axios.post(
    `${HUE_BASE}/bridge/${bridgeId}/api`,
    { devicetype: 'openclaw#madladslab' },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const result = appRes.data[0];
  if (result.error) {
    return res.status(400).json({
      error: result.error.description,
      hint: 'Press the link button on your Hue bridge at home first, then retry'
    });
  }

  const tokens = loadTokens();
  tokens.bridge_id = bridgeId;
  tokens.app_key = result.success.username;
  saveTokens(tokens);

  res.json({ success: true, bridge_id: bridgeId, app_key: tokens.app_key, bridges_found: bridges.length });
}));

// GET /hue/status — token + setup health check
router.get('/status', (req, res) => {
  const tokens = loadTokens();
  if (!tokens) return res.json({ authorized: false, next: 'GET /hue/auth' });
  res.json({
    authorized: true,
    expires_at: new Date(tokens.expires_at).toISOString(),
    expired: Date.now() > tokens.expires_at,
    bridge_id: tokens.bridge_id,
    setup_complete: !!(tokens.bridge_id && tokens.app_key)
  });
});

// ──────────────────────────────────────────────
// LIGHTS
// ──────────────────────────────────────────────

// GET /hue/lights
router.get('/lights', wrap(async (req, res) => {
  const r = await hue('get', '/light');
  res.json(r.data.data.map(l => ({
    id: l.id,
    name: l.metadata?.name,
    on: l.on?.on,
    brightness: l.dimming?.brightness,
    color_temp: l.color_temperature?.mirek,
    reachable: l.status?.connectivity?.status === 'connected'
  })));
}));

// PUT /hue/lights/:id  body: { on, brightness, color_temp }
router.put('/lights/:id', wrap(async (req, res) => {
  const { on, brightness, color_temp } = req.body;
  const payload = {};
  if (on !== undefined) payload.on = { on };
  if (brightness !== undefined) payload.dimming = { brightness };
  if (color_temp !== undefined) payload.color_temperature = { mirek: color_temp };
  const r = await hue('put', `/light/${req.params.id}`, payload);
  res.json({ success: true, errors: r.data.errors });
}));

// ──────────────────────────────────────────────
// ROOMS
// ──────────────────────────────────────────────

// GET /hue/rooms
router.get('/rooms', wrap(async (req, res) => {
  const r = await hue('get', '/room');
  res.json(r.data.data.map(room => ({
    id: room.id,
    name: room.metadata?.name,
    grouped_light_id: room.services?.find(s => s.rtype === 'grouped_light')?.rid
  })));
}));

// PUT /hue/grouped_light/:id  body: { on, brightness, color_temp }
router.put('/grouped_light/:id', wrap(async (req, res) => {
  const { on, brightness, color_temp } = req.body;
  const payload = {};
  if (on !== undefined) payload.on = { on };
  if (brightness !== undefined) payload.dimming = { brightness };
  if (color_temp !== undefined) payload.color_temperature = { mirek: color_temp };
  const r = await hue('put', `/grouped_light/${req.params.id}`, payload);
  res.json({ success: true, errors: r.data.errors });
}));

// ──────────────────────────────────────────────
// SCENES
// ──────────────────────────────────────────────

// GET /hue/scenes
router.get('/scenes', wrap(async (req, res) => {
  const r = await hue('get', '/scene');
  res.json(r.data.data.map(s => ({
    id: s.id,
    name: s.metadata?.name,
    room_id: s.group?.rid
  })));
}));

// PUT /hue/scene/:id — recall scene
router.put('/scene/:id', wrap(async (req, res) => {
  const r = await hue('put', `/scene/${req.params.id}`, { recall: { action: 'active' } });
  res.json({ success: true, errors: r.data.errors });
}));

// ──────────────────────────────────────────────
// CMD — single endpoint for OpenClaw
// ──────────────────────────────────────────────
//
// POST /hue/cmd
// {
//   action: 'on' | 'off' | 'dim' | 'scene',
//   target: 'all' | 'room:<id>' | 'light:<id>',   // default: 'all'
//   brightness: 0-100,      // for dim / on with brightness
//   color_temp: 153-500,    // mirek (153=cool, 500=warm)
//   scene_id: '<uuid>'      // for action: 'scene'
// }

router.post('/cmd', wrap(async (req, res) => {
  const { action, target = 'all', brightness, color_temp, scene_id } = req.body;

  // Scene recall
  if (action === 'scene') {
    if (!scene_id) return res.status(400).json({ error: 'scene_id required for action: scene' });
    await hue('put', `/scene/${scene_id}`, { recall: { action: 'active' } });
    return res.json({ success: true, action: 'scene', scene_id });
  }

  // Build state payload
  const payload = {};
  if (action === 'on')  payload.on = { on: true };
  if (action === 'off') payload.on = { on: false };
  if (action === 'dim') payload.on = { on: true };
  if (brightness !== undefined) payload.dimming = { brightness };
  if (color_temp !== undefined) payload.color_temperature = { mirek: color_temp };

  // target: all
  if (target === 'all') {
    const rooms = await hue('get', '/room');
    const groupIds = rooms.data.data
      .map(r => r.services?.find(s => s.rtype === 'grouped_light')?.rid)
      .filter(Boolean);
    await Promise.all(groupIds.map(id => hue('put', `/grouped_light/${id}`, payload)));
    return res.json({ success: true, action, target: 'all', groups_affected: groupIds.length });
  }

  // target: room:<id>
  if (target.startsWith('room:')) {
    const roomId = target.split(':')[1];
    const rooms = await hue('get', '/room');
    const room = rooms.data.data.find(r => r.id === roomId);
    const groupId = room?.services?.find(s => s.rtype === 'grouped_light')?.rid;
    if (!groupId) return res.status(404).json({ error: `Room ${roomId} not found or has no grouped_light` });
    await hue('put', `/grouped_light/${groupId}`, payload);
    return res.json({ success: true, action, target, room: room.metadata?.name });
  }

  // target: light:<id>
  if (target.startsWith('light:')) {
    const lightId = target.split(':')[1];
    await hue('put', `/light/${lightId}`, payload);
    return res.json({ success: true, action, target });
  }

  res.status(400).json({ error: 'Invalid target. Use: all | room:<id> | light:<id>' });
}));

export default router;
