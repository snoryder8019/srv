# PLAN OF ACTION: Galactic Map 3D - Modal Interaction & Survival System

**Date:** 2025-11-04
**Project:** Stringborne Universe - Galactic Map 3D
**Session Type:** Complete System Redesign - Nested Payloads, Modal Interactions, Ship Fittings & Survival

---

## EXECUTIVE SUMMARY

### Problem Statement
Players are not appearing at their galaxy pins in galactic-map-3d due to:
1. Characters have absolute coordinates ~5000 units from their docked galaxy
2. No nested payload structure (characters separate from galaxies)
3. No modal interaction system for galaxy selection
4. Direct drill-down on galaxy click (too aggressive, no info/options)
5. **Missing survival mechanics** - travel has no consequences

### Solution Overview
**Option B: Nested Payload Structure** with comprehensive survival system

**Core Changes:**
1. **Nest characters under galaxies** in payload (characters at galaxy position)
2. **Separate inTransit array** for traveling characters
3. **Modal-based galaxy interaction** (repurpose #star-info-modal)
4. **Universal chat** at galaxy level with slash commands
5. **Ship fittings system** (fuel, food, oxygen, medkits, habitat)
6. **Travel validation** (check supplies before allowing travel)
7. **Consequences system** (death, ship loss, respawn with starter ship)
8. **Storehouse inventory** for galaxy-level item storage
9. **Tester commands** (/testersupply) for QA testing

---

## ARCHITECTURE

### Payload Structure (NEW)

```javascript
{
  galaxies: [
    {
      id: "galaxy_id",
      title: "Cosmic Nexus",
      position: {x: 2534, y: 3935, z: 3326},
      velocity: {vx: 2.3, vy: -1.1, vz: 0.8},

      // NESTED: Characters docked here (no offset - they ARE at galaxy position)
      dockedCharacters: [
        {
          _id: "char_id",
          name: "Faithbender",
          userId: "user_id",
          activeInShip: true,
          ship: {
            name: "Void Runner",
            fittings: {
              fuel: {capacity: 1000, remaining: 650},
              food: {capacity: 100, remaining: 75},
              oxygen: {capacity: 1000, remaining: 800}
            }
          }
        }
      ],

      // Galaxy stats for modal display
      stats: {
        starCount: 42,
        threatLevel: "Medium",
        type: "Spiral"
      },

      // Storehouse inventory at this galaxy
      storehouse: {
        fuel: 5000,
        food: 2000,
        oxygen: 10000,
        medkits: 500
      }
    }
  ],

  // Characters actively traveling between galaxies
  inTransit: [
    {
      _id: "char_id",
      name: "Wanderer",
      userId: "user_id",
      location: {x: 1500, y: 2500, z: 3000},
      from: "galaxy_id_1",
      to: "galaxy_id_2",
      eta: 120,
      ship: { /* ship data */ }
    }
  ],

  connections: [...],  // Unchanged
  timestamp: 1234567890
}
```

---

## IMPLEMENTATION PHASES

### PHASE 0: Database Schema & Seeding

#### 0A. Character.ship.fittings Schema

**File:** `/srv/ps/api/v1/models/Character.js`

Add to schema:
```javascript
ship: {
  name: String,
  class: String,
  hull: Number,
  maxHull: Number,

  // NEW: Ship Fittings
  fittings: {
    cargoCapacity: { type: Number, default: 500 },
    cargoUsed: { type: Number, default: 0 },

    lifeSupport: {
      installed: { type: Boolean, default: true },
      type: { type: String, default: "Basic" },
      oxygenCapacity: { type: Number, default: 500 },
      oxygenRemaining: { type: Number, default: 500 },
      foodCapacity: { type: Number, default: 50 },
      foodRemaining: { type: Number, default: 50 }
    },

    fuelTanks: {
      capacity: { type: Number, default: 500 },
      remaining: { type: Number, default: 500 },
      type: { type: String, default: "Standard" }
    },

    medicalBay: {
      installed: { type: Boolean, default: false },
      medKitsCapacity: { type: Number, default: 10 },
      medKitsRemaining: { type: Number, default: 0 },
      autoRevive: { type: Boolean, default: false }
    },

    habitat: {
      type: { type: String }, // Matches character.species
      installed: { type: Boolean, default: true }
    },

    shielding: {
      radiation: { type: Number, default: 0 },
      thermal: { type: Number, default: 0 },
      nebula: { type: Number, default: 0 }
    },

    specialFittings: [{
      id: String,
      name: String,
      installed: Boolean,
      condition: Number
    }]
  }
}
```

#### 0B. Storehouse Model

**File:** `/srv/ps/api/v1/models/Storehouse.js` (NEW)

```javascript
import mongoose from 'mongoose';

const storehouseSchema = new mongoose.Schema({
  galaxyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Asset',
    required: true,
    unique: true
  },

  inventory: {
    fuel: { type: Number, default: 10000 },
    food: { type: Number, default: 5000 },
    oxygen: { type: Number, default: 20000 },
    medkits: { type: Number, default: 1000 },
    // Expandable for future items
    custom: [{
      itemId: String,
      itemName: String,
      quantity: Number
    }]
  },

  access: {
    public: { type: Boolean, default: true },
    allowedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  },

  lastUpdated: { type: Date, default: Date.now }
});

export const Storehouse = mongoose.model('Storehouse', storehouseSchema);
```

#### 0C. Seed Script - Ship Fittings

**File:** `/srv/ps/scripts/seed-ship-fittings.js` (NEW)

```javascript
/**
 * Seed all existing characters with default ship fittings
 */
import { Character } from '../api/v1/models/Character.js';
import { connectDb } from '../plugins/mongo/mongo.js';

await connectDb();

const defaultFittings = {
  cargoCapacity: 500,
  cargoUsed: 0,

  lifeSupport: {
    installed: true,
    type: "Advanced",
    oxygenCapacity: 1000,
    oxygenRemaining: 1000,
    foodCapacity: 100,
    foodRemaining: 100
  },

  fuelTanks: {
    capacity: 1000,
    remaining: 1000,
    type: "Deuterium"
  },

  medicalBay: {
    installed: true,
    medKitsCapacity: 20,
    medKitsRemaining: 20,
    autoRevive: true
  },

  habitat: {
    type: "Human",
    installed: true
  },

  shielding: {
    radiation: 50,
    thermal: 30,
    nebula: 0
  },

  specialFittings: []
};

const characters = await Character.find({});
let updated = 0;

for (const char of characters) {
  if (!char.ship) {
    char.ship = {
      name: "Explorer",
      class: "Scout",
      hull: 100,
      maxHull: 100
    };
  }

  if (!char.ship.fittings) {
    char.ship.fittings = defaultFittings;

    // Match habitat to species
    if (char.species) {
      char.ship.fittings.habitat.type = char.species;
    }

    await char.save();
    updated++;
    console.log(`✅ Seeded fittings for ${char.name}`);
  }
}

console.log(`\n✅ Seeded ship fittings for ${updated} characters`);
process.exit(0);
```

**Run:** `node /srv/ps/scripts/seed-ship-fittings.js`

#### 0D. Seed Script - Storehouses

**File:** `/srv/ps/scripts/seed-galaxy-storehouses.js` (NEW)

```javascript
/**
 * Create storehouse for each galaxy
 */
import { Asset } from '../api/v1/models/Asset.js';
import { Storehouse } from '../api/v1/models/Storehouse.js';
import { connectDb } from '../plugins/mongo/mongo.js';

await connectDb();

const galaxies = await Asset.find({ assetType: 'galaxy' });
let created = 0;

for (const galaxy of galaxies) {
  const existing = await Storehouse.findOne({ galaxyId: galaxy._id });

  if (!existing) {
    await Storehouse.create({
      galaxyId: galaxy._id,
      inventory: {
        fuel: 50000,
        food: 20000,
        oxygen: 100000,
        medkits: 5000
      },
      access: {
        public: true
      }
    });
    created++;
    console.log(`✅ Created storehouse for ${galaxy.title}`);
  }
}

console.log(`\n✅ Created ${created} galaxy storehouses`);
process.exit(0);
```

**Run:** `node /srv/ps/scripts/seed-galaxy-storehouses.js`

---

### PHASE 1: Payload Restructure

**File:** `/srv/ps/services/physics-service.js`

**Lines:** 169-243 (replace characters array with nested structure)

```javascript
// OLD: Flat characters array
const charactersForRendering = characters.filter(char => {
  return hasLocation && isActiveCharacter;
}).map(char => ({ _id, name, location }));

// NEW: Nest characters under galaxies
const galaxiesWithCharacters = updatedGalaxies.map(galaxy => {
  // Find characters docked at this galaxy
  const dockedCharacters = characters.filter(char => {
    const hasLocation = char.location && char.location.type === 'galactic';
    const isActiveCharacter = connectedCharacterIds.includes(char._id.toString());
    const isDocked = char.location.dockedGalaxyId === galaxy.id;
    const notInTransit = !char.navigation?.isInTransit;

    return hasLocation && isActiveCharacter && isDocked && notInTransit;
  }).map(char => ({
    _id: char._id,
    name: char.name,
    userId: char.userId,
    activeInShip: char.activeInShip,
    ship: {
      name: char.ship?.name,
      fittings: {
        fuel: {
          capacity: char.ship?.fittings?.fuelTanks?.capacity || 0,
          remaining: char.ship?.fittings?.fuelTanks?.remaining || 0
        },
        food: {
          capacity: char.ship?.fittings?.lifeSupport?.foodCapacity || 0,
          remaining: char.ship?.fittings?.lifeSupport?.foodRemaining || 0
        },
        oxygen: {
          capacity: char.ship?.fittings?.lifeSupport?.oxygenCapacity || 0,
          remaining: char.ship?.fittings?.lifeSupport?.oxygenRemaining || 0
        },
        medkits: {
          capacity: char.ship?.fittings?.medicalBay?.medKitsCapacity || 0,
          remaining: char.ship?.fittings?.medicalBay?.medKitsRemaining || 0
        }
      }
    }
  }));

  return {
    ...galaxy,
    dockedCharacters: dockedCharacters
  };
});

// NEW: Separate in-transit characters
const inTransitCharacters = characters.filter(char => {
  const hasLocation = char.location && char.location.type === 'galactic';
  const isActiveCharacter = connectedCharacterIds.includes(char._id.toString());
  const inTransit = char.navigation?.isInTransit;

  return hasLocation && isActiveCharacter && inTransit;
}).map(char => ({
  _id: char._id,
  name: char.name,
  userId: char.userId,
  location: {
    x: char.location.x,
    y: char.location.y,
    z: char.location.z
  },
  from: char.navigation.from,
  to: char.navigation.destination,
  eta: char.navigation.eta,
  ship: { /* same as above */ }
}));

const payload = {
  galaxies: galaxiesWithCharacters,  // With nested dockedCharacters
  stars: updatedStars || [],
  connections: connections,
  inTransit: inTransitCharacters,    // Separate traveling characters
  simulationSpeed: this.simulationSpeed,
  timestamp: Date.now()
};

this.io.emit('galacticPhysicsUpdate', payload);
```

---

### PHASE 2: GameStateMonitor Update

**File:** `/srv/ps/public/javascripts/GameStateMonitor.js`

**Lines:** 76-91 (parse nested payload)

```javascript
this.socket.on('galacticPhysicsUpdate', (data) => {
  // Process galaxies with docked characters
  if (data.galaxies && Array.isArray(data.galaxies)) {
    data.galaxies.forEach(galaxy => {
      if (galaxy.dockedCharacters && galaxy.dockedCharacters.length > 0) {
        console.log(`📡 Galaxy ${galaxy.title}: ${galaxy.dockedCharacters.length} docked characters`);

        galaxy.dockedCharacters.forEach(char => {
          // Character position IS galaxy position
          this.updatePlayerGalacticState({
            _id: char._id,
            name: char.name,
            userId: char.userId,
            location: galaxy.position,  // Use galaxy position
            dockedGalaxyId: galaxy.id,
            dockedGalaxyName: galaxy.title,
            isInTransit: false,
            ship: char.ship  // Include ship fittings for UI
          });
        });
      }
    });
  }

  // Process in-transit characters
  if (data.inTransit && Array.isArray(data.inTransit)) {
    console.log(`📡 ${data.inTransit.length} characters in transit`);

    data.inTransit.forEach(char => {
      this.updatePlayerGalacticState({
        ...char,
        isInTransit: true
      });
    });
  }

  // Emit state sync
  this.emit('stateSync', {
    players: Array.from(this.players.values()),
    timestamp: data.timestamp
  });
});
```

---

### PHASE 3: Three.js Scene Updates

**File:** `/srv/ps/public/javascripts/galactic-map-3d.js`

#### 3A. Update Character Pin Creation (lines ~2399-2420)

```javascript
// OLD: Loop through flat data.characters array
// NEW: Loop through nested structure

if (data.galaxies) {
  data.galaxies.forEach(galaxy => {
    if (galaxy.dockedCharacters && galaxy.dockedCharacters.length > 0) {
      galaxy.dockedCharacters.forEach(char => {
        this.createCharacterPin({
          ...char,
          location: galaxy.position  // Pin at galaxy position
        });
      });
    }
  });
}

// Handle in-transit characters
if (data.inTransit) {
  data.inTransit.forEach(char => {
    this.createCharacterPin(char);  // Use char.location directly
  });
}
```

#### 3B. Fix createCharacterPin (lines ~2764-2771)

```javascript
// REMOVE conditional spawn at scene origin
// OLD:
// if (isCurrentPlayer) {
//   pinGroup.position.set(location.x, location.y, location.z);
// } else {
//   pinGroup.position.set(0, 0, 0);  // ❌ WRONG
// }

// NEW: ALWAYS use absolute galactic coordinates
pinGroup.position.set(location.x, location.y || 0, location.z || 0);

console.log(`📍 Created ${isCurrentPlayer ? 'YOUR' : 'OTHER'} player pin for "${character.name}" at (${location.x.toFixed(0)}, ${location.y?.toFixed(0) || 0}, ${location.z?.toFixed(0) || 0})`);
```

#### 3C. Modify selectObject() (lines ~1680-1691)

```javascript
// ADD galaxy modal routing
if (this.currentLevel === 'galaxy' && object.userData.assetType === 'star') {
  this.selectedStar = object;
  this.followingStar = true;
  this.showStarInfoModal(object.userData);
}
// NEW: Handle galaxy clicks
else if (object.userData.assetType === 'galaxy') {
  this.showGalaxyModal(object.userData);  // NEW METHOD
}
else {
  this.selectedStar = null;
  this.followingStar = false;
  this.hideStarInfoModal();
}
```

---

### PHASE 4: Galaxy Modal System

**File:** `/srv/ps/public/javascripts/galactic-map-3d.js`

Add after `showStarInfoModal()` (~line 1850):

```javascript
/**
 * Show galaxy interaction modal with supply checks
 */
async showGalaxyModal(galaxyData) {
  let modal = document.getElementById('star-info-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'star-info-modal';
    modal.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 20, 40, 0.95);
      border: 2px solid #8a4fff;
      border-radius: 10px;
      padding: 20px;
      color: #bb88ff;
      font-family: 'Courier New', monospace;
      z-index: 1000;
      min-width: 400px;
      max-width: 500px;
      max-height: 70vh;
      overflow-y: auto;
      box-shadow: 0 0 30px rgba(138, 79, 255, 0.6);
      backdrop-filter: blur(10px);
    `;
    document.body.appendChild(modal);
  }

  // Get characters docked at this galaxy
  const dockedCharacters = this.getDockedCharactersAt(galaxyData.id);
  const isPlayerDocked = dockedCharacters.some(c => c._id === window.currentCharacterId);
  const distance = this.calculateDistanceToGalaxy(galaxyData);

  // Validate travel if not docked
  let travelValidation = null;
  if (!isPlayerDocked && window.currentCharacter) {
    travelValidation = await this.validateTravelToGalaxy(galaxyData);
  }

  // Get player ship status
  const ship = window.currentCharacter?.ship?.fittings || {};

  modal.innerHTML = `
    <h3 style="margin: 0 0 15px 0; color: #bb88ff;">🌌 ${galaxyData.title || 'Unknown Galaxy'}</h3>
    <div style="font-size: 12px; color: #6dd5ed; margin-bottom: 15px;">
      Galaxy • ${galaxyData.stats?.type || 'Spiral'}
    </div>

    <!-- Galaxy Info -->
    <div style="margin-bottom: 20px; border-bottom: 1px solid rgba(109, 213, 237, 0.3); padding-bottom: 15px;">
      <div style="color: #888; font-size: 11px; margin-bottom: 10px;">📊 GALAXY INFO</div>
      <div style="font-size: 13px;">
        Stars: ${galaxyData.stats?.starCount || 'Unknown'}<br/>
        Distance: ${distance > 100 ? distance.toFixed(0) + ' units' : 'At location'}<br/>
        Threat Level: ${galaxyData.stats?.threatLevel || 'Unknown'}
      </div>
    </div>

    <!-- Ship Status -->
    <div style="margin-bottom: 20px; border-bottom: 1px solid rgba(109, 213, 237, 0.3); padding-bottom: 15px;">
      <div style="color: #888; font-size: 11px; margin-bottom: 10px;">🛠️ SHIP STATUS</div>
      <div style="font-size: 12px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>⛽ Fuel:</span>
          <span style="color: ${this.getSupplyColor(ship.fuelTanks?.remaining, ship.fuelTanks?.capacity)}">
            ${ship.fuelTanks?.remaining || 0}/${ship.fuelTanks?.capacity || 0}
          </span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>🍔 Food:</span>
          <span style="color: ${this.getSupplyColor(ship.lifeSupport?.foodRemaining, ship.lifeSupport?.foodCapacity)}">
            ${ship.lifeSupport?.foodRemaining || 0}/${ship.lifeSupport?.foodCapacity || 0}
          </span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>💨 Oxygen:</span>
          <span style="color: ${this.getSupplyColor(ship.lifeSupport?.oxygenRemaining, ship.lifeSupport?.oxygenCapacity)}">
            ${ship.lifeSupport?.oxygenRemaining || 0}/${ship.lifeSupport?.oxygenCapacity || 0}
          </span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>💊 Med Kits:</span>
          <span style="color: ${this.getSupplyColor(ship.medicalBay?.medKitsRemaining, ship.medicalBay?.medKitsCapacity)}">
            ${ship.medicalBay?.medKitsRemaining || 0}/${ship.medicalBay?.medKitsCapacity || 0}
          </span>
        </div>
      </div>
    </div>

    <!-- Travel Requirements (if not docked) -->
    ${!isPlayerDocked && travelValidation ? `
      <div style="margin-bottom: 20px; border-bottom: 1px solid rgba(109, 213, 237, 0.3); padding-bottom: 15px;">
        <div style="color: #888; font-size: 11px; margin-bottom: 10px;">📊 TRAVEL REQUIREMENTS</div>
        <div style="font-size: 11px;">
          <div style="margin-bottom: 8px;">
            Distance: ${travelValidation.requirements.distance.toFixed(0)} units<br/>
            ETA: ${this.formatDuration(travelValidation.requirements.travelTime)}
          </div>
          <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 5px; margin-bottom: 8px;">
            <div style="color: #6dd5ed; margin-bottom: 5px;">Required:</div>
            <div style="padding-left: 10px; font-size: 10px;">
              Fuel: ${travelValidation.requirements.fuel}<br/>
              Food: ${travelValidation.requirements.food}<br/>
              Oxygen: ${travelValidation.requirements.oxygen}
            </div>
          </div>

          ${travelValidation.warnings.length > 0 ? `
            <div style="background: rgba(255, 165, 0, 0.2); padding: 8px; border-radius: 5px; border-left: 3px solid orange; margin-bottom: 8px;">
              <div style="color: orange; font-weight: bold; margin-bottom: 5px; font-size: 10px;">⚠️ WARNINGS</div>
              ${travelValidation.warnings.map(w => `
                <div style="font-size: 9px; margin-bottom: 3px;">• ${w.message}</div>
              `).join('')}
            </div>
          ` : ''}

          ${travelValidation.blockers.length > 0 ? `
            <div style="background: rgba(255, 0, 0, 0.2); padding: 8px; border-radius: 5px; border-left: 3px solid red;">
              <div style="color: red; font-weight: bold; margin-bottom: 5px; font-size: 10px;">🚫 CANNOT TRAVEL</div>
              ${travelValidation.blockers.map(b => `
                <div style="font-size: 9px; margin-bottom: 3px;">• ${b.message}</div>
              `).join('')}
            </div>
          ` : `
            <div style="background: rgba(0, 255, 0, 0.2); padding: 8px; border-radius: 5px; border-left: 3px solid lime;">
              <div style="color: lime; font-weight: bold; margin-bottom: 5px; font-size: 10px;">✅ READY TO TRAVEL</div>
              <div style="font-size: 9px;">
                Survival: ${travelValidation.estimatedArrivalCondition.survivalChance}%<br/>
                Expected Health: ${travelValidation.estimatedArrivalCondition.health}%<br/>
                Ship Condition: ${travelValidation.estimatedArrivalCondition.shipCondition}%
              </div>
            </div>
          `}
        </div>
      </div>
    ` : ''}

    <!-- Players Here -->
    <div style="margin-bottom: 20px; border-bottom: 1px solid rgba(109, 213, 237, 0.3); padding-bottom: 15px;">
      <div style="color: #888; font-size: 11px; margin-bottom: 10px;">👥 PLAYERS HERE (${dockedCharacters.length})</div>
      <div style="font-size: 13px; max-height: 100px; overflow-y: auto;">
        ${dockedCharacters.length > 0
          ? dockedCharacters.map(c => `
              <div style="padding: 3px 0;">
                ${c._id === window.currentCharacterId ? '⭐ ' : '• '}${c.name}
              </div>
            `).join('')
          : '<div style="color: #666;">No players here</div>'
        }
      </div>
    </div>

    <!-- Universal Chat -->
    <div id="galaxy-chat-container" style="margin-bottom: 20px; border-bottom: 1px solid rgba(109, 213, 237, 0.3); padding-bottom: 15px;">
      <div style="color: #888; font-size: 11px; margin-bottom: 10px;">💬 UNIVERSAL CHAT</div>
      <div id="galaxy-chat-messages" style="
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(109, 213, 237, 0.2);
        border-radius: 5px;
        padding: 10px;
        height: 120px;
        overflow-y: auto;
        font-size: 11px;
        margin-bottom: 10px;
        color: #6dd5ed;
      ">
        <div style="color: #666; font-style: italic; font-size: 10px;">
          ${isPlayerDocked
            ? 'Type /help for commands'
            : 'You must be at this galaxy to chat'
          }
        </div>
      </div>
      ${isPlayerDocked ? `
        <input type="text" id="galaxy-chat-input" placeholder="Type message or /help..." style="
          width: 100%;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(109, 213, 237, 0.3);
          border-radius: 5px;
          padding: 8px;
          color: #6dd5ed;
          font-family: 'Courier New', monospace;
          font-size: 11px;
        "/>
      ` : `
        <div style="color: #666; font-style: italic; font-size: 10px;">
          Travel here to join the conversation
        </div>
      `}
    </div>

    <!-- Action Buttons -->
    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
      ${isPlayerDocked ? `
        <button id="enter-orbit-btn" style="
          flex: 1;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none;
          border-radius: 5px;
          padding: 12px;
          color: white;
          font-family: 'Courier New', monospace;
          cursor: pointer;
          font-size: 12px;
          font-weight: bold;
        ">
          🚀 Enter Orbit
        </button>
        <button id="storehouse-btn" style="
          background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
          border: none;
          border-radius: 5px;
          padding: 12px 20px;
          color: white;
          font-family: 'Courier New', monospace;
          cursor: pointer;
          font-size: 12px;
          font-weight: bold;
        ">
          🏪 Storehouse
        </button>
      ` : travelValidation && travelValidation.canTravel ? `
        <button id="hyper-travel-btn" style="
          flex: 1;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          border: none;
          border-radius: 5px;
          padding: 12px;
          color: white;
          font-family: 'Courier New', monospace;
          cursor: pointer;
          font-size: 12px;
          font-weight: bold;
        ">
          ⚡ Hyper Travel
        </button>
      ` : `
        <button disabled style="
          flex: 1;
          background: #333;
          border: none;
          border-radius: 5px;
          padding: 12px;
          color: #666;
          font-family: 'Courier New', monospace;
          font-size: 12px;
          cursor: not-allowed;
        ">
          🚫 Cannot Travel
        </button>
      `}

      <button id="close-modal-btn" style="
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(109, 213, 237, 0.3);
        border-radius: 5px;
        padding: 12px 20px;
        color: #6dd5ed;
        font-family: 'Courier New', monospace;
        cursor: pointer;
        font-size: 12px;
      ">
        Close
      </button>
    </div>
  `;

  modal.style.display = 'block';

  // Event listeners
  const closeBtn = modal.querySelector('#close-modal-btn');
  if (closeBtn) closeBtn.onclick = () => this.hideStarInfoModal();

  const enterOrbitBtn = modal.querySelector('#enter-orbit-btn');
  if (enterOrbitBtn) {
    enterOrbitBtn.onclick = () => {
      this.showGalaxyLevel(galaxyData.id);
      this.hideStarInfoModal();
    };
  }

  const hyperTravelBtn = modal.querySelector('#hyper-travel-btn');
  if (hyperTravelBtn) {
    hyperTravelBtn.onclick = () => {
      this.initiateHyperTravel(galaxyData);
      this.hideStarInfoModal();
    };
  }

  const storehouseBtn = modal.querySelector('#storehouse-btn');
  if (storehouseBtn) {
    storehouseBtn.onclick = () => this.showStorehouseModal(galaxyData.id);
  }

  // Chat input handler
  const chatInput = modal.querySelector('#galaxy-chat-input');
  if (chatInput && isPlayerDocked) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && chatInput.value.trim()) {
        const msg = chatInput.value.trim();

        // Handle slash commands
        if (msg.startsWith('/')) {
          this.handleChatCommand(msg, galaxyData.id);
        } else {
          this.sendGalaxyChatMessage(galaxyData.id, msg);
        }

        chatInput.value = '';
      }
    });
  }

  // Initialize chat listener
  this.initializeGalaxyChat(galaxyData.id);
}

