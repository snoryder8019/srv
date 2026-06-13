# PS App - View and Endpoint Audit

## Current Status: In Progress

Generated: 2025-10-25

---

## Active Views (In Use)

### Authentication & User Flow
- ✅ **`/auth`** → `views/auth/index-enhanced.ejs`
  - Route: `routes/index.js`
  - Purpose: Login/Register + Character Selection
  - Status: ✅ Enhanced, using new inventory system
  - Notes: Consolidated login + character selection in one view

### Character Management
- ✅ **`/characters`** → `views/auth/index-enhanced.ejs`
  - Route: `routes/characters/index.js`
  - Purpose: Character selection (same as /auth when logged in)
  - Status: ✅ Enhanced with location display, ship info, stats

- ✅ **`/characters/create`** → `views/characters/create.ejs`
  - Route: `routes/characters/index.js`
  - Purpose: Character creation form
  - Status: ✅ Active

- ✅ **`/characters/:id`** → `views/characters/detail-enhanced.ejs`
  - Route: `routes/characters/index.js`
  - Purpose: Character details/stats page
  - Status: ⚠️ Needs update to show new inventory system

- ✅ **`/characters/:id/ship`** → `views/characters/ship.ejs`
  - Route: `routes/characters/index.js`
  - Purpose: Ship inventory view
  - Status: ⚠️ DUPLICATE - Should use new inventory modal instead

### Universe Navigation
- ✅ **`/universe/galactic-map`** → `views/universe/galactic-map.ejs`
  - Route: `routes/universe/index.js`
  - Purpose: Main 3D galactic map with ship controls
  - Status: ✅ Active, recently updated with location tracking

- **`/universe/galaxy-map`** → `views/universe/galaxy-map.ejs`
  - Route: `routes/universe/index.js`
  - Purpose: Specific galaxy view (NOT IN USE?)
  - Status: ⚠️ Verify if needed

- **`/universe/star-system`** → `views/universe/star-system.ejs`
  - Route: `routes/universe/index.js`
  - Purpose: Star system view (NOT IN USE?)
  - Status: ⚠️ Verify if needed

- **`/universe/tome`** → `views/universe/tome.ejs`
  - Route: `routes/universe/index.js`
  - Purpose: Universe lore/codex
  - Status: ⚠️ Verify if needed

### Asset Creation
- ✅ **`/assets/voting`** → `views/assets/voting.ejs`
  - Route: `routes/assets/index.js`
  - Purpose: Community asset voting
  - Status: ✅ Active

- ✅ **`/assets/builder`** → `views/assets/builder-enhanced.ejs`
  - Route: `routes/assets/index.js`
  - Purpose: Asset creation tool
  - Status: ✅ Active (enhanced version)

- ✅ **`/assets/my-assets`** → `views/assets/my-assets.ejs`
  - Route: `routes/assets/index.js`
  - Purpose: User's created assets
  - Status: ✅ Active

### Menu & Navigation
- ✅ **`/menu`** → `views/menu-enhanced.ejs`
  - Route: `routes/index.js`
  - Purpose: Main navigation hub
  - Status: ✅ Active

- ✅ **`/`** → `views/index-sales.ejs`
  - Route: `routes/index.js`
  - Purpose: Landing page
  - Status: ✅ Active

### Admin
- ✅ **`/admin/*`** → Various admin views
  - Route: `routes/admin/index.js`
  - Purpose: Admin control panel
  - Status: ✅ Active

### Profile
- ✅ **`/profile`** → `views/profile.ejs`
  - Route: `routes/profile.js`
  - Purpose: User profile page
  - Status: ✅ Active

---

## Deprecated/Duplicate Views (To Remove or Consolidate)

### Characters
- ❌ **`views/characters/list.ejs`**
  - OLD character list view (slot-based)
  - REPLACED BY: `auth/index-enhanced.ejs`
  - ACTION: ✅ Already consolidated, can be deleted

- ❌ **`views/characters/detail.ejs`**
  - OLD character detail page (non-enhanced)
  - REPLACED BY: `characters/detail-enhanced.ejs`
  - ACTION: Delete if not referenced

- ⚠️ **`views/characters/ship.ejs`**
  - OLD ship inventory page
  - REPLACED BY: New inventory modal system
  - ACTION: Update to redirect to new inventory modal OR delete

### Assets
- ❌ **`views/assets/builder.ejs`**
  - OLD asset builder (non-enhanced)
  - REPLACED BY: `assets/builder-enhanced.ejs`
  - ACTION: Delete if not referenced

- ❌ **`views/assets/vote.ejs`**
  - OLD voting page (non-enhanced)
  - REPLACED BY: `assets/voting.ejs` or `voting-enhanced.ejs`
  - ACTION: Consolidate into single voting view

- ❌ **`views/assets/voting-enhanced.ejs`**
  - Enhanced voting (may be duplicate of `voting.ejs`)
  - ACTION: Verify which is active, delete the other

