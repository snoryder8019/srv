/**
 * Agent Digest — unified background feed across all agents
 */

let activeAgentFilter = null;
let activeTypeFilter = null;
let allActions = [];
let agentSocket = null;
const bgState = {}; // agentId -> { running, runCount, lastRun }

const TIER_COLORS = { apex: '#ff4444', executive: '#ff9900', manager: '#ffcc00', worker: '#555' };
const TYPE_COLORS = { tldr: '#00aaff', task_list: '#ffaa00', finding: '#00ff88', background: '#ff88cc', file_write: '#ffcc00', image: '#cc88ff' };

// ── Agent index by ID ──────────────────────────────────────
const agentMap = {};
DIGEST_AGENTS.forEach(a => { agentMap[a._id] = a; });

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  refreshDigest();
  renderTaskQueue();
  refreshBgControls();
  initSockets();
});

async function refreshDigest() {
  try {
    const limit = 200;
    const url = `/agents/api/actions?limit=${limit}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    allActions = data.actions;
    renderFeed();
    renderStats();
  } catch (err) {
    document.getElementById('digestFeed').innerHTML =
      `<p class="empty-state" style="color:#ff4444">Load error: ${err.message}</p>`;
  }
}

// ── Feed rendering ─────────────────────────────────────────
function renderFeed() {
  const feed = document.getElementById('digestFeed');
  let filtered = allActions;
  if (activeAgentFilter) filtered = filtered.filter(a => {
    const id = a.agentId?._id || a.agentId;
    return id === activeAgentFilter;
  });
  if (activeTypeFilter) filtered = filtered.filter(a => a.type === activeTypeFilter);

  if (!filtered.length) {
    feed.innerHTML = '<p class="empty-state">No actions match the current filters</p>';
    return;
  }
  feed.innerHTML = filtered.map(a => renderActionCard(a)).join('');
}

function renderActionCard(action) {
  const agentId = action.agentId?._id || action.agentId;
  const agentName = action.agentId?.name || agentMap[agentId]?.name || 'Unknown';
  const agentTier = agentMap[agentId]?.tier || 'worker';
  const tierColor = TIER_COLORS[agentTier] || '#555';
  const typeColor = TYPE_COLORS[action.type] || '#888';
  const ts = new Date(action.createdAt);
  const timeStr = ts.toLocaleDateString() === new Date().toLocaleDateString()
    ? ts.toLocaleTimeString()
    : ts.toLocaleString();

  let body = '';
  if (action.type === 'image' && action.content) {
    body = `<div class="digest-img-wrap"><img src="${escHtml(action.content)}" alt="${escHtml(action.title)}" loading="lazy" onclick="window.open('${escHtml(action.content)}','_blank')"></div>`;
  } else {
    const isLong = (action.content || '').length > 400;
    const id = `dc-${action._id}`;
    body = `
      <div class="digest-card-body markdown-body${isLong ? ' action-content-collapsed' : ''}" id="${id}">${renderMd(action.content)}</div>
      ${isLong ? `<button class="action-expand-btn" onclick="toggleExpand('${id}', this)">Show more</button>` : ''}
    `;
  }

  const bodyId = `dc-${action._id}`;
  const promoteBtns = action.type !== 'image' && agentId ? `
    <button class="btn-promote" onclick="promoteDigestAction('${agentId}','${action._id}','knowledge')">→ KB</button>
    <button class="btn-promote" onclick="promoteDigestAction('${agentId}','${action._id}','longterm')">→ Notes</button>
    <button class="btn-promote btn-promote-task" onclick="promoteDigestToTask('${agentId}','${action._id}')">→ Task</button>
  ` : '';

  return `
    <div class="digest-card" data-agent="${agentId}" data-type="${action.type}" data-id="${action._id}">
      <div class="digest-card-header">
        <span class="digest-agent-badge" style="border-color:${tierColor}44;color:${tierColor}">${escHtml(agentName)}</span>
        <span class="action-type-badge" style="color:${typeColor};border-color:${typeColor}33;background:${typeColor}11">${action.type.replace('_',' ')}</span>
        <span class="digest-card-title">${escHtml(action.title)}</span>
        <span class="digest-card-time">${timeStr}</span>
        <button class="btn-icon action-del" onclick="deleteDigestAction('${agentId}','${action._id}')" title="Delete">×</button>
      </div>
      ${body}
      <div class="action-footer">
        ${promoteBtns}
        ${action.type !== 'image' ? `<button class="btn-font-size" onclick="toggleFontSize('${bodyId}', this)" title="Toggle text size">A±</button>` : ''}
        ${action.tokens ? `<span class="action-tokens">${action.tokens} tok</span>` : ''}
      </div>
    </div>
  `;
}

// ── Stats panel ────────────────────────────────────────────
function renderStats() {
  const panel = document.getElementById('statsPanel');
  const byAgent = {};
  const byType = {};
  allActions.forEach(a => {
    const name = a.agentId?.name || agentMap[a.agentId]?.name || 'Unknown';
    byAgent[name] = (byAgent[name] || 0) + 1;
    byType[a.type] = (byType[a.type] || 0) + 1;
  });
  const agentRows = Object.entries(byAgent).sort((a,b)=>b[1]-a[1])
    .map(([n,c]) => `<div class="stat-row"><span>${escHtml(n)}</span><span class="stat-count">${c}</span></div>`).join('');
  const typeRows = Object.entries(byType).sort((a,b)=>b[1]-a[1])
    .map(([t,c]) => {
      const color = TYPE_COLORS[t] || '#888';
      return `<div class="stat-row"><span style="color:${color}">${t.replace('_',' ')}</span><span class="stat-count">${c}</span></div>`;
    }).join('');
  panel.innerHTML = `
    <h3>Activity <span style="color:#555;font-size:0.75rem;font-weight:400">(${allActions.length} total)</span></h3>
    <div class="stat-section-label">By agent</div>${agentRows}
    <div class="stat-section-label" style="margin-top:0.75rem">By type</div>${typeRows}
  `;
}

// ── Task queue ─────────────────────────────────────────────
async function renderTaskQueue() {
  const panel = document.getElementById('taskQueue');
  const agentId = document.getElementById('taskAgentSelect')?.value || '';
  try {
    // Fetch tasks for all agents or a specific one
    let tasks = [];
    if (agentId) {
      const res = await fetch(`/agents/api/agents/${agentId}/tasks?status=pending`);
      const data = await res.json();
      tasks = (data.tasks || []).map(t => ({ ...t, agentName: agentMap[agentId]?.name || '' }));
    } else {
      // Fetch for all agents in parallel
      const results = await Promise.all(DIGEST_AGENTS.map(a =>
        fetch(`/agents/api/agents/${a._id}/tasks?status=pending`)
          .then(r => r.json())
          .then(d => (d.tasks || []).map(t => ({ ...t, agentName: a.name, agentId: a._id })))
          .catch(() => [])
      ));
      tasks = results.flat().sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0) || new Date(a.createdAt) - new Date(b.createdAt));
    }

    if (!tasks.length) {
      panel.innerHTML = '<p class="empty-state" style="font-size:0.75rem;padding:1rem 0">No pending tasks</p>';
      return;
    }

    const PRIORITY_COLOR = { high: '#ff4444', medium: '#ffcc00', low: '#555' };
    panel.innerHTML = tasks.slice(0, 20).map(t => {
      const color = PRIORITY_COLOR[t.priority] || '#555';
      const agId = t.agentId || agentId;
      return `
        <div class="task-item">
          <div class="task-item-header">
            <span class="task-priority-dot" style="background:${color}" title="${t.priority}"></span>
            <span class="task-title">${escHtml(t.title)}</span>
            <button class="btn-icon action-del" onclick="cancelTask('${agId}','${t._id}')" title="Cancel">×</button>
          </div>
          ${t.agentName ? `<div class="task-agent">${escHtml(t.agentName)}</div>` : ''}
          ${t.description ? `<div class="task-desc">${escHtml(t.description.substring(0, 120))}</div>` : ''}
          <div class="task-meta">${t.source || 'self'} · ${new Date(t.createdAt).toLocaleDateString()}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    panel.innerHTML = `<p class="empty-state" style="color:#ff4444;font-size:0.75rem">${err.message}</p>`;
  }
}