/**
 * Helper methods for modal
 */
getDockedCharactersAt(galaxyId) {
  // From latest payload stored in class
  if (this.latestPayload && this.latestPayload.galaxies) {
    const galaxy = this.latestPayload.galaxies.find(g => g.id === galaxyId);
    return galaxy?.dockedCharacters || [];
  }
  return [];
}

calculateDistanceToGalaxy(galaxyData) {
  if (!window.currentCharacter || !window.currentCharacter.location) {
    return Infinity;
  }

  const charPos = window.currentCharacter.location;
  const galaxyPos = galaxyData.position || galaxyData.coordinates;

  const dx = charPos.x - galaxyPos.x;
  const dy = charPos.y - galaxyPos.y;
  const dz = charPos.z - galaxyPos.z;

  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

getSupplyColor(current, max) {
  const percent = (current / max) * 100;
  if (percent > 50) return '#00ff00'; // Green
  if (percent > 25) return '#ffaa00'; // Orange
  return '#ff0000'; // Red
}

formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Validate travel to galaxy
 */
async validateTravelToGalaxy(galaxyData) {
  try {
    const response = await fetch('/api/v1/travel/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: window.currentCharacterId,
        destination: {
          x: galaxyData.position.x,
          y: galaxyData.position.y,
          z: galaxyData.position.z,
          galaxyId: galaxyData.id
        }
      })
    });

    return await response.json();
  } catch (error) {
    console.error('Travel validation error:', error);
    return { canTravel: false, blockers: [{ message: 'Validation failed' }], warnings: [] };
  }
}

