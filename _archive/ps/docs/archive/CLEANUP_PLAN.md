# PS App Cleanup & Consolidation Plan

## Executive Summary

The PS app has accumulated duplicate views, methods, and equipment/fitting systems during development. This document outlines the consolidation plan to create a single source of truth for inventory management.

---

## Files to Delete (Verified Safe)

These files are NOT referenced in any active routes:

```bash
# Character views (replaced by enhanced versions)
rm /srv/ps/views/characters/list.ejs         # ✅ Replaced by auth/index-enhanced.ejs

# Auth views (replaced by enhanced versions)
rm /srv/ps/views/auth/index.ejs              # ✅ Replaced by auth/index-enhanced.ejs
rm /srv/ps/views/auth-test.ejs               # ✅ Test file, not used

# Menu views (replaced by enhanced version)
rm /srv/ps/views/menu.ejs                    # ✅ Replaced by menu-enhanced.ejs

# Landing page (replaced)
rm /srv/ps/views/index.ejs                   # ✅ Replaced by index-sales.ejs

# Asset views (need consolidation)
rm /srv/ps/views/assets/builder.ejs          # ✅ Replaced by builder-enhanced.ejs
# Keep assets/vote.ejs OR voting.ejs (they're both used - need to pick one)
# Delete assets/voting-enhanced.ejs if not used
```

---

## Current Inventory System Architecture

### ✅ What's Working (New System)

**Inventory API** (`/api/v1/inventory/`)
- ✅ `GET /characters/:id/inventory` - Get backpack + equipped
- ✅ `POST /characters/:id/inventory/add` - Add item to backpack
- ✅ `POST /characters/:id/inventory/remove` - Remove item
- ✅ `POST /characters/:id/inventory/equip` - Equip item
- ✅ `POST /characters/:id/inventory/unequip` - Unequip item

**Inventory Modal** (`public/javascripts/inventory-modal.js`)
- ✅ Reactive UI with tabs (Backpack | Ship | Storehouse)
- ✅ Equipment paper doll (6 slots)
- ✅ Item grid with actions
- ✅ Real-time API integration
- ✅ Accessible from navbar character dropdown

**Item System**
- ✅ Items collection in MongoDB (18 seed items)
- ✅ Item model with categories, rarity, stats
- ✅ Stackable vs non-stackable items

### ⚠️ What Needs Fixing (Duplicates/Old System)

**Old Ship View** (`views/characters/ship.ejs`)
- ❌ Still rendered at `/characters/:id/ship`
- ❌ Shows ship cargo using OLD method
- ❌ Doesn't use new inventory API
- **ACTION**: Deprecate and redirect to inventory modal

**Character Detail Equipment** (`views/characters/detail-enhanced.ejs`)
- ⚠️ Shows equipped items but stores them as simple objects
- ⚠️ Doesn't fetch full item details from items collection
- **ACTION**: Update to populate item details from inventory API

**Character Model Duplication**
```javascript
// In api/v1/models/Character.js
{
  equipped: {
    head: null,      // ← OLD: Stores item reference
    chest: null,     // ← Should store { itemId, condition, metadata }
    weapon: null,
    ...
  },
  backpack: {
    items: []        // ← NEW: Uses proper structure
  },
  ship: {
    cargoHold: {
      items: []      // ← Needs API endpoints
    },
    fittings: {
      highSlots: [], // ← Needs API endpoints
      midSlots: [],
      lowSlots: []
    }
  }
}
```

---

## Consolidation Tasks

### Phase 1: API Completion ⚠️ IN PROGRESS

**Ship Cargo API**
```javascript
// Create: /api/v1/inventory/ship.js

GET    /api/v1/characters/:id/ship/cargo
POST   /api/v1/characters/:id/ship/cargo/transfer  // backpack ↔ ship
GET    /api/v1/characters/:id/ship/fittings
POST   /api/v1/characters/:id/ship/fittings/install
POST   /api/v1/characters/:id/ship/fittings/uninstall
```

**Storehouse API**
```javascript
// Create: /api/v1/inventory/storehouse.js

GET    /api/v1/storehouse/:characterId/:assetId
POST   /api/v1/storehouse/transfer  // backpack ↔ storehouse
```

### Phase 2: Update Inventory Modal ⚠️

**Add Ship Tab**
- Implement ship cargo grid
- Add transfer buttons (backpack ↔ ship)
- Show ship fittings slots
- Install/uninstall modules

**Add Storehouse Tab**
- Check if character is docked at galactic body
- Show storehouse grid
- Add transfer buttons (backpack ↔ storehouse)

### Phase 3: Update Views ⚠️

