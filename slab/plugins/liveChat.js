// ─────────────────────────────────────────────────────────────────────────────
// liveChat.js — unified live-chat aggregator for a broadcast session.
//
// Pulls chat from every platform where reading is actually supported and merges
// it into one stream of { platform, author, text, ts } messages via an onMsg
// callback:
//   • YouTube  — Data API liveChat/messages polling (needs the youtube token;
//                youtube.readonly is enough to READ chat).
//   • Facebook — Graph live_video /comments polling (Page token).
//   • Twitch   — anonymous IRC-over-WebSocket read (justinfan), needs the
//                channel login name.
//
// startLiveChat(sources, onMsg) returns { stop() }. Everything is best-effort:
// a platform that errors just goes quiet; it never throws into the caller.
// ─────────────────────────────────────────────────────────────────────────────
import WebSocket from 'ws';
import { googleAccessToken } from './socialPublish.js';

const FB_GRAPH = 'https://graph.facebook.com/v21.0';
const YT_API = 'https://www.googleapis.com/youtube/v3';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Cap the per-source de-dupe set so a marathon stream can't grow it unbounded.
function remember(seen, id) {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 5000) { for (const k of seen) { seen.delete(k); if (seen.size <= 4000) break; } }
  return true;
}

// ── YouTube ──────────────────────────────────────────────────────────────────
async function runYouTube(ctl, { creds, broadcastId }, onMsg) {
  // Cache the access token (~55 min) so we don't hit Google's token endpoint on
  // every poll — a long stream would otherwise refresh it hundreds of times.
  let tok = { value: null, at: 0 };
  const token = async () => {
    if (!tok.value || Date.now() - tok.at > 55 * 60 * 1000) { tok = { value: await googleAccessToken(creds), at: Date.now() }; }
    return tok.value;
  };

  let liveChatId = null;
  try {
    const r = await fetch(`${YT_API}/liveBroadcasts?part=snippet&id=${broadcastId}`, { headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    liveChatId = j.items?.[0]?.snippet?.liveChatId || null;
  } catch { /* leave null */ }
  if (!liveChatId) return;

  const seen = new Set();
  let pageToken = '';
  let firstPass = true;
  while (!ctl.stopped) {
    try {
      const tkn = await token();
      const url = `${YT_API}/liveChat/messages?liveChatId=${encodeURIComponent(liveChatId)}&part=snippet,authorDetails&maxResults=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${tkn}` }, signal: AbortSignal.timeout(15000) });
      if (r.status === 401 || r.status === 403 || r.status === 404) return; // chat ended / no access
      const j = await r.json().catch(() => ({}));
      for (const it of (j.items || [])) {
        if (!remember(seen, it.id)) continue;
        if (firstPass) continue; // skip the initial backlog dump; stream only new messages
        const text = it.snippet?.displayMessage;
        if (text) onMsg({ platform: 'youtube', author: it.authorDetails?.displayName || 'viewer', text, ts: Date.parse(it.snippet?.publishedAt) || Date.now() });
      }
      firstPass = false;
      pageToken = j.nextPageToken || pageToken;
      await sleep(Math.min(15000, Math.max(2500, j.pollingIntervalMillis || 4000)));
    } catch { await sleep(5000); }
  }
}

