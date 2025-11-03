# Admin & Tester Panel Enhancements

## Overview

Successfully added comprehensive admin and tester tools including:
- ✅ Galaxy reset scripts in admin control panel
- ✅ Teleportation system with 20+ predefined locations
- ✅ Tester toolbar with teleport dropdown
- ✅ Complete sync with game state service

## Features Added

### 1. Admin Control Panel - Galaxy Reset Scripts

**Location:** `/admin/control-panel`

Added to the "Database Maintenance" category:

| Script | Description | Requires Confirmation |
|--------|-------------|----------------------|
| Reset Galactic Map | Reset positions & sync game state | ✅ Yes |
| **Full Galaxy Reset** | Complete galaxy & character reset | ✅ Yes |
| Sync Characters to Game State | Sync all characters to game state service | No |
| Verify Reset | Check character sync status | No |

#### How to Use

1. Navigate to: `https://ps.madladslab.com/admin/control-panel`
2. Expand "Database Maintenance" category
3. Click "Full Galaxy Reset"
4. Confirm the operation
5. Watch real-time terminal output
6. Script will:
   - Clear spatial service cache
   - Reset all orbital body positions
   - Move all characters to starting zone (center 2500,2500)
   - Sync to game state service
   - Verify synchronization

### 2. Starting Locations Configuration

**File:** [`/srv/ps/config/starting-locations.js`](/srv/ps/config/starting-locations.js)

Defines 20+ predefined teleportation points:

#### Location Categories

**Central Zone**
- Starting Zone (Center) - (2500, 2500) - Default spawn point

**Faction Territories**
- Human Federation Territory - (1000, 1000) - Northwest sector
- Silicate Consortium Hub - (4000, 1000) - Northeast sector
- Devan Empire Stronghold - (1000, 4000) - Southwest sector
- Lantern Collective Nexus - (4000, 4000) - Southeast sector

**Major Landmarks**
- Temporal Nexus Station - (500, 500)
- Quantum Forge Complex - (4500, 500)
- Celestial Sanctum - (500, 4500)
- Crimson Bastion - (4500, 4500)

**Galaxy Centers**
- Andromeda Spiral - (3785, 2326)
- Elysium Cluster - (2676, 1439)
- Crimson Nebula - (4748, 2950)
- Stellar Crown - (4326, 3888)

**Testing Locations**
- Northwest Corner - (200, 200)
- Northeast Corner - (4800, 200)
- Southwest Corner - (200, 4800)
- Southeast Corner - (4800, 4800)

### 3. Teleportation API Endpoints

**Base URL:** `/api/v1/characters`

#### Get Teleport Locations
```
GET /api/v1/characters/teleport/locations
```

**Response:**
```json
{
  "success": true,
  "locations": [
    {
      "name": "Starting Zone (Center)",
      "x": 2500,
      "y": 2500,
      "description": "The central starting zone...",
      "faction": null,
      "icon": "🏁"
    },
    ...
  ]
}
```

#### Teleport Character
```
POST /api/v1/characters/:id/teleport
```

**Body:**
```json
{
  "locationName": "Starting Zone (Center)"
}
```

**Or custom coordinates:**
```json
{
  "x": 2500,
  "y": 2500
}
```

**Authorization:**
- Character owner can teleport their own character
- Testers (`isTester: true`) can teleport any character
- Admins (`isAdmin: true`) can teleport any character

**Response:**
```json
{
  "success": true,
  "message": "Teleported to Starting Zone (Center)",
  "location": {
    "type": "galactic",
    "x": 2500,
    "y": 2500,
    "vx": 0,
    "vy": 0
  }
}
```

### 4. Tester Toolbar Teleportation

**Access:** Available to users with `userRole: 'tester'`

**Location:** Bottom of screen (stacks above admin debug panel if present)

#### Teleport Section

Located in the expanded debug panel under "⚡ Teleport":

