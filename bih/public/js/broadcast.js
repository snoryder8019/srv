(function () {
  var socket = window.__bihChatSocket;
  if (!socket) return;

  var iceConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // --- State ---
  var isBroadcasting = false;
  var isWatching = false;
  var localStream = null;
  var viewerPeers = {};   // broadcaster side: viewerId -> { pc, socketId }
  var broadcasterPC = null; // viewer side: single pc to broadcaster

  // --- DOM refs ---
  var goLiveBtn, btnLabel, tvFrame, tvBezel, tvScreen, tvVideo, tvStatic, tvHost, viewerCount;

  document.addEventListener('DOMContentLoaded', function () {
    goLiveBtn = document.getElementById('broadcast-go-live');
    btnLabel = document.getElementById('broadcast-btn-label');
    tvFrame = document.getElementById('broadcast-tv');
    tvBezel = document.getElementById('broadcast-tv-bezel');
    tvScreen = document.getElementById('broadcast-tv-screen');
    tvVideo = document.getElementById('broadcast-video');
    tvStatic = document.getElementById('broadcast-tv-static');
    tvHost = document.getElementById('broadcast-tv-host');
    viewerCount = document.getElementById('broadcast-viewer-count');

    if (goLiveBtn) {
      goLiveBtn.addEventListener('click', function () {
        if (isBroadcasting) {
          stopBroadcast();
        } else {
          startBroadcast();
        }
      });
    }
  });

  // ==================== BROADCASTER SIDE ====================

  function startBroadcast() {
    // Prompt for camera + mic
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    }).then(function (stream) {
      localStream = stream;
      isBroadcasting = true;
      socket.emit('broadcast-start');

      // Show own feed in the TV frame
      showTV();
      tvVideo.srcObject = stream;
      tvScreen.classList.add('has-video');
      if (tvBezel) tvBezel.classList.add('is-live');
      if (tvHost) tvHost.textContent = 'YOU';

      if (goLiveBtn) goLiveBtn.classList.add('is-live');
      if (btnLabel) btnLabel.textContent = 'END BROADCAST';
      updateViewerCount();
    }).catch(function (err) {
      console.error('Broadcast media error:', err);
    });
  }

  function stopBroadcast() {
    socket.emit('broadcast-stop');
    cleanupBroadcaster();
  }

  function cleanupBroadcaster() {
    isBroadcasting = false;
    // Close all viewer peer connections
    Object.keys(viewerPeers).forEach(function (vid) {
      if (viewerPeers[vid].pc) {
        try { viewerPeers[vid].pc.close(); } catch (e) {}
      }
    });
    viewerPeers = {};
    if (localStream) {
      localStream.getTracks().forEach(function (t) { t.stop(); });
      localStream = null;
    }
    if (tvVideo) tvVideo.srcObject = null;
    if (tvScreen) tvScreen.classList.remove('has-video');
    if (tvBezel) tvBezel.classList.remove('is-live');
    hideTV();
    if (goLiveBtn) goLiveBtn.classList.remove('is-live');
    if (btnLabel) btnLabel.textContent = 'GO LIVE';
  }

  // Broadcaster: a new viewer joined, create a peer connection and send offer
  socket.on('broadcast-viewer-joined', function (data) {
    if (!isBroadcasting || !localStream) return;
    var viewerId = data.viewerId;
    var viewerSocketId = data.viewerSocketId;

    var pc = new RTCPeerConnection(iceConfig);

    pc.onicecandidate = function (event) {
      if (event.candidate) {
        socket.emit('broadcast-ice', { targetSocketId: viewerSocketId, candidate: event.candidate });
      }
    };

    // Add local tracks
    localStream.getTracks().forEach(function (track) {
      pc.addTrack(track, localStream);
    });

    viewerPeers[viewerId] = { pc: pc, socketId: viewerSocketId };

    // Create and send offer
    pc.createOffer().then(function (offer) {
      return pc.setLocalDescription(offer);
    }).then(function () {
      socket.emit('broadcast-offer', { targetSocketId: viewerSocketId, sdp: pc.localDescription });
    }).catch(function (err) {
      console.error('Broadcast offer error:', err);
    });

    updateViewerCount();
  });

  // Broadcaster: viewer left
  socket.on('broadcast-viewer-left', function (data) {
    var peer = viewerPeers[data.viewerId];
    if (peer && peer.pc) {
      try { peer.pc.close(); } catch (e) {}
    }
    delete viewerPeers[data.viewerId];
    updateViewerCount();
  });

  // Broadcaster: receive answer from viewer
  socket.on('broadcast-answer', function (data) {
    var peer = viewerPeers[data.fromViewerId];
    if (peer && peer.pc) {
      peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(function (err) {
        console.error('Set remote desc from viewer failed:', err);
      });
    }
  });

  // ==================== VIEWER SIDE ====================

  function watchBroadcast() {
    if (isWatching || isBroadcasting) return;
    isWatching = true;
    socket.emit('broadcast-watch');
  }

  function stopWatching() {
    if (!isWatching) return;
    isWatching = false;
    socket.emit('broadcast-leave');
    cleanupViewer();
  }

  function cleanupViewer() {
    isWatching = false;
    if (broadcasterPC) {
      try { broadcasterPC.close(); } catch (e) {}
      broadcasterPC = null;
    }
    if (tvVideo) tvVideo.srcObject = null;
    if (tvScreen) tvScreen.classList.remove('has-video');
  }

  // Viewer: receive offer from broadcaster
  socket.on('broadcast-offer', function (data) {
    if (isBroadcasting) return; // broadcaster ignores own offers

    broadcasterPC = new RTCPeerConnection(iceConfig);

    broadcasterPC.onicecandidate = function (event) {
      if (event.candidate) {
        socket.emit('broadcast-ice', { targetSocketId: null, candidate: event.candidate });
      }
    };

    broadcasterPC.ontrack = function (event) {
      if (tvVideo) {
        tvVideo.srcObject = event.streams[0];
        if (tvScreen) tvScreen.classList.add('has-video');
      }
    };

    broadcasterPC.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function () {
      return broadcasterPC.createAnswer();
    }).then(function (answer) {
      return broadcasterPC.setLocalDescription(answer);
    }).then(function () {
      socket.emit('broadcast-answer', { sdp: broadcasterPC.localDescription });
    }).catch(function (err) {
      console.error('Broadcast answer error:', err);
    });
  });

  // ==================== BROADCAST ICE (both sides) ====================

  socket.on('broadcast-ice', function (data) {
    var candidate = data.candidate;
    if (!candidate) return;

    if (isBroadcasting) {
      // Broadcaster receives ICE from a viewer — find which peer by fromId
      // The fromId is the socket.id of the viewer
      Object.keys(viewerPeers).forEach(function (vid) {
        var peer = viewerPeers[vid];
        if (peer.socketId === data.fromId && peer.pc) {
          peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(function () {});
        }
      });
    } else if (isWatching && broadcasterPC) {
      // Viewer receives ICE from broadcaster
      broadcasterPC.addIceCandidate(new RTCIceCandidate(candidate)).catch(function () {});
    }
  });

  // ==================== BROADCAST LIFECYCLE EVENTS ====================

  // A broadcast just went live
  socket.on('broadcast-live', function (data) {
    if (isBroadcasting) return; // broadcaster already has it set up
    showTV();
    if (tvBezel) tvBezel.classList.add('is-live');
    if (tvHost) tvHost.textContent = data.broadcasterName || 'Unknown';
    // Auto-watch
    watchBroadcast();
  });

  // Broadcast ended
  socket.on('broadcast-ended', function () {
    cleanupViewer();
    if (tvBezel) tvBezel.classList.remove('is-live');
    showStatic('Broadcast ended');
  });

  socket.on('broadcast-offline', function () {
    if (!isBroadcasting) {
      cleanupViewer();
      if (tvBezel) tvBezel.classList.remove('is-live');
      showStatic('NO SIGNAL');
    }
  });

  socket.on('broadcast-error', function (data) {
    console.warn('Broadcast error:', data.message);
  });

  // ==================== UI HELPERS ====================

  function showTV() {
    if (tvFrame) tvFrame.style.display = 'block';
  }

  function hideTV() {
    if (tvFrame) tvFrame.style.display = 'none';
  }

  function showStatic(msg) {
    showTV();
    if (tvScreen) tvScreen.classList.remove('has-video');
    var staticText = tvStatic ? tvStatic.querySelector('.static-text') : null;
    if (staticText) staticText.textContent = msg || 'NO SIGNAL';
  }

  function updateViewerCount() {
    var count = Object.keys(viewerPeers).length;
    if (viewerCount) viewerCount.textContent = count + ' watching';
  }
})();
