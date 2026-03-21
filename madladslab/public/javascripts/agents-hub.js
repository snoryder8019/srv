/**
 * agents-hub.js — Agent Hub two-panel client
 * Handles sidebar selection, tab loading, socket live updates,
 * namespace reset confirm modal, and org-wide stats.
 */

// ── State ──────────────────────────────────────────────────────────────────
let hubAgentId = null;
let hubCurrentTab = 'notes';
let hubSocket = null;
let hubResetTarget = null; // 'agent' | 'all'
let hubAgentsCache = [];   // raw agent list for sidebar badge updates

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  hubInitSocket();
  hubLoadOrgStats();
  // Pick first agent if any
  const firstRow = document.querySelector('.hub-agent-row');
  if (firstRow) firstRow.click();
});

// ── Socket ─────────────────────────────────────────────────────────────────
function hubInitSocket() {
  hubSocket = io('/agents', { transports: ['websocket', 'polling'], reconnection: true });

  hubSocket.on('background:tick', (data) => {
    const bgEl = document.getElementById(`hub-row-bg-${data.agentId}`);
    if (bgEl) bgEl.style.display = 'inline';
    // Refresh background tab if open
    if (hubAgentId === data.agentId && hubCurrentTab === 'background') {
      hubLoadBackgroundTab(hubAgentId);
    }
  });

  hubSocket.on('background:stopped', (data) => {
    const bgEl = document.getElementById(`hub-row-bg-${data.agentId}`);
    if (bgEl) bgEl.style.display = 'none';
    if (hubAgentId === data.agentId) hubRefreshHeader(hubAgentId);
  });

  hubSocket.on('background:started', (data) => {
    const bgEl = document.getElementById(`hub-row-bg-${data.agentId}`);
    if (bgEl) bgEl.style.display = 'inline';
    if (hubAgentId === data.agentId) hubRefreshHeader(hubAgentId);
  });

  hubSocket.on('action:new', (data) => {
    if (hubAgentId === data.agentId && hubCurrentTab === 'actions') hubLoadActionsTab(hubAgentId);
    // Badge bump happens after full reload
  });

  hubSocket.on('memory:update', (data) => {
    if (hubAgentId === data.agentId && hubCurrentTab === 'memory') hubLoadMemoryTab(hubAgentId);
  });

  hubSocket.on('status:change', (data) => {
    const rowStatus = document.getElementById(`hub-row-status-${data.agentId}`);
    if (rowStatus) rowStatus.className = `hub-row-status status-${data.status}`;
    if (hubAgentId === data.agentId) {
      const hdrStatus = document.getElementById('hubHeaderStatus');
      if (hdrStatus) {
        hdrStatus.className = `hub-header-status status-${data.status}`;
        hdrStatus.innerHTML = `<span class="status-dot"></span>${data.status}`;
      }
    }
  });

  hubSocket.on('log:new', (data) => {
    if (hubAgentId === data.agentId && hubCurrentTab === 'logs') {
      const logsContent = document.getElementById('hubLogsContent');
      if (logsContent) {
        logsContent.insertAdjacentHTML('afterbegin', hubCreateLogEl(data.log));
      }
    }
  });
}

// ── Org Stats ──────────────────────────────────────────────────────────────
async function hubLoadOrgStats() {
  try {
    const [agentsRes, scorecardRes] = await Promise.all([
      fetch('/agents/api/agents'),
      fetch('/agents/api/tasks/scorecard')
    ]);
    const agentsData = await agentsRes.json();
    const scorecardData = await scorecardRes.json();

    if (agentsData.success) {
      hubAgentsCache = agentsData.agents;
      const total = agentsData.agents.length;
      const bgRunning = agentsData.agents.filter(a => a.config?.backgroundRunning).length;
      document.getElementById('hubStatTotal').textContent = `${total} agent${total !== 1 ? 's' : ''}`;
      document.getElementById('hubStatBg').textContent = `${bgRunning} bg running`;

      // Update bg badges in sidebar
      agentsData.agents.forEach(a => {
        const bgEl = document.getElementById(`hub-row-bg-${a._id}`);
        if (bgEl) bgEl.style.display = a.config?.backgroundRunning ? 'inline' : 'none';
      });
    }

    if (scorecardData.success) {
      const t = scorecardData.totals;
      document.getElementById('hubStatTasks').textContent = `${t.pending} task${t.pending !== 1 ? 's' : ''} pending`;
      document.getElementById('hubStatHuman').textContent = `${t.needs_human} needs human`;
      if (t.needs_human > 0) document.getElementById('hubStatHuman').classList.add('hub-stat-alert');

      // Per-agent task badges
      scorecardData.scorecard.forEach(s => {
        const taskEl = document.getElementById(`hub-row-tasks-${s.agentId}`);
        const humanEl = document.getElementById(`hub-row-human-${s.agentId}`);
        if (taskEl) {
          if (s.pending > 0) { taskEl.textContent = s.pending; taskEl.style.display = 'inline'; }
          else taskEl.style.display = 'none';
        }
        if (humanEl) {
          if (s.needs_human > 0) { humanEl.textContent = '!'; humanEl.style.display = 'inline'; }
          else humanEl.style.display = 'none';
        }
      });
    }
  } catch (e) {
    console.error('[Hub] Stats load error:', e);
  }
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function hubFilterAgents(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.hub-agent-row').forEach(row => {
    row.style.display = row.dataset.agentName.includes(q) ? '' : 'none';
  });
}