/**
 * Handle chat slash commands
 */
handleChatCommand(command, galaxyId) {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();

  switch(cmd) {
    case '/help':
      this.appendGalaxyChatMessage({
        characterName: 'SYSTEM',
        message: 'Commands: /supply <item> <amount> | /storehouse | /transfer <item> <amount> | /testersupply'
      });
      break;

    case '/testersupply':
      // Admin/Tester command - fill all supplies
      if (window.currentUser?.roles?.includes('tester')) {
        window.socket.emit('testerSupply', {
          characterId: window.currentCharacterId
        });
        this.appendGalaxyChatMessage({
          characterName: 'SYSTEM',
          message: '✅ Tester supply granted - all resources maxed'
        });
      } else {
        this.appendGalaxyChatMessage({
          characterName: 'SYSTEM',
          message: '❌ Tester access required'
        });
      }
      break;

    case '/supply':
      // Check storehouse and resupply
      const item = parts[1];
      const amount = parseInt(parts[2]) || 100;
      window.socket.emit('resupplyFromStorehouse', {
        characterId: window.currentCharacterId,
        galaxyId: galaxyId,
        item: item,
        amount: amount
      });
      break;

    case '/storehouse':
      this.showStorehouseModal(galaxyId);
      break;

    default:
      this.appendGalaxyChatMessage({
        characterName: 'SYSTEM',
        message: `Unknown command: ${cmd}. Type /help for commands.`
      });
  }
}

