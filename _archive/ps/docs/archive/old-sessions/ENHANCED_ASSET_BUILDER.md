# Enhanced Asset Builder System - Complete Implementation

## Overview

The asset builder has been significantly enhanced to give the community full power to build rich, stat-based game assets with lore, collaboration, and community-driven improvements.

## 🎯 New Features

### 1. Expanded Asset Types

**Available Types:**
- Character/NPC
- Item
- **Weapon** (NEW)
- **Armor** (NEW)
- **Ship/Vehicle** (NEW)
- **Ship Module** (NEW)
- **Ammunition** (NEW)
- **Consumable** (NEW)
- **Environment/Zone** (NEW)
- **Structure/Building** (NEW)
- Quest/Mission
- **Ability/Skill** (NEW)
- Species
- **Faction** (NEW)
- Other

### 2. Comprehensive Stats System

All stats stack to characters when equipped/used:

**Combat Stats:**
- Damage
- Defense
- Accuracy
- Critical Chance

**Physical Stats:**
- Health
- Energy
- Speed
- Weight

**Resource Stats:**
- Value (Credits)
- Durability
- Stackable (Yes/No)
- Max Stack Size

**Special Stats:**
- Range
- Fire Rate
- Capacity
- Required Level

**Custom Effects:**
- Free-form effects list
- Examples: "+10% Movement Speed", "Regenerate 5 HP/sec", "Immune to poison"

### 3. Rich Lore System

**Three Lore Fields:**

1. **Lore/History**
   - Background history and significance
   - Origins in the universe
   - Long-form narrative

2. **Backstory**
   - Creator/manufacturer information
   - How it came to exist
   - Short origin story

3. **Flavor Text**
   - Memorable quotes
   - Atmospheric descriptions
   - In-game display text

### 4. Rarity System

- Common
- Uncommon
- Rare
- Epic
- Legendary
- Mythic
- Unique

### 5. Community Collaboration Features

**Suggestions System:**
- Community members can suggest improvements
- Suggestions for pixel art additions/animations
- Feature suggestions
- Balance recommendations
- Upvoting system for suggestions
- Creator can see top suggestions

**Collaboration Tracking:**
- Add collaborators to assets
- Track contributions
- Community-driven creation

### 6. Metadata & Organization

- **Tags:** Comma-separated categorization
- **Category:** Asset classification
- **Tradeable:** Can be traded between players
- **Animation Frames:** Support for pixel art animations

## 📋 Complete Asset Data Structure

```javascript
{
  // Basic Info
  title: String,
  description: String,
  assetType: String,
  subType: String,
  rarity: String,
  tags: [String],
  category: String,

  // Images
  images: {
    pixelArt: String,
    fullscreen: String,
    indexCard: String
  },
  pixelData: Object,
  animationFrames: [Object],

  // Lore & Story
  lore: String,
  backstory: String,
  flavor: String,

  // Stats & Attributes (all stack to character)
  stats: {
    damage: Number,
    defense: Number,
    accuracy: Number,
    critChance: Number,
    health: Number,
    energy: Number,
    speed: Number,
    weight: Number,
    value: Number,
    durability: Number,
    range: Number,
    fireRate: Number,
    capacity: Number,
    level: Number
  },
  requirements: Object,
  effects: [String],

  // Item Properties
  stackable: Boolean,
  maxStack: Number,
  tradeable: Boolean,

  // Community Features
  votes: Number,
  voters: [ObjectId],
  suggestions: [{
    _id: ObjectId,
    userId: ObjectId,
    username: String,
    text: String,
    createdAt: Date,
    upvotes: Number,
    upvoters: [ObjectId]
  }],
  collaborators: [{
    userId: ObjectId,
    username: String,
    addedAt: Date,
    contribution: String
  }],

  // Status
  status: String,  // draft, pending, approved, rejected
  adminNotes: String,
  createdAt: Date,
  updatedAt: Date,
  approvedAt: Date,
  approvedBy: ObjectId
}
```

## 🎮 User Experience

### Asset Creation Workflow

1. **Basic Information**
   - Title, description
   - Asset type selection
   - Rarity selection
   - Tags for organization

2. **Lore & Story**
   - Write rich lore
   - Add backstory
   - Create flavor text

3. **Stats & Attributes**
   - Configure combat stats
   - Set physical attributes
   - Define resource stats
   - Add special effects

4. **Pixel Editor**
   - Create pixel art
   - Support for animations
   - 16x16, 32x32, 64x64 grids

5. **Image Uploads**
   - Pixel art alternative
   - Fullscreen artwork
   - Index card thumbnail

6. **Submit**
   - Save as draft (editable)
   - Submit for approval
   - Receive admin feedback

### Community Voting & Collaboration

1. **Browse Approved Assets**
   - View all details
   - See full stats
   - Read lore