async function hubSelectAgent(agentId) {
  hubAgentId = agentId;

  // Highlight sidebar row
  document.querySelectorAll('.hub-agent-row').forEach(r => r.classList.remove('active'));
  const row = document.querySelector(`.hub-agent-row[data-agent-id="${agentId}"]`);
  if (row) row.classList.add('active');

  // Subscribe socket
  if (hubSocket) hubSocket.emit('subscribe', agentId);

  // Show detail content
  document.getElementById('hubDetailEmpty').style.display = 'none';
  document.getElementById('hubDetailContent').style.display = 'flex';

  // Mobile: slide to detail view
  if (window.innerWidth <= 640) {
    document.getElementById('hubBody').classList.add('hub-mobile-detail-active');
    document.getElementById('hubBody').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Load header, badges, and default tab in parallel
  await hubRefreshHeader(agentId);
  hubLoadAllBadges(agentId);
  hubSwitchTab('notes');
}

// Pre-load all tab badge counts without rendering tab content
async function hubLoadAllBadges(agentId) {
  try {
    const [notesRes, actionsRes, pendRes, humanRes, cronsRes] = await Promise.all([
      fetch(`/agents/api/agents/${agentId}/notes`),
      fetch(`/agents/api/agents/${agentId}/actions`),
      fetch(`/agents/api/agents/${agentId}/tasks?status=pending`),
      fetch(`/agents/api/agents/${agentId}/tasks?status=needs_human`),
      fetch(`/agents/api/agents/${agentId}/crons`)
    ]);
    const [notes, actions, pend, human, crons] = await Promise.all([
      notesRes.json(), actionsRes.json(), pendRes.json(), humanRes.json(), cronsRes.json()
    ]);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
    set('hub-tbadge-notes',   notes.notes?.length);
    set('hub-tbadge-actions', actions.actions?.length);
    set('hub-tbadge-tasks',   (pend.tasks?.length || 0) + (human.tasks?.length || 0));
    set('hub-tbadge-crons',   crons.crons?.length);
  } catch (e) {
    // badges are non-critical, fail silently
  }
}

function hubMobileBack() {
  document.getElementById('hubBody').classList.remove('hub-mobile-detail-active');
  document.getElementById('hubDetailEmpty').style.display = 'flex';
  document.getElementById('hubDetailContent').style.display = 'none';
  document.querySelectorAll('.hub-agent-row').forEach(r => r.classList.remove('active'));
  hubAgentId = null;
}

async function hubRefreshHeader(agentId) {
  try {
    const res = await fetch(`/agents/api/agents/${agentId}`);
    const data = await res.json();
    if (!data.success) return;
    const a = data.agent;

    const tierColors = { apex: '#ff4444', executive: '#ff9900', manager: '#ffcc00', worker: '#666' };
    const tc = tierColors[a.tier] || '#666';
    const bgRunning = a.config?.backgroundRunning;
    const prod = a.bgProductivity?.score ?? null;

    const avatarLetter = hubEsc(a.name)[0]?.toUpperCase() || '?';
    document.getElementById('hubAgentHeader').innerHTML = `
      <div class="hub-header-top">
        <button class="hub-mobile-back" onclick="hubMobileBack()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <div class="hub-header-avatar" data-agent-id="${a._id}">${avatarLetter}</div>
        <span class="hub-header-name">${hubEsc(a.name)}</span>
      </div>
      <div class="hub-header-sub">
        <span id="hubHeaderStatus" class="hub-header-status status-${a.status}"><span class="status-dot"></span>${a.status}</span>
        <span class="hub-header-chip" style="background:${tc}22;color:${tc};border-color:${tc}44">${a.tier}</span>
        <span class="hub-header-chip">${hubEsc(a.role)}</span>
        <span class="hub-header-chip">${hubEsc(a.model)}</span>
        <span class="hub-header-chip">temp ${a.config.temperature}</span>
        ${bgRunning ? `<span class="hub-header-chip hub-chip-bg">bg running${prod !== null ? ` · ${prod}%` : ''}</span>` : ''}
      </div>
      <div class="hub-header-actions">
        <button class="hub-btn-sm hub-btn-primary" onclick="openChat('${a._id}', '${hubEsc(a.name).replace(/'/g,"\\'")}')">Chat</button>
        ${bgRunning
          ? `<button class="hub-btn-sm hub-btn-stop" onclick="stopBackground('${a._id}')">Stop BG</button>`
          : `<button class="hub-btn-sm" onclick="startBackground('${a._id}')">Start BG</button>`
        }
        ${(a.status === 'running' || a.status === 'idle')
          ? `<button class="hub-btn-sm hub-btn-stop" onclick="toggleStatus('${a._id}', '${a.status}'); setTimeout(()=>hubRefreshHeader('${a._id}'),400)">Stop</button>`
          : `<button class="hub-btn-sm" onclick="toggleStatus('${a._id}', '${a.status}'); setTimeout(()=>hubRefreshHeader('${a._id}'),400)">Start</button>`
        }
        ${hubBuildFwdChatPanel(a)}
        <button class="hub-btn-sm" onclick="hubCloneAgent('${a._id}')">Clone</button>
        <button class="hub-btn-sm hub-btn-warn" onclick="hubConfirmReset('${a._id}', '${hubEsc(a.name).replace(/'/g,"\\'")}')">Reset NSP</button>
      </div>
    `;
  } catch (e) {
    console.error('[Hub] Header load error:', e);
  }
}

// ── Tab Management ─────────────────────────────────────────────────────────
function hubSwitchTab(tab) {
  if (!hubAgentId) return;
  hubCurrentTab = tab;

  document.querySelectorAll('.hub-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.hub-tab-panel').forEach(p => p.classList.toggle('active', p.id === `hub-tab-${tab}`));

  switch (tab) {
    case 'notes':      hubLoadNotesTab(hubAgentId); break;
    case 'actions':    hubLoadActionsTab(hubAgentId); break;
    case 'tasks':      hubLoadTasksTab(hubAgentId); break;
    case 'crons':      hubLoadCronsTab(hubAgentId); break;
    case 'memory':     hubLoadMemoryTab(hubAgentId); break;
    case 'logs':       hubLoadLogsTab(hubAgentId); break;
    case 'background': hubLoadBackgroundTab(hubAgentId); break;
    case 'settings':   hubLoadSettingsTab(hubAgentId); break;
  }
}

// ── Notes Tab ──────────────────────────────────────────────────────────────
async function hubLoadNotesTab(agentId) {
  const el = document.getElementById('hub-tab-notes');
  el.innerHTML = '<div class="hub-loading">Loading…</div>';
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/notes`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const badge = document.getElementById('hub-tbadge-notes');
    if (badge) badge.textContent = data.notes.length || '';

    if (!data.notes.length) {
      el.innerHTML = `<div class="hub-empty">No notes yet — agents write here via the <code>mongo_write</code> MCP tool</div>`;
      return;
    }

    el.innerHTML = `
      <div class="hub-tab-toolbar">
        <span class="hub-tab-count">${data.notes.length} note${data.notes.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="hub-notes-list">
        ${data.notes.map(n => {
          const fields = Object.entries(n).filter(([k]) => !['_id','agentId'].includes(k));
          return `
            <div class="hub-note-card" id="hub-note-${n._id}">
              <div class="hub-note-header">
                <span class="hub-note-id">${String(n._id).slice(-6)}</span>
                <button class="hub-icon-btn hub-btn-delete" onclick="hubDeleteNote('${agentId}','${n._id}')" title="Delete note">✕</button>
              </div>
              <div class="hub-note-fields">
                ${fields.map(([k,v]) => `
                  <div class="hub-note-field">
                    <span class="hub-note-key">${hubEsc(k)}</span>
                    <span class="hub-note-val">${hubEsc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</span>
                  </div>`).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="hub-error">Error: ${hubEsc(e.message)}</div>`;
  }
}

async function hubDeleteNote(agentId, noteId) {
  if (!confirm('Delete this note?')) return;
  await fetch(`/agents/api/agents/${agentId}/notes/${noteId}`, { method: 'DELETE' });
  document.getElementById(`hub-note-${noteId}`)?.remove();
  hubLoadNotesTab(agentId);
}

// ── Actions Tab ────────────────────────────────────────────────────────────
async function hubLoadActionsTab(agentId) {
  const el = document.getElementById('hub-tab-actions');
  el.innerHTML = '<div class="hub-loading">Loading…</div>';
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/actions?limit=80`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const badge = document.getElementById('hub-tbadge-actions');
    if (badge) badge.textContent = data.actions.length || '';

    const typeColors = { background:'#ff88cc', finding:'#00aaff', tldr:'#00ff88', task_list:'#ffcc00', file_write:'#ff9900', image:'#aa88ff' };

    if (!data.actions.length) {
      el.innerHTML = `<div class="hub-empty">No actions recorded yet</div>`;
      return;
    }

    const typeFilter = [...new Set(data.actions.map(a => a.type))];
    const renderContent = c => (typeof marked !== 'undefined') ? marked.parse(c || '') : hubEsc(c || '');

    el.innerHTML = `
      <div class="hub-tab-toolbar">
        <span class="hub-tab-count">${data.actions.length} actions</span>
        <div class="hub-filter-chips" id="hubActionTypeFilter">
          <button class="hub-chip active" data-type="all" onclick="hubFilterActions('all')">all</button>
          ${typeFilter.map(t => `<button class="hub-chip" data-type="${t}" onclick="hubFilterActions('${t}')">${t}</button>`).join('')}
        </div>
      </div>
      <div class="hub-actions-list" id="hubActionsList">
        ${data.actions.map(a => {
          const tc = typeColors[a.type] || '#888';
          const ts = new Date(a.createdAt).toLocaleString();
          const isLong = (a.content || '').length > 400;
          const bodyId = `hap-${a._id}`;
          return `
            <div class="hub-action-card" data-action-type="${a.type}" id="hub-action-${a._id}">
              <div class="hub-action-header">
                <span class="hub-action-type" style="background:${tc}22;color:${tc};border-color:${tc}44">${a.type}</span>
                <span class="hub-action-title">${hubEsc(a.title || '(untitled)')}</span>
                <span class="hub-action-ts">${ts}</span>
                <div class="hub-action-btns">
                  <button class="hub-chip-btn" onclick="hubPromoteAction('${agentId}','${a._id}','knowledge')" title="→ KB">KB</button>
                  <button class="hub-chip-btn" onclick="hubPromoteAction('${agentId}','${a._id}','longterm')" title="→ LTM">LTM</button>
                  <button class="hub-icon-btn hub-btn-delete" onclick="hubDeleteAction('${agentId}','${a._id}')" title="Delete">✕</button>
                </div>
              </div>
              ${a.content ? `
                <div class="hub-action-preview markdown-body${isLong ? ' action-content-collapsed' : ''}" id="${bodyId}">${renderContent(a.content)}</div>
                ${isLong ? `<button class="action-expand-btn" onclick="hubToggleExpand('${bodyId}', this)">Show more</button>` : ''}
              ` : ''}
            </div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="hub-error">Error: ${hubEsc(e.message)}</div>`;
  }
}

function hubFilterActions(type) {
  document.querySelectorAll('#hubActionTypeFilter .hub-chip').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  document.querySelectorAll('#hubActionsList .hub-action-card').forEach(card => {
    card.style.display = (type === 'all' || card.dataset.actionType === type) ? '' : 'none';
  });
}

function hubToggleExpand(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const collapsed = el.classList.toggle('action-content-collapsed');
  btn.textContent = collapsed ? 'Show more' : 'Show less';
}

async function hubDeleteAction(agentId, actionId) {
  if (!confirm('Delete this action?')) return;
  await fetch(`/agents/api/agents/${agentId}/actions/${actionId}`, { method: 'DELETE' });
  document.getElementById(`hub-action-${actionId}`)?.remove();
}

async function hubPromoteAction(agentId, actionId, target) {
  const res = await fetch(`/agents/api/agents/${agentId}/actions/${actionId}/promote`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target })
  });
  const data = await res.json();
  if (data.success) hubShowToast(`Promoted to ${target === 'knowledge' ? 'Knowledge Base' : 'Long-Term Memory'}`, 'success');
  else hubShowToast('Promote failed: ' + data.error, 'error');
}

// ── Tasks Tab ──────────────────────────────────────────────────────────────
async function hubLoadTasksTab(agentId) {
  const el = document.getElementById('hub-tab-tasks');
  el.innerHTML = '<div class="hub-loading">Loading…</div>';
  try {
    const [pendRes, doneRes, humanRes] = await Promise.all([
      fetch(`/agents/api/agents/${agentId}/tasks?status=pending`),
      fetch(`/agents/api/agents/${agentId}/tasks?status=complete`),
      fetch(`/agents/api/agents/${agentId}/tasks?status=needs_human`)
    ]);
    const [pend, done, human] = await Promise.all([pendRes.json(), doneRes.json(), humanRes.json()]);

    const all = [
      ...(human.tasks || []).map(t => ({ ...t, _statusGroup: 'needs_human' })),
      ...(pend.tasks  || []).map(t => ({ ...t, _statusGroup: 'pending' })),
      ...(done.tasks  || []).map(t => ({ ...t, _statusGroup: 'complete' }))
    ];

    const badge = document.getElementById('hub-tbadge-tasks');
    if (badge) badge.textContent = (pend.tasks?.length || 0) + (human.tasks?.length || 0) || '';

    if (!all.length) {
      el.innerHTML = `<div class="hub-empty">No tasks in queue</div>`;
      return;
    }

    const statusColors = { needs_human: '#ff4444', pending: '#ffcc00', complete: '#00ff88' };

    el.innerHTML = `
      <div class="hub-tab-toolbar">
        <span class="hub-tab-count">${human.tasks?.length || 0} needs human · ${pend.tasks?.length || 0} pending · ${done.tasks?.length || 0} complete</span>
        <button class="hub-btn-sm" onclick="hubOpenAddTask('${agentId}')">+ Add Task</button>
      </div>
      <div id="hubAddTaskForm" style="display:none" class="hub-inline-form">
        <input id="hubTaskTitle" type="text" placeholder="Task title" class="hub-input">
        <textarea id="hubTaskDesc" placeholder="Description (optional)" class="hub-textarea" rows="2"></textarea>
        <select id="hubTaskPriority" class="hub-select">
          <option value="low">low priority</option>
          <option value="medium" selected>medium priority</option>
          <option value="high">high priority</option>
          <option value="critical">critical</option>
        </select>
        <div class="hub-inline-form-btns">
          <button class="hub-btn-sm" onclick="hubSubmitTask('${agentId}')">Create Task</button>
          <button class="hub-btn-sm hub-btn-cancel" onclick="document.getElementById('hubAddTaskForm').style.display='none'">Cancel</button>
        </div>
      </div>
      <div class="hub-tasks-list">
        ${all.map(t => {
          const sc = statusColors[t._statusGroup] || '#888';
          const ts = t.createdAt ? new Date(t.createdAt).toLocaleString() : '';
          return `
            <div class="hub-task-card" id="hub-task-${t._id}">
              <div class="hub-task-header">
                <span class="hub-task-status" style="background:${sc}22;color:${sc};border-color:${sc}44">${t._statusGroup.replace('_',' ')}</span>
                <span class="hub-task-title">${hubEsc(t.title)}</span>
                <span class="hub-task-ts">${ts}</span>
                ${t._statusGroup !== 'complete' ? `<button class="hub-icon-btn hub-btn-delete" onclick="hubCancelTask('${agentId}','${t._id}')" title="Cancel">✕</button>` : ''}
              </div>
              ${t.description ? `<div class="hub-task-desc">${hubEsc(t.description)}</div>` : ''}
              ${t._statusGroup === 'needs_human' ? `
                <div class="hub-task-reply-row">
                  <input type="text" id="hub-task-reply-${t._id}" placeholder="Reply to agent…" class="hub-input">
                  <button class="hub-btn-sm" onclick="hubReplyTask('${agentId}','${t._id}')">Send Reply</button>
                </div>` : ''}
              ${t.humanReply ? `<div class="hub-task-human-reply">Human: ${hubEsc(t.humanReply)}</div>` : ''}
            </div>`;
        }).join('')}
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="hub-error">Error: ${hubEsc(e.message)}</div>`;
  }
}

function hubOpenAddTask(agentId) {
  const f = document.getElementById('hubAddTaskForm');
  if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function hubSubmitTask(agentId) {
  const title = document.getElementById('hubTaskTitle')?.value.trim();
  const description = document.getElementById('hubTaskDesc')?.value.trim();
  const priority = document.getElementById('hubTaskPriority')?.value;
  if (!title) return hubShowToast('Title required', 'error');
  const res = await fetch(`/agents/api/agents/${agentId}/tasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description, priority })
  });
  const data = await res.json();
  if (data.success) { hubShowToast('Task created', 'success'); hubLoadTasksTab(agentId); }
  else hubShowToast('Error: ' + data.error, 'error');
}

async function hubCancelTask(agentId, taskId) {
  await fetch(`/agents/api/agents/${agentId}/tasks/${taskId}`, { method: 'DELETE' });
  document.getElementById(`hub-task-${taskId}`)?.remove();
}

async function hubReplyTask(agentId, taskId) {
  const message = document.getElementById(`hub-task-reply-${taskId}`)?.value.trim();
  if (!message) return;
  const res = await fetch(`/agents/api/agents/${agentId}/tasks/${taskId}/reply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  const data = await res.json();
  if (data.success) { hubShowToast('Reply sent', 'success'); hubLoadTasksTab(agentId); }
  else hubShowToast('Error: ' + data.error, 'error');
}

// ── Crons Tab ──────────────────────────────────────────────────────────────
async function hubLoadCronsTab(agentId) {
  const el = document.getElementById('hub-tab-crons');
  el.innerHTML = '<div class="hub-loading">Loading…</div>';
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/crons`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const badge = document.getElementById('hub-tbadge-crons');
    if (badge) badge.textContent = data.crons.length || '';

    el.innerHTML = `
      <div class="hub-tab-toolbar">
        <span class="hub-tab-count">${data.crons.length} active cron${data.crons.length !== 1 ? 's' : ''}</span>
        <button class="hub-btn-sm" onclick="hubOpenAddCron('${agentId}')">+ Add Cron</button>
      </div>
      <div id="hubAddCronForm" style="display:none" class="hub-inline-form">
        <input id="hubCronTitle" type="text" placeholder="Cron title" class="hub-input">
        <textarea id="hubCronContent" placeholder="What the agent should do on each run…" class="hub-textarea" rows="3"></textarea>
        <div style="display:flex;align-items:center;gap:0.5rem">
          <label style="color:#888;font-size:0.82rem">Every</label>
          <input id="hubCronInterval" type="number" min="5" max="10080" value="60" class="hub-input" style="width:80px">
          <label style="color:#888;font-size:0.82rem">minutes</label>
        </div>
        <div class="hub-inline-form-btns">
          <button class="hub-btn-sm" onclick="hubSubmitCron('${agentId}')">Create Cron</button>
          <button class="hub-btn-sm hub-btn-cancel" onclick="document.getElementById('hubAddCronForm').style.display='none'">Cancel</button>
        </div>
      </div>
      ${!data.crons.length ? `<div class="hub-empty">No active crons — scheduled tasks injected into the bg task queue</div>` : `
      <div class="hub-crons-list">
        ${data.crons.map(c => `
          <div class="hub-cron-card" id="hub-cron-${c._id}">
            <div class="hub-cron-header">
              <span class="hub-cron-interval">every ${c.intervalMinutes}m</span>
              <span class="hub-cron-title">${hubEsc(c.title)}</span>
              <span class="hub-cron-next">${c.nextRun ? 'next: ' + new Date(c.nextRun).toLocaleTimeString() : ''}</span>
              <button class="hub-icon-btn hub-btn-delete" onclick="hubDeleteCron('${agentId}','${c._id}')" title="Delete">✕</button>
            </div>
            <div class="hub-cron-content">${hubEsc(c.content)}</div>
          </div>`).join('')}
      </div>`}`;
  } catch (e) {
    el.innerHTML = `<div class="hub-error">Error: ${hubEsc(e.message)}</div>`;
  }
}

function hubOpenAddCron(agentId) {
  const f = document.getElementById('hubAddCronForm');
  if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function hubSubmitCron(agentId) {
  const title = document.getElementById('hubCronTitle')?.value.trim();
  const content = document.getElementById('hubCronContent')?.value.trim();
  const intervalMinutes = parseInt(document.getElementById('hubCronInterval')?.value) || 60;
  if (!title || !content) return hubShowToast('Title and content required', 'error');
  const res = await fetch(`/agents/api/agents/${agentId}/crons`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, intervalMinutes })
  });
  const data = await res.json();
  if (data.success) { hubShowToast('Cron created', 'success'); hubLoadCronsTab(agentId); }
  else hubShowToast('Error: ' + data.error, 'error');
}

async function hubDeleteCron(agentId, cronId) {
  if (!confirm('Disable this cron?')) return;
  await fetch(`/agents/api/agents/${agentId}/crons/${cronId}`, { method: 'DELETE' });
  document.getElementById(`hub-cron-${cronId}`)?.remove();
}

// ── Memory Tab ─────────────────────────────────────────────────────────────
async function hubLoadMemoryTab(agentId) {
  const el = document.getElementById('hub-tab-memory');
  el.innerHTML = '<div class="hub-loading">Loading…</div>';
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/memory`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    const m = data.memory;

    el.innerHTML = `
      <div class="hub-memory-grid">
        <div class="hub-mem-section">
          <div class="hub-mem-section-header">
            <span class="hub-mem-label">Thread Summary</span>
            <span class="hub-mem-count">${m.threadSummary ? 'set' : 'empty'}</span>
          </div>
          <div class="hub-mem-body hub-mem-text">${m.threadSummary ? hubEsc(m.threadSummary) : '<span class="hub-mem-empty">none</span>'}</div>
        </div>

        <div class="hub-mem-section">
          <div class="hub-mem-section-header">
            <span class="hub-mem-label">Long-Term Memory / Notes</span>
            <span class="hub-mem-count">${m.longTermMemory ? 'set' : 'empty'}</span>
          </div>
          <div class="hub-mem-body hub-mem-text">${m.longTermMemory ? hubEsc(m.longTermMemory) : '<span class="hub-mem-empty">none</span>'}</div>
        </div>

        <div class="hub-mem-section">
          <div class="hub-mem-section-header">
            <span class="hub-mem-label">Background Findings</span>
            <span class="hub-mem-count">${m.bgFindings ? 'set' : 'empty'}</span>
          </div>
          <div class="hub-mem-body hub-mem-text">${m.bgFindings ? hubEsc(m.bgFindings) : '<span class="hub-mem-empty">none</span>'}</div>
        </div>

        <div class="hub-mem-section">
          <div class="hub-mem-section-header">
            <span class="hub-mem-label">Knowledge Base</span>
            <span class="hub-mem-count">${(m.knowledgeBase || []).length} entries</span>
          </div>
          <div class="hub-mem-body">
            ${(m.knowledgeBase || []).length === 0
              ? '<span class="hub-mem-empty">empty</span>'
              : (m.knowledgeBase || []).map(kb => `
                <div class="hub-kb-entry">
                  <span class="hub-kb-type">${hubEsc(kb.type)}</span>
                  <span class="hub-kb-title">${hubEsc(kb.title || '')}</span>
                  <p class="hub-kb-content">${hubEsc((kb.content || '').substring(0,200))}${(kb.content || '').length > 200 ? '…' : ''}</p>
                </div>`).join('')}
          </div>
        </div>

        <div class="hub-mem-section">
          <div class="hub-mem-section-header">
            <span class="hub-mem-label">Recent Conversations</span>
            <span class="hub-mem-count">${(m.conversations || []).length}</span>
          </div>
          <div class="hub-mem-body">
            ${(m.conversations || []).length === 0
              ? '<span class="hub-mem-empty">none</span>'
              : (m.conversations || []).slice(0,5).map(c => `
                <div class="hub-convo-entry">
                  <div class="hub-convo-user">U: ${hubEsc((c.userMessage || '').substring(0,120))}</div>
                  <div class="hub-convo-agent">A: ${hubEsc((c.agentResponse || '').substring(0,120))}</div>
                </div>`).join('')}
            ${(m.conversations || []).length > 5 ? `<div class="hub-mem-more">+ ${(m.conversations || []).length - 5} more</div>` : ''}
          </div>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="hub-error">Error: ${hubEsc(e.message)}</div>`;
  }
}

// ── Logs Tab ───────────────────────────────────────────────────────────────
async function hubLoadLogsTab(agentId) {
  const el = document.getElementById('hub-tab-logs');
  el.innerHTML = `
    <div class="hub-tab-toolbar">
      <div class="hub-filter-chips">
        <label><input type="checkbox" id="hubLogInfo" checked onchange="hubFilterLogs()"> info</label>
        <label><input type="checkbox" id="hubLogWarn" checked onchange="hubFilterLogs()"> warn</label>
        <label><input type="checkbox" id="hubLogError" checked onchange="hubFilterLogs()"> error</label>
      </div>
      <button class="hub-btn-sm" onclick="hubLoadLogsTab('${agentId}')">↻ Refresh</button>
    </div>
    <div id="hubLogsContent" class="hub-logs-content"><div class="hub-loading">Loading…</div></div>`;
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/logs`);
    const data = await res.json();
    const container = document.getElementById('hubLogsContent');
    if (!container) return;
    if (data.success && data.logs?.length) {
      container.innerHTML = data.logs.map(l => hubCreateLogEl(l)).join('');
    } else {
      container.innerHTML = '<div class="hub-empty">No logs yet</div>';
    }
  } catch (e) {
    const container = document.getElementById('hubLogsContent');
    if (container) container.innerHTML = `<div class="hub-error">Error: ${hubEsc(e.message)}</div>`;
  }
}

function hubCreateLogEl(log) {
  const ts = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
  return `<div class="hub-log-entry ${log.level || 'info'}">
    <span class="hub-log-ts">${ts}</span>
    <span class="hub-log-level">${log.level || 'info'}</span>
    <span class="hub-log-msg">${hubEsc(log.message || '')}</span>
  </div>`;
}

function hubFilterLogs() {
  const showInfo  = document.getElementById('hubLogInfo')?.checked;
  const showWarn  = document.getElementById('hubLogWarn')?.checked;
  const showError = document.getElementById('hubLogError')?.checked;
  document.querySelectorAll('#hubLogsContent .hub-log-entry').forEach(el => {
    const isInfo  = el.classList.contains('info');
    const isWarn  = el.classList.contains('warning') || el.classList.contains('warn');
    const isError = el.classList.contains('error');
    el.style.display = (isInfo && showInfo) || (isWarn && showWarn) || (isError && showError) ? '' : 'none';
  });
}

// ── Background Tab ─────────────────────────────────────────────────────────
async function hubLoadBackgroundTab(agentId) {
  const el = document.getElementById('hub-tab-background');
  el.innerHTML = '<div class="hub-loading">Loading…</div>';
  try {
    const res = await fetch(`/agents/api/agents/${agentId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    const a = data.agent;
    const bgRunning = a.config?.backgroundRunning;
    const prod = a.bgProductivity || {};
    const ticks = (a.bgTickHistory || []).slice(0, 20);

    el.innerHTML = `
      <div class="hub-bg-header">
        <div class="hub-bg-status ${bgRunning ? 'running' : 'stopped'}">
          <span class="status-dot"></span>
          ${bgRunning ? 'Background Running' : 'Background Stopped'}
        </div>
        <div class="hub-bg-controls">
          ${bgRunning
            ? `<button class="hub-btn-sm hub-btn-stop" onclick="stopBackground('${agentId}')">Stop</button>`
            : `<button class="hub-btn-sm" onclick="startBackground('${agentId}')">Start</button>`
          }
        </div>
        ${prod.score != null ? `
        <div class="hub-bg-prod">
          <span class="hub-prod-label">Productivity</span>
          <div class="hub-prod-bar-wrap"><div class="hub-prod-bar" style="width:${prod.score}%"></div></div>
          <span class="hub-prod-score">${prod.score}%</span>
        </div>` : ''}
      </div>
      <div class="hub-bg-prompt-section">
        <label class="hub-mem-label">Background Prompt</label>
        <textarea id="hubBgPromptInput" class="hub-textarea" rows="3">${hubEsc(a.config?.backgroundPrompt || '')}</textarea>
        <button class="hub-btn-sm" onclick="hubSaveBgPrompt('${agentId}')">Save Prompt</button>
      </div>
      <div class="hub-tick-list">
        <div class="hub-mem-label" style="margin-bottom:0.5rem">Tick History (last ${ticks.length})</div>
        ${!ticks.length ? '<div class="hub-empty">No ticks yet</div>' : ticks.map(t => `
          <div class="hub-tick-entry ${t.idle ? 'idle' : ''}">
            <span class="hub-tick-title">${hubEsc(t.title || '(idle)')}</span>
            ${t.summary ? `<span class="hub-tick-summary">${hubEsc(t.summary.substring(0,120))}</span>` : ''}
            <span class="hub-tick-ts">${t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : ''}</span>
          </div>`).join('')}
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="hub-error">Error: ${hubEsc(e.message)}</div>`;
  }
}

async function hubSaveBgPrompt(agentId) {
  const prompt = document.getElementById('hubBgPromptInput')?.value;
  const res = await fetch(`/agents/api/agents/${agentId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backgroundPrompt: prompt })
  });
  const data = await res.json();
  if (data.success) hubShowToast('Background prompt saved', 'success');
  else hubShowToast('Save failed: ' + (data.error || ''), 'error');
}

// ── Settings Tab ───────────────────────────────────────────────────────────
async function hubLoadSettingsTab(agentId) {
  const el = document.getElementById('hub-tab-settings');
  el.innerHTML = '<div class="hub-loading">Loading…</div>';
  try {
    const [tuningRes, agentRes, grRes, mcpToolsRes, mcpCfgRes] = await Promise.all([
      fetch(`/agents/api/agents/${agentId}/tuning`),
      fetch(`/agents/api/agents/${agentId}`),
      fetch(`/agents/api/agents/${agentId}/guardrails`),
      fetch(`/agents/api/mcp/available-tools`),
      fetch(`/agents/api/agents/${agentId}/mcp`)
    ]);
    const [td, ad, gd, mtd, mcd] = await Promise.all([tuningRes.json(), agentRes.json(), grRes.json(), mcpToolsRes.json(), mcpCfgRes.json()]);
    if (!td.success) throw new Error(td.error);
    const t = td.tuning;
    const a = ad.success ? ad.agent : {};
    const gr = gd.success ? gd.guardrails : {};
    const bih = t.bihBot || {};
    const allTools = mtd.success ? mtd.tools : [];
    const enabledTools = new Set(mcd.success ? (mcd.mcpConfig?.enabledTools || []) : []);
    const bgEnabledTools = new Set(mcd.success ? (mcd.mcpConfig?.backgroundEnabledTools || []) : []);

    el.innerHTML = `
      <div class="hub-settings-form">

        <!-- ── Identity ────────────────────────────────────────── -->
        <div class="hub-settings-group">
          <div class="hub-settings-group-header">
            <span class="hub-settings-group-title">Identity</span>
            <button type="button" class="hub-btn-sm hub-btn-primary" onclick="hubSaveIdentity('${agentId}')">Save</button>
          </div>
          <div class="hub-settings-row">
            <div class="hub-settings-field">
              <label class="hub-mem-label">Name</label>
              <input type="text" id="hubSetName" class="hub-input" value="${hubEsc(a.name || '')}">
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Model</label>
              <select id="hubSetModel" class="hub-select">
                ${['qwen2.5:7b','qwen2.5:14b','llama3.1:8b','deepseek-r1:7b'].map(m => `<option value="${m}"${a.model===m?' selected':''}>${m}</option>`).join('')}
              </select>
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Pipeline Role</label>
              <select id="hubSetRole" class="hub-select">
                <option value="assistant"${a.role==='assistant'?' selected':''}>assistant — standard chat</option>
                <option value="researcher"${a.role==='researcher'?' selected':''}>researcher — TLDR pipeline</option>
                <option value="vibecoder"${a.role==='vibecoder'?' selected':''}>vibecoder — task list pipeline</option>
                <option value="forwardChat"${a.role==='forwardChat'?' selected':''}>forwardChat — consumer deploy</option>
              </select>
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Category</label>
              <select id="hubSetCategory" class="hub-select">
                ${['business','personal','education','research','creative','ops','security','other'].map(c => `<option value="${c}"${a.category===c?' selected':''}>${c}</option>`).join('')}
              </select>
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Tier</label>
              <select id="hubSetTier" class="hub-select">
                ${['apex','executive','manager','worker'].map(tv => `<option value="${tv}"${a.tier===tv?' selected':''}>${tv}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="hub-settings-field" style="margin-top:0.5rem">
            <label class="hub-mem-label">Description</label>
            <textarea id="hubSetDesc" rows="2" class="hub-textarea">${hubEsc(a.description || '')}</textarea>
          </div>
        </div>

        <!-- ── LLM Parameters ─────────────────────────────────── -->
        <div class="hub-settings-group">
          <div class="hub-settings-group-header">
            <span class="hub-settings-group-title">LLM Parameters</span>
            <button type="button" class="hub-btn-sm hub-btn-primary" onclick="hubSaveLLMParams('${agentId}')">Save</button>
          </div>
          <div class="hub-tuning-presets">
            <span class="hub-tuning-presets-label">Quick presets:</span>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('balanced')" title="temp 0.7 · topP 0.9 · topK 40 · rep 1.1">Balanced</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('short')" title="temp 0.4 · maxTokens 512 · rep 1.3">Short &amp; Direct</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('bullets')" title="temp 0.5 · topP 0.85 · rep 1.2">Bullets / Lists</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('precise')" title="temp 0.1 · topP 0.7 · topK 20 · rep 1.4">Precise / Factual</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('code')" title="temp 0.15 · topP 0.8 · topK 15 · rep 1.2">Code</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('creative')" title="temp 1.1 · topP 0.95 · topK 80 · rep 1.05">Creative</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('brainstorm')" title="temp 1.3 · topP 0.98 · topK 100 · rep 1.0">Brainstorm</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('conversational')" title="temp 0.8 · topP 0.9 · rep 1.05">Conversational</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('verbose')" title="temp 0.7 · maxTokens 4096 · rep 1.05">Verbose</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('conservative')" title="temp 0.25 · topP 0.75 · topK 30 · rep 1.35">Conservative</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('json')" title="temp 0.1 · topP 0.7 · topK 10 · rep 1.5 · maxTokens 2048">JSON / Structured</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('terse')" title="temp 0.5 · maxTokens 256 · rep 1.25">Terse / Fast</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('roleplay')" title="temp 0.95 · topP 0.95 · topK 60 · rep 1.03">Roleplay</button>
            <button type="button" class="hub-preset-chip" onclick="hubApplyTuningPreset('academic')" title="temp 0.35 · topP 0.82 · topK 35 · rep 1.3">Academic</button>
          </div>
          <div class="hub-settings-section">
            <label class="hub-mem-label">System Prompt</label>
            <textarea id="hubSettingsPrompt" rows="8" class="hub-textarea">${hubEsc(t.systemPrompt || '')}</textarea>
          </div>
          <div class="hub-settings-row" style="margin-top:0.75rem">
            <div class="hub-settings-field">
              <label class="hub-mem-label">Temperature <span id="hubTempVal">${t.config.temperature}</span></label>
              <input type="range" id="hubTempSlider" min="0" max="2" step="0.05" value="${t.config.temperature}" class="hub-slider"
                oninput="document.getElementById('hubTempVal').textContent=parseFloat(this.value).toFixed(2)">
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Max Tokens</label>
              <input type="number" id="hubMaxTokens" value="${t.config.maxTokens}" step="512" class="hub-input">
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Context Window</label>
              <input type="number" id="hubCtxWindow" value="${t.config.contextWindow || 200000}" step="10000" class="hub-input">
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Top-P <span id="hubTopPVal">${t.config.topP ?? 0.9}</span></label>
              <input type="range" id="hubTopPSlider" min="0" max="1" step="0.05" value="${t.config.topP ?? 0.9}" class="hub-slider"
                oninput="document.getElementById('hubTopPVal').textContent=parseFloat(this.value).toFixed(2)">
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Top-K <span id="hubTopKVal">${t.config.topK ?? 40}</span></label>
              <input type="range" id="hubTopKSlider" min="1" max="200" step="1" value="${t.config.topK ?? 40}" class="hub-slider"
                oninput="document.getElementById('hubTopKVal').textContent=this.value">
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Repeat Penalty <span id="hubRPVal">${t.config.repeatPenalty ?? 1.1}</span></label>
              <input type="range" id="hubRPSlider" min="0.5" max="2" step="0.05" value="${t.config.repeatPenalty ?? 1.1}" class="hub-slider"
                oninput="document.getElementById('hubRPVal').textContent=parseFloat(this.value).toFixed(2)">
            </div>
          </div>
        </div>

        <!-- ── bihBot Config ───────────────────────────────────── -->
        <div class="hub-settings-group">
          <div class="hub-settings-group-header">
            <span class="hub-settings-group-title">bihBot Config</span>
            <button type="button" class="hub-btn-sm hub-btn-primary" onclick="hubSaveBihBot('${agentId}')">Save</button>
          </div>
          <div class="hub-settings-row">
            <div class="hub-settings-field">
              <label class="hub-mem-label">Enabled</label>
              <label class="hub-toggle"><input type="checkbox" id="hubBihEnabled" ${bih.enabled ? 'checked' : ''}><span class="hub-toggle-slider"></span></label>
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Chat Mode</label>
              <select id="hubBihChatMode" class="hub-select">
                <option value="passive"${bih.chatMode==='passive'?' selected':''}>passive — silent by default</option>
                <option value="active"${bih.chatMode==='active'?' selected':''}>active — responds readily</option>
                <option value="agent"${bih.chatMode==='agent'?' selected':''}>agent — always on @mention</option>
              </select>
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Rate Limit (ms)</label>
              <input type="number" id="hubBihRateMs" value="${bih.rateMs ?? 8000}" step="500" min="0" class="hub-input">
            </div>
          </div>
          <div class="hub-settings-row">
            <div class="hub-settings-field">
              <label class="hub-mem-label">Trigger</label>
              <input type="text" id="hubBihTrigger" class="hub-input" value="${hubEsc(bih.trigger || '')}" placeholder="e.g. !bot">
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Display Name</label>
              <input type="text" id="hubBihDisplayName" class="hub-input" value="${hubEsc(bih.displayName || '')}">
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Avatar URL</label>
              <input type="text" id="hubBihAvatar" class="hub-input" value="${hubEsc(bih.avatar || '')}" placeholder="https://…">
            </div>
          </div>
        </div>

        <!-- ── Guardrails ──────────────────────────────────────── -->
        <div class="hub-settings-group">
          <div class="hub-settings-group-header">
            <span class="hub-settings-group-title">Guardrails</span>
            <button type="button" class="hub-btn-sm hub-btn-primary" onclick="hubSaveGuardrails('${agentId}')">Save</button>
          </div>
          <div class="hub-settings-row">
            <div class="hub-settings-field">
              <label class="hub-mem-label">Enabled</label>
              <label class="hub-toggle"><input type="checkbox" id="hubGrEnabled" ${gr.enabled ? 'checked' : ''}><span class="hub-toggle-slider"></span></label>
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Profanity Filter</label>
              <label class="hub-toggle"><input type="checkbox" id="hubGrProfanity" ${gr.profanityFilter ? 'checked' : ''}><span class="hub-toggle-slider"></span></label>
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Lock System Prompt</label>
              <label class="hub-toggle"><input type="checkbox" id="hubGrPromptLock" ${gr.systemPromptLock !== false ? 'checked' : ''}><span class="hub-toggle-slider"></span></label>
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Max Response Length <span style="color:#555;font-size:0.75rem">(0=∞)</span></label>
              <input type="number" id="hubGrMaxLen" value="${gr.maxResponseLength ?? 0}" min="0" step="100" class="hub-input">
            </div>
          </div>
          <div class="hub-settings-row">
            <div class="hub-settings-field">
              <label class="hub-mem-label">Messages / Session <span style="color:#555;font-size:0.75rem">(0=∞)</span></label>
              <input type="number" id="hubGrMsgSession" value="${gr.rateLimit?.messagesPerSession ?? 0}" min="0" class="hub-input">
            </div>
            <div class="hub-settings-field">
              <label class="hub-mem-label">Messages / Hour <span style="color:#555;font-size:0.75rem">(0=∞)</span></label>
              <input type="number" id="hubGrMsgHour" value="${gr.rateLimit?.messagesPerHour ?? 0}" min="0" class="hub-input">
            </div>
          </div>
          <div class="hub-settings-field">
            <label class="hub-mem-label">Allowed Topics <span style="color:#555;font-size:0.75rem">(comma-separated, empty = all)</span></label>
            <input type="text" id="hubGrTopics" class="hub-input" value="${hubEsc((gr.allowedTopics || []).join(', '))}" placeholder="billing, account, support">
          </div>
          <div class="hub-settings-field">
            <label class="hub-mem-label">Blocked Keywords <span style="color:#555;font-size:0.75rem">(comma-separated)</span></label>
            <input type="text" id="hubGrKeywords" class="hub-input" value="${hubEsc((gr.blockedKeywords || []).join(', '))}" placeholder="competitor, refund">
          </div>
          <div class="hub-settings-field">
            <label class="hub-mem-label">Off-Topic Response <span style="color:#555;font-size:0.75rem">(shown when blocked)</span></label>
            <input type="text" id="hubGrOffTopic" class="hub-input" value="${hubEsc(gr.offTopicResponse || '')}" placeholder="I can only help with…">
          </div>
        </div>

        <!-- ── MCP Tools ───────────────────────────────────────── -->
        <div class="hub-settings-group">
          <div class="hub-settings-group-header">
            <span class="hub-settings-group-title">MCP Tools</span>
            <button type="button" class="hub-btn-sm hub-btn-primary" onclick="hubSaveMcpTools('${agentId}')">Save</button>
          </div>
          <div class="hub-mcp-legend">
            <span class="hub-mcp-col-label">Chat</span>
            <span class="hub-mcp-col-label">BG</span>
            <span></span>
          </div>
          ${(() => {
            const cats = {};
            allTools.forEach(tool => {
              const c = tool.category || 'other';
              if (!cats[c]) cats[c] = [];
              cats[c].push(tool);
            });
            return Object.entries(cats).map(([cat, tools]) => `
              <div class="hub-mcp-category">
                <div class="hub-mcp-cat-label">${hubEsc(cat)}</div>
                ${tools.map(tool => `
                  <label class="hub-mcp-row">
                    <input type="checkbox" class="hub-mcp-chat" name="mcpChat" value="${hubEsc(tool.name)}" ${enabledTools.has(tool.name) ? 'checked' : ''}>
                    <input type="checkbox" class="hub-mcp-bg" name="mcpBg" value="${hubEsc(tool.name)}" ${bgEnabledTools.has(tool.name) ? 'checked' : ''}>
                    <span class="hub-mcp-tool-name">${hubEsc(tool.name)}</span>
                    <span class="hub-mcp-tool-desc">${hubEsc(tool.description || '')}</span>
                  </label>
                `).join('')}
              </div>
            `).join('');
          })()}
        </div>

      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="hub-error">Error: ${hubEsc(e.message)}</div>`;
  }
}

async function hubSaveIdentity(agentId) {
  const payload = {
    name: document.getElementById('hubSetName')?.value,
    description: document.getElementById('hubSetDesc')?.value,
    model: document.getElementById('hubSetModel')?.value,
    role: document.getElementById('hubSetRole')?.value,
    category: document.getElementById('hubSetCategory')?.value
  };
  const tier = document.getElementById('hubSetTier')?.value;
  const [r1, r2] = await Promise.all([
    fetch(`/agents/api/agents/${agentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    fetch(`/agents/api/agents/${agentId}/hierarchy`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }) })
  ]);
  const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
  if (d1.success && d2.success) { hubShowToast('Identity saved', 'success'); hubRefreshHeader(agentId); }
  else hubShowToast('Save failed: ' + (d1.error || d2.error || ''), 'error');
}

async function hubSaveLLMParams(agentId) {
  const payload = {
    systemPrompt: document.getElementById('hubSettingsPrompt')?.value,
    temperature: parseFloat(document.getElementById('hubTempSlider')?.value),
    maxTokens: parseInt(document.getElementById('hubMaxTokens')?.value),
    contextWindow: parseInt(document.getElementById('hubCtxWindow')?.value),
    topP: parseFloat(document.getElementById('hubTopPSlider')?.value),
    topK: parseInt(document.getElementById('hubTopKSlider')?.value),
    repeatPenalty: parseFloat(document.getElementById('hubRPSlider')?.value)
  };
  const res = await fetch(`/agents/api/agents/${agentId}/tuning`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.success) { hubShowToast('LLM params saved', 'success'); hubRefreshHeader(agentId); }
  else hubShowToast('Save failed: ' + (data.error || ''), 'error');
}

async function hubSaveBihBot(agentId) {
  const enabled = document.getElementById('hubBihEnabled')?.checked;
  const chatMode = document.getElementById('hubBihChatMode')?.value;
  const trigger = document.getElementById('hubBihTrigger')?.value;
  const displayName = document.getElementById('hubBihDisplayName')?.value;
  const avatar = document.getElementById('hubBihAvatar')?.value;
  const rateMs = parseInt(document.getElementById('hubBihRateMs')?.value) || 8000;
  const [r1, r2, r3] = await Promise.all([
    fetch(`/agents/api/agents/${agentId}/bih-bot`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, trigger, displayName, avatar }) }),
    fetch(`/agents/api/agents/${agentId}/bih-bot/chat-mode`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatMode }) }),
    fetch(`/agents/api/agents/${agentId}/tuning`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bihBot: { rateMs } }) })
  ]);
  const [d1, d2, d3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
  if (d1.success && d2.success && d3.success) hubShowToast('bihBot saved', 'success');
  else hubShowToast('Save failed: ' + (d1.error || d2.error || d3.error || ''), 'error');
}

async function hubSaveGuardrails(agentId) {
  const splitTrim = v => v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
  const payload = {
    enabled: document.getElementById('hubGrEnabled')?.checked,
    profanityFilter: document.getElementById('hubGrProfanity')?.checked,
    systemPromptLock: document.getElementById('hubGrPromptLock')?.checked,
    maxResponseLength: parseInt(document.getElementById('hubGrMaxLen')?.value) || 0,
    allowedTopics: splitTrim(document.getElementById('hubGrTopics')?.value),
    blockedKeywords: splitTrim(document.getElementById('hubGrKeywords')?.value),
    offTopicResponse: document.getElementById('hubGrOffTopic')?.value || '',
    rateLimit: {
      messagesPerSession: parseInt(document.getElementById('hubGrMsgSession')?.value) || 0,
      messagesPerHour: parseInt(document.getElementById('hubGrMsgHour')?.value) || 0
    }
  };
  const res = await fetch(`/agents/api/agents/${agentId}/guardrails`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.success) hubShowToast('Guardrails saved', 'success');
  else hubShowToast('Save failed: ' + (data.error || ''), 'error');
}

async function hubSaveMcpTools(agentId) {
  const chatTools = [...document.querySelectorAll('.hub-mcp-chat:checked')].map(cb => cb.value);
  const bgTools   = [...document.querySelectorAll('.hub-mcp-bg:checked')].map(cb => cb.value);
  const [r1, r2] = await Promise.all([
    fetch(`/agents/api/agents/${agentId}/mcp/enable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tools: chatTools }) }),
    fetch(`/agents/api/agents/${agentId}/background/tools`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tools: bgTools }) })
  ]);
  const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
  if (d1.success && d2.success) hubShowToast('MCP tools saved', 'success');
  else hubShowToast('Save failed: ' + (d1.error || d2.error || ''), 'error');
}

// ── LLM Tuning Presets ─────────────────────────────────────────────────────
const HUB_TUNING_PRESETS = {
  balanced:      { temperature: 0.70, topP: 0.90, topK: 40,  repeatPenalty: 1.10 },
  short:         { temperature: 0.40, topP: 0.85, topK: 40,  repeatPenalty: 1.30, maxTokens: 512  },
  bullets:       { temperature: 0.50, topP: 0.85, topK: 40,  repeatPenalty: 1.20 },
  precise:       { temperature: 0.10, topP: 0.70, topK: 20,  repeatPenalty: 1.40 },
  code:          { temperature: 0.15, topP: 0.80, topK: 15,  repeatPenalty: 1.20 },
  creative:      { temperature: 1.10, topP: 0.95, topK: 80,  repeatPenalty: 1.05 },
  brainstorm:    { temperature: 1.30, topP: 0.98, topK: 100, repeatPenalty: 1.00 },
  conversational:{ temperature: 0.80, topP: 0.90, topK: 50,  repeatPenalty: 1.05 },
  verbose:       { temperature: 0.70, topP: 0.90, topK: 40,  repeatPenalty: 1.05, maxTokens: 4096 },
  conservative:  { temperature: 0.25, topP: 0.75, topK: 30,  repeatPenalty: 1.35 },
  json:          { temperature: 0.10, topP: 0.70, topK: 10,  repeatPenalty: 1.50, maxTokens: 2048 },
  terse:         { temperature: 0.50, topP: 0.85, topK: 40,  repeatPenalty: 1.25, maxTokens: 256  },
  roleplay:      { temperature: 0.95, topP: 0.95, topK: 60,  repeatPenalty: 1.03 },
  academic:      { temperature: 0.35, topP: 0.82, topK: 35,  repeatPenalty: 1.30 },
};

function hubApplyTuningPreset(key) {
  const p = HUB_TUNING_PRESETS[key];
  if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setLabel = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = typeof val === 'number' && val % 1 !== 0 ? val.toFixed(2) : val; };
  if (p.temperature  !== undefined) { set('hubTempSlider',  p.temperature);  setLabel('hubTempVal',  p.temperature); }
  if (p.topP         !== undefined) { set('hubTopPSlider',  p.topP);         setLabel('hubTopPVal',  p.topP); }
  if (p.topK         !== undefined) { set('hubTopKSlider',  p.topK);         setLabel('hubTopKVal',  p.topK); }
  if (p.repeatPenalty!== undefined) { set('hubRPSlider',    p.repeatPenalty);setLabel('hubRPVal',    p.repeatPenalty); }
  if (p.maxTokens    !== undefined) { set('hubMaxTokens',   p.maxTokens); }
  // Highlight active chip
  document.querySelectorAll('.hub-preset-chip').forEach(btn => btn.classList.remove('active'));
  const chip = document.querySelector(`.hub-preset-chip[onclick*="'${key}'"]`);
  if (chip) chip.classList.add('active');
  hubShowToast(`Preset "${key}" applied — save to commit`, 'info');
}

