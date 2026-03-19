let currentChatAgentId = null;

// Track unread push counts per agent
const chatUnreadCounts = {};

// Create Agent Modal
function openCreateAgentModal() {
  document.getElementById('modalTitle').textContent = 'Spawn New Agent';
  document.getElementById('submitBtnText').textContent = 'Create Agent';
  document.getElementById('agentForm').reset();
  document.getElementById('agentId').value = '';
  document.getElementById('presetSection').style.display = '';
  // Reset preset dropdown
  const presetSel = document.getElementById('presetSelect');
  if (presetSel) presetSel.value = '';
  // Reset domain checkboxes
  document.querySelectorAll('#domainGrid input[type="checkbox"]').forEach(cb => cb.checked = false);
  // Reset dir tree
  document.getElementById('agentWorkingDir').value = '';
  document.getElementById('dirTreeSelectedLabel').textContent = 'not set';
  document.getElementById('dirTreeSelectedLabel').style.color = '';
  if (document.getElementById('dirTreePanel')) document.getElementById('dirTreePanel').style.display = 'none';
  if (document.getElementById('dirTreeToggle')) document.getElementById('dirTreeToggle').textContent = '▸ browse';
  // Reset prompt builder
  document.getElementById('promptBuilderBody').style.display = 'none';
  document.getElementById('promptBuilderToggle').textContent = '▸ expand';
  ['pb-tone','pb-style','pb-domain','pb-rules','pb-escalation'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  // Reset support agent fields
  document.getElementById('isSupportAgent').checked = false;
  document.getElementById('supportAgentFields').style.display = 'none';
  document.getElementById('supportAgentSection').style.display = '';
  populateSupportAgentDropdown();
  // Load projects
  if (typeof loadProjectsDropdown === 'function') loadProjectsDropdown();
  // Populate "From Existing Agent" optgroup
  if (typeof populateExistingAgentsOptgroup === 'function') populateExistingAgentsOptgroup();
  document.getElementById('agentModal').classList.add('active');
}

document.getElementById('createAgentBtn')?.addEventListener('click', openCreateAgentModal);

// ── Prompt Builder ────────────────────────────────────────────────────────────

function togglePromptBuilder() {
  const body = document.getElementById('promptBuilderBody');
  const toggle = document.getElementById('promptBuilderToggle');
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  toggle.textContent = open ? '▸ expand' : '▾ collapse';
}

function applyPromptBuilder() {
  const tone = document.getElementById('pb-tone').value;
  const style = document.getElementById('pb-style').value;
  const domain = document.getElementById('pb-domain').value.trim();
  const rules = document.getElementById('pb-rules').value.trim();
  const escalation = document.getElementById('pb-escalation').value.trim();

  const name = document.getElementById('agentName').value.trim() || 'this agent';

  const TONE_MAP = {
    professional: 'Professional and clear. No filler. Formal where context demands it.',
    friendly: 'Warm, approachable, and helpful. Use natural language. Not overly formal.',
    technical: 'Precise and expert-level. Use correct terminology. Assume technical literacy.',
    concise: 'Minimal words, maximum signal. Every sentence must earn its place.',
    conversational: 'Natural and relaxed. Write like a knowledgeable human, not a manual.'
  };
  const STYLE_MAP = {
    bullets: 'Use bullet points for all lists and multi-part answers.',
    prose: 'Full sentences and paragraphs. No bullet lists.',
    mixed: 'Prose for context, bullet points for lists and options.',
    structured: 'Use headers and sections to organize longer responses.',
    brief: 'Maximum 1–3 sentences per response. No elaboration unless asked.'
  };

  let prompt = `IDENTITY: You are ${name}.`;
  if (domain) prompt += ` Your domain is: ${domain}.`;
  prompt += '\n\n';

  if (tone && TONE_MAP[tone]) prompt += `TONE: ${TONE_MAP[tone]}\n\n`;
  if (style && STYLE_MAP[style]) prompt += `RESPONSE STYLE: ${STYLE_MAP[style]}\n\n`;

  prompt += `PROTOCOL:\n1. Understand the request fully before responding.\n2. Answer directly — no preamble, no restating the question.\n3. If you cannot help with something, say so clearly and briefly.`;
  if (escalation) prompt += `\n4. When you cannot resolve an issue: ${escalation}.`;
  prompt += '\n\n';

  if (rules) {
    const ruleList = rules.split(',').map(r => r.trim()).filter(Boolean);
    prompt += `HARD RULES:\n${ruleList.map(r => `- ${r}`).join('\n')}`;
  }

  document.getElementById('systemPrompt').value = prompt.trim();

  // Collapse builder after applying
  document.getElementById('promptBuilderBody').style.display = 'none';
  document.getElementById('promptBuilderToggle').textContent = '▸ expand';
}

function toggleSupportAgentFields() {
  const checked = document.getElementById('isSupportAgent').checked;
  document.getElementById('supportAgentFields').style.display = checked ? '' : 'none';
}

async function populateSupportAgentDropdown() {
  const sel = document.getElementById('supportsAgentId');
  if (!sel) return;
  try {
    const res = await fetch('/agents/api/agents');
    const data = await res.json();
    sel.innerHTML = '<option value="">— select agent —</option>';
    if (data.success) {
      data.agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a._id;
        opt.textContent = `${a.name} [${a.role}]`;
        sel.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Failed to load agents for support dropdown:', e);
  }
}

// Test Ollama Connection
document.getElementById('testOllamaBtn')?.addEventListener('click', async () => {
  try {
    const response = await fetch('/agents/api/ollama/test');
    const data = await response.json();

    if (data.success) {
      alert(`Ollama connected! Available models: ${data.models.map(m => m.name).join(', ')}`);
    } else {
      alert(`Ollama connection failed: ${data.error}`);
    }
  } catch (error) {
    alert(`Error testing Ollama: ${error.message}`);
  }
});

// Submit Agent Form
document.getElementById('agentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const agentId = document.getElementById('agentId').value;
  const data = Object.fromEntries(formData.entries());

  try {
    const url = agentId ? `/agents/api/agents/${agentId}` : '/agents/api/agents';
    const method = agentId ? 'PUT' : 'POST';

    // Attach preset MCP tools when creating (not editing)
    if (!agentId && typeof _selectedPresetMcpTools !== 'undefined' && _selectedPresetMcpTools !== null) {
      data.mcpTools = _selectedPresetMcpTools;
      data.mcpBackgroundTools = _selectedPresetMcpBgTools;
    }

    // Collect domain checkboxes → capabilities array
    data.capabilities = Array.from(document.querySelectorAll('#domainGrid input[type="checkbox"]:checked'))
      .map(cb => cb.value);

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (result.success) {
      closeModal();
      location.reload();
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
});

function closeModal() {
  document.getElementById('agentModal').classList.remove('active');
}

function toggleAgentMenu(agentId) {
  const menu = document.getElementById(`menu-${agentId}`);
  document.querySelectorAll('.menu-dropdown').forEach(m => {
    if (m.id !== `menu-${agentId}`) m.classList.remove('active');
  });
  menu.classList.toggle('active');
}

function editAgent(agentId) {
  fetch(`/agents/api/agents/${agentId}`)
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        const agent = data.agent;
        document.getElementById('modalTitle').textContent = 'Edit Agent';
        document.getElementById('submitBtnText').textContent = 'Update Agent';
        document.getElementById('agentId').value = agent._id;
        document.getElementById('agentName').value = agent.name;
        document.getElementById('agentDescription').value = agent.description;
        document.getElementById('agentModel').value = agent.model;
        document.getElementById('agentProvider').value = agent.provider;
        document.getElementById('agentRole').value = agent.role || 'assistant';
        document.getElementById('systemPrompt').value = agent.config.systemPrompt;
        document.getElementById('temperature').value = agent.config.temperature;
        document.getElementById('maxTokens').value = agent.config.maxTokens;
        // New fields
        if (agent.category) document.getElementById('agentCategory').value = agent.category;
        if (agent.workingDir) {
          document.getElementById('agentWorkingDir').value = agent.workingDir;
          document.getElementById('dirTreeSelectedLabel').textContent = agent.workingDir;
          document.getElementById('dirTreeSelectedLabel').style.color = '#00ff88';
        }
        // Domain checkboxes
        const caps = agent.capabilities || [];
        document.querySelectorAll('#domainGrid input[type="checkbox"]').forEach(cb => {
          cb.checked = caps.includes(cb.value);
        });
        // Load projects then set current
        if (typeof loadProjectsDropdown === 'function') {
          loadProjectsDropdown().then(() => {
            if (agent.project) document.getElementById('agentProject').value = agent.project;
          });
        }
        document.getElementById('presetSection').style.display = 'none';
        document.getElementById('supportAgentSection').style.display = 'none';
        document.getElementById('agentModal').classList.add('active');
      }
    });
}

