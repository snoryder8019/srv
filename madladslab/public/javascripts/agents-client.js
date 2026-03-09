/**
 * Client-side Socket.io and Tab Management for AI Agents Dashboard
 */

// Global state
let agentSocket = null;
let currentAgentId = null;
let currentTab = 'overview';
let autoScrollLogs = true;

// Initialize Socket.io connection
function initAgentSocket() {
  if (agentSocket) return agentSocket;

  agentSocket = io('/agents', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
  });

  agentSocket.on('connect', () => {
    console.log('[Agents] Socket connected:', agentSocket.id);
    if (currentAgentId) {
      subscribeToAgent(currentAgentId);
    }
  });

  agentSocket.on('disconnect', () => {
    console.log('[Agents] Socket disconnected');
  });

  agentSocket.on('error', (error) => {
    console.error('[Agents] Socket error:', error);
    showNotification('Connection error: ' + error.message, 'error');
  });

  // Real-time event handlers
  agentSocket.on('log:new', handleNewLog);
  agentSocket.on('status:change', handleStatusChange);
  agentSocket.on('memory:update', handleMemoryUpdate);
  agentSocket.on('tuning:update', handleTuningUpdate);
  agentSocket.on('action:new', handleActionNew);
  agentSocket.on('background:tick', handleBackgroundTick);
  agentSocket.on('background:started', handleBackgroundStarted);
  agentSocket.on('background:stopped', handleBackgroundStopped);

  return agentSocket;
}

// Subscribe to specific agent's updates
function subscribeToAgent(agentId) {
  if (!agentSocket) initAgentSocket();

  currentAgentId = agentId;
  agentSocket.emit('subscribe', agentId);

  agentSocket.once('subscribed', (data) => {
    console.log('[Agents] Subscribed to agent:', data.agentId);
  });
}

// Unsubscribe from agent updates
function unsubscribeFromAgent(agentId) {
  if (!agentSocket) return;

  agentSocket.emit('unsubscribe', agentId);
  currentAgentId = null;
}

// ==================== REAL-TIME EVENT HANDLERS ====================

function handleNewLog(data) {
  if (data.agentId !== currentAgentId) return;

  const logsContainer = document.getElementById('logsContent');
  if (!logsContainer) return;

  const logEntry = createLogElement(data.log);
  logsContainer.insertBefore(logEntry, logsContainer.firstChild);

  // Auto-scroll if enabled
  if (autoScrollLogs && currentTab === 'logs') {
    logsContainer.scrollTop = 0;
  }

  // Keep only last 100 logs in DOM
  while (logsContainer.children.length > 100) {
    logsContainer.removeChild(logsContainer.lastChild);
  }
}

function handleStatusChange(data) {
  // Update agent card on the main dashboard
  const card = document.querySelector(`.agent-card[data-agent-id="${data.agentId}"]`);
  if (card) {
    const badge = card.querySelector('.agent-status-badge');
    if (badge) {
      badge.className = `agent-status-badge status-${data.status}`;
      badge.innerHTML = `<span class="status-dot"></span>${data.status}`;
    }
  }

  // Update detail modal if it's showing this agent
  if (data.agentId !== currentAgentId) return;
  const statusBadge = document.querySelector('.agent-detail-status');
  if (statusBadge) {
    statusBadge.className = `agent-detail-status status-${data.status}`;
    statusBadge.innerHTML = `<span class="status-dot"></span>${data.status}`;
  }
}

function handleMemoryUpdate(data) {
  if (data.agentId !== currentAgentId) return;

  console.log('[Agents] Memory update:', data.memoryType, data.data);

  if (currentTab === 'memory') {
    // Reload memory tab
    loadMemoryTab(currentAgentId);
  }
}

function handleTuningUpdate(data) {
  if (data.agentId !== currentAgentId) return;
  console.log('[Agents] Tuning update:', data.tuningData);
  showNotification('Tuning configuration updated', 'success');
}

function handleActionNew(data) {
  if (data.agentId !== currentAgentId) return;
  if (currentTab === 'actions') {
    const list = document.getElementById('actionsList');
    if (list) {
      const emptyState = list.querySelector('.empty-state');
      if (emptyState) list.innerHTML = '';
      list.insertAdjacentHTML('afterbegin', createActionElement(data.action));
    }
  }
  if (data.action.type === 'background') {
    showNotification(`Background finding: ${data.action.title}`, 'info');
  }
}

function setCardBgBadge(agentId, running, runCount) {
  const badge = document.getElementById(`bg-badge-${agentId}`);
  if (!badge) return;
  if (running) {
    badge.style.display = 'inline-flex';
    const ticks = badge.querySelector('.bg-badge-ticks');
    if (ticks) ticks.textContent = runCount ?? 0;
  } else {
    badge.style.display = 'none';
  }
}

function handleBackgroundTick(data) {
  setCardBgBadge(data.agentId, true, data.runCount);
  if (data.agentId !== currentAgentId) return;
  const banner = document.getElementById('permBgBanner');
  if (banner) {
    const tc = banner.querySelector('.bg-tick-count');
    const lr = banner.querySelector('.bg-last-run');
    if (tc) tc.textContent = data.runCount;
    if (lr) lr.textContent = data.lastRun ? new Date(data.lastRun).toLocaleTimeString() : 'never';
  }
}

function handleBackgroundStarted(data) {
  setCardBgBadge(data.agentId, true, 0);
  if (data.agentId !== currentAgentId) return;
  const agentId = data.agentId;
  const banner = document.getElementById('permBgBanner');
  if (banner) {
    banner.className = 'process-banner';
    banner.innerHTML = `
      <span class="status-dot"></span>
      <strong>Background running</strong> &mdash;
      <span class="bg-tick-count">0</span> ticks,
      last: <span class="bg-last-run">never</span>
      <button class="btn-danger btn-xs" style="margin-left:auto" onclick="stopBackground('${agentId}')">Stop</button>
    `;
  }
}

function handleBackgroundStopped(data) {
  setCardBgBadge(data.agentId, false);
  if (data.agentId !== currentAgentId) return;
  const agentId = data.agentId;
  const banner = document.getElementById('permBgBanner');
  if (banner) {
    banner.className = 'process-banner process-banner-idle';
    banner.innerHTML = `
      <span class="status-dot" style="background:#555;animation:none"></span>
      No background process &mdash;
      <button class="btn-primary btn-xs" style="margin-left:auto" onclick="startBackground('${agentId}')">Start</button>
    `;
  }
}

