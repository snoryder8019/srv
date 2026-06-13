# Inventory & Storage System Design

## Overview
A tiered storage system for characters and ships to manage items, equipment, and cargo.

## Storage Types

### 1. Character Backpack (Personal Inventory)
- **Capacity**: Small (20-50 slots based on level/skills)
- **Purpose**: Items the character carries on their person
- **Access**: Always accessible
- **Contents**:
  - Consumables (health packs, energy cells)
  - Tools (repair kits, scanners)
  - Small trade goods
  - Quest items
  - Currency

### 2. Ship Cargo Hold
- **Capacity**: Medium to Large (based on ship type)
- **Purpose**: Bulk storage for trading, resources, equipment
- **Access**: Only when character is "in ship" (activeInShip: true)
- **Contents**:
  - Trade goods (bulk commodities)
  - Raw materials (ore, scrap, components)
  - Extra equipment/weapons
  - Larger items

### 3. Storehouse (Station Storage)
- **Capacity**: Very Large (500-1000 slots)
- **Purpose**: Long-term storage at specific galactic bodies
- **Access**: Only when docked at the storehouse location
- **Contents**:
  - Long-term item storage
  - Crafting materials stockpile
  - Extra ships/modules
  - Investment goods

## Database Schema

### Items Collection
```javascript
{
  _id: ObjectId,
  name: String,              // "Mining Laser Mk2"
  description: String,       // Item description
  itemType: String,          // "weapon", "module", "consumable", "resource", "trade_good"
  category: String,          // "energy_weapon", "shield", "ore", etc.
  stackable: Boolean,        // Can multiple stack in one slot?
  maxStack: Number,          // Maximum stack size (null = 1)
  volume: Number,            // Space taken per item/stack
  mass: Number,              // Weight per item
  rarity: String,            // "common", "uncommon", "rare", "legendary"
  attributes: {              // Item-specific stats
    damage: Number,
    range: Number,
    energyUse: Number,
    etc...
  },
  metadata: {
    createdBy: String,       // User/system who created item
    approvalStatus: String,  // "pending", "approved", "rejected"
    createdAt: Date,
    updatedAt: Date
  }
}
```

### Character Inventory Schema (added to characters collection)
```javascript
{
  // ... existing character fields ...

  inventory: {
    backpack: {
      capacity: 50,          // Total slots
      items: [
        {
          itemId: ObjectId,  // Reference to items collection
          quantity: Number,  // Stack size
          slot: Number,      // Slot position (0-49)
          metadata: {        // Item instance data
            condition: Number,  // Durability/quality
            modifications: []   // Custom mods/enchantments
          }
        }
      ]
    },

    equipped: {
      // Character equipment slots
      head: { itemId: ObjectId, condition: Number },
      chest: { itemId: ObjectId, condition: Number },
      legs: { itemId: ObjectId, condition: Number },
      feet: { itemId: ObjectId, condition: Number },
      hands: { itemId: ObjectId, condition: Number },
      weapon: { itemId: ObjectId, condition: Number },
      offhand: { itemId: ObjectId, condition: Number },
      trinket1: { itemId: ObjectId, condition: Number },
      trinket2: { itemId: ObjectId, condition: Number }
    }
  }
}
```

### Ship Inventory Schema (added to characters.ships or new ships collection)
```javascript
{
  _id: ObjectId,
  characterId: ObjectId,     // Owner
  name: String,              // Ship name
  shipType: String,          // "fighter", "hauler", "explorer"

  cargo: {
    capacity: 200,           // Based on ship type
    items: [
      {
        itemId: ObjectId,
        quantity: Number,
        slot: Number
      }
    ]
  },

  fittings: {
    // Ship module slots
    powerCore: { itemId: ObjectId, condition: Number },
    engine: { itemId: ObjectId, condition: Number },
    shield: { itemId: ObjectId, condition: Number },
    weapon1: { itemId: ObjectId, condition: Number },
    weapon2: { itemId: ObjectId, condition: Number },
    weapon3: { itemId: ObjectId, condition: Number },
    utility1: { itemId: ObjectId, condition: Number },
    utility2: { itemId: ObjectId, condition: Number }
  }
}
```