**Features:**
- Dropdown menu with all 20+ predefined locations
- Each location shows icon, name, and coordinates
- One-click teleport button
- Confirmation dialog with location description
- Real-time status feedback
- Auto-reload after successful teleport

**How to Use:**

1. **Open Tester Toolbar**
   - Look for tester toolbar at bottom of screen
   - Click the bug icon to expand debug panel

2. **Select Location**
   - Find "⚡ Teleport" section
   - Click dropdown menu
   - Choose destination (shows icon, name, coordinates)
   - Example: `🏁 Starting Zone (Center) (2500, 2500)`

3. **Teleport**
   - Click "🚀 Teleport Character" button
   - Confirm in dialog popup
   - Watch status message
   - Page auto-reloads to sync map

4. **Verify**
   - Check character location in debug panel
   - Map should center on new location
   - Check "LOC:" in toolbar header

## File Changes

### New Files Created

1. **[`/srv/ps/config/starting-locations.js`](/srv/ps/config/starting-locations.js)**
   - Configuration for all teleport locations
   - Export functions for location management
   - 20+ predefined locations with metadata

2. **[`/srv/ps/scripts/full-galaxy-reset.js`](/srv/ps/scripts/full-galaxy-reset.js)**
   - Comprehensive galaxy reset script
   - Resets assets, characters, syncs game state
   - Beautiful terminal output with step-by-step progress

3. **[`/srv/ps/scripts/verify-reset.js`](/srv/ps/scripts/verify-reset.js)**
   - Verification utility for sync status
   - Compares local DB vs game state service
   - Detailed mismatch reporting

### Modified Files

1. **[`/srv/ps/routes/admin/scripts.js`](/srv/ps/routes/admin/scripts.js)**
   - Added new scripts to Database Maintenance category
   - Full Galaxy Reset, Sync Characters, Verify Reset

2. **[`/srv/ps/api/v1/characters/index.js`](/srv/ps/api/v1/characters/index.js)**
   - Added `POST /:id/teleport` endpoint
   - Added `GET /teleport/locations` endpoint
   - Authorization checks for testers/admins

3. **[`/srv/ps/public/javascripts/tester-toolbar.js`](/srv/ps/public/javascripts/tester-toolbar.js)**
   - Added teleport section to debug panel
   - Dropdown menu with location selection
   - Teleport button with confirmation
   - Status feedback and auto-reload

## Usage Examples

### Example 1: Admin Resetting Galaxy

```bash
# Via admin panel
1. Go to https://ps.madladslab.com/admin/control-panel
2. Click "Database Maintenance" → "Full Galaxy Reset"
3. Confirm warning dialog
4. Watch terminal output in real-time

# Or via command line
cd /srv/ps
node scripts/full-galaxy-reset.js
```

**Expected Output:**
```
╔════════════════════════════════════════════════════════╗
║         FULL GALAXY RESET - COMPLETE RESTART          ║
╚════════════════════════════════════════════════════════╝

📊 Step 1: Connecting to database...
   ✅ Connected to database

🗑️  Step 2: Clearing spatial service cache...
   ✅ Spatial service cache cleared

🌍 Step 3: Resetting all orbital body positions...
   ✅ Reset 0 approved assets

👥 Step 4: Resetting ALL characters to starting zone...
   Found 6 characters
   ✓ ScooterMcBooter      → (2611, 2387)
   ✓ Faithbender          → (2466, 2589)
   ...
```

### Example 2: Tester Teleporting Character

```javascript
// Via tester toolbar UI
1. Open tester toolbar (bottom of screen)
2. Click bug icon to expand
3. Find "⚡ Teleport" section
4. Select "🌍 Human Federation Territory (1000, 1000)"
5. Click "🚀 Teleport Character"
6. Confirm dialog
7. Page reloads at new location

// Or via API
const response = await fetch('/api/v1/characters/68f1c6271db390295144f032/teleport', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    locationName: 'Human Federation Territory'
  })
});

const data = await response.json();
console.log(data.message); // "Teleported to Human Federation Territory"
```

