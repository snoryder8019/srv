/**
 * Agent Health Badge — tier-aware status indicator for admin AI panels.
 *
 * Implements the cluster Tier Protocol:
 *   - Fires POST /admin/ai-wake on load to pre-warm the cluster.
 *   - Polls /admin/ai-health (2s while waking, 30s once HOT).
 *   - Renders a banner reflecting tier + transition + schedule window.
 *
 * Elements detected automatically:
 *   Input:  #agentInput | #ap-input | #apInput | #ma-input
 *   Button: #agentSend  | #ap-send  | #apSendBtn | #ma-send | #runAgentBtn
 *   Status: #ai-status  (required — add this element)
 */
(function () {
  'use strict';

  const FAST_POLL = 2000;
  const SLOW_POLL = 30000;
  const MAX_FAILS = 3;

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

  if (input) input.disabled = true;
  if (btn) btn.disabled = true;

  let failCount = 0;
  let pollTimer = null;
  let csrfToken = null;

  // ── CSRF: read from a meta tag or cookie if present ─────────────────
  function getCsrf() {
    if (csrfToken !== null) return csrfToken;
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) { csrfToken = meta.getAttribute('content') || ''; return csrfToken; }
    const m = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/);
    csrfToken = m ? decodeURIComponent(m[1]) : '';
    return csrfToken;
  }

  // ── Badge renderer ──────────────────────────────────────────────────
  function setStatus(state, msg, detail) {
    // state: 'checking' | 'online' | 'idle' | 'cold' | 'dark' | 'scheduled' | 'waking' | 'offline'
    const colors = {
      checking:  'color:#92400e;background:#fef3c7;',
      online:    'color:#14532d;background:#dcfce7;',
      idle:      'color:#78350f;background:#fef3c7;',
      cold:      'color:#7c2d12;background:#fed7aa;',
      dark:      'color:#581c87;background:#e9d5ff;',
      scheduled: 'color:#1e293b;background:#e2e8f0;',
      waking:    'color:#78350f;background:#fef3c7;',
      offline:   'color:#7f1d1d;background:#fecaca;',
    };
    status.innerHTML = '';

    const badge = document.createElement('span');
    badge.textContent = msg;
    badge.style.cssText = 'font-size:0.72rem;font-weight:600;letter-spacing:.03em;padding:3px 10px;border-radius:3px;white-space:nowrap;' + (colors[state] || colors.offline);
    status.appendChild(badge);

    if (detail) {
      const sub = document.createElement('span');
      sub.textContent = detail;
      sub.style.cssText = 'font-size:0.65rem;color:#64748b;margin-left:6px;white-space:nowrap;';
      status.appendChild(sub);
    }
    status.style.cssText = 'display:inline-flex;align-items:center;gap:0;margin-top:6px;flex-wrap:wrap;';
  }

  function buildDetail(d) {
    const parts = [];
    const gpus = d.gpus || [];
    const up = gpus.filter(g => g.status === 'up');
    if (gpus.length) parts.push('GPU ' + up.length + '/' + gpus.length);
    if (d.sd === 'up') parts.push('SD up');
    else if (d.sd === 'down') parts.push('SD down');
    return parts.join(' · ');
  }

  // ── Pre-wake on load (fire-and-forget) ──────────────────────────────
  function preWake() {
    fetch('/admin/ai-wake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() },
      body: JSON.stringify({ target: 'HOT' }),
      keepalive: true,
    }).catch(() => { /* fire-and-forget */ });
  }

  async function check() {
    try {
      const r = await fetch('/admin/ai-health', { signal: AbortSignal.timeout(8000) });
      return await r.json();
    } catch {
      return { ok: false, gpus: [], sd: 'down' };
    }
  }

  // ── Apply tier-driven badge state ───────────────────────────────────
  function applyState(d) {
    const tier = d.tier || null;
    const detail = buildDetail(d);
    const enableInput = () => {
      if (input) input.disabled = false;
      if (btn) btn.disabled = false;
    };

    if (!d.ok && !tier) {
      failCount++;
      if (failCount >= MAX_FAILS) {
        if (input) input.disabled = true;
        if (btn) btn.disabled = true;
        setStatus('offline', 'AI Offline', detail || 'try again later');
      } else {
        setStatus('checking', 'Retrying (' + failCount + '/' + MAX_FAILS + ')');
      }
      return FAST_POLL;
    }
    failCount = 0;

    // Active transition takes precedence over tier label
    if (tier && tier.waking) {
      const eta = tier.wakeEtaSec ? '~' + tier.wakeEtaSec + 's' : '';
      setStatus('waking', 'Warming up…', eta || detail);
      enableInput();
      return FAST_POLL;
    }
    if (tier && tier.sleeping) {
      setStatus('idle', 'Powering down…', detail);
      enableInput();
      return FAST_POLL;
    }

    // Steady-state by tier
    switch (tier && tier.tier) {
      case 'HOT':
        setStatus('online', 'AI Online', detail);
        enableInput();
        return SLOW_POLL;

      case 'WARM':
        setStatus('idle', 'AI Idle', detail || 'first prompt ~10s');
        enableInput();
        return SLOW_POLL;

      case 'COLD':
        setStatus('cold', 'AI Cold', 'type to wake · ~30s');
        enableInput();
        return SLOW_POLL;

      case 'DARK':
        if (tier.schedule && tier.schedule.currentlyInDarkWindow) {
          const end = tier.schedule.darkEndHour;
          const endLabel = (end != null) ? (String(end).padStart(2, '0') + ':00') : '07:00';
          setStatus('scheduled', 'Scheduled Off', 'back at ' + endLabel);
        } else {
          setStatus('dark', 'AI Sleeping', 'type to wake · ~60s');
        }
        enableInput();
        return SLOW_POLL;

      default:
        // Fallback to legacy ok/cold flags when tier is missing
        if (d.ok && d.cold) {
          setStatus('cold', 'Cold Start', detail);
          enableInput();
          return FAST_POLL;
        }
        if (d.ok) {
          setStatus('online', 'AI Online', detail);
          enableInput();
          return SLOW_POLL;
        }
        if (input) input.disabled = true;
        if (btn) btn.disabled = true;
        setStatus('offline', 'AI Offline', detail || 'try again later');
        return SLOW_POLL;
    }
  }

  // ── Poll loop ───────────────────────────────────────────────────────
  async function tick() {
    const d = await check();
    const nextDelay = applyState(d);
    pollTimer = setTimeout(tick, nextDelay);
  }

  function start() {
    setStatus('checking', 'Checking AI…');
    preWake();
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.addEventListener('beforeunload', () => {
    if (pollTimer) clearTimeout(pollTimer);
  });
})();
