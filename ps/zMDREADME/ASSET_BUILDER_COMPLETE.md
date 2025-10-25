# Asset Builder System - Complete Guide

## Overview

A comprehensive community-driven asset creation, approval, and voting system for the Stringborn Universe. This system empowers the community to build rich, stat-based game assets with lore, collaboration features, and democratic voting.

---

## Features At A Glance

✅ **15+ Asset Types** - Characters, weapons, armor, ships, modules, environments, abilities, factions, and more
✅ **Comprehensive Stats** - Damage, defense, health, energy, speed, durability, and custom effects
✅ **Rich Lore System** - History, backstory, and flavor text fields
✅ **7 Rarity Tiers** - Common to Mythic to Unique
✅ **Community Collaboration** - Voting, suggestions, upvoting, collaborators
✅ **Pixel Art Editor** - Built-in editor with 16x16, 32x32, 64x64 grids
✅ **Multi-Image Upload** - Pixel art, fullscreen artwork, index card thumbnail
✅ **Approval Workflow** - Draft → Submit → Admin Review → Approved → Community Voting
✅ **Animation Support** - Multi-frame pixel art animations

---

## Asset Types

### Available Types
- **Character/NPC** - Playable or non-playable characters
- **Item** - General items
- **Weapon** - Combat weapons with damage stats
- **Armor** - Defensive equipment with defense stats
- **Ship/Vehicle** - Spacecraft and vehicles
- **Ship Module** - Upgrades and fittings for ships
- **Ammunition** - Ammo for weapons
- **Consumable** - Usable items (health packs, boosters, etc.)
- **Environment/Zone** - Locations and zones
- **Structure/Building** - Bases, stations, outposts
- **Quest/Mission** - Story missions
- **Ability/Skill** - Special abilities and skills
- **Species** - Playable species
- **Faction** - Organizations and factions
- **Other** - Miscellaneous assets

---

## Stats System

All stats **stack to characters** when equipped/used:

### Combat Stats
- **Damage** - Base damage output
- **Defense** - Damage reduction
- **Accuracy** - Hit chance modifier
- **Critical Chance** - Percent chance for critical hits

### Physical Stats
- **Health** - HP bonus
- **Energy** - Energy/capacitor bonus
- **Speed** - Movement speed modifier
- **Weight** - Item weight (affects inventory)

### Resource Stats
- **Value** - Credits/currency value
- **Durability** - Item condition/uses
- **Stackable** - Can stack in inventory (Yes/No)
- **Max Stack** - Maximum stack size

### Special Stats
- **Range** - Effective range
- **Fire Rate** - Attacks/shots per second
- **Capacity** - Magazine/cargo capacity
- **Required Level** - Minimum level to use

### Custom Effects
Free-form effects list. Examples:
- "+10% Movement Speed"
- "Regenerate 5 HP/sec"
- "Immune to poison"
- "Overcharge Mode: 2x damage for 5s (60s cooldown)"

---

## Rarity System

- **Common** - Gray - Basic items
- **Uncommon** - Green - Slightly better
- **Rare** - Blue - Valuable finds
- **Epic** - Purple - Very rare
- **Legendary** - Gold - Extremely rare
- **Mythic** - Pink - Nearly unique
- **Unique** - Red - One-of-a-kind

---

## Lore & Story

### Three Lore Fields

**1. Lore/History**
- Background history and significance
- Origins in the universe
- Long-form narrative
- Example: "Developed by the Silicate Foundries during the Great Expansion..."

**2. Backstory**
- Creator/manufacturer information
- How it came to exist
- Short origin story
- Example: "Forged in the fires of the Crimson Bastion..."

**3. Flavor Text**
- Memorable quotes
- Atmospheric descriptions
- In-game display text
- Example: "When you absolutely, positively need to vaporize every hostile in the sector."

---

## Pixel Art Editor

### Features
- **Grid Sizes:** 16x16, 32x32, 64x64
- **Color Picker** - Full color palette
- **Drawing Tools** - Click/drag to draw
- **Fill Tool** - Fill areas with color
- **Clear Tool** - Reset canvas
- **Export** - Save as PNG
- **Touch Support** - Works on mobile
- **Animation Frames** - Create multi-frame animations

