# Quick Start: Teleportation System

## For Testers

### How to Teleport Your Character

1. **Open the galactic map** at `https://ps.madladslab.com/universe/galactic-map`

2. **Find the tester toolbar** at the bottom of your screen

3. **Expand the debug panel** by clicking the bug icon (⚙️)

4. **Scroll to the Teleport section** (marked with ⚡)

5. **Select a destination** from the dropdown:
   - 🏁 Starting Zone (Center) - Default spawn
   - 🌍 Human Federation Territory - Northwest
   - 🔷 Silicate Consortium Hub - Northeast
   - ⚔️ Devan Empire Stronghold - Southwest
   - 🏮 Lantern Collective Nexus - Southeast
   - Plus 15+ more locations!

6. **Click "🚀 Teleport Character"**

7. **Confirm** in the dialog popup

8. **Wait for reload** - The page will automatically refresh and show your new location

### Popular Destinations

| Location | Coordinates | Use Case |
|----------|-------------|----------|
| Starting Zone (Center) | (2500, 2500) | Testing spawn mechanics |
| Northwest Corner | (200, 200) | Edge testing |
| Andromeda Spiral | (3785, 2326) | Galaxy exploration |
| Crimson Nebula | (4748, 2950) | Danger zone testing |

## For Admins

### How to Reset the Galaxy

1. **Go to admin panel** at `https://ps.madladslab.com/admin/control-panel`

2. **Expand "Database Maintenance"** category in the left sidebar

3. **Click "Full Galaxy Reset"**

4. **Read the confirmation warning** carefully

5. **Confirm the operation**

6. **Watch the terminal output** for real-time progress

7. **When complete**, instruct testers to:
   - Clear browser cache (Ctrl+Shift+R)
   - Reload the galactic map
   - All characters will be at center (2500, 2500)
   - All orbital bodies will redistribute

### Quick Scripts

```bash
# Full galaxy reset (from command line)
cd /srv/ps
node scripts/full-galaxy-reset.js

# Verify sync status
node scripts/verify-reset.js

# Sync characters manually
node scripts/sync-characters-to-game-state.js
```

## Troubleshooting

### "Not authorized to teleport"
- Make sure you have tester role: `user.userRole === 'tester'`
- Check with admin to grant tester access

### Teleport succeeds but map doesn't update
- Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
- Clear browser cache completely
- Try incognito/private mode

### Dropdown shows "Error loading locations"
- Check if service is running
- Check browser console for errors
- Reload the page

## API Quick Reference

### Get Locations
```bash
curl https://ps.madladslab.com/api/v1/characters/teleport/locations
```

### Teleport Character
```bash
curl -X POST https://ps.madladslab.com/api/v1/characters/YOUR_CHAR_ID/teleport \
  -H "Content-Type: application/json" \
  -d '{"locationName": "Starting Zone (Center)"}'
```

## Contact

For issues or questions:
- Check [Full Documentation](/srv/ps/docs/ADMIN_TESTER_ENHANCEMENTS.md)
- Report bugs via tester toolbar ticket system
- Contact admin team
