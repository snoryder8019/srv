/**
 * Galactic State Stream Client
 * Consumes SSE from game state microservice
 */

// Use polling instead of SSE for simplicity
const GAME_STATE_URL = 'https://svc.madladslab.com';
let pollingInterval = null;
let eventPollingInterval = null;

// Global filter state
let currentPlanetStatusFilter = 'all';
let currentZoneTypeFilter = 'all';
let cachedOrbitals = [];
let cachedPlanets = [];
let cachedExplorableZones = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Use polling instead of SSE
  startPolling();
  startEventPolling();

  // Fetch orbital systems and zones
  fetchOrbitalSystems();
  fetchZones();
  fetchExplorableZones();

  // Setup status filter buttons
  setupPlanetStatusFilters();
  setupZoneTypeFilters();

  // Refresh orbital/zones every 30 seconds
  setInterval(fetchOrbitalSystems, 30000);
  setInterval(fetchZones, 30000);
  setInterval(fetchExplorableZones, 30000);
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
    // Fetch both approved and submitted assets
    const [approvedResponse, submittedResponse] = await Promise.all([
      fetch('/api/v1/assets/approved/list?limit=100'),
      fetch('/api/v1/assets/community?limit=100')
    ]);

    let allAssets = [];

    if (approvedResponse.ok) {
      const approvedData = await approvedResponse.json();
      if (approvedData.success && approvedData.assets) {
        allAssets = allAssets.concat(approvedData.assets);
      }
    }

    if (submittedResponse.ok) {
      const submittedData = await submittedResponse.json();
      if (submittedData.success && submittedData.assets) {
        allAssets = allAssets.concat(submittedData.assets);
      }
    }

    // Cache the data
    cachedOrbitals = allAssets.filter(a => a.assetType === 'orbital');
    cachedPlanets = allAssets.filter(a => a.assetType === 'planet');

    // Display with current filter
    displayFilteredOrbitalSystems();

  } catch (error) {
    console.error('Error fetching orbital systems:', error);
  }
}

/**
 * Display planetary systems with their orbiting orbitals
 */
