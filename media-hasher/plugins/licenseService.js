// licenseService — single source of truth for license issuance, validation,
// device activation, heartbeat, and revocation.
//
// License keys: MH-XXXX-XXXX-XXXX-XXXX (uppercase alphanumeric, ambiguity-free alphabet)
// Activation JWTs: signed with config.JWT_SECRET, embedded in app, re-validated periodically.

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getDb } from './mongo.js';
import { config } from '../config/config.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function randomGroup(len = 4) {
  const buf = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

export function generateLicenseKey() {
  return ['MH', randomGroup(), randomGroup(), randomGroup(), randomGroup()].join('-');
}

/** Issue a trial license. Idempotent per (userId, type='trial', status='active'). */
export async function issueTrialLicense({ userId, email }) {
  const db = getDb();
  const licenses = db.collection('licenses');

  const existing = await licenses.findOne({
    userId: userId ? new ObjectId(userId) : null,
    email,
    type: 'trial',
    status: 'active',
  });
  if (existing) return existing;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const doc = {
    key: generateLicenseKey(),
    product: 'mediahasher',
    userId: userId ? new ObjectId(userId) : null,
    email,
    purchaseId: null,
    type: 'trial',
    status: 'active',
    trialStartedAt: now,
    trialExpiresAt: expiresAt,
    activations: [],
    maxActivations: config.MAX_ACTIVATIONS,
    createdAt: now,
  };
  const result = await licenses.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

/** Issue (or upgrade) a lifetime license tied to a paid purchase. */
export async function issueLifetimeLicense({ userId, email, purchaseId }) {
  const db = getDb();
  const licenses = db.collection('licenses');
  const now = new Date();

  // If the user already has an active trial, upgrade it in place.
  const trial = await licenses.findOne({
    email,
    type: 'trial',
    status: 'active',
  });

  if (trial) {
    await licenses.updateOne(
      { _id: trial._id },
      {
        $set: {
          type: 'lifetime',
          purchaseId: purchaseId ? new ObjectId(purchaseId) : null,
          userId: userId ? new ObjectId(userId) : trial.userId,
          upgradedAt: now,
        },
        $unset: { trialExpiresAt: '' },
      }
    );
    return licenses.findOne({ _id: trial._id });
  }

  const doc = {
    key: generateLicenseKey(),
    product: 'mediahasher',
    userId: userId ? new ObjectId(userId) : null,
    email,
    purchaseId: purchaseId ? new ObjectId(purchaseId) : null,
    type: 'lifetime',
    status: 'active',
    activations: [],
    maxActivations: config.MAX_ACTIVATIONS,
    createdAt: now,
  };
  const result = await licenses.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

/** Look up a license by its human-readable key. */
export async function findByKey(key) {
  return getDb().collection('licenses').findOne({ key: key?.trim()?.toUpperCase() });
}

/** Used by Electron app on activation. Binds a deviceId to the license, returns a JWT. */
export async function activateDevice({ key, deviceId, deviceName, platform }) {
  const license = await findByKey(key);
  if (!license) return { ok: false, reason: 'not_found' };
  if (license.status !== 'active') return { ok: false, reason: 'revoked' };
  if (license.type === 'trial' && license.trialExpiresAt && license.trialExpiresAt < new Date()) {
    return { ok: false, reason: 'trial_expired' };
  }

  const existing = (license.activations || []).find(a => a.deviceId === deviceId);
  if (!existing && (license.activations || []).length >= license.maxActivations) {
    return { ok: false, reason: 'max_devices', maxActivations: license.maxActivations };
  }

  const now = new Date();
  const activation = existing
    ? { ...existing, lastSeenAt: now }
    : { deviceId, deviceName, platform, activatedAt: now, lastSeenAt: now };

  await getDb().collection('licenses').updateOne(
    { _id: license._id },
    existing
      ? { $set: { 'activations.$[el].lastSeenAt': now },
          // arrayFilters in updateOne — handled below
        }
      : { $push: { activations: activation } },
    existing ? { arrayFilters: [{ 'el.deviceId': deviceId }] } : {}
  );

  const token = jwt.sign(
    {
      licenseId: license._id.toString(),
      key: license.key,
      type: license.type,
      deviceId,
      exp: Math.floor(Date.now() / 1000) + config.LICENSE_HEARTBEAT_DAYS * 24 * 60 * 60,
    },
    config.JWT_SECRET
  );

  return {
    ok: true,
    token,
    license: {
      key: license.key,
      type: license.type,
      trialExpiresAt: license.trialExpiresAt || null,
      maxActivations: license.maxActivations,
      activations: (license.activations || []).length + (existing ? 0 : 1),
    },
  };
}

/** Periodic heartbeat from the Electron app — confirms license is still good. */
export async function heartbeat({ token }) {
  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
  const license = await getDb().collection('licenses').findOne({ _id: new ObjectId(payload.licenseId) });
  if (!license || license.status !== 'active') return { ok: false, reason: 'revoked' };
  if (license.type === 'trial' && license.trialExpiresAt && license.trialExpiresAt < new Date()) {
    return { ok: false, reason: 'trial_expired' };
  }

  await getDb().collection('licenses').updateOne(
    { _id: license._id, 'activations.deviceId': payload.deviceId },
    { $set: { 'activations.$.lastSeenAt': new Date() } }
  );

  return {
    ok: true,
    license: {
      key: license.key,
      type: license.type,
      trialExpiresAt: license.trialExpiresAt || null,
    },
  };
}

export async function deactivateDevice({ key, deviceId }) {
  const license = await findByKey(key);
  if (!license) return { ok: false, reason: 'not_found' };
  await getDb().collection('licenses').updateOne(
    { _id: license._id },
    { $pull: { activations: { deviceId } } }
  );
  return { ok: true };
}
