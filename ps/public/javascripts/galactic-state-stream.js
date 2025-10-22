/**
 * Galactic State Stream Client
 * Consumes SSE from game state microservice
 */

// Use polling instead of SSE for simplicity
const GAME_STATE_URL = 'https://svc.madladslab.com';
let pollingInterval = null;
let eventPollingInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Use polling instead of SSE
  startPolling();
  startEventPolling();

  // Fetch orbital systems and zones
  fetchOrbitalSystems();
  fetchZones();

  // Refresh orbital/zones every 30 seconds
  setInterval(fetchOrbitalSystems, 30000);
  setInterval(fetchZones, 30000);
});

/**
 * Start polling for state updates
 */
function startPolling() {
  updateConnectionStatus('connecting');

  // Initial fetch
  fetchState();

  // Poll every 5 seconds
  pollingInterval = setInterval(fetchState, 5000);
}

/**
 * Fetch current state
 */
async function fetchState() {
  try {
    console.log('Fetching state from:', `${GAME_STATE_URL}/api/state`);
    const response = await fetch(`${GAME_STATE_URL}/api/state`);

    console.log('Response status:', response.status, response.ok);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('Data received:', data);

    if (data.success && data.state) {
      updateConnectionStatus('connected');
      updateGalacticState(data.state.galactic);
      updateFactions(data.state.factions);
      updateResources(data.state.resources);
      console.log('State updated successfully');
    } else {
      console.error('Invalid data structure:', data);
      updateConnectionStatus('failed');
    }
  } catch (error) {
    console.error('Error fetching state:', error);
    console.error('Error details:', error.message, error.stack);
    updateConnectionStatus('failed', `Error: ${error.message}`);
  }
}

/**
 * Start polling for events
 */
function startEventPolling() {
  // Initial fetch
  fetchEvents();

  // Poll every 10 seconds
  eventPollingInterval = setInterval(fetchEvents, 10000);
}

/**
 * Fetch current events
 */
async function fetchEvents() {
  try {
    const response = await fetch(`${GAME_STATE_URL}/api/state/events`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.events) {
      displayEvents(data.events);
    }
  } catch (error) {
    console.error('Error fetching events:', error);
  }
}

/**
 * Update connection status UI
 */
function updateConnectionStatus(status, details = '') {
  const statusEl = document.getElementById('connectionStatus');
  const indicator = statusEl.querySelector('.status-indicator');
  const text = statusEl.querySelector('.status-text');

  statusEl.className = `connection-status ${status}`;

  switch (status) {
    case 'connecting':
      indicator.textContent = '🔄';
      text.textContent = 'Connecting to Game State Service...';
      break;
    case 'connected':
      indicator.textContent = '🟢';
      text.textContent = 'Connected - Live Updates Active';
      break;
    case 'disconnected':
      indicator.textContent = '🟡';
      text.textContent = 'Reconnecting...';
      break;
    case 'failed':
      indicator.textContent = '🔴';
      text.textContent = details || 'Connection Failed - Check console (F12) for details';
      break;
  }

  console.log('Connection status updated:', status, details);
}

/**
 * Update galactic state display
 */
function updateGalacticState(galactic) {
  document.getElementById('year').textContent = galactic.year || '---';
  document.getElementById('cycle').textContent = galactic.cycle || '---';
  document.getElementById('season').textContent = galactic.currentSeason || '---';
  document.getElementById('dominant').textContent = galactic.dominantFaction || '---';
  document.getElementById('threat').textContent = galactic.threatLevel || '---';
  document.getElementById('economy').textContent = galactic.economicState || '---';
  document.getElementById('population').textContent = formatNumber(galactic.totalPopulation) || '---';
  document.getElementById('conflicts').textContent = galactic.activeConflicts || '0';
}

/**
 * Update factions display
 */