// ── Clone Agent ────────────────────────────────────────────────────────────
// Opens the create modal pre-filled with the source agent's settings.
async function hubCloneAgent(agentId) {
  // Open the modal first (resets form, populates dropdowns)
  if (typeof openCreateAgentModal === 'function') openCreateAgentModal();
  // Give the optgroup population a tick to start, then load preset
  await new Promise(r => setTimeout(r, 50));
  if (typeof loadAgentAsPreset === 'function') await loadAgentAsPreset(agentId);
}

// ── Namespace Reset Modal ──────────────────────────────────────────────────
function hubConfirmReset(agentId, agentName) {
  hubResetTarget = { type: 'agent', id: agentId, name: agentName };
  document.getElementById('hubResetModalTitle').textContent = `Reset Namespaces — ${agentName}`;
  document.getElementById('hubResetModalDesc').textContent = `Wipe selected collections for ${agentName}. This cannot be undone.`;
  document.getElementById('hubResetModal').style.display = 'flex';
}

function hubConfirmResetAll() {
  hubResetTarget = { type: 'all' };
  document.getElementById('hubResetModalTitle').textContent = 'Reset All Agent Namespaces';
  document.getElementById('hubResetModalDesc').textContent = 'Wipe selected collections for ALL agents org-wide. This cannot be undone.';
  document.getElementById('hubResetModal').style.display = 'flex';
}

