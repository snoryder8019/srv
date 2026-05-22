# Discord bot setup

Step-by-step. Takes ~5 min the first time.

## 1. Create the Discord application + bot

1. Go to **https://discord.com/developers/applications** and sign in with snoryder8019@gmail.com.
2. Click **New Application** (top right). Name it `MadLadsLab Stats` (or whatever you want — this is public). Accept the ToS, click **Create**.
3. In the left sidebar, click **Bot**.
4. Under **Token**, click **Reset Token** → confirm → **Copy**. Save it somewhere safe — you cannot see it again.
5. On the same Bot page, scroll down to **Privileged Gateway Intents**. None of the privileged intents are needed (no `MessageContent`, no `GuildPresences`, no `GuildMembers`). Leave them all off.
6. Scroll to **Bot Permissions** further down on the Bot tab — you do not need to set anything here; we'll grant perms through the invite URL in step 3.

## 2. Drop the token into .env

The bot reads its env from the shared **`/srv/games/.env`** (not a separate file in this directory) so all the games-related processes share one config.

```bash
nano /srv/games/.env
```

Add (or update) these keys:

```
DISCORD_TOKEN=<token from step 1>
DISCORD_GUILD_ID=<your Discord server ID>
```

Server ID: in Discord, Settings → Advanced → enable **Developer Mode**, then right-click your server icon → **Copy Server ID**.

## 3. Invite the bot to your server

In the Developer Portal, left sidebar → **OAuth2** → **OAuth2 URL Generator**.

- **Scopes:** check `bot` and `applications.commands`.
- **Bot Permissions:** check the following:
  - `Manage Channels` (to create the stats category + channels on first run)
  - `View Channels`
  - `Send Messages`
  - `Manage Messages` (to pin the dashboard embed)
  - `Embed Links`
  - `Connect` (so it can see voice-channel state)

Scroll down — copy the **Generated URL**, paste it into your browser, pick your guild, click **Authorize**.

The bot will show up in your server's member list, offline (no process running yet).

## 4. Install dependencies + run first-time setup

```bash
cd /srv/games/discord
npm install
npm run setup
```

`npm run setup` is idempotent. It will:
- Create a `📊 Server Stats` category.
- Create one view-only voice channel per game (Rust, Valheim, Windrose, L4D2, 7DTD, Space Eng, Palworld) + an aggregate `👥 24h Active` channel.
- Create a `#games-dashboard` text channel.
- Post a placeholder embed in `#games-dashboard` and pin it.
- Save all the IDs to `config.json` (gitignored).

Re-running `setup` later is safe — it checks `config.json` first, falls back to matching by name, then creates only what's missing.

## 5. Start the bot for real

```bash
tmux new -d -s discord-games 'cd /srv/games/discord && npm start'
tmux attach -t discord-games   # to watch logs
```

Within ~60s you should see the embed update with live stats and the voice channels begin to show counts. Voice channel renames are rate-limited to 2 per 10 min per channel — `VOICE_UPDATE_INTERVAL` defaults to 7 min to stay under the cap.

## 6. (Optional) Add to autostart

Per `MEMORY.md → Autostart uses npm start`, add to `/srv/auto-start-npm.json`:

```json
{
  "name": "discord-games",
  "cwd": "/srv/games/discord",
  "tmux": "discord-games"
}
```

(format matches the existing entries — check that file first to mirror its convention).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `DISCORD_TOKEN missing in .env` | Step 2 not done — token is empty or file is `.env.example` |
| `DiscordAPIError[50001]: Missing Access` | Bot was invited without the required permissions — re-do step 3 |
| `DiscordAPIError[50013]: Missing Permissions` on `setName` | The bot's role is below another role that locks channel management — drag its role up in **Server Settings → Roles** |
| Voice channel names never change | Hitting the 2-per-10-min rename rate limit. Raise `VOICE_UPDATE_INTERVAL` |
| `[voice-channels] rename … failed: Missing Access` on every tick | The `@everyone` `Connect`-deny strips Connect from the bot too, and Discord requires `Connect` to manage a voice channel. Fix: grant the bot's role `Administrator` temporarily, run `npm run repair`, then `npm run setup` — new channels include an explicit bot-allow overwrite so this can't reoccur. Revoke Administrator after. |
| Embed shows "Waiting for first stats poll…" forever | `GAMES_API_BASE` is wrong, or games.madladslab.com is down — `curl https://games.madladslab.com/stats/dashboard` to verify |
| Bot appears offline in Discord member list | Process not running — check `tmux ls` for `discord-games` and `tmux attach -t discord-games` for stack traces |

## Token hygiene

- `.env` is gitignored.
- If the token ever leaks (committed to git, pasted into a screenshot, etc.) immediately go back to the Developer Portal → Bot → **Reset Token**, which invalidates the old one.
