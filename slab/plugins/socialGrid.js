// ─────────────────────────────────────────────────────────────────────────────
// socialGrid.js — the "9-grid mural": one square 3240×3240 design, cut into 9
// 1080×1080 feed-post tiles, published in REVERSE reading order so Instagram's
// profile grid (newest → top-left) reassembles them into one seamless image.
//
// The magic is entirely in (1) the 3×3 slice and (2) the reverse-ordered publish
// schedule. Each tile then goes live as an ordinary SINGLE feed post through the
// existing, proven socialPublish path — so no new publish/burst machinery, and it
// rides the per-minute scheduler cron (socialCron.runDuePosts) with its claim
// guard. 9 posts is 9% of IG's 100-publishes/24h cap; the default ≥60s spacing
// keeps the burst well under Meta's spam heuristics. Mirrors the seamless-carousel
// helpers in autoSocial.js, but square (3×3) instead of a wide 1×N strip.
// ─────────────────────────────────────────────────────────────────────────────
import { createCanvas, loadImage } from 'canvas';
import { uploadPng, cleanCopy } from './autoSocial.js';
import { loadBrandContext } from './brandContext.js';
import { callLLM, generateSdImage, buildBrandedSdPrompt } from './agentMcp.js';

export const GRID_DIM = 3;                       // 3×3
export const GRID_CELLS = GRID_DIM * GRID_DIM;   // 9
export const GRID_POST = 1080;                   // one IG feed post is a 1080² square (scroll view)

// Instagram's profile GRID (since the Jan-2025 redesign) shows each post as a 4:5
// PORTRAIT crop — a square post gets its left/right sides cut off in the grid. So
// the mural is designed at the portrait crop size (what the grid actually shows),
// then each tile is padded back out to a full square post with dimmed side margins.
// The grid re-crops the square to 4:5 and reveals exactly the designed portrait —
// clean seams, no guesswork — while the scroll-view post stays a framed square.
// If Meta changes the grid ratio, adjust GRID_VISIBLE_RATIO and everything follows.
export const GRID_VISIBLE_RATIO = 4 / 5;                              // grid crop = 4:5 portrait
export const GRID_TILE_W = Math.round(GRID_POST * GRID_VISIBLE_RATIO); // 864 — visible portrait width
export const GRID_MARGIN = Math.round((GRID_POST - GRID_TILE_W) / 2);  // 108 — dimmed margin each side
export const GRID_DESIGN_W = GRID_TILE_W * GRID_DIM;                   // 2592 — full design canvas W
export const GRID_DESIGN_H = GRID_POST * GRID_DIM;                     // 3240 — full design canvas H

export const MURAL_SPACING_MIN = 60;             // per-minute cron → 60s is the floor
export const MURAL_SPACING_DEFAULT = 90;         // seconds between tiles
export const MURAL_DAILY_CAP = 4;                // max murals per 24h (see route — spam-safety)

const fetchBufUrl = async (url, ms = 20000) => {
  if (!url) return null;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); if (r.ok) return Buffer.from(await r.arrayBuffer()); } catch { /* null */ }
  return null;
};

// Reading-order index (0=top-left … 8=bottom-right) → {row,col}. Public helper so
// the UI and scheduler agree on tile identity.
export function cellPosition(i) { return { row: Math.floor(i / GRID_DIM), col: i % GRID_DIM }; }
export function cellLabel(i) {
  const rows = ['top', 'middle', 'bottom'], cols = ['left', 'center', 'right'];
  const { row, col } = cellPosition(i);
  return `${rows[row]}-${cols[col]}`;
}

