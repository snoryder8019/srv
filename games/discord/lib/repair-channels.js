'use strict';

// One-shot repair. Run AFTER granting the bot's role "Administrator"
// (or after manually fixing the @everyone Connect-deny on the broken
// channels). Deletes the existing stats voice channels, clears config,
// then re-runs the normal setup so channels get the bot-allow overwrite.

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('clientReady', async () => {
    try {
      const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      const cfg = config.load();
      const idsToDelete = Object.values(cfg.voiceChannels || {});

      for (const id of idsToDelete) {
        try {
          const ch = await guild.channels.fetch(id).catch(() => null);
          if (!ch) continue;
          await ch.delete('repair: recreating with bot-allow overwrite');
          console.log(`[repair] deleted ${id}`);
        } catch (e) {
          console.error(`[repair] could not delete ${id}:`, e.message);
        }
      }

      // Clear voice channel IDs from config, keep category + dashboard.
      config.save({ ...cfg, voiceChannels: {} });
      console.log('[repair] cleared voiceChannels in config.json');

      console.log('[repair] now run:  npm run setup');
      process.exit(0);
    } catch (e) {
      console.error('[repair] failed:', e);
      process.exit(1);
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
}

if (require.main === module) main();
