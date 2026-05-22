'use strict';

// Per-game voice-channel invites for the games portal "JOIN VOICE" buttons.
//
// On bot ready:
//   1. For every per-game stats voice channel, ensure @everyone has Connect
//      allowed (setup.js originally denied it so the channels were view-only).
//      Without this, the temporary-invite drop-into-voice doesn't work.
//   2. Mint (or reuse) a permanent, channel-scoped invite with temporary:true.
//      `temporary: true` is the lockdown lever — when an invitee disconnects
//      from voice, Discord kicks them from the guild *if they have no roles*.
//      Existing members with roles are unaffected.
//   3. Cache invite codes in config.json so the games portal can serve URLs
//      via /api/discord/voice-invites without round-tripping the bot.

const { PermissionFlagsBits } = require('discord.js');

const GAMES  = require('./games');
const config = require('./config');

const INVITE_MAX_AGE = 0;   // never expires
const INVITE_MAX_USES = 0;  // unlimited uses

async function ensureChannelJoinable(channel, botUserId) {
  // Build the overwrite set we want and only apply if it differs.
  const targets = [
    {
      id: channel.guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
      deny:  [PermissionFlagsBits.Speak], // listen-only by default
    },
    {
      id: botUserId,
      type: 1, // member overwrite
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.CreateInstantInvite,
      ],
    },
  ];
  try {
    await channel.permissionOverwrites.set(targets, 'voice-invites: open for join');
  } catch (e) {
    console.warn(`[voice-invites] permission update failed for ${channel.id}: ${e.message}`);
  }
}

async function findExistingInvite(channel) {
  try {
    const invites = await channel.fetchInvites();
    // Prefer permanent + temporary invites we previously minted.
    return invites.find(i => i.temporary && i.maxAge === 0 && i.inviter?.id === channel.client.user.id)
        || invites.find(i => i.temporary && i.maxAge === 0)
        || null;
  } catch (e) {
    if (e.code === 50013) return null; // Missing Permissions
    console.warn(`[voice-invites] fetchInvites failed for ${channel.id}: ${e.message}`);
    return null;
  }
}

async function mintInvite(channel) {
  return channel.createInvite({
    maxAge: INVITE_MAX_AGE,
    maxUses: INVITE_MAX_USES,
    temporary: true,
    unique: false,
    reason: 'voice-invites: per-game join link',
  });
}

async function ensureAll(client) {
  const cfg = config.load();
  if (!cfg.voiceChannels) return;

  const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
  const botUserId = client.user.id;
  const voiceInvites = { ...(cfg.voiceInvites || {}) };

  for (const game of GAMES) {
    const channelId = cfg.voiceChannels[game.key];
    if (!channelId) continue;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.warn(`[voice-invites] channel ${channelId} (${game.key}) not found`);
      continue;
    }

    await ensureChannelJoinable(channel, botUserId);

    let invite = await findExistingInvite(channel);
    if (!invite) {
      try {
        invite = await mintInvite(channel);
        console.log(`[voice-invites] minted invite for ${game.key}: ${invite.url}`);
      } catch (e) {
        console.error(`[voice-invites] mint failed for ${game.key}: ${e.message}`);
        continue;
      }
    }
    voiceInvites[game.key] = invite.code;
  }

  config.update({ voiceInvites });
  return voiceInvites;
}

module.exports = { ensureAll };