async function cancelTask(agentId, taskId) {
  try {
    await fetch(`/agents/api/agents/${agentId}/tasks/${taskId}`, { method: 'DELETE' });
    renderTaskQueue();
  } catch (_) {}
}

// ── Org chart ──────────────────────────────────────────────
function renderOrgChart() {
  fetch('/agents/api/agents/hierarchy')
    .then(r => r.json())
    .then(data => {
      if (!data.success) return;
      const agents = data.agents;
      const byParent = {};
      agents.forEach(a => {
        const parentKey = a.parentAgent ? a.parentAgent.toString() : '__root__';
        (byParent[parentKey] = byParent[parentKey] || []).push(a);
      });

      function renderNode(a, depth) {
        const color = TIER_COLORS[a.tier] || '#555';
        const children = byParent[a._id] || [];
        return `
          <div class="org-node" style="--depth:${depth}">
            <div class="org-node-label">
              <span class="org-tier-dot" style="background:${color}" title="${a.tier}"></span>
              <a href="#" onclick="filterByAgent('${a._id}');return false" style="color:#ccc">${escHtml(a.name)}</a>
              <span class="org-status-dot status-${a.status}" title="${a.status}"></span>
            </div>
            ${children.length ? `<div class="org-children">${children.map(c => renderNode(c, depth+1)).join('')}</div>` : ''}
          </div>`;
      }

      const roots = byParent['__root__'] || agents.filter(a => !a.parentAgent);
      document.getElementById('orgChart').innerHTML = roots.map(r => renderNode(r, 0)).join('') || '<p class="empty-state">No hierarchy set</p>';
    });
}

