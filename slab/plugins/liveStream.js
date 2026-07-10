// ─────────────────────────────────────────────────────────────────────────────
// liveStream.js — browser-sourced live simulcast relay.
//
// The studio page captures camera + window into a MediaStream, records it with
// MediaRecorder (webm/vp8+opus), and ships the chunks over socket.io. Here we
// pipe those chunks into a per-session ffmpeg process that transcodes once to
// H.264/AAC and fans out — via the `tee` muxer — to every RTMP destination at
// once (YouTube, Facebook, Twitch, any custom RTMP). One encode, N outputs.
//
// Destinations come in two flavours:
//   • API-assisted (youtube, facebook) — we create the broadcast via the
//     platform API and get the ingest URL + key back.
//   • custom — the user pastes an RTMP URL + stream key (Twitch/LinkedIn/X/…).
//
// ffmpeg is required on the host (installed at /usr/bin/ffmpeg).
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'child_process';
import { googleAccessToken } from './socialPublish.js';

const FB_GRAPH = 'https://graph.facebook.com/v21.0';
const YT_API = 'https://www.googleapis.com/youtube/v3';

// sessionId → { ff, targets, startedAt, meta, onExit }
const sessions = new Map();

export function isLive(sessionId) { return sessions.has(sessionId); }
export function liveMeta(sessionId) {
  const s = sessions.get(sessionId);
  return s ? { targets: s.targets.map(t => ({ platform: t.platform, label: t.label })), startedAt: s.startedAt } : null;
}

// ── Build the ffmpeg argv that tees the webm pipe to N RTMP urls ─────────────
// `targets` = [{ rtmpUrl, label, platform }]. rtmpUrl already includes the key.
function buildFfmpegArgs(targets, { videoBitrate = '4500k', gop = 60 } = {}) {
  // onfail=ignore keeps the broadcast alive if a single destination drops.
  const teeSpec = targets
    .map(t => `[f=flv:onfail=ignore]${t.rtmpUrl}`)
    .join('|');
  return [
    '-hide_banner', '-loglevel', 'warning',
    // Input: fragmented webm arriving on stdin (no seeking).
    '-f', 'webm', '-i', 'pipe:0',
    // Video → H.264, tuned for low-latency live.
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-b:v', videoBitrate, '-maxrate', videoBitrate, '-bufsize', String(parseInt(videoBitrate) * 2) + 'k',
    '-pix_fmt', 'yuv420p', '-g', String(gop), '-keyint_min', String(gop),
    // Audio → AAC.
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    // Fan out.
    '-f', 'tee', '-map', '0:v', '-map', '0:a', teeSpec,
  ];
}

