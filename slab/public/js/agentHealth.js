/**
 * Agent Health Check — shared pre-flight for all agent chat panels.
 *
 * Pings /admin/ai-health up to 3 times. The endpoint returns per-GPU
 * status, cold-start flags, and SD availability so the user knows
 * exactly what to expect before interacting.
 *
 * Elements detected automatically:
 *   Input:  #agentInput | #ap-input | #apInput | #ma-input
 *   Button: #agentSend  | #ap-send  | #apSendBtn | #ma-send | #runAgentBtn
 *   Status: #ai-status  (required — add this element)
 */
(function () {
  'use strict';

  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;

  // Auto-detect input + button
  const input = document.getElementById('agentInput')
    || document.getElementById('ap-input')
    || document.getElementById('apInput')
    || document.getElementById('ma-input');

  const btn = document.getElementById('agentSend')
    || document.getElementById('ap-send')
    || document.getElementById('apSendBtn')
    || document.getElementById('ma-send')
    || document.getElementById('runAgentBtn');

  const status = document.getElementById('ai-status');

  if (!status) return;

  // Lock controls while checking
  if (input) input.disabled = true;
  if (btn) btn.disabled = true;

  // ── Render helpers ──────────────────────────────────────────────────
  function setStatus(state, msg, detail) {
    // state: 'checking' | 'online' | 'cold' | 'offline'
    var colors = {
      checking: 'color:#92400e;background:#fef3c7;',
      online:   'color:#14532d;background:#dcfce7;',
      cold:     'color:#78350f;background:#fef3c7;',
      offline:  'color:#7f1d1d;background:#fecaca;',
    };
    status.innerHTML = '';

    var badge = document.createElement('span');
    badge.textContent = msg;
    badge.style.cssText = 'font-size:0.72rem;font-weight:600;letter-spacing:.03em;padding:3px 10px;border-radius:3px;white-space:nowrap;' + (colors[state] || colors.offline);
    status.appendChild(badge);

    if (detail) {
      var sub = document.createElement('span');
      sub.textContent = detail;
      sub.style.cssText = 'font-size:0.65rem;color:#64748b;margin-left:6px;white-space:nowrap;';
      status.appendChild(sub);
    }

    status.style.cssText = 'display:inline-flex;align-items:center;gap:0;margin-top:6px;flex-wrap:wrap;';
  }

  // ── Build detail string from health data ────────────────────────────
  function buildDetail(d) {
    var parts = [];

    // GPU summary
    var gpus = d.gpus || [];
    var up = gpus.filter(function (g) { return g.status === 'up'; });
    var cold = gpus.filter(function (g) { return g.status === 'up' && g.cold; });
    if (gpus.length) {
      parts.push('GPU ' + up.length + '/' + gpus.length + ' up');
      if (cold.length) parts.push(cold.length + ' cold');
    }

    // SD
    if (d.sd === 'up') parts.push('SD up');
    else parts.push('SD down');

    return parts.join(' · ');
  }

  // ── Health check ────────────────────────────────────────────────────
  async function check() {
    try {
      var r = await fetch('/admin/ai-health', { signal: AbortSignal.timeout(8000) });
      var d = await r.json();
      return d;
    } catch {
      return { ok: false, cold: false, gpus: [], sd: 'down' };
    }
  }

  async function run() {
    setStatus('checking', 'Checking AI...');

    for (var i = 0; i < MAX_RETRIES; i++) {
      var d = await check();

      if (d.ok) {
        var detail = buildDetail(d);

        if (d.cold) {
          setStatus('cold', 'Cold Start', detail);
        } else {
          setStatus('online', 'AI Online', detail);
        }

        if (input) input.disabled = false;
        if (btn) btn.disabled = false;
        if (input) input.focus();
        return;
      }

      if (i < MAX_RETRIES - 1) {
        setStatus('checking', 'Retrying (' + (i + 2) + '/' + MAX_RETRIES + ')');
        await new Promise(function (resolve) { setTimeout(resolve, RETRY_DELAY); });
      }
    }

    // All retries failed
    var detail = buildDetail(d || {});
    setStatus('offline', 'AI Offline', detail || 'try again later');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