// ==================== TAB MANAGEMENT ====================

function openAgentDetail(agentId) {
  currentAgentId = agentId;
  currentTab = 'overview';

  // Initialize socket connection
  initAgentSocket();
  subscribeToAgent(agentId);

  // Load agent data and show modal
  loadAgentDetail(agentId);
}

function closeAgentDetail() {
  if (currentAgentId) {
    unsubscribeFromAgent(currentAgentId);
  }

  const modal = document.getElementById('agentDetailModal');
  if (modal) {
    modal.classList.remove('active');
  }

  currentAgentId = null;
  currentTab = 'overview';
}

function switchTab(tabName) {
  if (!currentAgentId) return;

  currentTab = tabName;

  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tabName}Tab`)?.classList.add('active');

  // Load tab-specific data
  switch (tabName) {
    case 'overview':
      loadOverviewTab(currentAgentId);
      break;
    case 'tuning':
      loadTuningTab(currentAgentId);
      break;
    case 'logs':
      loadLogsTab(currentAgentId);
      break;
    case 'memory':
      loadMemoryTab(currentAgentId);
      break;
    case 'actions':
      loadActionsTab(currentAgentId);
      break;
    case 'permissions':
      loadPermissionsTab(currentAgentId);
      break;
  }
}

// ==================== TAB LOADERS ====================

async function loadAgentDetail(agentId) {
  try {
    const response = await fetch(`/agents/api/agents/${agentId}`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error);
    }

    const agent = data.agent;

    // Populate modal header
    document.getElementById('detailAgentName').textContent = agent.name;
    document.querySelector('.agent-detail-status').className = `agent-detail-status status-${agent.status}`;
    document.querySelector('.agent-detail-status').innerHTML = `<span class="status-dot"></span>${agent.status}`;

    // Load overview tab by default
    loadOverviewTab(agentId);

    // Show modal
    document.getElementById('agentDetailModal').classList.add('active');
  } catch (error) {
    console.error('Error loading agent detail:', error);
    showNotification('Failed to load agent details', 'error');
  }
}

async function loadOverviewTab(agentId) {
  try {
    const [agentRes, hierarchyRes] = await Promise.all([
      fetch(`/agents/api/agents/${agentId}`),
      fetch('/agents/api/agents/hierarchy')
    ]);
    const data = await agentRes.json();
    const hierarchyData = await hierarchyRes.json();
    if (!data.success) throw new Error(data.error);

    const agent = data.agent;
    const allAgents = hierarchyData.agents || [];
    const directReports = allAgents.filter(a => a.parentAgent && a.parentAgent.toString() === agentId);
    const parent = agent.parentAgent ? allAgents.find(a => a._id === (agent.parentAgent?._id || agent.parentAgent)?.toString?.() || a._id?.toString() === agent.parentAgent?.toString()) : null;

    const tierColors = { apex: '#ff4444', executive: '#ff9900', manager: '#ffcc00', worker: '#888' };
    const tierColor = tierColors[agent.tier] || '#888';

    const container = document.getElementById('overviewTab');

    container.innerHTML = `
      <div class="overview-grid">
        <div class="overview-card">
          <h3>Configuration</h3>
          <div class="overview-item"><strong>Model:</strong> ${agent.model}</div>
          <div class="overview-item"><strong>Provider:</strong> ${agent.provider}</div>
          <div class="overview-item"><strong>Temperature:</strong> ${agent.config.temperature}</div>
          <div class="overview-item"><strong>Max Tokens:</strong> ${agent.config.maxTokens}</div>
          <div class="overview-item"><strong>Context Window:</strong> ${agent.config.contextWindow.toLocaleString()}</div>
        </div>

        <div class="overview-card">
          <h3>Statistics</h3>
          <div class="overview-item"><strong>Total Messages:</strong> ${agent.stats.totalMessages}</div>
          <div class="overview-item"><strong>Total Tokens:</strong> ${agent.stats.totalTokens.toLocaleString()}</div>
          <div class="overview-item"><strong>Last Active:</strong> ${agent.stats.lastActive ? new Date(agent.stats.lastActive).toLocaleString() : 'Never'}</div>
        </div>

        <div class="overview-card hierarchy-card">
          <h3>Hierarchy</h3>
          <div class="overview-item">
            <strong>Tier:</strong>
            <span class="tier-badge" style="background:${tierColor}22;color:${tierColor};border-color:${tierColor}44">${agent.tier || 'worker'}</span>
          </div>
          <div class="overview-item"><strong>Reports to:</strong> ${parent ? escapeHtml(parent.name) : '<span style="color:#555">None (root)</span>'}</div>
          <div class="overview-item"><strong>Direct reports:</strong> ${directReports.length === 0 ? '<span style="color:#555">None</span>' : directReports.map(r => `<span class="report-chip">${escapeHtml(r.name)}</span>`).join(' ')}</div>
        </div>

        <div class="overview-card">
          <h3>Description</h3>
          <p>${agent.description || 'No description provided'}</p>
        </div>

        <div class="overview-card">
          <h3>System Prompt</h3>
          <p class="system-prompt-preview">${agent.config.systemPrompt}</p>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error loading overview:', error);
    showNotification('Failed to load overview', 'error');
  }
}

