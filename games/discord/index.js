'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Client, GatewayIntentBits } = require('discord.js');

const fetcher       = require('./lib/stats-fetcher');
const voiceChannels = require('./lib/voice-channels');
const dashboard     = require('./lib/dashboard-embed');
const presence      = require('./lib/presence');
const config        = require('./lib/config');
const voiceBridge   = require('./lib/voice-bridge');
const voiceInvites  = require('./lib/voice-invites');

const VOICE_MS = (parseInt(process.env.VOICE_UPDATE_INTERVAL, 10) || 420) * 1000;
const EMBED_MS = (parseInt(process.env.EMBED_UPDATE_INTERVAL, 10) || 60)  * 1000;

function assertEnv() {
  for (const k of ['DISCORD_TOKEN', 'DISCORD_GUILD_ID']) {
    if (!process.env[k]) {
      console.error(`[bot] ${k} is missing — copy .env.example to .env and fill it in.`);
      process.exit(1);
    }
  }
}

async function main() {
  assertEnv();

  const cfg = config.load();
  if (!cfg.dashboardMessageId || !cfg.voiceChannels?.rust) {
    console.warn('[bot] config.json incomplete — run `npm run setup` first to create channels.');
  }

  const client = new Client({
    // GuildVoiceStates is required for voiceStateUpdate to fire. Guilds covers
    // the stat-rename channels and the dashboard text channel.
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  client.once('ready', async () => {
    console.log(`[bot] logged in as ${client.user.tag}`);
    // Permissions: ManageChannels + ManageRoles + ViewChannel + SendMessages
    //            + ManageMessages + EmbedLinks + Connect + CreateInstantInvite
    // Bits:        16 + 268435456 + 1024 + 2048 + 8192 + 16384 + 1048576 + 1 = 269509249
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot%20applications.commands&permissions=269509249`;
    console.log(`[bot] re-invite URL (grants ManageRoles for permission overwrites):\n      ${inviteUrl}`);
    await fetcher.start();

    presence.start(client);
    voiceBridge.attach(client);

    voiceInvites.ensureAll(client).catch(e => console.error('[bot] voice-invites:', e.message));

    // First-pass updates as soon as data lands
    fetcher.emitter.once('update', async (dash) => {
      try { await voiceChannels.updateAll(client, dash); } catch (e) { console.error(e); }
      try { await dashboard.update(client); }              catch (e) { console.error(e); }
    });

    setInterval(() => {
      dashboard.update(client).catch(e => console.error('[bot] dashboard update:', e.message));
    }, EMBED_MS);

    setInterval(() => {
      const dash = fetcher.getLatest();
      if (dash) voiceChannels.updateAll(client, dash).catch(e => console.error('[bot] voice update:', e.message));
    }, VOICE_MS);
  });

  client.on('error',          e => console.error('[discord]', e));
  client.on('shardError',     e => console.error('[discord/shard]', e));

  function shutdown(sig) {
    console.log(`[bot] received ${sig}, shutting down`);
    fetcher.stop();
    presence.stop();
    client.destroy().finally(() => process.exit(0));
  }
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch(e => { console.error('[bot] fatal:', e); process.exit(1); });
