/**
 * Slab — Global Bug Button
 * Self-contained IIFE. Works on any page (public, admin, portal).
 * Creates a floating bug button → opens a ticket submission modal
 * with optional debug data capture (admin-only).
 */
(function () {
  'use strict';

  // ── Console error capture (starts immediately) ──────────────────────────────
  const capturedErrors = [];
  const MAX_ERRORS = 50;

  window.addEventListener('error', function (e) {
    if (capturedErrors.length < MAX_ERRORS) {
      capturedErrors.push(`[${new Date().toISOString()}] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
    }
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (capturedErrors.length < MAX_ERRORS) {
      capturedErrors.push(`[${new Date().toISOString()}] Unhandled rejection: ${e.reason}`);
    }
  });

  // ── Detect auth context ─────────────────────────────────────────────────────
  function hasCookie(name) {
    return document.cookie.split(';').some(function (c) {
      return c.trim().startsWith(name + '=');
    });
  }
  const isAdmin = hasCookie('slab_token');
  const isPortal = hasCookie('slab_portal');

  // ── Inject styles ───────────────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent = [
    '#slab-bug-btn{position:fixed;bottom:24px;right:24px;z-index:99999;width:48px;height:48px;border-radius:50%;',
    'background:#1C2B4A;color:#fff;border:2px solid #C9A848;cursor:pointer;display:flex;align-items:center;',
    'justify-content:center;font-size:22px;box-shadow:0 4px 16px rgba(0,0,0,0.2);transition:transform 0.15s,box-shadow 0.15s;}',
    '#slab-bug-btn:hover{transform:scale(1.1);box-shadow:0 6px 24px rgba(0,0,0,0.3);}',
    '#slab-bug-overlay{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.5);backdrop-filter:blur(2px);',
    'display:none;align-items:center;justify-content:center;padding:20px;}',
    '#slab-bug-overlay.open{display:flex;}',
    '#slab-bug-modal{background:#FDFCFA;border-radius:4px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;',
    'box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:28px;}',
    '#slab-bug-modal h2{font-size:1.2rem;font-weight:400;margin:0 0 20px;color:#0F1B30;}',
    '#slab-bug-modal .bb-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}',
    '#slab-bug-modal .bb-full{grid-column:span 2;}',
    '#slab-bug-modal label{display:block;font-size:0.65rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;',
    'color:#6B7380;margin-bottom:5px;}',
    '#slab-bug-modal input[type=text],#slab-bug-modal input[type=email],#slab-bug-modal textarea,#slab-bug-modal select{',
    'width:100%;padding:9px 12px;border:1px solid #E6E1D6;border-radius:2px;font-size:0.88rem;color:#0F1B30;',
    'background:#FDFCFA;outline:none;font-family:inherit;box-sizing:border-box;}',
    '#slab-bug-modal input:focus,#slab-bug-modal textarea:focus,#slab-bug-modal select:focus{border-color:#1C2B4A;}',
    '#slab-bug-modal textarea{resize:vertical;min-height:80px;}',
    '#slab-bug-modal .bb-actions{display:flex;gap:10px;margin-top:18px;}',
    '#slab-bug-modal .bb-btn{padding:10px 22px;border-radius:2px;font-size:0.75rem;font-weight:600;letter-spacing:0.1em;',
    'text-transform:uppercase;border:none;cursor:pointer;transition:all 0.15s;}',
    '#slab-bug-modal .bb-btn-primary{background:#1C2B4A;color:#FDFCFA;}',
    '#slab-bug-modal .bb-btn-primary:hover{background:#0F1B30;}',
    '#slab-bug-modal .bb-btn-ghost{background:transparent;color:#1C2B4A;border:1.5px solid #2E4270;}',
    '#slab-bug-modal .bb-btn-ghost:hover{border-color:#0F1B30;}',
    '#slab-bug-modal .bb-btn-debug{background:#C9A848;color:#0F1B30;width:100%;margin-bottom:14px;}',
    '#slab-bug-modal .bb-btn-debug:hover{background:#E8D08A;}',
    '#slab-bug-modal .bb-status{font-size:0.78rem;padding:8px 12px;border-radius:2px;margin-bottom:14px;display:none;}',
    '#slab-bug-modal .bb-status.ok{display:block;background:rgba(21,128,61,0.08);color:#15803D;border:1px solid rgba(21,128,61,0.2);}',
    '#slab-bug-modal .bb-status.err{display:block;background:rgba(185,28,28,0.07);color:#B91C1C;border:1px solid rgba(185,28,28,0.2);}',
    '#slab-bug-modal .bb-status.info{display:block;background:rgba(201,168,72,0.08);color:#92660F;border:1px solid rgba(201,168,72,0.2);}',
    '#slab-bug-modal .bb-debug-preview{background:#0F1B30;color:#a3e635;font-family:monospace;font-size:0.68rem;',
    'padding:10px;border-radius:2px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;',
    'margin-bottom:14px;display:none;}',
    '#slab-bug-modal .bb-close{position:absolute;top:12px;right:16px;background:none;border:none;font-size:1.4rem;',
    'color:#6B7380;cursor:pointer;padding:4px;}',
    '#slab-bug-modal .bb-close:hover{color:#0F1B30;}',
    '@media(max-width:600px){#slab-bug-modal .bb-row{grid-template-columns:1fr;}#slab-bug-modal .bb-full{grid-column:span 1;}}',
  ].join('\n');
  document.head.appendChild(css);

  // ── Create floating button ──────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.id = 'slab-bug-btn';
  btn.innerHTML = '&#128027;';
  btn.title = 'Report an Issue';
  document.body.appendChild(btn);

  // ── Create overlay + modal ──────────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.id = 'slab-bug-overlay';
  overlay.innerHTML = [
    '<div id="slab-bug-modal" style="position:relative;">',
    '  <button class="bb-close" id="bbClose">&times;</button>',
    '  <h2>&#128027; Report an Issue</h2>',
    '  <div id="bbStatus" class="bb-status"></div>',
    isAdmin ? '  <button class="bb-btn bb-btn-debug" id="bbCapture">&#9889; Capture Debug Data</button>' : '',
    isAdmin ? '  <div id="bbDebugPreview" class="bb-debug-preview"></div>' : '',
    '  <form id="bbForm">',
    '    <div class="bb-row">',
    '      <div class="bb-full">',
    '        <label>Subject *</label>',
    '        <input type="text" name="subject" required placeholder="Brief summary of the issue">',
    '      </div>',
    '    </div>',
    '    <div class="bb-row">',
    '      <div class="bb-full">',
    '        <label>Description</label>',
    '        <textarea name="description" rows="4" placeholder="Steps to reproduce, expected vs actual behavior..."></textarea>',
    '      </div>',
    '    </div>',
    '    <div class="bb-row">',
    '      <div>',
    '        <label>Category</label>',
    '        <select name="category">',
    '          <option value="bug" selected>Bug</option>',
    '          <option value="question">Question</option>',
    '          <option value="feature">Feature Request</option>',
    '          <option value="billing">Billing</option>',
    '          <option value="other">Other</option>',
    '        </select>',
    '      </div>',
    '      <div>',
    '        <label>Priority</label>',
    '        <select name="priority">',
    '          <option value="low">Low</option>',
    '          <option value="medium" selected>Medium</option>',
    '          <option value="high">High</option>',
    '          <option value="critical">Critical</option>',
    '        </select>',
    '      </div>',
    '    </div>',
    '    <div class="bb-row">',
    !isAdmin && !isPortal ? '      <div><label>Your Email *</label><input type="email" name="email" required placeholder="you@example.com"></div>' : '',
    '      <div>',
    '        <label>Screenshot</label>',
    '        <input type="file" name="screenshot" accept="image/*" style="font-size:0.82rem;">',
    '      </div>',
    '    </div>',
    '    <div class="bb-actions">',
    '      <button type="submit" class="bb-btn bb-btn-primary" id="bbSubmit">Submit Ticket</button>',
    '      <button type="button" class="bb-btn bb-btn-ghost" id="bbCancel">Cancel</button>',
    '    </div>',
    '  </form>',
    '</div>',
  ].join('\n');
  document.body.appendChild(overlay);

  // ── State ───────────────────────────────────────────────────────────────────
  var debugDataCaptured = null;

  function setStatus(msg, type) {
    var el = document.getElementById('bbStatus');
    el.textContent = msg;
    el.className = 'bb-status ' + (type || 'info');
  }

  function clearStatus() {
    var el = document.getElementById('bbStatus');
    el.className = 'bb-status';
    el.textContent = '';
  }

  function openModal() {
    overlay.classList.add('open');
    debugDataCaptured = null;
    clearStatus();
    var preview = document.getElementById('bbDebugPreview');
    if (preview) preview.style.display = 'none';
    document.getElementById('bbForm').reset();
  }

  function closeModal() {
    overlay.classList.remove('open');
    debugDataCaptured = null;
    clearStatus();
  }

  // ── Events ──────────────────────────────────────────────────────────────────
  btn.addEventListener('click', openModal);
  document.getElementById('bbClose').addEventListener('click', closeModal);
  document.getElementById('bbCancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  // ── Debug capture ───────────────────────────────────────────────────────────
  var captureBtn = document.getElementById('bbCapture');
  if (captureBtn) {
    captureBtn.addEventListener('click', async function () {
      captureBtn.disabled = true;
      captureBtn.textContent = 'Capturing...';
      setStatus('Capturing debug data from server...', 'info');

      // Client-side context (always available)
      var clientContext = {
        currentUrl: window.location.href,
        userAgent: navigator.userAgent,
        screenSize: screen.width + 'x' + screen.height,
        consoleErrors: capturedErrors.slice(),
      };

      try {
        var resp = await fetch('/api/tickets/debug-capture', { method: 'POST' });
        if (resp.ok) {
          var serverData = await resp.json();
          debugDataCaptured = Object.assign({}, serverData, clientContext);
          setStatus('Debug data captured successfully.', 'ok');
          var preview = document.getElementById('bbDebugPreview');
          if (preview) {
            preview.style.display = 'block';
            var lines = [];
            lines.push('=== Client Context ===');
            lines.push('URL: ' + clientContext.currentUrl);
            lines.push('UA: ' + clientContext.userAgent);
            lines.push('Screen: ' + clientContext.screenSize);
            if (clientContext.consoleErrors.length) {
              lines.push('Console Errors: ' + clientContext.consoleErrors.length);
            }
            lines.push('');
            lines.push('=== Server Logs ===');
            lines.push('Tmux: ' + (serverData.tmuxLog ? serverData.tmuxLog.split('\n').length + ' lines' : 'N/A'));
            lines.push('Apache Error: ' + (serverData.apacheErrorLog && serverData.apacheErrorLog !== '[not available]' ? serverData.apacheErrorLog.split('\n').length + ' lines' : 'N/A'));
            lines.push('Apache Access: ' + (serverData.apacheAccessLog && serverData.apacheAccessLog !== '[not available]' ? serverData.apacheAccessLog.split('\n').length + ' lines' : 'N/A'));
            preview.textContent = lines.join('\n');
          }
        } else {
          // Fallback to client-side only
          debugDataCaptured = clientContext;
          debugDataCaptured.capturedAt = new Date().toISOString();
          setStatus('Server capture unavailable — client context captured.', 'info');
        }
      } catch (err) {
        debugDataCaptured = clientContext;
        debugDataCaptured.capturedAt = new Date().toISOString();
        setStatus('Server unreachable — client context captured.', 'info');
      }

      captureBtn.disabled = false;
      captureBtn.textContent = '\u26A1 Capture Debug Data';
    });
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  document.getElementById('bbForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var form = e.target;
    var submitBtn = document.getElementById('bbSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    clearStatus();

    var fd = new FormData(form);

    // Attach debug data as JSON string
    if (debugDataCaptured) {
      fd.append('debugData', JSON.stringify(debugDataCaptured));
    } else {
      // Always include basic client context
      fd.append('debugData', JSON.stringify({
        capturedAt: new Date().toISOString(),
        currentUrl: window.location.href,
        userAgent: navigator.userAgent,
        screenSize: screen.width + 'x' + screen.height,
        consoleErrors: capturedErrors.slice(),
      }));
    }

    try {
      var resp = await fetch('/api/tickets', {
        method: 'POST',
        body: fd,
      });
      var data = await resp.json();
      if (data.ok) {
        setStatus('Ticket ' + data.ticketNumber + ' created successfully!', 'ok');
        form.reset();
        debugDataCaptured = null;
        var preview = document.getElementById('bbDebugPreview');
        if (preview) preview.style.display = 'none';
        setTimeout(closeModal, 2000);
      } else {
        setStatus(data.error || 'Failed to create ticket.', 'err');
      }
    } catch (err) {
      setStatus('Network error — please try again.', 'err');
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Ticket';
  });
})();