async function loadTuningTab(agentId) {
  try {
    const agentRes = await fetch(`/agents/api/agents/${agentId}/tuning`);
    const agentData = await agentRes.json();

    if (!agentData.success) throw new Error(agentData.error);

    const tuning = agentData.tuning;

    const container = document.getElementById('tuningTab');

    const bihBot = tuning.bihBot || {};
    const bihBotSection = bihBot.enabled ? `
        <div class="form-section">
          <h3>bih Bot Config</h3>
          <p class="mcp-description">This agent is live in bih chat. Tune its chat presence here.</p>
          <div class="form-row">
            <div class="form-group">
              <label>Display Name</label>
              <input type="text" id="bihDisplayName" name="bihDisplayName" value="${bihBot.displayName || ''}" class="form-control" placeholder="Name shown in bih chat">
            </div>
            <div class="form-group">
              <label>Avatar URL</label>
              <input type="text" id="bihAvatar" name="bihAvatar" value="${bihBot.avatar || ''}" class="form-control" placeholder="/img/avatar.png">
            </div>
          </div>
          <div class="slider-group">
            <label>Response Cooldown: <span id="rateMsValue">${Math.round((bihBot.rateMs || 8000) / 1000)}s</span></label>
            <input type="range" id="bihRateMs" name="bihRateMs" min="3000" max="60000" step="1000" value="${bihBot.rateMs || 8000}" class="slider"
              oninput="document.getElementById('rateMsValue').textContent = Math.round(this.value/1000) + 's'">
            <small style="color:#666">Minimum seconds between this bot's responses (3s – 60s)</small>
          </div>
        </div>
    ` : '';

    container.innerHTML = `
      <form id="tuningForm" class="tuning-form">
        <div class="form-section">
          <h3>System Prompt</h3>
          <textarea id="tuningSystemPrompt" name="systemPrompt" rows="6" class="form-control">${tuning.systemPrompt}</textarea>
          <small>Define how the agent behaves and responds</small>
        </div>

        <div class="form-section">
          <h3>Sampling Parameters</h3>
          <div class="slider-group">
            <label>Temperature: <span id="tempValue">${tuning.config.temperature}</span>
              <span style="color:#555;font-size:0.78rem;font-weight:400"> — randomness (0 = deterministic, 2 = chaotic)</span>
            </label>
            <input type="range" id="tuningTemperature" name="temperature" min="0" max="2" step="0.05" value="${tuning.config.temperature}" class="slider">
          </div>

          <div class="slider-group">
            <label>Top-P: <span id="topPValue">${tuning.config.topP ?? 0.9}</span>
              <span style="color:#555;font-size:0.78rem;font-weight:400"> — nucleus sampling cutoff</span>
            </label>
            <input type="range" id="tuningTopP" name="topP" min="0" max="1" step="0.05" value="${tuning.config.topP ?? 0.9}" class="slider">
          </div>

          <div class="slider-group">
            <label>Top-K: <span id="topKValue">${tuning.config.topK ?? 40}</span>
              <span style="color:#555;font-size:0.78rem;font-weight:400"> — token candidate pool size</span>
            </label>
            <input type="range" id="tuningTopK" name="topK" min="1" max="200" step="1" value="${tuning.config.topK ?? 40}" class="slider">
          </div>

          <div class="slider-group">
            <label>Repeat Penalty: <span id="repeatPenaltyValue">${tuning.config.repeatPenalty ?? 1.1}</span>
              <span style="color:#555;font-size:0.78rem;font-weight:400"> — penalises repeated tokens</span>
            </label>
            <input type="range" id="tuningRepeatPenalty" name="repeatPenalty" min="0.5" max="2" step="0.05" value="${tuning.config.repeatPenalty ?? 1.1}" class="slider">
          </div>

          <div class="form-row" style="margin-top:1rem">
            <div class="form-group">
              <label>Max Tokens</label>
              <input type="number" id="tuningMaxTokens" name="maxTokens" value="${tuning.config.maxTokens}" step="1024" class="form-control">
            </div>
            <div class="form-group">
              <label>Context Window</label>
              <input type="number" id="tuningContextWindow" name="contextWindow" value="${tuning.config.contextWindow}" step="1000" class="form-control">
            </div>
          </div>
        </div>

        <div class="form-section">
          <h3>Personality Sliders</h3>
          <div class="slider-group">
            <label>Creativity: <span id="creativityValue">${tuning.adjustableParams.creativity || 0.5}</span></label>
            <input type="range" id="tuningCreativity" name="creativity" min="0" max="1" step="0.1" value="${tuning.adjustableParams.creativity || 0.5}" class="slider">
          </div>

          <div class="slider-group">
            <label>Verbosity: <span id="verbosityValue">${tuning.adjustableParams.verbosity || 0.5}</span></label>
            <input type="range" id="tuningVerbosity" name="verbosity" min="0" max="1" step="0.1" value="${tuning.adjustableParams.verbosity || 0.5}" class="slider">
          </div>

          <div class="slider-group">
            <label>Formality: <span id="formalityValue">${tuning.adjustableParams.formality || 0.5}</span></label>
            <input type="range" id="tuningFormality" name="formality" min="0" max="1" step="0.1" value="${tuning.adjustableParams.formality || 0.5}" class="slider">
          </div>
        </div>

        ${bihBotSection}

        <div class="form-actions">
          <button type="button" class="btn-secondary" onclick="loadTuningTab('${agentId}')">Reset</button>
          <button type="submit" class="btn-primary">Save Changes</button>
        </div>
      </form>
    `;

    // Setup slider value updates
    setupSliders();

    // Setup form submission
    document.getElementById('tuningForm').addEventListener('submit', (e) => saveTuning(e, agentId));
  } catch (error) {
    console.error('Error loading tuning:', error);
    showNotification('Failed to load tuning configuration', 'error');
  }
}