### Auth
- ❌ **`views/auth/index.ejs`**
  - OLD auth page (non-enhanced)
  - REPLACED BY: `auth/index-enhanced.ejs`
  - ACTION: Delete if not referenced

- ❌ **`views/auth-test.ejs`**
  - Test file
  - ACTION: Delete

### Menu
- ❌ **`views/menu.ejs`**
  - OLD menu (non-enhanced)
  - REPLACED BY: `menu-enhanced.ejs`
  - ACTION: Delete if not referenced

### Landing
- ❌ **`views/index.ejs`**
  - OLD landing page
  - REPLACED BY: `index-sales.ejs`
  - ACTION: Delete if not referenced

### Universe
- ❌ **`views/universe/galacticState.ejs`**
  - OLD galactic state view
  - ACTION: Verify if needed, likely obsolete

- ❌ **`views/universe/galacticState-stream.ejs`**
  - Stream version of galactic state
  - ACTION: Verify if needed, likely obsolete

---

## Duplicate Equipment/Fitting Systems (CRITICAL)

### Current Issues:

1. **Character Model** (`api/v1/models/Character.js`)
   - Has `equipped` object (head, chest, weapon, etc.)
   - Has `ship.fittings` object (highSlots, midSlots, lowSlots, rigSlots)
   - Has `ship.cargoHold.items` array
   - Has `backpack.items` array

2. **Old Ship View** (`views/characters/ship.ejs`)
   - Shows ship cargo and fittings
   - Uses OLD method of displaying items
   - NOT using new inventory API

3. **New Inventory Modal** (`public/javascripts/inventory-modal.js`)
   - Shows backpack + equipped items
   - Has tabs for Ship / Storehouse (not implemented)
   - Uses NEW inventory API endpoints

### Consolidation Plan:

**Phase 1: Inventory API**
- ✅ Created `/api/v1/inventory/` endpoints
- ✅ Character backpack management
- ✅ Equipment equip/unequip
- ❌ TODO: Ship cargo management API
- ❌ TODO: Ship fittings API

**Phase 2: Views**
- ✅ New inventory modal for backpack
- ❌ TODO: Add ship cargo tab to inventory modal
- ❌ TODO: Add ship fittings UI to inventory modal
- ❌ TODO: Remove old `views/characters/ship.ejs` route

**Phase 3: Character Detail**
- ❌ TODO: Update `views/characters/detail-enhanced.ejs` to show equipped items from new system
- ❌ TODO: Show ship fittings in character detail
- ❌ TODO: Link to inventory modal for management

---

## API Endpoints Audit

### Character API (`/api/v1/characters/*`)
- ✅ `GET /` - List characters
- ✅ `POST /` - Create character
- ✅ `GET /:id` - Get character details
- ✅ `DELETE /:id` - Delete character
- ✅ `POST /:id/location` - Update location
- ✅ `POST /:id/navigate` - Set destination
- ✅ `POST /:id/set-active` - Set active character
- ✅ `GET /check` - Check sync status

### Inventory API (`/api/v1/characters/:id/inventory/*`)
- ✅ `GET /` - Get inventory (backpack + equipped)
- ✅ `POST /add` - Add item to backpack
- ✅ `POST /remove` - Remove item from backpack
- ✅ `POST /equip` - Equip item from backpack
- ✅ `POST /unequip` - Unequip item to backpack
- ❌ TODO: Ship cargo endpoints
- ❌ TODO: Ship fittings endpoints
- ❌ TODO: Storehouse endpoints

### Assets API (`/api/v1/assets/*`)
- ✅ Active and working

### Universe API (`/api/v1/universe/*`)
- ✅ Active and working

---

## Action Items

### High Priority
1. ❌ Create ship cargo API endpoints
2. ❌ Create ship fittings API endpoints
3. ❌ Add Ship tab to inventory modal UI
4. ❌ Update character detail page to use new inventory system
5. ❌ Remove/deprecate old ship.ejs view

### Medium Priority
6. ❌ Delete unused view files (list.ejs, old auth, old menu, etc.)
7. ❌ Consolidate voting views (pick one, delete others)
8. ❌ Verify if galaxy-map/star-system views are needed
9. ❌ Add storehouse API endpoints
10. ❌ Add Storehouse tab to inventory modal

### Low Priority
11. ❌ Clean up unused routes in routes/index.js
12. ❌ Document all active endpoints in API docs
13. ❌ Add tests for inventory system

---

## Files Safe to Delete (After Verification)

```
views/characters/list.ejs          # Replaced by auth/index-enhanced.ejs
views/characters/detail.ejs        # Replaced by detail-enhanced.ejs
views/assets/builder.ejs           # Replaced by builder-enhanced.ejs
views/assets/vote.ejs              # Replaced by voting.ejs
views/auth/index.ejs               # Replaced by index-enhanced.ejs
views/auth-test.ejs                # Test file
views/menu.ejs                     # Replaced by menu-enhanced.ejs
views/index.ejs                    # Replaced by index-sales.ejs
```

**NOTE**: Verify routes don't reference these before deleting!