### Usage
1. Select grid size
2. Pick color
3. Draw on canvas
4. Export to PNG or save pixel data
5. Add to asset

---

## Image Upload System

### Three Image Types

**1. Pixel Art**
- From pixel editor or upload
- Used in-game for sprites
- Recommended: 32x32 or 64x64

**2. Fullscreen Artwork**
- High-resolution display image
- Shows in detail views
- Recommended: 1920x1080 or higher

**3. Index Card**
- Thumbnail for lists/cards
- Quick preview image
- Recommended: 400x600

### Upload Specs
- **Max Size:** 10MB per file
- **Formats:** JPEG, PNG, GIF, WebP
- **Storage:** `/srv/ps/uploads/assets/`
- **Naming:** Auto-generated secure filenames

---

## Community Collaboration

### Voting System
- Browse approved assets
- Upvote/downvote favorites
- One vote per user per asset
- Assets ranked by vote count
- Public viewing (login required to vote)

### Suggestions System
- Suggest improvements to any approved asset
- Types of suggestions:
  - Pixel art additions/animations
  - Balance recommendations
  - Feature suggestions
  - Lore improvements
- Upvote system for suggestions
- Creator sees top suggestions
- Can implement and credit suggester

### Collaborators
- Add collaborators to your assets
- Track contributions
- Community-driven creation
- Shared credit

---

## Workflow

### For Creators

```
1. Create Asset
   ↓
2. Fill in Details
   - Title, description
   - Asset type, rarity
   - Stats and effects
   - Lore and backstory
   ↓
3. Add Visuals
   - Use pixel editor
   - Upload images
   ↓
4. Save as Draft
   (can edit later)
   ↓
5. Submit for Approval
   ↓
6. Admin Reviews
   ↓
7a. APPROVED          7b. REJECTED
   ↓                      ↓
8. Community Voting    Edit & Resubmit
```

### For Community

```
1. Browse Approved Assets
   ↓
2. View Full Details
   - Stats, lore, images
   ↓
3. Vote (Upvote/Downvote)
   ↓
4. Make Suggestions
   - Suggest improvements
   - Upvote others' suggestions
   ↓
5. Collaborate
   - Become a collaborator
   - Contribute to creation
```

### For Admins

```
1. View Pending Submissions
   ↓
2. Review Asset
   - Check images
   - Review stats/lore
   - Verify quality
   ↓
3. Approve or Reject
   - Add admin notes
   - Provide feedback
   ↓
4. Track Statistics
   - Pending count
   - Approval rate
   - Community engagement
```

---

## Routes

### View Routes
- `GET /assets` - Asset builder page (authenticated users)
- `GET /assets/voting` - Community voting page (public, login to vote)
- `GET /admin/assets` - Admin approval interface (admin only)

### API Endpoints

#### User APIs
```
GET    /api/v1/assets                           - Get user's assets
GET    /api/v1/assets/:id                       - Get specific asset
POST   /api/v1/assets                           - Create asset
PUT    /api/v1/assets/:id                       - Update asset
DELETE /api/v1/assets/:id                       - Delete asset
POST   /api/v1/assets/:id/submit                - Submit for approval
GET    /api/v1/assets/approved/list             - Get approved assets
GET    /api/v1/assets/community                 - Get community assets
POST   /api/v1/assets/:id/vote                  - Vote for asset
DELETE /api/v1/assets/:id/vote                  - Remove vote
POST   /api/v1/assets/:id/suggestions           - Add suggestion
POST   /api/v1/assets/:assetId/suggestions/:suggestionId/upvote
                                                 - Upvote suggestion
POST   /api/v1/assets/:id/collaborators         - Add collaborator
```

#### Admin APIs
```
GET    /admin/api/assets/pending                - Get pending assets
GET    /admin/api/assets/stats                  - Get statistics
POST   /admin/api/assets/:id/approve            - Approve asset
POST   /admin/api/assets/:id/reject             - Reject asset
```

---

## Database Schema