function hubCloseResetModal() {
  document.getElementById('hubResetModal').style.display = 'none';
  hubResetTarget = null;
}

async function hubExecuteReset() {
  if (!hubResetTarget) return;
  const collections = [];
  if (document.getElementById('hrck-tasks')?.checked)   collections.push('tasks');
  if (document.getElementById('hrck-notes')?.checked)   collections.push('notes');
  if (document.getElementById('hrck-crons')?.checked)   collections.push('crons');
  if (document.getElementById('hrck-actions')?.checked) collections.push('actions');
  const clearMemory = document.getElementById('hrck-memory')?.checked;

  if (!collections.length && !clearMemory) return hubShowToast('Nothing selected', 'error');

  const btn = document.getElementById('hubResetConfirmBtn');
  btn.textContent = 'Resetting…';
  btn.disabled = true;

  try {
    let url, body;
    if (hubResetTarget.type === 'all') {
      url = '/agents/api/agents/namespaces/reset-all';
      body = { collections };
    } else {
      url = `/agents/api/agents/${hubResetTarget.id}/namespaces/reset`;
      body = { collections, clearMemory };
    }
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      const summary = Object.entries(data.deleted).map(([k,v]) => `${k}: ${v}`).join(', ');
      hubShowToast(`Reset complete — ${summary}`, 'success');
      hubCloseResetModal();
      // Reload current tabs
      if (hubAgentId) hubSwitchTab(hubCurrentTab);
      hubLoadOrgStats();
    } else {
      hubShowToast('Reset failed: ' + data.error, 'error');
    }
  } catch (e) {
    hubShowToast('Reset error: ' + e.message, 'error');
  }
  btn.textContent = 'Reset Selected';
  btn.disabled = false;
}

