/**
 * Game State Admin Controls
 * Interface for configuring galactic simulation parameters
 */

const GAME_STATE_URL = 'https://svc.madladslab.com';
let currentConfig = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadCurrentConfig();
  setupEventListeners();
  calculateIntervals();
});

/**
 * Setup event listeners
 */
function setupEventListeners() {
  document.getElementById('saveBtn').addEventListener('click', saveConfiguration);
  document.getElementById('restartBtn').addEventListener('click', restartSimulation);
  document.getElementById('resetBtn').addEventListener('click', resetToDefaults);

  // Update interval calculations on change
  document.getElementById('velocityUnit').addEventListener('change', calculateIntervals);
  document.getElementById('cycleSpeed').addEventListener('change', calculateIntervals);

  // Update total zones on map size change
  document.getElementById('mapWidth').addEventListener('input', calculateTotalZones);
  document.getElementById('mapHeight').addEventListener('input', calculateTotalZones);
}

/**
 * Load current configuration from service
 */
async function loadCurrentConfig() {
  try {
    updateStatus('loading', 'Loading configuration...');
    const response = await fetch(`${GAME_STATE_URL}/api/config`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      currentConfig = data.config;
      populateForm(currentConfig);
      displayCurrentConfig(currentConfig);
      updateStatus('connected', 'Connected to Game State Service');
      addLog('Configuration loaded successfully', 'success');
    }
  } catch (error) {
    console.error('Error loading config:', error);
    updateStatus('error', 'Connection Failed');
    addLog(`Error: ${error.message}`, 'error');
  }
}

/**
 * Populate form with current config
 */
function populateForm(config) {
  document.getElementById('mapWidth').value = config.mapSize.width;
  document.getElementById('mapHeight').value = config.mapSize.height;
  document.getElementById('velocityUnit').value = config.timing.velocityUnit;
  document.getElementById('cycleSpeed').value = config.timing.cycleSpeed;
  document.getElementById('resourceGrowth').value = config.simulation.resourceGrowthRate;
  document.getElementById('discoveryRate').value = config.simulation.discoveryRate;
  document.getElementById('conflictProb').value = config.simulation.conflictProbability;
  document.getElementById('initialZones').value = config.simulation.initialZones;

  calculateTotalZones();
  calculateIntervals();
}

/**
 * Display current configuration
 */
function displayCurrentConfig(config) {
  const grid = document.getElementById('currentConfig');

  grid.innerHTML = `
    <div class="config-card">
      <div class="config-label">Map Size</div>
      <div class="config-value">${config.mapSize.width} x ${config.mapSize.height}</div>
    </div>
    <div class="config-card">
      <div class="config-label">Total Zones</div>
      <div class="config-value">${formatNumber(config.mapSize.totalZones)}</div>
    </div>
    <div class="config-card">
      <div class="config-label">Time Unit</div>
      <div class="config-value">${config.timing.velocityUnit}</div>
    </div>
    <div class="config-card">
      <div class="config-label">Cycle Speed</div>
      <div class="config-value">${config.timing.cycleSpeed}x</div>
    </div>
    <div class="config-card">
      <div class="config-label">Update Interval</div>
      <div class="config-value">${formatInterval(config.timing.updateInterval)}</div>
    </div>
    <div class="config-card">
      <div class="config-label">Event Interval</div>
      <div class="config-value">${formatInterval(config.timing.eventInterval)}</div>
    </div>
  `;
}

/**
 * Save configuration
 */