async function deleteAgent(agentId) {
  if (!confirm('Are you sure you want to delete this agent?')) return;

  try {
    const response = await fetch(`/agents/api/agents/${agentId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      location.reload();
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

// ── forwardChat discipline ────────────────────────────────────────────────────

// Cache of all registered sites (loaded once per page)
let _fwdChatSites = null;
async function loadFwdChatSites() {
  if (_fwdChatSites) return _fwdChatSites;
  try {
    const res = await fetch('/agents/api/forwardchat/sites');
    const data = await res.json();
    _fwdChatSites = data.success ? data.sites : [];
  } catch (e) {
    _fwdChatSites = [];
  }
  return _fwdChatSites;
}

function _positionFwdChatDd(dd, btn) {
  const r = btn.getBoundingClientRect();
  const ddWidth = 230;
  const spaceAbove = r.top;
  const spaceBelow = window.innerHeight - r.bottom;
  if (spaceAbove > 240 || spaceAbove > spaceBelow) {
    dd.style.top = 'auto';
    dd.style.bottom = (window.innerHeight - r.top + 6) + 'px';
  } else {
    dd.style.bottom = 'auto';
    dd.style.top = (r.bottom + 6) + 'px';
  }
  let left = r.left;
  if (left + ddWidth > window.innerWidth - 8) left = window.innerWidth - ddWidth - 8;
  if (left < 8) left = 8;
  dd.style.left = left + 'px';
}

function toggleFwdChatPanel(agentId) {
  const dd = document.getElementById(`fwdchat-dd-${agentId}`);
  const isOpen = dd.style.display !== 'none';

  // Close all open panels (return them to their original parents first)
  document.querySelectorAll('[id^="fwdchat-dd-"]').forEach(el => {
    el.style.display = 'none';
    // Return to original panel if it was portalled
    const origPanel = document.getElementById(`fwdchat-panel-${el.id.replace('fwdchat-dd-', '')}`);
    if (origPanel && el.parentElement === document.body) origPanel.appendChild(el);
  });
  if (isOpen) return;

  // Portal dropdown to <body> so it fully escapes card overflow:hidden
  document.body.appendChild(dd);

  const btn = document.querySelector(`#fwdchat-panel-${agentId} .btn-fwdchat-toggle`);
  if (btn) _positionFwdChatDd(dd, btn);

  dd.style.display = 'block';

  // Populate site dropdown
  loadFwdChatSites().then(sites => {
    const sel = document.getElementById(`fwdchat-site-sel-${agentId}`);
    if (!sel) return;
    sel.innerHTML = '<option value="">+ assign site</option>';
    sites.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s._id;
      opt.textContent = `${s.siteName} (${s.siteUrl})`;
      sel.appendChild(opt);
    });
    // Populate site name labels for already-assigned sites
    const container = document.getElementById(`fwdchat-sites-${agentId}`);
    if (container) {
      container.querySelectorAll('.fwdchat-site-tag').forEach(tag => {
        const siteId = tag.dataset.siteId;
        const found = sites.find(s => s._id === siteId);
        if (found) tag.querySelector('.fwdchat-site-name').textContent = found.siteName;
      });
    }
  });
}

