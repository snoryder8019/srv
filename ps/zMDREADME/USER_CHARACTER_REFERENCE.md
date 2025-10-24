# User & Character Reference Guide

## How to Access the Galactic Map

To see your character's location on the map, you need to navigate to:

```
/universe/galactic-map?character=YOUR_CHARACTER_ID
```

## Current Users & Their Characters

### User: scootermcboot
- **Username:** `scootermcboot`
- **User ID:** `68f257a61db390295144f034`
- **Characters:**
  - **Geno** (ID: `68f2591c1db390295144f035`)
    - Species: Humans
    - Class: Steelborne
    - String Domain: Tech String
    - Location: (4472.20, 466.31) - Quantum Forge Complex
    - **Map URL:** `/universe/galactic-map?character=68f2591c1db390295144f035`

### User: scoot
- **Username:** `scoot`
- **User ID:** `68f1170f6550fbd59b47dc1a`
- **Characters:**
  - **ScooterMcBooter** (ID: `68ef1f8c9aa7f004733a8445`) - ⚠️ Was orphaned, now needs reassignment
    - Species: Devan
    - Class: Merchant
    - String Domain: Tech String
    - Location: (4471.36, 463.69) - Quantum Forge Complex

### All Characters in Database

| Character Name | Character ID | User | Location | String Domain |
|----------------|--------------|------|----------|---------------|
| Geno | `68f2591c1db390295144f035` | scootermcboot | (4472, 466) | Tech String |
| ScooterMcBooter | `68ef1f8c9aa7f004733a8445` | ⚠️ Was orphaned | (4471, 464) | Tech String |
| Faithbender | ? | ? | (3000, 3000) | Faith String |
| Jon mclain | ? | ? | (4468, 4515) | War String |
| Gaylord Focker | ? | ? | (4470, 485) | Tech String |
| Hempnight | ? | ? | (4509, 495) | Tech String |

## How Users Should Access Their Character

### For scootermcboot user:

1. **Login:** Navigate to `/auth` and login with username `scootermcboot`
2. **Select Character:** Should automatically show character "Geno"
3. **View Map:** Click to view map, or manually go to:
   ```
   /universe/galactic-map?character=68f2591c1db390295144f035
   ```

## Troubleshooting: "Location not showing"

### Problem: Tester toolbar shows `--` for location

**Possible Causes:**
1. ❌ **Wrong URL** - No character ID in URL
2. ❌ **Wrong character ID** - Using incorrect ID
3. ❌ **Character not loaded** - JavaScript error preventing character load
4. ❌ **Socket.IO not connected** - Network issue

**Solutions:**

#### Check 1: Verify URL has character parameter
```
✅ CORRECT: /universe/galactic-map?character=68f2591c1db390295144f035
❌ WRONG:   /universe/galactic-map
```

#### Check 2: Open browser console (F12) and look for:
```
✅ Should see: "Character loaded: Geno at {x: 4472, y: 466}"
✅ Should see: "✅ Socket.IO connected: [socket-id]"
✅ Should see: "📡 Emitting characterJoin: Geno {x: 4472, y: 466}"
```

#### Check 3: Verify character data in console
```javascript
// In browser console, type:
window.galacticMap.currentCharacter
// Should show character object with location
```

#### Check 4: Verify character in localStorage
```javascript
// In browser console, type:
localStorage.getItem('selectedCharacterId')
// Should return: "68f2591c1db390295144f035"
```

## Character Selection Flow

### Step 1: Login → Auth Page
- URL: `/auth`
- Shows your characters
- Should display "Geno" for scootermcboot user

### Step 2: Select Character
- Click on "Geno" character card
- Sets character as active
- Stores ID in localStorage

### Step 3: Navigate to Map
- Automatically includes character ID: `/universe/galactic-map?character=68f2591c1db390295144f035`
- Map loads character location
- Socket.IO emits character join
- Tester toolbar connects to map
- Location displays in debug panel

## Quick Fix Commands

### To get your character ID:
```bash
cd /srv/ps
node scripts/check-character-location.js YourCharacterName
```

### To verify user-character association:
```bash
cd /srv/ps
node scripts/get-user-info.js
```

### To fix orphaned character:
```bash
cd /srv/ps
node scripts/fix-character-user.js
```

## Summary

**For user `scootermcboot` to see character `Geno` on the map:**

1. Login at: `http://ps.madladslab.com/auth`
2. Username: `scootermcboot`
3. Select character: `Geno`
4. Navigate to map (or go directly to):
   ```
   http://ps.madladslab.com/universe/galactic-map?character=68f2591c1db390295144f035
   ```
5. Tester debug toolbar should show:
   - `LOC: 4472,466`
   - `FPS: 60`
   - `PING: 23ms`

✅ Character `Geno` has valid location data
✅ Character is correctly associated with user `scootermcboot`
✅ Location should now display properly!
