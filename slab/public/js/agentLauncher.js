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
    ['/admin/ledger',    { kind: 'agent',  module: 'bookkeeping', title: 'Finance Agent' }],
    ['/admin/assets',    { kind: 'agent',  module: 'assets',   title: 'Asset Agent' }],
    ['/admin/print-studio', { kind: 'agent', module: 'print-studio', title: 'Print Agent' }],
    ['/admin/onboarding', { kind: 'agent', module: 'onboarding', title: 'Onboarding Agent' }],
    ['/admin/careers',   { kind: 'agent',  module: 'careers',  title: 'Careers' }],
  ];
  function pathContext() {
    var p = window.location.pathname;
    // Dashboard gets its OWN clean thread (module:'dashboard') so the ✦ opens the
    // dashboard agent — the daily briefing + prompts — instead of falling through
    // to the generic {agent,null} thread that accumulates unrelated history.
    if (p === '/admin' || p === '/admin/') return { kind: 'agent', module: 'dashboard', title: 'Dashboard Agent' };
    for (var i = 0; i < MAP.length; i++) if (p.indexOf(MAP[i][0]) === 0) return MAP[i][1];
    return { kind: 'agent', module: null, title: 'Assistant' };
  }

  var S = {
    open: false, seed: '', fills: [], // Apply registry
    // Ephemeral agent state (no thread, no socket): short client-held memory.
    history: [], module: null, title: 'Assistant', sending: false,
    dashboard: false, // when the dashboard ✦ is open, show the daily briefing
    activeScope: null, // the on-screen zone the modal is currently scoped to
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
    '@media(max-width:639px){#saOverlay{align-items:flex-end;justify-content:center;}' +
    '#saModal{width:100vw;height:82vh;height:82dvh;max-height:82dvh;border-radius:18px 18px 0 0;}' +
    '.saHead{padding:12px 14px;}#saMsgs{padding:12px 14px;}' +
    '.saIn{padding:10px 12px calc(12px + env(safe-area-inset-bottom,0px));}' +
    '.saIn input{min-height:44px;font-size:16px;}}' +
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
    '.saRow.system .saBub{border-left:3px solid var(--danger,#B91C1C);}' +
    '.saFailNote{margin-top:6px;font-size:.72rem;color:var(--slate,#6B7380);font-style:italic;}' +
    '#saSugg{display:flex;flex-wrap:wrap;gap:6px;padding:8px 16px 2px;align-items:center;max-width:100%;box-sizing:border-box;}' +
    '.saChip{flex:0 1 auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;background:#fff;border:1px solid var(--border,#CBD5E1);color:var(--navy,#1C2B4A);' +
    'font-size:.7rem;font-weight:500;padding:6px 11px;border-radius:14px;cursor:pointer;white-space:nowrap;font-family:var(--font-body,sans-serif);}' +
    '.saChip:hover{border-color:var(--gold,#C9A848);}' +
    '#saCycle{flex:0 0 auto;background:none;border:none;color:var(--gold,#C9A848);font-size:.95rem;cursor:pointer;padding:2px 6px;}' +
    '#saStatus{font-size:.7rem;color:var(--slate,#6B7380);font-style:italic;padding:2px 16px;min-height:16px;}' +
    // Scope bar — which agent(s) this ✦ can reach and what each runs on.
    '#saScope{border-bottom:1px solid var(--border,#CBD5E1);background:var(--ivory,#F5F3EF);font-family:var(--font-body,sans-serif);}' +
    '#saScope[hidden]{display:none;}' +
    '#saScopeBar{display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;cursor:pointer;' +
    'padding:7px 16px;font-size:.68rem;color:var(--slate,#6B7380);text-align:left;font-family:inherit;}' +
    '#saScopeBar:hover{color:var(--navy,#1C2B4A);}' +
    '#saScopeBar .sEng{font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--navy,#1C2B4A);}' +
    '#saScopeBar .sMod{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.66rem;}' +
    '#saScopeBar .sCar{margin-left:auto;transition:transform .15s;}' +
    '#saScope.open #saScopeBar .sCar{transform:rotate(180deg);}' +
    '#saScopeList{display:none;padding:2px 16px 10px;}' +
    '#saScope.open #saScopeList{display:block;}' +
    '.sAg{display:flex;align-items:baseline;gap:6px;padding:4px 0;font-size:.7rem;border-top:1px dashed var(--border,#CBD5E1);}' +
    '.sAg .n{font-weight:600;color:var(--navy,#1C2B4A);}' +
    '.sAg .t{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.63rem;color:var(--slate,#6B7380);}' +
    '.sAg .m{margin-left:auto;font-size:.63rem;color:var(--slate,#6B7380);white-space:nowrap;}' +
    '.sAg.off .n{text-decoration:line-through;opacity:.6;}' +
    '#saScopeList .sFoot{display:block;margin-top:8px;font-size:.66rem;color:var(--navy,#1C2B4A);}' +
    '.saIn{display:flex;gap:8px;padding:10px 16px 14px;}' +
    '.saIn input{flex:1;padding:10px 13px;border:1px solid var(--border,#CBD5E1);border-radius:4px;font-family:var(--font-body,sans-serif);font-size:.88rem;}' +
    '.saIn input:focus{outline:none;border-color:var(--navy,#1C2B4A);}' +
    '.saBrief{margin:8px 0 2px;padding-left:18px;}.saBrief li{margin-bottom:4px;font-size:.84rem;line-height:1.45;}';

  function buildUI() {
    if (document.getElementById('saOverlay')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    // Assistant mark — a chat bubble with a thinking dot. Deliberately NOT a
    // four-point sparkle (that read too close to Google Gemini's icon).
    function saIcon(sz) {
      return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
        'style="display:block;">' +
        '<path d="M21 11.5a8.5 8.5 0 0 1-11.9 7.8L3 21l1.7-6.1A8.5 8.5 0 1 1 21 11.5z"/>' +
        '<circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none"/>' +
        '<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>' +
        '<circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none"/></svg>';
    }

    var fab = document.createElement('button');
    fab.id = 'saFab'; fab.title = 'Agent'; fab.innerHTML = saIcon(22);
    fab.addEventListener('click', function () { API.open(); });
    document.body.appendChild(fab);

    var ov = document.createElement('div');
    ov.id = 'saOverlay';
    ov.innerHTML =
      '<div id="saModal">' +
        '<div class="saHead"><span class="st" style="display:inline-flex;align-items:center;">' + saIcon(18) + '</span><span class="tt" id="saTitle">Assistant</span>' +
        '<button class="fx" id="saClose" title="Close">&times;</button></div>' +
        '<div id="saScope" hidden><button id="saScopeBar" type="button"></button><div id="saScopeList"></div></div>' +
        '<div id="saMsgs"></div>' +
        '<div id="saSugg"></div>' +
        '<div id="saStatus"></div>' +
        '<div class="saIn"><input id="saInput" type="text" placeholder="Ask the agent\u2026" autocomplete="off" disabled>' +
        '<button class="saBtn gold" id="saSend" disabled>Send</button></div>' +
      '</div>';
    document.body.appendChild(ov);

    ov.addEventListener('click', function (e) { if (e.target === ov) API.close(); });
    document.getElementById('saClose').addEventListener('click', function () { API.close(); });
    document.getElementById('saScopeBar').addEventListener('click', function () {
      document.getElementById('saScope').classList.toggle('open');
    });
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
      var pr = e.target.closest('[data-sa-prompt]');
      if (pr) { var inp = document.getElementById('saInput'); inp.value = pr.getAttribute('data-sa-prompt'); inp.focus(); return; }
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
      if (S.dashboard) offerBriefing();
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
    if (role !== 'user') {
      // Name the agent that actually handled THIS turn and what it ran on, so a
      // reply is never anonymous — "which agent did that, on which model?" is
      // answerable per message instead of only in Agent Control.
      var rt = (m.meta && m.meta.runtime) || null;
      h += '<div class="saMeta">' + esc(m.authorName || 'Agent') +
        (rt ? ' &middot; ' + esc(rt.agent || 'agent') + ' &middot; ' +
              esc(rt.engineLabel || '') + ' ' + esc(rt.model || '') : '') + '</div>';
    }
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

  // Dashboard daily briefing — text + scannable bullets + action chips (href
  // navigates; prompt drops into the input).
  //
  // NOT auto-fired. /admin/master-agent/briefing runs an LLM generation on every
  // call, and opening the dashboard ✦ is a cheap, frequent gesture — auto-firing
  // spent a model call every time someone glanced at the panel. The offer is
  // rendered instead, and the generation happens only when it's asked for.
  function offerBriefing() {
    var box = document.getElementById('saMsgs'); if (!box) return;
    var row = document.createElement('div'); row.className = 'saRow agent';
    row.innerHTML =
      '<div class="saBub"><div class="saMeta">Dashboard</div>' +
      'Ask me anything, or pull today\'s briefing — what happened, what needs attention.' +
      '<div class="saApply"><button class="saBtn ghost" id="saBrief">Today\'s briefing</button></div></div>';
    box.appendChild(row);
    var btn = document.getElementById('saBrief');
    if (btn) btn.addEventListener('click', function () {
      btn.disabled = true; btn.textContent = 'Reading the day…';
      loadBriefing(function () {
        if (!btn.isConnected) return;
        btn.disabled = false; btn.textContent = 'Retry briefing';
      });
    });
    scroll();
  }

  function loadBriefing(onFail) {
    status('Building your briefing…');
    fetch('/admin/master-agent/briefing')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        status('');
        renderBriefing(d);
        var btn = document.getElementById('saBrief');
        if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
      })
      .catch(function () {
        status('');
        render({ authorType: 'system', body: 'Could not build the briefing just now.' });
        scroll();
        if (typeof onFail === 'function') onFail();
      });
  }
  function renderBriefing(data) {
    var box = document.getElementById('saMsgs'); if (!box || !data) return;
    var row = document.createElement('div'); row.className = 'saRow agent';
    var h = '<div class="saBub"><div class="saMeta">Daily briefing</div>';
    h += esc(data.briefing || '').replace(/\n/g, '<br>');
    if (data.bullets && data.bullets.length) {
      h += '<ul class="saBrief">';
      data.bullets.forEach(function (b) { h += '<li>' + esc(b) + '</li>'; });
      h += '</ul>';
    }
    if (data.actions && data.actions.length) {
      h += '<div class="saApply">';
      data.actions.forEach(function (a) {
        var icon = a.icon ? esc(a.icon) + ' ' : '';
        if (a.href) h += '<a class="saBtn ghost" href="' + esc(a.href) + '">' + icon + esc(a.label) + '</a>';
        else if (a.prompt) h += '<button type="button" class="saBtn ghost" data-sa-prompt="' + esc(a.prompt) + '">' + icon + esc(a.label) + '</button>';
      });
      h += '</div>';
    }
    h += '</div>';
    row.innerHTML = h;
    box.appendChild(row); scroll();
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

  // ── Failure affordance ─────────────────────────────────────────────────────
  // A failed turn is never a dead end. Every failure bubble carries:
  //   ↻ Retry   — re-POSTs the EXACT payload that failed (history is rewound
  //               first, so the retry isn't poisoned by the failed turn)
  //   ⚑ Report  — ships the failure to /api/client-error (the observability
  //               feed behind /superadmin/reports) and says so
  // The retry is held for a few seconds with a live countdown: the common cause
  // is a busy/restarting model backend, and an instant re-fire just fails again.
  var RETRY_HOLD_SECONDS = 5;
  var failSeq = 0;

  function failureBubble(detail, payload) {
    var id = 'saFail' + (++failSeq);
    var box = document.getElementById('saMsgs');
    if (!box) return;
    var row = document.createElement('div');
    row.className = 'saRow system';
    row.innerHTML =
      '<div class="saBub"><div class="saMeta">Failed</div>' +
      esc(detail || 'The agent did not respond.') +
      '<div class="saFailNote" id="' + id + 'n">Give it a few seconds — the model may be busy.</div>' +
      '<div class="saApply">' +
        '<button class="saBtn gold" id="' + id + 'r" disabled>Retry in ' + RETRY_HOLD_SECONDS + 's</button>' +
        '<button class="saBtn ghost" id="' + id + 'p">&#9873; Report</button>' +
      '</div></div>';
    box.appendChild(row);
    scroll();

    var btn = document.getElementById(id + 'r');
    var left = RETRY_HOLD_SECONDS;
    var tick = setInterval(function () {
      left--;
      if (!btn || !btn.isConnected) { clearInterval(tick); return; }
      if (left <= 0) {
        clearInterval(tick);
        btn.disabled = false;
        btn.textContent = '↻ Retry';
      } else {
        btn.textContent = 'Retry in ' + left + 's';
      }
    }, 1000);

    if (btn) btn.addEventListener('click', function () {
      if (btn.disabled) return;
      btn.disabled = true; btn.textContent = 'Retrying…';
      clearInterval(tick);
      resend(payload);
    });

    var rep = document.getElementById(id + 'p');
    if (rep) rep.addEventListener('click', function () {
      rep.disabled = true;
      reportFailure(detail, payload);
      rep.textContent = 'Reported ✓';
      var note = document.getElementById(id + 'n');
      if (note) note.textContent = 'Sent to the error log. Retry when you\'re ready.';
    });
  }

  function reportFailure(detail, payload) {
    try {
      var body = JSON.stringify({
        kind: 'agent-failure',
        message: 'Agent turn failed: ' + String(detail || 'unknown'),
        source: 'agentLauncher',
        line: 0, col: 0,
        stack: JSON.stringify({
          module: (payload && payload.module) || null,
          title: S.title || null,
          lastUser: lastUserText(payload),
        }).slice(0, 4000),
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* reporting must never throw */ }
  }

  function lastUserText(payload) {
    var msgs = (payload && payload.messages) || [];
    for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') return String(msgs[i].content || '').slice(0, 500);
    return '';
  }

  // Ephemeral agentic turn — stateless HTTP, no thread. Short memory is the
  // client-held S.history (last few turns) sent with each request.
  function send() {
    var inp = document.getElementById('saInput');
    var body = (inp.value || '').trim();
    if (!body || S.sending) return;
    inp.value = '';
    S.history.push({ role: 'user', content: body });
    render({ authorType: 'user', body: body });
    scroll();
    post({ messages: S.history.slice(-8), module: S.module || null });
  }

  // Re-fire a payload verbatim. The failed turn left no assistant reply in
  // S.history, so the payload is still exactly what the model should see.
  function resend(payload) {
    if (S.sending || !payload) return;
    post(payload);
  }

  function post(payload) {
    S.sending = true; status('Thinking…');
    document.getElementById('saSend').disabled = true;
    fetch('/admin/agent-chat/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      status('');
      if (!d || !d.ok) { failureBubble((d && d.error) || 'The agent returned an error.', payload); return; }
      S.history.push({ role: 'assistant', content: d.reply || '' });
      render({
        authorType: 'agent', authorName: S.title || 'Agent', body: d.reply || 'Done.',
        meta: { department: d.department || null, fill: d.fill || null, action: d.action || null,
          navigate: d.navigate || null, section_type: d.section_type || null, page_type: d.page_type || null,
          runtime: d.runtime || null },
      });
      // Agentic path returns one or more proposed changes — render an Apply per fill.
      if (Array.isArray(d.fills)) {
        d.fills.forEach(function (f) {
          if (!f || !f.fill) return;
          render({ authorType: 'agent', authorName: S.title || 'Agent', body: 'Proposed change — ' + (f.department || 'agent'),
            meta: { department: f.department || null, fill: f.fill, section_type: f.section_type || null, page_type: f.page_type || null } });
        });
      }
      scroll();
    }).catch(function (e) {
      status('');
      failureBubble('Could not reach the agent' + (e && e.message ? ' (' + e.message + ')' : '') + '.', payload);
    }).finally(function () {
      S.sending = false;
      var sendBtn = document.getElementById('saSend');
      var inputEl = document.getElementById('saInput');
      if (sendBtn) sendBtn.disabled = false;
      if (inputEl) inputEl.focus();
    });
  }

  // ── Suggestions ─────────────────────────────────────────────────────────────
  // Render chips (capped so the wrapped row stays compact) + the ↻ recycle button.
  function renderChips(list) {
    var bar = document.getElementById('saSugg'); if (!bar) return;
    bar.innerHTML = '';
    (list || []).slice(0, 4).forEach(function (s) {
      var c = document.createElement('button'); c.className = 'saChip'; c.textContent = s; c.title = s;
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
  }

  function loadSuggestions() {
    var bar = document.getElementById('saSugg'); if (!bar) return;
    // Micro-focus first: if the scope zone declares its own field/task-level
    // suggestions (data-agent-suggest="task|task"), use those verbatim — tight,
    // achievable, non-generic. Recycle reshuffles them. Otherwise fall back to the
    // module pool from the server.
    var scoped = S.activeScope && S.activeScope.suggest;
    if (scoped && scoped.length) {
      renderChips(scoped.slice().sort(function () { return Math.random() - 0.5; }));
      return;
    }
    fetch('/agent/suggestions?module=' + encodeURIComponent(S.module || '') + '&_=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (d) { renderChips(d.suggestions || []); })
      .catch(function () { bar.innerHTML = ''; });
  }

  // ── Open / close / resolve ──────────────────────────────────────────────────
  // ── Active-scope tracking ────────────────────────────────────────────────────
  // The master ✦ modal follows the part of the screen you're actually working in.
  // Tag any section/panel/input with data-agent-scope="<module>" (optionally
  // data-agent-kind / data-agent-title) to make it a scope zone; whichever zone is
  // most in view — or holds focus — sets the agent's scope, so the same modal
  // routes to the right agent as you move around the page. Falls back to the URL
  // (pathContext) when nothing is tagged / in view.
  function titleize(m) { return String(m || '').replace(/[-_]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function scopeFromEl(el) {
    var z = el && el.closest ? el.closest('[data-agent-scope]') : null;
    if (!z) return null;
    var sug = z.getAttribute('data-agent-suggest');
    return {
      el: z,
      module: z.getAttribute('data-agent-scope') || null,
      kind: z.getAttribute('data-agent-kind') || undefined,
      title: z.getAttribute('data-agent-title') || undefined,
      // Field/task-level micro-suggestions for THIS zone (pipe-separated), used
      // verbatim over the module pool so chips match the exact task in view.
      suggest: sug ? sug.split('|').map(function (x) { return x.trim(); }).filter(Boolean) : null,
    };
  }
  function currentContext() {
    if (S.activeScope && S.activeScope.module) {
      return { kind: S.activeScope.kind || 'agent', module: S.activeScope.module,
        title: S.activeScope.title || (titleize(S.activeScope.module) + ' Agent') };
    }
    return pathContext();
  }
  function setActiveScope(scope) {
    var prev = S.activeScope;
    if ((prev && prev.el) === (scope && scope.el)) return; // no change
    S.activeScope = scope;
    // Live-retarget an OPEN modal (except the dashboard coordinator, which owns its
    // own briefing scope). Only the NEXT send is routed differently — history stays.
    if (S.open && !S.dashboard) {
      var ctx = currentContext();
      S.module = ctx.module || null;
      S.title = ctx.title || 'Assistant';
      var t = document.getElementById('saTitle'); if (t) t.textContent = S.title;
      loadSuggestions(); // chips follow the new agent focus
      loadScope();       // …and so does the disclosed agent/model scope
      status('Now scoped to ' + S.title);
      clearTimeout(S._scopeMsgT);
      S._scopeMsgT = setTimeout(function () { if (S.open && !S.sending) status(''); }, 1800);
    }
  }
  var _scopeIO = null, _scopeRatios = null;
  function refreshScopeZones() {
    var zones = [].slice.call(document.querySelectorAll('[data-agent-scope]'));
    if (!zones.length || !('IntersectionObserver' in window)) return;
    if (!_scopeIO) {
      _scopeRatios = new Map();
      _scopeIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { _scopeRatios.set(en.target, en.isIntersecting ? en.intersectionRatio : 0); });
        var bestEl = null, best = 0;
        _scopeRatios.forEach(function (r, el) { if (r > best) { best = r; bestEl = el; } });
        if (best <= 0) { setActiveScope(null); return; }        // nothing in view → path fallback
        setActiveScope(scopeFromEl(bestEl));
      }, { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-8% 0px -8% 0px' });
    }
    zones.forEach(function (z) {
      if (z._saObserved) return;
      z._saObserved = true;
      // Controls (tab buttons / links) are click+focus triggers, NOT visibility
      // zones — they're always on screen, so observing them would make the scope
      // flap. Only observe real content sections; buttons/links retarget on click.
      if (z.tagName !== 'BUTTON' && z.tagName !== 'A') _scopeIO.observe(z);
    });
  }
  function initScopeTracking() {
    // Focus + click are the strongest "I'm working here" signals — retarget now.
    // (Click matters because a <button> doesn't take focus on click in Firefox/
    // Safari, so tagged tab buttons would otherwise be missed.)
    function fromEvent(e) { var sc = scopeFromEl(e.target); if (sc) setActiveScope(sc); }
    document.addEventListener('focusin', fromEvent);
    document.addEventListener('click', fromEvent, true);
    refreshScopeZones();
  }

  // ── Scope bar ───────────────────────────────────────────────────────────────
  // Shows which agent(s) THIS ✦ can reach and what each actually runs on. The
  // engine/model settings live in Agent Control (/admin/chat); without this the
  // modal gave no clue which agent handled a request or on what model, so the
  // settings felt disconnected from the runtime. Collapsed = the headline; open =
  // the full per-agent list with a jump to the settings screen.
  function renderScope(d) {
    var wrap = document.getElementById('saScope'); if (!wrap) return;
    if (!d || !d.ok || !d.agents || !d.agents.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    wrap.classList.remove('open');

    // Headline = the surface's primary agent when it has one, else the default.
    var lead = null;
    if (d.primary) { for (var i = 0; i < d.agents.length; i++) if (d.agents[i].key === d.primary) lead = d.agents[i]; }
    var rt = lead || d.tenantDefault || {};
    var what = lead ? lead.label : (d.scoped ? d.agents.length + ' agents' : 'All agents');
    document.getElementById('saScopeBar').innerHTML =
      '<span>' + esc(what) + '</span><span>&middot;</span>' +
      '<span class="sEng">' + esc(rt.engineLabel || 'House') + '</span>' +
      '<span class="sMod">' + esc(rt.model || '') + '</span>' +
      '<span class="sCar">&#9662;</span>';

    var rows = d.agents.map(function (a) {
      return '<div class="sAg' + (a.enabled ? '' : ' off') + '">' +
        '<span class="n">' + esc(a.label) + '</span>' +
        '<span class="t">' + esc(a.tool) + '</span>' +
        '<span class="m">' + esc(a.engineLabel || 'House') + ' ' + esc(a.model || '') +
        (a.source && a.source !== 'platform' ? ' <em>(' + esc(a.source) + ')</em>' : '') + '</span></div>';
    }).join('');
    document.getElementById('saScopeList').innerHTML = rows +
      '<a class="sFoot" href="' + esc(d.settingsUrl || '/admin/chat') + '">Change engine &amp; model in Agent Control &rarr;</a>';
  }

  function loadScope() {
    var wrap = document.getElementById('saScope'); if (wrap) wrap.hidden = true;
    fetch('/admin/agent-chat/scope?module=' + encodeURIComponent(S.module || ''))
      .then(function (r) { return r.json(); }).then(renderScope).catch(function () { /* non-fatal */ });
  }

  var API = {
    open: function (opts) {
      refreshScopeZones();          // pick up any newly-rendered scope zones
      opts = opts || currentContext();
      buildUI();
      // Ephemeral: fresh short memory each open, no thread resolution, no socket.
      S.history = [];
      S.module = opts.module || null;
      S.title = opts.title || 'Assistant';
      S.dashboard = (opts.module === 'dashboard');
      document.getElementById('saTitle').textContent = S.title;
      document.getElementById('saMsgs').innerHTML = '';
      document.getElementById('saInput').disabled = false;
      document.getElementById('saSend').disabled = false;
      document.getElementById('saOverlay').classList.add('open');
      S.open = true;
      loadSuggestions();
      loadScope();                  // disclose which agent(s) + model this ✦ runs
      if (opts.seed) document.getElementById('saInput').value = opts.seed;
      if (S.dashboard) offerBriefing();  // offered, not auto-generated — see loadBriefing
      document.getElementById('saInput').focus();
    },
    close: function () {
      var ov = document.getElementById('saOverlay');
      if (ov) ov.classList.remove('open');
      S.history = []; S.open = false;
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
    initScopeTracking(); // watch on-screen scope zones so the ✦ modal retargets
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
