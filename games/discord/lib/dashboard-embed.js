'use strict';

const { EmbedBuilder } = require('discord.js');
const GAMES   = require('./games');
const config  = require('./config');
const fetcher = require('./stats-fetcher');

const STALE_AFTER_MS = 5 * 60 * 1000;

function statusLine(game, summary) {
  const latest = summary?.latest;
  const fresh  = latest && (Date.now() - new Date(latest.ts).getTime() < STALE_AFTER_MS);
  if (!fresh || !latest.running) return `${game.emoji} **${game.label}** \`offline\``;
  const max  = latest.maxPlayers ? `/${latest.maxPlayers}` : '';
  const ply  = latest.players || 0;
  const bar  = playerBar(ply, latest.maxPlayers);
  const ev24 = summary?.uniquePlayers24h ?? 0;
  return `${game.emoji} **${game.label}** \`${bar}\` ${ply}${max} · ${ev24} unique/24h`;
}

function playerBar(cur, max) {
  if (!max || max <= 0) return '─────';
  const slots = 5;
  const filled = Math.min(slots, Math.round((cur / max) * slots));
  return '█'.repeat(filled) + '░'.repeat(slots - filled);
}

function notableLines(summary, game) {
  const out = [];
  if (summary?.bossKills24h)    out.push(`⚔️ ${summary.bossKills24h} boss`);
  if (summary?.mobKills24h)     out.push(`👹 ${summary.mobKills24h} mob`);
  if (summary?.npcKills24h)     out.push(`🧑 ${summary.npcKills24h} npc`);
  if (summary?.shipsSunk24h)    out.push(`🚢 ${summary.shipsSunk24h} ship`);
  if (summary?.itemDrops24h)    out.push(`📦 ${summary.itemDrops24h} drop`);
  if (summary?.raids24h)        out.push(`🔥 ${summary.raids24h} raid`);
  if (summary?.deaths24h)       out.push(`💀 ${summary.deaths24h} death`);
  if (summary?.piecesPlaced24h) out.push(`🧱 ${summary.piecesPlaced24h} built`);
  return out.length ? `   _${out.join(' · ')}_` : null;
}

function systemWideTotals(dashboard) {
  const t = { kills: 0, deaths: 0, bossKills: 0, raids: 0, builds: 0 };
  for (const key of Object.keys(dashboard || {})) {
    const s = dashboard[key];
    t.kills     += (s?.bossKills24h || 0) + (s?.mobKills24h || 0) + (s?.npcKills24h || 0) + (s?.shipsSunk24h || 0);
    t.deaths    += s?.deaths24h     || 0;
    t.bossKills += s?.bossKills24h  || 0;
    t.raids     += s?.raids24h      || 0;
    t.builds    += s?.piecesPlaced24h || 0;
  }
  return t;
}

function plural(n) { return n === 1 ? '' : 's'; }

function buildEmbed(dashboard) {
  const lines = [];
  let totalOnline = 0;
  let serversUp   = 0;

  for (const game of GAMES) {
    const s = dashboard?.[game.key];
    lines.push(statusLine(game, s));
    const note = notableLines(s, game);
    if (note) lines.push(note);
    const latest = s?.latest;
    if (latest && latest.running && (Date.now() - new Date(latest.ts).getTime() < STALE_AFTER_MS)) {
      totalOnline += latest.players || 0;
      serversUp++;
    }
  }

  const topPlayer = pickTopPlayer(dashboard);
  const totals    = systemWideTotals(dashboard);

  const embed = new EmbedBuilder()
    .setTitle('🎮 MadLadsLab — Live Server Stats')
    .setURL('https://games.madladslab.com')
    .setDescription(lines.join('\n'))
    .setColor(serversUp > 0 ? 0x3ba55c : 0x747f8d)
    .addFields(
      { name: '👥 Online now',  value: String(totalOnline),              inline: true },
      { name: '🟢 Servers up',  value: `${serversUp}/${GAMES.length}`,   inline: true },
      { name: '🏆 Top 24h',     value: topPlayer || '—',                 inline: true },
      { name: '⚔️ Kills 24h',    value: String(totals.kills),             inline: true },
      { name: '💀 Deaths 24h',  value: String(totals.deaths),            inline: true },
      { name: '🐲 Boss 24h',     value: String(totals.bossKills),         inline: true },
    )
    .setFooter({ text: 'Auto-updates · games.madladslab.com' })
    .setTimestamp(new Date());

  return embed;
}

function pickTopPlayer(dashboard) {
  let best = null;
  for (const key of Object.keys(dashboard || {})) {
    const top = dashboard[key]?.topPlayers?.[0];
    if (!top) continue;
    const hours = (top.totalPlaytime || 0) / 3600;
    if (!best || hours > best.hours) best = { name: top.name || top.steamId || 'anon', game: key, hours };
  }
  if (!best) return null;
  return `${best.name} _(${best.game}, ${best.hours.toFixed(1)}h)_`;
}

async function update(client) {
  const dashboard = fetcher.getLatest();
  if (!dashboard) return;
  const cfg = config.load();
  if (!cfg.dashboardChannelId || !cfg.dashboardMessageId) return;

  try {
    const channel = await client.channels.fetch(cfg.dashboardChannelId);
    const msg     = await channel.messages.fetch(cfg.dashboardMessageId);
    await msg.edit({ embeds: [buildEmbed(dashboard)] });
  } catch (e) {
    console.error('[dashboard-embed] edit failed:', e.message);
  }
}

module.exports = { update, buildEmbed };