async function loadLogsTab(agentId) {
  const container = document.getElementById('logsTab');

  container.innerHTML = `
    <div class="logs-header">
      <div class="logs-filters">
        <label><input type="checkbox" id="filterInfo" checked onchange="filterLogs()"> Info</label>
        <label><input type="checkbox" id="filterWarning" checked onchange="filterLogs()"> Warn</label>
        <label><input type="checkbox" id="filterError" checked onchange="filterLogs()"> Error</label>
      </div>
      <div class="logs-controls">
        <label><input type="checkbox" id="autoScroll" ${autoScrollLogs ? 'checked' : ''}> Scroll</label>
        <button class="btn-secondary btn-sm" onclick="clearLogsView()">Clear</button>
        <button class="btn-secondary btn-sm" onclick="loadLogsTab('${agentId}')">↻</button>
      </div>
    </div>
    <div id="logsContent" class="logs-content"></div>
  `;

  document.getElementById('autoScroll').addEventListener('change', (e) => {
    autoScrollLogs = e.target.checked;
  });

  // Load logs via HTTP (reliable primary mechanism)
  // Socket handleNewLog() continues to push new entries in real-time
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/logs`);
    const data = await res.json();
    const logsContent = document.getElementById('logsContent');
    if (!logsContent) return;
    if (data.success && data.logs?.length > 0) {
      logsContent.innerHTML = data.logs.map(log => createLogElement(log).outerHTML).join('');
    } else {
      logsContent.innerHTML = '<p class="empty-state">No logs yet</p>';
    }
  } catch (err) {
    const logsContent = document.getElementById('logsContent');
    if (logsContent) logsContent.innerHTML = `<p class="empty-state" style="color:#ff4444">Load error: ${err.message}</p>`;
  }
}

function filterLogs() {
  const showInfo = document.getElementById('filterInfo')?.checked;
  const showWarn = document.getElementById('filterWarning')?.checked;
  const showError = document.getElementById('filterError')?.checked;
  document.querySelectorAll('#logsContent .log-entry').forEach(el => {
    const isInfo = el.classList.contains('info');
    const isWarn = el.classList.contains('warning');
    const isErr = el.classList.contains('error');
    el.style.display = (isInfo && showInfo) || (isWarn && showWarn) || (isErr && showError) ? '' : 'none';
  });
}

async function loadMemoryTab(agentId) {
  try {
    const [memoryRes, statsRes] = await Promise.all([
      fetch(`/agents/api/agents/${agentId}/memory`),
      fetch(`/agents/api/agents/${agentId}/memory/stats`)
    ]);

    const memoryData = await memoryRes.json();
    const statsData = await statsRes.json();

    if (!memoryData.success) throw new Error(memoryData.error);

    const memory = memoryData.memory;
    const stats = statsData.stats;

    const container = document.getElementById('memoryTab');

    container.innerHTML = `
      <div class="memory-layout">
        <div class="memory-stats">
          <h3>Memory Statistics</h3>
          <div class="stat-card">
            <div class="stat-label">Total Conversations</div>
            <div class="stat-value">${stats.totalConversations}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Knowledge Base Entries</div>
            <div class="stat-value">${stats.knowledgeBaseEntries}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Tokens</div>
            <div class="stat-value">${stats.totalTokens.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Context Usage</div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${stats.contextUsagePercent}%"></div>
            </div>
            <div class="stat-value-small">${stats.contextUsagePercent.toFixed(1)}%</div>
          </div>

          <div class="memory-actions">
            <button class="btn-secondary btn-block" onclick="showAddKnowledge('${agentId}')">Add Knowledge</button>
            <button class="btn-danger btn-block" onclick="clearMemory('${agentId}')">Clear All Memory</button>
          </div>
        </div>

        <div class="memory-content">

          <!-- Thread Summary -->
          <div class="memory-section memory-section-pinned">
            <div class="memory-section-header">
              <h3>Thread Summary</h3>
              <span class="memory-section-hint">High-level summary of this agent's conversation thread</span>
            </div>
            <textarea id="threadSummaryInput" class="memory-textarea" rows="5" placeholder="Paste or write a summary of what this agent has been working on...">${escapeHtml(memory.threadSummary || '')}</textarea>
            <div class="memory-save-row">
              <button class="btn-primary btn-sm" onclick="saveThreadSummary('${agentId}')">Save Summary</button>
            </div>
          </div>

          <!-- Long-term Memory / Notes -->
          <div class="memory-section memory-section-pinned">
            <div class="memory-section-header">
              <h3>Long-term Memory</h3>
              <span class="memory-section-hint">Persistent notes, checklists, and next steps</span>
            </div>
            <textarea id="longTermMemoryInput" class="memory-textarea memory-textarea-tall" rows="10" placeholder="- [ ] Next step\n- [ ] Checklist item\n\nAdd anything you want the agent to remember across sessions...">${escapeHtml(memory.longTermMemory || '')}</textarea>
            <div class="memory-save-row">
              <button class="btn-primary btn-sm" onclick="saveLongTermMemory('${agentId}')">Save Notes</button>
            </div>
          </div>

          <!-- Recent Conversations -->
          <div class="memory-section">
            <h3>Recent Conversations</h3>
            <div class="conversations-list">
              ${memory.conversations.length > 0 ? memory.conversations.map(conv => `
                <div class="conversation-item">
                  <div class="conversation-time">${new Date(conv.timestamp).toLocaleString()}</div>
                  <div class="conversation-user"><strong>User:</strong> ${escapeHtml(conv.userMessage)}</div>
                  <div class="conversation-agent"><strong>Agent:</strong> ${escapeHtml(conv.agentResponse)}</div>
                  <div class="conversation-tokens">${conv.tokenCount} tokens</div>
                </div>
              `).join('') : '<p class="empty-state">No conversations yet</p>'}
            </div>
          </div>

          <!-- Knowledge Base -->
          <div class="memory-section">
            <h3>Knowledge Base</h3>
            <div class="knowledge-list">
              ${memory.knowledgeBase.length > 0 ? memory.knowledgeBase.map(kb => `
                <div class="knowledge-item">
                  <div class="knowledge-header">
                    <span class="knowledge-type">${kb.type}</span>
                    <button class="btn-icon" onclick="deleteKnowledge('${agentId}', '${kb._id}')">×</button>
                  </div>
                  <div class="knowledge-title">${escapeHtml(kb.title)}</div>
                  <div class="knowledge-content">${escapeHtml(kb.content.substring(0, 200))}${kb.content.length > 200 ? '...' : ''}</div>
                  <div class="knowledge-date">${new Date(kb.addedAt).toLocaleString()}</div>
                </div>
              `).join('') : '<p class="empty-state">No knowledge entries yet</p>'}
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error loading memory:', error);
    showNotification('Failed to load memory', 'error');
  }
}

// ==================== HELPER FUNCTIONS ====================

function createLogElement(log) {
  const div = document.createElement('div');
  div.className = `log-entry ${log.level}`;
  div.innerHTML = `
    <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
    <span class="log-level-badge log-badge-${log.level}">${log.level[0].toUpperCase()}</span>
    <span class="log-message">${escapeHtml(log.message)}</span>
  `;
  return div;
}

