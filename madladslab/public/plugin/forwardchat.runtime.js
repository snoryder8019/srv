/**
 * forwardChat Runtime Widget
 * Injected by forwardchat.js loader. Uses the agent persona from the madladslab /agents dashboard.
 * Connects to Socket.IO /forwardchat namespace authenticated by site token.
 */
(function () {
  var loaderScript = document.querySelector('script[data-fwdchat-token]');
  if (!loaderScript) return;

  var SITE_TOKEN = loaderScript.getAttribute('data-fwdchat-token');
  var BASE_URL   = loaderScript.getAttribute('data-fwdchat-base') || 'https://madladslab.com';

  // ── Session ID (persisted in localStorage) ─────────────────────────────────
  var SESSION_KEY = 'fwdchat_session_' + SITE_TOKEN;
  var VISITOR_KEY = 'fwdchat_visitor_' + SITE_TOKEN;

  function getSessionId() {
    var id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function getVisitor() {
    try { return JSON.parse(localStorage.getItem(VISITOR_KEY) || '{}'); } catch (e) { return {}; }
  }

  function saveVisitor(data) {
    var v = Object.assign(getVisitor(), data);
    localStorage.setItem(VISITOR_KEY, JSON.stringify(v));
  }

  // ── Inject Socket.IO if not present ────────────────────────────────────────
  function loadSocketIO(cb) {
    if (window.io) return cb();
    var s = document.createElement('script');
    s.src = BASE_URL + '/socket.io/socket.io.js';
    s.onload = cb;
    s.onerror = function () { console.error('[forwardChat] Could not load socket.io'); };
    document.head.appendChild(s);
  }

  // ── Build Widget DOM ────────────────────────────────────────────────────────
  function buildWidget() {
    var css = `
      #fwdchat-bubble{position:fixed;bottom:24px;right:24px;z-index:9999;cursor:pointer;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#00c896,#009f78);box-shadow:0 4px 16px rgba(0,200,150,0.4);display:flex;align-items:center;justify-content:center;transition:transform 0.2s,box-shadow 0.2s;border:none}
      #fwdchat-bubble:hover{transform:scale(1.08);box-shadow:0 6px 22px rgba(0,200,150,0.5)}
      #fwdchat-bubble svg{pointer-events:none}
      #fwdchat-unread{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:10px;font-size:10px;font-weight:700;padding:1px 5px;display:none;line-height:1.4}
      #fwdchat-window{position:fixed;bottom:88px;right:24px;width:340px;max-height:520px;background:#111;border:1px solid #2a2a2a;border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.6);display:none;flex-direction:column;z-index:9999;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      #fwdchat-window.open{display:flex}
      #fwdchat-header{padding:14px 16px;background:#161616;border-bottom:1px solid #222;display:flex;align-items:center;gap:10px}
      #fwdchat-agent-name{font-weight:600;font-size:0.9rem;color:#fff;flex:1}
      #fwdchat-status-dot{width:8px;height:8px;border-radius:50%;background:#00c896}
      #fwdchat-close{background:none;border:none;color:#555;font-size:1.2rem;cursor:pointer;line-height:1;padding:0}
      #fwdchat-close:hover{color:#aaa}
      #fwdchat-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:120px;max-height:340px}
      .fwdchat-msg{max-width:85%;padding:9px 12px;border-radius:10px;font-size:0.85rem;line-height:1.5;word-break:break-word}
      .fwdchat-msg.user{align-self:flex-end;background:rgba(0,200,150,0.18);color:#e0e0e0;border-bottom-right-radius:3px}
      .fwdchat-msg.assistant{align-self:flex-start;background:#1e1e1e;color:#d0d0d0;border-bottom-left-radius:3px;border:1px solid #2a2a2a}
      .fwdchat-msg.system{align-self:center;color:#555;font-size:0.75rem;font-style:italic;background:none}
      #fwdchat-typing{padding:0 12px 4px;font-size:0.78rem;color:#555;min-height:18px}
      #fwdchat-input-row{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #222;background:#0d0d0d}
      #fwdchat-input{flex:1;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:8px 10px;color:#e0e0e0;font-size:0.85rem;resize:none;height:36px;outline:none;font-family:inherit}
      #fwdchat-input:focus{border-color:rgba(0,200,150,0.4)}
      #fwdchat-send{background:rgba(0,200,150,0.2);border:1px solid rgba(0,200,150,0.35);color:#00c896;border-radius:8px;padding:0 14px;font-size:0.82rem;cursor:pointer;height:36px;transition:all 0.15s;white-space:nowrap}
      #fwdchat-send:hover{background:rgba(0,200,150,0.3)}
      #fwdchat-send:disabled{opacity:0.4;cursor:not-allowed}
      @media(max-width:400px){#fwdchat-window{width:calc(100vw - 16px);right:8px;bottom:80px}}
    `;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var bubble = document.createElement('button');
    bubble.id = 'fwdchat-bubble';
    bubble.setAttribute('aria-label', 'Open chat');
    bubble.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span id="fwdchat-unread"></span>';

    var win = document.createElement('div');
    win.id = 'fwdchat-window';
    win.innerHTML = `
      <div id="fwdchat-header">
        <span id="fwdchat-status-dot"></span>
        <span id="fwdchat-agent-name">Chat</span>
        <button id="fwdchat-close" aria-label="Close chat">×</button>
      </div>
      <div id="fwdchat-messages"></div>
      <div id="fwdchat-typing"></div>
      <div id="fwdchat-input-row">
        <textarea id="fwdchat-input" placeholder="Type a message..." rows="1"></textarea>
        <button id="fwdchat-send">Send</button>
      </div>
    `;

    document.body.appendChild(bubble);
    document.body.appendChild(win);
    return { bubble, win };
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  loadSocketIO(function () {
    var els = buildWidget();
    var bubble = els.bubble;
    var win = els.win;
    var messagesEl = win.querySelector('#fwdchat-messages');
    var typingEl   = win.querySelector('#fwdchat-typing');
    var inputEl    = win.querySelector('#fwdchat-input');
    var sendBtn    = win.querySelector('#fwdchat-send');
    var agentNameEl = win.querySelector('#fwdchat-agent-name');
    var unreadBadge = bubble.querySelector('#fwdchat-unread');
    var unreadCount = 0;
    var isOpen = false;

    var sessionId = getSessionId();
    var visitor   = getVisitor();

    // Socket connection
    var socket = window.io(BASE_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      query: { site: SITE_TOKEN }
    });

    socket.on('connect', function () {
      socket.emit('visitor:identify', sessionId);
    });

    socket.on('agent:identity', function (data) {
      if (data.name) agentNameEl.textContent = data.name;
    });

    // Verify install (marks plugin.verified on first load)
    fetch(BASE_URL + '/agents/api/forwardchat/verify/' + SITE_TOKEN, { method: 'POST' }).catch(function () {});

    function addMessage(role, text) {
      var div = document.createElement('div');
      div.className = 'fwdchat-msg ' + role;
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    socket.on('response', function (data) {
      typingEl.textContent = '';
      addMessage('assistant', data.message);
      sendBtn.disabled = false;
      if (!isOpen) {
        unreadCount++;
        unreadBadge.textContent = unreadCount;
        unreadBadge.style.display = 'block';
      }
    });

    socket.on('typing', function (on) {
      typingEl.textContent = on ? agentNameEl.textContent + ' is typing…' : '';
    });

    socket.on('admin:message', function (data) {
      addMessage('assistant', data.message);
      sendBtn.disabled = false;
    });

    socket.on('lead:captured', function (data) {
      Object.assign(visitor, data);
      saveVisitor(data);
    });

    socket.on('error', function (data) {
      typingEl.textContent = '';
      addMessage('system', data.error || 'Something went wrong.');
      sendBtn.disabled = false;
    });

    function sendMessage() {
      var text = inputEl.value.trim();
      if (!text || sendBtn.disabled) return;
      addMessage('user', text);
      sendBtn.disabled = true;
      inputEl.value = '';
      inputEl.style.height = '36px';
      socket.emit('message', { sessionId: sessionId, message: text, visitor: visitor });
    }

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    inputEl.addEventListener('input', function () {
      this.style.height = '36px';
      this.style.height = Math.min(this.scrollHeight, 90) + 'px';
    });

    bubble.addEventListener('click', function () {
      isOpen = !isOpen;
      win.classList.toggle('open', isOpen);
      if (isOpen) {
        unreadCount = 0;
        unreadBadge.style.display = 'none';
        inputEl.focus();
        // Send greeting only on first open with no messages
        if (messagesEl.children.length === 0) {
          socket.emit('message', { sessionId: sessionId, message: '__init__', visitor: visitor });
        }
      }
    });

    win.querySelector('#fwdchat-close').addEventListener('click', function (e) {
      e.stopPropagation();
      isOpen = false;
      win.classList.remove('open');
    });
  });
})();