### Storehouse Collection
```javascript
{
  _id: ObjectId,
  characterId: ObjectId,     // Owner
  assetId: ObjectId,         // Galactic body where storehouse is located

  storage: {
    capacity: 1000,
    items: [
      {
        itemId: ObjectId,
        quantity: Number,
        slot: Number
      }
    ]
  },

  metadata: {
    createdAt: Date,
    lastAccessedAt: Date
  }
}
```

## API Endpoints

### Character Inventory
- `GET /api/v1/characters/:id/inventory` - Get character backpack + equipped
- `POST /api/v1/characters/:id/inventory/move` - Move item between slots
- `POST /api/v1/characters/:id/inventory/equip` - Equip item from backpack
- `POST /api/v1/characters/:id/inventory/unequip` - Unequip to backpack
- `POST /api/v1/characters/:id/inventory/use` - Use consumable item

### Ship Cargo
- `GET /api/v1/characters/:id/ship/cargo` - Get ship cargo (requires activeInShip)
- `POST /api/v1/characters/:id/ship/cargo/transfer` - Transfer items char ↔ ship
- `POST /api/v1/characters/:id/ship/fittings` - Get ship fittings
- `POST /api/v1/characters/:id/ship/fittings/install` - Install module

### Storehouse
- `GET /api/v1/storehouse/:characterId/:assetId` - Get storehouse at location
- `POST /api/v1/storehouse/transfer` - Transfer items char ↔ storehouse

## UI Components

### 1. Unified Inventory Panel
```
┌─────────────────────────────────────────┐
│  Character: Faithbender  |  Lvl 5       │
│  📍 At: Stellar Crown                   │
├─────────────────────────────────────────┤
│  [Backpack] [Ship] [Storehouse]         │ ← Tabs
├─────────────────────────────────────────┤
│  ┌────────┐  ┌────────┐  ┌────────┐    │
│  │ Item 1 │  │ Item 2 │  │ Item 3 │    │
│  │   x5   │  │   x1   │  │   x10  │    │
│  └────────┘  └────────┘  └────────┘    │
│  ┌────────┐  ┌────────┐  [Empty]       │
│  │ Item 4 │  │ Item 5 │                │
│  └────────┘  └────────┘                │
├─────────────────────────────────────────┤
│  Capacity: 12/50  |  Mass: 124kg       │
└─────────────────────────────────────────┘
```

### 2. Equipment Paper Doll
```
┌───────────────────┐
│      [Head]       │
│   [Chest]         │
│  [Weapon] [Off]   │
│   [Legs]          │
│   [Feet]          │
│ [Trinket1] [Tri2] │
└───────────────────┘
```

### 3. Ship Fittings
```
┌─────────────────────┐
│    Ship: Falcon     │
├─────────────────────┤
│  [Power Core]       │
│  [Engine]           │
│  [Shield]           │
│  [Weapon 1]         │
│  [Weapon 2]         │
│  [Weapon 3]         │
│  [Utility 1]        │
│  [Utility 2]        │
└─────────────────────┘
```

## Implementation Priority

1. ✅ Character equipped slots (already exists)
2. Character backpack inventory
3. Inventory UI panel (modal/sidebar)
4. Item database + seed script
5. Ship cargo system
6. Ship fittings UI
7. Storehouse system
8. Transfer between storage types
9. Item crafting/trading

## Notes
- All storage systems should support drag-and-drop in UI
- Implement weight/volume limits to prevent infinite storage
- Consider storage upgrades (backpack expansions, larger ships)
- Add item tooltips with full stats
- Support item search/filtering in larger inventories