// Pad one 864×1080 portrait tile out to a full 1080×1080 square post by adding
// dimmed side margins: a heavily-softened, darkened copy of the tile itself fills
// the left/right bars, so the square reads as an intentionally-framed post while
// the sharp portrait sits centered. The blur is done with a downscale→upscale pass
// (no node-canvas filter dependency). Colours always match because the margin IS
// the tile's own content. Returns a 1080² canvas.
function padPortraitToSquare(tileCanvas) {
  const c = createCanvas(GRID_POST, GRID_POST);
  const ctx = c.getContext('2d');
  // 1. Blurred cover background: shrink the tile to a tiny canvas, then draw it
  //    back scaled to COVER the full square — the upscale smears it into a blur.
  const sw = 48, sh = Math.round(sw * (GRID_POST / GRID_TILE_W));   // keep tile aspect
  const small = createCanvas(sw, sh);
  small.getContext('2d').drawImage(tileCanvas, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = true;
  const scale = Math.max(GRID_POST / sw, GRID_POST / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(small, (GRID_POST - dw) / 2, (GRID_POST - dh) / 2, dw, dh);
  // 2. Dim the whole background so the margins recede behind the sharp center.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, GRID_POST, GRID_POST);
  // 3. Sharp portrait tile, centered (this is the grid-visible 4:5 region).
  ctx.drawImage(tileCanvas, GRID_MARGIN, 0, GRID_TILE_W, GRID_POST);
  return c;
}

// Cut the portrait DESIGN canvas (2592×3240 = 3×3 of 864×1080 portrait tiles) into
// 9 uploaded 1080×1080 SQUARE posts, each padded with dimmed margins, returned in
// READING order [0..8] (top-left → bottom-right). Cover-fits the source to the
// design canvas first so an upload/SD image of any near-portrait-grid size fills it.
export async function sliceGridImage(bgUrl, prefix) {
  const buf = await fetchBufUrl(bgUrl);
  if (!buf) return [];
  const img = await loadImage(buf);
  const design = createCanvas(GRID_DESIGN_W, GRID_DESIGN_H);
  const dctx = design.getContext('2d');
  const s = Math.max(GRID_DESIGN_W / img.width, GRID_DESIGN_H / img.height);
  dctx.drawImage(img, (GRID_DESIGN_W - img.width * s) / 2, (GRID_DESIGN_H - img.height * s) / 2, img.width * s, img.height * s);
  const urls = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    const { row, col } = cellPosition(i);
    const tile = createCanvas(GRID_TILE_W, GRID_POST);
    tile.getContext('2d').drawImage(design, col * GRID_TILE_W, row * GRID_POST, GRID_TILE_W, GRID_POST, 0, 0, GRID_TILE_W, GRID_POST);
    const square = padPortraitToSquare(tile);
    const up = await uploadPng(square.toBuffer('image/png'), prefix, `mural-${i + 1}`);
    urls.push(up.url);
  }
  return urls;
}

// Resolve the mural background to a persisted URL: an uploaded URL wins; otherwise
// (useSd) generate a GPU-safe square SD texture and upload it; else null (the
// canvas editor supplies its own baked design, so a null bg is fine).
async function resolveGridBg(tenant, db, opts) {
  let bgUrl = opts.bgUrl || null;
  if (!bgUrl && opts.useSd) {
    try {
      const brandContext = await loadBrandContext(tenant, db);
      const seed = (opts.direction || `${tenant.brand?.businessType || 'brand'} abstract texture`).slice(0, 120);
      const branded = await buildBrandedSdPrompt(seed, brandContext, {}).catch(() => null);
      const buf = branded ? await generateSdImage(branded.prompt, branded.negative, '512x640').catch(() => null) : null;   // portrait-grid aspect, GPU-safe
      if (buf) { const up = await uploadPng(buf, tenant.s3Prefix, 'mural-bg').catch(() => null); if (up) bgUrl = up.url; }
    } catch { /* editor-baked design fallback */ }
  }
  return bgUrl;
}

// AI-draft one short caption per cell PLUS a full "cover" caption for the top-left
// tile (which publishes last and reads as the mural's headline post). Returns
// { cover, cells:[9] }. Caller can edit every field before scheduling.
export async function draftMuralCopy(tenant, db, opts = {}) {
  const direction = (opts.direction || '').trim();
  const brandContext = await loadBrandContext(tenant, db);
  const sys = `You write Instagram captions for a 9-post GRID MURAL — nine feed posts that assemble into ONE image on the profile grid (top-left is the cover, read left→right, top→bottom).
${brandContext}
${direction ? `Theme / angle: "${direction}".` : 'Pick a genuinely on-brand theme.'}

Output EXACTLY 10 <CAP> blocks and NOTHING else (no prose, no JSON, no fences):
<CAP>COVER: the full caption for the whole mural — a hook, 1-2 sentences of value, then up to 8 relevant hashtags</CAP>
<CAP>CELL: one short line for the top-left tile</CAP>
... one CELL line for each of the 9 tiles in reading order (top-left → bottom-right).
Rules: exactly 1 COVER then 9 CELL blocks; each CELL is ONE short line (≤12 words), no hashtags; finished copy only, never bracketed placeholders.`;
  const raw = await callLLM([{ role: 'user', content: `Write the mural captions now.${direction ? ' Theme: ' + direction : ''}` }], sys, 90000);
  // NB: String.match(/…/g) returns the FULL matched strings (tags and all), not the
  // capture group — so each block still starts with "<CAP>". Strip the wrapper first,
  // THEN read the COVER:/CELL: label. Also flatten the literal <br> tags the model
  // tends to emit into spaces (these are captions, not HTML).
  const blocks = String(raw).match(/<CAP>[\s\S]*?<\/CAP>/gi) || [];
  const clean = (s) => cleanCopy(String(s).replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim());
  let cover = '';
  const cells = [];
  for (const rawB of blocks) {
    const b = rawB.replace(/<\/?CAP>/gi, '').trim();
    const mCover = b.match(/^\s*COVER\s*:\s*([\s\S]+)$/i);
    if (mCover && !cover) { cover = String(mCover[1]).replace(/<br\s*\/?>/gi, ' ').trim().slice(0, 2000); continue; }
    const mCell = b.match(/^\s*CELL\s*:\s*([\s\S]+)$/i);
    if (mCell) { cells.push(clean(mCell[1]).slice(0, 200)); continue; }
    // Unlabeled block → treat it as the next cell line rather than dropping copy.
    if (b) cells.push(clean(b).slice(0, 200));
  }
  while (cells.length < GRID_CELLS) cells.push('');
  return { cover: cover || (cells[0] || ''), cells: cells.slice(0, GRID_CELLS) };
}

// Build a mural DRAFT (no post yet): resolve the background and optional AI copy.
// The 3240² design itself is composed/flattened client-side in the canvas editor;
// this returns the pieces the review UI needs. Returns { bgUrl, cover, cells }.
export async function generateGridMural(tenant, db, opts = {}) {
  const bgUrl = await resolveGridBg(tenant, db, opts);
  let cover = '', cells = Array.from({ length: GRID_CELLS }, () => '');
  if (!opts.noText && opts.aiCopy !== false) {
    try { ({ cover, cells } = await draftMuralCopy(tenant, db, opts)); } catch { /* leave blank */ }
  }
  return { bgUrl, cover, cells };
}

// Slice a mural draft's baked 3240² image into 9 tiles at publish time. `imageUrl`
// is the flattened canvas from the editor (text and all). Returns tile URLs in
// reading order [0..8].
export async function sliceMuralForPublish(tenant, post) {
  const src = post.muralImageUrl || post.bgUrl || (post.mediaUrls || [])[0];
  if (!src) return [];
  return sliceGridImage(src, tenant.s3Prefix);
}

// Compute the REVERSE publish order + staggered timestamps for a mural. Given tile
// URLs in reading order [0..8] and a start time, returns 9 rows sorted by publish
// order: bottom-right (tile 8) fires FIRST, top-left (tile 0) fires LAST, so the IG
// grid (newest = top-left) reassembles the picture. Spacing is clamped to ≥60s
// (the cron granularity). Each row carries its reading index + cell label so the
// dashboard can reconstruct the mural.
export function buildMuralSchedule(tileUrls, { startAt, spacingSec = MURAL_SPACING_DEFAULT } = {}) {
  const spacing = Math.max(MURAL_SPACING_MIN, Number(spacingSec) || MURAL_SPACING_DEFAULT);
  const base = startAt ? new Date(startAt).getTime() : null;
  const n = tileUrls.length;                       // normally 9
  const rows = [];
  for (let readIdx = 0; readIdx < n; readIdx++) {
    // publish position: last tile (n-1) goes first (pos 0); first tile goes last.
    const pos = (n - 1) - readIdx;
    const at = base != null ? new Date(base + pos * spacing * 1000) : null;
    rows.push({
      readIndex: readIdx,
      publishOrder: pos,
      cell: cellLabel(readIdx),
      url: tileUrls[readIdx],
      scheduledAt: at,
    });
  }
  // Return in publish order (pos 0 → n-1) for readability; scheduledAt already encodes it.
  return rows.sort((a, b) => a.publishOrder - b.publishOrder);
}

// Turn a mural draft into 9 schedulable single-feed-post docs, reverse-ordered.
// `base` carries shared fields (platforms, createdBy, muralId, cover caption…).
// Each doc is an ordinary single post: format 'single', one mediaUrl. The top-left
// tile (reading index 0, published LAST) carries the full cover caption; the other
// tiles carry their short per-cell line (or blank).
// ── GRID-INTEGRITY LOCK ───────────────────────────────────────────────────────
// The IG profile grid is GRID_DIM (3) columns wide and reflows newest-first. Once a
// mural is live, adding 1 or 2 feed posts above it shifts every tile sideways and
// scrambles the picture; adding exactly a FULL ROW (3) pushes the mural down one row
// but keeps each tile in its column, so the image survives. So while a mural is
// protected we "sandbag" non-mural IG feed posts and release them a row (3) at a
// time. A mural itself is 9 = three rows, so it always keeps alignment on its own.
export const GRID_ROW = GRID_DIM;   // posts per row = grid width = 3

// Does this post land on the IG profile grid (and thus threaten mural alignment)?
// Instagram feed singles + carousels do; Stories don't (ephemeral, not on the grid).
// Mural tiles carry a muralId and are exempt (they're self-aligning multiples of 3).
export function postHitsInstagramGrid(post) {
  if (post.muralId) return false;
  if (!(post.platforms || []).includes('instagram')) return false;
  if (post.format === 'story') return false;
  return true;
}

export async function isGridLocked(db) {
  const ig = await db.collection('social_accounts')
    .findOne({ platform: 'instagram' }, { projection: { gridLock: 1 } }).catch(() => null);
  return !!ig?.gridLock;
}

export async function setGridLock(db, active, muralId = null) {
  await db.collection('social_accounts').updateOne(
    { platform: 'instagram' },
    { $set: { gridLock: !!active, gridLockSince: active ? new Date() : null, gridLockMuralId: active ? muralId : null } },
  ).catch(() => {});
}

// How many IG feed posts are currently sandbagged, waiting to complete a row.
export async function countHeldGrid(db) {
  return db.collection('social_posts').countDocuments({
    status: 'held', archived: { $ne: true }, platforms: 'instagram', format: { $ne: 'story' },
  }).catch(() => 0);
}

export function buildMuralPosts(base, tileUrls, opts = {}) {
  const { startAt, spacingSec, cover = '', cells = [], platforms = [], muralId } = opts;
  const schedule = buildMuralSchedule(tileUrls, { startAt, spacingSec });
  const now = new Date();
  return schedule.map((s) => {
    const isCover = s.readIndex === 0;
    const caption = isCover ? cover : (cells[s.readIndex] || '');
    return {
      ...base,
      body: caption,
      link: '',
      mediaUrls: [s.url],
      platforms,
      format: 'single',
      status: startAt ? 'scheduled' : 'draft',
      scheduledAt: s.scheduledAt,
      publishedAt: null,
      results: [],
      // ── mural grouping so the dashboard collapses the 9 rows into one card ──
      muralId,
      muralCell: s.cell,
      muralIndex: s.readIndex,        // reading order 0..8 (top-left..bottom-right)
      muralOrder: s.publishOrder,     // publish order 0..8 (bottom-right first)
      muralCount: tileUrls.length,
      muralCover: isCover,
      createdAt: now,
      updatedAt: now,
    };
  });
}
