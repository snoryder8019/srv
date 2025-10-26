/**
 * Reactive Inventory Modal System
 * Displays character backpack, equipped items, ship cargo, and storehouse
 */

class InventoryModal {
  constructor() {
    this.characterId = null;
    this.inventory = null;
    this.activeTab = 'backpack'; // backpack, ship, storehouse
    this.modal = null;
    this.init();
  }

  init() {
    // Create modal HTML
    this.createModal();
    // Set up event listeners
    this.setupEventListeners();
  }

  createModal() {
    const modalHTML = `
      <div id="inventoryModal" class="inventory-modal" style="display: none;">
        <div class="inventory-modal-overlay"></div>
        <div class="inventory-modal-content">
          <!-- Header -->
          <div class="inventory-header">
            <h2>Inventory</h2>
            <button class="inventory-close" onclick="window.inventoryModal.close()">✕</button>
          </div>

          <!-- Tabs -->
          <div class="inventory-tabs">
            <button class="inventory-tab active" data-tab="backpack">
              🎒 Backpack
            </button>
            <button class="inventory-tab" data-tab="ship">
              🚀 Ship
            </button>
            <button class="inventory-tab" data-tab="storehouse">
              🏪 Storehouse
            </button>
          </div>

          <!-- Content Area -->
          <div class="inventory-body">
            <!-- Left Panel: Equipment or Ship Fittings -->
            <div class="equipment-panel" id="leftPanel">
              <h3 id="leftPanelTitle">Equipment</h3>

              <!-- Character Equipment (shown on backpack tab) -->
              <div id="characterEquipment" class="equipment-slots">
                <div class="equipment-slot" data-slot="head">
                  <div class="slot-label">Head</div>
                  <div class="slot-content" id="slot-head">
                    <span class="slot-empty">Empty</span>
                  </div>
                </div>
                <div class="equipment-slot" data-slot="chest">
                  <div class="slot-label">Chest</div>
                  <div class="slot-content" id="slot-chest">
                    <span class="slot-empty">Empty</span>
                  </div>
                </div>
                <div class="equipment-slot" data-slot="weapon">
                  <div class="slot-label">Weapon</div>
                  <div class="slot-content" id="slot-weapon">
                    <span class="slot-empty">Empty</span>
                  </div>
                </div>
                <div class="equipment-slot" data-slot="offhand">
                  <div class="slot-label">Off-hand</div>
                  <div class="slot-content" id="slot-offhand">
                    <span class="slot-empty">Empty</span>
                  </div>
                </div>
                <div class="equipment-slot" data-slot="legs">
                  <div class="slot-label">Legs</div>
                  <div class="slot-content" id="slot-legs">
                    <span class="slot-empty">Empty</span>
                  </div>
                </div>
                <div class="equipment-slot" data-slot="feet">
                  <div class="slot-label">Feet</div>
                  <div class="slot-content" id="slot-feet">
                    <span class="slot-empty">Empty</span>
                  </div>
                </div>
              </div>

              <!-- Ship Fittings (shown on ship tab) -->
              <div id="shipFittings" class="ship-fittings" style="display: none;">
                <!-- High Slots -->
                <div class="fitting-section">
                  <h4>🔴 High Slots</h4>
                  <div id="highSlots" class="fitting-slots"></div>
                </div>
                <!-- Mid Slots -->
                <div class="fitting-section">
                  <h4>🟡 Mid Slots</h4>
                  <div id="midSlots" class="fitting-slots"></div>
                </div>
                <!-- Low Slots -->
                <div class="fitting-section">
                  <h4>🟢 Low Slots</h4>
                  <div id="lowSlots" class="fitting-slots"></div>
                </div>
                <!-- Rig Slots -->
                <div class="fitting-section">
                  <h4>⚪ Rig Slots</h4>
                  <div id="rigSlots" class="fitting-slots"></div>
                </div>
              </div>

              <!-- Storehouse Locations (shown on storehouse tab) -->
              <div id="storehouseLocations" class="storehouse-locations" style="display: none;">
                <div class="location-info" id="currentLocationInfo">
                  <h4>📍 Current Location</h4>
                  <div class="current-location-display">
                    <span id="currentLocationName">Loading...</span>
                  </div>
                </div>

                <div class="location-section">
                  <h4>🏪 Available Storage</h4>
                  <div id="storageLocationsList" class="storage-locations-list">
                    <!-- Storage locations will be populated here -->
                  </div>
                </div>

                <div class="location-help">
                  <p>💡 Tip: Store items at stations and hubs for safekeeping. Access your items when you return to the same location.</p>
                </div>
              </div>
            </div>

            <!-- Right: Inventory Grid -->
            <div class="inventory-panel">
              <div class="inventory-panel-header">
                <h3 id="inventoryPanelTitle">Backpack</h3>
                <span class="inventory-capacity" id="inventoryCapacity">0/50</span>
              </div>
              <div class="inventory-grid" id="inventoryGrid">
                <!-- Items will be dynamically inserted here -->
              </div>
            </div>
          </div>

          <!-- Loading State -->
          <div class="inventory-loading" id="inventoryLoading" style="display: none;">
            <div class="loading-spinner"></div>
            <p>Loading inventory...</p>
          </div>

          <!-- Empty State -->
          <div class="inventory-empty" id="inventoryEmpty" style="display: none;">
            <p>No items in inventory</p>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('inventoryModal');
  }

  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.inventory-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Close on overlay click
    const overlay = document.querySelector('.inventory-modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => this.close());
    }

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal.style.display === 'flex') {
        this.close();
      }
    });
  }

  async open(characterId) {
    this.characterId = characterId;
    this.modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Load inventory data
    await this.loadInventory();
  }

  close() {
    this.modal.style.display = 'none';
    document.body.style.overflow = '';
  }

  switchTab(tab) {
    this.activeTab = tab;

    // Update tab buttons
    document.querySelectorAll('.inventory-tab').forEach(t => {
      t.classList.remove('active');
      if (t.dataset.tab === tab) {
        t.classList.add('active');
      }
    });

    // Update panel title and left panel
    const titles = {
      backpack: 'Backpack',
      ship: 'Ship Cargo',
      storehouse: 'Storehouse'
    };
    const leftPanelTitles = {
      backpack: 'Equipment',
      ship: 'Ship Fittings',
      storehouse: 'Storage Locations'
    };

    document.getElementById('inventoryPanelTitle').textContent = titles[tab];
    document.getElementById('leftPanelTitle').textContent = leftPanelTitles[tab];

    // Show/hide appropriate left panel content
    const characterEquipment = document.getElementById('characterEquipment');
    const shipFittings = document.getElementById('shipFittings');
    const storehouseLocations = document.getElementById('storehouseLocations');

    if (tab === 'ship') {
      characterEquipment.style.display = 'none';
      shipFittings.style.display = 'block';
      storehouseLocations.style.display = 'none';
      this.renderShipFittings();
    } else if (tab === 'storehouse') {
      characterEquipment.style.display = 'none';
      shipFittings.style.display = 'none';
      storehouseLocations.style.display = 'block';
      this.renderStorehouseLocations();
    } else {
      characterEquipment.style.display = 'grid';
      shipFittings.style.display = 'none';
      storehouseLocations.style.display = 'none';
    }

    // Render appropriate content
    this.renderInventoryPanel();
  }

  async loadInventory() {
    const loading = document.getElementById('inventoryLoading');
    const grid = document.getElementById('inventoryGrid');

    loading.style.display = 'flex';
    grid.style.display = 'none';

    try {
      // Load character inventory (backpack + equipment)
      const invResponse = await fetch(`/api/v1/characters/${this.characterId}/inventory`, {
        credentials: 'include'
      });

      if (!invResponse.ok) {
        throw new Error('Failed to load inventory');
      }

      this.inventory = await invResponse.json();

      // Always load ship data
      const shipResponse = await fetch(`/api/v1/characters/${this.characterId}/ship/cargo`, {
        credentials: 'include'
      });

      if (shipResponse.ok) {
        this.inventory.ship = await shipResponse.json();
      }

      // Load ship fittings
      const fittingsResponse = await fetch(`/api/v1/characters/${this.characterId}/ship/fittings`, {
        credentials: 'include'
      });

      if (fittingsResponse.ok) {
        this.inventory.fittings = await fittingsResponse.json();
      }

      // Load character location data for storehouse
      const characterResponse = await fetch(`/api/v1/characters/${this.characterId}`, {
        credentials: 'include'
      });

      if (characterResponse.ok) {
        const data = await characterResponse.json();
        const characterData = data.character || data;
        this.characterLocation = characterData.location;
        this.characterHomeHub = characterData.homeHub;
      }

      loading.style.display = 'none';
      grid.style.display = 'grid';

      this.renderEquipment();
      this.renderInventoryPanel();

      // Render ship fittings if we're on the ship tab
      if (this.activeTab === 'ship') {
        this.renderShipFittings();
      }

      // Render storehouse locations if we're on the storehouse tab
      if (this.activeTab === 'storehouse') {
        this.renderStorehouseLocations();
      }

    } catch (error) {
      console.error('Error loading inventory:', error);
      loading.style.display = 'none';
      alert('Failed to load inventory. Please try again.');
    }
  }

  renderEquipment() {
    const equipped = this.inventory.equipped || {};

    Object.keys(equipped).forEach(slot => {
      const slotElement = document.getElementById(`slot-${slot}`);
      if (!slotElement) return;

      const item = equipped[slot];

      if (item && item.itemDetails) {
        slotElement.innerHTML = `
          <div class="equipped-item" data-item-id="${item.itemId}" data-slot="${slot}">
            <div class="item-icon">${this.getItemIcon(item.itemDetails)}</div>
            <div class="item-name">${item.itemDetails.name}</div>
            <div class="item-actions">
              <button class="item-action-btn" onclick="window.inventoryModal.unequipItem('${slot}')">
                Unequip
              </button>
            </div>
          </div>
        `;
      } else {
        slotElement.innerHTML = '<span class="slot-empty">Empty</span>';
      }
    });
  }

  renderInventoryPanel() {
    const grid = document.getElementById('inventoryGrid');
    const capacityEl = document.getElementById('inventoryCapacity');

    if (this.activeTab === 'backpack') {
      const items = this.inventory.backpack.items || [];
      const capacity = this.inventory.backpack.capacity || 50;

      capacityEl.textContent = `${items.length}/${capacity}`;

      if (items.length === 0) {
        grid.innerHTML = '<div class="inventory-empty-message">Backpack is empty</div>';
        return;
      }

      grid.innerHTML = items.map(item => {
        if (!item.itemDetails) return '';

        return `
          <div class="inventory-item" data-item-id="${item.itemId}">
            <div class="item-icon">${this.getItemIcon(item.itemDetails)}</div>
            <div class="item-info">
              <div class="item-name">${item.itemDetails.name}</div>
              ${item.quantity > 1 ? `<div class="item-quantity">x${item.quantity}</div>` : ''}
            </div>
            <div class="item-rarity ${item.itemDetails.rarity}">${item.itemDetails.rarity}</div>
            <div class="item-actions">
              ${this.canEquipItem(item.itemDetails) ? `
                <button class="item-action-btn" onclick="window.inventoryModal.equipItem('${item.itemId}')">
                  Equip
                </button>
              ` : ''}
              <button class="item-action-btn" onclick="window.inventoryModal.transferToShip('${item.itemId}', ${item.quantity})">
                Ship →
              </button>
              <button class="item-action-btn danger" onclick="window.inventoryModal.removeItem('${item.itemId}')">
                Drop
              </button>
            </div>
          </div>
        `;
      }).join('');

    } else if (this.activeTab === 'ship') {
      // Load ship cargo if not already loaded
      if (!this.inventory.ship) {
        this.loadInventory();
        return;
      }

      const items = this.inventory.ship.cargo.items || [];
      const capacity = this.inventory.ship.cargo.capacity || 200;
      const usedSpace = this.inventory.ship.cargo.usedSpace || 0;

      capacityEl.textContent = `${usedSpace.toFixed(1)}/${capacity} m³`;

      if (items.length === 0) {
        grid.innerHTML = '<div class="inventory-empty-message">Ship cargo is empty</div>';
        return;
      }

      grid.innerHTML = items.map(item => {
        if (!item.itemDetails) return '';

        return `
          <div class="inventory-item" data-item-id="${item.itemId}">
            <div class="item-icon">${this.getItemIcon(item.itemDetails)}</div>
            <div class="item-info">
              <div class="item-name">${item.itemDetails.name}</div>
              ${item.quantity > 1 ? `<div class="item-quantity">x${item.quantity}</div>` : ''}
              <div class="item-volume">${(item.itemDetails.volume || 1) * item.quantity} m³</div>
            </div>
            <div class="item-rarity ${item.itemDetails.rarity}">${item.itemDetails.rarity}</div>
            <div class="item-actions">
              <button class="item-action-btn" onclick="window.inventoryModal.transferToBackpack('${item.itemId}', ${item.quantity})">
                ← Backpack
              </button>
              ${item.itemDetails.itemType === 'module' ? `
                <button class="item-action-btn" onclick="window.inventoryModal.showFittingsModal('${item.itemId}')">
                  Install
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

    } else if (this.activeTab === 'storehouse') {
      grid.innerHTML = '<div class="inventory-empty-message">Storehouse coming soon</div>';
      capacityEl.textContent = '0/1000';
    }
  }

  getItemIcon(item) {
    const icons = {
      consumable: '💊',
      weapon: '⚔️',
      module: '🔧',
      resource: '⛏️',
      trade_good: '📦',
      equipment: '🛡️'
    };
    return icons[item.itemType] || '📦';
  }

  canEquipItem(item) {
    return item.itemType === 'equipment' || item.itemType === 'weapon';
  }

  async equipItem(itemId) {
    try {
      // Determine slot based on item category
      const item = this.inventory.backpack.items.find(i => i.itemId === itemId);
      if (!item) return;

      let slot = item.itemDetails.category;
      if (item.itemDetails.itemType === 'weapon') {
        slot = 'weapon';
      }

      const response = await fetch(`/api/v1/characters/${this.characterId}/inventory/equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ itemId, slot })
      });

      if (!response.ok) {
        throw new Error('Failed to equip item');
      }

      // Reload inventory
      await this.loadInventory();

    } catch (error) {
      console.error('Error equipping item:', error);
      alert('Failed to equip item. Please try again.');
    }
  }

  async unequipItem(slot) {
    try {
      const response = await fetch(`/api/v1/characters/${this.characterId}/inventory/unequip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ slot })
      });

      if (!response.ok) {
        throw new Error('Failed to unequip item');
      }

      // Reload inventory
      await this.loadInventory();

    } catch (error) {
      console.error('Error unequipping item:', error);
      alert('Failed to unequip item. Please try again.');
    }
  }

  async removeItem(itemId) {
    if (!confirm('Are you sure you want to drop this item?')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/characters/${this.characterId}/inventory/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ itemId, quantity: 1 })
      });

      if (!response.ok) {
        throw new Error('Failed to remove item');
      }

      // Reload inventory
      await this.loadInventory();

    } catch (error) {
      console.error('Error removing item:', error);
      alert('Failed to remove item. Please try again.');
    }
  }

  async transferToShip(itemId, maxQuantity) {
    const quantity = prompt(`How many to transfer to ship? (Max: ${maxQuantity})`, Math.min(maxQuantity, 1));

    if (!quantity || isNaN(quantity) || quantity <= 0) return;

    try {
      const response = await fetch(`/api/v1/characters/${this.characterId}/ship/cargo/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          itemId,
          quantity: parseInt(quantity),
          direction: 'toShip'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to transfer item');
      }

      // Reload inventory
      await this.loadInventory();

    } catch (error) {
      console.error('Error transferring to ship:', error);
      alert(error.message || 'Failed to transfer item to ship. Please try again.');
    }
  }

  async transferToBackpack(itemId, maxQuantity) {
    const quantity = prompt(`How many to transfer to backpack? (Max: ${maxQuantity})`, Math.min(maxQuantity, 1));

    if (!quantity || isNaN(quantity) || quantity <= 0) return;

    try {
      const response = await fetch(`/api/v1/characters/${this.characterId}/ship/cargo/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          itemId,
          quantity: parseInt(quantity),
          direction: 'toBackpack'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to transfer item');
      }

      // Reload inventory
      await this.loadInventory();

    } catch (error) {
      console.error('Error transferring to backpack:', error);
      alert(error.message || 'Failed to transfer item to backpack. Please try again.');
    }
  }

  renderShipFittings() {
    if (!this.inventory.fittings) return;

    const slotTypes = [
      { key: 'highSlots', containerId: 'highSlots', label: 'High Slot' },
      { key: 'midSlots', containerId: 'midSlots', label: 'Mid Slot' },
      { key: 'lowSlots', containerId: 'lowSlots', label: 'Low Slot' },
      { key: 'rigSlots', containerId: 'rigSlots', label: 'Rig Slot' }
    ];

    slotTypes.forEach(({ key, containerId, label }) => {
      const container = document.getElementById(containerId);
      if (!container) return;

      const slots = this.inventory.fittings[key] || [];

      container.innerHTML = slots.map((fitting, index) => {
        if (fitting && fitting.itemDetails) {
          return `
            <div class="fitting-slot filled" data-slot-type="${key}" data-slot-index="${index}">
              <div class="fitting-item">
                <div class="fitting-icon">🔧</div>
                <div class="fitting-info">
                  <div class="fitting-name">${fitting.itemDetails.name}</div>
                  <div class="fitting-stats">${fitting.itemDetails.description || ''}</div>
                </div>
                <button class="fitting-action-btn" onclick="window.inventoryModal.uninstallModule('${key}', ${index})">
                  Uninstall
                </button>
              </div>
            </div>
          `;
        } else {
          return `
            <div class="fitting-slot empty" data-slot-type="${key}" data-slot-index="${index}">
              <span class="slot-empty">Empty ${label}</span>
            </div>
          `;
        }
      }).join('');
    });
  }

  showFittingsModal(itemId) {
    // Show a modal to select fitting slot
    const slotTypes = ['highSlots', 'midSlots', 'lowSlots', 'rigSlots'];
    const slotLabels = ['High Slots (Weapons/Utility)', 'Mid Slots (Shield/Propulsion)', 'Low Slots (Armor/Engineering)', 'Rig Slots (Permanent Mods)'];

    const slotType = prompt(`Select slot type:\n${slotLabels.map((l, i) => `${i + 1}. ${l}`).join('\n')}`);

    if (!slotType || slotType < 1 || slotType > 4) return;

    const selectedSlotType = slotTypes[slotType - 1];
    const maxSlots = this.inventory.fittings[selectedSlotType]?.length || 3;

    const slotIndex = prompt(`Select slot index (0-${maxSlots - 1}):`);

    if (slotIndex === null || isNaN(slotIndex)) return;

    this.installModule(itemId, selectedSlotType, parseInt(slotIndex));
  }

  async installModule(itemId, slotType, slotIndex) {
    try {
      const response = await fetch(`/api/v1/characters/${this.characterId}/ship/fittings/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ itemId, slotType, slotIndex })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to install module');
      }

      const result = await response.json();
      alert(result.message);

      // Reload inventory
      await this.loadInventory();

    } catch (error) {
      console.error('Error installing module:', error);
      alert(error.message || 'Failed to install module. Please try again.');
    }
  }

  async uninstallModule(slotType, slotIndex) {
    try {
      const response = await fetch(`/api/v1/characters/${this.characterId}/ship/fittings/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ slotType, slotIndex })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to uninstall module');
      }

      const result = await response.json();
      alert(result.message);

      // Reload inventory
      await this.loadInventory();

    } catch (error) {
      console.error('Error uninstalling module:', error);
      alert(error.message || 'Failed to uninstall module. Please try again.');
    }
  }

  renderStorehouseLocations() {
    const currentLocationName = document.getElementById('currentLocationName');
    const storageLocationsList = document.getElementById('storageLocationsList');

    // Display current location
    if (this.characterLocation) {
      const locationText = this.characterLocation.zone || 'Deep Space';
      currentLocationName.textContent = locationText;
    } else {
      currentLocationName.textContent = 'Unknown Location';
    }

    // Define available storage locations
    const storageLocations = [
      {
        id: 'home-hub',
        name: this.characterHomeHub?.name || 'Home Hub',
        icon: '🏠',
        type: 'Hub',
        description: 'Your home station',
        isAvailable: true,
        isCurrent: this.characterLocation?.zone === this.characterHomeHub?.name
      },
      {
        id: 'temporal-nexus',
        name: 'Temporal Nexus Station',
        icon: '⧗',
        type: 'Hub',
        description: 'Time String hub',
        isAvailable: this.characterLocation?.zone === 'Temporal Nexus Station',
        isCurrent: this.characterLocation?.zone === 'Temporal Nexus Station'
      },
      {
        id: 'quantum-forge',
        name: 'Quantum Forge Complex',
        icon: '⚙',
        type: 'Hub',
        description: 'Tech String hub',
        isAvailable: this.characterLocation?.zone === 'Quantum Forge Complex',
        isCurrent: this.characterLocation?.zone === 'Quantum Forge Complex'
      },
      {
        id: 'celestial-sanctum',
        name: 'Celestial Sanctum',
        icon: '✦',
        type: 'Hub',
        description: 'Faith String hub',
        isAvailable: this.characterLocation?.zone === 'Celestial Sanctum',
        isCurrent: this.characterLocation?.zone === 'Celestial Sanctum'
      },
      {
        id: 'crimson-bastion',
        name: 'Crimson Bastion',
        icon: '⚔',
        type: 'Hub',
        description: 'War String hub',
        isAvailable: this.characterLocation?.zone === 'Crimson Bastion',
        isCurrent: this.characterLocation?.zone === 'Crimson Bastion'
      }
    ];

    // Render storage locations
    storageLocationsList.innerHTML = storageLocations.map(location => {
      const statusClass = location.isCurrent ? 'current' : (location.isAvailable ? 'available' : 'unavailable');
      const statusText = location.isCurrent ? '📍 You are here' : (location.isAvailable ? '✓ Available' : '🔒 Not at location');

      return `
        <div class="storage-location ${statusClass}" data-location-id="${location.id}">
          <div class="location-header">
            <span class="location-icon">${location.icon}</span>
            <div class="location-details">
              <div class="location-name">${location.name}</div>
              <div class="location-type">${location.type}</div>
            </div>
          </div>
          <div class="location-description">${location.description}</div>
          <div class="location-status ${statusClass}">${statusText}</div>
          ${location.isAvailable && !location.isCurrent ? `
            <button class="location-action-btn" onclick="window.inventoryModal.selectStorageLocation('${location.id}')">
              View Storage
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  selectStorageLocation(locationId) {
    console.log('Selected storage location:', locationId);
    // TODO: Load storehouse items for this location
    alert(`Storage location selected: ${locationId}\nStorehouse functionality coming soon!`);
  }
}

// Initialize global inventory modal
window.addEventListener('DOMContentLoaded', () => {
  window.inventoryModal = new InventoryModal();
});
