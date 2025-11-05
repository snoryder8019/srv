# Active Character Filtering Fix

## The Issue You Identified ✅

**Problem:** "The user is dictating players in space, not the character logged in. Jon mclain and Faithbender shouldn't be logged in at the same time."

**Root Cause:** The physics service was filtering by **userId** instead of **characterId**, so when one user had multiple characters (Faithbender AND Jon mclain), BOTH appeared in the payload even though only ONE was active.

---

## The Old Logic (Broken)

```javascript
// ❌ OLD: Filter by userId
const connectedUserIds = this.io.getConnectedUserIds();
const charactersForRendering = characters.filter(char => {
  return connectedUserIds.includes(char.userId.toString());
});
```

**Problem:**
- User `68f1170f6550fbd59b47dc1a` owns TWO characters:
  - Faithbender
  - Jon mclain
- When user logs in with Faithbender, BOTH characters pass the filter
- Result: 2 characters in payload even though only 1 is active

**Server logs showed:**
```
👥 Connected user IDs (1): [ '68f1170f6550fbd59b47dc1a' ]
   🔍 Character Faithbender (userId: 68f1170f6550fbd59b47dc1a): isConnected=true
   🔍 Character Jon mclain (userId: 68f1170f6550fbd59b47dc1a): isConnected=true
📡 galacticPhysicsUpdate emitted: characters=2  ❌ WRONG!
```

---

## The New Logic (Fixed)

```javascript
// ✅ NEW: Filter by characterId
const connectedCharacterIds = this.io.getConnectedCharacterIds();
const charactersForRendering = characters.filter(char => {
  return connectedCharacterIds.includes(char._id.toString());
});
```

**How it works:**
- When user logs in, they emit `characterJoin` with their ACTIVE character's ID
- Socket.IO tracks `characterId` in `onlinePlayers` Map
- Physics service gets list of ACTIVE character IDs
- Only the ACTIVE character passes the filter

**Server logs now show:**
```
👥 Connected character IDs (1): [ '68f1c6271db390295144f032' ]
   🔍 Character Faithbender (charId: 68f1c6271db390295144f032): isActive=true
   🔍 Character Jon mclain (charId: 68f1170f65..): isActive=false
📡 galacticPhysicsUpdate emitted: characters=1  ✅ CORRECT!
   👤 Character: Faithbender at (2534, 3935, 3326) docked at: Cosmic Nexus
```

---

## Files Modified

### 1. `/srv/ps/plugins/socket/index.js`

**Added new method to track character IDs:**
```javascript
// Expose method to get connected character IDs (active characters only)
io.getConnectedCharacterIds = () => {
  const characterIds = new Set();
  for (const player of onlinePlayers.values()) {
    if (player.characterId) {
      characterIds.add(player.characterId.toString());
    }
  }
  return Array.from(characterIds);
};
```

**What it does:**
- Loops through `onlinePlayers` Map (populated by `characterJoin` events)
- Extracts `characterId` from each online player
- Returns array of ACTIVE character IDs only

### 2. `/srv/ps/services/physics-service.js`

**Changed filtering logic (lines 179-191):**

**Before:**
```javascript
const connectedUserIds = this.io.getConnectedUserIds();
const charactersForRendering = characters.filter(char => {
  const isConnected = connectedUserIds.includes(char.userId.toString());
  return hasLocation && isConnected;
});
```

**After:**
```javascript
const connectedCharacterIds = this.io.getConnectedCharacterIds();
const charactersForRendering = characters.filter(char => {
  const isActiveCharacter = connectedCharacterIds.includes(char._id.toString());
  return hasLocation && isActiveCharacter;
});
```

---

## Verification

### Before Fix:
```
User logs in with Faithbender
└─ Socket.IO tracks: userId = 68f1170f6550fbd59b47dc1a
└─ Physics service finds ALL characters with that userId:
   ├─ Faithbender ✅ (active)
   └─ Jon mclain ❌ (not active, but included anyway!)
└─ Payload: characters = 2 (WRONG!)
```

### After Fix:
```
User logs in with Faithbender
└─ Socket.IO tracks: characterId = 68f1c6271db390295144f032
└─ Physics service finds ONLY that character:
   └─ Faithbender ✅ (active)
└─ Payload: characters = 1 (CORRECT!)
```

---

## Bonus: Characters Now Moving!

As a bonus, you'll notice character coordinates are **changing** in the logs:

```
👤 Character: Faithbender at (2532, 3924, 3328) docked at: Cosmic Nexus
👤 Character: Faithbender at (2533, 3930, 3327) docked at: Cosmic Nexus
👤 Character: Faithbender at (2534, 3935, 3326) docked at: Cosmic Nexus
                              ↑ Coordinates updating!
```

This is because of the earlier fix where characters now move WITH their docked galaxy as it orbits through space.

---

## Impact on Gameplay

### Single Character per Connection
- ✅ Only the ACTIVE character appears on the galactic map
- ✅ Users with multiple characters won't have duplicates in space
- ✅ Character switching will properly remove old character and add new one

### Multiple Users (Future)
When multiple users connect:
```
User A logs in with "Faithbender" → characters = 1
User B logs in with "Dom Nominus" → characters = 2
User C logs in with "Gaylord Focker" → characters = 3
```

Each sees all OTHER active characters on the map, but not duplicate characters from the same user.

### Character Switching
When a user switches characters:
1. Old character's `characterJoin` socket disconnects
2. Socket.IO removes old characterId from `onlinePlayers`
3. New character emits new `characterJoin` event
4. Socket.IO adds new characterId
5. Physics service broadcasts only the NEW character

---

## Testing

### Test in Debugger
Open [debug-socket-payloads.html](http://localhost:3399/debug-socket-payloads.html)

**You should see:**
```
✅ Characters in Last Update: 1
   👤 Faithbender
      📍 Position: (2534, 3935, 3326)
      🌌 Docked: Cosmic Nexus
      🚀 In Transit: No
```

**Coordinates should UPDATE every second** as the character moves with Cosmic Nexus galaxy.

### Test Character Switching
1. Login as user with multiple characters
2. Select Faithbender → Should see 1 character in payload
3. Switch to Jon mclain → Should STILL see 1 character (Jon, not Faithbender)
4. Debugger should show only the ACTIVE character

### Test Multiple Users
1. Open galactic-map in two different browsers (or incognito)
2. Login as different users
3. Both should see EACH OTHER's characters
4. Each user should only see ONE character per other user

---

## Summary

**Before:**
- ❌ Multiple characters per user appearing in space
- ❌ Character filtering by userId (wrong level of granularity)
- ❌ Payload showed ALL characters owned by connected users

**After:**
- ✅ One active character per user
- ✅ Character filtering by characterId (correct level)
- ✅ Payload shows only ACTIVE characters
- ✅ Characters move with their docked galaxies (bonus!)

**The Fix:**
- Added `getConnectedCharacterIds()` method to Socket.IO plugin
- Changed physics service to filter by `char._id` instead of `char.userId`
- Now correctly represents "players in space" as active characters only

---

*Last Updated: November 4, 2025*
*Issue: Multiple characters per user appearing in galactic map*
*Solution: Filter by characterId instead of userId*
