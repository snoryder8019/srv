'use strict';

// Updates the per-game stats voice channels in-place. Discord rate-limits
// channel renames to 2 per 10 min per channel, so we:
//   1. Only rename if the new name actually differs from what we last set.
//   2. Honour VOICE_UPDATE_INTERVAL as a global tick — caller decides when.
//   3. Skip renames silently when discord.js throws a rate-limit error.

const GAMES  = require('./games');
const config = require('./config');

const STALE_AFTER_MS = 5 * 60 * 1000; // snapshots older than 5 min → treat as offline

function formatName(game, summary) {
  const latest = summary?.latest;
  const fresh  = latest && (Date.now() - new Date(latest.ts).getTime() < STALE_AFTER_MS);
  if (!fresh || !latest.running) return `${game.emoji} ${game.label}: offline`;
  const max = latest.maxPlayers ? `/${latest.maxPlayers}` : '';
  return `${game.emoji} ${game.label}: ${latest.players || 0}${max}`;
}

function format24hChannelName(dashboard) {
  let total = 0;
  for (const k of Object.keys(dashboard || {})) total += dashboard[k]?.uniquePlayers24h || 0;
  return `👥 24h Active: ${total}`;
}

async function updateAll(client, dashboard) {
  const cfg = config.load();
  if (!cfg.voiceChannels) return;

  const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);

  // Per-game channels
  for (const game of GAMES) {
    const channelId = cfg.voiceChannels[game.key];
    if (!channelId) continue;
    const desired = formatName(game, dashboard?.[game.key]);
    await safeRename(guild, channelId, desired);
  }

  // Aggregate 24h-active channel
  if (cfg.voiceChannels.__active24h) {
    await safeRename(guild, cfg.voiceChannels.__active24h, format24hChannelName(dashboard));
  }
}

async function safeRename(guild, channelId, desired) {
  try {
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    if (!ch) return;
    if (ch.name === desired) return; // no-op saves a rate-limit slot
    await ch.setName(desired, 'stats update');
  } catch (e) {
    // 429 / rate-limit → discord.js wraps as DiscordAPIError
    if (e.code === 50028 || e.status === 429) return;
    console.error(`[voice-channels] rename ${channelId} failed:`, e.message);
  }
}

module.exports = { updateAll, formatName, format24hChannelName };
