/**
 * Slab — Public Support Bubble
 * ─────────────────────────────────────────────────────────────────────────────
 * The guest-facing ✦ concierge on tenant public sites. Self-contained: injects a
 * floating ✦ button + slide-up chat modal, styled with the tenant's brand tokens
 * (--primary/--accent from the page).
 *
 * Transport: the guest talks over HTTP (POST /support-chat) and RECEIVES replies
 * by polling (GET /support-poll) — the same channel delivers a human staffer's
 * messages when an admin takes over the conversation from Chat Control, plus the
 * green "X is joining the chat" notice. On reload it rebuilds from GET
 * /support-history, reconnected via a short-lived `sb_sid` cookie.
 *
 * Loaded only when the tenant's chatbot toggle is on (gated in seo-head).
 */
(function () {
  'use strict';
  if (window.__slabSupport) return;
  window.__slabSupport = true;

  var S = {
    open: false, sending: false, history: [], greeted: false, lastText: '',
    seen: {}, q: [], draining: false, pollAfter: '', pollTimer: null,
    loaded: false, takeover: false,
  };
  var BIZ = (document.querySelector('meta[property="og:site_name"]') || {}).content
    || (document.title || '').split(/[|–—]/)[0].trim() || 'us';

  // ── Session id in a short-lived cookie ──────────────────────────────────────
  // A reload within the TTL window reconnects the visitor to the same reviewable
  // thread (and any live takeover in progress); after it lapses they start fresh.
  var SID_TTL_HOURS = 3;
  function getCookie(n) { var m = document.cookie.match('(?:^|; )' + n + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : ''; }
  function setCookie(n, v, hours) {
    var d = new Date(Date.now() + hours * 3600 * 1000);
    document.cookie = n + '=' + encodeURIComponent(v) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }
  var SID = getCookie('sb_sid');
  if (!SID) { SID = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
  setCookie('sb_sid', SID, SID_TTL_HOURS); // refresh the TTL on every visit

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var CSS = '' +
    '#sbFab{position:fixed;bottom:22px;right:22px;z-index:99990;width:56px;height:56px;border-radius:50%;' +
    'background:var(--primary,#1C2B4A);color:var(--on-primary,#fff);border:none;cursor:pointer;' +
    'display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 6px 22px rgba(0,0,0,.28);' +
    'transition:transform .15s,box-shadow .15s;}' +
    '#sbFab:hover{transform:scale(1.08);box-shadow:0 8px 30px rgba(0,0,0,.35);}' +
    '#sbFab .sbDot{position:absolute;top:2px;right:2px;width:11px;height:11px;border-radius:50%;background:var(--accent,#C9A848);border:2px solid var(--primary,#1C2B4A);}' +
    '#sbWrap{position:fixed;bottom:88px;right:22px;z-index:99991;width:min(380px,calc(100vw - 32px));' +
    'height:min(560px,calc(100vh - 120px));background:#fff;border-radius:16px;overflow:hidden;display:none;' +
    'flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,.3);font-family:var(--font-body,system-ui,sans-serif);}' +
    '#sbWrap.open{display:flex;animation:sbIn .18s ease;}' +
    '@keyframes sbIn{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:none;}}' +
    '.sbHead{background:var(--primary,#1C2B4A);color:var(--on-primary,#fff);padding:14px 16px;display:flex;align-items:center;gap:10px;}' +
    '.sbHead .sbStar{color:var(--accent,#C9A848);font-size:1.1rem;}' +
    '.sbHead .sbT{flex:1;min-width:0;font-weight:600;font-size:.98rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.sbHead .sbX{background:none;border:none;color:inherit;opacity:.8;font-size:1.3rem;cursor:pointer;line-height:1;padding:0 2px;}' +
    '.sbMsgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:9px;background:#f7f7f8;}' +
    '.sbRow{display:flex;flex-direction:column;}.sbRow.me{align-items:flex-end;}.sbRow.bot{align-items:flex-start;}' +
    '.sbName{font-size:.7rem;color:#8a8a8a;margin:0 0 2px 3px;}' +
    '.sbBub{max-width:82%;padding:9px 13px;border-radius:14px;font-size:.9rem;line-height:1.45;word-break:break-word;}' +
    '.sbRow.me .sbBub{background:var(--primary,#1C2B4A);color:var(--on-primary,#fff);border-bottom-right-radius:4px;}' +
    '.sbRow.bot .sbBub{background:#fff;color:#1a1a1a;border:1px solid #e6e6e8;border-bottom-left-radius:4px;}' +
    '.sbRow.staff .sbBub{background:var(--accent,#C9A848);color:var(--on-accent,#1a1a1a);border:none;}' +
    '.sbBub.sbTyping::after{content:"";display:inline-block;width:2px;height:1em;background:currentColor;opacity:.55;margin-left:2px;vertical-align:-2px;animation:sbBlink 1s steps(1) infinite;}' +
    '@keyframes sbBlink{50%{opacity:0;}}' +
    '.sbRow.bot .sbBub.sbErr{background:#fff3f2;border-color:#f3c9c4;color:#7a2420;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
    '.sbRetry{background:var(--primary,#1C2B4A);color:var(--on-primary,#fff);border:none;border-radius:12px;padding:4px 13px;font-size:.8rem;cursor:pointer;font-family:inherit;font-weight:600;}' +
    '.sbRetry:hover{opacity:.9;}' +
    '.sbNotice{align-self:center;background:#e7f6ec;color:#1b7a3d;border:1px solid #b6e0c2;border-radius:12px;padding:4px 12px;font-size:.76rem;margin:2px 0;text-align:center;max-width:90%;}' +
    '.sbStatus{font-size:.75rem;color:#8a8a8a;font-style:italic;padding:0 14px 4px;min-height:16px;}' +
    '.sbFoot{border-top:1px solid #ececee;padding:10px;display:flex;gap:8px;background:#fff;}' +
    '.sbFoot input{flex:1;padding:11px 13px;border:1px solid #dcdce0;border-radius:22px;font-size:.9rem;font-family:inherit;outline:none;}' +
    '.sbFoot input:focus{border-color:var(--primary,#1C2B4A);}' +
    '.sbSend{background:var(--primary,#1C2B4A);color:var(--on-primary,#fff);border:none;border-radius:22px;padding:0 16px;font-weight:600;cursor:pointer;font-size:.85rem;}' +
    '.sbSend:disabled{opacity:.5;cursor:default;}' +
    '.sbLead{background:none;border:none;color:var(--primary,#1C2B4A);font-size:.78rem;text-decoration:underline;cursor:pointer;padding:2px 14px 8px;text-align:left;}' +
    '.sbForm{display:flex;flex-direction:column;gap:7px;padding:10px 12px;background:#fff;border-top:1px solid #ececee;}' +
    '.sbForm input,.sbForm textarea{padding:9px 11px;border:1px solid #dcdce0;border-radius:8px;font-size:.86rem;font-family:inherit;outline:none;}' +
    '.sbForm textarea{resize:vertical;min-height:52px;}' +
    '.sbForm .sbSend{border-radius:8px;padding:10px;}' +
    '.sbForm .sbCancel{background:none;border:none;color:#8a8a8a;font-size:.78rem;cursor:pointer;}';

  function build() {
    if (document.getElementById('sbFab')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var fab = document.createElement('button');
    fab.id = 'sbFab'; fab.type = 'button'; fab.setAttribute('aria-label', 'Chat with us');
    fab.innerHTML = '&#10022;<span class="sbDot"></span>';
    fab.addEventListener('click', toggle);
    document.body.appendChild(fab);

    var w = document.createElement('div');
    w.id = 'sbWrap';
    w.innerHTML =
      '<div class="sbHead"><span class="sbStar">&#10022;</span><span class="sbT">' + esc(BIZ) + '</span>' +
      '<button class="sbX" type="button" aria-label="Close">&times;</button></div>' +
      '<div class="sbMsgs" id="sbMsgs"></div>' +
      '<div class="sbStatus" id="sbStatus"></div>' +
      '<button class="sbLead" id="sbLead" type="button">Leave your details and we’ll follow up →</button>' +
      '<div class="sbFoot"><input id="sbIn" type="text" placeholder="Type a message…" autocomplete="off">' +
      '<button class="sbSend" id="sbSend" type="button">Send</button></div>';
    document.body.appendChild(w);

    w.querySelector('.sbX').addEventListener('click', toggle);
    document.getElementById('sbSend').addEventListener('click', function () { send(); });
    document.getElementById('sbLead').addEventListener('click', showLeadForm);
    var inp = document.getElementById('sbIn');
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  }

  function toggle() {
    build();
    var w = document.getElementById('sbWrap');
    S.open = !w.classList.contains('open');
    w.classList.toggle('open', S.open);
    if (S.open) {
      if (!S.loaded) { S.loaded = true; loadHistory(); }
      startPoll();
      document.getElementById('sbIn').focus();
    } else {
      stopPoll();
    }
  }

  function status(t) { var s = document.getElementById('sbStatus'); if (s) s.textContent = t || ''; }
  function scroll() { var m = document.getElementById('sbMsgs'); if (m) m.scrollTop = m.scrollHeight; }
  function typingLabel() { return S.takeover ? 'Connected to the team…' : (esc(BIZ) + ' is typing…'); }

  // ── Rendering ───────────────────────────────────────────────────────────────
  function render(role, text) {
    var m = document.getElementById('sbMsgs'); if (!m) return;
    var row = document.createElement('div'); row.className = 'sbRow ' + (role === 'me' ? 'me' : 'bot');
    row.innerHTML = '<div class="sbBub">' + esc(text).replace(/\n/g, '<br>') + '</div>';
    m.appendChild(row); scroll();
  }

  function renderNotice(text) {
    var m = document.getElementById('sbMsgs'); if (!m) return;
    var el = document.createElement('div'); el.className = 'sbNotice'; el.textContent = text || '';
    m.appendChild(el); scroll();
  }

  // Instant (non-typewriter) incoming bubble — used for history replay.
  function renderIncoming(kind, name, text) {
    var m = document.getElementById('sbMsgs'); if (!m) return;
    var row = document.createElement('div'); row.className = 'sbRow ' + (kind === 'staff' ? 'staff' : 'bot');
    var inner = (kind === 'staff' && name) ? '<div class="sbName">' + esc(name) + '</div>' : '';
    inner += '<div class="sbBub">' + esc(text).replace(/\n/g, '<br>') + '</div>';
    row.innerHTML = inner; m.appendChild(row); scroll();
  }

  function removeError() { var e = document.getElementById('sbErrRow'); if (e) e.remove(); }
  function showError() {
    var m = document.getElementById('sbMsgs'); if (!m) return;
    removeError();
    var row = document.createElement('div'); row.className = 'sbRow bot'; row.id = 'sbErrRow';
    row.innerHTML = '<div class="sbBub sbErr"><span>Hmm, that didn’t go through.</span>' +
      '<button type="button" class="sbRetry">Retry</button></div>';
    m.appendChild(row); scroll();
    row.querySelector('.sbRetry').addEventListener('click', function () { removeError(); send(true); });
  }

  // Word-by-word reveal so a live reply reads like someone typing. name → staff
  // label above the bubble; kind styles it.
  function typeBot(text, name, kind, cb) {
    var m = document.getElementById('sbMsgs'); if (!m) { if (cb) cb(); return; }
    var row = document.createElement('div'); row.className = 'sbRow ' + (kind === 'staff' ? 'staff' : 'bot');
    if (kind === 'staff' && name) { var lbl = document.createElement('div'); lbl.className = 'sbName'; lbl.textContent = name; row.appendChild(lbl); }
    var bub = document.createElement('div'); bub.className = 'sbBub sbTyping';
    row.appendChild(bub); m.appendChild(row); scroll();
    var tokens = String(text).split(/(\s+)/); var i = 0, buf = '';
    function step() {
      if (i >= tokens.length) { bub.classList.remove('sbTyping'); if (cb) cb(); return; }
      buf += tokens[i]; bub.innerHTML = esc(buf).replace(/\n/g, '<br>');
      var tok = tokens[i]; i++; scroll();
      var delay = 26 + Math.random() * 46;
      if (/[.!?…]$/.test(tok.trim())) delay += 260; else if (/,$/.test(tok.trim())) delay += 120;
      S._typeTimer = setTimeout(step, delay);
    }
    step();
  }

  // Serialize live incoming so overlapping typewriters don't collide.
  function enqueue(msg) { S.q.push(msg); drain(); }
  function drain() {
    if (S.draining) return;
    var it = S.q.shift();
    if (!it) { status(''); return; }
    if (it.kind === 'notice') {
      if (it.event === 'admin-join') S.takeover = true;
      if (it.event === 'admin-leave') S.takeover = false;
      renderNotice(it.body); drain(); return;
    }
    S.draining = true;
    if (it.kind === 'ai') S.history.push({ role: 'assistant', content: it.body });
    status(it.kind === 'staff' ? ((it.name || 'The team') + ' is typing…') : (esc(BIZ) + ' is typing…'));
    typeBot(it.body, it.name, it.kind, function () { S.draining = false; status(''); drain(); });
  }

  // ── History replay + polling ────────────────────────────────────────────────
  function loadHistory() {
    fetch('/support-history?sid=' + encodeURIComponent(SID), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error('no-history');
        S.takeover = !!res.takeover;
        var msgs = res.messages || [];
        if (!msgs.length) { if (!S.greeted) { S.greeted = true; render('bot', 'Hi! 👋 How can I help you today?'); } return; }
        msgs.forEach(function (msg) {
          if (msg.id) S.seen[msg.id] = 1;
          if (msg.at) S.pollAfter = msg.at;
          if (msg.kind === 'me') { render('me', msg.body); S.history.push({ role: 'user', content: msg.body }); }
          else if (msg.kind === 'notice') { renderNotice(msg.body); }
          else { renderIncoming(msg.kind, msg.name, msg.body); if (msg.kind === 'ai') S.history.push({ role: 'assistant', content: msg.body }); }
        });
        S.greeted = true;
      })
      .catch(function () { if (!S.greeted) { S.greeted = true; render('bot', 'Hi! 👋 How can I help you today?'); } });
  }

  function startPoll() { if (S.pollTimer) return; S.pollTimer = setInterval(pollOnce, 3000); }
  function stopPoll() { if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; } }

  function pollOnce() {
    if (!S.open) return;
    fetch('/support-poll?sid=' + encodeURIComponent(SID) + '&after=' + encodeURIComponent(S.pollAfter || ''), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) return;
        S.takeover = !!res.takeover;
        (res.messages || []).forEach(function (msg) {
          if (!msg || !msg.id || S.seen[msg.id]) return;
          S.seen[msg.id] = 1;
          if (msg.at) S.pollAfter = msg.at;
          enqueue(msg);
        });
      })
      .catch(function () {});
  }

  // ── Sending ─────────────────────────────────────────────────────────────────
  function doneSend() {
    S.sending = false;
    var b = document.getElementById('sbSend'); if (b) b.disabled = false;
    var i = document.getElementById('sbIn'); if (i) i.focus();
  }

  // send(true) re-sends the last message (Retry) without re-echoing it.
  function send(retry) {
    var inp = document.getElementById('sbIn');
    var text = retry ? S.lastText : (inp.value || '').trim();
    if (!text || S.sending) return;
    if (!retry) {
      inp.value = ''; S.lastText = text;
      S.history.push({ role: 'user', content: text });
      render('me', text); scroll();
    }
    removeError();
    S.sending = true; status(typingLabel());
    document.getElementById('sbSend').disabled = true;
    fetch('/support-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: SID, messages: S.history.slice(-12) }),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }, function () { return { ok: r.ok, d: {} }; }); })
      .then(function (res) {
        if (!res.ok || !res.d || res.d.ok === false) throw new Error((res.d && res.d.error) || 'send-failed');
        S.takeover = !!res.d.takeover;
        doneSend();
        if (res.d.reply) {
          // No-thread fallback: the reply came inline, render it directly.
          S.history.push({ role: 'assistant', content: res.d.reply });
          var dwell = 420 + Math.min(950, res.d.reply.length * 7);
          S._typeTimer = setTimeout(function () { status(''); typeBot(res.d.reply, null, 'ai', function () { status(''); }); }, dwell);
        } else {
          // The reply (AI or human takeover) arrives via the poll — kick one now.
          status(typingLabel());
          pollOnce();
        }
      })
      .catch(function () { status(''); showError(); doneSend(); });
  }

  // ── Lead form (secondary path; in-chat harvest is primary) ──────────────────
  function showLeadForm() {
    var w = document.getElementById('sbWrap');
    if (w.querySelector('.sbForm')) return;
    document.getElementById('sbLead').style.display = 'none';
    var foot = w.querySelector('.sbFoot'); foot.style.display = 'none';
    var f = document.createElement('div'); f.className = 'sbForm';
    f.innerHTML =
      '<input data-k="name" type="text" placeholder="Your name" autocomplete="name">' +
      '<input data-k="email" type="email" placeholder="Email *" autocomplete="email" required>' +
      '<textarea data-k="message" placeholder="How can we help? (optional)"></textarea>' +
      '<button class="sbSend" type="button" id="sbLeadSend">Send →</button>' +
      '<button class="sbCancel" type="button" id="sbLeadCancel">Cancel</button>';
    w.appendChild(f);
    f.querySelector('#sbLeadCancel').addEventListener('click', function () {
      f.remove(); foot.style.display = ''; document.getElementById('sbLead').style.display = '';
    });
    f.querySelector('#sbLeadSend').addEventListener('click', function () { submitLead(f); });
  }

  function submitLead(f) {
    var vals = {};
    f.querySelectorAll('[data-k]').forEach(function (i) { vals[i.getAttribute('data-k')] = i.value.trim(); });
    if (!vals.email) { f.querySelector('[data-k="email"]').focus(); return; }
    vals.sid = SID;
    var btn = f.querySelector('#sbLeadSend'); btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/support-inquiry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vals),
    }).then(function (r) { return r.json(); }).then(function (d) {
      f.remove();
      document.querySelector('#sbWrap .sbFoot').style.display = '';
      document.getElementById('sbLead').style.display = 'none';
      render('bot', (d && d.ok) ? 'Thanks! We’ve got your details and will follow up soon. 🙌'
        : 'Hmm, that didn’t go through — please email us instead.');
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'Send →';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
