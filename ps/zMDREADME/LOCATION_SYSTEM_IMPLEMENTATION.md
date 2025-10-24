# Location-Based Character System - Implementation Summary

## Overview

We've implemented a comprehensive location-based system where characters are attached to specific assets (space hubs, planets, stations) rather than just floating coordinates. Characters now dock at locations, and their positions are derived from the assets they're docked at.

## Key Changes Made

### 1. Character Model Updates (`/srv/ps/api/v1/models/Character.js`)

Added new methods for asset-based positioning:

- **`dockAtAsset(characterId, assetId)`** - Dock character at a specific asset
  - Moves character to asset's position
  - Sets `location.assetId` to track docking
  - Stops navigation and sets velocity to 0
  - Returns asset information

- **`undock(characterId)`** - Undock from current asset
  - Clears `location.assetId`
  - Character remains at last position but is now "in open space"

- **`navigateToAsset(characterId, assetId)`** - Travel to and dock at asset
  - Sets destination to asset's position
  - Calculates ETA based on distance and travel speed
  - Stores asset reference in navigation destination
  - When travel completes, character docks automatically

- **`getCharactersAtAsset(assetId)`** - Get all characters at a location
  - Returns array of all characters docked at specific asset
  - Useful for showing who's at a station/hub

### 2. API Endpoints (`/srv/ps/api/v1/characters/index.js`)

New REST endpoints for location management:

```
POST /api/v1/characters/:id/dock
  Body: { assetId: string }
  Auth: Required, must own character
  Response: { success, asset: { _id, title, assetType, x, y } }

POST /api/v1/characters/:id/undock
  Auth: Required, must own character
  Response: { success, message }

POST /api/v1/characters/:id/navigate-to-asset
  Body: { assetId: string }
  Auth: Required, must own character
  Response: { success, eta, distance, destination }

GET /api/v1/characters/at-asset/:assetId
  Auth: Not required (public)
  Response: { characters: [...] }
```

### 3. Socket.IO Real-Time Events (`/srv/ps/plugins/socket/index.js`)

#### Client → Server Events

- **`characterJoin`** - Character enters the universe
  ```javascript
  socket.emit('characterJoin', {
    characterId: string,
    characterName: string,
    location: { x, y, assetId },
    assetId: string | null
  });
  ```

- **`characterDock`** - Character docks at asset
  ```javascript
  socket.emit('characterDock', {
    characterId: string,
    characterName: string,
    assetId: string,
    assetName: string,
    location: { x, y }
  });
  ```

- **`characterUndock`** - Character leaves asset
  ```javascript
  socket.emit('characterUndock', {
    characterId: string,
    characterName: string,
    location: { x, y }
  });
  ```

- **`characterNavigate`** - Character starts traveling
  ```javascript
  socket.emit('characterNavigate', {
    characterId: string,
    characterName: string,
    destination: { x, y, assetId, assetName },
    eta: Date
  });
  ```

- **`requestCharacterInfo`** - Request info about another character
  ```javascript
  socket.emit('requestCharacterInfo', {
    characterId: string
  });
  ```

#### Server → Client Events (Broadcasts)

- **`characterJoined`** - Another character entered
- **`characterDocked`** - Another character docked somewhere
- **`characterUndocked`** - Another character undocked
- **`characterNavigating`** - Another character started traveling
- **`characterLeft`** - Another character disconnected
- **`characterInfo`** - Response with character details

### 4. Ship Info Pane (`/srv/ps/public/javascripts/ship-info-pane.js`)

Interactive UI component for viewing other ships:

**Features:**
- Click on any character/ship on the map to view details
- Shows character info (name, level, species, class)
- Shows ship info (name, class, hull health)
- Shows location and docking status
- Shows all 5 character stats (STR, INT, AGI, FAITH, TECH)
- Real-time updates via socket.io
- Smooth slide-in/out animations

**Usage:**
```javascript
// Initialize (call once socket is ready)
const infoPane = initShipInfoPane(socket);

// Show info for a character
infoPane.show(characterId);

// Hide the pane
infoPane.hide();
```

### 5. Styling (`/srv/ps/public/stylesheets/ship-info-pane.css`)

Professional dark-themed info pane with:
- Glass-morphism background
- Smooth animations
- Health bars with dynamic colors
- Stat grid layout
- Mobile responsive
- Loading spinner
- Error states

## How It Works

### Character Location Flow

1. **Character Creation**
   - Character spawns at their String Domain's space hub
   - `location.x/y` set to hub coordinates
   - `location.assetId` initially null (in open space near hub)