function updateFactions(factions) {
  const grid = document.getElementById('factionGrid');

  grid.innerHTML = Object.entries(factions).map(([name, data]) => `
    <div class="faction-card">
      <h3>${name}</h3>
      <div class="faction-stats">
        <div class="faction-stat">
          <span class="label">Power</span>
          <div class="progress-bar">
            <div class="progress" style="width: ${data.power}%"></div>
          </div>
          <span class="value">${data.power.toFixed(1)}</span>
        </div>
        <div class="faction-stat">
          <span class="label">Territory</span>
          <div class="progress-bar">
            <div class="progress" style="width: ${data.territory}%"></div>
          </div>
          <span class="value">${data.territory}%</span>
        </div>
        <div class="faction-stat">
          <span class="label">Influence</span>
          <div class="progress-bar">
            <div class="progress" style="width: ${data.influence}%"></div>
          </div>
          <span class="value">${data.influence}%</span>
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Update resources display
 */
function updateResources(resources) {
  const grid = document.getElementById('resourceGrid');

  grid.innerHTML = `
    <div class="resource-card">
      <div class="resource-icon">⚡</div>
      <div class="resource-name">Energy</div>
      <div class="resource-value">${formatNumber(resources.energy)}</div>
    </div>
    <div class="resource-card">
      <div class="resource-icon">⛏️</div>
      <div class="resource-name">Minerals</div>
      <div class="resource-value">${formatNumber(resources.minerals)}</div>
    </div>
    <div class="resource-card">
      <div class="resource-icon">🔬</div>
      <div class="resource-name">Technology</div>
      <div class="resource-value">${formatNumber(resources.technology)}</div>
    </div>
    <div class="resource-card">
      <div class="resource-icon">👥</div>
      <div class="resource-name">Population</div>
      <div class="resource-value">${formatNumber(resources.population)}</div>
    </div>
  `;
}

/**
 * Display events
 */
function displayEvents(events) {
  const feed = document.getElementById('eventsFeed');

  if (!events || events.length === 0) {
    feed.innerHTML = '<p class="no-events">No events yet...</p>';
    return;
  }

  feed.innerHTML = events.map(event => createEventHTML(event)).join('');
}

/**
 * Add new event to feed
 */
function addEvent(event) {
  const feed = document.getElementById('eventsFeed');

  // Remove "no events" message
  const noEvents = feed.querySelector('.no-events');
  if (noEvents) {
    noEvents.remove();
  }

  // Add new event at top
  const eventEl = document.createElement('div');
  eventEl.innerHTML = createEventHTML(event);
  feed.insertBefore(eventEl.firstElementChild, feed.firstChild);

  // Keep only last 20 events
  const events = feed.querySelectorAll('.event-item');
  if (events.length > 20) {
    events[events.length - 1].remove();
  }

  // Animate new event
  const newEvent = feed.firstElementChild;
  newEvent.style.animation = 'slideIn 0.5s ease-out';
}

/**
 * Create event HTML
 */
function createEventHTML(event) {
  const severityClass = event.severity || 'low';
  const timestamp = new Date(event.timestamp).toLocaleTimeString();

  return `
    <div class="event-item severity-${severityClass}">
      <div class="event-header">
        <span class="event-type">${event.type}</span>
        <span class="event-time">${timestamp}</span>
      </div>
      <div class="event-message">${event.message}</div>
    </div>
  `;
}

/**
 * Format large numbers
 */
function formatNumber(num) {
  if (!num) return '0';

  if (num >= 1000000000000) {
    return (num / 1000000000000).toFixed(2) + 'T';
  } else if (num >= 1000000000) {
    return (num / 1000000000).toFixed(2) + 'B';
  } else if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + 'K';
  }

  return num.toString();
}

/**
 * Fetch and display orbital systems with their planets
 */
async function fetchOrbitalSystems() {
  try {
    const response = await fetch('/api/v1/assets/approved/list?limit=100');

    if (!response.ok) return;

    const data = await response.json();

    if (data.success && data.assets) {
      const orbitals = data.assets.filter(a => a.assetType === 'orbital');
      const planets = data.assets.filter(a => a.assetType === 'planet');

      displayOrbitalSystems(orbitals, planets);
    }
  } catch (error) {
    console.error('Error fetching orbital systems:', error);
  }
}

/**
 * Display orbital systems
 */
function displayOrbitalSystems(orbitals, planets) {
  const container = document.getElementById('orbitalSystems');

  if (!orbitals || orbitals.length === 0) {
    container.innerHTML = '<p class="no-data">No orbital bodies found</p>';
    return;
  }

  container.innerHTML = orbitals.map(orbital => {
    const orbitalPlanets = planets.filter(p => p.orbitalId === orbital._id);

    return `
      <div class="orbital-card">
        <div class="orbital-header">
          <h3>🛰️ ${orbital.title}</h3>
          <span class="orbital-type">${orbital.subType || 'Orbital Station'}</span>
        </div>
        <p class="orbital-description">${orbital.description || ''}</p>

        ${orbitalPlanets.length > 0 ? `
          <div class="planets-list">
            <h4>Orbiting Planets (${orbitalPlanets.length})</h4>
            ${orbitalPlanets.map(planet => `
              <div class="planet-item">
                <div class="planet-icon">${getPlanetIcon(planet.subType)}</div>
                <div class="planet-info">
                  <div class="planet-name">${planet.title}</div>
                  <div class="planet-type">${(planet.subType || '').replace('_', ' ')}</div>
                  ${planet.stats ? `
                    <div class="planet-stats">
                      ${planet.stats.temperature !== undefined ? `<span>🌡️ ${planet.stats.temperature}°C</span>` : ''}
                      ${planet.stats.gravity !== undefined ? `<span>⚖️ ${planet.stats.gravity}g</span>` : ''}
                      ${planet.stats.resources !== undefined ? `<span>💎 ${planet.stats.resources} resources</span>` : ''}
                    </div>
                  ` : ''}
                </div>
                <a href="/zones/${planet.zoneName}" class="explore-btn">Explore</a>
              </div>
            `).join('')}
          </div>
        ` : '<p class="no-planets">No planets discovered yet</p>'}

        <div class="orbital-footer">
          <span class="votes">👍 ${orbital.votes || 0} votes</span>
          ${orbital.initialPosition ? `<span class="location">📍 (${orbital.initialPosition.x}, ${orbital.initialPosition.y})</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Get planet icon based on type
 */
function getPlanetIcon(type) {
  const icons = {
    'terrestrial': '🌍',
    'gas_giant': '🪐',
    'ice_world': '❄️',
    'volcanic': '🌋',
    'ocean_world': '🌊'
  };
  return icons[type] || '🌑';
}

/**
 * Fetch and display zone summary
 */
async function fetchZones() {
  try {
    const response = await fetch('/api/v1/zones/summary');

    if (!response.ok) {
      console.warn('Zone summary endpoint not available, skipping...');
      return;
    }

    const data = await response.json();

    if (data.success && data.zones) {
      displayZonesSummary(data.zones);
    }
  } catch (error) {
    console.error('Error fetching zones:', error);
    // Show static summary instead
    displayStaticZonesSummary();
  }
}

/**
 * Display zones summary
 */
function displayZonesSummary(zones) {
  const container = document.getElementById('zonesSummary');

  const byType = {};
  zones.forEach(zone => {
    const type = zone.type || 'unknown';
    if (!byType[type]) {
      byType[type] = [];
    }
    byType[type].push(zone);
  });

  container.innerHTML = `
    <div class="zones-stats">
      <div class="zone-stat">
        <div class="stat-value">${zones.length}</div>
        <div class="stat-label">Total Zones</div>
      </div>
      ${Object.entries(byType).map(([type, typeZones]) => `
        <div class="zone-stat">
          <div class="stat-value">${typeZones.length}</div>
          <div class="stat-label">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
        </div>
      `).join('')}
    </div>
    <div class="zones-link">
      <a href="/zones" class="btn-primary">View All Zones</a>
    </div>
  `;
}

/**
 * Display static zones summary when API is not available
 */
function displayStaticZonesSummary() {
  const container = document.getElementById('zonesSummary');

  container.innerHTML = `
    <div class="zones-stats">
      <div class="zone-stat">
        <div class="stat-value">18</div>
        <div class="stat-label">Total Zones</div>
      </div>
      <div class="zone-stat">
        <div class="stat-value">17</div>
        <div class="stat-label">Planetary</div>
      </div>
      <div class="zone-stat">
        <div class="stat-value">1</div>
        <div class="stat-label">Underground</div>
      </div>
    </div>
    <div class="zones-link">
      <a href="/zones" class="btn-primary">View All Zones</a>
    </div>
  `;
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  if (eventPollingInterval) {
    clearInterval(eventPollingInterval);
  }
});

/**
 * Update convergence and separation metrics
 */
function updateConvergenceSeparation() {
  // Calculate convergence based on faction proximity and alliances
  // This is a simulated calculation - in production would come from game state
  const convergenceLevel = Math.floor(Math.random() * 40) + 30; // 30-70%
  const separationLevel = Math.floor(Math.random() * 40) + 20; // 20-60%

  // Update meters
  const convergenceFill = document.getElementById('convergenceFill');
  const separationFill = document.getElementById('separationFill');
  const convergenceLevelText = document.getElementById('convergenceLevel');
  const separationLevelText = document.getElementById('separationLevel');

  if (convergenceFill) {
    convergenceFill.style.width = convergenceLevel + '%';
  }
  if (separationFill) {
    separationFill.style.width = separationLevel + '%';
  }
  if (convergenceLevelText) {
    convergenceLevelText.textContent = convergenceLevel + '%';
  }
  if (separationLevelText) {
    separationLevelText.textContent = separationLevel + '%';
  }

  // Update individual convergence strengths
  const strengths = ['Low', 'Medium', 'High', 'Critical'];

  const territorialConv = document.getElementById('territorialConvergence');
  const allianceConv = document.getElementById('allianceConvergence');
  const energyConv = document.getElementById('energyConvergence');

  if (territorialConv) {
    territorialConv.textContent = strengths[Math.floor(Math.random() * 3)];
  }
  if (allianceConv) {
    allianceConv.textContent = strengths[Math.floor(Math.random() * 3)];
  }
  if (energyConv) {
    energyConv.textContent = strengths[Math.floor(Math.random() * 4)];
  }

  // Update separation intensities
  const territorialSep = document.getElementById('territorialSeparation');
  const ideologicalSep = document.getElementById('ideologicalSeparation');
  const anomalySep = document.getElementById('anomalySeparation');

  if (territorialSep) {
    territorialSep.textContent = strengths[Math.floor(Math.random() * 3)];
  }
  if (ideologicalSep) {
    ideologicalSep.textContent = strengths[Math.floor(Math.random() * 4)];
  }
  if (anomalySep) {
    anomalySep.textContent = strengths[Math.floor(Math.random() * 3)];
  }
}

// Update convergence/separation on page load and periodically
document.addEventListener('DOMContentLoaded', () => {
  updateConvergenceSeparation();
  setInterval(updateConvergenceSeparation, 10000); // Update every 10 seconds
});
