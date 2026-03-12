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

// Replace any known agent ObjectIDs in a string with their names
const OBJ_ID_RE = /\b([0-9a-f]{24})\b/g;
function resolveAgentIds(str) {
  if (!str) return str;
  return str.replace(OBJ_ID_RE, (id) => agentMap[id]?.name || id);
}

// ── Shared helpers ─────────────────────────────────────────
function agentOptions(selectedId = null) {
  return DIGEST_AGENTS.map(a =>
    `<option value="${a._id}"${a._id === selectedId ? ' selected' : ''}>${escHtml(a.name)}</option>`
  ).join('');
}

async function apiFetch(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data;
}

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  refreshDigest();
  refreshScorecard();
  renderTaskQueue();
  renderApprovalQueue();
  seedBgState(); // seed bgState from running processes before scorecard renders
  initSockets();
  initCardMenu();
  setInterval(refreshScorecard, 60000); // auto-refresh scorecard every 60s
  setInterval(renderApprovalQueue, 30000); // poll approval queue every 30s
});

async function refreshDigest() {
  try {
    const data = await apiFetch('/agents/api/actions?limit=200');
    allActions = data.actions;
    renderFeed();
    renderStats();
    renderPinBoard();
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
  fixMobileCards(feed);
}

function renderActionCard(action, pinned = false) {
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
      <div class="digest-card-body markdown-body${isLong ? ' action-content-collapsed' : ''}" id="${id}">${renderMd(resolveAgentIds(action.content))}</div>
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
        <span class="digest-card-title">${escHtml(resolveAgentIds(action.title))}</span>
        <span class="digest-card-time">${timeStr}</span>
        ${pinned ? `<button class="btn-icon btn-unpin" onclick="togglePin('${action._id}')" title="Unpin">📌</button>` : ''}
        <button class="btn-icon action-del" onclick="deleteDigestAction('${agentId}','${action._id}')" title="Delete">×</button>
      </div>
      ${body}
      <div class="action-footer">
        ${promoteBtns}
        ${action.type !== 'image' ? `<button class="btn-font-size" onclick="toggleFontSize('${bodyId}', this)" title="Toggle text size">A±</button>` : ''}
        ${action.tokens ? `<span class="action-tokens">${action.tokens} tok</span>` : ''}
        <button class="btn-icon btn-menu" onclick="openCardMenu(event,'${action._id}')" title="More options">⋯</button>
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

// ── Productivity Scorecard ─────────────────────────────────
async function refreshScorecard() {
  const panel = document.getElementById('scorecardPanel');
  if (!panel) return;
  try {
    const data = await apiFetch('/agents/api/tasks/scorecard');
    renderScorecard(data.scorecard, data.totals);
  } catch (err) {
    panel.innerHTML = `<h3>Productivity</h3><p style="color:#ff4444;font-size:0.75rem">${err.message}</p>`;
  }
}

function renderScorecard(scorecard, totals) {
  const panel = document.getElementById('scorecardPanel');
  if (!panel) return;

  const totalAll = totals.complete + totals.pending + totals.needs_human;
  const orgRate = totalAll > 0 ? Math.round((totals.complete / totalAll) * 100) : 0;
  const orgColor = orgRate >= 60 ? '#00ff88' : orgRate >= 30 ? '#ffaa00' : '#ff4444';

  const rows = scorecard.map(a => {
    const total = a.complete + a.pending + a.needs_human;
    const rate = a.completionRate;
    const barColor = rate === null ? '#333' : rate >= 60 ? '#00ff88' : rate >= 30 ? '#ffaa00' : '#ff4444';
    const barPct = rate ?? 0;
    const nhBadge = a.needs_human > 0
      ? `<span title="${a.needs_human} waiting for you" style="color:#ffaa00;font-size:0.65rem;margin-left:0.3rem">⚠ ${a.needs_human}</span>`
      : '';
    const last24 = a.completedLast24h > 0
      ? `<span style="color:#00ff88;font-size:0.65rem" title="Completed in last 24h">+${a.completedLast24h}</span>`
      : `<span style="color:#555;font-size:0.65rem">+0</span>`;
    const prodScore = a.productivityScore !== null
      ? `<span style="color:#555;font-size:0.65rem" title="BG productivity score">${a.productivityScore}%</span>`
      : '';
    const st = bgState[a.agentId] || {};
    const isRunning = st.running ?? a.backgroundRunning;
    const ticks = st.runCount ?? 0;
    const bgDot = isRunning
      ? `<span id="sc-dot-${a.agentId}" style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#00ff88;margin-left:0.3rem;vertical-align:middle" title="Background running"></span>`
      : `<span id="sc-dot-${a.agentId}" style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#333;margin-left:0.3rem;vertical-align:middle" title="Background stopped"></span>`;
    const noTasksYet = total === 0;
    const toggleLabel = isRunning ? '■' : '▶';
    const toggleClass = isRunning ? 'btn-danger' : 'btn-secondary';
    return `
      <div class="scorecard-row">
        <div class="scorecard-name-row">
          <span onclick="filterByAgent('${a.agentId}')" style="cursor:pointer;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Filter by ${escHtml(a.name)}">${escHtml(a.name)}${bgDot}${nhBadge}</span>
          <span id="sc-ticks-${a.agentId}" style="color:#555;font-size:0.62rem;min-width:24px;text-align:right">${ticks > 0 ? ticks + 't' : ''}</span>
          <button class="btn-xs btn-secondary" onclick="openContextModal('${a.agentId}')" title="Context debug" style="padding:0 0.3rem;flex-shrink:0">⬡</button>
          <button class="btn-xs ${toggleClass}" id="sc-btn-${a.agentId}" onclick="toggleBg('${a.agentId}', ${!isRunning})" style="flex-shrink:0">${toggleLabel}</button>
        </div>
        <div class="scorecard-bar-wrap">
          <div class="scorecard-bar" style="width:${barPct}%;background:${barColor}"></div>
        </div>
        <div class="scorecard-meta">
          <span style="color:${noTasksYet ? '#444' : barColor};font-weight:600;font-size:0.72rem">${noTasksYet ? 'new' : rate !== null ? rate + '%' : '–'}</span>
          <span style="color:#444;font-size:0.65rem">${a.complete}/${total}</span>
          ${last24}
          ${prodScore}
        </div>
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.6rem">
      <h3 style="margin:0">Productivity</h3>
      <button class="btn-xs btn-secondary" onclick="refreshScorecard()" title="Refresh">↻</button>
    </div>
    <div class="scorecard-org-summary">
      <span style="color:#888;font-size:0.72rem">Org completion rate</span>
      <span style="color:${orgColor};font-weight:700;font-size:1rem">${orgRate}%</span>
      <span style="color:#555;font-size:0.65rem">${totals.complete}/${totalAll} tasks · +${totals.completedLast24h} today</span>
    </div>
    <div class="scorecard-needs-human-banner${totals.needs_human > 0 ? '' : ' hidden'}">
      ⚠ ${totals.needs_human} task${totals.needs_human !== 1 ? 's' : ''} waiting for your reply
    </div>
    <div class="scorecard-rows">${rows}</div>
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
      const data = await apiFetch(`/agents/api/agents/${agentId}/tasks?status=pending`);
      tasks = (data.tasks || []).map(t => ({ ...t, agentName: agentMap[agentId]?.name || '' }));
    } else {
      // Fetch for all agents in parallel
      const results = await Promise.all(DIGEST_AGENTS.map(a =>
        apiFetch(`/agents/api/agents/${a._id}/tasks?status=pending`)
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
    await apiFetch(`/agents/api/agents/${agentId}/tasks/${taskId}`, { method: 'DELETE' });
    renderTaskQueue();
  } catch (_) {}
}

// ── Approval Queue ──────────────────────────────────────────
let _replyTask = null;
const _approvalTaskMap = {}; // taskId -> task object

async function renderApprovalQueue() {
  const panel = document.getElementById('approvalQueue');
  const badge = document.getElementById('approvalQueueBadge');
  if (!panel) return;
  try {
    const data = await apiFetch('/agents/api/tasks/approval-queue');
    const tasks = data.tasks || [];

    // Populate task map for safe lookup by ID
    tasks.forEach(t => { _approvalTaskMap[String(t._id)] = t; });

    if (badge) {
      badge.textContent = tasks.length;
      badge.style.display = tasks.length > 0 ? 'inline-flex' : 'none';
    }

    if (!tasks.length) {
      panel.innerHTML = '<p class="empty-state" style="font-size:0.72rem;padding:0.5rem 0;color:#555">No pending approvals</p>';
      return;
    }

    panel.innerHTML = tasks.map(t => {
      const id = String(t._id);
      const agentId = String(t.agentId);
      const q = t.questionAsked || '';
      return `
        <div class="approval-item" onclick="openReplyModal('${id}')">
          <div class="approval-item-header">
            <span class="approval-agent-tag">${escHtml(t.agentName)}</span>
            <span class="approval-item-time">${relTime(t.askedAt || t.createdAt)}</span>
          </div>
          <div class="approval-item-title">${escHtml(t.title)}</div>
          ${q ? `<div class="approval-item-question">${escHtml(q.substring(0, 120))}${q.length > 120 ? '…' : ''}</div>` : ''}
          <div class="approval-quick-row">
            <button class="approval-thumb approval-thumb-up" onclick="event.stopPropagation();quickApprove('${agentId}','${id}','approve')" title="Approve">👍</button>
            <button class="approval-thumb approval-thumb-down" onclick="event.stopPropagation();quickApprove('${agentId}','${id}','reject')" title="Reject">👎</button>
            <button class="approval-open-btn" onclick="event.stopPropagation();openReplyModal('${id}')">Reply ›</button>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    if (panel) panel.innerHTML = `<p class="empty-state" style="color:#ff4444;font-size:0.72rem">${err.message}</p>`;
  }
}

async function quickApprove(agentId, taskId, action) {
  const msg = action === 'approve' ? 'Yes, approved. Go ahead.' : 'No, do not proceed with this.';
  try {
    await apiFetch(`/agents/api/agents/${agentId}/tasks/${taskId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    showToast(action === 'approve' ? 'Approved ✓' : 'Rejected ✓', 'success');
    delete _approvalTaskMap[taskId];
    renderApprovalQueue();
    refreshScorecard();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

function openReplyModal(taskId) {
  const task = _approvalTaskMap[taskId];
  if (!task) return;
  _replyTask = task;
  document.getElementById('replyModalTitle').textContent = 'Reply to Agent';
  document.getElementById('replyAgentLabel').textContent = task.agentName || 'Agent';
  document.getElementById('replyQuestionBox').textContent = task.questionAsked || task.title || '';
  document.getElementById('replyTextarea').value = '';
  document.getElementById('replyAddContext').checked = false;
  document.getElementById('approvalReplyModal').classList.add('active');
}

function closeReplyModal() {
  document.getElementById('approvalReplyModal').classList.remove('active');
  _replyTask = null;
}

async function submitQuickReply(action) {
  if (!_replyTask) return;
  const msg = action === 'approve' ? 'Yes, approved. Go ahead.' : 'No, do not proceed with this.';
  await _sendReply(msg, false);
}

async function submitCustomReply() {
  if (!_replyTask) return;
  const msg = document.getElementById('replyTextarea').value.trim();
  if (!msg) return showToast('Enter a reply first', 'error');
  const addCtx = document.getElementById('replyAddContext').checked;
  await _sendReply(msg, addCtx);
}

async function _sendReply(msg, addToContext) {
  if (!_replyTask) return;
  const agentId = String(_replyTask.agentId);
  const taskId = String(_replyTask._id);
  try {
    await apiFetch(`/agents/api/agents/${agentId}/tasks/${taskId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    if (addToContext) {
      // Promote the task question + reply into KB as context
      await apiFetch(`/agents/api/agents/${agentId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Approval: ${_replyTask.title}`,
          content: `Question: ${_replyTask.questionAsked || _replyTask.title}\n\nHuman reply: ${msg}`,
          type: 'finding'
        })
      }).catch(() => {});
    }
    showToast('Reply sent', 'success');
    delete _approvalTaskMap[taskId];
    closeReplyModal();
    renderApprovalQueue();
    refreshScorecard();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
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
    await apiFetch(`/agents/api/agents/${agentId}/actions/${actionId}/promote-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'medium' })
    });
    showToast('Task queued', 'success');
    renderTaskQueue();
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

async function promoteDigestAction(agentId, actionId, target) {
  try {
    await apiFetch(`/agents/api/agents/${agentId}/actions/${actionId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    showToast(target === 'knowledge' ? '→ Added to KB' : '→ Added to Notes', 'success');
  } catch (err) {
    showToast('Failed: ' + err.message, 'error');
  }
}

async function deleteDigestAction(agentId, actionId) {
  if (!confirm('Delete this action?')) return;
  try {
    await apiFetch(`/agents/api/agents/${agentId}/actions/${actionId}`, { method: 'DELETE' });
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

// ── Background state seeding (replaces old bg controls panel) ─
async function seedBgState() {
  try {
    const data = await apiFetch('/agents/api/background/status');
    data.processes.forEach(p => {
      bgState[p.agentId] = { running: true, runCount: p.runCount, lastRun: p.lastRun };
    });
    refreshScorecard();
  } catch (_) {}
}

function updateScoreboardRow(agentId) {
  const st = bgState[agentId] || {};
  const dot = document.getElementById(`sc-dot-${agentId}`);
  if (dot) {
    dot.style.background = st.running ? '#00ff88' : '#333';
    dot.title = st.running ? 'Background running' : 'Background stopped';
  }
  const btn = document.getElementById(`sc-btn-${agentId}`);
  if (btn) {
    btn.className = `btn-xs ${st.running ? 'btn-danger' : 'btn-secondary'}`;
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
    // Subscribe to DB I/O monitor
    agentSocket.emit('db:subscribe');
  });
  agentSocket.on('disconnect', () => document.getElementById('liveDot').classList.remove('live'));
  agentSocket.on('action:new', ({ action }) => {
    if (!action) return;
    allActions.unshift(action);
    const feed = document.getElementById('digestFeed');
    const placeholder = feed.querySelector('.empty-state, .loading');
    if (placeholder) placeholder.remove();
    feed.insertAdjacentHTML('afterbegin', renderActionCard(action));
    fixMobileCards(feed);
    renderStats();
    showToast(`New: ${action.title}`, 'info');
    renderApprovalQueue(); // refresh in case new task is needs_human
  });

  agentSocket.on('db:snapshot', (events) => {
    const list = document.getElementById('dbMonitor');
    if (!list) return;
    if (!events.length) { list.innerHTML = '<p class="db-empty">No events yet</p>'; return; }
    list.innerHTML = events.map(renderDbEvent).join('');
  });

  agentSocket.on('db:event', (event) => {
    pushDbEvent(event);
  });

  agentSocket.on('background:started', ({ agentId }) => {
    if (!bgState[agentId]) bgState[agentId] = {};
    bgState[agentId].running = true;
    bgState[agentId].runCount = bgState[agentId].runCount || 0;
    updateScoreboardRow(agentId);
  });
  agentSocket.on('background:stopped', ({ agentId }) => {
    if (!bgState[agentId]) bgState[agentId] = {};
    bgState[agentId].running = false;
    updateScoreboardRow(agentId);
  });
  agentSocket.on('background:tick', ({ agentId, runCount, lastRun, productivityScore, consecutiveIdle }) => {
    if (!bgState[agentId]) bgState[agentId] = { running: true };
    bgState[agentId].runCount = runCount;
    bgState[agentId].lastRun = lastRun;
    if (productivityScore !== undefined) bgState[agentId].productivityScore = productivityScore;
    if (consecutiveIdle !== undefined) bgState[agentId].consecutiveIdle = consecutiveIdle;
    // Update scorecard tick count live
    const tickEl = document.getElementById(`sc-ticks-${agentId}`);
    if (tickEl) tickEl.textContent = runCount + 't';
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

// ── Context Debug Modal ─────────────────────────────────────
function openContextModal(agentId) {
  const modal = document.getElementById('contextDebugModal');
  const sel = document.getElementById('ctxAgentSelect');
  if (agentId) sel.value = agentId;
  modal.classList.add('active');
  loadContextDebug(sel.value);
}

function closeContextModal() {
  document.getElementById('contextDebugModal').classList.remove('active');
}

async function loadContextDebug(agentId) {
  const body = document.getElementById('ctxModalBody');
  if (!agentId) { body.innerHTML = '<p class="empty-state">No agent selected</p>'; return; }
  body.innerHTML = '<p class="loading">Loading context...</p>';
  document.getElementById('ctxModalTitle').textContent = 'Context Debug — ' + (agentMap[agentId]?.name || agentId);

  try {
    const data = await apiFetch(`/agents/api/agents/${agentId}/context-debug`);
    body.innerHTML = renderContextDebug(data);
  } catch (err) {
    body.innerHTML = `<p style="color:#ff4444">Error: ${escHtml(err.message)}</p>`;
  }
}

async function saveTickInterval(agentId) {
  const input = document.getElementById('ctxIntervalInput');
  const msg = document.getElementById('ctxIntervalMsg');
  const val = parseInt(input.value);
  if (!val || val < 1) { msg.textContent = 'Min 1 min'; msg.style.color = '#ff4444'; return; }
  msg.textContent = 'Saving…'; msg.style.color = '#555';
  try {
    const data = await apiFetch(`/agents/api/agents/${agentId}/background/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backgroundInterval: val })
    });
    msg.textContent = data.restarted ? `Saved & restarted (${val}m)` : `Saved (${val}m)`;
    msg.style.color = '#00ff88';
    setTimeout(() => { msg.textContent = ''; }, 3000);
  } catch (err) {
    msg.textContent = 'Error: ' + err.message;
    msg.style.color = '#ff4444';
  }
}

function renderContextDebug(data) {
  const sections = [];

  // ── Productivity + Interval control ──
  const p = data.bgProductivity || {};
  const scoreColor = !p.score ? '#888' : p.score >= 60 ? '#00ff88' : p.score >= 30 ? '#ffaa00' : '#ff4444';
  const runningDot = data.backgroundRunning
    ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#00ff88;margin-right:0.3rem;vertical-align:middle"></span>`
    : `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#333;margin-right:0.3rem;vertical-align:middle"></span>`;
  const agentIdForCtrl = document.getElementById('ctxAgentSelect').value;
  sections.push(`
    <div class="ctx-section">
      <div class="ctx-section-title">Background</div>
      <div style="display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center;font-size:0.78rem;color:#999;margin-bottom:0.7rem">
        <span>${runningDot}<strong style="color:#ccc">${data.backgroundRunning ? 'Running' : 'Stopped'}</strong></span>
        <span>Score: <strong style="color:${scoreColor}">${p.score ?? '–'}/100</strong></span>
        <span>Active ticks: <strong style="color:#ccc">${p.activeTicks ?? 0}/${p.totalTicks ?? 0}</strong></span>
        <span>Idle streak: <strong style="color:${(p.consecutiveIdle||0)>0?'#ffaa00':'#ccc'}">${p.consecutiveIdle ?? 0}</strong></span>
      </div>
      <div class="ctx-interval-row">
        <label style="font-size:0.72rem;color:#666">Tick interval</label>
        <input type="number" id="ctxIntervalInput" value="${data.backgroundInterval ?? 2}" min="1" max="1440"
          style="width:64px;background:#0d0d0d;border:1px solid #2a2a2a;color:#ccc;border-radius:4px;padding:0.2rem 0.4rem;font-size:0.8rem;text-align:center">
        <span style="font-size:0.72rem;color:#555">min</span>
        <button class="btn-xs btn-secondary" onclick="saveTickInterval('${agentIdForCtrl}')">Save</button>
        <span id="ctxIntervalMsg" style="font-size:0.72rem;color:#555"></span>
      </div>
    </div>`);

  // ── Background Tick History ──
  if (data.bgTickHistory?.length) {
    const rows = data.bgTickHistory.map((t, i) => {
      const ts = new Date(t.timestamp);
      const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + ts.toLocaleDateString();
      const idleBadge = t.idle ? '<span style="color:#ff4444;font-size:0.68rem;margin-left:0.3rem">[idle]</span>' : '';
      return `
        <div class="ctx-tick-item${t.idle ? ' ctx-tick-idle' : ''}">
          <div class="ctx-tick-header">
            <span class="ctx-tick-num">#${data.bgTickHistory.length - i}</span>
            <span class="ctx-tick-title">${escHtml(t.title || '–')}${idleBadge}</span>
            <span class="ctx-tick-time">${timeStr}</span>
          </div>
          ${t.summary ? `<div class="ctx-tick-body">${escHtml(t.summary)}</div>` : ''}
          ${t.nextFocus ? `<div class="ctx-tick-next">→ ${escHtml(t.nextFocus)}</div>` : ''}
        </div>`;
    }).join('');
    sections.push(`<div class="ctx-section"><div class="ctx-section-title">Background Tick History (last ${data.bgTickHistory.length})</div>${rows}</div>`);
  } else {
    sections.push(`<div class="ctx-section"><div class="ctx-section-title">Background Tick History</div><p class="empty-state" style="padding:0.5rem 0;font-size:0.75rem">No ticks yet</p></div>`);
  }

  // ── Chat Conversations ──
  if (data.conversations?.length) {
    const rows = data.conversations.map((c, i) => {
      const ts = new Date(c.timestamp).toLocaleString();
      const uMsg = (c.userMessage || '').substring(0, 200);
      const aMsg = (c.agentResponse || '').substring(0, 300);
      return `
        <div class="ctx-conv-item">
          <div class="ctx-conv-meta">${ts}${c.tokenCount ? ` · ${c.tokenCount} tok` : ''}</div>
          <div class="ctx-conv-user"><span class="ctx-speaker">User</span> ${escHtml(uMsg)}${uMsg.length < (c.userMessage||'').length ? '…' : ''}</div>
          <div class="ctx-conv-agent"><span class="ctx-speaker agent">Agent</span> ${escHtml(aMsg)}${aMsg.length < (c.agentResponse||'').length ? '…' : ''}</div>
        </div>`;
    }).join('');
    sections.push(`<div class="ctx-section"><div class="ctx-section-title">Chat Conversations (last ${data.conversations.length})</div>${rows}</div>`);
  } else {
    sections.push(`<div class="ctx-section"><div class="ctx-section-title">Chat Conversations</div><p class="empty-state" style="padding:0.5rem 0;font-size:0.75rem">No conversations yet</p></div>`);
  }

  // ── Recent Actions ──
  if (data.recentActions?.length) {
    const rows = data.recentActions.map(a => {
      const typeColor = TYPE_COLORS[a.type] || '#888';
      const ts = new Date(a.createdAt).toLocaleString();
      return `
        <div class="ctx-action-item">
          <span class="action-type-badge" style="color:${typeColor};border-color:${typeColor}33;background:${typeColor}11;font-size:0.65rem">${a.type.replace('_',' ')}</span>
          <span style="color:#ccc;font-weight:600">${escHtml(a.title)}</span>
          <span class="ctx-tick-time">${ts}</span>
          ${a.tokens ? `<span style="color:#555;font-size:0.68rem">${a.tokens}tok</span>` : ''}
        </div>`;
    }).join('');
    sections.push(`<div class="ctx-section"><div class="ctx-section-title">Recent Actions (last ${data.recentActions.length})</div>${rows}</div>`);
  }

  // ── Memory snippets ──
  const memParts = [];
  if (data.threadSummary) memParts.push(`<div class="ctx-mem-block"><div class="ctx-mem-label">Thread Summary</div><div class="ctx-mem-text">${escHtml(data.threadSummary.substring(0, 600))}${data.threadSummary.length > 600 ? '…' : ''}</div></div>`);
  if (data.longTermMemory) memParts.push(`<div class="ctx-mem-block"><div class="ctx-mem-label">Long-term Memory / Notes</div><div class="ctx-mem-text">${escHtml(data.longTermMemory.substring(0, 600))}${data.longTermMemory.length > 600 ? '…' : ''}</div></div>`);
  if (data.bgFindings) memParts.push(`<div class="ctx-mem-block"><div class="ctx-mem-label">BG Findings (last 2000 chars)</div><div class="ctx-mem-text">${escHtml(data.bgFindings.substring(0, 800))}${data.bgFindings.length > 800 ? '…' : ''}</div></div>`);
  if (data.knowledgeBase?.length) {
    const kbRows = data.knowledgeBase.map(e => `<div class="ctx-mem-block"><div class="ctx-mem-label">[${(e.type||'context').toUpperCase()}] ${escHtml(e.title||'')}</div><div class="ctx-mem-text">${escHtml((e.content||'').substring(0,300))}${(e.content||'').length>300?'…':''}</div></div>`).join('');
    memParts.push(kbRows);
  }
  if (memParts.length) sections.push(`<div class="ctx-section"><div class="ctx-section-title">Memory Context</div>${memParts.join('')}</div>`);

  return sections.join('');
}

// ── Card Menu ──────────────────────────────────────────────
let _menuAction = null;
let _newAgentPrompt = '';

function initCardMenu() {
  const popup = document.createElement('div');
  popup.id = 'cardMenuPopup';
  popup.className = 'card-menu-popup';
  popup.innerHTML = `
    <button onclick="cardMenuDo('json')">↓ Download JSON</button>
    <button onclick="cardMenuDo('prompt')">📋 Copy as Prompt</button>
    <div class="menu-sep"></div>
    <button onclick="cardMenuDo('send')">💬 Send to Agent</button>
    <button onclick="cardMenuDo('agent')">🤖 New Agent</button>
    <button onclick="cardMenuDo('action')">⚡ Create Action</button>
    <button onclick="cardMenuDo('cron')">⏰ Schedule Cron</button>
    <div class="menu-sep"></div>
    <button id="cardMenuPinBtn" onclick="cardMenuDo('pin')">📌 Pin</button>
  `;
  document.body.appendChild(popup);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#cardMenuPopup') && !e.target.classList.contains('btn-menu')) {
      popup.style.display = 'none';
    }
  });
}

function openCardMenu(event, actionId) {
  event.stopPropagation();
  const action = allActions.find(a => a._id === actionId);
  if (!action) return;
  _menuAction = action;
  const popup = document.getElementById('cardMenuPopup');
  popup.style.display = 'block';
  const rect = event.currentTarget.getBoundingClientRect();
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    // On mobile the CSS sheet override handles left/width; just anchor top below button
    popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  } else {
    const popupW = 185;
    let left = rect.right - popupW;
    if (left < 8) left = 8;
    if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8;
    // Flip above button if not enough space below
    const popupH = 230;
    const top = rect.bottom + 4 + popupH > window.innerHeight
      ? rect.top + window.scrollY - popupH - 4
      : rect.bottom + window.scrollY + 4;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }
  const pinBtn = document.getElementById('cardMenuPinBtn');
  if (pinBtn) pinBtn.innerHTML = getPinnedIds().has(actionId) ? '📌 Unpin' : '📌 Pin';
}

function cardMenuDo(mode) {
  document.getElementById('cardMenuPopup').style.display = 'none';
  if (!_menuAction) return;
  const a = _menuAction;
  if (mode === 'json')   downloadCardJson(a);
  if (mode === 'prompt') copyCardPrompt(a);
  if (mode === 'send')   openSendToAgentModal(a);
  if (mode === 'agent')  openNewAgentModal(a);
  if (mode === 'action') openCreateActionModal(a);
  if (mode === 'cron')   openCronModal(a);
  if (mode === 'pin')    togglePin(a._id);
}

// ── Download JSON ──────────────────────────────────────────
function downloadCardJson(action) {
  const blob = new Blob([JSON.stringify(action, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url; el.download = `action-${action._id}.json`; el.click();
  URL.revokeObjectURL(url);
}

// ── Copy as Prompt ─────────────────────────────────────────
function copyCardPrompt(action) {
  navigator.clipboard.writeText(`${action.title}\n\n${action.content}`).then(
    () => showToast('Copied to clipboard', 'success'),
    () => showToast('Copy failed', 'error')
  );
}

// ── Send to Agent ──────────────────────────────────────────
function openSendToAgentModal(action) {
  const opts = agentOptions();
  const preview = (action.title + '\n\n' + action.content).substring(0, 300);
  openExportModal('Send to Agent', `
    <div class="export-modal-section">
      <div class="export-modal-label">Target agent</div>
      <select class="export-modal-select" id="sendAgentSelect">${opts}</select>
    </div>
    <div class="export-modal-section">
      <div class="export-modal-label">Prefix message (optional)</div>
      <textarea class="export-modal-input" id="sendPrefix" rows="2" placeholder="Add context for the agent…" style="resize:vertical;width:100%;box-sizing:border-box"></textarea>
    </div>
    <div class="export-modal-section">
      <div class="export-modal-label">Content preview</div>
      <div class="export-modal-preview">${escHtml(preview)}${action.content.length > 300 ? '…' : ''}</div>
    </div>
    <div class="export-modal-footer">
      <button class="btn-secondary btn-sm" onclick="closeExportModal()">Cancel</button>
      <button class="btn-primary btn-sm" onclick="submitSendToAgent()">Send</button>
    </div>
  `);
}

async function submitSendToAgent() {
  const agentId = document.getElementById('sendAgentSelect')?.value;
  const prefix = document.getElementById('sendPrefix')?.value?.trim() || '';
  const action = _menuAction;
  if (!agentId || !action) return;
  const message = prefix
    ? `${prefix}\n\n---\n**${action.title}**\n${action.content}`
    : `**${action.title}**\n\n${action.content}`;
  try {
    await apiFetch(`/agents/api/agents/${agentId}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    closeExportModal();
    showToast('Sent to agent', 'success');
  } catch (err) { showToast('Send failed: ' + err.message, 'error'); }
}

// ── New Agent ──────────────────────────────────────────────
function openNewAgentModal(action) {
  _newAgentPrompt = `You are an AI agent specializing in:\n\n${action.title}\n\n${action.content.substring(0, 800)}`;
  const preview = _newAgentPrompt.substring(0, 400);
  openExportModal('New Agent from this', `
    <div class="export-modal-section">
      <div class="export-modal-label">Pre-filled system prompt (based on this finding)</div>
      <div class="export-modal-preview">${escHtml(preview)}${_newAgentPrompt.length > 400 ? '…' : ''}</div>
    </div>
    <div class="export-modal-footer" style="flex-direction:column;gap:0.5rem;align-items:stretch">
      <button class="btn-secondary btn-sm" onclick="copyNewAgentPrompt()">📋 Copy system prompt</button>
      <a href="/agents" class="btn-primary btn-sm" style="text-align:center;text-decoration:none;display:block;padding:0.5rem 1rem" onclick="closeExportModal()">→ Go to Agent Dashboard</a>
      <button class="btn-secondary btn-sm" onclick="closeExportModal()">Close</button>
    </div>
  `);
}

function copyNewAgentPrompt() {
  navigator.clipboard.writeText(_newAgentPrompt).then(
    () => showToast('System prompt copied — paste in new agent creator', 'success'),
    () => showToast('Copy failed', 'error')
  );
}

// ── Create Action ──────────────────────────────────────────
function openCreateActionModal(action) {
  const srcId = action.agentId?._id || action.agentId;
  const opts = agentOptions(srcId);
  openExportModal('Create Action', `
    <div class="export-modal-section">
      <div class="export-modal-label">Target agent</div>
      <select class="export-modal-select" id="createActionAgent">${opts}</select>
    </div>
    <div class="export-modal-section">
      <div class="export-modal-label">Type</div>
      <select class="export-modal-select" id="createActionType">
        <option value="finding">Finding</option>
        <option value="tldr">TLDR</option>
        <option value="background">Background</option>
      </select>
    </div>
    <div class="export-modal-section">
      <div class="export-modal-label">Preview</div>
      <div class="export-modal-preview">${escHtml((action.title + ': ' + action.content).substring(0, 300))}</div>
    </div>
    <div class="export-modal-footer">
      <button class="btn-secondary btn-sm" onclick="closeExportModal()">Cancel</button>
      <button class="btn-primary btn-sm" onclick="submitCreateAction()">Create</button>
    </div>
  `);
}

async function submitCreateAction() {
  const agentId = document.getElementById('createActionAgent')?.value;
  const type = document.getElementById('createActionType')?.value;
  const action = _menuAction;
  if (!agentId || !action) return;
  try {
    await apiFetch(`/agents/api/agents/${agentId}/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: action.title, content: action.content, type })
    });
    closeExportModal();
    showToast('Action created', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

// ── Schedule Cron ──────────────────────────────────────────
function openCronModal(action) {
  const srcId = action.agentId?._id || action.agentId;
  const opts = agentOptions(srcId);
  openExportModal('Schedule Cron', `
    <div class="export-modal-section">
      <div class="export-modal-label">Agent</div>
      <select class="export-modal-select" id="cronAgent">${opts}</select>
    </div>
    <div class="export-modal-section">
      <div class="export-modal-label">Task title</div>
      <input class="export-modal-input" id="cronTitle" type="text" value="${escHtml(action.title)}" style="width:100%;box-sizing:border-box">
    </div>
    <div class="export-modal-section">
      <div class="export-modal-label">Repeat every (minutes)</div>
      <div style="display:flex;align-items:center;gap:0.4rem">
        <input class="export-modal-input" id="cronInterval" type="number" value="60" min="5" max="10080" style="width:90px">
        <span style="font-size:0.72rem;color:#555">min &nbsp;(5 min – 7 days)</span>
      </div>
    </div>
    <div class="export-modal-section">
      <div class="export-modal-label">Content injected as task each run</div>
      <div class="export-modal-preview">${escHtml(action.content.substring(0, 300))}${action.content.length > 300 ? '…' : ''}</div>
    </div>
    <div class="export-modal-footer">
      <button class="btn-secondary btn-sm" onclick="closeExportModal()">Cancel</button>
      <button class="btn-primary btn-sm" onclick="submitCron()">Schedule</button>
    </div>
  `);
}

async function submitCron() {
  const agentId = document.getElementById('cronAgent')?.value;
  const title = document.getElementById('cronTitle')?.value?.trim();
  const interval = parseInt(document.getElementById('cronInterval')?.value) || 60;
  const action = _menuAction;
  if (!agentId || !title || !action) return;
  try {
    await apiFetch(`/agents/api/agents/${agentId}/crons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content: action.content, intervalMinutes: interval })
    });
    closeExportModal();
    showToast(`Cron scheduled — repeats every ${interval}m`, 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

// ── Pin Board ──────────────────────────────────────────────
function getPinnedIds() {
  try { return new Set(JSON.parse(localStorage.getItem('digest_pins') || '[]')); }
  catch { return new Set(); }
}

function savePinnedIds(set) {
  localStorage.setItem('digest_pins', JSON.stringify([...set]));
}

function togglePin(actionId) {
  const pins = getPinnedIds();
  if (pins.has(actionId)) { pins.delete(actionId); showToast('Unpinned', 'info'); }
  else { pins.add(actionId); showToast('📌 Pinned', 'success'); }
  savePinnedIds(pins);
  renderPinBoard();
}

function renderPinBoard() {
  const section = document.getElementById('pinBoardSection');
  if (!section) return;
  const pins = getPinnedIds();
  const pinned = allActions.filter(a => pins.has(a._id));
  const countEl = document.getElementById('pinBoardCount');
  if (countEl) countEl.textContent = pinned.length || '';
  const grid = document.getElementById('pinBoardGrid');
  if (!grid) return;
  if (!pinned.length) {
    grid.innerHTML = '<p class="pin-board-empty">No pinned items — click ⋯ on a card to pin.</p>';
    section.classList.remove('pin-board-open');
    return;
  }
  grid.innerHTML = pinned.map(a => renderActionCard(a, true)).join('');
  section.classList.add('pin-board-open');
}

// ── Mobile card fix ────────────────────────────────────────
// The global AI-overhaul CSS sets animation:digestCardIn with fill-mode:both
// on .digest-card, which comes after the @media mobile block and overrides it.
// Directly zeroing inline styles guarantees no transform/stacking-context overlap.
function fixMobileCards(container) {
  if (window.innerWidth > 768) return;
  container.querySelectorAll('.digest-card').forEach(el => {
    el.style.cssText += ';animation:none!important;transform:none!important;position:relative!important';
  });
}

// ── DB I/O Monitor ─────────────────────────────────────────
function renderDbEvent(e) {
  const isWrite = e.op === 'write';
  const color   = isWrite ? '#ff88cc' : '#6ec6ff';
  const icon    = isWrite ? '↑' : '↓';
  const agentName = e.agentId ? (agentMap[e.agentId]?.name || '') : '';
  const label   = e.label ? `<span class="db-label">${escHtml(e.label)}</span>` : '';
  const agent   = agentName ? `<span class="db-agent-tag">${escHtml(agentName)}</span>` : '';
  return `
    <div class="db-event-row">
      <span class="db-op-badge" style="color:${color}">${icon} ${e.op}</span>
      <span class="db-col-name">${escHtml(e.collection)}</span>
      ${agent}${label}
      <span class="db-ts">${timeSince(e.ts)}</span>
    </div>`;
}

function pushDbEvent(event) {
  const list = document.getElementById('dbMonitor');
  if (!list) return;
  const placeholder = list.querySelector('.loading, .db-empty');
  if (placeholder) placeholder.remove();
  list.insertAdjacentHTML('afterbegin', renderDbEvent(event));
  // Cap DOM rows at 30
  const rows = list.querySelectorAll('.db-event-row');
  if (rows.length > 30) rows[rows.length - 1].remove();
  // Flash the status dot
  const dot = document.getElementById('dbMonitorDot');
  if (dot) {
    dot.classList.add('db-monitor-dot-flash');
    setTimeout(() => dot.classList.remove('db-monitor-dot-flash'), 400);
  }
}

function timeSince(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)    return Math.floor(diff / 1000) + 's';
  if (diff < 3600000)  return Math.floor(diff / 60000) + 'm';
  return Math.floor(diff / 3600000) + 'h';
}

// ── Export modal helpers ───────────────────────────────────
function openExportModal(title, bodyHtml) {
  document.getElementById('cardExportModalTitle').textContent = title;
  document.getElementById('cardExportModalBody').innerHTML = bodyHtml;
  document.getElementById('cardExportModal').classList.add('active');
}

function closeExportModal() {
  document.getElementById('cardExportModal').classList.remove('active');
}
