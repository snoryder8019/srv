/**
 * Ship Info Pane
 * Displays information about other characters/ships when clicked on the map
 */

class ShipInfoPane {
  constructor(socket) {
    this.socket = socket;
    this.isVisible = false;
    this.currentCharacterId = null;
    this.createPane();
    this.attachSocketListeners();
  }

  createPane() {
    // Create info pane HTML
    const pane = document.createElement('div');
    pane.id = 'ship-info-pane';
    pane.className = 'ship-info-pane hidden';
    pane.innerHTML = `
      <div class="ship-info-header">
        <h3 id="ship-info-title">Ship Information</h3>
        <button class="ship-info-close" onclick="shipInfoPane.hide()">&times;</button>
      </div>
      <div class="ship-info-body">
        <div id="ship-info-loading" class="ship-info-loading">
          <div class="spinner"></div>
          <p>Loading ship data...</p>
        </div>
        <div id="ship-info-content" class="ship-info-content hidden">
          <div class="ship-info-section">
            <h4>Character</h4>
            <div class="info-row">
              <span class="info-label">Name:</span>
              <span id="ship-char-name" class="info-value">--</span>
            </div>
            <div class="info-row">
              <span class="info-label">Level:</span>
              <span id="ship-char-level" class="info-value">--</span>
            </div>
            <div class="info-row">
              <span class="info-label">Species:</span>
              <span id="ship-char-species" class="info-value">--</span>
            </div>
            <div class="info-row">
              <span class="info-label">Class:</span>
              <span id="ship-char-class" class="info-value">--</span>
            </div>
          </div>

          <div class="ship-info-section">
            <h4>Ship</h4>
            <div class="info-row">
              <span class="info-label">Name:</span>
              <span id="ship-name" class="info-value">--</span>
            </div>
            <div class="info-row">
              <span class="info-label">Class:</span>
              <span id="ship-class" class="info-value">--</span>
            </div>
            <div class="info-row">
              <span class="info-label">Hull:</span>
              <div class="ship-health-bar">
                <div id="ship-hull-bar" class="ship-health-fill" style="width: 100%"></div>
              </div>
              <span id="ship-hull-text" class="info-value-small">--</span>
            </div>
          </div>

          <div class="ship-info-section">
            <h4>Location</h4>
            <div class="info-row">
              <span class="info-label">Position:</span>
              <span id="ship-location" class="info-value">--</span>
            </div>
            <div class="info-row">
              <span class="info-label">Docked:</span>
              <span id="ship-docked" class="info-value">--</span>
            </div>
          </div>

          <div class="ship-info-section">
            <h4>Stats</h4>
            <div class="stat-grid">
              <div class="stat-item">
                <span class="stat-label">STR</span>
                <span id="ship-stat-str" class="stat-value">0</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">INT</span>
                <span id="ship-stat-int" class="stat-value">0</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">AGI</span>
                <span id="ship-stat-agi" class="stat-value">0</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">FAITH</span>
                <span id="ship-stat-faith" class="stat-value">0</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">TECH</span>
                <span id="ship-stat-tech" class="stat-value">0</span>
              </div>
            </div>
          </div>
        </div>
        <div id="ship-info-error" class="ship-info-error hidden">
          <p>Failed to load ship information.</p>
        </div>
      </div>
    `;

    document.body.appendChild(pane);
    this.pane = pane;
  }

  attachSocketListeners() {
    // Listen for character info responses
    this.socket.on('characterInfo', (data) => {
      if (data.error) {
        this.showError(data.error);
      } else {
        this.displayInfo(data);
      }
    });
  }

  show(characterId) {
    if (this.currentCharacterId === characterId && this.isVisible) {
      // Already showing this character, just return
      return;
    }

    this.currentCharacterId = characterId;
    this.isVisible = true;
    this.pane.classList.remove('hidden');

    // Show loading state
    document.getElementById('ship-info-loading').classList.remove('hidden');
    document.getElementById('ship-info-content').classList.add('hidden');
    document.getElementById('ship-info-error').classList.add('hidden');

    // Request character info via socket
    this.socket.emit('requestCharacterInfo', { characterId });
  }

  hide() {
    this.isVisible = false;
    this.pane.classList.add('hidden');
    this.currentCharacterId = null;
  }

  displayInfo(data) {
    // Hide loading, show content
    document.getElementById('ship-info-loading').classList.add('hidden');
    document.getElementById('ship-info-content').classList.remove('hidden');

    // Character info
    document.getElementById('ship-char-name').textContent = data.name || 'Unknown';
    document.getElementById('ship-char-level').textContent = data.level || 1;
    document.getElementById('ship-char-species').textContent = data.species || 'Unknown';
    document.getElementById('ship-char-class').textContent = data.primaryClass || 'Adventurer';

    // Ship info
    document.getElementById('ship-name').textContent = data.ship?.name || 'Unknown Vessel';
    document.getElementById('ship-class').textContent = data.ship?.class || 'Unknown Class';

    // Hull health
    if (data.ship?.hull) {
      const hullPercent = (data.ship.hull.currentHP / data.ship.hull.maxHP) * 100;
      document.getElementById('ship-hull-bar').style.width = `${hullPercent}%`;
      document.getElementById('ship-hull-text').textContent =
        `${data.ship.hull.currentHP} / ${data.ship.hull.maxHP}`;

      // Color based on health
      const hullBar = document.getElementById('ship-hull-bar');
      if (hullPercent > 66) {
        hullBar.style.backgroundColor = '#10b981';
      } else if (hullPercent > 33) {
        hullBar.style.backgroundColor = '#f59e0b';
      } else {
        hullBar.style.backgroundColor = '#ef4444';
      }
    }

    // Location
    if (data.location) {
      document.getElementById('ship-location').textContent =
        `(${Math.round(data.location.x)}, ${Math.round(data.location.y)})`;
      document.getElementById('ship-docked').textContent =
        data.location.assetId ? 'Yes' : 'No';
    }

    // Stats
    if (data.stats) {
      document.getElementById('ship-stat-str').textContent = data.stats.strength || 0;
      document.getElementById('ship-stat-int').textContent = data.stats.intelligence || 0;
      document.getElementById('ship-stat-agi').textContent = data.stats.agility || 0;
      document.getElementById('ship-stat-faith').textContent = data.stats.faith || 0;
      document.getElementById('ship-stat-tech').textContent = data.stats.tech || 0;
    }
  }

  showError(error) {
    document.getElementById('ship-info-loading').classList.add('hidden');
    document.getElementById('ship-info-content').classList.add('hidden');
    document.getElementById('ship-info-error').classList.remove('hidden');
    document.getElementById('ship-info-error').querySelector('p').textContent = error;
  }
}

// Global instance (will be initialized when socket is ready)
let shipInfoPane = null;

// Initialize when socket is available
function initShipInfoPane(socket) {
  if (!shipInfoPane) {
    shipInfoPane = new ShipInfoPane(socket);
  }
  return shipInfoPane;
}
