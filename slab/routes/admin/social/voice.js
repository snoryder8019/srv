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

// ── Voice Profile (Brand DNA) ─────────────────────────────────────────────────
// Synthesize a structured voice profile from the guided-Q&A answers (preview —
// does not save; the admin reviews/edits then POSTs /voice to persist).
router.post('/voice/synthesize', express.json(), async (req, res) => {
  try {
    const answers = req.body?.answers || {};
    const brandCtx = await loadBrandContext(req.tenant, req.db);
    const out = await synthesizeProfile(answers, brandCtx);
    res.json({ ok: true, ...out });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Save the voice profile (structured fields + editable voiceBlock). Seeds the
// few-shot example pairs on first save; preserves accumulated corrections after.
router.post('/voice', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const db = req.db;
    const b = req.body || {};
    const patch = {
      persona: (b.persona || '').toString().slice(0, 400),
      audience: (b.audience || '').toString().slice(0, 400),
      tone: Array.isArray(b.tone) ? b.tone : (b.tone || '').toString().split(/[\n,;]+/).map(s => s.trim()).filter(Boolean),
      signaturePhrases: Array.isArray(b.signaturePhrases) ? b.signaturePhrases : (b.signaturePhrases || '').toString().split(/[\n,;]+/).map(s => s.trim()).filter(Boolean),
      avoid: Array.isArray(b.avoid) ? b.avoid : (b.avoid || '').toString().split(/[\n,;]+/).map(s => s.trim()).filter(Boolean),
      emojiPolicy: (b.emojiPolicy || '').toString().slice(0, 200),
      hashtagPolicy: (b.hashtagPolicy || '').toString().slice(0, 200),
      lengthPref: (b.lengthPref || '').toString().slice(0, 200),
      interview: (b.interview && typeof b.interview === 'object') ? b.interview : undefined,
    };
    if (patch.interview === undefined) delete patch.interview;
    // Editable block: use what the admin sent, else rebuild from fields.
    patch.voiceBlock = (b.voiceBlock || '').toString().trim() || buildVoiceBlock(patch);

    const existing = await getVoice(db);
    // Seed example pairs only when none exist yet (don't clobber learned corrections).
    if ((!existing || !Array.isArray(existing.fewShot) || !existing.fewShot.length) && Array.isArray(b.seedFewShot) && b.seedFewShot.length) {
      patch.fewShot = b.seedFewShot.slice(-15).map(p => ({ before: String(p.before || '').slice(0, 400), after: String(p.after || '').slice(0, 400), source: 'synthesis', at: new Date() }));
    }
    const saved = await saveVoice(db, patch);
    res.json({ ok: true, voice: saved });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


export default router;
