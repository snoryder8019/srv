// camera.js — Host camera view controller
(function() {
  const app          = document.getElementById('cameraApp');
  const GAME_ID      = app.dataset.gameId;
  const MODE         = app.dataset.mode;
  const HAS_IP_CAM   = app.dataset.hasIpcam === '1';
  const PLAYER_COUNT = parseInt(app.dataset.playerCount) || 2;

  const socket = window._ttSocket || io();
  window._ttSocket = socket;
  socket.emit('join-game', { gameId: GAME_ID, role: 'host' });

  let autoInterval    = null;

  // ─────────────────────────────────────────
  // AI Trigger Log — shows what fired each analyze, when, and what came back.
  // Exposed as logAiEvent({source, t0, analysis?, error?}).
  // ─────────────────────────────────────────
  const AI_LOG_MAX = 25;
  const aiLog = [];
  function logAiEvent({ source, t0, analysis, error }) {
    const dt = t0 ? Math.round(performance.now() - t0) : null;
    const entry = {
      time: new Date(),
      source,
      ms: dt,
      error: error || null,
      available: analysis ? analysis.available !== false : false,
      confidence: analysis && analysis.confidence,
      note: analysis && analysis.note,
      dartCount: analysis && Array.isArray(analysis.darts) ? analysis.darts.length : 0,
      total: analysis && analysis.total
    };
    aiLog.unshift(entry);
    if (aiLog.length > AI_LOG_MAX) aiLog.length = AI_LOG_MAX;
    renderAiLog();
  }
  function renderAiLog() {
    const list = document.getElementById('aiLogList');
    if (!list) return;
    if (!aiLog.length) { list.innerHTML = '<div class="ai-log-empty">No AI calls yet.</div>'; return; }
    list.innerHTML = aiLog.map(e => {
      const hhmmss = e.time.toLocaleTimeString();
      const status = e.error ? 'error'
                   : (!e.available ? 'offline'
                   : (e.dartCount ? 'seen' : 'empty'));
      const badge = {
        error:   '<span class="ail-badge ail-err">ERR</span>',
        offline: '<span class="ail-badge ail-off">OFF</span>',
        seen:    '<span class="ail-badge ail-ok">SEEN</span>',
        empty:   '<span class="ail-badge ail-empty">EMPTY</span>'
      }[status];
      const detail = e.error
        ? e.error
        : (!e.available
            ? (e.note || 'tunnel/model unavailable')
            : (e.dartCount
                ? (e.dartCount + ' dart' + (e.dartCount===1?'':'s') + ' · total ' + (e.total ?? '?') + ' · conf ' + (e.confidence || '?'))
                : (e.note || 'model saw nothing')));
      return '<div class="ai-log-row">'
           + '<span class="ail-time">'+hhmmss+'</span>'
           + badge
           + '<span class="ail-src">'+e.source+'</span>'
           + '<span class="ail-detail">'+detail+'</span>'
           + (e.ms != null ? '<span class="ail-ms">'+e.ms+'ms</span>' : '')
           + '</div>';
    }).join('');
  }
  // Expose so other scripts/tests can push entries if needed
  window._aiLog = { entries: aiLog, push: logAiEvent, render: renderAiLog };

  let lastAnalysis    = null;   // last AI result (for correction saving)
  let lastAnalysisL   = null;
  let lastAnalysisR   = null;
  let phoneStream     = null;
  let imageCapture    = null;
  let camCapabilities = {};
  let gameState       = null;
  let splitMode       = false;
  let splitRafId      = null;
  let cameraActive    = false;
  let tuningOpen      = false;
  let entrySource     = 'manual';  // 'manual' | 'ai'

  // ─────────────────────────────────────────
  // Status
  // ─────────────────────────────────────────
  function setStatus(text, cls) {
    const txt = document.getElementById('statusText');
    const dot = document.getElementById('statusDot');
    if (txt) txt.textContent = text;
    if (dot) dot.className   = 'status-dot ' + (cls || 'dot-waiting');
  }

  // ─────────────────────────────────────────
  // Backend health
  // ─────────────────────────────────────────
  // Unified AI health: reads top-level `dartboard` status from /api/health.
  // Drives both the legacy `backendStatus` chip in the control bar AND the
  // new `aiStatusChip` (via the separate refreshAiChip() call set up later).
  function applyBackendChip(db) {
    const status = db && db.status;
    const el = document.getElementById('backendStatus');
    const ef = document.getElementById('backendStatusFull');
    let color = 'var(--red)', label = '⚠ Offline', title = 'AI Offline', statusLine = 'Backend offline', statusCls = 'dot-red';
    if (status === 'up') {
      color = 'var(--green)'; label = '✅ Online'; title = 'AI Online'; statusLine = 'Ready'; statusCls = 'dot-green';
    } else if (status === 'missing') {
      color = 'var(--yellow)'; label = '⚠ No dartboard model'; title = 'Tunnel up, but no dartboard model'; statusLine = 'No AI model'; statusCls = 'dot-yellow';
    } else if (status === 'unauthorized') {
      color = 'var(--red)'; label = '⚠ Unauthorized'; title = 'Tunnel rejected credentials'; statusLine = 'Tunnel auth'; statusCls = 'dot-red';
    } else if (status === 'unreachable') {
      color = 'var(--red)'; label = '⚠ Unreachable'; title = 'Tunnel offline'; statusLine = 'Tunnel offline'; statusCls = 'dot-red';
    }
    if (el) { el.textContent = '●'; el.style.color = color; el.title = title; }
    if (ef) ef.textContent = label;
    setStatus(statusLine, statusCls);
  }
  fetch('/api/health').then(r => r.json()).then(d => {
    applyBackendChip(d.dartboard || { status: 'unreachable' });
  }).catch(() => {
    applyBackendChip({ status: 'unreachable' });
  });

  fetch('/api/corrections').then(r => r.json()).catch(() => null);

  // ─────────────────────────────────────────
  // UNIFIED SCORE ENTRY FORM
  // Always visible. Seeded by AI when available; freely editable.
  // ─────────────────────────────────────────

  // Compute single-dart score from seg + ring
  function dartScore(seg, ring) {
    seg = parseInt(seg) || 0;
    if (ring === 'double')     return seg * 2;
    if (ring === 'triple')     return seg * 3;
    if (ring === 'inner_bull') return 50;
    if (ring === 'outer_bull') return 25;
    if (ring === 'miss')       return 0;
    return seg;
  }

  // Refresh running total + per-dart scores on every input change
  function recalcEntry() {
    let total = 0;
    for (let i = 0; i < 3; i++) {
      const seg  = document.getElementById('dartSeg_'  + i)?.value;
      const ring = document.getElementById('dartRing_' + i)?.value || 'single';
      const sc   = document.getElementById('dartScore_' + i);
      if (!seg && seg !== '0') { if (sc) sc.textContent = '–'; continue; }
      const s = dartScore(seg, ring);
      if (sc) sc.textContent = s;
      total += s;
    }
    const totalEl = document.getElementById('entryTotal');
    if (totalEl) totalEl.textContent = total;

    // Show projected remaining for 501
    const remEl = document.getElementById('entryRemaining');
    if (remEl && gameState && MODE === '501') {
      const cur = gameState.players[gameState.currentPlayerIndex]?.remaining;
      if (cur !== undefined) {
        const after = cur - total;
        if (after < 0)      remEl.textContent = '— BUST';
        else if (after === 0) remEl.textContent = '— CHECKOUT!';
        else                remEl.textContent = `→ ${after} left`;
      }
    } else if (remEl) {
      remEl.textContent = '';
    }
  }

  // Wire up all dart input fields
  for (let i = 0; i < 3; i++) {
    document.getElementById('dartSeg_'  + i)?.addEventListener('input',  recalcEntry);
    document.getElementById('dartRing_' + i)?.addEventListener('change', recalcEntry);
  }

  // Fill the entry form from an AI analysis result
  function fillEntryFromAI(analysis) {
    entrySource = 'ai';
    lastAnalysis = analysis;
    const darts = analysis.darts || [];
    for (let i = 0; i < 3; i++) {
      const segEl  = document.getElementById('dartSeg_'  + i);
      const ringEl = document.getElementById('dartRing_' + i);
      if (!segEl || !ringEl) continue;
      if (darts[i]) {
        segEl.value  = darts[i].segment;
        ringEl.value = darts[i].ring;
        // Highlight AI-filled rows
        document.getElementById('dartRow_' + i)?.classList.add('dart-row-ai');
      } else {
        segEl.value  = '';
        ringEl.value = 'single';
        document.getElementById('dartRow_' + i)?.classList.remove('dart-row-ai');
      }
    }
    recalcEntry();

    // Source badge
    const conf   = analysis.confidence || 'low';
    const srcEl  = document.getElementById('scoreEntrySource');
    if (srcEl) {
      srcEl.innerHTML = `<span class="entry-source-badge entry-source-ai conf-${conf}">AI · ${conf}</span>`;
    }
    // AI note bar
    const noteRow = document.getElementById('aiNote');
    const noteText = document.getElementById('aiNoteText');
    if (noteRow) noteRow.style.display = 'flex';
    if (noteText) noteText.textContent = analysis.note || '';

    // Show correction note field (hidden by default, visible when user edits)
    // Editing any field marks the round as user-corrected
    for (let i = 0; i < 3; i++) {
      const segEl  = document.getElementById('dartSeg_'  + i);
      const ringEl = document.getElementById('dartRing_' + i);
      const onEdit = () => {
        entrySource = 'corrected';
        document.getElementById('dartRow_' + i)?.classList.remove('dart-row-ai');
        document.getElementById('dartRow_' + i)?.classList.add('dart-row-edited');
        document.getElementById('correctionNoteRow').style.display = 'block';
        const srcEl2 = document.getElementById('scoreEntrySource');
        if (srcEl2) srcEl2.innerHTML = '<span class="entry-source-badge entry-source-edited">Edited</span>';
      };
      segEl?.addEventListener('input',  onEdit, { once: true });
      ringEl?.addEventListener('change', onEdit, { once: true });
    }
  }

  // Clear the form back to blank manual state
  function clearEntry() {
    entrySource  = 'manual';
    lastAnalysis = null;
    for (let i = 0; i < 3; i++) {
      const segEl  = document.getElementById('dartSeg_'  + i);
      const ringEl = document.getElementById('dartRing_' + i);
      if (segEl)  segEl.value  = '';
      if (ringEl) ringEl.value = 'single';
      const scoreEl = document.getElementById('dartScore_' + i);
      if (scoreEl) scoreEl.textContent = '–';
      const row = document.getElementById('dartRow_' + i);
      row?.classList.remove('dart-row-ai', 'dart-row-edited');
    }
    const totalEl = document.getElementById('entryTotal');
    if (totalEl) totalEl.textContent = '0';
    const remEl = document.getElementById('entryRemaining');
    if (remEl) remEl.textContent = '';
    const srcEl = document.getElementById('scoreEntrySource');
    if (srcEl) srcEl.innerHTML = '<span class="entry-source-badge entry-source-manual">Manual</span>';
    const noteRow = document.getElementById('aiNote');
    if (noteRow) noteRow.style.display = 'none';
    const corrNoteRow = document.getElementById('correctionNoteRow');
    if (corrNoteRow) corrNoteRow.style.display = 'none';
    const corrNote = document.getElementById('correctionNote');
    if (corrNote) corrNote.value = '';
    updateScoreEntryPlayer();
  }

  // Update "SCORING: Player Name" header
  function updateScoreEntryPlayer() {
    const el = document.getElementById('scoreEntryPlayer');
    if (el && gameState) {
      el.textContent = gameState.players[gameState.currentPlayerIndex]?.name || '?';
    }
  }

  document.getElementById('clearEntryBtn')?.addEventListener('click', clearEntry);

  // Confirm round from the unified entry form
  document.getElementById('confirmEntryBtn')?.addEventListener('click', async () => {
    const darts = [];
    let hasAny  = false;
    for (let i = 0; i < 3; i++) {
      const segRaw = document.getElementById('dartSeg_'  + i)?.value.trim();
      const ring   = document.getElementById('dartRing_' + i)?.value || 'single';
      if (!segRaw && segRaw !== '0') continue;
      const seg   = parseInt(segRaw) || 0;
      const score = dartScore(seg, ring);
      darts.push({ segment: seg, ring, score });
      hasAny = true;
    }
    if (!hasAny) { window.showMiniToast && window.showMiniToast('Enter at least one dart'); return; }

    const btn = document.getElementById('confirmEntryBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      // If we edited an AI result, save a correction for ML training
      if (entrySource === 'corrected' && lastAnalysis) {
        const corrNote = document.getElementById('correctionNote')?.value.trim() || '';
        const correctedTotal = darts.reduce((s, d) => s + d.score, 0);
        await fetch('/api/correct', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameId: GAME_ID, frameId: new Date().toISOString(),
            ai:        { darts: lastAnalysis.darts, total: lastAnalysis.total },
            corrected: { darts, total: correctedTotal },
            note: corrNote
          })
        });
      }
      await submitRound(darts, entrySource);
    } finally {
      btn.textContent = '✓ Confirm Round'; btn.disabled = false;
    }
  });

  // ─────────────────────────────────────────
  // Activate camera
  // ─────────────────────────────────────────
  function activateCamera() {
    cameraActive = true;
    const overlay = document.getElementById('camStartOverlay');
    const hud     = document.getElementById('camHud');
    if (overlay) overlay.style.display = 'none';
    if (hud)     hud.style.display     = 'flex';
    updateHudScores(gameState);
    startLivePreviewPump();
  }

  // ─────────────────────────────────────────
  // Live preview pump — grabs a small frame on an interval and
  // broadcasts it so the scoreboard + lobby show a live feed
  // (independent of the full-resolution analyze path).
  // ─────────────────────────────────────────
  let livePumpInterval = null;
  function startLivePreviewPump() {
    if (livePumpInterval) return;
    const pump = async () => {
      try {
        let base64 = null;
        if (phoneStream) {
          const video = document.getElementById('phoneVideo');
          if (!video || !video.videoWidth) return;
          const c = document.createElement('canvas');
          // Downscale for bandwidth — long edge ~480px
          const longEdge = 480;
          const scale = longEdge / Math.max(video.videoWidth, video.videoHeight);
          c.width  = Math.round(video.videoWidth  * scale);
          c.height = Math.round(video.videoHeight * scale);
          c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
          base64 = c.toDataURL('image/jpeg', 0.55).split(',')[1];
        } else if (HAS_IP_CAM) {
          const img = document.getElementById('ipCamImg');
          if (!img || !img.src || !img.src.startsWith('data:image')) return;
          base64 = img.src.split(',')[1];
        } else {
          return;
        }
        if (!base64) return;
        const pi = gameState ? gameState.currentPlayerIndex : 0;
        const pName = gameState ? (gameState.players[pi]?.name || 'Host') : 'Host';
        socket.emit('player-analysis', {
          gameId: GAME_ID,
          playerIndex: pi,
          playerName: pName,
          analysis: null,
          frame: base64
        });
      } catch (_) { /* ignore transient errors */ }
    };
    pump();
    livePumpInterval = setInterval(pump, 1500);
  }

  function stopLivePreviewPump() {
    if (livePumpInterval) { clearInterval(livePumpInterval); livePumpInterval = null; }
  }

  // ─────────────────────────────────────────
  // Phone camera start
  // ─────────────────────────────────────────
  const startPhoneBtn = document.getElementById('startPhoneCamBtn');
  if (startPhoneBtn) {
    startPhoneBtn.addEventListener('click', async () => {
      startPhoneBtn.disabled    = true;
      startPhoneBtn.textContent = 'Starting…';
      try {
        phoneStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
        const video = document.getElementById('phoneVideo');
        video.srcObject = phoneStream;
        await video.play().catch(() => {});
        const track = phoneStream.getVideoTracks()[0];
        if (window.ImageCapture) {
          imageCapture    = new ImageCapture(track);
          camCapabilities = track.getCapabilities ? track.getCapabilities() : {};
        }
        activateCamera();
        setStatus('Camera active', 'dot-green');
        initTuningPanel();
        if (splitMode) startSplitRender();
      } catch (err) {
        console.error('[camera] getUserMedia failed:', err);
        startPhoneBtn.disabled    = false;
        startPhoneBtn.textContent = 'Start Camera';
        const reason = err && err.name ? (err.name + ': ' + (err.message || '')) : String(err);
        setStatus('Camera error — ' + reason, 'dot-red');
        alert('Could not access camera.\n\n' + reason +
              '\n\nChecks: HTTPS required, camera permission must be allowed in the browser, and no other app/tab can be using the camera.');
      }
    });
  }

  // ─────────────────────────────────────────
  // IP cam
  // ─────────────────────────────────────────
  const startIpBtn = document.getElementById('startIpCamBtn');
  if (startIpBtn) {
    startIpBtn.addEventListener('click', async () => {
      startIpBtn.disabled    = true;
      startIpBtn.textContent = 'Connecting…';
      try {
        const resp = await fetch(`/api/game/${GAME_ID}/snapshot`);
        const data = await resp.json();
        if (data.image) {
          const img = document.getElementById('ipCamImg');
          img.src = 'data:image/jpeg;base64,' + data.image;
          img.style.display = 'block';
          activateCamera();
          setStatus('IP cam active', 'dot-green');
        } else throw new Error('No image from camera');
      } catch (err) {
        startIpBtn.disabled    = false;
        startIpBtn.textContent = 'Connect Camera';
        setStatus('Camera error', 'dot-red');
        alert('Camera error: ' + err.message);
      }
    });
  }

  // ─────────────────────────────────────────
  // Skip / manual only
  // ─────────────────────────────────────────
  document.getElementById('skipCamBtn')?.addEventListener('click', () => {
    activateCamera();
    setStatus('Manual mode', 'dot-waiting');
  });

  // ─────────────────────────────────────────
  // Start Game
  // ─────────────────────────────────────────
  document.getElementById('startGameBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('startGameBtn');
    btn.disabled = true; btn.textContent = 'Starting…';
    try {
      await fetch(`/api/game/${GAME_ID}/start`, { method: 'POST' });
      btn.style.display = 'none';
      setStatus('Game started!', 'dot-green');
    } catch (err) {
      btn.disabled = false; btn.textContent = '▶ Start Game';
    }
  });

  // ─────────────────────────────────────────
  // Camera tuning panel
  // ─────────────────────────────────────────
  function initTuningPanel() {
    const track = phoneStream?.getVideoTracks()[0];
    if (!track) return;
    const caps    = camCapabilities;
    const rows    = document.getElementById('tuningRows');
    const tuneBtn = document.getElementById('tuneBtn');
    if (!rows || !tuneBtn) return;
    tuneBtn.style.display = 'flex';
    rows.innerHTML = '';

    function addSlider(id, label, cap, getCurrentFn, applyFn) {
      if (!cap || cap.min === undefined) return false;
      const current = getCurrentFn();
      const row = document.createElement('div');
      row.className = 'tune-row';
      row.innerHTML = `
        <div class="tune-row-header">
          <span class="tune-label">${label}</span>
          <span class="tune-value" id="${id}Val">${typeof current === 'number' ? current.toFixed(cap.step < 1 ? 1 : 0) : current}</span>
        </div>
        <input type="range" class="tune-slider" id="${id}Slider"
          min="${cap.min}" max="${cap.max}" step="${cap.step || 1}" value="${current}">`;
      rows.appendChild(row);
      row.querySelector(`#${id}Slider`).addEventListener('input', async function() {
        const v = parseFloat(this.value);
        row.querySelector(`#${id}Val`).textContent = v.toFixed(cap.step < 1 ? 1 : 0);
        try { await applyFn(v); } catch(e) { console.warn(id, e.message); }
      });
      return true;
    }

    function addToggle(id, label, options, getCurrentFn, applyFn) {
      if (!options?.length) return false;
      const current = getCurrentFn() || options[0];
      const row = document.createElement('div');
      row.className = 'tune-row';
      row.innerHTML = `
        <div class="tune-row-header"><span class="tune-label">${label}</span></div>
        <div class="tune-options" id="${id}Opts">
          ${options.map(o => `<button class="tune-opt ${o===current?'active':''}" data-val="${o}">${o}</button>`).join('')}
        </div>`;
      rows.appendChild(row);
      row.querySelectorAll('.tune-opt').forEach(btn => {
        btn.addEventListener('click', async () => {
          row.querySelectorAll('.tune-opt').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          try { await applyFn(btn.dataset.val); } catch(e) { console.warn(id, e.message); }
        });
      });
      return true;
    }

    const settings = track.getSettings ? track.getSettings() : {};
    let hasAny = false;

    hasAny |= addSlider('zoom', '🔍 Zoom', caps.zoom, () => settings.zoom || 1,
      v => track.applyConstraints({ advanced: [{ zoom: v }] }));

    if (caps.focusMode?.includes('manual')) {
      hasAny |= addSlider('focus', '🎯 Focus', caps.focusDistance,
        () => settings.focusDistance || caps.focusDistance?.min || 0,
        v => track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: v }] }));
    }
    if (caps.focusMode?.length > 1) {
      hasAny |= addToggle('focusMode', 'Focus Mode', caps.focusMode,
        () => settings.focusMode || caps.focusMode[0],
        v => track.applyConstraints({ advanced: [{ focusMode: v }] }));
    }

    if (caps.exposureMode?.includes('manual')) {
      hasAny |= addSlider('exposure', '☀️ Exposure', caps.exposureCompensation,
        () => settings.exposureCompensation || 0,
        v => track.applyConstraints({ advanced: [{ exposureCompensation: v }] }));
    }
    if (caps.exposureMode?.length > 1) {
      hasAny |= addToggle('exposureMode', 'Exposure Mode', caps.exposureMode,
        () => settings.exposureMode || caps.exposureMode[0],
        v => track.applyConstraints({ advanced: [{ exposureMode: v }] }));
    }

    hasAny |= addSlider('iso', '📷 ISO', caps.iso,
      () => settings.iso || caps.iso?.min || 0,
      v => track.applyConstraints({ advanced: [{ iso: v }] }));

    if (caps.whiteBalanceMode?.length > 1) {
      hasAny |= addToggle('wb', 'White Balance', caps.whiteBalanceMode,
        () => settings.whiteBalanceMode || caps.whiteBalanceMode[0],
        v => track.applyConstraints({ advanced: [{ whiteBalanceMode: v }] }));
    }
    hasAny |= addSlider('colorTemp', '🌡 Color Temp', caps.colorTemperature,
      () => settings.colorTemperature || caps.colorTemperature?.min || 2000,
      v => track.applyConstraints({ advanced: [{ whiteBalanceMode: 'manual', colorTemperature: v }] }));

    hasAny |= addSlider('brightness', '💡 Brightness', caps.brightness,
      () => settings.brightness || caps.brightness?.min || 0,
      v => track.applyConstraints({ advanced: [{ brightness: v }] }));
    hasAny |= addSlider('contrast',   '◑ Contrast',   caps.contrast,
      () => settings.contrast   || caps.contrast?.min   || 0,
      v => track.applyConstraints({ advanced: [{ contrast: v }] }));
    hasAny |= addSlider('sharpness',  '🔪 Sharpness',  caps.sharpness,
      () => settings.sharpness  || caps.sharpness?.min  || 0,
      v => track.applyConstraints({ advanced: [{ sharpness: v }] }));

    if (caps.torch) {
      const row = document.createElement('div');
      row.className = 'tune-row';
      row.innerHTML = `
        <div class="tune-row-header" style="justify-content:space-between;">
          <span class="tune-label">🔦 Torch</span>
          <label class="cam-ctrl-toggle"><input type="checkbox" id="torchToggle"><span class="cam-ctrl-toggle-label">On</span></label>
        </div>`;
      rows.appendChild(row);
      row.querySelector('#torchToggle').addEventListener('change', async function() {
        try { await track.applyConstraints({ advanced: [{ torch: this.checked }] }); } catch(e) {}
      });
      hasAny = true;
    }

    // Resolution presets
    if (caps.width) {
      const presets = [{ l:'4K',w:3840,h:2160},{ l:'1080p',w:1920,h:1080},{ l:'720p',w:1280,h:720},{ l:'480p',w:854,h:480}]
        .filter(p => p.w <= (caps.width.max || 1920));
      if (presets.length > 1) {
        const cur = settings.width >= 1920 ? '1080p' : settings.width >= 1280 ? '720p' : '480p';
        hasAny |= addToggle('res', '📐 Resolution', presets.map(p=>p.l), () => cur, async v => {
          const p = presets.find(p => p.l === v);
          if (!p) return;
          await phoneStream.getVideoTracks()[0].applyConstraints({ width:{ideal:p.w}, height:{ideal:p.h} });
        });
      }
    }

    if (!hasAny) {
      rows.innerHTML = '<div class="tune-empty">This device doesn\'t expose manual camera controls. Use the phone\'s native camera app to set zoom/focus before opening this view.</div>';
    }

    const resetRow = document.createElement('div');
    resetRow.className = 'tune-row';
    resetRow.innerHTML = '<button class="btn btn-sm" id="tuneResetBtn" style="width:100%;">↺ Reset to defaults</button>';
    rows.appendChild(resetRow);
    resetRow.querySelector('#tuneResetBtn').addEventListener('click', async () => {
      try { await phoneStream?.getVideoTracks()[0]?.applyConstraints({}); initTuningPanel(); } catch(e) {}
    });
  }

  document.getElementById('tuneBtn')?.addEventListener('click', () => {
    tuningOpen = !tuningOpen;
    const panel = document.getElementById('tuningPanel');
    if (panel) panel.style.display = tuningOpen ? 'flex' : 'none';
    document.getElementById('tuneBtn')?.classList.toggle('cam-icon-btn-active', tuningOpen);
  });

  document.getElementById('guideBtn')?.addEventListener('click', () => {
    const guide = document.getElementById('boardGuide');
    if (!guide) return;
    const on = guide.style.display !== 'none';
    guide.style.display = on ? 'none' : 'block';
    document.getElementById('guideBtn')?.classList.toggle('cam-icon-btn-active', !on);
  });

  // ─────────────────────────────────────────
  // Split mode
  // ─────────────────────────────────────────
  document.getElementById('sameLocToggle')?.addEventListener('change', function() {
    splitMode = this.checked;
    toggleSplitMode(splitMode);
  });

  function toggleSplitMode(on) {
    document.getElementById('feedSingle').style.display     = on ? 'none' : 'flex';
    document.getElementById('feedSplit').style.display      = on ? 'flex' : 'none';
    document.getElementById('singleControls').style.display = on ? 'none' : 'flex';
    document.getElementById('splitControls').style.display  = on ? 'flex' : 'none';
    document.getElementById('analysisCardLeft').style.display  = 'none';
    document.getElementById('analysisCardRight').style.display = 'none';
    if (on) { updateSplitLabels(); if (phoneStream) startSplitRender(); }
    else    { stopSplitRender(); }
  }

  function updateSplitLabels() {
    const p0 = gameState?.players?.[0]?.name || 'Player 1';
    const p1 = gameState?.players?.[1]?.name || 'Player 2';
    document.getElementById('splitLabelLeft').textContent    = '◀ ' + p0;
    document.getElementById('splitLabelRight').textContent   = p1 + ' ▶';
    document.getElementById('analysisLabelLeft').textContent  = 'Left — ' + p0;
    document.getElementById('analysisLabelRight').textContent = 'Right — ' + p1;
  }

  function startSplitRender() {
    const video = document.getElementById('phoneVideo');
    const overlay = document.getElementById('splitCanvas');
    const ctx = overlay.getContext('2d');
    function draw() {
      if (!splitMode || !phoneStream) return;
      const wrap = document.getElementById('feedSplit');
      overlay.width  = wrap.offsetWidth;
      overlay.height = wrap.offsetHeight;
      const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
      const scale = Math.min(overlay.width / vw, overlay.height / vh);
      const dx = (overlay.width  - vw * scale) / 2;
      const dy = (overlay.height - vh * scale) / 2;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.drawImage(video, dx, dy, vw * scale, vh * scale);
      splitRafId = requestAnimationFrame(draw);
    }
    if (splitRafId) cancelAnimationFrame(splitRafId);
    splitRafId = requestAnimationFrame(draw);
  }

  function stopSplitRender() {
    if (splitRafId) { cancelAnimationFrame(splitRafId); splitRafId = null; }
    const overlay = document.getElementById('splitCanvas');
    if (overlay) overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
  }

  // ─────────────────────────────────────────
  // Capture helpers
  // ─────────────────────────────────────────
  async function captureFullFrame() {
    if (phoneStream) {
      const video  = document.getElementById('phoneVideo');
      const canvas = document.getElementById('phoneCanvas');
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    }
    if (HAS_IP_CAM) {
      const resp = await fetch(`/api/game/${GAME_ID}/snapshot`);
      const data = await resp.json();
      if (data.image) {
        const img = document.getElementById('ipCamImg');
        img.src = 'data:image/jpeg;base64,' + data.image;
        img.style.display = 'block';
      }
      return data.image;
    }
    return null;
  }

  async function captureHalf(side) {
    if (!phoneStream) return null;
    const video  = document.getElementById('phoneVideo');
    const canvas = document.getElementById(side === 'left' ? 'canvasLeft' : 'canvasRight');
    const vw = video.videoWidth, vh = video.videoHeight, hw = Math.floor(vw / 2);
    canvas.width = hw; canvas.height = vh;
    canvas.getContext('2d').drawImage(video, side === 'left' ? 0 : hw, 0, hw, vh, 0, 0, hw, vh);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  }

  // ─────────────────────────────────────────
  // Analyze — fires AI, pre-fills entry form
  // ─────────────────────────────────────────
  async function analyze(source) {
    source = source || 'manual';
    const t0 = performance.now();
    setStatus('Analyzing…', 'dot-yellow');
    const btn = document.getElementById('captureBtn');
    if (btn) btn.disabled = true;
    try {
      const base64 = await captureFullFrame();
      const resp = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, gameId: GAME_ID, playerIndex: gameState ? gameState.currentPlayerIndex : 0 })
      });
      const analysis = await resp.json();

      // Log to AI trigger panel
      logAiEvent({ source, t0, analysis });

      // Pre-fill the score entry form with AI result
      fillEntryFromAI(analysis);

      const el = document.getElementById('lastAnalyzed');
      if (el) el.textContent = new Date().toLocaleTimeString();
      setStatus(`AI: ${analysis.total} (${analysis.confidence || '?'})`, 'dot-green');

      // Broadcast to scoreboard/remote views
      socket.emit('player-analysis', {
        gameId: GAME_ID,
        playerIndex: gameState ? gameState.currentPlayerIndex : 0,
        playerName:  gameState ? (gameState.players[gameState.currentPlayerIndex]?.name || 'Host') : 'Host',
        analysis, frame: base64
      });

      // Show confidence HUD indicator on feed
      const hudConf = document.getElementById('hudConf');
      if (hudConf) {
        hudConf.textContent  = (analysis.confidence || '').toUpperCase();
        hudConf.className    = 'hud-conf conf-' + (analysis.confidence || 'low');
        hudConf.style.display = 'block';
        setTimeout(() => { hudConf.style.display = 'none'; }, 8000);
      }
    } catch (err) {
      setStatus('Error: ' + err.message, 'dot-red');
      logAiEvent({ source, t0, error: err.message });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Re-analyze button (in the AI note bar)
  document.getElementById('reanalyzeBtn')?.addEventListener('click', () => { clearEntry(); analyze('reanalyze'); });

  // ─────────────────────────────────────────
  // Split analyze
  // ─────────────────────────────────────────
  async function analyzeSplit(side) {
    const btn = document.getElementById(side === 'left' ? 'captureSplitLeftBtn' : 'captureSplitRightBtn');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    setStatus(`Analyzing ${side}…`, 'dot-yellow');
    try {
      const base64 = await captureHalf(side);
      if (!base64) { setStatus('No camera active', 'dot-red'); return; }
      document.getElementById(side === 'left' ? 'splitLeft' : 'splitRight')?.classList.add('split-analyzing');
      setTimeout(() => document.getElementById(side === 'left' ? 'splitLeft' : 'splitRight')?.classList.remove('split-analyzing'), 600);
      const playerIndex = side === 'left' ? 0 : 1;
      const resp = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, gameId: GAME_ID, playerIndex })
      });
      const analysis = await resp.json();
      if (side === 'left') lastAnalysisL = { ...analysis, frameBase64: base64, playerIndex: 0 };
      else                 lastAnalysisR = { ...analysis, frameBase64: base64, playerIndex: 1 };
      showSplitResult(side, analysis);
      setStatus(`${side === 'left' ? 'Left' : 'Right'} — ${analysis.total}`, 'dot-green');
      const el = document.getElementById('lastAnalyzed');
      if (el) el.textContent = new Date().toLocaleTimeString();
      const confEl = document.getElementById(side === 'left' ? 'splitConfLeft' : 'splitConfRight');
      if (confEl) { confEl.textContent = (analysis.confidence || '').toUpperCase(); confEl.className = 'split-conf conf-' + (analysis.confidence || 'low'); confEl.style.display = 'block'; }
    } catch (err) {
      setStatus('Error: ' + err.message, 'dot-red');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = side === 'left' ? '📸 L' : '📸 R'; }
    }
  }

  async function analyzeBoth() { await analyzeSplit('left'); await analyzeSplit('right'); }

  document.getElementById('captureSplitLeftBtn')?.addEventListener('click',  () => analyzeSplit('left'));
  document.getElementById('captureSplitRightBtn')?.addEventListener('click', () => analyzeSplit('right'));
  document.getElementById('captureSplitBothBtn')?.addEventListener('click',  analyzeBoth);

  function showSplitResult(side, analysis) {
    const idMap = {
      left:  { card: 'analysisCardLeft',  darts: 'analysisDartsLeft',  total: 'analysisTotalLeft',  note: 'analysisNoteLeft',  badge: 'confBadgeLeft'  },
      right: { card: 'analysisCardRight', darts: 'analysisDartsRight', total: 'analysisTotalRight', note: 'analysisNoteRight', badge: 'confBadgeRight' },
    };
    const ids  = idMap[side];
    const card = document.getElementById(ids.card);
    if (!card) return;
    card.style.display = 'block';
    const conf  = analysis.confidence || 'low';
    const badge = document.getElementById(ids.badge);
    if (badge) { badge.textContent = conf.toUpperCase(); badge.className = 'confidence-badge conf-' + conf; }
    const dartsEl = document.getElementById(ids.darts);
    if (dartsEl) {
      dartsEl.innerHTML = (analysis.darts || []).map(d => {
        const prefix = d.ring === 'double' ? 'D' : d.ring === 'triple' ? 'T' : '';
        return `<span class="dart-result-badge">${prefix}${d.segment} = <strong>${d.score}</strong></span>`;
      }).join('');
    }
    const totEl  = document.getElementById(ids.total);
    const noteEl = document.getElementById(ids.note);
    if (totEl)  totEl.textContent  = analysis.total || 0;
    if (noteEl) noteEl.textContent = analysis.note  || '';
  }

  // Split confirm / edit (edit loads the AI result into the main entry form for that player)
  document.getElementById('confirmLeftBtn')?.addEventListener('click', async () => {
    if (!lastAnalysisL) return;
    const btn = document.getElementById('confirmLeftBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try { await submitRound(lastAnalysisL.darts, lastAnalysisL.confidence, 0); }
    finally { btn.textContent = '✓ Confirm'; btn.disabled = false; }
  });
  document.getElementById('confirmRightBtn')?.addEventListener('click', async () => {
    if (!lastAnalysisR) return;
    const btn = document.getElementById('confirmRightBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try { await submitRound(lastAnalysisR.darts, lastAnalysisR.confidence, 1); }
    finally { btn.textContent = '✓ Confirm'; btn.disabled = false; }
  });
  document.getElementById('correctLeftBtn')?.addEventListener('click', () => {
    if (!lastAnalysisL) return;
    fillEntryFromAI(lastAnalysisL);
    document.getElementById('analysisCardLeft').style.display = 'none';
    document.getElementById('scoreEntryCard')?.scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('correctRightBtn')?.addEventListener('click', () => {
    if (!lastAnalysisR) return;
    fillEntryFromAI(lastAnalysisR);
    document.getElementById('analysisCardRight').style.display = 'none';
    document.getElementById('scoreEntryCard')?.scrollIntoView({ behavior: 'smooth' });
  });

  // ─────────────────────────────────────────
  // Capture + auto
  // ─────────────────────────────────────────
  document.getElementById('captureBtn')?.addEventListener('click', () => analyze('capture-button'));
  document.getElementById('autoCapture')?.addEventListener('change', function() {
    if (this.checked) { autoInterval = setInterval(() => analyze('auto-timer'), 4000); setStatus('Auto…', 'dot-green'); }
    else { clearInterval(autoInterval); autoInterval = null; setStatus(cameraActive ? 'Camera active' : 'Ready', cameraActive ? 'dot-green' : 'dot-waiting'); }
  });

  // ─────────────────────────────────────────
  // Submit round
  // ─────────────────────────────────────────
  async function submitRound(darts, confidence, forPlayerIndex) {
    if (forPlayerIndex !== undefined && gameState && forPlayerIndex !== gameState.currentPlayerIndex) {
      window.showMiniToast && window.showMiniToast(`It's ${gameState.players[gameState.currentPlayerIndex]?.name}'s turn first`);
      return;
    }
    const resp = await fetch(`/api/game/${GAME_ID}/round`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ darts, confidence, frameId: new Date().toISOString() })
    });
    const game = await resp.json();
    if (game.error) { alert(game.error); return; }

    const wasBust = game.mode === '501' && game.rounds?.length > 0 && game.rounds[game.rounds.length-1].total === 0;
    gameState = game;
    updateGameUI(game);
    socket.emit('game-update', { gameId: GAME_ID, game });

    // Clear entry for next turn
    clearEntry();
    document.getElementById('analysisCardLeft').style.display  = 'none';
    document.getElementById('analysisCardRight').style.display = 'none';
    lastAnalysis = lastAnalysisL = lastAnalysisR = null;

    if (splitMode) updateSplitLabels();
    if (wasBust) { setStatus('💥 BUST', 'dot-red'); showBustBanner(); }
    if (autoInterval) {
      clearInterval(autoInterval); autoInterval = null;
      const cb = document.getElementById('autoCapture');
      if (cb) cb.checked = false;
    }
  }

  function showBustBanner() {
    const b = document.getElementById('bustBanner');
    if (!b) return;
    b.style.display = 'block';
    setTimeout(() => { b.style.display = 'none'; }, 2500);
  }

  // ─────────────────────────────────────────
  // HUD score update
  // ─────────────────────────────────────────
  function updateHudScores(game) {
    if (!game) return;
    const isActive = game.status === 'active';
    game.players.forEach((p, i) => {
      const hudPlayer = document.getElementById('hudPlayer_' + i);
      const hudScore  = document.getElementById('hudScore_'  + i);
      if (!hudPlayer || !hudScore) return;
      hudPlayer.classList.toggle('hud-active', i === game.currentPlayerIndex && isActive);
      hudScore.innerHTML = game.mode === '501'
        ? p.remaining
        : (p.cricketPoints || 0) + '<span class="hud-score-unit">pts</span>';
    });
    const turnBanner = document.getElementById('hudTurnBanner');
    const turnName   = document.getElementById('hudTurnName');
    if (turnBanner && turnName) {
      turnBanner.style.display = isActive ? 'block' : 'none';
      if (game.players[game.currentPlayerIndex]) turnName.textContent = game.players[game.currentPlayerIndex].name;
    }
  }

  // ─────────────────────────────────────────
  // Full game UI update
  // ─────────────────────────────────────────
  function updateGameUI(game) {
    updateHudScores(game);
    updateScoreEntryPlayer();

    game.players.forEach((p, i) => {
      const card = document.getElementById('camPlayer_' + i);
      if (!card) return;
      card.classList.toggle('active-player', i === game.currentPlayerIndex);
      if (MODE === '501') {
        const sc = document.getElementById('camScore_' + i);
        if (sc) sc.textContent = p.remaining;
      } else {
        const pts = document.getElementById('camPts_' + i);
        if (pts) pts.textContent = p.cricketPoints || 0;
      }
    });

    const body = document.getElementById('historyBody');
    if (body && game.rounds) {
      const countEl = document.getElementById('historyCount');
      if (countEl) countEl.textContent = `(${game.rounds.length})`;
      body.innerHTML = game.rounds.slice(-20).reverse().map(r => {
        const name  = game.players[r.playerIndex]?.name || '?';
        const darts = (r.darts || []).map(d => (d.ring==='double'?'D':d.ring==='triple'?'T':'') + d.segment).join(', ');
        const conf  = r.confidence ? `<span class="conf-xs conf-${r.confidence}">${r.confidence[0].toUpperCase()}</span>` : '';
        return `<tr><td>${name}</td><td class="dart-list">${darts}</td><td>${r.total}</td><td>${conf}</td></tr>`;
      }).join('');
    }

    if (game.status === 'finished' && game.winner != null) {
      setStatus(`🏆 ${game.players[game.winner]?.name} wins!`, 'dot-green');
    }
  }

  // ─────────────────────────────────────────
  // Socket events
  // ─────────────────────────────────────────
  socket.on('game-update', ({ game }) => {
    if (game._id === GAME_ID || game._id?.toString() === GAME_ID) {
      gameState = game; updateGameUI(game); if (splitMode) updateSplitLabels();
    }
  });
  socket.on('game-started', ({ game }) => {
    gameState = game; updateGameUI(game); setStatus('Game started!', 'dot-green');
    if (window.ttAudio) window.ttAudio.play('gameStart');
    document.getElementById('startGameBtn') && (document.getElementById('startGameBtn').style.display = 'none');
    if (splitMode) updateSplitLabels();
  });
  socket.on('game-resumed', ({ game }) => {
    gameState = game; updateGameUI(game); setStatus('Resumed', 'dot-green');
    if (window.ttAudio) window.ttAudio.play('gameStart');
    if (splitMode) updateSplitLabels();
  });
  socket.on('game-idle', () => {
    setStatus('Paused (idle)', 'dot-waiting');
    if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
    const cb = document.getElementById('autoCapture'); if (cb) cb.checked = false;
  });
  socket.on('game-finished', ({ winner }) => {
    setStatus(`🏆 ${winner} wins!`, 'dot-green');
    if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
  });
  socket.on('game-archived', ({ gameId }) => {
    if (gameId === GAME_ID) { setStatus('Archived', 'dot-waiting'); if (autoInterval) { clearInterval(autoInterval); autoInterval = null; } }
  });
  socket.on('player-connected', ({ playerName, role }) => {
    if (role !== 'remote' || !gameState) return;
    const idx = gameState.players.findIndex(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (idx >= 0) {
      const dot    = document.getElementById('camConn_'  + idx);
      const hudDot = document.getElementById('hudConn_'  + idx);
      if (dot)    { dot.textContent = '●'; dot.style.color = 'var(--green)'; }
      if (hudDot) { hudDot.style.background = 'var(--green)'; hudDot.title = playerName + ' connected'; }
    }
    setStatus(`${playerName} connected`, 'dot-green');
  });
  socket.on('player-disconnected', ({ playerName, role }) => {
    if (role !== 'remote' || !gameState) return;
    const idx = gameState.players.findIndex(p => p.name.toLowerCase() === (playerName||'').toLowerCase());
    if (idx >= 0) {
      const dot    = document.getElementById('camConn_' + idx);
      const hudDot = document.getElementById('hudConn_' + idx);
      if (dot)    { dot.textContent = '○'; dot.style.color = ''; }
      if (hudDot) { hudDot.style.background = ''; }
    }
  });
  // AI analysis from a remote player — pre-fill entry form if it's for current player
  socket.on('player-analysis', ({ playerIndex, playerName, analysis }) => {
    if (!gameState || playerIndex !== gameState.currentPlayerIndex) return;
    fillEntryFromAI(analysis);
    setStatus(`AI from ${playerName}: ${analysis.total}`, 'dot-green');
  });

  // ─────────────────────────────────────────
  // QUICK-TAP SCORING PAD + LEARNING MODE + AUDIO
  // Replaces the number/select dart rows. Syncs into the hidden legacy
  // inputs so the existing recalc / confirm / AI-fill code keeps working.
  // ─────────────────────────────────────────

  // --- Audio: piano-ish tick via WebAudio ---
  let _audioCtx = null;
  function ensureAudio() {
    if (_audioCtx) return _audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try { _audioCtx = new Ctx(); } catch (_) { _audioCtx = null; }
    return _audioCtx;
  }
  // Play a short piano-like tone. freq in Hz.
  function playTone(freq, durMs = 180, gainPeak = 0.18) {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch(_){} }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type  = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    // Simple ADSR — piano-ish quick decay
    g.gain.setValueAtTime(0, now);
    g.gain.linearTopRampToValueAtTime ?
      g.gain.linearRampToValueAtTime(gainPeak, now + 0.008) :
      g.gain.linearRampToValueAtTime(gainPeak, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);
    // Very light second harmonic for warmth
    const osc2 = ctx.createOscillator();
    const g2   = ctx.createGain();
    osc2.type  = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, now);
    g2.gain.setValueAtTime(0, now);
    g2.gain.linearRampToValueAtTime(gainPeak * 0.35, now + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);

    osc.connect(g).connect(ctx.destination);
    osc2.connect(g2).connect(ctx.destination);
    osc.start(now);  osc.stop(now + durMs / 1000 + 0.02);
    osc2.start(now); osc2.stop(now + durMs / 1000 + 0.02);
  }
  // Piano notes (approx equal-temperament, A4 = 440)
  const NOTE = {
    C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.00,
    A4: 440.00, C5: 523.25, E5: 659.25, G5: 783.99
  };
  function playTick()       { playTone(NOTE.E5, 140, 0.16); }            // dart committed
  function playRoundDone()  { playTone(NOTE.C5, 90, 0.15);
                              setTimeout(() => playTone(NOTE.G5, 200, 0.17), 90); }
  function playAiMatch()    { playTone(NOTE.A4, 110, 0.12);
                              setTimeout(() => playTone(NOTE.E5, 200, 0.16), 95); }
  function playAiMismatch() { playTone(NOTE.C4, 260, 0.18); }

  // --- State ---
  let activeSlot   = 0;                                // which dart slot is being edited
  let currentMult  = 'single';                         // 'single' | 'double' | 'triple' | 'miss'
  let learnMode    = false;
  let aiAvailable  = false;
  const committedDarts = [null, null, null];           // [{segment, ring, score} | null]
  const learningSamples = [];                          // AI comparisons accumulated this round

  // --- Hidden-input bridge: write committed dart into the legacy inputs so
  // the existing recalcEntry/confirmEntry code path keeps working untouched.
  function syncDartToHidden(slot, dart) {
    const segEl  = document.getElementById('dartSeg_'  + slot);
    const ringEl = document.getElementById('dartRing_' + slot);
    if (!segEl || !ringEl) return;
    if (!dart) { segEl.value = ''; ringEl.value = 'single'; return; }
    segEl.value  = dart.segment;
    ringEl.value = dart.ring;
  }

  // --- UI helpers ---
  function formatDartLabel(d) {
    if (!d) return '–';
    if (d.ring === 'miss') return 'X';
    if (d.ring === 'inner_bull') return '50';
    if (d.ring === 'outer_bull') return '25';
    const pfx = d.ring === 'double' ? 'D' : d.ring === 'triple' ? 'T' : '';
    return pfx + d.segment;
  }
  function refreshSlots() {
    for (let i = 0; i < 3; i++) {
      const slot = document.getElementById('dartSlot_' + i);
      const val  = document.getElementById('dartSlotValue_' + i);
      if (!slot || !val) continue;
      const d = committedDarts[i];
      val.textContent = formatDartLabel(d);
      slot.classList.toggle('slot-filled', !!d);
      slot.classList.toggle('slot-active', i === activeSlot);
    }
    // Trigger the legacy recalc so total + 501 remaining update
    if (typeof recalcEntry === 'function') recalcEntry();
  }
  function setActiveSlot(i) {
    activeSlot = Math.max(0, Math.min(2, i|0));
    refreshSlots();
    _updateRoundLockHint();
  }
  // Flag set when user explicitly clicked a slot to edit. Suppresses the
  // auto-advance-after-commit so a single tap goes where the user pointed
  // and doesn't also bump the cursor forward into the next slot.
  let _slotEditMode = false;

  function _isRoundFull() {
    return !!(committedDarts[0] && committedDarts[1] && committedDarts[2]);
  }

  function _updateRoundLockHint() {
    const hint = document.getElementById('roundLockHint');
    const full = _isRoundFull();
    if (hint) hint.style.display = full ? 'block' : 'none';
    // Also mark the slot tray visually so users see it's locked
    document.querySelectorAll('.dart-slot').forEach(el => {
      el.classList.toggle('slot-tray-locked', full);
    });
  }

  function advanceSlot() {
    // If the round is full, DO NOT advance. Cursor stays put; the next tap
    // will still overwrite the active slot (by explicit user intent, since the
    // hint tells them to pick a slot or submit), but we won't silently move it.
    if (_isRoundFull()) {
      _updateRoundLockHint();
      return false;
    }
    // Prefer the next empty slot; else find the first empty slot (wraps back).
    for (let i = activeSlot + 1; i < 3; i++) {
      if (!committedDarts[i]) { setActiveSlot(i); return true; }
    }
    for (let i = 0; i < 3; i++) {
      if (!committedDarts[i]) { setActiveSlot(i); return true; }
    }
    return false;
  }

  function setMultiplier(m) {
    currentMult = m;
    document.querySelectorAll('.tap-mult').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.mult === m ? 'true' : 'false');
    });
  }
  setMultiplier('single');

  // Commit a dart into the active slot. Auto-advances unless the user
  // explicitly clicked this slot to edit it (one-shot, consumed here).
  function commitDart(dart, tapBtnEl) {
    // Mark source as corrected if it used to be AI
    if (entrySource === 'ai') {
      entrySource = 'corrected';
      document.getElementById('correctionNoteRow').style.display = 'block';
      const srcEl2 = document.getElementById('scoreEntrySource');
      if (srcEl2) srcEl2.innerHTML = '<span class="entry-source-badge entry-source-edited">Edited</span>';
    }

    committedDarts[activeSlot] = dart;
    syncDartToHidden(activeSlot, dart);
    if (tapBtnEl) {
      tapBtnEl.classList.remove('tap-flash');
      // force reflow to restart animation
      void tapBtnEl.offsetWidth;
      tapBtnEl.classList.add('tap-flash');
    }
    playTick();

    // Miss always resets to Single — nothing else makes sense after a miss.
    if (dart.ring === 'miss') setMultiplier('single');
    // Triple/double reset to Single only when APPENDING sequentially; when the
    // user is editing a specific slot, keep the multiplier so they can retry
    // the same tap without re-pressing the multiplier button.
    else if (!_slotEditMode && (dart.ring === 'double' || dart.ring === 'triple')) {
      setMultiplier('single');
    }

    // Learning Mode: fire a background analyze + compare
    if (learnMode) runLearningCompare(activeSlot, dart);

    if (_slotEditMode) {
      // One-shot: after this edit, future taps auto-advance again.
      _slotEditMode = false;
      refreshSlots();
      _updateRoundLockHint();
    } else {
      advanceSlot();
    }
  }

  // Multiplier buttons
  document.querySelectorAll('.tap-mult').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      setMultiplier(b.dataset.mult);
    });
  });

  // Segment buttons
  document.querySelectorAll('.tap-seg').forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const forcedRing = b.dataset.ring; // bull buttons carry a ring override
      const seg = parseInt(b.dataset.seg, 10);
      let ring = forcedRing || currentMult;
      // If the user picked "miss" as current mult, respect that regardless of seg
      if (currentMult === 'miss' && !forcedRing) {
        commitDart({ segment: 0, ring: 'miss', score: 0 }, b);
        return;
      }
      // Outer/inner bull can't take single/double/triple from segment pad
      if (forcedRing) {
        const score = forcedRing === 'inner_bull' ? 50 : 25;
        commitDart({ segment: 25, ring: forcedRing, score }, b);
        return;
      }
      const mult = ring === 'double' ? 2 : ring === 'triple' ? 3 : 1;
      commitDart({ segment: seg, ring, score: seg * mult }, b);
    });
  });

  // Direct-tap slot selection. Marks the click as explicit edit so the next
  // number tap writes into THIS slot and does not auto-advance past it.
  document.querySelectorAll('.dart-slot').forEach(b => {
    b.addEventListener('click', () => {
      _slotEditMode = true;
      setActiveSlot(parseInt(b.dataset.slot, 10));
    });
  });

  // Undo last-filled dart (or currently-active slot if empty)
  document.getElementById('tapUndoBtn')?.addEventListener('click', () => {
    let target = -1;
    for (let i = 2; i >= 0; i--) { if (committedDarts[i]) { target = i; break; } }
    if (target === -1) return;
    committedDarts[target] = null;
    syncDartToHidden(target, null);
    setActiveSlot(target);
  });

  // Reset tap state whenever the legacy clearEntry runs
  const _origClearEntry = clearEntry;
  clearEntry = function() {
    committedDarts[0] = committedDarts[1] = committedDarts[2] = null;
    learningSamples.length = 0;
    _slotEditMode = false;
    setActiveSlot(0);
    setMultiplier('single');
    _origClearEntry();
    refreshSlots();
    _updateRoundLockHint();
  };
  // Re-bind clear button since we shadowed the function
  const _clearBtn = document.getElementById('clearEntryBtn');
  if (_clearBtn) {
    const clone = _clearBtn.cloneNode(true);
    _clearBtn.parentNode.replaceChild(clone, _clearBtn);
    clone.addEventListener('click', () => clearEntry());
  }

  // When AI fills the entry, mirror those darts back into the tap state
  const _origFillEntryFromAI = fillEntryFromAI;
  fillEntryFromAI = function(analysis) {
    _origFillEntryFromAI(analysis);
    const darts = (analysis && analysis.darts) || [];
    for (let i = 0; i < 3; i++) {
      committedDarts[i] = darts[i] ? {
        segment: darts[i].segment, ring: darts[i].ring,
        score: darts[i].score != null ? darts[i].score : 0
      } : null;
    }
    // Active slot = first empty, else last
    let first = committedDarts.findIndex(d => !d);
    if (first === -1) first = 2;
    setActiveSlot(first);
    refreshSlots();
  };

  // ─────────────────────────────────────────
  // Learning Mode
  // ─────────────────────────────────────────
  const learnToggle = document.getElementById('learnModeToggle');
  if (learnToggle) {
    learnToggle.addEventListener('change', () => {
      learnMode = learnToggle.checked;
      setStatus(learnMode ? '🎓 Learning Mode ON' : 'Ready', learnMode ? 'dot-green' : 'dot-waiting');
      // Prime the audio context on a user gesture
      ensureAudio();
    });
  }

  async function runLearningCompare(slotIdx, truthDart) {
    if (!aiAvailable) return;                // no model loaded — still save at round-end
    const t0 = performance.now();
    try {
      const frame = await captureFullFrame();
      if (!frame) return;
      const resp = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: frame, gameId: GAME_ID })
      });
      const ai = await resp.json();
      logAiEvent({ source: 'learning-tap (slot '+(slotIdx+1)+')', t0, analysis: ai });
      const aiDart = ai && ai.darts && ai.darts[slotIdx];
      const matched = !!aiDart &&
        aiDart.ring === truthDart.ring &&
        aiDart.segment === truthDart.segment;
      learningSamples.push({
        slotIdx, frame, truth: truthDart, ai: aiDart || null, matched
      });
      if (matched) playAiMatch(); else playAiMismatch();
      // Subtle status feedback
      setStatus(matched ? '🎓 AI matched' : '🎓 AI differed — logged', matched ? 'dot-green' : 'dot-yellow');
    } catch (err) {
      // Silent — learning should never break normal scoring
      console.warn('[learning] analyze failed:', err.message);
    }
  }

  // On round confirm: if any samples collected, POST each to training store.
  // Hook into the existing confirmEntryBtn flow by listening AFTER its handler
  // by intercepting submitRound (if needed). Simpler: post training samples
  // from a 'round-confirmed' pseudo-event we fire inside the existing code path.
  const _confirmBtn = document.getElementById('confirmEntryBtn');
  if (_confirmBtn) {
    _confirmBtn.addEventListener('click', async () => {
      // Defer until the existing handler has done its work
      setTimeout(async () => {
        if (!learnMode) { playRoundDone(); return; }
        try {
          // Snapshot a frame for any slots that didn't get one (e.g. learn mode toggled
          // mid-round)
          const bulkFrame = await captureFullFrame();
          for (let i = 0; i < 3; i++) {
            const truth = committedDarts[i];
            if (!truth) continue;
            const s = learningSamples.find(x => x.slotIdx === i);
            await fetch('/api/training-sample', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                gameId: GAME_ID,
                frame: s ? s.frame : bulkFrame,
                truth: { darts: [truth], total: truth.score || 0 },
                aiResult: s && s.ai ? { darts: [s.ai], total: s.ai.score || 0 } : null,
                learningMode: true,
                note: s ? (s.matched ? 'learning:match' : 'learning:mismatch') : 'learning:no-ai'
              })
            }).catch(() => {});
          }
        } finally {
          learningSamples.length = 0;
          playRoundDone();
        }
      }, 20);
    }, true);   // capture-phase so we run before the existing handler's awaits
  }

  // ─────────────────────────────────────────
  // AI status chip (dartboard model availability)
  // ─────────────────────────────────────────
  function updateAiChip(status, label) {
    const dot = document.getElementById('aiStatusDot');
    const txt = document.getElementById('aiStatusText');
    if (!dot || !txt) return;
    dot.className = 'ai-status-dot';
    if      (status === 'up')        { dot.classList.add('dot-green');  txt.textContent = 'AI online'; }
    else if (status === 'missing')   { dot.classList.add('dot-yellow'); txt.textContent = 'No dartboard model'; }
    else if (status === 'unreachable'){ dot.classList.add('dot-red');   txt.textContent = 'Tunnel offline'; }
    else                              { dot.classList.add('dot-red');   txt.textContent = label || status || '?'; }
  }
  // Adaptive poll: 30s when healthy, exponential backoff on failure (max 5min).
  // Also auto-stops auto-capture when AI is unreachable so we don't hammer a dead tunnel.
  let _aiPollTimer = null;
  let _aiPollDelay = 30000;
  const _AI_POLL_MIN = 30000;
  const _AI_POLL_MAX = 300000;
  function _scheduleAiPoll() {
    clearTimeout(_aiPollTimer);
    _aiPollTimer = setTimeout(refreshAiChip, _aiPollDelay);
  }
  function refreshAiChip() {
    fetch('/api/health').then(r => r.json()).then(d => {
      const db = d.dartboard || {};
      const healthy = db.status === 'up';
      aiAvailable = healthy;
      updateAiChip(db.status, db.note);
      if (healthy || db.status === 'missing' || db.status === 'unauthorized') {
        _aiPollDelay = _AI_POLL_MIN;
      } else {
        // unreachable / error — back off and pause auto-capture if running
        _aiPollDelay = Math.min(_aiPollDelay * 2, _AI_POLL_MAX);
        const autoEl = document.getElementById('autoCapture') || document.getElementById('rcamAutoCapture');
        if (autoEl && autoEl.checked) {
          autoEl.checked = false;
          autoEl.dispatchEvent(new Event('change'));
        }
      }
      _scheduleAiPoll();
    }).catch(() => {
      updateAiChip('unreachable');
      _aiPollDelay = Math.min(_aiPollDelay * 2, _AI_POLL_MAX);
      _scheduleAiPoll();
    });
  }
  refreshAiChip();

  // Initial UI state
  refreshSlots();

  // ─────────────────────────────────────────
  // Init: seed entry source badge
  // ─────────────────────────────────────────
  const srcEl = document.getElementById('scoreEntrySource');
  if (srcEl) srcEl.innerHTML = '<span class="entry-source-badge entry-source-manual">Manual</span>';

})();