async function loadActionsTab(agentId) {
  const container = document.getElementById('actionsTab');
  container.innerHTML = '<p class="loading">Loading actions...</p>';

  try {
    const actionsRes = await fetch(`/agents/api/agents/${agentId}/actions?limit=50`);
    const actionsData = await actionsRes.json();

    if (!actionsData.success) throw new Error(actionsData.error);

    const counts = actionsData.actions.reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {});
    const badge = (type) => counts[type] ? ` <span class="filter-count">${counts[type]}</span>` : '';

    container.innerHTML = `
      <div class="actions-header">
        <div class="actions-filters">
          <button class="filter-chip active" onclick="filterActions(this,'all')">All${actionsData.actions.length ? ` <span class="filter-count">${actionsData.actions.length}</span>` : ''}</button>
          <button class="filter-chip" onclick="filterActions(this,'tldr')">TLDR${badge('tldr')}</button>
          <button class="filter-chip" onclick="filterActions(this,'task_list')">Tasks${badge('task_list')}</button>
          <button class="filter-chip" onclick="filterActions(this,'background')">Background${badge('background')}</button>
          <button class="filter-chip" onclick="filterActions(this,'finding')">Findings${badge('finding')}</button>
          <button class="filter-chip" onclick="filterActions(this,'image')">Images${badge('image')}</button>
        </div>
      </div>
      <div id="actionsList" class="actions-list">
        ${actionsData.actions.length > 0
          ? actionsData.actions.map(a => createActionElement(a, agentId)).join('')
          : '<p class="empty-state">No actions yet — chat with the agent or start a background process</p>'}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="empty-state" style="color:#ff4444">Error: ${err.message}</p>`;
  }
}

