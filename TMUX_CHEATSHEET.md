# ⚠️ DEPRECATED — tmux is no longer used

**As of the 2026-07 migration, `/srv` runs under systemd on the WSL2 / Greeley box, not tmux.**
There is no tmux server running. Everything below the line is kept only as a historical record —
do not follow it. Use the systemd quick reference instead.

---

## systemd quick reference (use this)

Every service is a unit named `srv-<name>` (e.g. `srv-games`, `srv-slab`, `srv-cards`, `srv-mcp`).
`graffiti-tv.service` is the one exception without the `srv-` prefix.

```bash
# list all srv services and their state
systemctl list-units --type=service 'srv-*'

# status / quick up-down of one service
systemctl status  srv-ps
systemctl is-active srv-ps

# logs (replaces `tmux capture-pane`)
journalctl -u srv-ps -n 100 --no-pager     # last 100 lines
journalctl -u srv-ps -f                      # follow live

# restart one service (replaces kill-session + new-session)
systemctl restart srv-ps

# check what is listening on a port
ss -lntp | grep :3399
```

Translation from the old tmux workflow:

| Old (tmux) | New (systemd) |
|---|---|
| `tmux ls` | `systemctl list-units --type=service 'srv-*'` |
| `tmux capture-pane -t ps -p \| tail` | `journalctl -u srv-ps -n 100 --no-pager` |
| `tmux attach -t ps` (follow) | `journalctl -u srv-ps -f` |
| `tmux kill-session -t ps; tmux new-session …` | `systemctl restart srv-ps` |
| `/srv/start-all-services.sh` | per-unit `systemctl restart srv-<name>` |

> Reminder: restarting `srv-mcp` drops the live MCP/Claude connection.

---

<details>
<summary>Historical: original tmux cheatsheet (obsolete — kept for reference only)</summary>

The server previously ran each service in a tmux session (prefix `Ctrl+A`), controlled via
`tmux ls` / `capture-pane` / `kill-session` / `new-session` and `~/.tmux.conf`, with a
`service-monitor.service` restarting sessions after a grace period. All of that was replaced
by first-class systemd units (`srv-<name>.service`) during the WSL/Greeley migration. See
[README.md](./README.md) and [HANDOFF-wsl-bridge.md](./HANDOFF-wsl-bridge.md).

</details>