function displayOrbitalSystems(orbitals, planets) {
  const container = document.getElementById('orbitalSystems');

  if (!planets || planets.length === 0) {
    container.innerHTML = '<p class="no-data">No planetary systems found</p>';
    return;
  }

  container.innerHTML = planets.map(planet => {
    // Find orbitals that orbit this planet
    const planetOrbitals = orbitals.filter(o => o.planetId === planet._id);

    // Calculate vote display
    const netVotes = planet.votes || 0;
    const upvotes = planet.upvotes || 0;
    const downvotes = planet.downvotes || 0;
    const statusBadge = planet.status === 'approved'
      ? '<span style="background: #10b981; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; margin-left: 0.5rem;">✅ LIVE</span>'
      : '<span style="background: #f59e0b; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; margin-left: 0.5rem;">🚧 IN DEV</span>';

    // Check if user has voted
    const hasVoted = window.USER_ID && planet.voters && planet.voters.some(v => v.userId === window.USER_ID);

    return `
      <div class="orbital-card">
        <div class="orbital-header">
          <h3>${getPlanetIcon(planet.subType)} ${planet.title}${statusBadge}</h3>
          <span class="orbital-type">${(planet.subType || 'planet').replace('_', ' ')}</span>
        </div>
        <p class="orbital-description">${planet.description || ''}</p>

        ${planet.stats ? `
          <div class="planet-stats-display">
            ${planet.stats.temperature !== undefined ? `<span>🌡️ ${planet.stats.temperature}°C</span>` : ''}
            ${planet.stats.gravity !== undefined ? `<span>⚖️ ${planet.stats.gravity}g</span>` : ''}
            ${planet.stats.atmosphere !== undefined ? `<span>💨 ${planet.stats.atmosphere}</span>` : ''}
            ${planet.stats.resources !== undefined ? `<span>💎 ${planet.stats.resources} resources</span>` : ''}
          </div>
        ` : ''}

        ${planetOrbitals.length > 0 ? `
          <div class="planets-list">
            <h4>Orbiting Stations (${planetOrbitals.length})</h4>
            ${planetOrbitals.map(orbital => {
              const orbitalNetVotes = orbital.votes || 0;
              const orbitalUpvotes = orbital.upvotes || 0;
              const orbitalDownvotes = orbital.downvotes || 0;
              const orbitalHasVoted = window.USER_ID && orbital.voters && orbital.voters.some(v => v.userId === window.USER_ID);
              const orbitalStatusBadge = orbital.status === 'approved'
                ? '<span style="background: #10b981; color: white; padding: 0.2rem 0.4rem; border-radius: 3px; font-size: 0.7rem; font-weight: 600; margin-left: 0.25rem;">✅</span>'
                : '<span style="background: #f59e0b; color: white; padding: 0.2rem 0.4rem; border-radius: 3px; font-size: 0.7rem; font-weight: 600; margin-left: 0.25rem;">🚧</span>';

              return `
              <div class="planet-item">
                <div class="planet-icon">🛰️</div>
                <div class="planet-info">
                  <div class="planet-name">${orbital.title}${orbitalStatusBadge}</div>
                  <div class="planet-type">${(orbital.subType || 'orbital').replace('-', ' ')}</div>
                  ${orbital.stats ? `
                    <div class="planet-stats">
                      ${orbital.stats.capacity ? `<span>👥 ${orbital.stats.capacity} capacity</span>` : ''}
                      ${orbital.stats.dockingBays ? `<span>🚀 ${orbital.stats.dockingBays} bays</span>` : ''}
                      ${orbital.stats.defenseRating ? `<span>🛡️ ${orbital.stats.defenseRating} defense</span>` : ''}
                    </div>
                  ` : ''}
                  <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem;">
                    <span style="color: ${orbitalNetVotes >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600; font-size: 0.875rem;">
                      ${orbitalNetVotes >= 0 ? '▲' : '▼'} ${Math.abs(orbitalNetVotes)}
                      <span style="font-size: 0.7rem; color: #888;">(${orbitalUpvotes}↑ ${orbitalDownvotes}↓)</span>
                    </span>
                    ${createVoteButtons(orbital._id, orbitalHasVoted, 'small')}
                  </div>
                </div>
                ${orbital.zoneName ? `<a href="/zones/${orbital.zoneName}" class="explore-btn">Explore</a>` : ''}
              </div>
              `;
            }).join('')}
          </div>
        ` : '<p class="no-planets">No orbital stations in orbit</p>'}

        <div class="orbital-footer">
          <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
            <span style="color: ${netVotes >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">
              ${netVotes >= 0 ? '▲' : '▼'} ${Math.abs(netVotes)} votes
              <span style="font-size: 0.75rem; color: #888;">(${upvotes}↑ ${downvotes}↓)</span>
            </span>
            ${createVoteButtons(planet._id, hasVoted)}
            ${planet.zoneName ? `<a href="/zones/${planet.zoneName}" class="explore-btn" data-planet-type="${planet.subType || 'planet'}">Visit Planet</a>` : ''}
          </div>
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
 * Create vote buttons for an asset
 */
function createVoteButtons(assetId, hasVoted, size = 'normal') {
  if (!window.USER_ID) {
    return '';
  }

  const buttonStyle = size === 'small'
    ? 'padding: 0.25rem 0.5rem; font-size: 0.75rem;'
    : 'padding: 0.5rem 1rem; font-size: 0.875rem;';

  if (hasVoted) {
    return `<div style="display: flex; gap: 0.25rem; opacity: 0.5;">
      <button disabled style="${buttonStyle} background: #10b981; color: white; border: none; border-radius: 4px; cursor: not-allowed;">▲ Voted</button>
      <button disabled style="${buttonStyle} background: #ef4444; color: white; border: none; border-radius: 4px; cursor: not-allowed;">▼</button>
    </div>`;
  }

  return `<div style="display: flex; gap: 0.25rem;">
    <button onclick="voteOnAsset('${assetId}', 1)" style="${buttonStyle} background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">▲</button>
    <button onclick="voteOnAsset('${assetId}', -1)" style="${buttonStyle} background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">▼</button>
  </div>`;
}

/**
 * Vote on an asset (planet or orbital)
 */
async function voteOnAsset(assetId, voteType) {
  if (!window.USER_ID) {
    alert('Please log in to vote');
    return;
  }

  try {
    const response = await fetch(`/api/v1/assets/${assetId}/vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        userId: window.USER_ID,
        voteType: voteType
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to vote');
    }

    // Show success message
    const voteLabel = voteType === 1 ? 'Upvoted' : 'Downvoted';
    showNotification(`${voteLabel} successfully!`, 'success');

    // Reload the galactic state to show updated votes
    location.reload();

  } catch (error) {
    console.error('Error voting:', error);
    alert(error.message || 'Failed to vote. Please try again.');
  }
}