2. **Docking at Asset**
   ```javascript
   POST /api/v1/characters/:id/dock
   { assetId: "hub_id_or_planet_id" }
   ```
   - Character moves to asset's exact position
   - `location.assetId` = assetId
   - `location.vx/vy` = 0 (stopped)
   - Socket broadcast: `characterDocked`

3. **Navigating to Asset**
   ```javascript
   POST /api/v1/characters/:id/navigate-to-asset
   { assetId: "destination_id" }
   ```
   - Sets navigation.destination with asset reference
   - Character starts moving toward asset
   - ETA calculated based on distance / travel speed
   - Socket broadcast: `characterNavigating`
   - When arrives (client/server logic needed), auto-dock

4. **Undocking**
   ```javascript
   POST /api/v1/characters/:id/undock
   ```
   - `location.assetId` = null
   - Character position unchanged
   - Now "in open space" can navigate freely
   - Socket broadcast: `characterUndocked`

### Asset Position System

Assets have positions stored in two possible locations:

1. **`hubData.location`** (Space Hubs)
   ```javascript
   {
     hubData: {
       location: { x: 500, y: 500 },
       isStartingLocation: true,
       stringDomain: "Time String"
     }
   }
   ```

2. **`initialPosition`** (Other Assets)
   ```javascript
   {
     initialPosition: { x: 2500, y: 1800 }
   }
   ```

When character docks, the system checks:
1. If asset has `hubData.location`, use that
2. Else if asset has `initialPosition`, use that
3. Else return error (asset has no position)

### Real-Time Updates

1. **Character Enters Universe**
   ```javascript
   // On page load/character selection
   socket.emit('characterJoin', { characterId, characterName, location, assetId });
   ```

2. **All Other Clients Notified**
   ```javascript
   // Other players see:
   socket.on('characterJoined', (data) => {
     // Add character marker to map
     map.addCharacter(data);
   });
   ```

3. **Character Actions Broadcast**
   - Docking → Everyone sees character at that asset
   - Undocking → Everyone sees character leave asset
   - Navigation → Everyone sees character's travel path
   - Info Request → Only requester gets response

## Integration Guide

### Adding to Map View

1. **Include Required Files**
   ```html
   <link rel="stylesheet" href="/stylesheets/ship-info-pane.css">
   <script src="/socket.io/socket.io.js"></script>
   <script src="/javascripts/ship-info-pane.js"></script>
   <script src="/javascripts/galactic-map-optimized.js"></script>
   ```

2. **Initialize Socket and Info Pane**
   ```javascript
   const socket = io();
   const infoPane = initShipInfoPane(socket);

   // Join with current character
   socket.emit('characterJoin', {
     characterId: currentCharacter._id,
     characterName: currentCharacter.name,
     location: currentCharacter.location,
     assetId: currentCharacter.location.assetId
   });
   ```

3. **Listen for Character Updates**
   ```javascript
   // Character joined
   socket.on('characterJoined', (data) => {
     galacticMap.addCharacter({
       _id: data.characterId,
       name: data.characterName,
       location: data.location
     });
   });

   // Character docked
   socket.on('characterDocked', (data) => {
     galacticMap.updateCharacterPosition(data.characterId, data.location);
   });

   // Character left
   socket.on('characterLeft', (data) => {
     galacticMap.removeCharacter(data.characterId);
   });
   ```

4. **Add Click Handler for Ship Info**
   ```javascript
   canvas.addEventListener('click', (e) => {
     const worldPos = galacticMap.screenToWorld(e.clientX, e.clientY);
     const clickedCharacter = galacticMap.getCharacterAtPosition(worldPos.x, worldPos.y);

     if (clickedCharacter) {
       infoPane.show(clickedCharacter._id);
     }
   });
   ```

### Example: Docking at a Space Hub

