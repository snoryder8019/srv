let currentChatAgentId = null;

// Socket for live tool call updates in chat + proactive agent push
const chatSocket = io('/agents');

// Track unread push counts per agent
const chatUnreadCounts = {};

chatSocket.on('agent:push', (data) => {
  const messagesDiv = document.getElementById('chatMessages');
  const isChatOpen = document.getElementById('chatModal').classList.contains('active');
  const isThisAgent = currentChatAgentId === data.agentId;

  if (isChatOpen && isThisAgent && messagesDiv) {
    // Inject proactive bubble directly into the open chat
    const preview = data.content.length > 400 ? data.content.substring(0, 400) + '…' : data.content;
    messagesDiv.insertAdjacentHTML('beforeend', `
      <div class="chat-message proactive">
        <div class="chat-message-avatar">★</div>
        <div class="chat-message-content">
          <span class="chat-proactive-label">background finding</span>
          <span class="chat-proactive-title">${escapeHtml(data.title)}</span>
          <span class="chat-proactive-body">${escapeHtml(preview)}</span>
        </div>
      </div>
    `);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  } else {
    // Chat not open — increment unread badge on agent card
    chatUnreadCounts[data.agentId] = (chatUnreadCounts[data.agentId] || 0) + 1;
    const badge = document.getElementById(`chat-badge-${data.agentId}`);
    if (badge) {
      badge.textContent = chatUnreadCounts[data.agentId];
      badge.classList.add('has-unread');
    }
  }
});

// Create Agent Modal
document.getElementById('createAgentBtn').addEventListener('click', () => {
  document.getElementById('modalTitle').textContent = 'Spawn New Agent';
  document.getElementById('submitBtnText').textContent = 'Create Agent';
  document.getElementById('agentForm').reset();
  document.getElementById('agentId').value = '';
  document.getElementById('presetSection').style.display = '';
  document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('agentModal').classList.add('active');
});

// Test Ollama Connection
document.getElementById('testOllamaBtn').addEventListener('click', async () => {
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
        document.getElementById('presetSection').style.display = 'none';
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
    if (result.success) {
      const btn = document.getElementById(`bih-btn-${agentId}`);
      if (enable) {
        btn.textContent = `bih: @${result.bihBot.trigger}`;
        btn.classList.add('bih-bot-active');
        btn.title = `@${result.bihBot.trigger} active in bih chat`;
      } else {
        btn.textContent = '+ bih';
        btn.classList.remove('bih-bot-active');
        btn.title = 'Deploy to bih chat';
      }
      btn.onclick = (e) => { e.stopPropagation(); toggleBihBot(agentId, enable, result.bihBot.trigger); };
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function togglePepeChat(agentId, currentlyEnabled) {
  const enable = !currentlyEnabled;
  const agentName = document.querySelector(`[data-agent-id="${agentId}"] .agent-name`)?.textContent?.trim() || agentId;
  if (enable && !confirm(`Deploy "${agentName}" as the madladslab.com chat agent? Any currently assigned agent will be replaced.`)) return;
  try {
    const res = await fetch(`/agents/api/agents/${agentId}/pepe-chat`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enable })
    });
    const result = await res.json();
    if (result.success) {
      // Reset all madlads buttons
      document.querySelectorAll('[id^="pepe-btn-"]').forEach(btn => {
        btn.textContent = '+ madlads';
        btn.classList.remove('bih-bot-active');
        btn.title = 'Deploy as madladslab.com chat agent';
        const aid = btn.id.replace('pepe-btn-', '');
        btn.onclick = (e) => { e.stopPropagation(); togglePepeChat(aid, false); };
      });
      const btn = document.getElementById(`pepe-btn-${agentId}`);
      if (enable) {
        btn.textContent = `madlads: ${agentName}`;
        btn.classList.add('bih-bot-active');
        btn.title = `${agentName} is the site chat agent`;
        btn.onclick = (e) => { e.stopPropagation(); togglePepeChat(agentId, true); };
      }
    } else {
      alert(`Error: ${result.error}`);
    }
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
  chatSocket.emit('subscribe', agentId);

  // Clear unread badge
  chatUnreadCounts[agentId] = 0;
  const badge = document.getElementById(`chat-badge-${agentId}`);
  if (badge) { badge.textContent = ''; badge.classList.remove('has-unread'); }
  document.getElementById('chatTitle').textContent = `Chat with ${agentName}`;
  const messagesDiv = document.getElementById('chatMessages');
  messagesDiv.innerHTML = '<p class="loading">Loading history...</p>';
  document.getElementById('chatModal').classList.add('active');

  try {
    const res = await fetch(`/agents/api/agents/${agentId}/memory`);
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
        convs.slice().reverse().forEach(conv => {
          messagesDiv.innerHTML += `
            <div class="chat-message user">
              <div class="chat-message-avatar">U</div>
              <div class="chat-message-content">${escapeHtml(conv.userMessage)}</div>
            </div>
            <div class="chat-message">
              <div class="chat-message-avatar">AI</div>
              <div class="chat-message-content">${renderMarkdown(conv.agentResponse)}</div>
            </div>
          `;
        });
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
    }
  } catch (e) {
    messagesDiv.innerHTML = '';
  }
}

function closeChatModal() {
  if (currentChatAgentId) chatSocket.emit('unsubscribe', currentChatAgentId);
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

  chatSocket.on('tool:call', onToolCall);
  chatSocket.on('tool:result', onToolResult);

  try {
    const response = await fetch(`/agents/api/agents/${currentChatAgentId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const result = await response.json();

    chatSocket.off('tool:call', onToolCall);
    chatSocket.off('tool:result', onToolResult);
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
    chatSocket.off('tool:call', onToolCall);
    chatSocket.off('tool:result', onToolResult);
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
