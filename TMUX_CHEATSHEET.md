# Tmux Quick Reference - Stringborn Universe Server

## Quick Session Switching

All commands use **Ctrl+A** as the prefix (not Ctrl+B!)

### Switch to Specific Services
- `Ctrl+A` then `1` → **ps** (Stringborn Universe - port 3399)
- `Ctrl+A` then `2` → **game-state** (Game State Service)
- `Ctrl+A` then `3` → **madladslab** (Main Lab)
- `Ctrl+A` then `4` → **17** (Session 17)

### Cycle Through Sessions
- `Ctrl+A` then `n` → **Next** session
- `Ctrl+A` then `p` → **Previous** session
- `Ctrl+A` then `w` → **Choose** from session tree

### Window Navigation (No Prefix Needed!)
- `Alt+Left` → Previous window
- `Alt+Right` → Next window

## Common Tasks

### View Logs Without Attaching
```bash
# View last 50 lines from ps service
tmux capture-pane -t ps -p | tail -50

# View last 100 lines from game-state
tmux capture-pane -t game-state -p | tail -100

# Follow logs in real-time (attach and detach with Ctrl+A then d)
tmux attach -t ps
```

### Session Management
```bash
# List all sessions
tmux ls

# Create new session
tmux new-session -s my-session

# Kill specific session
tmux kill-session -t session-name

# Detach from current session
Ctrl+A then d
```

### Reload Configuration
```bash
# After editing ~/.tmux.conf
tmux source-file ~/.tmux.conf

# Or from inside tmux:
Ctrl+A then r
```

## Pane Management

### Split Panes
- `Ctrl+A` then `|` → Split **horizontally** (side by side)
- `Ctrl+A` then `-` → Split **vertically** (top and bottom)

### Navigate Panes
- `Alt+Up` → Select pane above
- `Alt+Down` → Select pane below

## Service-Specific Commands

### Restart PS Service (Stringborn Universe)
```bash
tmux kill-session -t ps
tmux new-session -d -s ps -c /srv/ps "PORT=3399 npm start"
```

### Check If Service Is Running
```bash
# Check by port
lsof -ti:3399  # PS service

# Check by tmux session
tmux ls | grep ps
```

### View Service Status
```bash
# Quick check - see last few logs
tmux capture-pane -t ps -p | tail -10

# Check if service responded to connection
tmux capture-pane -t ps -p | grep "Connected"
```

## Copy Mode (Scrollback)

1. `Ctrl+A` then `[` → Enter **copy mode**
2. Use **arrow keys** or **Vi keys** (h/j/k/l) to navigate
3. `Space` → Start selection
4. `Enter` → Copy selection
5. `q` → Exit copy mode

## Help & Info

- `Ctrl+A` then `?` → Show all key bindings
- `Ctrl+A` then `t` → Show clock (press any key to exit)
- `Ctrl+A` then `s` → Choose session from list

## Configuration File

Location: `/root/.tmux.conf`

Edit and reload:
```bash
nano ~/.tmux.conf
tmux source-file ~/.tmux.conf
```

## Troubleshooting

### Sessions Not Responding
```bash
# List sessions
tmux ls

# If session shows "attached" but you're not in it
tmux attach -t ps -d  # Force detach others and attach
```

### Config Not Loading
```bash
# Reload config
tmux source-file ~/.tmux.conf

# Or restart tmux server (WARNING: kills all sessions!)
# tmux kill-server
```

### Mouse Not Working
Check if mouse mode is enabled in `~/.tmux.conf`:
```
set -g mouse on
```

## Pro Tips

1. **Always use session names** when creating new sessions:
   ```bash
   tmux new-session -s my-descriptive-name
   ```

2. **Detach before killing** to avoid losing work:
   ```bash
   Ctrl+A then d  # Detach first
   tmux kill-session -t session-name  # Then kill
   ```

3. **Use capture-pane for debugging** instead of attaching:
   ```bash
   watch -n 1 'tmux capture-pane -t ps -p | tail -20'
   ```

4. **Create layouts** for common workflows:
   ```bash
   # Split horizontally, then split right pane vertically
   tmux split-window -h
   tmux split-window -v
   ```

---

**Quick Start:**
- `Ctrl+A` then `1` → Go to PS service logs
- `Ctrl+A` then `2` → Go to Game State service
- `Ctrl+A` then `n` → Cycle to next service

**Remember:** Prefix is **Ctrl+A** (not Ctrl+B)!