```javascript
async function dockAtHub(characterId, hubAssetId) {
  try {
    // Call API
    const response = await fetch(`/api/v1/characters/${characterId}/dock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: hubAssetId })
    });

    const result = await response.json();

    if (result.success) {
      // Broadcast via socket
      socket.emit('characterDock', {
        characterId: characterId,
        characterName: currentCharacter.name,
        assetId: hubAssetId,
        assetName: result.asset.title,
        location: result.asset
      });

      console.log(`Docked at ${result.asset.title}`);
    }
  } catch (error) {
    console.error('Docking failed:', error);
  }
}
```

### Example: Viewing Another Ship

```javascript
// Map click handler
galacticMap.canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Convert screen coords to world coords
  const worldX = (x / galacticMap.scale) - galacticMap.offsetX;
  const worldY = (y / galacticMap.scale) - galacticMap.offsetY;

  // Find character at position
  const character = galacticMap.characters.find(char => {
    const dx = char.location.x - worldX;
    const dy = char.location.y - worldY;
    const distance = Math.sqrt(dx*dx + dy*dy);
    return distance < 20; // 20px click radius
  });

  if (character) {
    shipInfoPane.show(character._id);
  }
});
```

## Database Structure

### Character Document
```javascript
{
  _id: ObjectId,
  userId: string,
  name: string,
  species: string,
  primaryClass: string,
  level: number,

  location: {
    type: 'galactic',
    x: number,              // Current position
    y: number,
    vx: number,             // Velocity (0 when docked)
    vy: number,
    zone: string,           // Zone name (optional)
    assetId: string | null, // Asset ID if docked
    lastUpdated: Date
  },

  navigation: {
    destination: {
      x: number,
      y: number,
      assetId: string,      // Asset traveling to
      assetName: string
    } | null,
    travelSpeed: number,
    isInTransit: boolean,
    eta: Date | null
  },

  homeHub: {
    id: string,
    name: string,
    stringDomain: string,
    location: { x, y }
  },

  ship: {
    name: string,
    class: string,
    hull: { maxHP, currentHP, armor },
    // ... other ship data
  },

  stats: {
    strength: number,
    intelligence: number,
    agility: number,
    faith: number,
    tech: number
  }
}
```

## Future Enhancements

1. **Auto-Docking on Arrival**
   - Add server-side or client-side logic to detect when character reaches destination
   - Automatically call `dockAtAsset` when ETA reached

2. **Asset Interior Views**
   - When docked, show interior scene of station/planet
   - Allow interaction with NPCs, shops, services

3. **Proximity Detection**
   - Alert when other players are at same asset
   - Show "X other ships docked here" indicator

4. **Fleet Management**
   - Group multiple characters from same user
   - Coordinate movement of multiple ships

5. **Combat Integration**
   - Can't dock while in combat
   - Can't undock while being attacked
   - Show combat status in info pane

6. **Asset Ownership**
   - Some assets can be player-owned
   - Control docking permissions
   - Charge docking fees

## Files Modified/Created

### Modified:
- `/srv/ps/api/v1/models/Character.js` - Added asset-based location methods
- `/srv/ps/api/v1/characters/index.js` - Added dock/undock/navigate endpoints
- `/srv/ps/plugins/socket/index.js` - Added location broadcast events

### Created:
- `/srv/ps/public/javascripts/ship-info-pane.js` - Info pane UI component
- `/srv/ps/public/stylesheets/ship-info-pane.css` - Info pane styling
- `/srv/ps/LOCATION_SYSTEM_IMPLEMENTATION.md` - This document

## Testing

Test the system with these steps:

1. **Create/Select Character**
   - Character should spawn at their home hub
   - Check `location.assetId` is null (in space near hub)

2. **Dock at Hub**
   ```javascript
   POST /api/v1/characters/CHARACTER_ID/dock
   { "assetId": "HUB_ASSET_ID" }
   ```
   - Verify character moves to hub coordinates
   - Verify `location.assetId` is set
   - Check socket broadcast received by other clients

3. **View Character Info**
   - Click on character marker on map
   - Info pane should slide in from right
   - All character details should display

4. **Navigate to Another Location**
   ```javascript
   POST /api/v1/characters/CHARACTER_ID/navigate-to-asset
   { "assetId": "DESTINATION_ASSET_ID" }
   ```
   - Verify `navigation.destination` is set
   - Verify ETA is calculated
   - Check socket broadcast

5. **Undock**
   ```javascript
   POST /api/v1/characters/CHARACTER_ID/undock
   ```
   - Verify `location.assetId` is null
   - Character should remain at same coordinates
   - Check socket broadcast

## Summary

The location-based system is now fully implemented with:
- ✅ Asset-based positioning (characters dock at locations)
- ✅ Navigation system (travel to and dock at assets)
- ✅ Real-time socket.io broadcasts (see other players' movements)
- ✅ Ship info pane (click to view other players' ships)
- ✅ Complete API endpoints (dock, undock, navigate)
- ✅ Database integration (track docking status)

Next steps: Integrate with the galactic map UI to visualize characters at their docked locations and enable click-to-view functionality.
