# MadLadsLab Game Servers

**Portal:** https://games.madladslab.com

---

## Rust Server

### For Players

Connect in-game via F1 console:
```
client.connect games.madladslab.com:28015
```

Or search **MadLadsLab Rust** in the community server browser.

| Setting | Value |
|---|---|
| Max Players | 100 |
| World Size | 3500 |
| Mods | Oxide/uMod |

---

### For Admins

#### First-time Setup

1. **Install the server** (downloads ~20GB via SteamCMD):
   ```bash
   cd /srv/games
   ./install-rust.sh
   ```

2. **Set your RCON password** before starting:
   ```bash
   nano /srv/games/start-rust.sh
   # Edit RCON_PASS="changeme_rcon_pass"
   ```

3. **Start the server:**
   ```bash
   ./start-rust.sh
   ```

4. **Attach to the console:**
   ```bash
   tmux attach -t rust
   ```
   Detach with `Ctrl+B`, then `D`.

#### Updating the Server

```bash
cd /srv/games
./install-rust.sh   # re-runs app_update, validates files
```

#### Installing Mods (Oxide plugins)

Drop `.cs` plugin files into:
```
/srv/games/rust/oxide/plugins/
```
They hot-load automatically. Logs are in `/srv/games/rust/oxide/logs/`.

#### Server Files

| Path | Purpose |
|---|---|
| `/srv/games/rust/` | Server binaries |
| `/srv/games/rust/server/madlads/` | World save, player data, config |
| `/srv/games/rust/oxide/plugins/` | Oxide plugins |
| `/srv/games/rust/logs/server.log` | Server stdout log |

#### SSL / HTTPS

Run once the domain is confirmed live:
```bash
certbot --apache -d games.madladslab.com
```

#### Firewall Ports to Open

| Port | Protocol | Purpose |
|---|---|---|
| 80 | TCP | HTTP (redirects to HTTPS) |
| 443 | TCP | HTTPS portal |
| 28015 | UDP | Game (player connections) |
| 28016 | TCP | RCON (web) |
| 28017 | UDP | Steam query |
| 28082 | TCP | Rust+ app |
