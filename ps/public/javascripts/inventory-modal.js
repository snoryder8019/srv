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
              🚀 Ship Cargo
            </button>
            <button class="inventory-tab" data-tab="storehouse">
              🏪 Storehouse
            </button>
          </div>

          <!-- Content Area -->
          <div class="inventory-body">
            <!-- Left: Equipment Paper Doll -->
            <div class="equipment-panel">
              <h3>Equipment</h3>
              <div class="equipment-slots">
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

    // Update panel title
    const titles = {
      backpack: 'Backpack',
      ship: 'Ship Cargo',
      storehouse: 'Storehouse'
    };
    document.getElementById('inventoryPanelTitle').textContent = titles[tab];

    // Render appropriate content
    this.renderInventoryPanel();
  }

  async loadInventory() {
    const loading = document.getElementById('inventoryLoading');
    const grid = document.getElementById('inventoryGrid');

    loading.style.display = 'flex';
    grid.style.display = 'none';

    try {
      const response = await fetch(`/api/v1/characters/${this.characterId}/inventory`, {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Failed to load inventory');
      }

      this.inventory = await response.json();

      loading.style.display = 'none';
      grid.style.display = 'grid';

      this.renderEquipment();
      this.renderInventoryPanel();

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
              <button class="item-action-btn danger" onclick="window.inventoryModal.removeItem('${item.itemId}')">
                Drop
              </button>
            </div>
          </div>
        `;
      }).join('');

    } else if (this.activeTab === 'ship') {
      grid.innerHTML = '<div class="inventory-empty-message">Ship cargo coming soon</div>';
      capacityEl.textContent = '0/200';
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
}

// Initialize global inventory modal
window.addEventListener('DOMContentLoaded', () => {
  window.inventoryModal = new InventoryModal();
});
