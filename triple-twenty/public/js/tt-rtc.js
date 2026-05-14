/**
 * Triple-Twenty PvP Video — peer-to-peer mic + camera between players in
 * the same game room. Mesh model (every peer pairs with every peer).
 *
 * Why mesh: platform caps games at 4 players, so worst case is 4×3 / 2 = 6
 * connections. Cheaper than running an SFU and works behind STUN.
 *
 * Public API:
 *   window._ttRtc.mount(containerId, { gameId, displayName }) — render UI
 *   window._ttRtc.join() — request mic+cam and connect to peers
 *   window._ttRtc.leave() — drop all peers and stop local tracks
 *   window._ttRtc.toggleMic() / .toggleCam() / .isJoined()
 */
(function () {
  // STUN-only — works for most home networks. If users behind symmetric NAT
  // can't connect, set window.TT_TURN_URL/USER/PASS before loading and we'll
  // append a TURN relay. The slab "zoom clone" uses the same shape.
  function buildIceConfig() {
    const ice = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
    if (window.TT_TURN_URL) {
      ice.push({
        urls: window.TT_TURN_URL,
        username: window.TT_TURN_USER || '',
        credential: window.TT_TURN_PASS || ''
      });
    }
    return { iceServers: ice };
  }

  let socket = null;
  let gameId = null;
  let displayName = 'Player';
  let localStream = null;
  let joined = false;
  let micOn = true;
  let camOn = true;
  let playerIndex = -1;     // self's slot in the game (-1 = viewer/observer)
  let viewerMode = false;   // viewer (TV/audience) — no local mic/cam, pulls only
  let autoJoin = false;     // viewer mode auto-joins on mount
  let slotResolver = null;  // (peerInfo) => HTMLElement | null  — where to inject peer video
  // peerId -> { pc, tile, displayName, playerIndex, audioEl, videoEl, slotEl }
  const peers = {};

  // DOM refs
  let root, peersGrid, localPip, localVideo, joinBtn, leaveBtn, micBtn, camBtn, statusEl;

  // ──────────────────────────── DOM ────────────────────────────

  function mount(containerId, opts) {
    const container = document.getElementById(containerId);
    if (!container) return;
    gameId       = opts && opts.gameId;
    displayName  = (opts && opts.displayName) || displayName;
    playerIndex  = (opts && typeof opts.playerIndex === 'number') ? opts.playerIndex : -1;
    viewerMode   = !!(opts && opts.viewer);
    autoJoin     = !!(opts && (opts.autoJoin || opts.viewer));
    slotResolver = (opts && typeof opts.slotResolver === 'function') ? opts.slotResolver : null;

    root = document.createElement('div');
    root.className = 'tt-rtc' + (viewerMode ? ' tt-rtc-viewer' : '');
    root.innerHTML = `
      <div class="tt-rtc-header">
        <span class="tt-rtc-title">🎥 Live with players</span>
        <span class="tt-rtc-status" data-state="idle">off</span>
      </div>
      <div class="tt-rtc-grid"></div>
      <div class="tt-rtc-local-pip" style="display:none;">
        <video autoplay muted playsinline></video>
        <span class="tt-rtc-pip-name">You</span>
      </div>
      <div class="tt-rtc-controls">
        <button class="btn btn-primary" data-act="join">🎙 Join Video</button>
        <button class="btn btn-sm" data-act="mic" disabled>🎤 Mic</button>
        <button class="btn btn-sm" data-act="cam" disabled>📷 Cam</button>
        <button class="btn btn-danger btn-sm" data-act="leave" style="display:none;">⏻ Leave</button>
      </div>
      <div class="tt-rtc-hint">P2P (STUN). Each player's mic + camera streams direct to the others — no recording.</div>
    `;
    container.appendChild(root);

    peersGrid  = root.querySelector('.tt-rtc-grid');
    localPip   = root.querySelector('.tt-rtc-local-pip');
    localVideo = localPip.querySelector('video');
    statusEl   = root.querySelector('.tt-rtc-status');
    joinBtn    = root.querySelector('[data-act="join"]');
    leaveBtn   = root.querySelector('[data-act="leave"]');
    micBtn     = root.querySelector('[data-act="mic"]');
    camBtn     = root.querySelector('[data-act="cam"]');

    joinBtn.addEventListener('click', join);
    leaveBtn.addEventListener('click', leave);
    micBtn.addEventListener('click', toggleMic);
    camBtn.addEventListener('click', toggleCam);

    // Hook into the shared global socket (created by app.js).
    waitForSocket();
  }

  function waitForSocket() {
    if (window._ttSocket) {
      socket = window._ttSocket;
      bindSocket();
      if (autoJoin) {
        // Viewer mode joins automatically — no UX gate.
        if (viewerMode) joinAsViewer();
        else            join();
      }
      return;
    }
    setTimeout(waitForSocket, 200);
  }

  function setStatus(state, text) {
    if (!statusEl) return;
    statusEl.dataset.state = state;
    statusEl.textContent = text;
  }

  // ──────────────────────────── JOIN / LEAVE ────────────────────────────

  async function join() {
    if (joined) return;
    if (!gameId || !socket) return;
    setStatus('connecting', 'getting mic + cam…');
    joinBtn.disabled = true;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: 'user' }
      });
    } catch (err) {
      // Try audio-only if camera is rejected
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        camOn = false;
      } catch (err2) {
        setStatus('error', 'mic/cam denied');
        joinBtn.disabled = false;
        return;
      }
    }

    localVideo.srcObject = localStream;
    localPip.style.display = localStream.getVideoTracks().length ? 'block' : 'none';

    socket.emit('rtc-join', {
      gameId,
      displayName,
      playerIndex,
      role: viewerMode ? 'viewer' : 'player',
      hasCam: localStream.getVideoTracks().length > 0,
      hasMic: localStream.getAudioTracks().length > 0
    });

    joined = true;
    joinBtn.style.display = 'none';
    leaveBtn.style.display = '';
    micBtn.disabled = !localStream.getAudioTracks().length;
    camBtn.disabled = !localStream.getVideoTracks().length;
    micBtn.classList.toggle('off', !micOn);
    camBtn.classList.toggle('off', !camOn);
    setStatus('connected', 'live');
  }

  // Viewer-mode join: skip getUserMedia entirely, just observe peers.
  // Used by TV scoreboard, audience grid — they have no local cam to publish.
  function joinAsViewer() {
    if (joined) return;
    if (!gameId || !socket) return;
    socket.emit('rtc-join', {
      gameId,
      displayName,
      playerIndex: -1,
      role: 'viewer',
      hasCam: false,
      hasMic: false
    });
    joined = true;
    setStatus('connected', 'watching');
    if (joinBtn)  joinBtn.style.display  = 'none';
    if (leaveBtn) leaveBtn.style.display = 'none';
    if (micBtn)   micBtn.style.display   = 'none';
    if (camBtn)   camBtn.style.display   = 'none';
  }

  function leave() {
    if (!joined) return;
    socket.emit('rtc-leave');
    Object.keys(peers).forEach(removePeer);
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    if (localVideo) localVideo.srcObject = null;
    localPip.style.display = 'none';
    joined = false;
    joinBtn.disabled = false;
    joinBtn.style.display = '';
    leaveBtn.style.display = 'none';
    micBtn.disabled = true;
    camBtn.disabled = true;
    setStatus('idle', 'off');
  }

  // ──────────────────────────── SIGNALING ────────────────────────────

  function bindSocket() {
    socket.on('rtc-peers', ({ peers: existing }) => {
      // Newcomer offers to each existing peer.
      existing.forEach(p => {
        addPeer(p.peerId, p.displayName, /*offer*/ true, p);
      });
    });

    socket.on('rtc-peer-joined', (info) => {
      // Existing peer waits for the newcomer's offer.
      addPeer(info.peerId, info.displayName, /*offer*/ false, info);
    });

    socket.on('rtc-peer-left', ({ peerId }) => removePeer(peerId));

    socket.on('rtc-offer', async ({ fromPeerId, sdp }) => {
      let peer = peers[fromPeerId];
      if (!peer) peer = addPeer(fromPeerId, 'Peer', false, { peerId: fromPeerId });
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        socket.emit('rtc-answer', { targetPeerId: fromPeerId, sdp: peer.pc.localDescription });
      } catch (err) { console.warn('[tt-rtc] answer failed', err); }
    });

    socket.on('rtc-answer', async ({ fromPeerId, sdp }) => {
      const peer = peers[fromPeerId];
      if (!peer) return;
      try { await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp)); }
      catch (err) { console.warn('[tt-rtc] setRemote failed', err); }
    });

    socket.on('rtc-ice', ({ fromPeerId, candidate }) => {
      const peer = peers[fromPeerId];
      if (!peer || !candidate) return;
      peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    });

    socket.on('rtc-media-toggle', ({ peerId, kind, enabled }) => {
      const peer = peers[peerId];
      if (!peer) return;
      const target = peer.tile || peer.slotEl;
      if (kind === 'video' && peer.videoEl) {
        peer.videoEl.style.display = enabled ? 'block' : 'none';
        if (target) target.classList.toggle('cam-off', !enabled);
      }
      if (kind === 'audio' && target) {
        target.classList.toggle('mic-off', !enabled);
      }
    });
  }

  // ──────────────────────────── PEER ────────────────────────────

  function addPeer(peerId, name, shouldOffer, peerInfo) {
    if (peers[peerId]) return peers[peerId];

    const pc = new RTCPeerConnection(buildIceConfig());

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('rtc-ice', { targetPeerId: peerId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      const peer = peers[peerId];
      if (!peer) return;
      const stream = e.streams[0];
      if (peer.audioEl) peer.audioEl.srcObject = stream;
      if (peer.videoEl) {
        peer.videoEl.srcObject = stream;
        peer.videoEl.style.display = stream.getVideoTracks().length ? 'block' : 'none';
        if (peer.tile) peer.tile.classList.toggle('cam-off', !stream.getVideoTracks().length);
      }
      if (peer.slotEl) peer.slotEl.classList.toggle('cam-off', !stream.getVideoTracks().length);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Don't auto-tear down on transient drops — Chrome cycles through these.
        // Only act on sustained failure.
        if (pc.connectionState === 'failed') removePeer(peerId);
      }
    };

    // Viewer mode = pull-only; never publish local tracks even if we have a stream.
    if (localStream && !viewerMode) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    // If host gave us a slot resolver and it knows where this peer goes,
    // inject the peer's a/v elements into the pre-existing slot instead
    // of building a tile in the default grid. The TV scoreboard uses this
    // to merge the dartboard frame + competitor face video into one slot.
    const fullInfo = Object.assign({ peerId, displayName: name, playerIndex: -1 }, peerInfo || {});
    let slotEl = null, slotVideo = null, slotAudio = null;
    if (slotResolver) {
      slotEl = slotResolver(fullInfo);
      if (slotEl) {
        slotEl.classList.add('tt-rtc-slot');
        slotVideo = slotEl.querySelector('video.tt-rtc-slot-video');
        slotAudio = slotEl.querySelector('audio.tt-rtc-slot-audio');
        if (!slotVideo) {
          slotVideo = document.createElement('video');
          slotVideo.className = 'tt-rtc-slot-video';
          slotVideo.autoplay = true; slotVideo.playsInline = true;
          slotEl.appendChild(slotVideo);
        }
        if (!slotAudio) {
          slotAudio = document.createElement('audio');
          slotAudio.className = 'tt-rtc-slot-audio';
          slotAudio.autoplay = true;
          slotEl.appendChild(slotAudio);
        }
      }
    }
    const tile = slotEl ? null : makeTile(peerId, name);
    peers[peerId] = {
      pc, tile, slotEl,
      displayName: name,
      playerIndex: fullInfo.playerIndex,
      audioEl: slotAudio || (tile && tile.querySelector('audio')),
      videoEl: slotVideo || (tile && tile.querySelector('video'))
    };

    if (shouldOffer) {
      pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => {
        socket.emit('rtc-offer', { targetPeerId: peerId, sdp: pc.localDescription });
      }).catch(err => console.warn('[tt-rtc] offer failed', err));
    }

    return peers[peerId];
  }

  function removePeer(peerId) {
    const peer = peers[peerId];
    if (!peer) return;
    try { peer.pc.close(); } catch (_) {}
    if (peer.tile && peer.tile.parentNode) peer.tile.parentNode.removeChild(peer.tile);
    if (peer.slotEl) {
      // Don't remove the slot itself — the host (scoreboard view) owns it.
      // Clear our injected media so the slot can be reused for the next peer.
      if (peer.videoEl && peer.videoEl.parentNode === peer.slotEl) peer.slotEl.removeChild(peer.videoEl);
      if (peer.audioEl && peer.audioEl.parentNode === peer.slotEl) peer.slotEl.removeChild(peer.audioEl);
      peer.slotEl.classList.add('cam-off');
    }
    delete peers[peerId];
  }

  function makeTile(peerId, name) {
    const tile = document.createElement('div');
    tile.className = 'tt-rtc-tile';
    tile.dataset.peerId = peerId;
    tile.innerHTML = `
      <div class="tt-rtc-tile-placeholder">${(name || '?').charAt(0).toUpperCase()}</div>
      <video autoplay playsinline style="display:none;"></video>
      <audio autoplay></audio>
      <div class="tt-rtc-tile-name">${escapeHtml(name || 'Player')}</div>
    `;
    peersGrid.appendChild(tile);
    return tile;
  }

  // ──────────────────────────── MEDIA CONTROLS ────────────────────────────

  function toggleMic() {
    if (!localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach(t => { t.enabled = micOn; });
    micBtn.classList.toggle('off', !micOn);
    socket.emit('rtc-media-toggle', { kind: 'audio', enabled: micOn });
  }

  function toggleCam() {
    if (!localStream) return;
    const tracks = localStream.getVideoTracks();
    if (!tracks.length) return;
    camOn = !camOn;
    tracks.forEach(t => { t.enabled = camOn; });
    camBtn.classList.toggle('off', !camOn);
    localPip.style.display = camOn ? 'block' : 'none';
    socket.emit('rtc-media-toggle', { kind: 'video', enabled: camOn });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  window._ttRtc = {
    mount,
    join, joinAsViewer, leave,
    toggleMic, toggleCam,
    isJoined: () => joined,
    setPlayerIndex: (i) => { playerIndex = (typeof i === 'number') ? i : -1; }
  };
})();
