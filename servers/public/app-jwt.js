const API_BASE = window.location.origin;
let token = localStorage.getItem('servers_token');
let refreshInterval = null;

// Check authentication on page load
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    verifyToken();
  }
});

// Login form handler
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');

  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';
  loginError.style.display = 'none';

  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (data.success) {
      token = data.token;
      localStorage.setItem('servers_token', token);
      showDashboard(data.user);
    } else {
      loginError.textContent = data.error || 'Login failed';
      loginError.style.display = 'block';
    }
  } catch (error) {
    loginError.textContent = 'Connection error. Please try again.';
    loginError.style.display = 'block';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
  }
});

// Verify token
async function verifyToken() {
  try {
    const response = await fetch(`${API_BASE}/api/auth/verify`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (data.success) {
      showDashboard(data.user);
    } else {
      logout();
    }
  } catch (error) {
    logout();
  }
}

// Show dashboard
function showDashboard(user) {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('dashboard').classList.add('active');
  document.getElementById('userInfo').textContent = `Logged in as ${user.username}`;

  loadDashboardData();
  refreshInterval = setInterval(loadDashboardData, 5000);
}

// Load dashboard data
async function loadDashboardData() {
  await Promise.all([
    loadSystemStats(),
    loadServices()
  ]);
}

// Load system stats
async function loadSystemStats() {
  try {
    const response = await fetch(`${API_BASE}/api/system`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (data.success) {
      renderSystemStats(data.system);
    }
  } catch (error) {
    console.error('Error loading system stats:', error);
  }
}

// Render system stats
function renderSystemStats(system) {
  const statsGrid = document.getElementById('systemStats');

  const cpuClass = system.cpuUsagePercent >= 90 ? 'critical' : (system.cpuUsagePercent >= 75 ? 'warning' : 'normal');
  const memClass = system.memUsagePercent >= 90 ? 'critical' : (system.memUsagePercent >= 75 ? 'warning' : 'normal');

  statsGrid.innerHTML = `
    <div class="stat-card">
      <h3>Hostname</h3>
      <div class="stat-value" style="font-size: 20px;">${system.hostname}</div>
      <div class="stat-label">${system.platform}</div>
    </div>

    <div class="stat-card">
      <h3>CPU Usage</h3>
      <div class="stat-value">${system.cpuUsagePercent}%</div>
      <div class="stat-label">${system.cpuCount} cores</div>
    </div>

    <div class="stat-card">
      <h3>Memory Usage</h3>
      <div class="stat-value">${system.memUsagePercent}%</div>
      <div class="stat-label">${system.memUsedMB} MB / ${system.memTotalMB} MB</div>
    </div>

    <div class="stat-card">
      <h3>Disk Usage</h3>
      <div class="stat-value">${system.diskUsage || 'N/A'}</div>
      <div class="stat-label">Root partition</div>
    </div>

    <div class="stat-card">
      <h3>Uptime</h3>
      <div class="stat-value" style="font-size: 20px;">${formatUptime(system.uptime)}</div>
      <div class="stat-label">System uptime</div>
    </div>

    <div class="stat-card">
      <h3>Load Average</h3>
      <div class="stat-value" style="font-size: 18px;">${system.loadAverage.join(', ')}</div>
      <div class="stat-label">1m, 5m, 15m</div>
    </div>
  `;
}

// Load services
async function loadServices() {
  try {
    const response = await fetch(`${API_BASE}/api/services`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (data.success) {
      renderServices(data.services);
    }
  } catch (error) {
    console.error('Error loading services:', error);
  }
}

// Render services
function renderServices(services) {
  const servicesGrid = document.getElementById('servicesGrid');

  servicesGrid.innerHTML = services.map(service => {
    const statusIcon = service.status === 'healthy' ? '✓' : (service.status === 'degraded' ? '⚠' : '✗');
    const statusText = service.tmuxRunning ? `${service.status} (Running)` : `${service.status} (Stopped)`;

    return `
      <div class="service-card">
        <div class="service-status ${service.status}">
          ${statusIcon}
        </div>

        <div class="service-info">
          <div class="service-name">${service.name}</div>
          <div class="service-details">
            <span>Port: ${service.port}</span>
            <span>Status: ${statusText}</span>
            ${service.statusCode ? `<span>HTTP: ${service.statusCode}</span>` : ''}
          </div>
        </div>

        <div class="service-actions">
          ${!service.tmuxRunning ? `
            <button class="btn-action btn-start" onclick="startService('${service.id}', this)">
              Start
            </button>
          ` : `
            <button class="btn-action btn-restart" onclick="restartService('${service.id}', this)">
              Restart
            </button>
            <button class="btn-action btn-stop" onclick="stopService('${service.id}', this)">
              Stop
            </button>
          `}
          <button class="btn-action btn-logs" onclick="showLogs('${service.id}', '${service.name}')">
            Logs
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Service actions
async function startService(serviceId, button) {
  if (!confirm(`Start service ${serviceId}?`)) return;

  button.disabled = true;
  button.textContent = 'Starting...';

  try {
    const response = await fetch(`${API_BASE}/api/services/${serviceId}/start`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (data.success) {
      await loadServices();
    } else {
      alert(`Failed: ${data.error}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Start';
  }
}

async function restartService(serviceId, button) {
  if (!confirm(`Restart service ${serviceId}?`)) return;

  button.disabled = true;
  button.textContent = 'Restarting...';

  try {
    const response = await fetch(`${API_BASE}/api/services/${serviceId}/restart`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (data.success) {
      setTimeout(() => loadServices(), 2000);
    } else {
      alert(`Failed: ${data.error}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Restart';
  }
}

async function stopService(serviceId, button) {
  if (!confirm(`Stop service ${serviceId}?`)) return;

  button.disabled = true;
  button.textContent = 'Stopping...';

  try {
    const response = await fetch(`${API_BASE}/api/services/${serviceId}/stop`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (data.success) {
      await loadServices();
    } else {
      alert(`Failed: ${data.error}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Stop';
  }
}

async function showLogs(serviceId, serviceName) {
  document.getElementById('logsTitle').textContent = `${serviceName} - Logs`;
  document.getElementById('logsContent').textContent = 'Loading logs...';
  document.getElementById('logsModal').classList.add('active');

  try {
    const response = await fetch(`${API_BASE}/api/services/${serviceId}/logs?lines=100`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (data.success) {
      document.getElementById('logsContent').textContent = data.logs || 'No logs available';
    } else {
      document.getElementById('logsContent').textContent = `Error: ${data.error}`;
    }
  } catch (error) {
    document.getElementById('logsContent').textContent = `Error: ${error.message}`;
  }
}

function closeLogsModal() {
  document.getElementById('logsModal').classList.remove('active');
}

// Logout
function logout() {
  localStorage.removeItem('servers_token');
  token = null;

  if (refreshInterval) {
    clearInterval(refreshInterval);
  }

  document.getElementById('dashboard').classList.remove('active');
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('loginForm').reset();
}

// Utilities
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// Close modal on outside click
document.getElementById('logsModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'logsModal') {
    closeLogsModal();
  }
});