**Character Detail** (`views/characters/detail-enhanced.ejs`)
```javascript
// Change from:
<% if (character.equipped.head) { %>
  <%= character.equipped.head.name %>  // ← Just a string
<% } %>

// To:
<% if (character.equipped.head && character.equipped.head.itemDetails) { %>
  <div class="equipped-item">
    <div class="item-icon"><%= getItemIcon(character.equipped.head.itemDetails) %></div>
    <div class="item-name"><%= character.equipped.head.itemDetails.name %></div>
    <div class="item-rarity"><%= character.equipped.head.itemDetails.rarity %></div>
  </div>
<% } %>
```

**Update Route** (`routes/characters/index.js`)
```javascript
// In GET /:id route, populate equipped items:
if (character.equipped) {
  for (const [slot, equipped] of Object.entries(character.equipped)) {
    if (equipped && equipped.itemId) {
      const item = await Item.findById(equipped.itemId);
      character.equipped[slot].itemDetails = item;
    }
  }
}
```

### Phase 4: Deprecate Old System ⚠️

**Remove Ship View Route**
```javascript
// In routes/characters/index.js
// Change:
router.get('/:id/ship', async (req, res) => {
  res.render('characters/ship', { ... });
});

// To:
router.get('/:id/ship', async (req, res) => {
  // Redirect to character detail + open inventory modal
  res.redirect(`/characters/${req.params.id}?openInventory=ship`);
});
```

**Or completely remove** the route and update any links to it.

### Phase 5: Clean Up Files ✅

Run cleanup script:
```bash
cd /srv/ps

# Backup first!
mkdir -p .deprecated_views
mv views/characters/list.ejs .deprecated_views/
mv views/auth/index.ejs .deprecated_views/
mv views/auth-test.ejs .deprecated_views/
mv views/menu.ejs .deprecated_views/
mv views/index.ejs .deprecated_views/
mv views/assets/builder.ejs .deprecated_views/

# After testing, delete .deprecated_views folder
```

---

## Implementation Order

### Immediate (Now)
1. ✅ Create VIEW_AUDIT.md documentation
2. ✅ Create CLEANUP_PLAN.md (this file)
3. ⚠️ Create ship cargo API endpoints
4. ⚠️ Create ship fittings API endpoints

### Short Term (Next Session)
5. ⚠️ Update inventory modal with Ship tab
6. ⚠️ Update character detail view to show item details
7. ⚠️ Deprecate `/characters/:id/ship` route
8. ⚠️ Delete unused view files

### Medium Term (Future)
9. ⚠️ Add storehouse API endpoints
10. ⚠️ Add Storehouse tab to inventory modal
11. ⚠️ Implement drag-and-drop item movement
12. ⚠️ Add item tooltips with full stats

---

## Testing Checklist

After consolidation, verify:
- [ ] Can view character inventory from navbar dropdown
- [ ] Can equip/unequip items
- [ ] Character detail page shows equipped items with details
- [ ] Ship cargo is accessible and manageable
- [ ] Ship fittings can be installed/uninstalled
- [ ] No 404 errors from old routes
- [ ] All links updated to new system

---

## Benefits of Consolidation

1. **Single Source of Truth** - One inventory system, not multiple
2. **Better UX** - Modal accessible from anywhere
3. **Cleaner Codebase** - Remove ~8 duplicate view files
4. **Easier Maintenance** - Update one place, works everywhere
5. **Consistent UI** - Same look/feel across all inventory views
6. **API-First** - All actions go through consistent API endpoints

---

## Current File Structure

```
/srv/ps/
├── api/v1/
│   ├── inventory/index.js          # ✅ Character backpack/equipment API
│   ├── inventory/ship.js           # ❌ TODO: Ship cargo/fittings API
│   ├── inventory/storehouse.js     # ❌ TODO: Storehouse API
│   └── models/
│       ├── Character.js            # ✅ Has inventory structure
│       └── Item.js                 # ✅ Item model
├── public/
│   ├── javascripts/
│   │   └── inventory-modal.js      # ✅ Reactive inventory UI
│   └── stylesheets/
│       └── inventory-modal.css     # ✅ Modal styling
├── views/
│   ├── characters/
│   │   ├── detail-enhanced.ejs     # ⚠️ Needs update for item details
│   │   └── ship.ejs                # ❌ TO DEPRECATE
│   └── auth/
│       └── index-enhanced.ejs      # ✅ Character selection with details
└── routes/
    └── characters/index.js         # ⚠️ Needs ship route deprecation
```

---

## Next Steps

Run this command to see current status:
```bash
cd /srv/ps && node scripts/audit-inventory-system.js
```

(Create this script to check for:
- Unused view files
- API endpoint coverage
- Route redirects needed
- Link updates needed)
