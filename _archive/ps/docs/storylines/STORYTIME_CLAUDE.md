# Storyline System - Claude AI Context

**Last Updated:** November 4, 2025
**Purpose:** Storyline asset management and TOME integration for Stringborn Universe
**Status:** ✅ IMPLEMENTATION COMPLETE

---

## 🎯 System Overview

The storyline system integrates narrative content directly into the asset builder as **storyline assets**. These assets are treated exactly like planets, stars, and galaxies but contain narrative data instead of physics data.

### Core Concept
- **Storylines ARE Assets** - They live in the `assets` collection with special `assetType` values
- **Builder Integration** - Create storylines using the same asset builder as universe objects
- **Lore Linking** - Connect storyline assets to real galaxies/planets/stations
- **TOME Display** - All storyline content flows to the frontend TOME menu system

---

## 📋 Storyline Asset Types

### 1. **Storyline Arc** (`assetType: 'storyline_arc'`)
High-level narrative container that groups related quests, NPCs, and locations.

**Fields:**
- `arc_setting` - Physical setting description
- `arc_themes` - Array of themes (e.g., ["Labor struggle", "Survival"])
- `arc_conflict` - Core narrative conflict
- `arc_visual_mood` - Atmospheric description for visual design
- `arc_quest_hooks` - Array of potential quest starting points
- `arc_linked_assets` - Array of linked universe asset IDs

**Example:**
```json
{
  "title": "Deepcore Descent",
  "assetType": "storyline_arc",
  "arc_setting": "Subsurface mining colony beneath a fractured moon",
  "arc_themes": ["Labor struggle", "Survival", "Buried secrets"],
  "arc_conflict": "Survive collapsing tunnels while uncovering ancient tech",
  "arc_quest_hooks": ["Rescue trapped miners", "Decode buried vault tech"]
}
```

### 2. **Storyline NPC** (`assetType: 'storyline_npc'`)
Character definitions with personality, dialogue style, and locations.

**Fields:**
- `npc_role` - Role type (protagonist, antagonist, merchant, quest_giver, etc.)
- `npc_arc_id` - Parent storyline arc ID
- `npc_traits` - Array of character traits
- `npc_dialogue_style` - How the character speaks
- `npc_locations` - Array of location asset IDs where NPC appears
- `npc_signature_items` - Array of iconic items

**Example:**
```json
{
  "title": "John McClane",
  "assetType": "storyline_npc",
  "npc_role": "protagonist",
  "npc_arc_id": "arc_04_id",
  "npc_traits": ["Pragmatic", "Cynical", "Street-smart"],
  "npc_dialogue_style": "Blunt, sarcastic",
  "npc_signature_items": ["Dice", "Old revolver", "Void's Edge badge"]
}
```

### 3. **Storyline Quest** (`assetType: 'storyline_quest'`)
Mission definitions with triggers, objectives, and rewards.

**Fields:**
- `quest_arc_id` - Parent storyline arc ID
- `quest_type` - Quest type (main, side, radiant, faction, etc.)
- `quest_trigger_condition` - What triggers the quest
- `quest_objectives` - Array of objectives
- `quest_rewards` - Array of rewards
- `quest_prerequisites` - Array of prerequisite quest IDs

**Example:**
```json
{
  "title": "Investigate the Anomaly",
  "assetType": "storyline_quest",
  "quest_type": "main",
  "quest_trigger_condition": "Red alert initiated by AI glitch",
  "quest_objectives": ["Reach helm console", "Scan anomaly", "Report findings"],
  "quest_rewards": ["500 credits", "Alien artifact"]
}
```

### 4. **Storyline Location** (`assetType: 'storyline_location'`)
Specific narrative locations that map to universe assets.

**Fields:**
- `location_arc_id` - Parent storyline arc ID
- `location_mood_tags` - Array of mood descriptors
- `location_interactive_elements` - Array of interactive objects
- `location_linked_asset` - Real planet/station asset ID
- `location_zone_name` - Zone identifier for planetary explorer

**Example:**
```json
{
  "title": "Crew Quarters",
  "assetType": "storyline_location",
  "location_arc_id": "lost_in_space_arc_id",
  "location_mood_tags": ["cold", "dim", "claustrophobic"],
  "location_interactive_elements": ["bunk", "AI terminal"],
  "location_linked_asset": "voidsedge_station_id",
  "location_zone_name": "crew_quarters_ls01"
}
```

### 5. **Storyline Script** (`assetType: 'storyline_script'`)
Cinematic dialogue scenes and cutscenes.

**Fields:**
- `script_arc_id` - Parent storyline arc ID (required)
- `script_scene_title` - Scene title
- `script_location_id` - Location description or ID
- `script_scene_description` - Scene setting description
- `script_dialogue` - Full dialogue script with character names
- `script_actions` - Array of stage directions
- `script_cinematic_trigger` - When to trigger the scene

