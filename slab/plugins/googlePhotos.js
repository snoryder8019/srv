// ─────────────────────────────────────────────────────────────────────────────
// googlePhotos.js — Google Photos Picker API helpers for asset import.
//
// Google removed broad Photos Library read access in 2025; the supported path is
// now the Picker API: create a session, send the user to Google's own picker
// (pickerUri), poll until they finish (mediaItemsSet), then list + download only
// the items they picked. We cannot browse the user's whole library server-side.
//
// OAuth lives in the shared plugins/googleOAuth.js. Each tenant's refresh token is
// stored encrypted on the tenant doc (secrets.googlePhotosRefreshToken).
//
// Scope: photospicker.mediaitems.readonly — session-scoped access to the picked
// items only (much narrower than Drive's restricted drive.readonly).
// Uses global fetch (Node 18+).
// ─────────────────────────────────────────────────────────────────────────────
import { buildConsentUrl, getAccessToken, clearAccessToken } from './googleOAuth.js';

const PICKER_API = 'https://photospicker.googleapis.com/v1';

export const PHOTOS_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly openid email';

// Service-named wrappers over the shared OAuth primitives.
export const buildPhotosAuthUrl = ({ clientId, redirectUri, state }) =>
  buildConsentUrl({ clientId, redirectUri, state, scope: PHOTOS_SCOPE });
export const getPhotosAccessToken = getAccessToken;
export const clearPhotosAccessToken = clearAccessToken;

// Parse a protobuf Duration string ("3s", "1.5s") into whole milliseconds.
export function parseDurationMs(d, fallbackMs) {
  if (typeof d !== 'string') return fallbackMs;
  const m = d.match(/([\d.]+)s$/);
  return m ? Math.round(parseFloat(m[1]) * 1000) : fallbackMs;
}

async function pickerFetch(accessToken, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${PICKER_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  // DELETE returns an empty body on success.
  if (method === 'DELETE') {
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(`Picker ${method} ${path} failed: ${e.error?.message || res.status}`);
    }
    return {};
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Picker ${method} ${path} failed: ${data.error?.message || res.status}`);
  return data;
}

/** Create a picking session. Returns { id, pickerUri, pollIntervalMs, timeoutMs, mediaItemsSet }. */
export async function createPickerSession(accessToken, { maxItemCount = 50 } = {}) {
  const data = await pickerFetch(accessToken, '/sessions', {
    method: 'POST',
    body: { pickingConfig: { maxItemCount: String(maxItemCount) } },
  });
  return {
    id: data.id,
    pickerUri: data.pickerUri,
    pollIntervalMs: parseDurationMs(data.pollingConfig?.pollInterval, 3000),
    timeoutMs: parseDurationMs(data.pollingConfig?.timeoutIn, 5 * 60 * 1000),
    mediaItemsSet: !!data.mediaItemsSet,
    expireTime: data.expireTime || null,
  };
}

/** Poll a session. Returns { mediaItemsSet, expireTime }. */
export async function getPickerSession(accessToken, sessionId) {
  const data = await pickerFetch(accessToken, `/sessions/${encodeURIComponent(sessionId)}`);
  return { mediaItemsSet: !!data.mediaItemsSet, expireTime: data.expireTime || null };
}

/** Delete a session (best-effort cleanup after import). */
export async function deletePickerSession(accessToken, sessionId) {
  return pickerFetch(accessToken, `/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

/**
 * List all items the user picked in a session (paginates fully).
 * Returns [{ id, filename, mimeType, type, baseUrl }].
 */
export async function listPickedItems(accessToken, sessionId) {
  const out = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({ sessionId, pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await pickerFetch(accessToken, `/mediaItems?${params.toString()}`);
    for (const it of data.mediaItems || []) {
      const mf = it.mediaFile || {};
      out.push({
        id: it.id,
        type: it.type || null,               // 'PHOTO' | 'VIDEO'
        filename: mf.filename || `${it.id}`,
        mimeType: mf.mimeType || 'application/octet-stream',
        baseUrl: mf.baseUrl || null,
      });
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return out;
}

/**
 * Download a picked item's full-resolution bytes. Picker baseUrls require the
 * OAuth token and a download parameter ('=d'). Returns { buffer, mimeType }.
 */
export async function downloadPickedBytes(accessToken, baseUrl, mimeType, { maxBytes = 200 * 1024 * 1024 } = {}) {
  if (!baseUrl) throw new Error('Item has no download URL (session may have expired)');
  const res = await fetch(`${baseUrl}=d`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Photo download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error('File exceeds size limit');
  return { buffer, mimeType: mimeType || res.headers.get('content-type') || 'application/octet-stream' };
}

/** Fetch a thumbnail (sized) for the picked-items preview grid. Returns { buffer, contentType } | null. */
export async function fetchPickedThumb(accessToken, baseUrl) {
  if (!baseUrl) return null;
  const res = await fetch(`${baseUrl}=w400-h400`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/jpeg' };
}

// ── Short-lived cache of a session's picked items, so the thumbnail proxy can
// resolve a baseUrl without re-listing on every tile. Keyed by sessionId (which
// is globally unique). TTL matches a generous session lifetime. ────────────────
const itemsCache = new Map(); // sessionId -> { items, at }
const ITEMS_TTL_MS = 30 * 60 * 1000;

export function cacheSessionItems(sessionId, items) {
  itemsCache.set(sessionId, { items, at: Date.now() });
}
export function getCachedItem(sessionId, itemId) {
  const hit = itemsCache.get(sessionId);
  if (!hit || Date.now() - hit.at > ITEMS_TTL_MS) return null;
  return hit.items.find(i => i.id === itemId) || null;
}
export function dropSessionItems(sessionId) {
  itemsCache.delete(sessionId);
}
