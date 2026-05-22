'use strict';

// First-run (idempotent) setup. Run via:  npm run setup
// Creates the stats category, view-only voice channels, dashboard text channel,
// and a pinned placeholder embed. Stores all IDs in config.json so subsequent
// boots reuse them.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const {
  Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, EmbedBuilder,
} = require('discord.js');

const GAMES  = require('./games');
const config = require('./config');

const CATEGORY_NAME  = process.env.STATS_CATEGORY_NAME    || '📊 Server Stats';
const DASHBOARD_NAME = process.env.DASHBOARD_CHANNEL_NAME || 'games-dashboard';

async function ensureCategory(guild) {
  const cfg = config.load();
  if (cfg.categoryId) {
    const existing = await guild.channels.fetch(cfg.categoryId).catch(() => null);
    if (existing) return existing;
  }
  const byName = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME
  );
  if (byName) { config.update({ categoryId: byName.id }); return byName; }

  const created = await guild.channels.create({
    name: CATEGORY_NAME,
    type: ChannelType.GuildCategory,
  });
  config.update({ categoryId: created.id });
  console.log(`[setup] created category ${created.name} (${created.id})`);
  return created;
}

async function ensureStatsVoice(guild, category, key, label, botUserId) {
  const cfg = config.load();
  if (cfg.voiceChannels?.[key]) {
    const existing = await guild.channels.fetch(cfg.voiceChannels[key]).catch(() => null);
    if (existing) return existing;
  }
  // CRITICAL: We deny Connect on @everyone so users can't join the stats
  // channels, but Discord requires the *managing* bot to have Connect on a
  // voice channel — otherwise rename/delete fail with 50001 Missing Access
  // even though ManageChannels is granted. So we also add an explicit member
  // overwrite for the bot allowing Connect+ManageChannels+ViewChannel.
  const channel = await guild.channels.create({
    name: label,
    type: ChannelType.GuildVoice,
    parent: category.id,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel],
        deny:  [PermissionFlagsBits.Connect],
      },
      {
        id: botUserId,
        type: 1, // member overwrite
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.Connect,
        ],
      },
    ],
  });
  config.update({ voiceChannels: { [key]: channel.id } });
  console.log(`[setup] created voice channel ${channel.name} (${channel.id})`);
  return channel;
}

async function ensureDashboardChannel(guild, category) {
  const cfg = config.load();
  if (cfg.dashboardChannelId) {
    const existing = await guild.channels.fetch(cfg.dashboardChannelId).catch(() => null);
    if (existing) return existing;
  }
  const byName = guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && c.name === DASHBOARD_NAME
  );
  if (byName) { config.update({ dashboardChannelId: byName.id }); return byName; }

  const channel = await guild.channels.create({
    name: DASHBOARD_NAME,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: 'Live stats from games.madladslab.com — auto-updated by the bot.',
  });
  config.update({ dashboardChannelId: channel.id });
  console.log(`[setup] created text channel ${channel.name} (${channel.id})`);
  return channel;
}

async function ensureDashboardMessage(channel) {
  const cfg = config.load();
  if (cfg.dashboardMessageId) {
    const existing = await channel.messages.fetch(cfg.dashboardMessageId).catch(() => null);
    if (existing) return existing;
  }
  const placeholder = new EmbedBuilder()
    .setTitle('🎮 MadLadsLab — Live Server Stats')
    .setDescription('_Waiting for first stats poll…_')
    .setColor(0x747f8d);
  const msg = await channel.send({ embeds: [placeholder] });
  try { await msg.pin(); } catch { /* missing perm — non-fatal */ }
  config.update({ dashboardMessageId: msg.id });
  console.log(`[setup] created dashboard message (${msg.id})`);
  return msg;
}

async function main() {
  if (!process.env.DISCORD_TOKEN)    throw new Error('DISCORD_TOKEN missing in .env');
  if (!process.env.DISCORD_GUILD_ID) throw new Error('DISCORD_GUILD_ID missing in .env');

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  client.once('ready', async () => {
    try {
      const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      await guild.channels.fetch(); // populate cache

      const category = await ensureCategory(guild);
      const botId = client.user.id;

      for (const game of GAMES) {
        await ensureStatsVoice(guild, category, game.key, `${game.emoji} ${game.label}: …`, botId);
      }
      await ensureStatsVoice(guild, category, '__active24h', '👥 24h Active: …', botId);

      const dash = await ensureDashboardChannel(guild, category);
      await ensureDashboardMessage(dash);

      console.log('\n[setup] done. Config written to config.json.');
      console.log('[setup] start the bot with:  npm start');
      process.exit(0);
    } catch (e) {
      console.error('[setup] failed:', e);
      process.exit(1);
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
}

if (require.main === module) main();