// ── Filters ────────────────────────────────────────────────
function setAgentFilter(btn, agentId) {
  activeAgentFilter = agentId;
  document.querySelectorAll('#agentFilters .filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderFeed();
}

function filterByAgent(agentId) {
  activeAgentFilter = agentId;
  document.querySelectorAll('#agentFilters .filter-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.agentId === agentId);
    if (!b.dataset.agentId && !agentId) b.classList.add('active');
  });
  renderFeed();
}

function setTypeFilter(btn, type) {
  activeTypeFilter = type;
  document.querySelectorAll('.digest-type-filters .filter-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderFeed();
}

// ── Actions ────────────────────────────────────────────────
async function promoteDigestToTask(agentId, actionId) {
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/actions/${actionId}/promote-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'medium' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast('Task queued', 'success');
    renderTaskQueue();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

async function promoteDigestAction(agentId, actionId, target) {
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/actions/${actionId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast(target === 'knowledge' ? '→ Added to KB' : '→ Added to Notes', 'success');
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

async function deleteDigestAction(agentId, actionId) {
  if (!confirm('Delete this action?')) return;
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/actions/${actionId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    allActions = allActions.filter(a => a._id !== actionId);
    const card = document.querySelector(`.digest-card[data-id="${actionId}"]`);
    if (card) card.remove();
    renderStats();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}

function toggleExpand(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const collapsed = el.classList.toggle('action-content-collapsed');
  btn.textContent = collapsed ? 'Show more' : 'Show less';
}

function toggleFontSize(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const sizes = ['', 'digest-text-md', 'digest-text-lg'];
  const cur = sizes.findIndex(c => c && el.classList.contains(c));
  const next = (cur + 1) % sizes.length;
  sizes.forEach(c => c && el.classList.remove(c));
  if (sizes[next]) el.classList.add(sizes[next]);
  btn.textContent = next === 0 ? 'A±' : next === 1 ? 'A+' : 'A++';
}

// ── Background controls ────────────────────────────────────
async function refreshBgControls() {
  try {
    const res = await fetch('/agents/api/background/status');
    const data = await res.json();
    if (!data.success) return;
    // Seed bgState from running processes
    data.processes.forEach(p => {
      bgState[p.agentId] = { running: true, runCount: p.runCount, lastRun: p.lastRun };
    });
    renderBgControls();
  } catch (_) {
    renderBgControls();
  }
}

function renderBgControls() {
  const panel = document.getElementById('bgControls');
  if (!DIGEST_AGENTS.length) {
    panel.innerHTML = '<p class="empty-state" style="font-size:0.75rem;padding:0.5rem 0">No agents</p>';
    return;
  }
  panel.innerHTML = DIGEST_AGENTS.map(a => {
    const st = bgState[a._id] || { running: false, runCount: 0, lastRun: null };
    const dotColor = st.running ? '#00ff88' : '#333';
    const dotAnim = st.running ? '' : 'animation:none';
    const ticks = st.running ? `<span class="bg-ctrl-ticks" id="bgticks-${a._id}">${st.runCount}</span>t` : '';
    const score = st.productivityScore ?? '';
    const scoreColor = score === '' ? '#444' : score >= 60 ? '#00ff88' : score >= 30 ? '#ffaa00' : '#ff4444';
    const scoreStr = score !== '' ? `<span class="bg-ctrl-score" id="bgscore-${a._id}" style="color:${scoreColor}" title="Productivity score">${score}%</span>` : '';
    return `
      <div class="bg-ctrl-row" id="bgrow-${a._id}">
        <span class="status-dot" style="background:${dotColor};${dotAnim};flex-shrink:0"></span>
        <span class="bg-ctrl-name">${escHtml(a.name)}</span>
        <span class="bg-ctrl-ticks-wrap">${ticks} ${scoreStr}</span>
        ${st.running
          ? `<button class="btn-xs btn-danger" onclick="toggleBg('${a._id}', false)">■</button>`
          : `<button class="btn-xs btn-secondary" onclick="toggleBg('${a._id}', true)">▶</button>`
        }
      </div>`;
  }).join('');
}

function updateBgRow(agentId) {
  const row = document.getElementById(`bgrow-${agentId}`);
  if (!row) return;
  const st = bgState[agentId] || { running: false, runCount: 0 };
  const dot = row.querySelector('.status-dot');
  if (dot) { dot.style.background = st.running ? '#00ff88' : '#333'; dot.style.animation = st.running ? '' : 'none'; }
  const ticksWrap = row.querySelector('.bg-ctrl-ticks-wrap');
  if (ticksWrap) ticksWrap.innerHTML = st.running ? `<span class="bg-ctrl-ticks" id="bgticks-${agentId}">${st.runCount}</span> ticks` : '';
  const btn = row.querySelector('button');
  if (btn) {
    btn.className = st.running ? 'btn-xs btn-danger' : 'btn-xs btn-secondary';
    btn.textContent = st.running ? '■' : '▶';
    btn.onclick = () => toggleBg(agentId, !st.running);
  }
}

async function toggleBg(agentId, start) {
  try {
    const endpoint = start ? 'background/start' : 'background/stop';
    const res = await fetch(`/agents/api/agents/${agentId}/${endpoint}`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) { showToast(data.error || 'Failed', 'error'); return; }
    if (!start) {
      bgState[agentId] = { running: false, runCount: 0, lastRun: null };
      updateBgRow(agentId);
    }
    // started state update comes via socket background:started
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function startAllBackground() {
  const idle = DIGEST_AGENTS.filter(a => !bgState[a._id]?.running);
  if (!idle.length) { showToast('All agents already running', 'info'); return; }
  await Promise.all(idle.map(a => toggleBg(a._id, true)));
  showToast(`Started ${idle.length} agent(s)`, 'success');
}

// ── Live socket ────────────────────────────────────────────
function initSockets() {
  agentSocket = io('/agents', { transports: ['websocket', 'polling'], reconnection: true });
  agentSocket.on('connect', () => {
    document.getElementById('liveDot').classList.add('live');
    // Subscribe to all known agents
    DIGEST_AGENTS.forEach(a => agentSocket.emit('subscribe', a._id));
  });
  agentSocket.on('disconnect', () => document.getElementById('liveDot').classList.remove('live'));
  agentSocket.on('action:new', ({ action }) => {
    if (!action) return;
    allActions.unshift(action);
    const feed = document.getElementById('digestFeed');
    const placeholder = feed.querySelector('.empty-state, .loading');
    if (placeholder) placeholder.remove();
    feed.insertAdjacentHTML('afterbegin', renderActionCard(action));
    renderStats();
    showToast(`New: ${action.title}`, 'info');
  });

  agentSocket.on('background:started', ({ agentId }) => {
    bgState[agentId] = { running: true, runCount: 0, lastRun: null };
    updateBgRow(agentId);
  });
  agentSocket.on('background:stopped', ({ agentId }) => {
    bgState[agentId] = { running: false, runCount: 0, lastRun: null };
    updateBgRow(agentId);
  });
  agentSocket.on('background:tick', ({ agentId, runCount, lastRun, productivityScore, consecutiveIdle }) => {
    if (!bgState[agentId]) bgState[agentId] = { running: true };
    bgState[agentId].runCount = runCount;
    bgState[agentId].lastRun = lastRun;
    if (productivityScore !== undefined) bgState[agentId].productivityScore = productivityScore;
    if (consecutiveIdle !== undefined) bgState[agentId].consecutiveIdle = consecutiveIdle;
    const tickEl = document.getElementById(`bgticks-${agentId}`);
    if (tickEl) tickEl.textContent = runCount + 't';
    const scoreEl = document.getElementById(`bgscore-${agentId}`);
    if (scoreEl && productivityScore !== undefined) {
      const color = productivityScore >= 60 ? '#00ff88' : productivityScore >= 30 ? '#ffaa00' : '#ff4444';
      scoreEl.textContent = productivityScore + '%';
      scoreEl.style.color = color;
      scoreEl.title = consecutiveIdle > 0 ? `${consecutiveIdle} idle tick(s) — may invent tasks` : 'Productivity score';
    }
  });
}

// ── Helpers ────────────────────────────────────────────────
function renderMd(text) {
  if (typeof marked === 'undefined') return escHtml(text || '');
  return marked.parse(text || '', { breaks: true, gfm: true });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = `notification notification-${type}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}