async function loadPermissionsTab(agentId) {
  const container = document.getElementById('permissionsTab');
  container.innerHTML = '<p class="loading">Loading permissions...</p>';

  try {
    const [bgRes, agentRes, mcpRes, toolsRes, hierarchyRes] = await Promise.all([
      fetch('/agents/api/background/status'),
      fetch(`/agents/api/agents/${agentId}`),
      fetch(`/agents/api/agents/${agentId}/mcp`),
      fetch('/agents/api/mcp/available-tools'),
      fetch('/agents/api/agents/hierarchy')
    ]);

    const bgData = await bgRes.json();
    const agentData = await agentRes.json();
    const mcpData = await mcpRes.json();
    const toolsData = await toolsRes.json();
    const hierarchyData = await hierarchyRes.json();

    if (!agentData.success) throw new Error(agentData.error);

    const bgProc = bgData.processes?.find(p => p.agentId === agentId) || null;
    const agent = agentData.agent;
    const enabledChatTools = mcpData.mcpConfig?.enabledTools || [];
    const enabledBgTools = agent.mcpConfig?.backgroundEnabledTools || [];
    const availableTools = toolsData.tools || [];
    const capabilities = agent.capabilities || [];
    const allowedRoles = agent.bihBot?.allowedRoles || [];
    const allAgents = hierarchyData.agents || [];
    const otherAgents = allAgents.filter(a => a._id !== agentId);

    // Build tool checkboxes by category
    function renderToolGrid(id, enabledList) {
      if (!availableTools.length) return '<p style="color:#555">No tools available</p>';
      const categories = {};
      availableTools.forEach(t => { (categories[t.category || 'other'] = categories[t.category || 'other'] || []).push(t); });
      return `<div class="mcp-tools-grid" id="${id}">` +
        Object.entries(categories).map(([cat, tools]) => `
          <div class="mcp-category">
            <div class="mcp-category-label">${cat}</div>
            ${tools.map(tool => `
              <label class="mcp-tool-checkbox">
                <input type="checkbox" value="${tool.name}" ${enabledList.includes(tool.name) ? 'checked' : ''}>
                <span class="mcp-tool-name">${tool.name}</span>
                <span class="mcp-tool-desc">${tool.description}</span>
              </label>
            `).join('')}
          </div>
        `).join('') + `</div>`;
    }

    container.innerHTML = `
      <div class="permissions-layout">

        <div class="perm-section">
          <h3>Background Process</h3>
          <div class="process-banner ${bgProc ? '' : 'process-banner-idle'}" id="permBgBanner">
            <span class="status-dot" ${!bgProc ? 'style="background:#555;animation:none"' : ''}></span>
            ${bgProc
              ? `<strong>Background running</strong> &mdash; <span class="bg-tick-count">${bgProc.runCount}</span> ticks, last: <span class="bg-last-run">${bgProc.lastRun ? new Date(bgProc.lastRun).toLocaleTimeString() : 'never'}</span>
                 <button class="btn-danger btn-xs" style="margin-left:auto" onclick="stopBackground('${agentId}')">Stop</button>`
              : `No background process
                 <button class="btn-primary btn-xs" style="margin-left:auto" onclick="startBackground('${agentId}')">Start</button>`
            }
          </div>

          <div style="margin-top:1rem">
            <label class="mcp-description" style="display:block;margin-bottom:0.35rem;font-weight:600;color:#aaa">Background Prompt <span style="font-weight:400;color:#555">(what to do each tick — leave blank for generic)</span></label>
            <textarea id="bgPromptInput" rows="5" style="width:100%;background:#111;border:1px solid #2a2a2a;color:#ccc;border-radius:6px;padding:0.5rem 0.65rem;font-size:0.82rem;font-family:monospace;resize:vertical" placeholder="e.g. Check madladslab tmux logs for errors. Verify ports 3000, 3399, 3055 are listening. Report any anomalies as JSON.">${escapeHtml(agent.config?.backgroundPrompt || '')}</textarea>
          </div>

          <div style="margin-top:0.6rem;display:flex;align-items:center;gap:1rem">
            <div style="display:flex;align-items:center;gap:0.5rem">
              <label style="color:#888;font-size:0.82rem">Interval</label>
              <input type="number" id="bgIntervalInput" min="1" max="1440" value="${agent.config?.backgroundInterval || 2}" style="width:70px;background:#111;border:1px solid #2a2a2a;color:#ccc;border-radius:4px;padding:0.3rem 0.5rem;font-size:0.82rem">
              <span style="color:#555;font-size:0.8rem">min</span>
            </div>
            <button class="btn-primary btn-sm" onclick="saveBgConfig('${agentId}')">Save Config</button>
          </div>
        </div>

        <div class="perm-section">
          <h3>Chat MCP Tools</h3>
          <p class="mcp-description">Tools this agent can call during chat sessions</p>
          ${renderToolGrid('permChatToolsGrid', enabledChatTools)}
          <div style="margin-top:0.75rem">
            <button class="btn-primary btn-sm" onclick="saveChatTools('${agentId}')">Save Chat Tools</button>
          </div>
        </div>

        <div class="perm-section">
          <h3>Background MCP Tools</h3>
          <p class="mcp-description">Tools available during background process ticks</p>
          ${renderToolGrid('permBgToolsGrid', enabledBgTools)}
          <div style="margin-top:0.75rem">
            <button class="btn-primary btn-sm" onclick="saveBgTools('${agentId}')">Save Background Tools</button>
          </div>
        </div>

        <div class="perm-section">
          <h3>Capabilities</h3>
          <p class="mcp-description">Tag this agent's abilities — used by bih commands and routing</p>
          <div id="capabilityTags" class="cap-tags-container">
            ${capabilities.map(c => `<span class="cap-tag" data-value="${escapeHtml(c)}">${escapeHtml(c)} <button class="cap-tag-remove" onclick="this.parentElement.remove()">×</button></span>`).join('')}
          </div>
          <div class="cap-input-row" style="margin-top:0.5rem;display:flex;gap:0.5rem">
            <input type="text" id="capInput" class="form-control" placeholder="e.g. code-review" style="flex:1" onkeydown="if(event.key==='Enter'){event.preventDefault();addCapabilityTag(this.value);this.value=''}">
            <button class="btn-secondary btn-sm" onclick="addCapabilityTag(document.getElementById('capInput').value);document.getElementById('capInput').value=''">Add</button>
          </div>
          <div style="margin-top:0.75rem">
            <button class="btn-primary btn-sm" onclick="saveCapabilities('${agentId}')">Save Capabilities</button>
          </div>
        </div>

        <div class="perm-section">
          <h3>Hierarchy</h3>
          <p class="mcp-description">Define this agent's position in the org chart. Manager+ tiers receive team briefings in their background context.</p>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem">
            <div style="flex:1;min-width:140px">
              <label style="color:#888;font-size:0.82rem;display:block;margin-bottom:0.3rem">Tier</label>
              <select id="hierTierSelect" style="width:100%;background:#111;border:1px solid #2a2a2a;color:#ccc;border-radius:4px;padding:0.35rem 0.5rem;font-size:0.82rem">
                ${['worker','manager','executive','apex'].map(t =>
                  `<option value="${t}" ${(agent.tier||'worker')===t?'selected':''}>${t}</option>`
                ).join('')}
              </select>
            </div>
            <div style="flex:2;min-width:180px">
              <label style="color:#888;font-size:0.82rem;display:block;margin-bottom:0.3rem">Reports to</label>
              <select id="hierParentSelect" style="width:100%;background:#111;border:1px solid #2a2a2a;color:#ccc;border-radius:4px;padding:0.35rem 0.5rem;font-size:0.82rem">
                <option value="">— None (root) —</option>
                ${otherAgents.map(a =>
                  `<option value="${a._id}" ${(agent.parentAgent?._id||agent.parentAgent)===a._id?'selected':''}>${escapeHtml(a.name)} [${a.tier||'worker'}]</option>`
                ).join('')}
              </select>
            </div>
          </div>
          <button class="btn-primary btn-sm" onclick="saveHierarchy('${agentId}')">Save Hierarchy</button>
        </div>

        ${agent.bihBot?.enabled ? `
        <div class="perm-section">
          <h3>bih Bot — Chat Mode</h3>
          <p class="mcp-description">Controls how this agent behaves in bih chat. In <strong>agent</strong> mode, enabled Chat MCP Tools above become active for @-mentions.</p>
          <div class="chat-mode-options">
            <label class="chat-mode-option">
              <input type="radio" name="chatMode" value="passive" ${(agent.bihBot?.chatMode || 'passive') === 'passive' ? 'checked' : ''}>
              <span class="chat-mode-label">passive</span>
              <span class="chat-mode-desc">Stays silent by default. Only responds when @-mentioned or topic matches persona.</span>
            </label>
            <label class="chat-mode-option">
              <input type="radio" name="chatMode" value="active" ${agent.bihBot?.chatMode === 'active' ? 'checked' : ''}>
              <span class="chat-mode-label">active</span>
              <span class="chat-mode-desc">Responds more readily. [SILENT] still available but not the default stance.</span>
            </label>
            <label class="chat-mode-option">
              <input type="radio" name="chatMode" value="agent" ${agent.bihBot?.chatMode === 'agent' ? 'checked' : ''}>
              <span class="chat-mode-label">agent</span>
              <span class="chat-mode-desc">Always responds to @-mentions. Can invoke enabled Chat MCP Tools to fulfill requests.</span>
            </label>
          </div>
          <div style="margin-top:0.75rem">
            <button class="btn-primary btn-sm" onclick="saveChatMode('${agentId}')">Save Chat Mode</button>
          </div>
        </div>

        <div class="perm-section">
          <h3>bih Bot — Allowed Roles</h3>
          <p class="mcp-description">Comma-separated list of bih user roles that can trigger this bot. Leave empty to allow all.</p>
          <input type="text" id="allowedRolesInput" class="form-control" value="${allowedRoles.join(', ')}" placeholder="admin, member, vip">
          <div style="margin-top:0.75rem">
            <button class="btn-primary btn-sm" onclick="saveAllowedRoles('${agentId}')">Save Allowed Roles</button>
          </div>
        </div>
        ` : `
        <div class="perm-section">
          <h3>bih Bot — Chat Mode &amp; Allowed Roles</h3>
          <p class="mcp-description" style="color:#555">Enable this agent as a bih bot first (via the Tuning tab) to configure chat mode and role restrictions.</p>
        </div>
        `}

      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="empty-state" style="color:#ff4444">Error: ${err.message}</p>`;
  }
}

async function saveBgTools(agentId) {
  const checked = Array.from(document.querySelectorAll('#permBgToolsGrid input[type="checkbox"]:checked'))
    .map(cb => cb.value);
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/background/tools`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tools: checked })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification('Background tools saved', 'success');
  } catch (err) {
    showNotification('Failed: ' + err.message, 'error');
  }
}

async function saveChatTools(agentId) {
  const checked = Array.from(document.querySelectorAll('#permChatToolsGrid input[type="checkbox"]:checked'))
    .map(cb => cb.value);
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/mcp/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tools: checked })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification('Chat tools saved', 'success');
  } catch (err) {
    showNotification('Failed: ' + err.message, 'error');
  }
}

async function saveCapabilities(agentId) {
  const tags = Array.from(document.querySelectorAll('#capabilityTags .cap-tag'))
    .map(el => el.dataset.value);
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/capabilities`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities: tags })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification('Capabilities saved', 'success');
  } catch (err) {
    showNotification('Failed: ' + err.message, 'error');
  }
}