/**
 * Show notification message
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    background: ${type === 'success' ? '#10b981' : '#ef4444'};
    color: white;
    border-radius: 8px;
    font-weight: 600;
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
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

/**
 * Setup planet status filter buttons
 */
function setupPlanetStatusFilters() {
  const filterButtons = document.querySelectorAll('.planet-status-filter');

  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Update active state
      filterButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      // Update filter and redisplay
      currentPlanetStatusFilter = button.dataset.status;
      displayFilteredOrbitalSystems();
    });
  });
}

/**
 * Display orbital systems with current filter applied
 */
function displayFilteredOrbitalSystems() {
  let filteredPlanets = cachedPlanets;
  let filteredOrbitals = cachedOrbitals;

  // Apply status filter
  if (currentPlanetStatusFilter !== 'all') {
    filteredPlanets = filteredPlanets.filter(p => p.status === currentPlanetStatusFilter);
    filteredOrbitals = filteredOrbitals.filter(o => o.status === currentPlanetStatusFilter);
  }

  displayOrbitalSystems(filteredOrbitals, filteredPlanets);
}

/**
 * Fetch all explorable zones from assets
 */
async function fetchExplorableZones() {
  try {
    // Fetch both approved and submitted assets that have zoneName
    const [approvedResponse, submittedResponse] = await Promise.all([
      fetch('/api/v1/assets/approved/list?limit=200'),
      fetch('/api/v1/assets/community?limit=200')
    ]);

    let allZones = [];

    if (approvedResponse.ok) {
      const approvedData = await approvedResponse.json();
      if (approvedData.success && approvedData.assets) {
        allZones = allZones.concat(
          approvedData.assets.filter(asset => asset.zoneName)
        );
      }
    }

    if (submittedResponse.ok) {
      const submittedData = await submittedResponse.json();
      if (submittedData.success && submittedData.assets) {
        allZones = allZones.concat(
          submittedData.assets.filter(asset => asset.zoneName)
        );
      }
    }

    // Cache the zones
    cachedExplorableZones = allZones;

    // Display with current filter
    displayFilteredExplorableZones();

  } catch (error) {
    console.error('Error fetching explorable zones:', error);
  }
}

/**
 * Setup zone type filter buttons
 */
function setupZoneTypeFilters() {
  const filterButtons = document.querySelectorAll('.zone-type-filter');

  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Update active state
      filterButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      // Update filter and redisplay
      currentZoneTypeFilter = button.dataset.zoneType;
      displayFilteredExplorableZones();
    });
  });
}

/**
 * Display explorable zones with current filter applied
 */
function displayFilteredExplorableZones() {
  let filteredZones = cachedExplorableZones;

  // Apply zone type filter
  if (currentZoneTypeFilter !== 'all') {
    filteredZones = filteredZones.filter(z => z.assetType === currentZoneTypeFilter);
  }

  displayExplorableZones(filteredZones);
}

/**
 * Display explorable zones in grid
 */