async function saveConfiguration() {
  try {
    updateStatus('loading', 'Saving configuration...');

    const newConfig = {
      timing: {
        velocityUnit: document.getElementById('velocityUnit').value,
        cycleSpeed: parseFloat(document.getElementById('cycleSpeed').value)
      },
      mapSize: {
        width: parseInt(document.getElementById('mapWidth').value),
        height: parseInt(document.getElementById('mapHeight').value)
      },
      simulation: {
        resourceGrowthRate: parseFloat(document.getElementById('resourceGrowth').value),
        discoveryRate: parseFloat(document.getElementById('discoveryRate').value),
        conflictProbability: parseFloat(document.getElementById('conflictProb').value),
        initialZones: parseInt(document.getElementById('initialZones').value)
      }
    };

    addLog('Sending configuration update...', 'info');

    const response = await fetch(`${GAME_STATE_URL}/api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newConfig)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      currentConfig = data.config;
      displayCurrentConfig(currentConfig);
      updateStatus('connected', 'Configuration Updated');
      addLog('✓ Configuration saved and simulation restarted', 'success');
    }
  } catch (error) {
    console.error('Error saving config:', error);
    updateStatus('error', 'Save Failed');
    addLog(`Error: ${error.message}`, 'error');
  }
}

/**
 * Restart simulation
 */
async function restartSimulation() {
  try {
    updateStatus('loading', 'Restarting simulation...');
    addLog('Sending restart command...', 'info');

    const response = await fetch(`${GAME_STATE_URL}/api/restart`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      updateStatus('connected', 'Simulation Restarted');
      addLog('✓ Simulation restarted successfully', 'success');
    }
  } catch (error) {
    console.error('Error restarting:', error);
    updateStatus('error', 'Restart Failed');
    addLog(`Error: ${error.message}`, 'error');
  }
}

/**
 * Reset to default configuration
 */
function resetToDefaults() {
  document.getElementById('mapWidth').value = 1000;
  document.getElementById('mapHeight').value = 1000;
  document.getElementById('velocityUnit').value = 'seconds';
  document.getElementById('cycleSpeed').value = 1;
  document.getElementById('resourceGrowth').value = 1.0;
  document.getElementById('discoveryRate').value = 0.7;
  document.getElementById('conflictProb').value = 0.3;
  document.getElementById('initialZones').value = 500;

  calculateTotalZones();
  calculateIntervals();
  addLog('Form reset to default values', 'info');
}

/**
 * Calculate total zones
 */
function calculateTotalZones() {
  const width = parseInt(document.getElementById('mapWidth').value) || 1000;
  const height = parseInt(document.getElementById('mapHeight').value) || 1000;
  const total = width * height;

  document.getElementById('totalZones').textContent = formatNumber(total);
}

/**
 * Calculate and display intervals
 */
function calculateIntervals() {
  const unit = document.getElementById('velocityUnit').value;
  const speed = parseFloat(document.getElementById('cycleSpeed').value) || 1;

  const baseMs = convertToMilliseconds(unit);
  const updateMs = baseMs * speed;
  const eventMs = baseMs * speed * 4;

  document.getElementById('updateInterval').textContent = formatInterval(updateMs);
  document.getElementById('eventInterval').textContent = formatInterval(eventMs);
}

/**
 * Convert time unit to milliseconds
 */
function convertToMilliseconds(unit) {
  switch(unit) {
    case 'seconds':
      return 1000;
    case 'minutes':
      return 60000;
    case 'hours':
      return 3600000;
    case 'days':
      return 86400000;
    default:
      return 1000;
  }
}

/**
 * Format milliseconds to readable string
 */
function formatInterval(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else if (ms < 3600000) {
    return `${(ms / 60000).toFixed(1)}m`;
  } else if (ms < 86400000) {
    return `${(ms / 3600000).toFixed(1)}h`;
  } else {
    return `${(ms / 86400000).toFixed(1)}d`;
  }
}

/**
 * Format large numbers
 */
function formatNumber(num) {
  return new Intl.NumberFormat().format(num);
}

/**
 * Update connection status
 */
function updateStatus(status, message) {
  const statusEl = document.getElementById('connectionStatus');
  const dot = statusEl.querySelector('.dot');
  const text = statusEl.querySelector('.status-text');

  statusEl.className = 'status-card ' + status;
  text.textContent = message;

  switch(status) {
    case 'connected':
      dot.style.backgroundColor = '#10b981';
      break;
    case 'loading':
      dot.style.backgroundColor = '#f59e0b';
      break;
    case 'error':
      dot.style.backgroundColor = '#ef4444';
      break;
  }
}

/**
 * Add log entry
 */
function addLog(message, type = 'info') {
  const logOutput = document.getElementById('logOutput');
  const timestamp = new Date().toLocaleTimeString();

  const entry = document.createElement('p');
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${timestamp}] ${message}`;

  logOutput.insertBefore(entry, logOutput.firstChild);

  // Keep only last 50 entries
  while (logOutput.children.length > 50) {
    logOutput.removeChild(logOutput.lastChild);
  }
}
