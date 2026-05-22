'use strict';

// Polls the games portal and caches the latest dashboard payload in memory.
// Consumers read `getLatest()` synchronously; the fetcher refreshes on its own timer.

const EventEmitter = require('events');

const BASE = (process.env.GAMES_API_BASE || 'https://games.madladslab.com').replace(/\/$/, '');
const INTERVAL_MS = (parseInt(process.env.API_POLL_INTERVAL, 10) || 60) * 1000;

const emitter = new EventEmitter();
let latest = null;
let lastFetchedAt = null;
let timer = null;

async function fetchOnce() {
  const url = `${BASE}/stats/dashboard`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const body = await res.json();
  latest = body;
  lastFetchedAt = new Date();
  emitter.emit('update', body);
  return body;
}

async function start() {
  try { await fetchOnce(); }
  catch (e) { console.error('[stats-fetcher] initial fetch failed:', e.message); }
  timer = setInterval(() => {
    fetchOnce().catch(e => console.error('[stats-fetcher] poll failed:', e.message));
  }, INTERVAL_MS);
}

function stop() { if (timer) clearInterval(timer); timer = null; }

function getLatest() { return latest; }
function getLastFetchedAt() { return lastFetchedAt; }

module.exports = { start, stop, getLatest, getLastFetchedAt, emitter, fetchOnce };
