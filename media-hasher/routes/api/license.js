// Public license API — called by the Electron desktop app.
// All endpoints are JSON. No session required (the license key IS the credential).
import express from 'express';
import { findByKey, activateDevice, heartbeat, deactivateDevice } from '../../plugins/licenseService.js';

const router = express.Router();

/** GET /api/license/lookup?key=MH-XXXX-... — basic info, no activation */
router.get('/lookup', async (req, res) => {
  const key = (req.query.key || '').trim().toUpperCase();
  if (!key) return res.status(400).json({ error: 'key_required' });
  const license = await findByKey(key);
  if (!license) return res.status(404).json({ error: 'not_found' });
  res.json({
    ok: true,
    type: license.type,
    status: license.status,
    trialExpiresAt: license.trialExpiresAt || null,
    activations: (license.activations || []).length,
    maxActivations: license.maxActivations,
  });
});

/** POST /api/license/activate { key, deviceId, deviceName, platform } → { ok, token, license } */
router.post('/activate', async (req, res) => {
  const { key, deviceId, deviceName, platform } = req.body || {};
  if (!key || !deviceId) return res.status(400).json({ error: 'key_and_deviceId_required' });
  const result = await activateDevice({
    key: String(key).trim().toUpperCase(),
    deviceId: String(deviceId),
    deviceName: deviceName || 'Unknown device',
    platform: platform || 'unknown',
  });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

/** POST /api/license/heartbeat { token } → { ok, license } */
router.post('/heartbeat', async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token_required' });
  const result = await heartbeat({ token });
  if (!result.ok) return res.status(401).json(result);
  res.json(result);
});

/** POST /api/license/deactivate { key, deviceId } */
router.post('/deactivate', async (req, res) => {
  const { key, deviceId } = req.body || {};
  if (!key || !deviceId) return res.status(400).json({ error: 'key_and_deviceId_required' });
  const result = await deactivateDevice({ key: String(key).trim().toUpperCase(), deviceId });
  res.json(result);
});

export default router;