function addCapabilityTag(value) {
  const container = document.getElementById('capabilityTags');
  if (!container || !value.trim()) return;
  // Avoid duplicates
  if (container.querySelector(`.cap-tag[data-value="${value.trim()}"]`)) return;
  const tag = document.createElement('span');
  tag.className = 'cap-tag';
  tag.dataset.value = value.trim();
  tag.innerHTML = `${escapeHtml(value.trim())} <button class="cap-tag-remove" onclick="this.parentElement.remove()">×</button>`;
  container.appendChild(tag);
}

async function saveChatMode(agentId) {
  const selected = document.querySelector('input[name="chatMode"]:checked')?.value;
  if (!selected) return showNotification('Select a chat mode', 'error');
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/bih-bot/chat-mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatMode: selected })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification(`Chat mode set to "${selected}"`, 'success');
  } catch (err) {
    showNotification('Failed: ' + err.message, 'error');
  }
}

async function saveAllowedRoles(agentId) {
  const raw = document.getElementById('allowedRolesInput')?.value || '';
  const roles = raw.split(',').map(r => r.trim()).filter(Boolean);
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/bih-bot/roles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowedRoles: roles })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification('Allowed roles saved', 'success');
  } catch (err) {
    showNotification('Failed: ' + err.message, 'error');
  }
}

function createActionElement(action, agentId) {
  const typeColor = { tldr: '#00aaff', task_list: '#ffaa00', finding: '#00ff88', background: '#ff88cc', file_write: '#ffcc00', image: '#cc88ff' };
  const color = typeColor[action.type] || '#888';
  const agentLabel = action.agentId?.name ? `<span class="action-agent">${escapeHtml(action.agentId.name)}</span>` : '';
  const actionId = action._id;

  let body = '';
  if (action.type === 'image' && action.content) {
    body = `<div class="action-image-preview"><img src="${escapeHtml(action.content)}" alt="${escapeHtml(action.title)}" loading="lazy" style="max-width:100%;max-height:280px;border-radius:6px;margin-top:0.4rem;cursor:pointer" onclick="window.open('${escapeHtml(action.content)}','_blank')"></div>`;
  } else {
    const isLong = (action.content || '').length > 300;
    body = `
      <div class="action-content markdown-body${isLong ? ' action-content-collapsed' : ''}" id="ac-${actionId}">${renderMarkdown(action.content)}</div>
      ${isLong ? `<button class="action-expand-btn" onclick="toggleActionExpand('${actionId}')">Show more</button>` : ''}
    `;
  }

  const promoteButtons = agentId && action.type !== 'image' ? `
    <button class="btn-promote" title="Add to Knowledge Base" onclick="promoteAction('${agentId}','${actionId}','knowledge')">→ KB</button>
    <button class="btn-promote" title="Add to Long-term Notes" onclick="promoteAction('${agentId}','${actionId}','longterm')">→ Notes</button>
    <button class="btn-promote btn-promote-task" title="Queue as agent task" onclick="promoteToTask('${agentId}','${actionId}')">→ Task</button>
  ` : '';

  return `
    <div class="action-item" data-type="${action.type}">
      <div class="action-header">
        <span class="action-type-badge" style="color:${color};border-color:${color}33;background:${color}11">${action.type.replace('_',' ')}</span>
        ${agentLabel}
        <span class="action-title">${escapeHtml(action.title)}</span>
        <span class="action-time">${new Date(action.createdAt).toLocaleTimeString()}</span>
        <span class="action-status-badge ${action.status}">${action.status === 'complete' ? '✓' : '✗'}</span>
        ${agentId ? `<button class="btn-icon action-del" onclick="deleteAction('${agentId}','${action._id}')">×</button>` : ''}
      </div>
      ${body}
      <div class="action-footer">
        ${promoteButtons}
        ${action.tokens ? `<span class="action-tokens">${action.tokens} tokens</span>` : ''}
      </div>
    </div>
  `;
}

function toggleActionExpand(actionId) {
  const el = document.getElementById(`ac-${actionId}`);
  const btn = el?.nextElementSibling;
  if (!el) return;
  const collapsed = el.classList.toggle('action-content-collapsed');
  if (btn) btn.textContent = collapsed ? 'Show more' : 'Show less';
}

function filterActions(btn, type) {
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.action-item').forEach(el => {
    el.style.display = (type === 'all' || el.dataset.type === type) ? '' : 'none';
  });
}

