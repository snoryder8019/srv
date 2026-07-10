import express from 'express';
import QRCode from 'qrcode';
import { ObjectId } from 'mongodb';
import { config } from '../../../config/config.js';
import { callLLM, tryParseAgentResponse, hasCJK, stripCJK } from '../../../plugins/agentMcp.js';
import { loadBrandContext } from '../../../plugins/brandContext.js';
import { logActivity } from '../../../plugins/activityLog.js';
import {
  PLATFORMS, PLATFORM_LIST, LIVE_PLATFORMS,
  packCredentials, unpackCredentials, maskAccount, isAccountConfigured,
  publishToPlatform, publishPost, verifyPlatform, discoverInstagramFromPage,
} from '../../../plugins/socialPublish.js';
import { refreshAccount, applyRefresh } from '../../../plugins/socialTokens.js';
import { fetchEngagement, postReply, allEngageCaps, engageCaps } from '../../../plugins/socialEngage.js';
import { encrypt, decrypt } from '../../../plugins/crypto.js';
import { getSlabDb } from '../../../plugins/mongo.js';
import { generateForTenant, generateSpotlight, publishWithRetry, renderLayersToPng, uploadPng } from '../../../plugins/autoSocial.js';
import { uploadBuffer } from '../../../plugins/s3.js';
import { getVoice, saveVoice, synthesizeProfile, recordCorrection, buildVoiceBlock, VOICE_QUESTIONS } from '../../../plugins/socialVoice.js';
import { enqueueJob, getJob, listJobs } from '../../../plugins/socialJobs.js';
import { recordDesignFeedback, listDesignFeedback, removeDesignFeedback, getDesignPrefs, describePrefs } from '../../../plugins/socialDesign.js';
import { suggestSlots } from '../../../plugins/socialSchedule.js';
import { fetchAllFollows, followsAction } from '../../../plugins/socialFollows.js';
import {
  AUTO_TOKEN_PLATFORMS, tryAutoUpgrade, linkInstagramFromFacebook,
  imageUpload, mediaUpload, POST_STATUSES,
  wantsJson, parsePlatforms, parseMedia, publishPostBackground, loadAccountMap,
} from './shared.js';

const router = express.Router();

// ── Live simulcast studio ─────────────────────────────────────────────────────
// Capture camera + a window and broadcast to every connected RTMP destination
// at once (YouTube Live, Facebook Live, custom RTMP). The heavy lifting — the
// ffmpeg relay — lives on the /live socket.io namespace (plugins/liveStream.js).
// Saved RTMP destinations (Twitch/Kick/Rumble/Trovo/custom) persist per-tenant so
// reconnecting isn't a re-typing chore. Stream keys are encrypted; the raw key
// never returns to the browser — go-live references a saved target by id and the
// socket server decrypts it there.
const RTMP_PRESET_LABELS = { twitch: 'Twitch', kick: 'Kick', rumble: 'Rumble', trovo: 'Trovo', custom: 'Custom RTMP' };
function maskRtmpTarget(t) {
  return { id: String(t._id), preset: t.preset || 'custom', label: t.label || 'RTMP', url: t.url || '', hasKey: !!t.key, channel: t.channel || '' };
}

router.get('/live', async (req, res) => {
  const db = req.db;
  const accountsRaw = await db.collection('social_accounts').find({}).toArray();
  const connected = {};
  for (const a of accountsRaw) if (isAccountConfigured(a)) connected[a.platform] = true;
  const rtmpTargets = await db.collection('live_rtmp_targets').find({}).sort({ createdAt: 1 }).toArray().catch(() => []);
  res.render('admin/social/live', {
    user: req.adminUser,
    page: 'live-studio',
    dbName: db.databaseName,
    connected,
    rtmpTargets: rtmpTargets.map(maskRtmpTarget),
  });
});

// ── Live Studio: list / save / delete persisted RTMP destinations (JSON) ──────
router.get('/live/rtmp', async (req, res) => {
  try {
    const items = await req.db.collection('live_rtmp_targets').find({}).sort({ createdAt: 1 }).toArray();
    res.json({ ok: true, targets: items.map(maskRtmpTarget) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/live/rtmp', express.json(), async (req, res) => {
  try {
    const preset = RTMP_PRESET_LABELS[req.body?.preset] ? req.body.preset : 'custom';
    const label = (req.body?.label || '').toString().trim().slice(0, 60) || RTMP_PRESET_LABELS[preset];
    const url = (req.body?.url || '').toString().trim();
    if (!/^rtmps?:\/\//i.test(url)) return res.json({ ok: false, error: 'Enter a valid rtmp:// or rtmps:// ingest URL' });
    const rawKey = (req.body?.key || '').toString().trim();
    const id = (req.body?.id || '').toString().trim();
    // Twitch channel login enables reading that channel's chat (anonymous IRC).
    const channel = (req.body?.channel || '').toString().trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_]/g, '').slice(0, 40);

    const set = { preset, label, url, channel, updatedAt: new Date() };
    // Only (re)write the key when a real one is supplied; blank/masked keeps the existing key.
    if (rawKey && !rawKey.startsWith('••••')) set.key = encrypt(rawKey);

    if (id) {
      await req.db.collection('live_rtmp_targets').updateOne({ _id: new ObjectId(id) }, { $set: set });
      const doc = await req.db.collection('live_rtmp_targets').findOne({ _id: new ObjectId(id) });
      return res.json({ ok: true, target: maskRtmpTarget(doc) });
    }
    if (!set.key) return res.json({ ok: false, error: 'Enter the stream key' });
    set.createdAt = new Date();
    const ins = await req.db.collection('live_rtmp_targets').insertOne(set);
    res.json({ ok: true, target: maskRtmpTarget({ _id: ins.insertedId, ...set }) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/live/rtmp/:id/delete', async (req, res) => {
  try { await req.db.collection('live_rtmp_targets').deleteOne({ _id: new ObjectId(req.params.id) }); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Live Studio control deck (pop-out window / remote device) ─────────────────
// Standalone deck page. It reads ?transport=bc|socket & ?code=… client-side and
// drives the Live Studio encoder tab via BroadcastChannel (same browser) or the
// socket relay (a phone / second device). Served under /admin, so it's authed.
router.get('/live/control', (req, res) => {
  res.render('admin/social/live-control', { user: req.adminUser, page: 'social' });
});

// QR for the phone/remote deck. Encodes ONLY our own control URL for the given
// pairing code (never arbitrary data) so it can't be abused as an open QR maker.
router.get('/live/qr', async (req, res) => {
  try {
    const code = (req.query.code || '').toString().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    if (!code) return res.status(400).end();
    const url = `https://${req.get('host')}/admin/social/live/control?transport=socket&code=${code}`;
    const png = await QRCode.toBuffer(url, { width: 200, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.end(png);
  } catch { res.status(500).end(); }
});


export default router;