```javascript
{
  // Basic Info
  _id: ObjectId,
  userId: ObjectId,              // Creator
  title: String,
  description: String,
  assetType: String,
  subType: String,
  rarity: String,
  tags: [String],
  category: String,

  // Images
  images: {
    pixelArt: String,            // File path
    fullscreen: String,          // File path
    indexCard: String            // File path
  },
  pixelData: Object,             // Raw pixel editor data
  animationFrames: [Object],     // Animation frames

  // Lore & Story
  lore: String,                  // Long-form history
  backstory: String,             // Origin story
  flavor: String,                // Flavor text/quotes

  // Stats (all stack to character)
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
  effects: [String],             // Custom effects

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

  // Status & Admin
  status: String,                // draft, pending, approved, rejected
  adminNotes: String,
  createdAt: Date,
  updatedAt: Date,
  approvedAt: Date,
  approvedBy: ObjectId
}
```

---

## Example: Creating a Weapon

```javascript
{
  title: "Plasma Rifle MK-VII",
  assetType: "Weapon",
  rarity: "Epic",
  tags: ["Energy Weapon", "Rifle", "Tech"],

  stats: {
    damage: 75,
    accuracy: 85,
    range: 150,
    fireRate: 3.5,
    level: 15
  },

  effects: [
    "+10% Critical Chance",
    "Ignore 25% Armor",
    "Overcharge Mode: 2x damage for 5s (60s cooldown)"
  ],

  lore: "Developed by the Silicate Foundries during the Great Expansion, this weapon represents the pinnacle of energy weapon technology. Its quantum-aligned plasma coils can pierce through the toughest armor, making it a favorite among elite combat units.",

  backstory: "Commissioned by the Quantum Forge Complex during the War of Strings, only 1,000 units were ever produced. Most were lost during the Collapse.",

  flavor: "When you absolutely, positively need to vaporize every hostile in the sector."
}
```

---

## Security

- ✅ Authentication required for asset creation
- ✅ Admin role required for approvals
- ✅ File type validation (images only)
- ✅ File size limits (10MB)
- ✅ User ownership verification
- ✅ One vote per user per asset
- ✅ Secure filename generation
- ✅ Status-based edit restrictions

---

## File Structure

```
/srv/ps/
├── api/v1/
│   ├── models/
│   │   └── Asset.js                    - Asset model
│   └── assets/
│       └── index.js                    - Asset API routes
├── routes/
│   └── assets/
│       └── index.js                    - Asset view routes
├── views/
│   └── assets/
│       ├── builder.ejs                 - Asset builder UI
│       └── voting.ejs                  - Voting page
├── public/
│   ├── javascripts/
│   │   ├── pixel-editor.js             - Pixel editor
│   │   ├── asset-builder.js            - Builder logic
│   │   └── voting.js                   - Voting logic
│   └── stylesheets/
│       └── asset-builder.css           - Styling
├── plugins/
│   └── multer/
│       └── config.js                   - File upload config
└── uploads/
    └── assets/                         - Uploaded files
```

---

## Quick Start

### 1. Access Asset Builder
```
Login → Visit /assets
```

### 2. Create Asset
```
1. Fill in title, description
2. Select asset type and rarity
3. Add stats and effects
4. Write lore and backstory
5. Use pixel editor or upload images
6. Save as draft or submit
```

### 3. Admin Approval
```
Admin visits /admin/assets
Reviews pending assets
Approves or rejects with notes
```

### 4. Community Voting
```
Visit /assets/voting
Browse approved assets
Vote for favorites
Make suggestions
```

---

## Future Enhancements

Potential additions:
- Animation frame editor in pixel editor
- Asset collections/sets with set bonuses
- Suggestion implementation tracking
- Contribution credits system
- Dynamic effects system
- Conditional stats
- Level scaling
- Crafting recipes integration
- Drop rates configuration
- Merchant pricing system
- Export to game database automation
- Image optimization/compression
- Search and filtering
- Leaderboards

---

**Status:** ✅ Complete and Functional
**Ready For:** Community Asset Creation
**Power Level:** Full Community-Driven Content Creation! 🚀

---

**Files Referenced:**
- Model: [/srv/ps/api/v1/models/Asset.js](../api/v1/models/Asset.js)
- API Routes: [/srv/ps/api/v1/assets/index.js](../api/v1/assets/index.js)
- View Routes: [/srv/ps/routes/assets/index.js](../routes/assets/index.js)
- Pixel Editor: [/srv/ps/public/javascripts/pixel-editor.js](../public/javascripts/pixel-editor.js)