// Close panels when clicking outside or scrolling — return portalled dropdowns to their panels
function _closeAllFwdChatPanels() {
  document.querySelectorAll('[id^="fwdchat-dd-"]').forEach(el => {
    el.style.display = 'none';
    const origPanel = document.getElementById(`fwdchat-panel-${el.id.replace('fwdchat-dd-', '')}`);
    if (origPanel && el.parentElement === document.body) origPanel.appendChild(el);
  });
}
document.addEventListener('click', _closeAllFwdChatPanels);
window.addEventListener('scroll', _closeAllFwdChatPanels, true);

async function toggleFwdChatBih(agentId, currentlyEnabled) {
  const enable = !currentlyEnabled;
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/forwardchat/bih`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enable })
    });
    const result = await res.json();
    if (result.success) {
      const btn = document.getElementById(`fwdchat-bih-${agentId}`);
      if (enable) {
        btn.textContent = 'live';
        btn.classList.add('active');
      } else {
        btn.textContent = 'deploy';
        btn.classList.remove('active');
      }
      btn.onclick = (e) => { e.stopPropagation(); toggleFwdChatBih(agentId, enable); };
      // Update count badge
      refreshFwdChatBadge(agentId);
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function onFwdChatSiteSelect(agentId, siteId) {
  if (!siteId) return;
  const sel = document.getElementById(`fwdchat-site-sel-${agentId}`);
  sel.value = '';
  try {
    const res = await fetch(`/agents/api/forwardchat/sites/${siteId}/agent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId })
    });
    const result = await res.json();
    if (result.success) {
      // Add tag to the active sites list
      const container = document.getElementById(`fwdchat-sites-${agentId}`);
      const sites = await loadFwdChatSites();
      const site = sites.find(s => s._id === siteId);
      const tag = document.createElement('div');
      tag.className = 'fwdchat-site-tag active';
      tag.dataset.siteId = siteId;
      tag.innerHTML = `<span class="fwdchat-site-dot"></span><span class="fwdchat-site-name">${site?.siteName || siteId}</span><button onclick="event.stopPropagation(); removeFwdChatSite('${agentId}', '${siteId}')" title="Remove">×</button>`;
      container.appendChild(tag);
      refreshFwdChatBadge(agentId);
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function removeFwdChatSite(agentId, siteId) {
  if (!confirm('Remove this site assignment?')) return;
  try {
    const res = await fetch(`/agents/api/forwardchat/sites/${siteId}/agent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: null })
    });
    const result = await res.json();
    if (result.success) {
      const container = document.getElementById(`fwdchat-sites-${agentId}`);
      const tag = container?.querySelector(`[data-site-id="${siteId}"]`);
      if (tag) tag.remove();
      refreshFwdChatBadge(agentId);
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function refreshFwdChatBadge(agentId) {
  const bihBtn = document.getElementById(`fwdchat-bih-${agentId}`);
  const bihOn = bihBtn?.classList.contains('active') ? 1 : 0;
  const siteCount = document.getElementById(`fwdchat-sites-${agentId}`)?.querySelectorAll('.fwdchat-site-tag.active').length || 0;
  const total = bihOn + siteCount;
  const toggle = document.querySelector(`#fwdchat-panel-${agentId} .btn-fwdchat-toggle`);
  if (!toggle) return;
  let badge = toggle.querySelector('.fwdchat-count-badge');
  if (total > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'fwdchat-count-badge';
      toggle.appendChild(badge);
    }
    badge.textContent = total;
  } else if (badge) {
    badge.remove();
  }
}

function openFwdChatSiteManager() {
  // Open a simple modal for site management
  let modal = document.getElementById('fwdChatSiteModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'fwdChatSiteModal';
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal-container" style="max-width:560px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h2>forwardChat — Registered Sites</h2>
          <button class="modal-close" onclick="document.getElementById('fwdChatSiteModal').remove()">×</button>
        </div>
        <div class="modal-body" id="fwdChatSiteBody">
          <div class="loading">Loading sites...</div>
        </div>
        <div class="modal-footer">
          <button class="btn-primary" onclick="openFwdChatRegisterSite()">+ Register New Site</button>
          <button class="btn-secondary" onclick="document.getElementById('fwdChatSiteModal').remove()">Close</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  } else {
    modal.classList.add('active');
  }
  renderFwdChatSiteList();
}

async function renderFwdChatSiteList() {
  const body = document.getElementById('fwdChatSiteBody');
  if (!body) return;
  _fwdChatSites = null; // force refresh
  const sites = await loadFwdChatSites();
  if (!sites.length) {
    body.innerHTML = '<p style="color:#888;text-align:center;padding:2rem">No sites registered yet.</p>';
    return;
  }
  body.innerHTML = sites.map(s => `
    <div class="fwdchat-site-row-item">
      <div class="fwdchat-site-info">
        <span class="fwdchat-site-status-dot ${s.plugin?.verified ? 'verified' : ''}"></span>
        <div>
          <strong>${s.siteName}</strong>
          <span class="fwdchat-site-url">${s.siteUrl}</span>
        </div>
      </div>
      <div class="fwdchat-site-actions">
        <button class="btn-copy-token" onclick="copyFwdChatToken('${s.plugin?.token}')" title="Copy install token">copy token</button>
        <button class="btn-danger-sm" onclick="deleteFwdChatSite('${s._id}')">×</button>
      </div>
    </div>
    <div class="fwdchat-install-snippet" id="snippet-${s._id}" style="display:none">
      <code>&lt;script src="https://madladslab.com/plugin/forwardchat.js?site=${s.plugin?.token}"&gt;&lt;/script&gt;</code>
    </div>
  `).join('');
}

function copyFwdChatToken(token) {
  const snippet = `<script src="https://madladslab.com/plugin/forwardchat.js?site=${token}"><\/script>`;
  navigator.clipboard.writeText(snippet).then(() => alert('Install snippet copied to clipboard!'));
}

async function deleteFwdChatSite(siteId) {
  if (!confirm('Delete this site? This will remove all agent assignments.')) return;
  try {
    const res = await fetch(`/agents/api/forwardchat/sites/${siteId}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      _fwdChatSites = null;
      renderFwdChatSiteList();
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function openFwdChatRegisterSite() {
  const name = prompt('Site name (e.g. "Client Website"):');
  if (!name?.trim()) return;
  const url = prompt('Site URL (e.g. "https://example.com"):');
  if (!url?.trim()) return;
  fetch('/agents/api/forwardchat/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteName: name.trim(), siteUrl: url.trim(), origin: url.trim() })
  }).then(r => r.json()).then(result => {
    if (result.success) {
      _fwdChatSites = null;
      renderFwdChatSiteList();
      copyFwdChatToken(result.token);
    } else {
      alert(`Error: ${result.error}`);
    }
  });
}

// ── legacy bihBot (kept for direct bihBot config via manage panel) ────────────
async function toggleBihBot(agentId, currentlyEnabled, currentTrigger) {
  const enable = !currentlyEnabled;
  let trigger = currentTrigger;
  if (enable && !trigger) {
    trigger = prompt('Enter trigger word (users type @trigger in bih chat):');
    if (!trigger) return;
    trigger = trigger.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!trigger) return alert('Invalid trigger name');
  }
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/bih-bot`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enable, trigger })
    });
    const result = await res.json();
    if (!result.success) alert(`Error: ${result.error}`);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function toggleStatus(agentId, currentStatus) {
  const newStatus = (currentStatus === 'running' || currentStatus === 'idle') ? 'stopped' : 'idle';

  try {
    const response = await fetch(`/agents/api/agents/${agentId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    const result = await response.json();

    if (result.success) {
      location.reload();
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

// Switch tabs inside agent cards
// Overview loads inline; Tuning/Logs/Memory open the full detail modal
function switchCardTab(agentId, tabName) {
  if (tabName !== 'overview') {
    openAgentDetail(agentId);
    setTimeout(() => switchTab(tabName), 150);
    return;
  }

  const card = document.querySelector(`[data-agent-id="${agentId}"]`);
  if (!card) return;

  card.querySelectorAll('.card-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  card.querySelectorAll('.card-tab-content').forEach(c => c.classList.remove('active'));

  const activeTab = card.querySelector(`#${tabName}-${agentId}`);
  if (activeTab) activeTab.classList.add('active');
}

async function updateSystemPrompt(agentId) {
  const textarea = document.getElementById(`systemPrompt-${agentId}`);
  const newPrompt = textarea.value;

  try {
    const response = await fetch(`/agents/api/agents/${agentId}/tuning`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt: newPrompt })
    });

    const result = await response.json();

    if (result.success) {
      alert('System prompt updated successfully!');
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

async function openChat(agentId, agentName) {
  currentChatAgentId = agentId;
  if (agentSocket) agentSocket.emit('subscribe', agentId);

  // Clear unread badge
  chatUnreadCounts[agentId] = 0;
  const badge = document.getElementById(`chat-badge-${agentId}`);
  if (badge) { badge.textContent = ''; badge.classList.remove('has-unread'); }
  document.getElementById('chatTitle').textContent = `Chat with ${agentName}`;
  const messagesDiv = document.getElementById('chatMessages');
  messagesDiv.innerHTML = '<p class="loading">Loading history...</p>';
  document.getElementById('chatModal').classList.add('active');

  try {
    const res = await fetch(`/agents/api/agents/${agentId}/memory`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Memory fetch failed: ${res.status}`);
    const data = await res.json();
    messagesDiv.innerHTML = '';

    if (data.success) {
      const mem = data.memory;
      const convs = mem.conversations || [];
      const kb = mem.knowledgeBase || [];
      const hasSummary = !!mem.threadSummary;
      const hasLtm = !!mem.longTermMemory;
      const strip = document.getElementById('chatContextStrip');
      strip.style.display = 'flex';
      strip.innerHTML = `
        <span class="ctx-pill ${convs.length > 0 ? 'active' : 'dim'}">💬 ${convs.length} turns</span>
        <span class="ctx-pill ${kb.length > 0 ? 'active' : 'dim'}">🗃 ${kb.length} KB</span>
        <span class="ctx-pill ${hasSummary ? 'active' : 'dim'}">📋 summary ${hasSummary ? '✓' : '✗'}</span>
        <span class="ctx-pill ${hasLtm ? 'active' : 'dim'}">🧠 LTM ${hasLtm ? '✓' : '✗'}</span>
      `;

      if (convs.length > 0) {
        // API returns newest-first; reverse to render oldest→newest (scroll to bottom = newest)
        const fragment = document.createDocumentFragment();
        convs.slice().reverse().forEach(conv => {
          const userEl = document.createElement('div');
          userEl.className = 'chat-message user';
          userEl.innerHTML = `<div class="chat-message-avatar">U</div><div class="chat-message-content">${escapeHtml(conv.userMessage || '')}</div>`;
          const aiEl = document.createElement('div');
          aiEl.className = 'chat-message';
          aiEl.innerHTML = `<div class="chat-message-avatar">AI</div><div class="chat-message-content">${renderMarkdown(conv.agentResponse || '')}</div>`;
          fragment.appendChild(userEl);
          fragment.appendChild(aiEl);
        });
        messagesDiv.appendChild(fragment);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
    }
  } catch (e) {
    console.error('[openChat] Failed to load history:', e.message);
    messagesDiv.innerHTML = '<p class="loading" style="color:#f55">Failed to load history. Try reopening.</p>';
  }
}

function closeChatModal() {
  if (currentChatAgentId && typeof agentSocket !== 'undefined') agentSocket.emit('unsubscribe', currentChatAgentId);
  document.getElementById('chatModal').classList.remove('active');
  document.getElementById('chatContextStrip').style.display = 'none';
  currentChatAgentId = null;
}

document.getElementById('sendChatBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();

  if (!message || !currentChatAgentId) return;

  const messagesDiv = document.getElementById('chatMessages');

  // Add user message
  messagesDiv.insertAdjacentHTML('beforeend', `
    <div class="chat-message user">
      <div class="chat-message-avatar">U</div>
      <div class="chat-message-content">${escapeHtml(message)}</div>
    </div>
  `);

  input.value = '';
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  // Show thinking indicator
  const thinkingId = 'thinking-' + Date.now();
  messagesDiv.insertAdjacentHTML('beforeend', `
    <div id="${thinkingId}" class="chat-tool-call" style="color:#888;">
      <span class="tool-icon">⋯</span> thinking...
    </div>
  `);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  // Per-tool live indicators via socket
  function onToolCall({ callId, tool, args }) {
    document.getElementById(thinkingId)?.remove();
    const argsStr = escapeHtml(JSON.stringify(args)).substring(0, 80);
    messagesDiv.insertAdjacentHTML('beforeend', `
      <div id="tc-${callId}" class="chat-tool-call">
        <span class="tool-icon">⚙</span>
        <span class="tool-name">${escapeHtml(tool)}</span>
        <span class="tool-args">${argsStr}</span>
        <span class="tool-status">working…</span>
      </div>
    `);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function onToolResult({ callId, success, error }) {
    const el = document.getElementById(`tc-${callId}`);
    if (!el) return;
    const statusEl = el.querySelector('.tool-status');
    if (success) {
      statusEl.textContent = '✓';
      statusEl.className = 'tool-ok';
    } else {
      statusEl.textContent = (error || 'error').substring(0, 60);
      statusEl.className = 'tool-error';
    }
  }

  agentSocket.on('tool:call', onToolCall);
  agentSocket.on('tool:result', onToolResult);

  try {
    const response = await fetch(`/agents/api/agents/${currentChatAgentId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const result = await response.json();

    agentSocket.off('tool:call', onToolCall);
    agentSocket.off('tool:result', onToolResult);
    document.getElementById(thinkingId)?.remove();

    if (result.success) {
      messagesDiv.insertAdjacentHTML('beforeend', `
        <div class="chat-message">
          <div class="chat-message-avatar">AI</div>
          <div class="chat-message-content">${renderMarkdown(result.response)}</div>
        </div>
      `);
    } else {
      messagesDiv.insertAdjacentHTML('beforeend', `
        <div class="chat-message">
          <div class="chat-message-avatar">⚠</div>
          <div class="chat-message-content" style="color:#ff4444;">Error: ${escapeHtml(result.error)}</div>
        </div>
      `);
    }

    // Wire load events on any newly inserted images so shimmer stops
    messagesDiv.querySelectorAll('img:not(.loaded)').forEach(img => {
      if (img.complete) { img.classList.add('loaded'); }
      else { img.addEventListener('load', () => img.classList.add('loaded'), { once: true }); }
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  } catch (error) {
    agentSocket.off('tool:call', onToolCall);
    agentSocket.off('tool:result', onToolResult);
    document.getElementById(thinkingId)?.remove();
    alert(`Error: ${error.message}`);
  }
}

function viewLogs(agentId) {
  document.getElementById('logsContainer').innerHTML = '<p class="loading">Loading logs...</p>';
  document.getElementById('logsModal').classList.add('active');

  fetch(`/agents/api/agents/${agentId}/logs`)
    .then(res => res.json())
    .then(data => {
      if (data.success && data.logs.length > 0) {
        document.getElementById('logsContainer').innerHTML = data.logs.map(log => `
          <div class="log-entry ${log.level}">
            <div class="log-time">${new Date(log.timestamp).toLocaleString()}</div>
            <div class="log-message">${escapeHtml(log.message)}</div>
          </div>
        `).join('');
      } else {
        document.getElementById('logsContainer').innerHTML = '<p class="loading">No logs available</p>';
      }
    })
    .catch(error => {
      document.getElementById('logsContainer').innerHTML = `<p class="loading" style="color: #ff4444;">Error loading logs: ${error.message}</p>`;
    });
}

function closeLogsModal() {
  document.getElementById('logsModal').classList.remove('active');
}

// Close modals when clicking outside
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('active');
  }
});

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.agent-menu')) {
    document.querySelectorAll('.menu-dropdown').forEach(m => m.classList.remove('active'));
  }
});
