'use strict';

const { ActivityType } = require('discord.js');
const GAMES   = require('./games');
const fetcher = require('./stats-fetcher');

const STALE_AFTER_MS = 5 * 60 * 1000;
let idx = 0;
let timer = null;

function rotate(client) {
  const dashboard = fetcher.getLatest();
  if (!dashboard) {
    client.user.setPresence({ activities: [{ name: 'games.madladslab.com', type: ActivityType.Watching }] });
    return;
  }

  // Build a rotation list: one entry per online game + a totals slide.
  const slides = [];
  let totalOnline = 0;
  for (const game of GAMES) {
    const s = dashboard[game.key];
    const latest = s?.latest;
    const fresh = latest && (Date.now() - new Date(latest.ts).getTime() < STALE_AFTER_MS);
    if (!fresh || !latest.running) continue;
    const max = latest.maxPlayers ? `/${latest.maxPlayers}` : '';
    slides.push({ type: ActivityType.Playing, name: `${game.label} · ${latest.players || 0}${max}` });
    totalOnline += latest.players || 0;
  }
  slides.push({ type: ActivityType.Watching, name: `${totalOnline} players across ${slides.length} servers` });

  if (slides.length === 0) {
    client.user.setPresence({ activities: [{ name: 'all servers offline', type: ActivityType.Watching }] });
    return;
  }

  const slide = slides[idx % slides.length];
  idx = (idx + 1) % slides.length;
  client.user.setPresence({ activities: [slide], status: 'online' });
}

function start(client) {
  const ms = (parseInt(process.env.PRESENCE_ROTATE_INTERVAL, 10) || 30) * 1000;
  rotate(client);
  timer = setInterval(() => rotate(client), ms);
}

function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { start, stop, rotate };