function displayExplorableZones(zones) {
  const container = document.getElementById('explorableZonesGrid');

  if (!zones || zones.length === 0) {
    container.innerHTML = '<p style="color: #888; text-align: center; padding: 2rem; grid-column: 1/-1;">No explorable zones found</p>';
    return;
  }

  container.innerHTML = zones.map(zone => {
    const netVotes = zone.votes || 0;
    const upvotes = zone.upvotes || 0;
    const downvotes = zone.downvotes || 0;
    const statusBadge = zone.status === 'approved'
      ? '<span style="background: #10b981; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">✅ LIVE</span>'
      : '<span style="background: #f59e0b; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">🚧 IN DEV</span>';

    const icon = getZoneIcon(zone.assetType, zone.subType);
    const zoneLink = zone.zoneName ? `/zones/${zone.zoneName}` : `/zones/explore/planetary?asset=${zone._id}`;

    return `
      <div style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 1.5rem; transition: all 0.3s;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 2rem;">${icon}</span>
            <div>
              <h3 style="margin: 0; font-size: 1.125rem; color: white;">${zone.title}</h3>
              <span style="color: #888; font-size: 0.875rem;">${getAssetTypeLabel(zone.assetType)}</span>
            </div>
          </div>
          ${statusBadge}
        </div>

        <p style="color: #ccc; font-size: 0.875rem; margin-bottom: 1rem; line-height: 1.5;">${zone.description || 'No description available'}</p>

        ${zone.stats ? `
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; margin-bottom: 1rem; padding: 0.75rem; background: rgba(0, 0, 0, 0.2); border-radius: 8px;">
            ${zone.stats.temperature !== undefined ? `<div style="font-size: 0.75rem;"><span style="color: #888;">🌡️</span> ${zone.stats.temperature}°C</div>` : ''}
            ${zone.stats.gravity !== undefined ? `<div style="font-size: 0.75rem;"><span style="color: #888;">⚖️</span> ${zone.stats.gravity}g</div>` : ''}
            ${zone.stats.atmosphere !== undefined ? `<div style="font-size: 0.75rem;"><span style="color: #888;">💨</span> ${zone.stats.atmosphere}</div>` : ''}
            ${zone.stats.capacity !== undefined ? `<div style="font-size: 0.75rem;"><span style="color: #888;">👥</span> ${zone.stats.capacity}</div>` : ''}
            ${zone.stats.dockingBays !== undefined ? `<div style="font-size: 0.75rem;"><span style="color: #888;">🚀</span> ${zone.stats.dockingBays} bays</div>` : ''}
            ${zone.stats.defenseRating !== undefined ? `<div style="font-size: 0.75rem;"><span style="color: #888;">🛡️</span> ${zone.stats.defenseRating}</div>` : ''}
          </div>
        ` : ''}

        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.1);">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="color: ${netVotes >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600; font-size: 0.875rem;">
              ${netVotes >= 0 ? '▲' : '▼'} ${Math.abs(netVotes)}
              <span style="font-size: 0.7rem; color: #888;">(${upvotes}↑ ${downvotes}↓)</span>
            </span>
          </div>
          <a href="${zoneLink}" style="padding: 0.5rem 1rem; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 0.875rem; transition: all 0.2s;">
            Explore →
          </a>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Get zone icon based on asset type and subtype
 */
function getZoneIcon(assetType, subType) {
  if (assetType === 'planet') {
    const planetIcons = {
      'terrestrial': '🌍',
      'gas_giant': '🪐',
      'ice_world': '❄️',
      'volcanic': '🌋',
      'ocean_world': '🌊',
      'desert': '🏜️',
      'jungle': '🌴',
      'barren': '🌑'
    };
    return planetIcons[subType] || '🌑';
  }

  if (assetType === 'orbital') {
    const orbitalIcons = {
      'trading-station': '🏪',
      'military-station': '⚔️',
      'research-station': '🔬',
      'mining-station': '⛏️',
      'habitat-station': '🏘️',
      'refueling-station': '⛽',
      'shipyard': '🏭',
      'satellite': '🛰️'
    };
    return orbitalIcons[subType] || '🛰️';
  }

  const typeIcons = {
    'environment': '🌌',
    'zone': '📍',
    'structure': '🏗️',
    'ship': '🚀'
  };

  return typeIcons[assetType] || '📍';
}

/**
 * Get readable label for asset type
 */
function getAssetTypeLabel(assetType) {
  const labels = {
    'planet': 'Planet',
    'orbital': 'Orbital Station',
    'environment': 'Environment',
    'zone': 'Zone',
    'structure': 'Structure',
    'ship': 'Ship'
  };
  return labels[assetType] || assetType.charAt(0).toUpperCase() + assetType.slice(1);
}
