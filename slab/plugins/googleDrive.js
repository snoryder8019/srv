// ─────────────────────────────────────────────────────────────────────────────
// googleDrive.js — Google Drive API helpers for asset import.
//
// OAuth (consent URL / code exchange / access-token cache) lives in the shared
// plugins/googleOAuth.js; this module owns only the Drive-specific scope and the
// Drive v3 API calls. Each tenant's refresh token is stored encrypted on the
// tenant doc (secrets.googleDriveRefreshToken).
//
// Scope: drive.readonly is a Google "restricted" scope — the shared app must be
// verified (and pass CASA) before non-test users can grant it. Test users on the
// OAuth consent screen work without verification. Uses global fetch (Node 18+).
// ─────────────────────────────────────────────────────────────────────────────
import { buildConsentUrl, exchangeCode as exchangeGoogleCode, getAccessToken, clearAccessToken } from './googleOAuth.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

// drive.readonly to browse/download any of the user's files; openid+email so we
// can show which Google account is connected.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly openid email';

// Thin service-named wrappers over the shared OAuth primitives — keeps the
// existing import sites (routes/auth.js, routes/admin/assets/drive.js) unchanged.
export const buildDriveAuthUrl = ({ clientId, redirectUri, state }) =>
  buildConsentUrl({ clientId, redirectUri, state, scope: DRIVE_SCOPE });
export const exchangeCode = exchangeGoogleCode;
export const getDriveAccessToken = getAccessToken;
export const clearDriveAccessToken = clearAccessToken;

// ── Drive API ─────────────────────────────────────────────────────────────────

// Escape a value for use inside a Drive query string literal.
function q(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * List image files (and, optionally, sub-folders for navigation) inside a Drive
 * folder. Returns { files, folders, nextPageToken }.
 *   - folderId: parent to list ('root' or a folder id); omitted → whole Drive
 *   - search:   free-text name filter (applied Drive-side)
 *   - pageToken: continuation token from a prior call
 */
export async function listDriveImages(accessToken, { folderId, search, pageToken } = {}) {
  const clauses = ['trashed = false'];
  // Images OR folders (folders only make sense when browsing a parent, but Drive
  // ignores the parent clause harmlessly when absent).
  clauses.push("(mimeType contains 'image/' or mimeType = 'application/vnd.google-apps.folder')");
  if (folderId) clauses.push(`'${q(folderId)}' in parents`);
  if (search) clauses.push(`name contains '${q(search)}'`);

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'nextPageToken, files(id, name, mimeType, size, thumbnailLink, modifiedTime, imageMediaMetadata(width,height))',
    orderBy: 'folder, modifiedTime desc',
    pageSize: '50',
    spaces: 'drive',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Drive list failed: ${data.error?.message || res.status}`);

  const all = Array.isArray(data.files) ? data.files : [];
  const folders = all.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
  const files = all.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
  return { files, folders, nextPageToken: data.nextPageToken || null };
}

/** Fetch a single file's metadata (subset of fields). */
export async function getDriveFileMeta(accessToken, fileId) {
  const params = new URLSearchParams({
    fields: 'id, name, mimeType, size, thumbnailLink',
    supportsAllDrives: 'true',
  });
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Drive file meta failed: ${data.error?.message || res.status}`);
  return data;
}

/**
 * Download a Drive file's bytes. Returns { buffer, mimeType, name, size }.
 * `maxBytes` guards against pulling something enormous into memory.
 */
export async function downloadDriveFile(accessToken, fileId, { maxBytes = 200 * 1024 * 1024 } = {}) {
  const meta = await getDriveFileMeta(accessToken, fileId);
  if (meta.mimeType === 'application/vnd.google-apps.folder') {
    throw new Error('Cannot import a folder');
  }
  if (meta.size && Number(meta.size) > maxBytes) {
    throw new Error(`File too large (${Math.round(Number(meta.size) / 1048576)}MB, limit ${Math.round(maxBytes / 1048576)}MB)`);
  }
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Drive download failed: ${err.error?.message || res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error('File exceeds size limit');
  return { buffer, mimeType: meta.mimeType || 'application/octet-stream', name: meta.name || fileId, size: buffer.length };
}

/**
 * Stream a file's thumbnail bytes (for the in-app browser grid). Drive's
 * thumbnailLink is only reachable with the OAuth token, so we proxy it.
 * Returns { buffer, contentType } or null if no thumbnail is available.
 */
export async function fetchDriveThumbnail(accessToken, fileId) {
  const meta = await getDriveFileMeta(accessToken, fileId);
  if (!meta.thumbnailLink) return null;
  const res = await fetch(meta.thumbnailLink, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get('content-type') || 'image/jpeg' };
}