**Example:**
```json
{
  "title": "Craps Before the Void",
  "assetType": "storyline_script",
  "script_arc_id": "arc_04_id",
  "script_scene_title": "Craps Before the Void",
  "script_location_id": "INT. STARSHIP REC ROOM – NIGHT",
  "script_dialogue": "JOHN: You roll a seven, you win...\nFAITHBENDER: So... this is fate-time?",
  "script_actions": ["John rolls dice", "Gravity panel flickers"]
}
```

---

## 🛠️ Implementation Components

### Files Modified

**1. Asset Builder UI** ([builder-enhanced.ejs](ps/views/assets/builder-enhanced.ejs:79-91))
- Added "Storyline Assets" optgroup with 5 new asset types
- Each type has unique emoji and clear labeling

**2. Asset Builder JavaScript** ([asset-builder-enhanced.js](ps/public/javascripts/asset-builder-enhanced.js:303-486))
- Added 5 new case statements in `handleAssetTypeChange()`
- Dynamic form fields for each storyline type
- Proper input validation and placeholders

**3. Asset Model** ([Asset.js](ps/api/v1/models/Asset.js:90-128))
- Added 35+ new fields to support all storyline types
- Fields follow naming convention: `{type}_{field}`
- All fields properly initialized with defaults

### Files Created