// ── Admin Wipe ─────────────────────────────────────────────────────────────
async function hubAdminWipe(target, label) {
  if (!confirm(`DANGER: Permanently wipe ALL ${label}?\n\nThis cannot be undone.`)) return;
  // Double-confirm for agents collection since it wipes everything
  if (target === 'agents') {
    if (!confirm('FINAL CONFIRMATION: This will delete every agent. Are you absolutely sure?')) return;
  }
  try {
    const res = await fetch('/agents/api/agents/admin/wipe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    const data = await res.json();
    if (data.success) {
      hubShowToast(`Wiped ${target}: ${data.deleted} records deleted`, 'success');
      if (target === 'agents') {
        setTimeout(() => location.reload(), 1200);
      } else {
        if (hubAgentId) hubSwitchTab(hubCurrentTab);
        hubLoadOrgStats();
      }
    } else {
      hubShowToast('Wipe failed: ' + (data.error || 'unknown error'), 'error');
    }
  } catch (e) {
    hubShowToast('Wipe error: ' + e.message, 'error');
  }
}

// ── forwardChat panel builder ──────────────────────────────────────────────
function hubBuildFwdChatPanel(a) {
  const bihOn = a.forwardChat?.bihEnabled;
  const sites = (a.forwardChat?.sites || []).filter(s => s.enabled);
  const total = (bihOn ? 1 : 0) + sites.length;
  const badge = total > 0 ? `<span class="fwdchat-count-badge">${total}</span>` : '';

  const siteTags = sites.map(s => `
    <div class="fwdchat-site-tag active" data-site-id="${s.siteId}">
      <span class="fwdchat-site-dot"></span>
      <span class="fwdchat-site-name">site</span>
      <button onclick="event.stopPropagation(); removeFwdChatSite('${a._id}', '${s.siteId}')" title="Remove">×</button>
    </div>`).join('');

  return `
    <div class="fwdchat-panel hub-fwdchat-panel" id="fwdchat-panel-${a._id}">
      <button class="btn-fwdchat-toggle" onclick="event.stopPropagation(); toggleFwdChatPanel('${a._id}')" title="forwardChat deployments">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.94-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        forwardChat${badge}
      </button>
      <div class="fwdchat-dropdown" id="fwdchat-dd-${a._id}" style="display:none">
        <div class="fwdchat-row">
          <button id="fwdchat-bih-${a._id}"
            class="hub-btn-sm${bihOn ? ' active' : ''}"
            onclick="event.stopPropagation(); toggleFwdChatBih('${a._id}', ${!!bihOn})"
            title="Deploy to bih chat">
            bih: ${bihOn ? 'live' : 'deploy'}
          </button>
        </div>
        <div class="fwdchat-row fwdchat-sites-row">
          <select class="fwdchat-site-select" id="fwdchat-site-sel-${a._id}"
            onclick="event.stopPropagation()"
            onchange="onFwdChatSiteSelect('${a._id}', this.value)">
            <option value="">+ assign site</option>
          </select>
        </div>
        <div class="fwdchat-active-sites" id="fwdchat-sites-${a._id}">${siteTags}</div>
        <div class="fwdchat-footer-row">
          <a href="#" onclick="event.stopPropagation(); event.preventDefault(); openFwdChatSiteManager()" class="fwdchat-manage-link">manage sites</a>
        </div>
      </div>
    </div>`;
}

// ── Create Modal bridge ────────────────────────────────────────────────────
function hubOpenCreate() {
  if (typeof openCreateAgentModal === 'function') {
    openCreateAgentModal();
  } else {
    document.getElementById('createAgentBtn')?.click();
  }
}

// ── Utility ────────────────────────────────────────────────────────────────
function hubEsc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function hubShowToast(msg, type = 'info') {
  // Reuse existing showNotification if available
  if (typeof showNotification === 'function') { showNotification(msg, type); return; }
  const t = document.createElement('div');
  t.className = `hub-toast hub-toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