// ── Facebook ─────────────────────────────────────────────────────────────────
async function runFacebook(ctl, { pageAccessToken, liveVideoId }, onMsg) {
  const seen = new Set();
  let firstPass = true;
  while (!ctl.stopped) {
    try {
      const url = `${FB_GRAPH}/${liveVideoId}/comments?fields=id,message,from,created_time&live_filter=no_filter&order=chronological&limit=100&access_token=${encodeURIComponent(pageAccessToken)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.status === 400 || r.status === 401 || r.status === 403) return;
      const j = await r.json().catch(() => ({}));
      for (const c of (j.data || [])) {
        if (!remember(seen, c.id)) continue;
        if (firstPass) continue;
        if (c.message) onMsg({ platform: 'facebook', author: c.from?.name || 'Facebook', text: c.message, ts: Date.parse(c.created_time) || Date.now() });
      }
      firstPass = false;
      await sleep(5000);
    } catch { await sleep(6000); }
  }
}

// ── Twitch (anonymous IRC read) ──────────────────────────────────────────────
function runTwitch(ctl, { channel }, onMsg) {
  const chan = String(channel || '').trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_]/g, '');
  if (!chan) return;
  let ws = null, reconnectT = null, closed = false;

  const connect = () => {
    if (ctl.stopped || closed) return;
    try {
      ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
      ws.on('open', () => {
        ws.send('PASS SCHMOOPIIE');
        ws.send('NICK justinfan' + Math.floor(Math.random() * 999999)); // anonymous read-only login
        ws.send('JOIN #' + chan);
      });
      ws.on('message', (data) => {
        const raw = data.toString();
        if (raw.startsWith('PING')) { try { ws.send('PONG :tmi.twitch.tv'); } catch {} return; }
        for (const line of raw.split('\r\n')) {
          const m = line.match(/^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/);
          if (m) onMsg({ platform: 'twitch', author: m[1], text: m[2], ts: Date.now() });
        }
      });
      ws.on('close', () => { if (!ctl.stopped && !closed) reconnectT = setTimeout(connect, 4000); });
      ws.on('error', () => { try { ws.close(); } catch {} });
    } catch { if (!ctl.stopped && !closed) reconnectT = setTimeout(connect, 5000); }
  };
  connect();

  return () => { closed = true; clearTimeout(reconnectT); try { ws && ws.close(); } catch {} };
}

// ── Concurrent viewer counts ─────────────────────────────────────────────────
// Poll each platform's "watching now" number and report a merged total +
// per-platform breakdown. YouTube → liveStreamingDetails.concurrentViewers,
// Facebook → live_views. (Twitch needs Helix + app creds we don't have, so it's
// omitted from the count.) onCount({ total, breakdown, ts }) every ~10s.
export function startViewerCounts(sources = {}, onCount) {
  const ctl = { stopped: false };
  (async () => {
    let tok = { value: null, at: 0 };
    const ytToken = async () => {
      if (!tok.value || Date.now() - tok.at > 55 * 60 * 1000) tok = { value: await googleAccessToken(sources.youtube.creds), at: Date.now() };
      return tok.value;
    };
    while (!ctl.stopped) {
      const breakdown = {};
      if (sources.youtube?.broadcastId) {
        try {
          const t = await ytToken();
          const r = await fetch(`${YT_API}/videos?part=liveStreamingDetails&id=${sources.youtube.broadcastId}`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15000) });
          const j = await r.json().catch(() => ({}));
          const c = j.items?.[0]?.liveStreamingDetails?.concurrentViewers;
          if (c != null) breakdown.youtube = Number(c) || 0;
        } catch { /* skip this tick */ }
      }
      if (sources.facebook?.liveVideoId) {
        try {
          const r = await fetch(`${FB_GRAPH}/${sources.facebook.liveVideoId}?fields=live_views&access_token=${encodeURIComponent(sources.facebook.pageAccessToken)}`, { signal: AbortSignal.timeout(15000) });
          const j = await r.json().catch(() => ({}));
          if (j.live_views != null) breakdown.facebook = Number(j.live_views) || 0;
        } catch { /* skip this tick */ }
      }
      const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
      try { onCount({ total, breakdown, ts: Date.now() }); } catch {}
      await sleep(10000);
    }
  })();
  return { stop() { ctl.stopped = true; } };
}

// ── Manager ──────────────────────────────────────────────────────────────────
// sources = { youtube?:{creds,broadcastId}, facebook?:{pageAccessToken,liveVideoId}, twitch?:{channel} }
export function startLiveChat(sources = {}, onMsg) {
  const ctl = { stopped: false };
  const stoppers = [];
  const safeMsg = (m) => { try { if (m && m.text) onMsg(m); } catch {} };

  if (sources.youtube?.broadcastId) runYouTube(ctl, sources.youtube, safeMsg);
  if (sources.facebook?.liveVideoId) runFacebook(ctl, sources.facebook, safeMsg);
  if (sources.twitch?.channel) { const s = runTwitch(ctl, sources.twitch, safeMsg); if (s) stoppers.push(s); }

  return {
    stop() { ctl.stopped = true; for (const s of stoppers) { try { s(); } catch {} } },
  };
}
