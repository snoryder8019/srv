/* === BROADCAST CLIENT — WebRTC Screen Share + Chat + Emoji === */
(function () {
  'use strict';

  // Fetched from server (includes TURN credentials)
  let ICE_CONFIG = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ] };

  const EMOJI_SETS = [
    {
      label: 'Reactions',
      emojis: [
        { e: '\uD83D\uDD25' }, { e: '\uD83D\uDC80' }, { e: '\uD83D\uDE0E' },
        { e: '\uD83E\uDD2F' }, { e: '\uD83D\uDE02' }, { e: '\uD83D\uDE24' },
        { e: '\uD83D\uDE31' }, { e: '\uD83E\uDD23' }, { e: '\uD83D\uDC4D' },
        { e: '\uD83D\uDC4E' }, { e: '\u2764\uFE0F' }, { e: '\uD83D\uDC94' },
      ],
    },
    {
      label: 'Gaming',
      emojis: [
        { e: '\uD83C\uDFAE' }, { e: '\uD83D\uDD79\uFE0F' }, { e: '\uD83C\uDFC6' },
        { e: '\u2694\uFE0F' }, { e: '\uD83D\uDEE1\uFE0F' }, { e: '\uD83D\uDCA3' },
        { e: '\uD83C\uDFAF' }, { e: '\uD83D\uDC51' }, { e: '\uD83D\uDC8E' },
        { e: '\uD83D\uDE80' }, { e: '\u2B50' }, { e: '\uD83D\uDCA5' },
      ],
    },
    {
      label: 'Callouts',
      emojis: [
        { e: 'GG', text: true }, { e: 'EZ', text: true }, { e: 'GLHF', text: true },
        { e: 'WP', text: true }, { e: 'RIP', text: true }, { e: 'LETS GO', text: true },
        { e: 'CLUTCH', text: true }, { e: 'NOOB', text: true },
      ],
    },
  ];

  const GAME_LABELS = { rust: 'RUST', valheim: 'VALHEIM', l4d2: 'L4D2', '7dtd': '7 DAYS' };

  // Steam protocol links — launches game + auto-connects
  const STEAM_CONNECT = {
    rust:    'steam://connect/games.madladslab.com:28015',
    l4d2:    'steam://connect/games.madladslab.com:27015',
    valheim: 'steam://connect/games.madladslab.com:2456',
    '7dtd':  'steam://connect/games.madladslab.com:26900',
  };

  let socket = null;
  let me = null;
  let broadcastCode = null;
  let isBroadcaster = false;
  let localStream = null;
  let viewerPeers = {};   // P2P fallback: { viewerSocketId: RTCPeerConnection }
  let broadcasterPC = null; // P2P fallback: single peer connection to broadcaster
  let emojiOpen = false;

  // Mediasoup SFU state
  let useSFU = false;
  let msDevice = null;
  let msSendTransport = null;
  let msRecvTransport = null;

  // ── Voice state ──
  let voiceStream = null;        // local mic MediaStream
  let voicePeers = {};           // { socketId: RTCPeerConnection }
  let inVoice = false;
  let voiceMuted = false;
  let pttMode = false;
  let pttActive = false;
  let speakingDetector = null;

  const $ = (sel) => document.querySelector(sel);
  const $id = (id) => document.getElementById(id);

  // ── Init ──
  async function init() {
    const parts = window.location.pathname.split('/');
    broadcastCode = parts[2] || null;
    if (!broadcastCode) return window.location.href = '/';

    // Get user info (may be unauthenticated)
    try {
      const res = await fetch('/broadcasts/api/me');
      me = await res.json();
    } catch (e) {
      me = { id: null, name: null, role: 'viewer', authed: false };
    }

    // Chat input + nav visibility
    if (me.authed) {
      $id('chatInputBar').classList.remove('hidden');
      $id('chatLoginPrompt').classList.add('hidden');
      $id('navDashboard').classList.remove('hidden');
      if (me.role === 'superadmin' || me.role === 'admin') {
        $id('navAdmin').classList.remove('hidden');
      }
    } else {
      $id('chatInputBar').classList.add('hidden');
      $id('chatLoginPrompt').classList.remove('hidden');
    }

    // Fetch TURN credentials
    try {
      var iceRes = await fetch('/broadcasts/api/ice');
      ICE_CONFIG = await iceRes.json();
    } catch (e) { /* fallback to default STUN */ }

    connectSocket();
    setupUI();
  }

  // ── Socket Connection ──
  function connectSocket() {
    socket = io('/broadcasts', { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      socket.emit('broadcast:join', broadcastCode);
    });

    socket.on('broadcast:state', async (data) => {
      updateHeader(data);
      renderMessages(data.messages || []);
      isBroadcaster = me.authed && data.host && data.host.id === me.id;
      if (isBroadcaster) {
        $id('btnEndBroadcast').classList.remove('hidden');
        if (!data.live) showLaunchPanel(data.game);
      }

      // Init mediasoup device
      if (window.mediasoupClient && !msDevice) {
        try {
          var caps = await socketRequest('sfu:getCapabilities', broadcastCode);
          if (caps.ok && caps.rtpCapabilities) {
            msDevice = new window.mediasoupClient.Device();
            await msDevice.load({ routerRtpCapabilities: caps.rtpCapabilities });
            useSFU = true;
            console.log('[sfu] Device loaded, using SFU');
          }
        } catch (e) { console.warn('[sfu] Fallback to P2P:', e.message); }
      }

      // Viewer: if broadcast is live, try SFU then fallback to P2P
      if (!isBroadcaster && data.live) {
        if (useSFU) {
          startSFUViewer().catch(function () { console.warn('[sfu] Failed, P2P will handle it'); });
        }
        // P2P offers will still arrive via broadcast:viewer-joined on broadcaster side
      }
    });

    socket.on('broadcast:live', () => {
      $id('navLive').classList.remove('hidden');
      if (!isBroadcaster) {
        // Don't hide offline yet — wait for actual video track
        if (useSFU) startSFUViewer().catch(function () {});
      }
    });

    socket.on('sfu:newProducer', () => {
      if (!isBroadcaster && useSFU) startSFUViewer().catch(function () {});
    });

    socket.on('broadcast:ended', () => {
      toast('Broadcast ended');
      cleanupWebRTC();
      var video = $id('videoPlayer');
      video.srcObject = null;
      video.style.display = 'none';
      $id('videoOffline').classList.remove('hidden');
      if (isBroadcaster) {
        $id('videoOffline').innerHTML =
          '<div class="video-offline-icon">&#128308;</div>' +
          '<div>BROADCAST ENDED</div>' +
          '<a href="/dashboard" class="exit-btn">BACK TO DASHBOARD</a>';
      } else {
        $id('videoOffline').innerHTML =
          '<div class="video-offline-icon">&#128308;</div>' +
          '<div>BROADCAST ENDED</div>' +
          '<div style="color:var(--muted);font-size:0.7rem;margin-top:6px;">The broadcaster has ended the session</div>' +
          '<a href="/" class="exit-btn">EXIT SESSION</a>';
      }
      $id('navLive').classList.add('hidden');
    });

    // ── WebRTC signaling (viewer side) ──
    socket.on('broadcast:offer', async (data) => {
      if (isBroadcaster) return;
      try {
        broadcasterPC = new RTCPeerConnection(ICE_CONFIG);

        broadcasterPC.ontrack = (event) => {
          var video = $id('videoPlayer');
          // Only set srcObject once (ontrack fires for each track: video + audio)
          if (!video.srcObject) {
            video.srcObject = event.streams[0];
          } else if (event.streams[0] !== video.srcObject) {
            // Different stream — add tracks to existing
            event.streams[0].getTracks().forEach(function(t) {
              if (!video.srcObject.getTracks().find(function(et) { return et.id === t.id; })) {
                video.srcObject.addTrack(t);
              }
            });
          }
          video.style.display = '';
          // Start muted to satisfy autoplay, then unmute on user gesture
          video.muted = true;
          video.play().then(function() {
            // Show unmute prompt
            showUnmutePrompt(video);
          }).catch(function() {});
          $id('videoOffline').classList.add('hidden');
          $id('navLive').classList.remove('hidden');
        };

        broadcasterPC.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('broadcast:ice', {
              code: broadcastCode,
              candidate: event.candidate,
              targetSocketId: null, // goes to broadcaster
            });
          }
        };

        await broadcasterPC.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await broadcasterPC.createAnswer();
        await broadcasterPC.setLocalDescription(answer);

        socket.emit('broadcast:answer', {
          code: broadcastCode,
          sdp: answer,
          targetSocketId: data.fromSocketId,
        });
      } catch (e) {
        console.error('[broadcast] WebRTC viewer error:', e);
      }
    });

    // ── WebRTC signaling (broadcaster side) ──
    socket.on('broadcast:viewer-joined', async (data) => {
      if (!isBroadcaster || !localStream) return;
      try {
        const pc = new RTCPeerConnection(ICE_CONFIG);
        viewerPeers[data.socketId] = pc;

        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        // Cap bitrate for this peer + rebalance all peers
        await capBitrate(pc);
        rebalanceBitrates();

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('broadcast:ice', {
              code: broadcastCode,
              candidate: event.candidate,
              targetSocketId: data.socketId,
            });
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit('broadcast:offer', {
          code: broadcastCode,
          sdp: offer,
          targetSocketId: data.socketId,
        });
      } catch (e) {
        console.error('[broadcast] WebRTC broadcaster error:', e);
      }
    });

    socket.on('broadcast:answer', async (data) => {
      const pc = viewerPeers[data.fromSocketId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    });

    socket.on('broadcast:ice', async (data) => {
      try {
        if (isBroadcaster) {
          const pc = viewerPeers[data.fromSocketId];
          if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else if (broadcasterPC) {
          await broadcasterPC.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (e) {
        console.error('[broadcast] ICE error:', e);
      }
    });

    socket.on('broadcast:viewer-left', (data) => {
      if (viewerPeers[data.socketId]) {
        viewerPeers[data.socketId].close();
        delete viewerPeers[data.socketId];
        // Viewer left — remaining peers get more bandwidth
        rebalanceBitrates();
      }
    });

    // ── Chat events ──
    socket.on('broadcast:chat', (msg) => appendMessage(msg));
    socket.on('broadcast:emoji-react', (data) => floatEmoji(data.emoji));
    socket.on('broadcast:viewer-count', (count) => {
      $id('chatViewerCount').textContent = count + ' watching';
      $id('overlayViewers').textContent = count + ' watching';
      $id('overlayViewers').classList.remove('hidden');
    });
    socket.on('broadcast:system', (text) => appendSystem(text));
    socket.on('broadcast:error', (msg) => toast(msg));

    socket.on('broadcast:kicked', (reason) => {
      toast(reason);
      cleanupWebRTC();
      $id('videoPlayer').style.display = 'none';
      $id('videoOffline').classList.remove('hidden');
      $id('videoOffline').innerHTML =
        '<div class="video-offline-icon">&#128308;</div>' +
        '<div>' + esc(reason) + '</div>' +
        '<a href="/" class="exit-btn">EXIT SESSION</a>';
    });

    socket.on('connect_error', () => {
      // Socket.IO will auto-retry
    });

    // Wire up voice chat events
    setupVoiceEvents();
  }

  // ── Launch Panel (broadcaster pre-live) ──
  function showLaunchPanel(game) {
    var panel = $id('launchPanel');
    var launchBtn = $id('btnLaunchGame');
    var steamUrl = STEAM_CONNECT[game];

    if (steamUrl) {
      launchBtn.href = steamUrl;
      launchBtn.textContent = '\u25B6 LAUNCH ' + (GAME_LABELS[game] || game);
    } else {
      launchBtn.href = '#';
      launchBtn.textContent = '\u25B6 LAUNCH GAME';
    }

    panel.classList.remove('hidden');
    $id('videoOffline').classList.add('hidden');
  }

  function hideLaunchPanel() {
    $id('launchPanel').classList.add('hidden');
  }

  // ── Bitrate management ──
  // Max total upload ~6Mbps — divided among viewers
  var MAX_TOTAL_BITRATE = 8000000;
  var MIN_PER_PEER_BITRATE = 800000; // 800kbps floor — keeps games watchable

  function getPerPeerBitrate() {
    var count = Object.keys(viewerPeers).length || 1;
    return Math.max(MIN_PER_PEER_BITRATE, Math.floor(MAX_TOTAL_BITRATE / count));
  }

  async function capBitrate(pc) {
    var senders = pc.getSenders();
    for (var i = 0; i < senders.length; i++) {
      var sender = senders[i];
      if (sender.track && sender.track.kind === 'video') {
        try {
          var params = sender.getParameters();
          if (!params.encodings || !params.encodings.length) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = getPerPeerBitrate();
          params.encodings[0].maxFramerate = 30;
          params.degradationPreference = 'maintain-framerate';
          await sender.setParameters(params);
        } catch (e) { /* some browsers don't support this fully */ }
      }
    }
  }

  // Rebalance bitrate across all viewers when count changes
  async function rebalanceBitrates() {
    var keys = Object.keys(viewerPeers);
    for (var i = 0; i < keys.length; i++) {
      await capBitrate(viewerPeers[keys[i]]);
    }
  }

  // Streams held during a live broadcast so we can stop everything cleanly
  // when the broadcaster ends the share or the page unloads.
  var screenStream = null;
  var cameraStream = null;
  var micStream = null;
  var compositeCanvas = null;
  var compositeRAF = null;

  // ── Start Broadcast (screen share) ──
  window.startBroadcastStream = async function () {
    if (!me.authed) return;
    try {
      // displaySurface: 'window' is a hint — most browsers honor it by
      // pre-selecting the Window tab in the picker, but they still allow
      // the user to pick a screen or tab. We validate post-pick below.
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'window',
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000,
        },
      });

      var screenTrack = screenStream.getVideoTracks()[0];
      var settings = (screenTrack.getSettings && screenTrack.getSettings()) || {};
      // Reject screen/tab/monitor picks — broadcasts are meant for a single
      // game window so personal desktop content doesn't leak to viewers.
      if (settings.displaySurface && settings.displaySurface !== 'window') {
        screenStream.getTracks().forEach(function (t) { t.stop(); });
        screenStream = null;
        toast('Please share a game WINDOW (not your full screen or a browser tab).');
        return;
      }

      if (screenTrack.contentHint !== undefined) {
        screenTrack.contentHint = 'motion';
      }

      // Try to grab the camera + mic in one prompt. If the user denies the
      // camera but the mic is still available we re-prompt for mic-only so
      // host voice always makes it through to viewers (one-way; viewers
      // never publish back).
      try {
        var camAndMic = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 320, max: 640 }, height: { ideal: 240, max: 480 }, frameRate: { ideal: 24, max: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 },
        });
        // Split the combined stream into camera-video and mic-audio so we
        // can place the camera into the composite canvas without dragging
        // the audio through it (canvas.captureStream is video-only).
        var camVideoTracks = camAndMic.getVideoTracks();
        var camAudioTracks = camAndMic.getAudioTracks();
        if (camVideoTracks.length) {
          cameraStream = new MediaStream(camVideoTracks);
        }
        if (camAudioTracks.length) {
          micStream = new MediaStream(camAudioTracks);
        }
      } catch (camErr) {
        console.warn('[broadcast] camera+mic unavailable:', camErr && camErr.message);
      }

      // No combined permission? Try mic alone — host voice is the priority.
      if (!micStream) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 },
            video: false,
          });
        } catch (micErr) {
          console.warn('[broadcast] mic unavailable:', micErr && micErr.message);
        }
      }

      // Build the broadcast stream — either compositor canvas (screen +
      // camera overlay) or the raw screen stream when no camera is present.
      localStream = cameraStream
        ? buildCompositeStream(screenStream, cameraStream)
        : screenStream;

      // Mix the mic into the outgoing stream so viewers hear the host.
      // The composite canvas only carries video, so audio always lives on
      // the localStream as a separate track regardless of camera presence.
      if (micStream) {
        micStream.getAudioTracks().forEach(function (t) { localStream.addTrack(t); });
      }

      var vTrack = localStream.getVideoTracks()[0];
      if (vTrack && vTrack.contentHint !== undefined) {
        vTrack.contentHint = 'motion';
      }

      // Don't play video back to broadcaster — saves CPU/bandwidth
      var video = $id('videoPlayer');
      video.style.display = 'none';
      hideLaunchPanel();
      $id('videoOffline').classList.remove('hidden');
      $id('videoOffline').innerHTML = '<div class="video-offline-icon" style="color:var(--green)">&#128308;</div><div style="color:var(--green)">YOU ARE LIVE</div><div style="color:var(--muted);font-size:0.65rem;margin-top:8px;">Viewers are watching your game window' + (cameraStream ? ' + camera' : '') + '</div>';
      renderBroadcasterCameraPreview();

      // Use SFU if available, otherwise P2P continues via viewer-joined events
      if (useSFU && msDevice) {
        await startSFUBroadcast();
      }

      socket.emit('broadcast:go-live', broadcastCode);

      // Screen-share end (broadcaster clicks "Stop sharing" in browser chrome)
      // is the canonical end signal — tear everything else down with it.
      screenTrack.onended = function () {
        socket.emit('broadcast:stop', broadcastCode);
        stopCompositeAndCamera();
        cleanupWebRTC();
      };
    } catch (e) {
      stopCompositeAndCamera();
      if (e.name !== 'NotAllowedError') {
        toast('Screen share failed: ' + e.message);
      }
    }
  };

  // Composite screen + camera onto a canvas so a single combined track ships
  // through the SFU. Camera lives in the bottom-right at ~22% of the frame
  // width so it stays readable without dominating the gameplay view.
  function buildCompositeStream(screenSrc, camSrc) {
    var screenSettings = screenSrc.getVideoTracks()[0].getSettings() || {};
    var W = screenSettings.width  || 1280;
    var H = screenSettings.height || 720;

    compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = W;
    compositeCanvas.height = H;
    var ctx = compositeCanvas.getContext('2d');

    var sv = document.createElement('video');
    sv.muted = true; sv.playsInline = true; sv.srcObject = screenSrc;
    sv.play().catch(function () {});

    var cv = document.createElement('video');
    cv.muted = true; cv.playsInline = true; cv.srcObject = camSrc;
    cv.play().catch(function () {});

    function draw() {
      try {
        if (sv.readyState >= 2) ctx.drawImage(sv, 0, 0, W, H);
        if (cv.readyState >= 2) {
          var camW = Math.round(W * 0.22);
          var camH = Math.round(camW * (cv.videoHeight / Math.max(1, cv.videoWidth)) || camW * 0.75);
          var pad = Math.round(W * 0.015);
          var x = W - camW - pad;
          var y = H - camH - pad;
          // Soft border so the cam overlay reads as a distinct tile
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(x - 3, y - 3, camW + 6, camH + 6);
          ctx.drawImage(cv, x, y, camW, camH);
        }
      } catch (e) {}
      compositeRAF = requestAnimationFrame(draw);
    }
    draw();

    var stream = compositeCanvas.captureStream(30);
    // Host mic is the only audio source — see startBroadcastStream where it
    // is added to localStream after this returns. Window-audio capture from
    // getDisplayMedia is unreliable across OSes and would compete with the
    // mic for the single SFU audio producer slot, so drop it.
    return stream;
  }

  // Render a small mirrored self-view to the broadcaster so they can see
  // what their camera is showing without having to peek at viewer chat.
  function renderBroadcasterCameraPreview() {
    var host = $id('videoOffline');
    if (!host || !cameraStream) return;
    var prev = document.getElementById('broadcasterCamPreview');
    if (prev) prev.remove();
    var wrap = document.createElement('div');
    wrap.id = 'broadcasterCamPreview';
    wrap.style.cssText = 'position:absolute;right:14px;bottom:14px;width:160px;border:1px solid rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;background:#000;z-index:2;';
    var v = document.createElement('video');
    v.autoplay = true; v.muted = true; v.playsInline = true;
    v.style.cssText = 'width:100%;display:block;transform:scaleX(-1);';
    v.srcObject = cameraStream;
    wrap.appendChild(v);
    var label = document.createElement('div');
    label.textContent = 'You · cam preview';
    label.style.cssText = 'font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:#aaa;padding:3px 6px;background:rgba(0,0,0,0.6);';
    wrap.appendChild(label);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(wrap);
  }

  function stopCompositeAndCamera() {
    if (compositeRAF) { cancelAnimationFrame(compositeRAF); compositeRAF = null; }
    if (compositeCanvas) compositeCanvas = null;
    if (cameraStream) { cameraStream.getTracks().forEach(function (t) { t.stop(); }); cameraStream = null; }
    if (micStream)    { micStream.getTracks().forEach(function (t) { t.stop(); });    micStream = null;    }
    if (screenStream)  { screenStream.getTracks().forEach(function (t) { t.stop(); });  screenStream = null;  }
    var prev = document.getElementById('broadcasterCamPreview');
    if (prev) prev.remove();
  }

  // ── SFU Broadcast (single upload) ──
  async function startSFUBroadcast() {
    if (!localStream || !msDevice) return;
    var tData = await socketRequest('sfu:createSendTransport', broadcastCode);
    if (!tData.ok) return;

    msSendTransport = msDevice.createSendTransport(tData.transport);
    msSendTransport.on('connect', function (params, callback) {
      socketRequest('sfu:connectTransport', {
        code: broadcastCode, transportId: msSendTransport.id,
        dtlsParameters: params.dtlsParameters, role: 'broadcaster',
      }).then(function () { callback(); }).catch(callback);
    });
    msSendTransport.on('produce', function (params, callback) {
      socketRequest('sfu:produce', {
        code: broadcastCode, transportId: msSendTransport.id,
        kind: params.kind, rtpParameters: params.rtpParameters,
      }).then(function (res) { callback({ id: res.id }); }).catch(callback);
    });

    var vt = localStream.getVideoTracks()[0];
    if (vt) await msSendTransport.produce({
      track: vt,
      encodings: [{ maxBitrate: 500000, scaleResolutionDownBy: 2 }, { maxBitrate: 1500000 }],
      codecOptions: { videoGoogleStartBitrate: 1000 },
    });
    var at = localStream.getAudioTracks()[0];
    if (at) await msSendTransport.produce({ track: at });
  }

  // ── SFU Viewer (receive from server) ──
  async function startSFUViewer() {
    if (!msDevice) return;
    var tData = await socketRequest('sfu:createRecvTransport', broadcastCode);
    if (!tData.ok) return;

    msRecvTransport = msDevice.createRecvTransport(tData.transport);
    msRecvTransport.on('connect', function (params, callback) {
      socketRequest('sfu:connectTransport', {
        code: broadcastCode, transportId: msRecvTransport.id,
        dtlsParameters: params.dtlsParameters, role: 'viewer',
      }).then(function () { callback(); }).catch(callback);
    });

    var result = await socketRequest('sfu:consume', {
      code: broadcastCode, rtpCapabilities: msDevice.rtpCapabilities,
    });
    if (!result.ok || !result.consumers || !result.consumers.length) return;

    var videoEl = $id('videoPlayer');
    var stream = new MediaStream();
    for (var i = 0; i < result.consumers.length; i++) {
      var c = result.consumers[i];
      var consumer = await msRecvTransport.consume({
        id: c.id, producerId: c.producerId, kind: c.kind, rtpParameters: c.rtpParameters,
      });
      stream.addTrack(consumer.track);
      await socketRequest('sfu:resume', { code: broadcastCode, consumerId: c.id });
    }
    videoEl.style.display = '';
    videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.play().then(function() {
      showUnmutePrompt(videoEl);
    }).catch(function() {});
    $id('videoOffline').classList.add('hidden');
    $id('navLive').classList.remove('hidden');
  }

  function socketRequest(event, data) {
    return new Promise(function (resolve, reject) {
      socket.emit(event, data, function (res) {
        if (res && res.error) reject(new Error(res.error));
        else resolve(res || {});
      });
    });
  }

  // ── UI Setup ──
  function setupUI() {
    // Chat input
    $id('chatInput').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    };
    $id('btnSend').onclick = sendChat;

    // Emoji
    $id('btnEmojiToggle').onclick = () => {
      emojiOpen = !emojiOpen;
      $id('emojiTray').classList.toggle('open', emojiOpen);
    };
    buildEmojiTray();

    // Share
    $id('btnShare').classList.remove('hidden');
    $id('btnShare').onclick = openShare;
    $id('shareOverlay').onclick = (e) => { if (e.target === $id('shareOverlay')) closeShare(); };
    $id('btnShareClose').onclick = closeShare;
    $id('btnCopyLink').onclick = copyLink;

    // End broadcast
    $id('btnEndBroadcast').onclick = async () => {
      if (!confirm('End this broadcast?')) return;
      await fetch('/broadcasts/api/' + broadcastCode + '/end', { method: 'POST' });
      cleanupWebRTC();
      window.location.href = '/dashboard';
    };

    checkBroadcasterAutoStart();
  }

  function updateHeader(data) {
    if (data.game) {
      $id('navGame').textContent = GAME_LABELS[data.game] || data.game;
      $id('navGame').classList.remove('hidden');
    }
    if (data.host) {
      $id('overlayHost').textContent = data.host.name;
      $id('overlayHost').classList.remove('hidden');
    }
    if (data.live) {
      $id('navLive').classList.remove('hidden');
      $id('videoOffline').classList.add('hidden');
    }
    $id('chatViewerCount').textContent = (data.viewerCount || 0) + ' watching';
    refreshBroadcastStats();
  }

  // Pull the persisted stats roll-up for this broadcast. Called on header
  // refresh and once every 20s while the page is open so the title-card
  // counters stay in sync without needing a stats-specific socket event.
  function refreshBroadcastStats() {
    if (!broadcastCode) return;
    fetch('/broadcasts/api/' + broadcastCode + '/stats')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d || !d.stats) return;
        var s = d.stats;
        var bar = $id('bcStats'); if (!bar) return;
        bar.classList.remove('hidden');
        $id('bcsPeak').textContent   = s.peakViewers || 0;
        $id('bcsUnique').textContent = s.uniqueViewers || 0;
        $id('bcsChats').textContent  = s.totalChatMessages || 0;
        $id('bcsVoice').textContent  = s.peakVoicePeers || 0;
        // Duration: render whichever side has it. Mongo decimal js Number.
        var ms = s.durationMs || 0;
        var mins = Math.floor(ms / 60000);
        var hrs  = Math.floor(mins / 60);
        $id('bcsDuration').textContent = hrs > 0
          ? hrs + 'h ' + (mins % 60) + 'm'
          : mins + 'm';
        var lt = s.hostLifetime || {};
        $id('bcsHostHandle').textContent = (s.host && s.host.handle) || lt.handle || 'host';
        var ltAirHrs = Math.round(((lt.totalAirtimeMs || 0) / 3600000) * 10) / 10;
        $id('bcsHostLine').textContent =
          'host · ' + (lt.broadcasts || 0) + ' broadcasts · ' + ltAirHrs + 'h aired · peak ' + (lt.peakViewersEver || 0);
      }).catch(function() {});
  }

  // Refresh stats every 20s. The bar stays visible after the broadcast ends
  // so viewers on the result screen can still see the final tallies.
  setInterval(function() { refreshBroadcastStats(); }, 20000);

  // ── Chat ──
  function sendChat() {
    if (!me.authed) return;
    var input = $id('chatInput');
    var text = input.value.trim();
    if (!text) return;
    socket.emit('broadcast:chat', text);
    input.value = '';
    input.focus();
  }

  function renderMessages(msgs) {
    $id('chatMessages').innerHTML = '';
    msgs.forEach(function (m) { appendMessage(m, false); });
    var c = $id('chatMessages');
    c.scrollTop = c.scrollHeight;
  }

  function appendMessage(msg, scroll) {
    if (scroll === undefined) scroll = true;
    var c = $id('chatMessages');
    var el = document.createElement('div');
    el.className = 'chat-msg';
    var time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.innerHTML =
      '<span class="chat-msg-name role-' + msg.role + '">' + esc(msg.name) + '</span>' +
      '<span class="chat-msg-text">' + esc(msg.text) + '</span>' +
      '<span class="chat-msg-time">' + time + '</span>';
    c.appendChild(el);
    if (scroll) c.scrollTop = c.scrollHeight;
  }

  function appendSystem(text) {
    var c = $id('chatMessages');
    var el = document.createElement('div');
    el.className = 'chat-msg-system';
    el.textContent = text;
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;
  }

  // ── Emoji ──
  function buildEmojiTray() {
    var tray = $id('emojiTray');
    tray.innerHTML = '';
    EMOJI_SETS.forEach(function (set) {
      var sec = document.createElement('div');
      sec.className = 'emoji-section';
      sec.innerHTML = '<div class="emoji-label">' + set.label + '</div>';
      var grid = document.createElement('div');
      grid.className = 'emoji-grid';
      set.emojis.forEach(function (em) {
        var btn = document.createElement('button');
        btn.className = 'emoji-btn' + (em.text ? ' text-emoji' : '');
        btn.textContent = em.e;
        btn.onclick = function () {
          if (em.text) {
            $id('chatInput').value += em.e + ' ';
            $id('chatInput').focus();
          } else {
            socket.emit('broadcast:emoji-react', em.e);
            floatEmoji(em.e);
          }
        };
        grid.appendChild(btn);
      });
      sec.appendChild(grid);
      tray.appendChild(sec);
    });
  }

  function floatEmoji(emoji) {
    var el = document.createElement('div');
    el.className = 'emoji-float';
    el.textContent = emoji;
    el.style.left = (Math.random() * 60 + 20) + '%';
    el.style.bottom = '80px';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2100);
  }

  // ── Share ──
  function openShare() {
    var url = 'https://games.madladslab.com/broadcasts/' + broadcastCode;
    $id('shareLinkInput').value = url;
    $id('shareQrImg').src = '/broadcasts/api/' + broadcastCode + '/qr';
    $id('shareOverlay').classList.add('open');
  }
  function closeShare() { $id('shareOverlay').classList.remove('open'); }
  function copyLink() {
    navigator.clipboard.writeText($id('shareLinkInput').value).then(function () {
      var btn = $id('btnCopyLink');
      btn.textContent = 'COPIED';
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = 'COPY'; btn.classList.remove('copied'); }, 2000);
    });
  }

  // ── Unmute prompt (browsers require user gesture for audio) ──
  function showUnmutePrompt(videoEl) {
    if (!videoEl.muted) return; // already unmuted
    var existing = $id('unmutePrompt');
    if (existing) return;
    var prompt = document.createElement('div');
    prompt.id = 'unmutePrompt';
    prompt.style.cssText = 'position:absolute;bottom:50px;left:50%;transform:translateX(-50%);z-index:20;background:rgba(0,0,0,0.85);border:1px solid var(--accent);color:#fff;font-family:monospace;font-size:0.82rem;padding:12px 24px;border-radius:6px;cursor:pointer;text-align:center;animation:pulse 1.5s infinite;';
    prompt.innerHTML = '&#128264; CLICK TO UNMUTE AUDIO';
    prompt.onclick = function() {
      videoEl.muted = false;
      prompt.remove();
    };
    // Also unmute on any click anywhere on the video container
    var container = videoEl.parentElement;
    var handler = function() {
      videoEl.muted = false;
      var p = $id('unmutePrompt');
      if (p) p.remove();
      container.removeEventListener('click', handler);
    };
    container.addEventListener('click', handler);
    container.appendChild(prompt);
  }

  // ── WebRTC cleanup ──
  function cleanupWebRTC() {
    if (localStream) {
      localStream.getTracks().forEach(function (t) { t.stop(); });
      localStream = null;
    }
    // Also tear down any composite-canvas RAF + the raw screen/camera tracks
    // that fed it. Safe to call even if the broadcaster never opted into a
    // camera tile (the helper no-ops on null sources).
    stopCompositeAndCamera();
    Object.keys(viewerPeers).forEach(function (k) {
      viewerPeers[k].close();
    });
    viewerPeers = {};
    if (broadcasterPC) {
      broadcasterPC.close();
      broadcasterPC = null;
    }
  }

  // ── Util ──
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function toast(msg) {
    var t = $id('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 3000);
  }

  // Expose mod actions
  window.bcMod = {
    kick: function (id) { socket.emit('broadcast:kick', id); },
    mute: function (id) { socket.emit('broadcast:mute', id); },
    ban: function (id) { if (confirm('Ban this user?')) socket.emit('broadcast:ban', id); },
  };

  // ═══════════════════════════════════════════
  // ══ VOICE CHAT ENGINE ══
  // ═══════════════════════════════════════════

  // Optimal audio constraints for gaming voice
  var VOICE_CONSTRAINTS = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
    },
    video: false,
  };

  async function joinVoice() {
    if (!me.authed || inVoice) return;
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia(VOICE_CONSTRAINTS);
      inVoice = true;
      socket.emit('voice:join');
      updateVoiceUI();
      startSpeakingDetection();
      toast('Joined voice chat');
    } catch (e) {
      toast('Mic access denied');
    }
  }

  function leaveVoice() {
    if (!inVoice) return;
    socket.emit('voice:leave');
    stopSpeakingDetection();
    // Close all voice peer connections
    Object.keys(voicePeers).forEach(function (sid) {
      voicePeers[sid].close();
    });
    voicePeers = {};
    // Stop mic
    if (voiceStream) {
      voiceStream.getTracks().forEach(function (t) { t.stop(); });
      voiceStream = null;
    }
    inVoice = false;
    voiceMuted = false;
    updateVoiceUI();
    // Remove all audio elements
    var container = $id('voiceAudioContainer');
    if (container) container.innerHTML = '';
  }

  function toggleVoiceMute() {
    if (!inVoice || !voiceStream) return;
    voiceMuted = !voiceMuted;
    voiceStream.getAudioTracks().forEach(function (t) { t.enabled = !voiceMuted; });
    updateVoiceUI();
  }

  function togglePTT() {
    pttMode = !pttMode;
    if (pttMode && voiceStream) {
      // Default to muted in PTT mode
      voiceStream.getAudioTracks().forEach(function (t) { t.enabled = false; });
    } else if (!pttMode && voiceStream) {
      voiceStream.getAudioTracks().forEach(function (t) { t.enabled = !voiceMuted; });
    }
    updateVoiceUI();
  }

  function pttDown() {
    if (!pttMode || !inVoice || !voiceStream) return;
    pttActive = true;
    voiceStream.getAudioTracks().forEach(function (t) { t.enabled = true; });
    socket.emit('voice:speaking', true);
    updateVoiceUI();
  }

  function pttUp() {
    if (!pttMode || !inVoice || !voiceStream) return;
    pttActive = false;
    voiceStream.getAudioTracks().forEach(function (t) { t.enabled = false; });
    socket.emit('voice:speaking', false);
    updateVoiceUI();
  }

  // Create audio peer connection to another voice participant
  async function createVoicePeer(targetSocketId, isInitiator) {
    var pc = new RTCPeerConnection(ICE_CONFIG);
    voicePeers[targetSocketId] = pc;

    // Add local mic tracks
    if (voiceStream) {
      voiceStream.getTracks().forEach(function (track) {
        pc.addTrack(track, voiceStream);
      });
    }

    // Receive remote audio
    pc.ontrack = function (event) {
      var audio = document.createElement('audio');
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
      audio.id = 'voice-audio-' + targetSocketId;
      var container = $id('voiceAudioContainer');
      if (container) container.appendChild(audio);
    };

    pc.onicecandidate = function (event) {
      if (event.candidate) {
        socket.emit('voice:ice', {
          candidate: event.candidate,
          targetSocketId: targetSocketId,
        });
      }
    };

    if (isInitiator) {
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('voice:offer', {
        sdp: offer,
        targetSocketId: targetSocketId,
      });
    }

    return pc;
  }

  // Speaking detection via AudioAnalyser
  function startSpeakingDetection() {
    if (!voiceStream) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var source = ctx.createMediaStreamSource(voiceStream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      var data = new Uint8Array(analyser.frequencyBinCount);
      var wasSpeaking = false;

      speakingDetector = setInterval(function () {
        if (!inVoice || voiceMuted || (pttMode && !pttActive)) {
          if (wasSpeaking) { socket.emit('voice:speaking', false); wasSpeaking = false; }
          return;
        }
        analyser.getByteFrequencyData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) sum += data[i];
        var avg = sum / data.length;
        var speaking = avg > 15;
        if (speaking !== wasSpeaking) {
          socket.emit('voice:speaking', speaking);
          wasSpeaking = speaking;
        }
      }, 100);
    } catch (e) { /* AudioContext not supported */ }
  }

  function stopSpeakingDetection() {
    if (speakingDetector) { clearInterval(speakingDetector); speakingDetector = null; }
  }

  // Voice Socket.IO event handlers (called from connectSocket)
  function setupVoiceEvents() {
    // Existing peers when we join
    socket.on('voice:peers', function (peers) {
      peers.forEach(function (p) {
        createVoicePeer(p.socketId, true);
        addVoiceParticipant(p.socketId, p.name);
      });
    });

    // New peer joined voice
    socket.on('voice:peer-joined', function (data) {
      createVoicePeer(data.socketId, false);
      addVoiceParticipant(data.socketId, data.name);
    });

    // Peer left voice
    socket.on('voice:peer-left', function (data) {
      if (voicePeers[data.socketId]) {
        voicePeers[data.socketId].close();
        delete voicePeers[data.socketId];
      }
      removeVoiceParticipant(data.socketId);
      var audioEl = $id('voice-audio-' + data.socketId);
      if (audioEl) audioEl.remove();
    });

    // Incoming offer
    socket.on('voice:offer', async function (data) {
      var pc = voicePeers[data.fromSocketId] || await createVoicePeer(data.fromSocketId, false);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice:answer', { sdp: answer, targetSocketId: data.fromSocketId });
    });

    // Incoming answer
    socket.on('voice:answer', async function (data) {
      var pc = voicePeers[data.fromSocketId];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    });

    // ICE candidates
    socket.on('voice:ice', async function (data) {
      var pc = voicePeers[data.fromSocketId];
      if (pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
      }
    });

    // Speaking indicators
    socket.on('voice:speaking', function (data) {
      var el = $id('voice-user-' + data.socketId);
      if (el) {
        if (data.speaking) el.classList.add('speaking');
        else el.classList.remove('speaking');
      }
    });
  }

  // Voice participant list UI
  function addVoiceParticipant(socketId, name) {
    var list = $id('voiceParticipants');
    if (!list) return;
    var existing = $id('voice-user-' + socketId);
    if (existing) return;
    var el = document.createElement('div');
    el.className = 'voice-user';
    el.id = 'voice-user-' + socketId;
    el.innerHTML = '<span class="voice-dot"></span>' + esc(name);
    list.appendChild(el);
  }

  function removeVoiceParticipant(socketId) {
    var el = $id('voice-user-' + socketId);
    if (el) el.remove();
  }

  // Voice UI update
  function updateVoiceUI() {
    var joinBtn = $id('btnVoiceJoin');
    var leaveBtn = $id('btnVoiceLeave');
    var muteBtn = $id('btnVoiceMute');
    var pttBtn = $id('btnVoicePTT');
    var voiceBar = $id('voiceBar');

    if (!joinBtn) return;

    if (inVoice) {
      joinBtn.classList.add('hidden');
      if (leaveBtn) leaveBtn.classList.remove('hidden');
      if (muteBtn) {
        muteBtn.classList.remove('hidden');
        muteBtn.textContent = voiceMuted ? '\uD83D\uDD07 UNMUTE' : '\uD83D\uDD0A MUTE';
      }
      if (pttBtn) {
        pttBtn.classList.remove('hidden');
        pttBtn.textContent = pttMode ? 'PTT: ON' : 'PTT: OFF';
        if (pttMode) pttBtn.classList.add('active'); else pttBtn.classList.remove('active');
      }
      if (voiceBar) voiceBar.classList.add('active');
    } else {
      joinBtn.classList.remove('hidden');
      if (leaveBtn) leaveBtn.classList.add('hidden');
      if (muteBtn) muteBtn.classList.add('hidden');
      if (pttBtn) pttBtn.classList.add('hidden');
      if (voiceBar) voiceBar.classList.remove('active');
    }
  }

  // PTT keyboard handler (hold V to talk)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'v' || e.key === 'V') {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (!e.repeat) pttDown();
    }
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === 'v' || e.key === 'V') pttUp();
  });

  // Expose voice controls
  window.bcVoice = {
    join: joinVoice,
    leave: leaveVoice,
    mute: toggleVoiceMute,
    ptt: togglePTT,
  };

  document.addEventListener('DOMContentLoaded', init);
})();