/**
 * Chat methods
 */
initializeGalaxyChat(galaxyId) {
  if (!this.galaxyChatListeners) {
    this.galaxyChatListeners = new Map();
  }

  if (this.galaxyChatListeners.has(galaxyId)) {
    return;
  }

  const listener = (data) => {
    if (data.galaxyId === galaxyId) {
      this.appendGalaxyChatMessage(data);
    }
  };

  window.socket.on('galaxyChatMessage', listener);
  this.galaxyChatListeners.set(galaxyId, listener);
}

sendGalaxyChatMessage(galaxyId, message) {
  if (!window.socket || !window.currentCharacter) return;

  window.socket.emit('galaxyChatMessage', {
    galaxyId: galaxyId,
    characterId: window.currentCharacter._id,
    characterName: window.currentCharacter.name,
    message: message,
    timestamp: Date.now()
  });
}

appendGalaxyChatMessage(data) {
  const chatContainer = document.getElementById('galaxy-chat-messages');
  if (!chatContainer) return;

  const msgDiv = document.createElement('div');
  msgDiv.style.cssText = 'margin-bottom: 8px; padding: 5px; border-left: 2px solid rgba(109, 213, 237, 0.3); padding-left: 8px;';
  msgDiv.innerHTML = `
    <div style="color: ${data.characterName === 'SYSTEM' ? '#ffaa00' : '#bb88ff'}; font-size: 10px; margin-bottom: 2px;">
      ${data.characterName}
    </div>
    <div style="color: #6dd5ed; font-size: 11px;">
      ${data.message}
    </div>
  `;

  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Show storehouse inventory modal
 */
async showStorehouseModal(galaxyId) {
  // Fetch storehouse data
  const response = await fetch(`/api/v1/storehouse/${galaxyId}`);
  const data = await response.json();

  if (!data.success) {
    alert('Failed to load storehouse');
    return;
  }

  // Create storehouse modal (similar structure to galaxy modal)
  // Shows inventory, allows transfers to ship
  // Implementation details...
}

/**
 * Initiate hyper travel
 */
initiateHyperTravel(galaxyData) {
  console.log('🚀 Initiating hyper travel to:', galaxyData.title);

  if (window.socket && window.currentCharacter) {
    window.socket.emit('characterNavigate', {
      characterId: window.currentCharacter._id,
      destination: {
        x: galaxyData.position.x,
        y: galaxyData.position.y,
        z: galaxyData.position.z,
        assetId: galaxyData.id,
        assetName: galaxyData.title
      }
    });

    this.appendGalaxyChatMessage({
      characterName: 'SYSTEM',
      message: `Hyper travel initiated to ${galaxyData.title}`
    });
  }
}
```

---

### PHASE 5: Socket Integration

**File:** `/srv/ps/plugins/socket/index.js`

Add after line 158:

```javascript
// Galaxy chat handler
socket.on('galaxyChatMessage', (data) => {
  console.log('💬 Galaxy chat:', data.galaxyId, data.characterName, data.message);

  io.emit('galaxyChatMessage', {
    galaxyId: data.galaxyId,
    characterId: data.characterId,
    characterName: data.characterName,
    message: data.message,
    timestamp: data.timestamp || new Date()
  });
});

// Tester supply command
socket.on('testerSupply', async (data) => {
  try {
    const { Character } = await import('../../api/v1/models/Character.js');
    const character = await Character.findById(data.characterId);

    if (!character) return;

    // Check if user is tester
    const user = await User.findById(character.userId);
    if (!user || !user.roles?.includes('tester')) {
      socket.emit('error', { message: 'Tester access required' });
      return;
    }

    // Max out all supplies
    character.ship.fittings.fuelTanks.remaining = character.ship.fittings.fuelTanks.capacity;
    character.ship.fittings.lifeSupport.foodRemaining = character.ship.fittings.lifeSupport.foodCapacity;
    character.ship.fittings.lifeSupport.oxygenRemaining = character.ship.fittings.lifeSupport.oxygenCapacity;
    character.ship.fittings.medicalBay.medKitsRemaining = character.ship.fittings.medicalBay.medKitsCapacity;
    character.stats.health = character.stats.maxHealth;
    character.ship.hull = character.ship.maxHull;

    await character.save();

    console.log(`✅ Tester supply granted to ${character.name}`);
    socket.emit('testerSupplyGranted', { success: true });

  } catch (error) {
    console.error('Tester supply error:', error);
    socket.emit('error', { message: 'Failed to grant tester supply' });
  }
});

// Resupply from storehouse
socket.on('resupplyFromStorehouse', async (data) => {
  try {
    const { Character } = await import('../../api/v1/models/Character.js');
    const { Storehouse } = await import('../../api/v1/models/Storehouse.js');

    const character = await Character.findById(data.characterId);
    const storehouse = await Storehouse.findOne({ galaxyId: data.galaxyId });

    if (!character || !storehouse) {
      socket.emit('error', { message: 'Character or storehouse not found' });
      return;
    }

    // Check if enough in storehouse
    const item = data.item;
    const amount = data.amount;

    if (storehouse.inventory[item] < amount) {
      socket.emit('error', { message: `Not enough ${item} in storehouse` });
      return;
    }

    // Transfer from storehouse to ship
    storehouse.inventory[item] -= amount;

    switch(item) {
      case 'fuel':
        character.ship.fittings.fuelTanks.remaining += amount;
        break;
      case 'food':
        character.ship.fittings.lifeSupport.foodRemaining += amount;
        break;
      case 'oxygen':
        character.ship.fittings.lifeSupport.oxygenRemaining += amount;
        break;
      case 'medkits':
        character.ship.fittings.medicalBay.medKitsRemaining += amount;
        break;
    }

    await character.save();
    await storehouse.save();

    io.emit('galaxyChatMessage', {
      galaxyId: data.galaxyId,
      characterName: 'SYSTEM',
      message: `${character.name} resupplied ${amount} ${item} from storehouse`
    });

  } catch (error) {
    console.error('Resupply error:', error);
    socket.emit('error', { message: 'Failed to resupply' });
  }
});
```

---

### PHASE 6: Travel Validation API

**File:** `/srv/ps/api/v1/routes/travel.js` (NEW)

```javascript
import express from 'express';
import { Character } from '../models/Character.js';

const router = express.Router();

/**
 * POST /api/v1/travel/validate
 * Validate if character can travel to destination
 */
router.post('/validate', async (req, res) => {
  try {
    const { characterId, destination } = req.body;

    const character = await Character.findById(characterId);
    if (!character) {
      return res.json({ success: false, error: 'Character not found' });
    }

    const validation = validateTravel(character, destination);

    res.json({
      success: true,
      ...validation
    });

  } catch (error) {
    console.error('Travel validation error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Validate travel requirements
 */
function validateTravel(character, destination) {
  const warnings = [];
  const blockers = [];

  const distance = calculateDistance(character.location, destination);
  const shipSpeed = character.ship.speed || 10;
  const travelTimeSeconds = distance / shipSpeed;
  const travelTimeHours = travelTimeSeconds / 3600;

  const requirements = {
    fuel: Math.ceil(distance * 0.5),
    food: Math.ceil(travelTimeHours * 2),
    oxygen: Math.ceil(travelTimeHours * 5),
    medkits: distance > 5000 ? 2 : 0,
    travelTime: travelTimeSeconds,
    distance: distance
  };

  // Check fuel
  const currentFuel = character.ship.fittings.fuelTanks.remaining;
  if (currentFuel < requirements.fuel) {
    blockers.push({
      type: 'fuel',
      message: `Insufficient fuel! Need ${requirements.fuel}, have ${currentFuel}`,
      required: requirements.fuel,
      current: currentFuel
    });
  } else if (currentFuel < requirements.fuel * 1.5) {
    warnings.push({
      type: 'fuel',
      message: 'Low fuel reserves. Consider refueling.',
      severity: 'medium'
    });
  }

  // Check food
  const currentFood = character.ship.fittings.lifeSupport.foodRemaining;
  if (currentFood < requirements.food) {
    blockers.push({
      type: 'food',
      message: `Insufficient food! Need ${requirements.food}, have ${currentFood}`,
      required: requirements.food,
      current: currentFood
    });
  }

  // Check oxygen
  const currentOxygen = character.ship.fittings.lifeSupport.oxygenRemaining;
  if (currentOxygen < requirements.oxygen) {
    blockers.push({
      type: 'oxygen',
      message: `Insufficient oxygen! Need ${requirements.oxygen}, have ${currentOxygen}`,
      required: requirements.oxygen,
      current: currentOxygen
    });
  }

  // Estimate arrival condition
  let health = 100;
  let shipCondition = 100;
  let survivalChance = 100;

  warnings.forEach(warning => {
    if (warning.type === 'fuel') survivalChance -= 10;
  });

  return {
    canTravel: blockers.length === 0,
    warnings: warnings,
    blockers: blockers,
    requirements: requirements,
    estimatedArrivalCondition: {
      health: health,
      shipCondition: shipCondition,
      survivalChance: survivalChance
    }
  };
}

function calculateDistance(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = (to.z || 0) - (from.z || 0);
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

export default router;
```

Add to main router:
```javascript
// In /srv/ps/index.js or wherever routes are registered
import travelRoutes from './api/v1/routes/travel.js';
app.use('/api/v1/travel', travelRoutes);
```

---

### PHASE 7: Storehouse API

**File:** `/srv/ps/api/v1/routes/storehouse.js` (NEW)

```javascript
import express from 'express';
import { Storehouse } from '../models/Storehouse.js';
import { Asset } from '../models/Asset.js';

const router = express.Router();

/**
 * GET /api/v1/storehouse/:galaxyId
 * Get storehouse inventory for a galaxy
 */
router.get('/:galaxyId', async (req, res) => {
  try {
    const { galaxyId } = req.params;

    let storehouse = await Storehouse.findOne({ galaxyId: galaxyId });

    // Create if doesn't exist
    if (!storehouse) {
      storehouse = await Storehouse.create({
        galaxyId: galaxyId,
        inventory: {
          fuel: 50000,
          food: 20000,
          oxygen: 100000,
          medkits: 5000
        }
      });
    }

    const galaxy = await Asset.findById(galaxyId);

    res.json({
      success: true,
      storehouse: storehouse,
      galaxyName: galaxy?.title || 'Unknown Galaxy'
    });

  } catch (error) {
    console.error('Storehouse fetch error:', error);
    res.json({ success: false, error: error.message });
  }
});

export default router;
```

Add to main router:
```javascript
import storehouseRoutes from './api/v1/routes/storehouse.js';
app.use('/api/v1/storehouse', storehouseRoutes);
```

---

## TESTING CHECKLIST

### Phase 0 - Database
- [ ] Run `node /srv/ps/scripts/seed-ship-fittings.js`
- [ ] Verify all characters have ship.fittings in DB
- [ ] Run `node /srv/ps/scripts/seed-galaxy-storehouses.js`
- [ ] Verify storehouse created for each galaxy

### Phase 1 - Payload
- [ ] Check server logs for nested payload structure
- [ ] Open `/debug-socket-payloads.html`
- [ ] Verify `galaxies[].dockedCharacters` array exists
- [ ] Verify `inTransit` array exists

### Phase 2 - GameStateMonitor
- [ ] Open browser console on galactic-map-3d
- [ ] Check for "Galaxy X: N docked characters" logs
- [ ] Check for "N characters in transit" logs

### Phase 3 - Scene
- [ ] Character pins appear at galaxy positions
- [ ] Multiple players at same galaxy all visible
- [ ] In-transit characters appear at travel coordinates

### Phase 4 - Modal
- [ ] Click galaxy → modal opens
- [ ] Ship status displays correctly
- [ ] Travel requirements calculated
- [ ] Players list shows docked characters
- [ ] Chat input visible when docked

### Phase 5 - Chat
- [ ] Type message in chat → broadcasts to all at galaxy
- [ ] Type `/help` → shows command list
- [ ] Type `/testersupply` → fills all supplies (if tester)
- [ ] Type `/supply fuel 100` → transfers from storehouse

### Phase 6 - Travel Validation
- [ ] Low fuel → "Cannot Travel" button shown
- [ ] Sufficient supplies → "Hyper Travel" button enabled
- [ ] Warnings display when supplies low but sufficient
- [ ] Click Hyper Travel → character starts moving

### Phase 7 - Storehouse
- [ ] Click "Storehouse" button → storehouse modal opens
- [ ] Inventory displays correctly
- [ ] Transfer items to ship → updates both inventories

---

## FILES TO CREATE/MODIFY

### New Files (12)
1. `/srv/ps/api/v1/models/Storehouse.js`
2. `/srv/ps/api/v1/routes/travel.js`
3. `/srv/ps/api/v1/routes/storehouse.js`
4. `/srv/ps/scripts/seed-ship-fittings.js`
5. `/srv/ps/scripts/seed-galaxy-storehouses.js`
6. `/srv/ps/docs/POA_GALACTIC_INTERACTION_SYSTEM.md` (this file)

### Modified Files (5)
1. `/srv/ps/api/v1/models/Character.js` - Add ship.fittings schema
2. `/srv/ps/services/physics-service.js` - Nest characters under galaxies
3. `/srv/ps/public/javascripts/GameStateMonitor.js` - Parse nested payload
4. `/srv/ps/public/javascripts/galactic-map-3d.js` - Modal + chat + validation
5. `/srv/ps/plugins/socket/index.js` - Chat + tester supply handlers

---

## SLASH COMMANDS

### Universal Chat Commands

| Command | Description | Example | Access |
|---------|-------------|---------|--------|
| `/help` | Show all commands | `/help` | All |
| `/supply <item> <amount>` | Resupply from storehouse | `/supply fuel 500` | Docked players |
| `/storehouse` | Open storehouse modal | `/storehouse` | Docked players |
| `/transfer <item> <amount>` | Transfer to storehouse | `/transfer food 50` | Docked players |
| `/testersupply` | Max all supplies (QA) | `/testersupply` | Testers only |

---

## SURVIVAL MECHANICS

### Resource Consumption Rates

| Resource | Consumption | Death Time |
|----------|-------------|------------|
| Fuel | 0.5 per unit distance | Drift → Death in 2 min |
| Food | 2 per hour | Starvation damage |
| Oxygen | 5 per hour | Suffocation damage |
| Med Kits | On-demand | - |

### Death Consequences

When character dies during travel:
1. **Respawn** at nearest station
2. **Lose ship** and all cargo
3. **Lose 10%** of credits
4. **Spawn with** starter ship (Emergency Pod)
5. **50% health** on respawn

### Starter Ship (Emergency Pod)

```javascript
{
  name: "Emergency Pod",
  class: "Shuttle",
  hull: 50,
  fittings: {
    fuel: {capacity: 100, remaining: 100},
    food: {capacity: 10, remaining: 10},
    oxygen: {capacity: 100, remaining: 100},
    medkits: {capacity: 0, remaining: 0}
  }
}
```

---

## QUICK COMMANDS

```bash
# Seed database
node /srv/ps/scripts/seed-ship-fittings.js
node /srv/ps/scripts/seed-galaxy-storehouses.js

# Restart server
lsof -ti:3399 | xargs -r kill -9 && cd /srv/ps && nohup npm start > /tmp/ps-server.log 2>&1 &

# Check logs
tail -50 /tmp/ps-server.log | grep 'dockedCharacters'
tail -50 /tmp/ps-server.log | grep 'inTransit'

# Test pages
http://localhost:3399/debug-socket-payloads.html
http://localhost:3399/universe/galactic-map-3d
```

---

## SUCCESS CRITERIA

✅ **Complete when:**
1. Players appear at their galaxy pins (not 5000 units away)
2. Multiple online players visible at same galaxy
3. Galaxy modal opens on click with supply info
4. Universal chat works with slash commands
5. Travel validation prevents travel with insufficient supplies
6. Tester command `/testersupply` works
7. Storehouse transfers work
8. Modal shows "Cannot Travel" when supplies too low

---

**End of POA**
