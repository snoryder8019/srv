// ─────────────────────────────────────────────────────────────────────────────
// VIDEO COMPOSE — flatten a Social Studio design that contains a video layer
// into a real MP4 instead of a still PNG.
//
// The Studio canvas plays video layers live, but every export path ran through
// canvas.toBlob('image/png') — so a tenant who built a design around their video
// got a frozen frame, and published it as a photo. This composites the design
// server-side with ffmpeg (already a host dependency — see plugins/liveStream.js).
//
// The client sends the design as three pieces so z-order survives the round trip:
//   under.png — background + every layer BELOW the video (canvas-sized, RGBA)
//   the video — the source file, plus its box on the canvas
//   over.png  — every layer ABOVE the video (canvas-sized, RGBA)
// ffmpeg then rebuilds exactly that stack: under → video → over.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const FFMPEG = '/usr/bin/ffmpeg';

// Hard ceiling on a single composite. Video encoding is CPU-bound and this runs
// on the request path, so a tenant dropping in a 10-minute clip must not pin a
// core for the length of it. Callers surface the trim to the user.
export const MAX_COMPOSE_SECONDS = 120;

// Fetch the source video to disk. ffmpeg can read https directly, but a local
// file makes the filter graph's seeking predictable and fails fast on a dead URL.
async function fetchToFile(url, dest) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Could not fetch the source video (HTTP ${r.status})`);
  await writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

function run(args, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', d => { err += d.toString(); if (err.length > 40000) err = err.slice(-20000); });
    const kill = setTimeout(() => { ff.kill('SIGKILL'); reject(new Error('Video compose timed out')); }, timeoutMs);
    ff.on('error', e => { clearTimeout(kill); reject(new Error('ffmpeg failed to start: ' + e.message)); });
    ff.on('close', code => {
      clearTimeout(kill);
      if (code === 0) return resolve();
      // ffmpeg's last stderr line is almost always the real reason.
      const last = err.trim().split('\n').filter(Boolean).pop() || `exit ${code}`;
      reject(new Error('ffmpeg: ' + last));
    });
  });
}

/**
 * Composite a Studio design into an MP4.
 *
 * @param {object}  o
 * @param {string}  o.videoUrl   source video (the layer's src)
 * @param {Buffer}  o.underPng   canvas-sized RGBA PNG of everything beneath the video
 * @param {Buffer}  o.overPng    canvas-sized RGBA PNG of everything above it
 * @param {number}  o.canvasW    design width  (even)
 * @param {number}  o.canvasH    design height (even)
 * @param {object}  o.box        video placement { x, y, w, h, rotation?, opacity? }
 * @param {number} [o.maxSeconds]
 * @returns {Promise<{ buffer: Buffer, seconds: number }>} the encoded MP4
 */
export async function composeStudioVideo({
  videoUrl, underPng, overPng, canvasW, canvasH, box, maxSeconds = MAX_COMPOSE_SECONDS,
}) {
  if (!videoUrl) throw new Error('No source video');
  if (!underPng || !overPng) throw new Error('Missing rendered design layers');

  const W = Math.max(2, Math.round(canvasW) & ~1);   // h264 needs even dimensions
  const H = Math.max(2, Math.round(canvasH) & ~1);
  const vw = Math.max(2, Math.round(box.w) & ~1);
  const vh = Math.max(2, Math.round(box.h) & ~1);
  const rot = Number(box.rotation) || 0;
  const opacity = box.opacity == null ? 1 : Math.min(1, Math.max(0, Number(box.opacity)));

  const dir = await mkdtemp(path.join(tmpdir(), 'slab-vc-'));
  try {
    const src = path.join(dir, 'src'), under = path.join(dir, 'under.png');
    const over = path.join(dir, 'over.png'), out = path.join(dir, 'out.mp4');
    await Promise.all([
      fetchToFile(videoUrl, src),
      writeFile(under, underPng),
      writeFile(over, overPng),
    ]);

    // Rebuild the canvas stack. Both PNGs are looped stills; `shortest=1` on the
    // overlays ends the output with the video rather than running forever.
    const steps = [`[1:v]scale=${vw}:${vh},setsar=1[v0]`];
    let cur = 'v0';
    if (rot) {
      // The canvas rotates about the layer's centre and lets corners overflow, so
      // the rotated frame is expanded to the diagonal and re-centred on overlay.
      steps.push(`[${cur}]rotate=${rot}*PI/180:c=none:ow=hypot(iw\\,ih):oh=hypot(iw\\,ih)[v1]`);
      cur = 'v1';
    }
    if (opacity < 1) {
      steps.push(`[${cur}]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[v2]`);
      cur = 'v2';
    }
    let ox = Math.round(box.x), oy = Math.round(box.y);
    if (rot) {
      // After expansion the layer centre sits at the middle of the rotated frame.
      const diag = Math.ceil(Math.hypot(vw, vh));
      ox = Math.round(box.x + vw / 2 - diag / 2);
      oy = Math.round(box.y + vh / 2 - diag / 2);
    }
    steps.push(`[0:v][${cur}]overlay=${ox}:${oy}:shortest=1[bg]`);
    steps.push(`[bg][2:v]overlay=0:0:shortest=1,format=yuv420p[out]`);

    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-loop', '1', '-i', under,
      '-i', src,
      '-loop', '1', '-i', over,
      '-filter_complex', steps.join(';'),
      '-map', '[out]',
      '-map', '1:a?',                       // keep the source audio when it has any
      '-t', String(maxSeconds),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k',
      '-s', `${W}x${H}`,
      out,
    ];
    await run(args);
    const buffer = await readFile(out);
    return { buffer, seconds: await probeSeconds(out).catch(() => 0) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Duration of the finished file, for the "trimmed to Ns" notice. Best-effort.
function probeSeconds(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn('/usr/bin/ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ff.stdout.on('data', d => { out += d.toString(); });
    ff.on('error', reject);
    ff.on('close', () => resolve(Math.round(parseFloat(out.trim()) || 0)));
  });
}