async function saveBgConfig(agentId) {
  try {
    const backgroundPrompt = document.getElementById('bgPromptInput')?.value || '';
    const backgroundInterval = parseInt(document.getElementById('bgIntervalInput')?.value) || 2;
    const res = await fetch(`/agents/api/agents/${agentId}/background/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backgroundPrompt, backgroundInterval })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification(data.restarted ? 'Config saved — process restarted with new interval' : 'Config saved', 'success');
  } catch (err) {
    showNotification('Failed: ' + err.message, 'error');
  }
}

async function startBackground(agentId) {
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/background/start`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification('Background process started', 'success');
    loadPermissionsTab(agentId);
  } catch (err) {
    showNotification('Failed: ' + err.message, 'error');
  }
}

async function stopBackground(agentId) {
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/background/stop`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification('Background process stopped', 'success');
    loadPermissionsTab(agentId);
  } catch (err) {
    showNotification('Failed: ' + err.message, 'error');
  }
}

async function saveHierarchy(agentId) {
  const tier = document.getElementById('hierTierSelect')?.value;
  const parentAgentId = document.getElementById('hierParentSelect')?.value || null;
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/hierarchy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, parentAgentId })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification(`Hierarchy saved — ${data.tier}`, 'success');
    loadOverviewTab(agentId);
  } catch (err) {
    showNotification('Failed: ' + err.message, 'error');
  }
}

async function promoteToTask(agentId, actionId, priority = 'medium') {
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/actions/${actionId}/promote-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification('Task queued for agent', 'success');
  } catch (err) {
    showNotification('Failed: ' + err.message, 'error');
  }
}

async function promoteAction(agentId, actionId, target) {
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/actions/${actionId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification(target === 'knowledge' ? 'Added to Knowledge Base' : 'Added to Notes', 'success');
  } catch (err) {
    showNotification('Promote failed: ' + err.message, 'error');
  }
}

async function deleteAction(agentId, actionId) {
  if (!confirm('Delete this action?')) return;
  try {
    await fetch(`/agents/api/agents/${agentId}/actions/${actionId}`, { method: 'DELETE' });
    const el = document.querySelector(`[data-action-id="${actionId}"]`);
    if (el) el.remove();
    loadActionsTab(agentId);
  } catch (err) {
    showNotification('Failed to delete action', 'error');
  }
}

function setupSliders() {
  const sliders = [
    { id: 'tuningTemperature', valueId: 'tempValue' },
    { id: 'tuningTopP', valueId: 'topPValue' },
    { id: 'tuningTopK', valueId: 'topKValue' },
    { id: 'tuningRepeatPenalty', valueId: 'repeatPenaltyValue' },
    { id: 'tuningCreativity', valueId: 'creativityValue' },
    { id: 'tuningVerbosity', valueId: 'verbosityValue' },
    { id: 'tuningFormality', valueId: 'formalityValue' }
  ];

  sliders.forEach(({ id, valueId }) => {
    const slider = document.getElementById(id);
    const valueSpan = document.getElementById(valueId);

    if (slider && valueSpan) {
      slider.addEventListener('input', (e) => {
        valueSpan.textContent = e.target.value;
      });
    }
  });
}

async function saveTuning(event, agentId) {
  event.preventDefault();

  const form = event.target;
  const formData = new FormData(form);

  const tuningData = {
    systemPrompt: formData.get('systemPrompt'),
    temperature: parseFloat(formData.get('temperature')),
    maxTokens: parseInt(formData.get('maxTokens')),
    contextWindow: parseInt(formData.get('contextWindow')),
    topP: parseFloat(formData.get('topP')),
    topK: parseInt(formData.get('topK')),
    repeatPenalty: parseFloat(formData.get('repeatPenalty')),
    adjustableParams: {
      creativity: parseFloat(formData.get('creativity')),
      verbosity: parseFloat(formData.get('verbosity')),
      formality: parseFloat(formData.get('formality'))
    }
  };

  // bih bot tunable fields (only present if bot is enabled)
  const bihDisplayName = formData.get('bihDisplayName');
  const bihAvatar = formData.get('bihAvatar');
  const bihRateMs = formData.get('bihRateMs');
  if (bihDisplayName !== null || bihRateMs !== null) {
    tuningData.bihBot = {
      displayName: bihDisplayName || '',
      avatar: bihAvatar || '',
      rateMs: parseInt(bihRateMs) || 8000
    };
  }

  try {
    // Save tuning
    const tuningRes = await fetch(`/agents/api/agents/${agentId}/tuning`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tuningData)
    });

    const tuningResult = await tuningRes.json();
    if (!tuningResult.success) throw new Error(tuningResult.error);

    showNotification('Tuning configuration saved successfully', 'success');
  } catch (error) {
    console.error('Error saving tuning:', error);
    showNotification('Failed to save tuning configuration', 'error');
  }
}

function showAddKnowledge(agentId) {
  const title = prompt('Knowledge Title:');
  if (!title) return;

  const content = prompt('Knowledge Content:');
  if (!content) return;

  const type = prompt('Type (document/context/instruction):', 'context');

  addKnowledge(agentId, title, content, type);
}

async function addKnowledge(agentId, title, content, type = 'context') {
  try {
    const response = await fetch(`/agents/api/agents/${agentId}/memory/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, type })
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error);

    showNotification('Knowledge added successfully', 'success');
    loadMemoryTab(agentId);
  } catch (error) {
    console.error('Error adding knowledge:', error);
    showNotification('Failed to add knowledge', 'error');
  }
}

async function deleteKnowledge(agentId, knowledgeId) {
  if (!confirm('Are you sure you want to delete this knowledge entry?')) return;

  try {
    const response = await fetch(`/agents/api/agents/${agentId}/memory/knowledge/${knowledgeId}`, {
      method: 'DELETE'
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error);

    showNotification('Knowledge deleted successfully', 'success');
    loadMemoryTab(agentId);
  } catch (error) {
    console.error('Error deleting knowledge:', error);
    showNotification('Failed to delete knowledge', 'error');
  }
}

async function clearMemory(agentId) {
  if (!confirm('Are you sure you want to clear ALL memory for this agent? This action cannot be undone.')) return;

  try {
    const response = await fetch(`/agents/api/agents/${agentId}/memory`, {
      method: 'DELETE'
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error);

    showNotification('Memory cleared successfully', 'success');
    loadMemoryTab(agentId);
  } catch (error) {
    console.error('Error clearing memory:', error);
    showNotification('Failed to clear memory', 'error');
  }
}

async function saveThreadSummary(agentId) {
  const text = document.getElementById('threadSummaryInput')?.value || '';
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/memory/summary`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadSummary: text })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification('Thread summary saved', 'success');
  } catch (err) {
    showNotification('Failed to save summary: ' + err.message, 'error');
  }
}

async function saveLongTermMemory(agentId) {
  const text = document.getElementById('longTermMemoryInput')?.value || '';
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/memory/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ longTermMemory: text })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showNotification('Long-term memory saved', 'success');
  } catch (err) {
    showNotification('Failed to save notes: ' + err.message, 'error');
  }
}

function clearLogsView() {
  document.getElementById('logsContent').innerHTML = '';
}

function showNotification(message, type = 'info') {
  // Simple notification (you can enhance this)
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('show');
  }, 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  if (typeof marked === 'undefined') return escapeHtml(text);
  return marked.parse(text || '', { breaks: true, gfm: true });
}

// Initialize socket on page load and subscribe all visible agent cards for live status
if (typeof io !== 'undefined') {
  const socket = initAgentSocket();
  // Subscribe all cards so status:change events arrive even without opening detail modal
  socket.on('connect', () => {
    document.querySelectorAll('.agent-card[data-agent-id]').forEach(card => {
      socket.emit('subscribe', card.dataset.agentId);
    });
  });
}

// Init background badges for any already-running processes
fetch('/agents/api/background/status')
  .then(r => r.json())
  .then(data => {
    (data.processes || []).forEach(p => setCardBgBadge(p.agentId, true, p.runCount));
  })
  .catch(() => {});