2. **Vote for Favorites**
   - Upvote/downvote
   - Vote tracking
   - Leaderboard rankings

3. **Make Suggestions**
   - Suggest improvements
   - Pixel art additions
   - Animation ideas
   - Balance changes
   - Feature requests

4. **Upvote Suggestions**
   - Community prioritization
   - Creator sees top requests
   - Collaborative improvement

## 🔌 New API Endpoints

### Suggestions
```
POST   /api/v1/assets/:id/suggestions
       Add a suggestion to an asset
       Body: { text: String }

POST   /api/v1/assets/:assetId/suggestions/:suggestionId/upvote
       Upvote a suggestion

GET    /api/v1/assets/:id
       Returns full asset with suggestions array
```

### Collaborators
```
POST   /api/v1/assets/:id/collaborators
       Add a collaborator to your asset
       Body: { collaboratorId: String, collaboratorName: String }
```

## 📁 New Files

### Views
- `/srv/ps/views/assets/builder-enhanced.ejs` - Enhanced builder UI
- `/srv/ps/views/assets/voting-enhanced.ejs` - Enhanced voting with suggestions

### Scripts
- `/srv/ps/public/javascripts/asset-builder-enhanced.js` - Enhanced builder logic
- `/srv/ps/public/javascripts/voting-enhanced.js` - Voting with collaboration

### Models
- Updated `/srv/ps/api/v1/models/Asset.js` with new methods:
  - `addSuggestion()`
  - `upvoteSuggestion()`
  - `addCollaborator()`

### Routes
- Updated `/srv/ps/api/v1/assets/index.js` with suggestion endpoints
- Updated `/srv/ps/routes/assets/index.js` to use enhanced views

## 🎨 Visual Enhancements

### Stat Display
- Organized into 4 categories
- Color-coded groups
- Clean grid layout
- Mobile responsive

### Rarity Colors
- Common: Gray
- Uncommon: Green
- Rare: Blue
- Epic: Purple
- Legendary: Gold (bold)
- Mythic: Pink (bold)
- Unique: Red (bold)

### Suggestion UI
- Comment-style layout
- Upvote buttons
- Author attribution
- Timestamp display
- Inline form for new suggestions

### Modal View
- Full-screen overlay
- Comprehensive details
- Stats breakdown
- Lore sections
- Suggestions list
- Add suggestion form

## 🚀 Community Power Features

### For Creators
✅ Create rich, detailed assets
✅ Add comprehensive stats
✅ Write engaging lore
✅ See community feedback
✅ View suggestion rankings
✅ Add collaborators

### For Community
✅ Vote on favorites
✅ Suggest improvements
✅ Request animations
✅ Propose stat changes
✅ Upvote best suggestions
✅ Collaborate on assets

### For Admins
✅ Review full details
✅ See all stats and lore
✅ Approve/reject with notes
✅ Track community engagement

## 💡 Example Use Cases

### Creating a Weapon
```
Title: Plasma Rifle MK-VII
Type: Weapon
Rarity: Epic

Stats:
  - Damage: 75
  - Accuracy: 85
  - Range: 150
  - Fire Rate: 3.5
  - Required Level: 15

Effects:
  - +10% Critical Chance
  - Ignore 25% Armor
  - Overcharge Mode: 2x damage for 5s (60s cooldown)

Lore: "Developed by the Silicate Foundries during the
Great Expansion, this weapon represents the pinnacle
of energy weapon technology..."

Flavor: "When you absolutely, positively need to
vaporize every hostile in the sector."
```

### Community Suggestion
```
Suggestion: "Add a charging animation where the
barrel glows brighter before firing. Maybe 3-4
frames showing energy building up?"

Upvotes: 47
Creator can see and implement
```

## 🎯 Benefits

1. **Rich Content Creation**
   - Detailed, meaningful assets
   - Game-ready stats
   - Engaging lore

2. **Community Engagement**
   - Collaborative improvement
   - Voting and ranking
   - Suggestion system

3. **Quality Control**
   - Admin approval
   - Community feedback
   - Iterative refinement

4. **Game Integration**
   - Stats stack to characters
   - Balanced mechanics
   - Professional quality

## 📊 Stats Impact

When a character equips/uses an asset, all stats are added to their character sheet:

```
Base Character Stats + Item Stats = Final Stats

Example:
Character Health: 100
Armor Health Bonus: +50
Final Health: 150
```

## 🔮 Future Enhancements

Possible additions:
- Animation frame editor in pixel editor
- Suggestion implementation tracking
- Contribution credits
- Asset collections/sets
- Set bonuses
- Dynamic effects
- Conditional stats
- Level scaling
- Crafting recipes
- Drop rates
- Merchant prices

---

**Status:** ✅ Complete and functional
**Ready for:** Community asset creation
**Power level:** Full community-driven content creation! 🚀