// ── Start a relay session ────────────────────────────────────────────────────
// targets: [{ rtmpUrl, label, platform }]. Returns immediately; ffmpeg runs
// until stopSession() or the input ends. onLog/onExit are optional callbacks.
export function startSession(sessionId, targets, { onLog, onExit, meta = {} } = {}) {
  if (sessions.has(sessionId)) throw new Error('Session already live');
  if (!Array.isArray(targets) || !targets.length) throw new Error('No destinations');
  for (const t of targets) if (!t.rtmpUrl || !/^rtmps?:\/\//i.test(t.rtmpUrl)) throw new Error('Bad RTMP url for ' + (t.label || t.platform));

  const args = buildFfmpegArgs(targets);
  const ff = spawn('/usr/bin/ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });

  const rec = { ff, targets, startedAt: new Date(), meta, onExit };
  sessions.set(sessionId, rec);

  ff.stderr.on('data', d => { const line = d.toString(); if (onLog) onLog(line); });
  ff.on('error', err => { if (onLog) onLog('[ffmpeg spawn error] ' + err.message); });
  ff.on('exit', (code, signal) => {
    sessions.delete(sessionId);
    if (onExit) onExit({ code, signal });
  });
  // Don't crash the process if ffmpeg's stdin closes mid-write.
  ff.stdin.on('error', () => {});
  return rec;
}

// Feed one MediaRecorder chunk (Buffer) into the relay.
export function writeChunk(sessionId, chunk) {
  const s = sessions.get(sessionId);
  if (!s || !s.ff.stdin.writable) return false;
  try { s.ff.stdin.write(chunk); return true; } catch { return false; }
}

// Stop a relay: close stdin so ffmpeg flushes, then force-kill after a grace period.
export function stopSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return false;
  try { s.ff.stdin.end(); } catch {}
  setTimeout(() => { try { if (sessions.has(sessionId)) s.ff.kill('SIGKILL'); } catch {} }, 4000);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// API-ASSISTED BROADCAST CREATION
// ─────────────────────────────────────────────────────────────────────────────

// YouTube Live: create a broadcast + a reusable stream, bind them, return the
// RTMP ingest + the broadcast id (needed to transition to "live"/"complete").
// `creds` = unpacked youtube account (needs clientId/clientSecret/refreshToken).
export async function createYouTubeBroadcast(creds, { title, description = '', privacy = 'public' } = {}) {
  const token = await googleAccessToken(creds);
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const startTime = new Date(Date.now() + 60 * 1000).toISOString();

  // 1) broadcast
  const bRes = await fetch(`${YT_API}/liveBroadcasts?part=snippet,status,contentDetails`, {
    method: 'POST', headers: H, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      snippet: { title: (title || 'Live').slice(0, 100), description: description.slice(0, 5000), scheduledStartTime: startTime },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: true, enableAutoStop: true, latencyPreference: 'low' },
    }),
  });
  const bJson = await bRes.json().catch(() => ({}));
  if (!bRes.ok) throw new Error(ytErr(bJson, bRes.status, 'create broadcast'));
  const broadcastId = bJson.id;

  // 2) stream (the RTMP ingest)
  const sRes = await fetch(`${YT_API}/liveStreams?part=snippet,cdn,contentDetails`, {
    method: 'POST', headers: H, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      snippet: { title: (title || 'Live').slice(0, 100) },
      cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
      contentDetails: { isReusable: true },
    }),
  });
  const sJson = await sRes.json().catch(() => ({}));
  if (!sRes.ok) throw new Error(ytErr(sJson, sRes.status, 'create stream'));
  const streamId = sJson.id;
  const ing = sJson.cdn?.ingestionInfo || {};
  const rtmpUrl = `${ing.ingestionAddress}/${ing.streamName}`;

  // 3) bind stream → broadcast
  const bindRes = await fetch(`${YT_API}/liveBroadcasts/bind?id=${broadcastId}&streamId=${streamId}&part=id,contentDetails`, {
    method: 'POST', headers: H, signal: AbortSignal.timeout(20000),
  });
  const bindJson = await bindRes.json().catch(() => ({}));
  if (!bindRes.ok) throw new Error(ytErr(bindJson, bindRes.status, 'bind'));

  return {
    platform: 'youtube', label: 'YouTube',
    rtmpUrl, broadcastId, streamId,
    watchUrl: `https://youtube.com/watch?v=${broadcastId}`,
    studioUrl: `https://studio.youtube.com/video/${broadcastId}/livestreaming`,
  };
}

// Transition a YouTube broadcast: 'testing' | 'live' | 'complete'.
// enableAutoStart makes 'live' automatic once ingest is healthy, but we expose
// this for explicit control / ending the stream.
export async function transitionYouTube(creds, broadcastId, status) {
  const token = await googleAccessToken(creds);
  const r = await fetch(`${YT_API}/liveBroadcasts/transition?broadcastStatus=${status}&id=${broadcastId}&part=id,status`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(ytErr(j, r.status, 'transition ' + status));
  return { ok: true, status: j.status?.lifeCycleStatus || status };
}

// Facebook Live: create a live_video on the Page, return the RTMPS ingest.
// `pageId` + `pageAccessToken` come from the facebook social account.
export async function createFacebookLive({ pageId, pageAccessToken }, { title, description = '' } = {}) {
  if (!pageId || !pageAccessToken) throw new Error('Facebook Page not connected');
  const r = await fetch(`${FB_GRAPH}/${pageId}/live_videos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'LIVE_NOW', title: (title || '').slice(0, 255), description: description.slice(0, 5000), access_token: pageAccessToken }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.stream_url) throw new Error(j.error?.message || `Facebook live create failed (HTTP ${r.status})`);
  return {
    platform: 'facebook', label: 'Facebook',
    rtmpUrl: j.stream_url,               // rtmps://… includes the key
    liveVideoId: j.id,
    watchUrl: j.permalink_url ? `https://facebook.com${j.permalink_url}` : `https://facebook.com/${pageId}`,
  };
}

// End a Facebook live_video.
export async function endFacebookLive({ pageAccessToken }, liveVideoId) {
  const r = await fetch(`${FB_GRAPH}/${liveVideoId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ end_live_video: true, access_token: pageAccessToken }),
    signal: AbortSignal.timeout(15000),
  });
  return r.ok;
}

function ytErr(j, status, stage) {
  const e = j?.error;
  const reason = e?.errors?.[0]?.reason || '';
  const msg = e?.message || `HTTP ${status}`;
  // The most common first-time failure — surface the fix.
  if (reason === 'liveStreamingNotEnabled' || /not enabled/i.test(msg)) {
    return `YouTube live streaming isn't enabled on this channel yet. Enable it at youtube.com/features (identity verification required; first activation can take up to 24h). [${stage}]`;
  }
  if (reason === 'insufficientPermissions' || status === 403) {
    return `${msg} — reconnect YouTube to grant live permissions (the youtube.force-ssl scope). [${stage}]`;
  }
  return `${msg} [${stage}]`;
}