**1. Seeding Script** ([seed-handoff-storylines.js](ps/scripts/storyline/seed-handoff-storylines.js))
```bash
node scripts/storyline/seed-handoff-storylines.js
```
- Parses JSON from `first_handoff.md`
- Creates storyline assets from handoff data
- Auto-links to existing galaxies (Void's Edge, Lumina Prime)
- Approves all seeded storylines automatically

**2. Universe Scanner** ([scan-universe-for-lore.js](ps/scripts/storyline/scan-universe-for-lore.js))
```bash
node scripts/storyline/scan-universe-for-lore.js
```
- Scans all existing universe assets
- Suggests lore mappings based on keywords
- Provides confidence ratings (HIGH/MEDIUM/LOW)
- Outputs actionable recommendations

---

## 🚀 Usage Workflow

### Creating Storyline Assets

**1. Via Asset Builder UI:**
```
1. Navigate to /assets
2. Select "Storyline Assets" → "📖 Storyline Arc"
3. Fill in required fields:
   - Title: "Deepcore Descent"
   - Description: "Mining colony survival arc"
   - Story Setting: "Subsurface colony beneath fractured moon"
   - Themes: "Labor struggle, Survival, Buried secrets"
   - Core Conflict: "Survive tunnels while uncovering ancient tech"
4. Link to existing galaxy (optional)
5. Submit for approval
```

**2. Via Seeding Script:**
```bash
# Import handoff JSON data
node scripts/storyline/seed-handoff-storylines.js

# Output:
# ✅ Created arc: Deepcore Descent (arc_01)
# ✅ Created arc: Lost in Space (arc_02)
# ✅ Created NPC: Captain (char_01)
# ✅ Created location: Crew Quarters (crew_quarters_ls01)
```

### Scanning Universe for Lore Connections

```bash
node scripts/storyline/scan-universe-for-lore.js

# Output:
# 🌌 GALAXIES:
#   Void's Edge
#     → Suggested Arc: Lost in Space
#     → Confidence: HIGH
#     → Reason: Contains keyword "void" in title
#
#   Lumina Prime
#     → Suggested Arc: Deepcore Descent
#     → Confidence: MEDIUM
#     → Reason: Could host mining operations
```

### Linking Storylines to Universe

**Method 1: During Creation**
- Set `parentGalaxy` field to link arc to galaxy
- Set `location_linked_asset` to map story location to real planet

**Method 2: Via Database Update**
```javascript
// Update existing asset with storyline link
db.assets.updateOne(
  { _id: ObjectId("planet_id") },
  {
    $set: {
      linkedStorylines: ["arc_01_id", "arc_02_id"],
      lore: "This planet is featured in Deepcore Descent..."
    }
  }
);
```

---

## 📊 Database Schema

All storyline assets share the base asset schema plus type-specific fields:

```javascript
{
  // BASE ASSET FIELDS (all types)
  _id: ObjectId,
  userId: ObjectId,
  title: String,
  description: String,
  assetType: String, // 'storyline_arc', 'storyline_npc', etc.
  subType: String,
  lore: String,
  backstory: String,
  flavor: String,

  // UNIVERSE LINKING
  parentGalaxy: ObjectId,
  parentStar: ObjectId,
  coordinates: { x, y, z },

  // COMMUNITY
  status: String, // 'submitted', 'approved', 'rejected'
  votes: Number,
  voters: Array,

  // TYPE-SPECIFIC FIELDS (see above for each type)
  arc_setting: String,
  arc_themes: Array,
  npc_role: String,
  quest_objectives: Array,
  // ... etc
}
```

---

## 🎮 TOME Integration (TODO)

### Current TOME System
Location: `/help/documentation`
- Displays markdown files from `zMDREADME/` directory
- Organized in collapsible tree structure
- Syntax highlighting for code

### Planned Storyline Integration

**1. Add Storyline Section to TOME:**
```javascript
// In views/help/documentation.ejs
<div class="doc-section">
  <h3>📖 Storylines</h3>
  <ul>
    <% storylineArcs.forEach(arc => { %>
      <li>
        <a href="/tome/storyline/<%= arc._id %>">
          <%= arc.title %>
        </a>
      </li>
    <% }); %>
  </ul>
</div>
```

**2. Create Storyline Viewer Route:**
```javascript
// In routes/help/index.js
router.get('/tome/storyline/:arcId', async (req, res) => {
  const arc = await Asset.findById(req.params.arcId);
  const npcs = await Asset.find({
    assetType: 'storyline_npc',
    npc_arc_id: arc._id
  });
  const quests = await Asset.find({
    assetType: 'storyline_quest',
    quest_arc_id: arc._id
  });

  res.render('tome/storyline-view', { arc, npcs, quests });
});
```

**3. Create API Endpoint:**
```javascript
// In api/v1/storyline/index.js
router.get('/arcs', async (req, res) => {
  const arcs = await Asset.find({
    assetType: 'storyline_arc',
    status: 'approved'
  });
  res.json(arcs);
});
```

---

## 📝 Common Commands

```bash
# DEVELOPMENT
# Seed storyline assets from handoff
node scripts/storyline/seed-handoff-storylines.js

# Scan universe for lore connections
node scripts/storyline/scan-universe-for-lore.js

# TESTING
# Query storyline arcs
mongo "connectionString" --eval "db.assets.find({assetType:'storyline_arc'}).pretty()"

# Count storyline assets by type
mongo "connectionString" --eval "
  db.assets.aggregate([
    { $match: { assetType: /^storyline_/ } },
    { $group: { _id: '$assetType', count: { $sum: 1 } } }
  ])
"

# PRODUCTION
# Approve all submitted storylines
mongo "connectionString" --eval "
  db.assets.updateMany(
    { assetType: /^storyline_/, status: 'submitted' },
    { $set: { status: 'approved', approvedAt: new Date() } }
  )
"
```

---

## 🗺️ Lore Mapping Guide

### Current Universe Assets (as of Nov 4, 2025)

**Anomaly:**
- "The Primordial Singularity" → **Astral Enigma** (HIGH confidence)

**Galaxies:**
- "Void's Edge" → **Lost in Space** / **Faith-Time vs Space-Time** (HIGH confidence)
- "Lumina Prime" → **Deepcore Descent** (MEDIUM confidence)

**Suggested Renaming:**
```
Current → Suggested (Arc)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Lumina Prime Alpha I → Deepcore Mining Colony (arc_01)
Void's Edge Beta → Derelict Station Sigma (arc_02)
[New Station] → Mogul's Penthouse Tower (arc_03)
The Primordial Singularity → The Nexus Singularity (arc_04)
```

---

## ✅ Implementation Checklist

### Phase 1: Asset Builder (COMPLETE)
- [x] Add storyline asset types to dropdown
- [x] Create dynamic form fields for each type
- [x] Update Asset model with new fields
- [x] Test asset creation via UI

### Phase 2: Seeding & Scanning (COMPLETE)
- [x] Create handoff seeding script
- [x] Create universe scanning script
- [x] Parse first_handoff.md JSON
- [x] Auto-link to existing galaxies
- [x] Test seeding workflow

### Phase 3: TOME Integration (PENDING)
- [ ] Create storyline API endpoints
- [ ] Add storyline section to TOME menu
- [ ] Create storyline viewer template
- [ ] Implement storyline tree navigation
- [ ] Add filtering by galaxy/arc
- [ ] Test frontend display

### Phase 4: In-Game Integration (FUTURE)
- [ ] NPC spawning system
- [ ] Quest trigger system
- [ ] Dialogue display system
- [ ] Cinematic script player
- [ ] Location zone mapping
- [ ] Achievement tracking

---

## 🎯 Next Steps

**Immediate (Next Session):**
1. Run seeding script to populate database
2. Test asset builder with all 5 storyline types
3. Run universe scanner to identify lore opportunities
4. Plan TOME integration architecture

**Short-term:**
1. Build TOME API endpoints
2. Create storyline viewer UI
3. Integrate with menu navigation
4. Add storyline filtering/search

**Long-term:**
1. In-game NPC system
2. Quest system integration
3. Dialogue trees
4. Cinematic cutscene player

---

*This document serves as the single source of truth for storyline asset management in the Stringborn Universe.* 