### Example 3: Adding Custom Location

Edit [`/srv/ps/config/starting-locations.js`](/srv/ps/config/starting-locations.js):

```javascript
export const STARTING_LOCATIONS = {
  // ... existing locations ...

  'My Custom Location': {
    x: 3000,
    y: 3000,
    description: 'A custom test location',
    type: 'galactic',
    icon: '⭐'
  }
};
```

Restart service:
```bash
tmux kill-session -t ps_session
tmux new-session -d -s ps_session -c /srv/ps "npm run dev"
```

## Security & Authorization

### Admin Access
- **Required:** `user.isAdmin === true`
- **Can access:** Admin control panel, all scripts
- **Can teleport:** Any character to any location

### Tester Access
- **Required:** `user.userRole === 'tester'` OR `user.isTester === true`
- **Can access:** Tester toolbar, debug panel
- **Can teleport:** Any character to any predefined location

### Character Owner Access
- **Required:** Own the character (`character.userId === user._id`)
- **Can teleport:** Only their own characters

## Troubleshooting

### Teleport Not Working

**Check authorization:**
```javascript
// In browser console
console.log('User:', user);
console.log('Is Tester:', user.isTester, user.userRole);
console.log('Is Admin:', user.isAdmin);
```

**Check character ownership:**
```javascript
console.log('Character:', character);
console.log('Character userId:', character.userId);
console.log('User _id:', user._id.toString());
```

### Location Not Appearing in Dropdown

1. Check if location exists in [`starting-locations.js`](/srv/ps/config/starting-locations.js)
2. Restart service after changes
3. Clear browser cache
4. Check browser console for errors

### Teleport Succeeds But Map Doesn't Update

1. Wait for auto-reload (1 second delay)
2. Hard refresh browser (Ctrl+Shift+R)
3. Check game state service sync:
   ```bash
   curl -s https://svc.madladslab.com/api/characters | jq
   ```
4. Run verification script:
   ```bash
   node scripts/verify-reset.js
   ```

## Related Documentation

- [Galaxy Reset Complete](/srv/ps/docs/GALAXY_RESET_COMPLETE.md)
- [Character Sync Fix](/srv/ps/docs/CHARACTER_SYNC_FIX.md)
- [Game State Sync Fix](/srv/ps/docs/GAME_STATE_SYNC_FIX.md)
- [Tester Toolbar Socket Fix](/srv/ps/docs/TESTER_TOOLBAR_SOCKET_FIX.md)

## Future Enhancements

### Potential Improvements

1. **Admin Teleport Panel**
   - Dedicated admin UI for batch teleportation
   - Teleport multiple characters at once
   - Create temporary teleport zones

2. **Teleport History**
   - Track teleportation history per character
   - Teleport cooldown system
   - Teleport cost/resources

3. **Dynamic Locations**
   - Allow admins to create custom locations via UI
   - Save favorite locations per tester
   - Import/export location presets

4. **Teleport Effects**
   - Animation on teleport
   - Visual effects at destination
   - Notification to other players

5. **Location Categories**
   - Group locations by type in dropdown
   - Filter by faction, type, or distance
   - Search/autocomplete for locations

## Testing Checklist

- [x] Admin can run Full Galaxy Reset
- [x] All characters move to starting zone
- [x] Game state service syncs correctly
- [x] Tester toolbar shows teleport section
- [x] Dropdown loads all 20+ locations
- [x] Teleport button works and confirms
- [x] Page reloads after successful teleport
- [x] Map centers on new location
- [x] Unauthorized users cannot teleport others
- [x] API endpoints return correct data
- [x] Browser console shows no errors

## Conclusion

The admin and tester panels now have comprehensive tools for:
- ✅ Resetting the entire galaxy
- ✅ Teleporting characters to predefined locations
- ✅ Testing game state synchronization
- ✅ Debugging character positions

All features are fully functional and tested.
