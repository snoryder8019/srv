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

// ── Engage: load one account's recent posts + analytics + comments (JSON) ─────
router.get('/engage/:platform', async (req, res) => {
  const db = req.db;
  const platform = req.params.platform;
  if (!engageCaps(platform)) return res.json({ ok: false, error: 'Engagement not available for this platform' });
  const account = await db.collection('social_accounts').findOne({ platform });
  const result = await fetchEngagement(platform, account);
  res.json(result);
});

// ── Engage: reply to a comment (or post, where allowed) (JSON) ────────────────
router.post('/engage/:platform/reply', express.json(), async (req, res) => {
  const db = req.db;
  const platform = req.params.platform;
  const { targetId, kind, text } = req.body || {};
  const account = await db.collection('social_accounts').findOne({ platform });
  const result = await postReply(platform, account, { targetId, kind: kind || 'comment', text });
  if (result.ok) {
    logActivity({
      category: 'social', action: 'engage_reply',
      tenantDomain: req.tenant?.domain, tenantId: req.tenant?._id, status: 'success',
      actor: { email: req.adminUser?.email, role: 'admin' },
      details: { platform, kind: kind || 'comment' }, ip: req.ip,
    });
  }
  res.json(result);
});


export default router;
