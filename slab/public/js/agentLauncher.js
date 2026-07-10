/**
 * Slab — Universal ✦ Agent Launcher (Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE component for every agent interaction. Injected in the admin head; renders
 * a floating ✦ on every admin page. Context comes from where it was clicked
 * (path → {kind, module, title}); the same context always reopens the same
 * PERSISTENT thread (POST /admin/agent-chat/resolve). Audience gating lives
 * server-side (agentAudience via runDepartment) — this client just renders.
 *
 * Programmatic API for future field-level ✦ (copy inputs, etc.):
 *   SlabAgent.open({ kind, module, title, seed })   // seed pre-fills the input
 *   SlabAgent.mount(el, opts)                       // turn any element into a launcher
 *
 * Apply affordance: messages carrying meta.fill render an Apply button that
 * POSTs to /admin/master-agent/execute → the shared executeDepartment committer.
 * (Hardened: fills live in a registry + delegated clicks — no inline-JSON onclick.)
 */
(function () {
  'use strict';
  if (window.SlabAgent) return;

  // ── Context from path ───────────────────────────────────────────────────────
  var MAP = [
    ['/admin/design',    { kind: 'design', module: 'design',  title: 'Design Agent' }],
    ['/admin/copy',      { kind: 'design', module: 'design',  title: 'Copy Agent' }],
    ['/admin/sections',  { kind: 'design', module: 'design',  title: 'Sections Agent' }],
    ['/admin/pages',     { kind: 'design', module: 'pages',   title: 'Pages Agent' }],
    ['/admin/blog',      { kind: 'agent',  module: 'blog',    title: 'Blog Agent' }],
    ['/admin/clients',   { kind: 'client', module: 'clients', title: 'Client Agent' }],
    ['/admin/inquiries', { kind: 'client', module: 'clients', title: 'Client Agent' }],
    ['/admin/social',    { kind: 'agent',  module: 'social',  title: 'Social Agent' }],
    ['/admin/email-marketing', { kind: 'agent', module: 'email-marketing', title: 'Email Agent' }],
    ['/admin/bookkeeping', { kind: 'agent', module: 'bookkeeping', title: 'Finance Agent' }],
  ];
  function pathContext() {
    var p = window.location.pathname;
    for (var i = 0; i < MAP.length; i++) if (p.indexOf(MAP[i][0]) === 0) return MAP[i][1];
    return { kind: 'agent', module: null, title: 'Assistant' };
  }

  var S = {
    socket: null, threadId: null, tenantDb: '', open: false,
    seed: '', typingTimer: null, fills: [], // Apply registry
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Styles + DOM ────────────────────────────────────────────────────────────
  var CSS = '' +
    '#saFab{position:fixed;bottom:172px;right:24px;z-index:99998;width:44px;height:44px;border-radius:50%;' +
    'background:var(--navy,#1C2B4A);color:var(--gold,#C9A848);border:1.5px solid rgba(201,168,72,.35);' +
    'display:flex;align-items:center;justify-content:center;font-size:19px;cursor:pointer;' +
    'transition:transform .15s,box-shadow .15s;box-shadow:0 4px 16px rgba(0,0,0,.22);}' +
    '#saFab:hover{transform:scale(1.1);box-shadow:0 6px 24px rgba(0,0,0,.3);}' +
    '#saOverlay{display:none;position:fixed;inset:0;z-index:99997;background:rgba(15,27,48,.55);' +
    'backdrop-filter:blur(3px);align-items:flex-end;justify-content:flex-end;padding:0;}' +
    '#saOverlay.open{display:flex;}' +
    '#saModal{background:var(--surface,#fff);width:min(480px,100vw);height:min(78vh,680px);' +
    'display:flex;flex-direction:column;border-radius:10px 0 0 0;box-shadow:-8px -8px 48px rgba(0,0,0,.3);}' +
    '@media(min-width:640px){#saOverlay{padding:0 24px 24px 0;}#saModal{border-radius:10px;}}' +
    '@media(max-width:639px){#saModal{width:100vw;height:88vh;border-radius:10px 10px 0 0;}#saOverlay{justify-content:center;}}' +
    '.saHead{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border,#CBD5E1);}' +
    '.saHead .st{color:var(--gold,#C9A848);font-size:1.05rem;}' +
    '.saHead .tt{font-family:var(--font-heading,serif);font-size:1.1rem;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--on-surface,#0F1B30);}' +
    '.saHead .fx{background:none;border:none;font-size:1.05rem;color:var(--slate,#6B7380);cursor:pointer;padding:4px 8px;}' +
    '#saMsgs{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px;}' +
    '.saRow{display:flex;}.saRow.user{justify-content:flex-end;}' +
    '.saBub{max-width:84%;padding:9px 13px;border-radius:8px;font-size:.87rem;line-height:1.5;word-break:break-word;font-family:var(--font-body,sans-serif);}' +
    '.saRow.user .saBub{background:var(--navy,#1C2B4A);color:var(--on-navy,#FDFCFA);}' +
    '.saRow.agent .saBub,.saRow.system .saBub{background:var(--ivory,#F5F3EF);color:var(--on-surface,#0F1B30);}' +
    '.saMeta{font-size:.58rem;letter-spacing:.08em;text-transform:uppercase;color:var(--slate,#6B7380);margin-bottom:3px;}' +
    '.saApply{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}' +
    '.saBtn{display:inline-flex;align-items:center;padding:6px 13px;border-radius:2px;font-size:.68rem;font-weight:600;' +
    'letter-spacing:.08em;text-transform:uppercase;border:none;cursor:pointer;font-family:var(--font-body,sans-serif);text-decoration:none;}' +
    '.saBtn.gold{background:var(--gold,#C9A848);color:var(--on-gold,#0F1B30);}' +
    '.saBtn.ghost{background:transparent;color:var(--navy,#1C2B4A);border:1.5px solid var(--navy-mid,#2E4270);}' +
    '.saForm{display:flex;flex-direction:column;gap:6px;margin-top:8px;min-width:210px;}' +
    '.saForm input{padding:8px 10px;border:1px solid var(--border,#CBD5E1);border-radius:3px;font-family:inherit;font-size:.85rem;}' +
    '.saDone{margin-top:8px;font-size:.76rem;color:var(--success,#15803D);font-weight:600;}' +
    '#saSugg{display:flex;gap:6px;overflow-x:auto;padding:8px 16px 2px;align-items:center;scrollbar-width:none;}' +
    '#saSugg::-webkit-scrollbar{display:none;}' +
    '.saChip{flex:0 0 auto;background:#fff;border:1px solid var(--border,#CBD5E1);color:var(--navy,#1C2B4A);' +
    'font-size:.7rem;font-weight:500;padding:6px 11px;border-radius:14px;cursor:pointer;white-space:nowrap;font-family:var(--font-body,sans-serif);}' +
    '.saChip:hover{border-color:var(--gold,#C9A848);}' +
    '#saCycle{flex:0 0 auto;background:none;border:none;color:var(--gold,#C9A848);font-size:.95rem;cursor:pointer;padding:2px 6px;}' +
    '#saStatus{font-size:.7rem;color:var(--slate,#6B7380);font-style:italic;padding:2px 16px;min-height:16px;}' +
    '.saIn{display:flex;gap:8px;padding:10px 16px 14px;}' +
    '.saIn input{flex:1;padding:10px 13px;border:1px solid var(--border,#CBD5E1);border-radius:4px;font-family:var(--font-body,sans-serif);font-size:.88rem;}' +
    '.saIn input:focus{outline:none;border-color:var(--navy,#1C2B4A);}';

  function buildUI() {
    if (document.getElementById('saOverlay')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var fab = document.createElement('button');
    fab.id = 'saFab'; fab.title = 'Agent'; fab.innerHTML = '&#10022;';
    fab.addEventListener('click', function () { API.open(); });
    document.body.appendChild(fab);

    var ov = document.createElement('div');
    ov.id = 'saOverlay';
    ov.innerHTML =
      '<div id="saModal">' +
        '<div class="saHead"><span class="st">&#10022;</span><span class="tt" id="saTitle">Assistant</span>' +
        '<button class="fx" id="saClose" title="Close">&times;</button></div>' +
        '<div id="saMsgs"></div>' +
        '<div id="saSugg"></div>' +
        '<div id="saStatus"></div>' +
        '<div class="saIn"><input id="saInput" type="text" placeholder="Ask the agent\u2026" autocomplete="off" disabled>' +
        '<button class="saBtn gold" id="saSend" disabled>Send</button></div>' +
      '</div>';
    document.body.appendChild(ov);

    ov.addEventListener('click', function (e) { if (e.target === ov) API.close(); });
    document.getElementById('saClose').addEventListener('click', function () { API.close(); });
    document.getElementById('saSend').addEventListener('click', send);
    var inp = document.getElementById('saInput');
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    inp.addEventListener('input', function () {
      if (!S.socket || !S.threadId) return;
      S.socket.emit('chat:typing', { threadId: S.threadId, state: 'start' });
      clearTimeout(S.typingTimer);
      S.typingTimer = setTimeout(function () { S.socket.emit('chat:typing', { threadId: S.threadId, state: 'stop' }); }, 1200);
    });

    // Delegated clicks: Apply buttons + contact-form submits (no inline JSON).
    document.getElementById('saMsgs').addEventListener('click', function (e) {
      var ap = e.target.closest('[data-sa-apply]');
      if (ap) return applyFill(ap);
      var fs = e.target.closest('[data-sa-form-send]');
      if (fs) return formSubmit(fs);
    });
  }

  // ── Socket ──────────────────────────────────────────────────────────────────
  function ensureIo() {
    return new Promise(function (res, rej) {
      if (window.io) return res(window.io);
      var sc = document.createElement('script');
      sc.src = '/socket.io/socket.io.js';
      sc.onload = function () { res(window.io); };
      sc.onerror = function () { rej(new Error('socket client failed to load')); };
      document.head.appendChild(sc);
    });
  }

  function connect() {
    if (S.socket) return S.socket;
    S.socket = window.io('/chat', { path: '/socket.io', withCredentials: true });
    S.socket.on('connect', function () {
      status('');
      if (S.threadId) S.socket.emit('chat:join', { threadId: S.threadId, db: S.tenantDb });
    });
    S.socket.on('connect_error', function (e) { status('Reconnecting\u2026 (' + (e.message || e) + ')'); });
    S.socket.on('chat:error', function (d) { status(d.message || 'Error'); });
    S.socket.on('chat:joined', function (d) {
      if (String(d.threadId) !== String(S.threadId)) return;
      var box = document.getElementById('saMsgs'); box.innerHTML = '';
      (d.messages || []).forEach(render);
      var can = d.canWrite !== false;
      document.getElementById('saInput').disabled = !can;
      document.getElementById('saSend').disabled = !can;
      status(can ? '' : 'This thread is ' + d.status + '.');
      if (S.seed) { document.getElementById('saInput').value = S.seed; S.seed = ''; }
      document.getElementById('saInput').focus();
      scroll();
    });
    S.socket.on('chat:message', function (m) {
      if (String(m.threadId) !== String(S.threadId)) return;
      render(m); scroll();
    });
    S.socket.on('chat:agent-status', function (d) {
      if (String(d.threadId) !== String(S.threadId)) return;
      status(d.state === 'thinking' ? 'Agent is thinking\u2026' : '');
    });
    S.socket.on('chat:typing', function (d) {
      if (String(d.threadId) !== String(S.threadId)) return;
      status(d.state === 'start' ? (d.name || 'Someone') + ' is typing\u2026' : '');
    });
    S.socket.on('chat:contact-saved', function (d) {
      if (String(d.threadId) !== String(S.threadId)) return;
      var forms = document.querySelectorAll('#saMsgs .saForm');
      forms.forEach(function (w) { w.innerHTML = '<div class="saDone">Contact received \u2713</div>'; });
    });
    return S.socket;
  }

  function status(t) { var el = document.getElementById('saStatus'); if (el) el.textContent = t || ''; }
  function scroll() { var b = document.getElementById('saMsgs'); if (b) b.scrollTop = b.scrollHeight; }

  // ── Rendering ───────────────────────────────────────────────────────────────
  function render(m) {
    var box = document.getElementById('saMsgs'); if (!box) return;
    var role = m.authorType === 'user' ? 'user' : (m.authorType === 'system' ? 'system' : 'agent');
    var row = document.createElement('div'); row.className = 'saRow ' + role;
    var h = '<div class="saBub">';
    if (role !== 'user') h += '<div class="saMeta">' + esc(m.authorName || 'Agent') + '</div>';
    h += esc(m.body).replace(/\n/g, '<br>');

    var meta = m.meta || {};
    if (meta.fill && Object.keys(meta.fill).length && meta.department) {
      var idx = S.fills.push({ department: meta.department, fill: meta.fill,
        section_type: meta.section_type || null, page_type: meta.page_type || null }) - 1;
      h += '<div class="saApply"><button class="saBtn gold" data-sa-apply="' + idx + '">Apply to ' + esc(meta.department) + '</button>';
      if (meta.action && meta.action.url) h += '<a class="saBtn ghost" href="' + esc(meta.action.url) + '">' + esc(meta.action.label || 'Open') + '</a>';
      h += '</div>';
    }
    if (meta.navigate) {
      h += '<div class="saApply"><a class="saBtn ghost" href="' + esc(meta.navigate) + '">Go</a></div>';
    }
    var form = meta.form;
    if (form && form.id === 'contact') {
      if (form.done) {
        h += '<div class="saDone">Contact received \u2713</div>';
      } else {
        h += '<div class="saForm" data-mid="' + esc(m._id || '') + '">';
        (form.fields || []).forEach(function (f) {
          h += '<input data-key="' + esc(f.key) + '" type="' + esc(f.type || 'text') + '" placeholder="' + esc(f.label) + (f.required ? ' *' : '') + '" autocomplete="off">';
        });
        h += '<button class="saBtn gold" data-sa-form-send="1">Send contact info</button></div>';
      }
    }
    h += '</div>';
    row.innerHTML = h;
    box.appendChild(row);
  }

  function applyFill(btn) {
    var rec = S.fills[parseInt(btn.getAttribute('data-sa-apply'), 10)];
    if (!rec) return;
    btn.disabled = true; btn.textContent = 'Applying\u2026';
    fetch('/admin/master-agent/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department: rec.department, fill: rec.fill,
        section_type: rec.section_type, page_type: rec.page_type,
        label: rec.fill.heading || rec.fill.title,
      }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      btn.textContent = d.ok ? 'Applied \u2713' : (d.message || 'Failed');
      if (d.ok && d.editUrl) {
        var a = document.createElement('a'); a.href = d.editUrl; a.className = 'saBtn ghost'; a.textContent = 'View \u2192';
        btn.parentNode.appendChild(a);
      }
      if (!d.ok) btn.disabled = false;
    }).catch(function () { btn.textContent = 'Failed'; btn.disabled = false; });
  }

  function formSubmit(btn) {
    var wrap = btn.closest('.saForm'); if (!wrap || !S.threadId) return;
    var values = {};
    wrap.querySelectorAll('input[data-key]').forEach(function (i) { values[i.dataset.key] = i.value; });
    btn.disabled = true; btn.textContent = 'Sending\u2026';
    S.socket.emit('chat:form-submit', { threadId: S.threadId, values: values, formMessageId: wrap.getAttribute('data-mid') || null });
    setTimeout(function () { if (!btn.isConnected) return; if (btn.disabled) { btn.disabled = false; btn.textContent = 'Send contact info'; } }, 8000);
  }

  function send() {
    var inp = document.getElementById('saInput');
    var body = (inp.value || '').trim();
    if (!body || !S.threadId || !S.socket) return;
    S.socket.emit('chat:message', { threadId: S.threadId, body: body });
    inp.value = '';
  }

  // ── Suggestions ─────────────────────────────────────────────────────────────
  function loadSuggestions() {
    var bar = document.getElementById('saSugg'); if (!bar) return;
    fetch('/agent/suggestions').then(function (r) { return r.json(); }).then(function (d) {
      bar.innerHTML = '';
      (d.suggestions || []).forEach(function (s) {
        var c = document.createElement('button'); c.className = 'saChip'; c.textContent = s;
        c.addEventListener('click', function () {
          var inp = document.getElementById('saInput');
          inp.value = s;
          if (/\s$/.test(s)) { inp.focus(); return; }
          send();
        });
        bar.appendChild(c);
      });
      var cy = document.createElement('button'); cy.id = 'saCycle'; cy.title = 'New suggestions'; cy.innerHTML = '&#8635;';
      cy.addEventListener('click', loadSuggestions);
      bar.appendChild(cy);
    }).catch(function () { bar.innerHTML = ''; });
  }

  // ── Open / close / resolve ──────────────────────────────────────────────────
  var API = {
    open: function (opts) {
      opts = opts || pathContext();
      buildUI();
      S.seed = opts.seed || '';
      document.getElementById('saTitle').textContent = opts.title || 'Assistant';
      document.getElementById('saMsgs').innerHTML = '<div class="saRow system"><div class="saBub">Opening\u2026</div></div>';
      document.getElementById('saOverlay').classList.add('open');
      S.open = true;
      loadSuggestions();

      fetch('/admin/agent-chat/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: opts.kind || 'agent', module: opts.module || null, title: opts.title || '' }),
      }).then(function (r) {
        if (!r.ok) throw new Error('resolve ' + r.status);
        return r.json();
      }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'resolve failed');
        S.threadId = d.threadId; S.tenantDb = d.tenantDb || '';
        return ensureIo();
      }).then(function () {
        var s = connect();
        if (s.connected) s.emit('chat:join', { threadId: S.threadId, db: S.tenantDb });
        // if not yet connected, the 'connect' handler re-joins automatically
      }).catch(function (e) {
        document.getElementById('saMsgs').innerHTML =
          '<div class="saRow system"><div class="saBub">Agent chat isn\u2019t available here (' + esc(e.message) + ').</div></div>';
      });
    },
    close: function () {
      var ov = document.getElementById('saOverlay');
      if (ov) ov.classList.remove('open');
      if (S.socket && S.threadId) S.socket.emit('chat:leave', { threadId: S.threadId });
      S.threadId = null; S.open = false;
    },
    mount: function (el, opts) {
      if (!el) return;
      el.addEventListener('click', function (e) { e.preventDefault(); API.open(opts || pathContext()); });
    },
  };

  window.SlabAgent = API;

  function init() {
    buildUI();
    // Auto-mount any declarative launchers: <x data-agent-launcher data-kind=... data-module=... data-title=... data-seed=...>
    document.querySelectorAll('[data-agent-launcher]').forEach(function (el) {
      API.mount(el, {
        kind: el.getAttribute('data-kind') || undefined,
        module: el.getAttribute('data-module') || undefined,
        title: el.getAttribute('data-title') || undefined,
        seed: el.getAttribute('data-seed') || undefined,
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
