(function () {
  var socket = window.__bihChatSocket;
  if (!socket) return;

  // --- STUN/TURN Configuration ---
  var iceConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // --- State ---
  var currentCallId = null;
  var peers = {};          // peerId -> { pc, remoteStream, displayName, avatar, tileEl }
  var localStream = null;
  var callType = 'voice';
  var audioMuted = false;
  var videoEnabled = false;
  var callTimer = null;
  var callSeconds = 0;

  // --- DOM References ---
  var callOverlay, callStatus, callDuration;
  var peersGrid, localVideo;
  var btnMute, btnVideo, btnScreen, btnHangup;
  var incomingOverlay, incomingCaller, incomingType;
  var btnAccept, btnDecline;

  // --- Ringtone state ---
  var ringCtx = null, ringOsc = null, ringGain = null, ringInterval = null;
  var inRingCtx = null, inRingOsc = null, inRingGain = null, inRingInterval = null;

  // --- Init DOM refs on load ---
  document.addEventListener('DOMContentLoaded', function () {
    callOverlay = document.getElementById('call-overlay');
    callStatus = document.getElementById('call-status');
    callDuration = document.getElementById('call-duration');
    peersGrid = document.getElementById('call-peers-grid');
    localVideo = document.getElementById('call-local-video');
    btnMute = document.getElementById('call-mute');
    btnVideo = document.getElementById('call-video-toggle');
    btnScreen = document.getElementById('call-screen');
    btnHangup = document.getElementById('call-hangup');
    incomingOverlay = document.getElementById('call-incoming-overlay');
    incomingCaller = document.getElementById('call-incoming-caller');
    incomingType = document.getElementById('call-incoming-type');
    btnAccept = document.getElementById('call-accept');
    btnDecline = document.getElementById('call-decline');

    if (btnMute) btnMute.addEventListener('click', toggleMute);
    if (btnVideo) btnVideo.addEventListener('click', toggleVideo);
    if (btnScreen) btnScreen.addEventListener('click', startScreenShare);
    if (btnHangup) btnHangup.addEventListener('click', function () { hangup(); });
    if (btnAccept) btnAccept.addEventListener('click', acceptCall);
    if (btnDecline) btnDecline.addEventListener('click', rejectCall);

    // Wire up existing chat voice button
    var voiceBtn = document.getElementById('chat-voice');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (currentCallId) { hangup(); return; }
        voiceBtn.classList.toggle('active');
        document.body.classList.toggle('call-pick-mode');
      });
    }
  });

  // ==================== CALL INITIATION ====================

  function initCall(targetUserId, type) {
    if (currentCallId) return;
    callType = type || 'voice';
    socket.emit('call-request', { targetUserId: targetUserId, callType: callType });
    document.body.classList.remove('call-pick-mode');
    var voiceBtn = document.getElementById('chat-voice');
    if (voiceBtn) voiceBtn.classList.remove('active');
  }

  function joinCall(callId) {
    if (currentCallId) return;
    currentCallId = callId;
    // Get media first, then join
    getLocalMedia('voice').then(function () {
      socket.emit('call-join', { callId: callId });
      showCallOverlay('connecting');
      startCallTimer();
    }).catch(function () {
      currentCallId = null;
      socket.emit('call-error', { message: 'Microphone access denied' });
    });
  }

  // ==================== PEER CONNECTION (per-peer) ====================

  function setupPeerConnection(peerId) {
    var pc = new RTCPeerConnection(iceConfig);

    pc.onicecandidate = function (event) {
      if (event.candidate && currentCallId) {
        socket.emit('webrtc-ice', { callId: currentCallId, targetUserId: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = function (event) {
      var peer = peers[peerId];
      if (!peer) return;
      peer.remoteStream = event.streams[0];
      // Update the tile's audio/video
      if (peer.tileEl) {
        var audioEl = peer.tileEl.querySelector('audio');
        if (audioEl) audioEl.srcObject = peer.remoteStream;
        var videoEl = peer.tileEl.querySelector('video');
        if (videoEl) {
          videoEl.srcObject = peer.remoteStream;
          var hasVideo = peer.remoteStream.getVideoTracks().length > 0;
          videoEl.style.display = hasVideo ? 'block' : 'none';
        }
      }
    };

    pc.onconnectionstatechange = function () {
      var state = pc.connectionState;
      if (state === 'connected') {
        if (callStatus) callStatus.textContent = '[ connected ]';
      }
      if (state === 'failed') {
        removePeer(peerId);
      }
    };

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(function (track) {
        pc.addTrack(track, localStream);
      });
    }

    return pc;
  }

  // ==================== PEER TILE DOM ====================

  function createPeerTile(peerId, displayName, avatar) {
    if (!peersGrid) return null;
    var tile = document.createElement('div');
    tile.classList.add('call-peer-tile');
    tile.dataset.peerId = peerId;

    // Avatar or placeholder
    if (avatar) {
      var img = document.createElement('img');
      img.src = avatar;
      img.classList.add('call-tile-avatar');
      tile.appendChild(img);
    } else {
      var placeholder = document.createElement('div');
      placeholder.classList.add('call-tile-placeholder');
      placeholder.textContent = (displayName || '?').charAt(0).toUpperCase();
      tile.appendChild(placeholder);
    }

    // Name label
    var nameEl = document.createElement('div');
    nameEl.classList.add('call-tile-name');
    nameEl.textContent = displayName || 'Unknown';
    tile.appendChild(nameEl);

    // Audio element (always present for voice)
    var audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    tile.appendChild(audioEl);

    // Video element (hidden by default)
    var videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.style.display = 'none';
    tile.appendChild(videoEl);

    // Audio wave bars
    var waveContainer = document.createElement('div');
    waveContainer.classList.add('call-tile-waves');
    for (var i = 0; i < 3; i++) {
      var bar = document.createElement('div');
      bar.classList.add('call-audio-wave');
      waveContainer.appendChild(bar);
    }
    tile.appendChild(waveContainer);

    peersGrid.appendChild(tile);
    updateGridLayout();
    return tile;
  }

  function removePeerTile(peerId) {
    if (!peersGrid) return;
    var tile = peersGrid.querySelector('[data-peer-id="' + peerId + '"]');
    if (tile) tile.remove();
    updateGridLayout();
  }

  function updateGridLayout() {
    if (!peersGrid) return;
    var count = peersGrid.children.length;
    peersGrid.classList.remove('peers-2', 'peers-3', 'peers-many');
    if (count === 2) peersGrid.classList.add('peers-2');
    else if (count === 3) peersGrid.classList.add('peers-3');
    else if (count >= 4) peersGrid.classList.add('peers-many');

    // Widen call container for 2+ peers
    var container = document.getElementById('call-container');
    if (container) {
      container.classList.toggle('multi-peer', count >= 2);
    }
  }

  // ==================== ADD / REMOVE PEER ====================

  function addPeer(peerId, displayName, avatar, shouldOffer) {
    if (peers[peerId]) return; // already connected

    var pc = setupPeerConnection(peerId);
    var tileEl = createPeerTile(peerId, displayName, avatar);

    peers[peerId] = {
      pc: pc,
      remoteStream: null,
      displayName: displayName,
      avatar: avatar,
      tileEl: tileEl
    };

    if (shouldOffer) {
      // We are the offerer for this peer
      pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer);
      }).then(function () {
        socket.emit('webrtc-offer', {
          callId: currentCallId,
          targetUserId: peerId,
          sdp: pc.localDescription
        });
      }).catch(function (err) {
        console.error('Offer to ' + peerId + ' failed:', err);
      });
    }
  }

  function removePeer(peerId) {
    var peer = peers[peerId];
    if (!peer) return;
    if (peer.pc) { try { peer.pc.close(); } catch (e) {} }
    removePeerTile(peerId);
    delete peers[peerId];
  }

  // ==================== MEDIA ====================

  function getLocalMedia(type) {
    var constraints = { audio: true };
    if (type === 'video') {
      constraints.video = { width: { ideal: 320 }, height: { ideal: 240 } };
    }
    return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      localStream = stream;
      if (localVideo && type === 'video') {
        localVideo.srcObject = stream;
        localVideo.style.display = 'block';
      }
      return stream;
    });
  }

  function toggleMute() {
    if (!localStream) return;
    audioMuted = !audioMuted;
    localStream.getAudioTracks().forEach(function (t) { t.enabled = !audioMuted; });
    if (btnMute) btnMute.classList.toggle('muted', audioMuted);
    if (currentCallId) {
      socket.emit('call-toggle-media', { callId: currentCallId, kind: 'audio', enabled: !audioMuted });
    }
  }

  function toggleVideo() {
    if (!localStream) return;
    var videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      videoEnabled = !videoEnabled;
      videoTracks.forEach(function (t) { t.enabled = videoEnabled; });
      if (localVideo) localVideo.style.display = videoEnabled ? 'block' : 'none';
      if (btnVideo) btnVideo.classList.toggle('active', videoEnabled);
    } else {
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 } } })
        .then(function (vidStream) {
          var vidTrack = vidStream.getVideoTracks()[0];
          localStream.addTrack(vidTrack);
          // Add to ALL peer connections
          Object.keys(peers).forEach(function (pid) {
            var peer = peers[pid];
            if (peer.pc) {
              peer.pc.addTrack(vidTrack, localStream);
              // Renegotiate with this peer
              peer.pc.createOffer().then(function (offer) {
                return peer.pc.setLocalDescription(offer);
              }).then(function () {
                socket.emit('webrtc-offer', { callId: currentCallId, targetUserId: pid, sdp: peer.pc.localDescription });
              });
            }
          });
          videoEnabled = true;
          if (localVideo) { localVideo.srcObject = localStream; localVideo.style.display = 'block'; }
          if (btnVideo) btnVideo.classList.add('active');
        }).catch(function () { /* camera denied */ });
    }
    if (currentCallId) {
      socket.emit('call-toggle-media', { callId: currentCallId, kind: 'video', enabled: videoEnabled });
    }
  }

  function startScreenShare() {
    if (Object.keys(peers).length === 0) return;
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(function (screenStream) {
      var screenTrack = screenStream.getVideoTracks()[0];
      // Replace video track on ALL peer connections
      Object.keys(peers).forEach(function (pid) {
        var peer = peers[pid];
        if (!peer.pc) return;
        var sender = peer.pc.getSenders().find(function (s) {
          return s.track && s.track.kind === 'video';
        });
        if (sender) {
          sender.replaceTrack(screenTrack);
        } else {
          peer.pc.addTrack(screenTrack, localStream || screenStream);
          peer.pc.createOffer().then(function (offer) {
            return peer.pc.setLocalDescription(offer);
          }).then(function () {
            socket.emit('webrtc-offer', { callId: currentCallId, targetUserId: pid, sdp: peer.pc.localDescription });
          });
        }
      });
      if (localVideo) { localVideo.srcObject = screenStream; localVideo.style.display = 'block'; }
      if (btnScreen) btnScreen.classList.add('active');

      screenTrack.onended = function () {
        var camTrack = localStream ? localStream.getVideoTracks()[0] : null;
        Object.keys(peers).forEach(function (pid) {
          var peer = peers[pid];
          if (!peer.pc) return;
          var sender = peer.pc.getSenders().find(function (s) {
            return s.track && s.track.kind === 'video';
          });
          if (sender && camTrack) sender.replaceTrack(camTrack);
        });
        if (localVideo && localStream) localVideo.srcObject = localStream;
        if (btnScreen) btnScreen.classList.remove('active');
      };
    }).catch(function () { /* user cancelled */ });
  }

  // ==================== SDP NEGOTIATION (per-peer) ====================

  function handleOffer(fromUserId, sdp) {
    var peer = peers[fromUserId];
    if (!peer || !peer.pc) return;
    peer.pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function () {
      return peer.pc.createAnswer();
    }).then(function (answer) {
      return peer.pc.setLocalDescription(answer);
    }).then(function () {
      socket.emit('webrtc-answer', { callId: currentCallId, targetUserId: fromUserId, sdp: peer.pc.localDescription });
    }).catch(function (err) {
      console.error('Answer to ' + fromUserId + ' failed:', err);
    });
  }

  function handleAnswer(fromUserId, sdp) {
    var peer = peers[fromUserId];
    if (!peer || !peer.pc) return;
    peer.pc.setRemoteDescription(new RTCSessionDescription(sdp))
      .catch(function (err) { console.error('Set remote desc from ' + fromUserId + ' failed:', err); });
  }

  function handleIceCandidate(fromUserId, candidate) {
    var peer = peers[fromUserId];
    if (peer && peer.pc && candidate) {
      peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(function () {});
    }
  }

  // ==================== CALL LIFECYCLE ====================

  function acceptCall() {
    stopIncomingRing();
    hideIncomingOverlay();
    socket.emit('call-accept', { callId: currentCallId });
    getLocalMedia(callType).then(function () {
      showCallOverlay('active');
      startCallTimer();
    }).catch(function () {
      socket.emit('call-reject', { callId: currentCallId });
      cleanup();
    });
  }

  function rejectCall() {
    stopIncomingRing();
    socket.emit('call-reject', { callId: currentCallId });
    cleanup();
  }

  function hangup() {
    if (currentCallId) {
      socket.emit('call-hangup', { callId: currentCallId });
    }
    cleanup();
  }

  function cleanup() {
    // Close all peer connections
    Object.keys(peers).forEach(function (pid) {
      var peer = peers[pid];
      if (peer.pc) { try { peer.pc.close(); } catch (e) {} }
    });
    peers = {};
    if (peersGrid) peersGrid.innerHTML = '';
    if (localStream) {
      localStream.getTracks().forEach(function (t) { t.stop(); });
      localStream = null;
    }
    currentCallId = null;
    audioMuted = false;
    videoEnabled = false;
    if (callTimer) { clearInterval(callTimer); callTimer = null; }
    callSeconds = 0;
    stopRingTone();
    stopIncomingRing();
    hideCallOverlay();
    hideIncomingOverlay();
    if (btnMute) btnMute.classList.remove('muted');
    if (btnVideo) btnVideo.classList.remove('active');
    if (btnScreen) btnScreen.classList.remove('active');
    if (localVideo) { localVideo.srcObject = null; localVideo.style.display = 'none'; }
  }

  // ==================== UI ====================

  function showCallOverlay(state) {
    if (!callOverlay) return;
    callOverlay.style.display = 'flex';
    callOverlay.dataset.state = state;
    if (state === 'ringing') {
      if (callStatus) callStatus.textContent = '[ calling... ]';
      if (callDuration) callDuration.textContent = '';
    } else if (state === 'connecting') {
      if (callStatus) callStatus.textContent = '[ connecting... ]';
    } else if (state === 'active') {
      if (callStatus) callStatus.textContent = '[ in call ]';
    }
  }

  function hideCallOverlay() {
    if (callOverlay) {
      callOverlay.style.display = 'none';
      callOverlay.dataset.state = 'idle';
    }
    if (callDuration) callDuration.textContent = '';
  }

  function showIncomingOverlay(callerName, callerAvatar, type) {
    if (!incomingOverlay) return;
    incomingOverlay.style.display = 'flex';
    if (incomingCaller) incomingCaller.textContent = callerName || 'Unknown';
    if (incomingType) incomingType.textContent = type === 'video' ? '[ video call ]' : '[ voice call ]';
  }

  function hideIncomingOverlay() {
    if (incomingOverlay) incomingOverlay.style.display = 'none';
  }

  // ==================== CALL TIMER ====================

  function startCallTimer() {
    callSeconds = 0;
    callTimer = setInterval(function () {
      callSeconds++;
      var mins = Math.floor(callSeconds / 60);
      var secs = callSeconds % 60;
      if (callDuration) {
        callDuration.textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
      }
    }, 1000);
  }

  // ==================== RINGTONES (Web Audio API) ====================

  function playRingTone() {
    try {
      ringCtx = new (window.AudioContext || window.webkitAudioContext)();
      ringGain = ringCtx.createGain();
      ringGain.connect(ringCtx.destination);
      ringGain.gain.setValueAtTime(0, ringCtx.currentTime);
      ringOsc = ringCtx.createOscillator();
      ringOsc.connect(ringGain);
      ringOsc.type = 'sine';
      ringOsc.frequency.setValueAtTime(440, ringCtx.currentTime);
      ringOsc.start();
      var on = true;
      ringInterval = setInterval(function () {
        if (!ringCtx) return;
        var t = ringCtx.currentTime;
        if (on) {
          ringGain.gain.setTargetAtTime(0.06, t, 0.02);
          ringOsc.frequency.setValueAtTime(440, t);
          ringOsc.frequency.setValueAtTime(480, t + 0.25);
        } else {
          ringGain.gain.setTargetAtTime(0, t, 0.02);
        }
        on = !on;
      }, 400);
    } catch (e) {}
  }

  function stopRingTone() {
    if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
    try { if (ringOsc) ringOsc.stop(); } catch (e) {}
    try { if (ringCtx) ringCtx.close(); } catch (e) {}
    ringOsc = null; ringGain = null; ringCtx = null;
  }

  function playIncomingRing() {
    try {
      inRingCtx = new (window.AudioContext || window.webkitAudioContext)();
      inRingGain = inRingCtx.createGain();
      inRingGain.connect(inRingCtx.destination);
      inRingGain.gain.setValueAtTime(0, inRingCtx.currentTime);
      inRingOsc = inRingCtx.createOscillator();
      inRingOsc.connect(inRingGain);
      inRingOsc.type = 'sine';
      inRingOsc.frequency.setValueAtTime(660, inRingCtx.currentTime);
      inRingOsc.start();
      var on = true;
      inRingInterval = setInterval(function () {
        if (!inRingCtx) return;
        var t = inRingCtx.currentTime;
        if (on) {
          inRingGain.gain.setTargetAtTime(0.08, t, 0.02);
          inRingOsc.frequency.setValueAtTime(660, t);
          inRingOsc.frequency.setValueAtTime(880, t + 0.15);
        } else {
          inRingGain.gain.setTargetAtTime(0, t, 0.02);
        }
        on = !on;
      }, 350);
    } catch (e) {}
  }

  function stopIncomingRing() {
    if (inRingInterval) { clearInterval(inRingInterval); inRingInterval = null; }
    try { if (inRingOsc) inRingOsc.stop(); } catch (e) {}
    try { if (inRingCtx) inRingCtx.close(); } catch (e) {}
    inRingOsc = null; inRingGain = null; inRingCtx = null;
  }

  // ==================== SOCKET EVENT HANDLERS ====================

  // Caller: ring started
  socket.on('call-ringing', function (data) {
    currentCallId = data.callId;
    showCallOverlay('ringing');
    playRingTone();
  });

  // Callee: incoming call
  socket.on('call-incoming', function (data) {
    if (currentCallId) return;
    currentCallId = data.callId;
    callType = data.callType;
    showIncomingOverlay(data.callerName, data.callerAvatar, data.callType);
    playIncomingRing();
  });

  // Caller: callee accepted — create offer for the callee
  socket.on('call-accepted', function (data) {
    if (data.callId !== currentCallId) return;
    stopRingTone();
    showCallOverlay('connecting');
    getLocalMedia(callType).then(function () {
      showCallOverlay('active');
      // Add the callee as a peer and send an offer
      addPeer(data.peerId, data.peerName, data.peerAvatar, true);
      startCallTimer();
    }).catch(function () {
      hangup();
    });
  });

  // Callee / joiner: received the list of existing peers in the room
  socket.on('room-joined', function (data) {
    if (data.callId !== currentCallId) return;
    callType = data.callType || 'voice';
    showCallOverlay('active');
    // Add each existing peer — they will send us offers, so we wait (shouldOffer=false)
    data.peers.forEach(function (p) {
      addPeer(p.userId, p.displayName, p.avatar, false);
    });
  });

  // Existing participant: a new peer joined the room — send them an offer
  socket.on('room-peer-joined', function (data) {
    if (data.callId !== currentCallId) return;
    addPeer(data.peerId, data.peerName, data.peerAvatar, true);
  });

  // A peer left the room
  socket.on('room-peer-left', function (data) {
    if (data.callId !== currentCallId) return;
    removePeer(data.peerId);
  });

  // Receive SDP offer from a specific peer
  socket.on('webrtc-offer', function (data) {
    if (data.callId !== currentCallId) return;
    // Ensure this peer exists in our peers map
    if (!peers[data.fromUserId]) {
      // Peer might not be added yet (race condition), add with unknown info
      addPeer(data.fromUserId, 'Peer', null, false);
    }
    handleOffer(data.fromUserId, data.sdp);
  });

  // Receive SDP answer from a specific peer
  socket.on('webrtc-answer', function (data) {
    if (data.callId !== currentCallId) return;
    handleAnswer(data.fromUserId, data.sdp);
  });

  // Receive ICE candidate from a specific peer
  socket.on('webrtc-ice', function (data) {
    if (data.callId !== currentCallId) return;
    handleIceCandidate(data.fromUserId, data.candidate);
  });

  // Call rejected by callee
  socket.on('call-rejected', function (data) {
    if (data.callId !== currentCallId) return;
    stopRingTone();
    cleanup();
  });

  // Call ended (last peer left or disconnect)
  socket.on('call-ended', function (data) {
    if (data.callId !== currentCallId) return;
    cleanup();
  });

  // Call timed out
  socket.on('call-timeout', function (data) {
    if (data.callId !== currentCallId) return;
    stopRingTone();
    stopIncomingRing();
    cleanup();
  });

  // Call dismissed (answered on another tab)
  socket.on('call-dismissed', function (data) {
    if (data.callId !== currentCallId) return;
    stopIncomingRing();
    cleanup();
  });

  // Remote peer toggled media
  socket.on('call-media-toggled', function (data) {
    if (data.callId !== currentCallId) return;
    var peer = peers[data.userId];
    if (!peer || !peer.tileEl) return;
    if (data.kind === 'video') {
      var videoEl = peer.tileEl.querySelector('video');
      if (videoEl) videoEl.style.display = data.enabled ? 'block' : 'none';
    }
  });

  // Call error
  socket.on('call-error', function (data) {
    console.warn('Call error:', data.message);
    cleanup();
  });

  // ==================== PUBLIC API ====================

  window.__bihWebRTC = {
    call: initCall,
    joinCall: joinCall,
    hangup: hangup,
    toggleMute: toggleMute,
    toggleVideo: toggleVideo,
    screenShare: startScreenShare,
    isInCall: function () { return !!currentCallId; },
    getCurrentCallId: function () { return currentCallId; }
  };
})();
