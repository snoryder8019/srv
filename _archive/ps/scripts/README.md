# Database Scripts

Utility scripts for managing the Stringborn Universe database.

## Available Scripts

### 1. Add User Roles
**File:** `add-user-roles.js`

Sets all users without a `userRole` field to `'tester'` by default.

```bash
cd /srv/ps
node scripts/add-user-roles.js
```

**What it does:**
- Finds all users without `userRole` field
- Sets them to `'tester'` role
- Shows summary of all users and their roles

**Output:**
```
✅ Updated 5 users with 'tester' role

📊 Current User Roles:
  - scoot (m.scott.wallace@gmail.com): tester
  - scootermcboot (snoryder8019@gmail.com): tester
  ...
```

---

### 2. Reset All Characters
**File:** `reset-all-characters.js`

Resets all characters to their home starting points based on their String Domain.

```bash
cd /srv/ps
node scripts/reset-all-characters.js
```

**What it does:**
- Gets all characters from database
- Determines each character's home hub based on String Domain
- Moves character to random spawn point within hub (50px radius)
- Clears navigation (sets destination to null, isInTransit to false)
- Undocks character (sets assetId to null)
- Resets velocity to 0
- Updates homeHub data
- Shows before/after positions

**Output:**
```
📊 Found 6 character(s) to reset:

   ScooterMcBooter (Tech String)
   Current: (4511, 482)
   → Moving to: Quantum Forge Complex
   → New position: (4471, 464)
   ✅ Successfully reset

═══════════════════════════════════════
📊 Reset Summary:
   ✅ Success: 6
   ❌ Errors: 0
   📍 Total: 6
═══════════════════════════════════════

🏠 Characters by Home Hub:

   Quantum Forge Complex:
      - ScooterMcBooter | Tech String | (4471, 464)
      - Geno | Tech String | (4472, 466)
      ...
```

---

## String Domains & Hubs

### Time String → Temporal Nexus Station
- **Location:** (500, 500) - Top-Left
- **Primary Species:** Silicates
- **Color:** Purple (#667eea)

### Tech String → Quantum Forge Complex
- **Location:** (4500, 500) - Top-Right
- **Primary Species:** Humans
- **Color:** Green (#10b981)

### Faith String → Celestial Sanctum
- **Location:** (500, 4500) - Bottom-Left
- **Primary Species:** Lanterns
- **Color:** Orange (#f59e0b)

### War String → Crimson Bastion
- **Location:** (4500, 4500) - Bottom-Right
- **Primary Species:** Devan
- **Color:** Red (#ef4444)

---

## Spawn Position Logic

Characters spawn within a **50px radius** of their hub's center:

```javascript
const spawnPosition = {
  x: hubLocation.x + (Math.random() - 0.5) * hubRadius * 2,
  y: hubLocation.y + (Math.random() - 0.5) * hubRadius * 2
};
```

This creates a small cluster of characters around each hub, preventing overlapping spawns.

---

## Character Reset Details

### What Gets Reset:

**Location:**
- `location.x` → Hub spawn X coordinate
- `location.y` → Hub spawn Y coordinate
- `location.vx` → 0 (no velocity)
- `location.vy` → 0 (no velocity)
- `location.zone` → Hub name
- `location.assetId` → null (not docked)
- `location.lastUpdated` → Current timestamp

**Navigation:**
- `navigation.destination` → null
- `navigation.isInTransit` → false
- `navigation.eta` → null

**Home Hub:**
- `homeHub.id` → Hub ID
- `homeHub.name` → Hub name
- `homeHub.stringDomain` → String Domain
- `homeHub.location` → Hub coordinates

**Metadata:**
- `updatedAt` → Current timestamp

### What Does NOT Get Reset:
- Character stats (STR, INT, AGI, FAITH, TECH)
- Level, XP
- Inventory items
- Ship fittings and cargo
- Equipped items
- Talents
- Achievements

---

## When to Use Reset Script

### Good Use Cases:
✅ **Start of testing session** - Everyone begins at home hubs
✅ **After major bugs** - Clean slate for all players
✅ **New game features** - Reset to test from starting points
✅ **Database migrations** - Ensure all location data is correct
✅ **Demo/presentation prep** - Controlled starting positions

### Avoid Using If:
❌ Players have made significant progress
❌ Mid-game testing of specific features
❌ Testing navigation/travel systems
❌ Validating progression systems

---

## Creating Additional Scripts

### Template:
```javascript
/**
 * Script Description
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function myScript() {
  try {
    // Initialize database
    await connectDB();
    const db = getDb();

    console.log('🔧 Starting script...\n');

    // Your logic here
    const result = await db.collection('characters').updateMany(
      { /* query */ },
      { $set: { /* updates */ } }
    );

    console.log(`✅ Updated ${result.modifiedCount} documents`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

myScript();
```

---

## Database Collections

### Users
- `_id`, `email`, `username`, `password`
- `userRole` (tester/admin/player)
- `hasCompletedWelcome`, `hasCompletedIntro`
- `createdAt`

### Characters
- `_id`, `userId`, `name`, `species`, `stringDomain`
- `location` (x, y, vx, vy, zone, assetId)
- `navigation` (destination, isInTransit, eta)
- `homeHub` (id, name, stringDomain, location)
- `stats`, `ship`, `backpack`, `talents`

### Tickets
- `_id`, `type`, `title`, `description`, `severity`, `status`
- `userId`, `username`, `characterId`, `characterName`
- `location`, `userAgent`, `url`
- `comments`, `createdAt`, `updatedAt`

---

## Safety Notes

⚠️ **Always backup before running scripts that modify data!**

```bash
# MongoDB backup command (if needed)
mongodump --db projectStringborne --out /backup/$(date +%Y%m%d)
```

⚠️ **Test scripts on development database first**

⚠️ **Check for running game sessions before reset**

---

## Future Script Ideas

- `reset-single-character.js` - Reset one character by ID
- `teleport-character.js` - Move character to specific coordinates
- `grant-items.js` - Give items to characters for testing
- `adjust-levels.js` - Set character levels for testing
- `clear-tickets.js` - Archive old/resolved tickets
- `reset-game-state.js` - Full game state reset (zones, assets, etc.)

---

## Troubleshooting

### "Database not initialized" error
Make sure you're calling `await connectDB()` before `getDb()`.

### "Cannot find module" error
Ensure you're running from `/srv/ps` directory:
```bash
cd /srv/ps
node scripts/your-script.js
```

### MongoDB connection timeout
Check that MongoDB service is running:
```bash
sudo systemctl status mongodb
# or
sudo systemctl status mongod
```

### Permission errors
May need to run with appropriate user permissions or check MongoDB auth settings.

---

## Script Execution Log

Keep a log of when scripts are run for audit purposes:

```bash
# Example
echo "$(date): Ran reset-all-characters.js - Reset 6 characters" >> scripts/execution.log
```
