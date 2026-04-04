(function () {
  // --- ICE Configuration ---
  var iceConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // --- State ---
  var socket = null;
  var token = null;
  var localStream = null;
  var peers = {};         // peerId -> { pc, remoteStream, displayName, isHost, tileEl }
  var audioMuted = false;
  var videoEnabled = false;
  var screenSharing = false;
  var callTimer = null;
  var callSeconds = 0;
  var previewStream = null;
  var inCall = false;

  // --- Audio level monitoring ---
  var audioContext = null;
  var audioAnalyser = null;
  var audioLevelRAF = null;

  // --- DOM refs ---
  var prejoin, incall, peersGrid, localVideo, localPip;
  var nameInput, joinBtn, previewVideo, previewPlaceholder;
  var ctrlMic, ctrlCam, ctrlScreen, ctrlLeave;
  var callStatus, callDuration, errorToast;
  var preMic, preCam;

  // ==================== INIT ====================

  var tenantDb = '';

  function init(meetingToken, dbName) {
    token = meetingToken;
    tenantDb = dbName || '';

    // DOM
    prejoin = document.getElementById('prejoin');
    incall = document.getElementById('incall');
    peersGrid = document.getElementById('peers-grid');
    localVideo = document.getElementById('local-video');
    localPip = document.getElementById('local-pip');
    nameInput = document.getElementById('name-input');
    joinBtn = document.getElementById('join-btn');
    previewVideo = document.getElementById('preview-video');
    previewPlaceholder = document.getElementById('preview-placeholder');
    ctrlMic = document.getElementById('ctrl-mic');
    ctrlCam = document.getElementById('ctrl-cam');
    ctrlScreen = document.getElementById('ctrl-screen');
    ctrlLeave = document.getElementById('ctrl-leave');
    callStatus = document.getElementById('call-status');
    callDuration = document.getElementById('call-duration');
    errorToast = document.getElementById('error-toast');
    preMic = document.getElementById('pre-mic');
    preCam = document.getElementById('pre-cam');

    // Pre-join controls
    if (preMic) preMic.addEventListener('click', togglePreMic);
    if (preCam) preCam.addEventListener('click', togglePreCam);
    if (joinBtn) joinBtn.addEventListener('click', joinMeeting);
    if (nameInput) {
      nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') joinMeeting();
      });
    }

    // In-call controls
    if (ctrlMic) ctrlMic.addEventListener('click', toggleMute);
    if (ctrlCam) ctrlCam.addEventListener('click', toggleVideo);
    if (ctrlScreen) ctrlScreen.addEventListener('click', startScreenShare);
    if (ctrlLeave) ctrlLeave.addEventListener('click', leaveMeeting);

    // Prevent accidental reload/navigation while in a meeting
    window.addEventListener('beforeunload', function (e) {
      if (inCall) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Start preview
    startPreview();
  }

  // ==================== PREVIEW ====================

  function startPreview() {
    navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 320 }, height: { ideal: 240 } } })
      .then(function (stream) {
        previewStream = stream;
        if (previewVideo) {
          previewVideo.srcObject = stream;
          previewVideo.style.display = 'block';
        }
        if (previewPlaceholder) previewPlaceholder.style.display = 'none';
        videoEnabled = true;
        audioMuted = false;
      })
      .catch(function () {
        // Try audio only
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(function (stream) {
            previewStream = stream;
            audioMuted = false;
          })
          .catch(function () {
            // No media at all — still allow joining
          });
      });
  }

  function togglePreMic() {
    if (!previewStream) return;
    audioMuted = !audioMuted;
    previewStream.getAudioTracks().forEach(function (t) { t.enabled = !audioMuted; });
    if (preMic) preMic.classList.toggle('off', audioMuted);
  }

  function togglePreCam() {
    if (!previewStream) {
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 } } })
        .then(function (stream) {
          if (!previewStream) {
            previewStream = stream;
          } else {
            stream.getVideoTracks().forEach(function (t) { previewStream.addTrack(t); });
          }
          if (previewVideo) {
            previewVideo.srcObject = previewStream;
            previewVideo.style.display = 'block';
          }
          if (previewPlaceholder) previewPlaceholder.style.display = 'none';
          videoEnabled = true;
          if (preCam) preCam.classList.remove('off');
        })
        .catch(function () {});
      return;
    }

    var videoTracks = previewStream.getVideoTracks();
    if (videoTracks.length === 0) {
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 } } })
        .then(function (stream) {
          stream.getVideoTracks().forEach(function (t) { previewStream.addTrack(t); });
          if (previewVideo) {
            previewVideo.srcObject = previewStream;
            previewVideo.style.display = 'block';
          }
          if (previewPlaceholder) previewPlaceholder.style.display = 'none';
          videoEnabled = true;
          if (preCam) preCam.classList.remove('off');
        })
        .catch(function () {});
    } else {
      videoEnabled = !videoEnabled;
      videoTracks.forEach(function (t) { t.enabled = videoEnabled; });
      if (previewVideo) previewVideo.style.display = videoEnabled ? 'block' : 'none';
      if (previewPlaceholder) previewPlaceholder.style.display = videoEnabled ? 'none' : 'flex';
      if (preCam) preCam.classList.toggle('off', !videoEnabled);
    }
  }

  // ==================== JOIN ====================

  function joinMeeting() {
    var name = (nameInput ? nameInput.value.trim() : '') || 'Guest';
    if (!name) return;

    joinBtn.disabled = true;
    joinBtn.textContent = 'Connecting...';

    // Use preview stream as local stream
    localStream = previewStream;

    // Ensure audio/video state from preview carries over
    if (localStream) {
      localStream.getAudioTracks().forEach(function (t) { t.enabled = !audioMuted; });
      localStream.getVideoTracks().forEach(function (t) { t.enabled = videoEnabled; });
    }

    // Connect socket
    socket = io('/meetings');

    socket.on('connect', function () {
      socket.emit('join-room', { token: token, displayName: name, db: tenantDb });
    });

    socket.on('room-joined', function (data) {
      inCall = true;

      // Transition to in-call UI
      if (prejoin) prejoin.style.display = 'none';
      if (incall) incall.style.display = 'flex';

      // Show local video
      if (localStream && localVideo) {
        localVideo.srcObject = localStream;
        if (videoEnabled) {
          localPip.style.display = 'block';
        }
      }

      // Update button states
      if (ctrlMic) ctrlMic.classList.toggle('muted', audioMuted);
      if (ctrlCam) ctrlCam.classList.toggle('active', videoEnabled);

      if (callStatus) callStatus.textContent = 'connected';
      startCallTimer();
      startAudioMonitor();

      // Add existing peers (we wait for their offers)
      data.peers.forEach(function (p) {
        addPeer(p.peerId, p.displayName, p.isHost, false);
      });
    });

    socket.on('room-peer-joined', function (data) {
      addPeer(data.peerId, data.displayName, data.isHost, true);
    });

    socket.on('room-peer-left', function (data) {
      removePeer(data.peerId);
    });

    socket.on('webrtc-offer', function (data) {
      if (!peers[data.fromPeerId]) {
        addPeer(data.fromPeerId, 'Peer', false, false);
      }
      handleOffer(data.fromPeerId, data.sdp);
    });

    socket.on('webrtc-answer', function (data) {
      handleAnswer(data.fromPeerId, data.sdp);
    });

    socket.on('webrtc-ice', function (data) {
      handleIceCandidate(data.fromPeerId, data.candidate);
    });

    socket.on('media-toggled', function (data) {
      var peer = peers[data.peerId];
      if (!peer || !peer.tileEl) return;
      if (data.kind === 'video') {
        var videoEl = peer.tileEl.querySelector('video');
        if (videoEl) videoEl.style.display = data.enabled ? 'block' : 'none';
        var placeholder = peer.tileEl.querySelector('.peer-tile-placeholder');
        if (placeholder) placeholder.style.display = data.enabled ? 'none' : 'flex';
      }
    });

    socket.on('room-error', function (data) {
      showError(data.message);
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join Meeting';
    });

    socket.on('disconnect', function () {
      if (callStatus) callStatus.textContent = 'disconnected';
    });
  }

  // ==================== PEER CONNECTION ====================

  function setupPeerConnection(peerId) {
    var pc = new RTCPeerConnection(iceConfig);

    pc.onicecandidate = function (event) {
      if (event.candidate && socket) {
        socket.emit('webrtc-ice', { targetPeerId: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = function (event) {
      var peer = peers[peerId];
      if (!peer) return;
      peer.remoteStream = event.streams[0];
      if (peer.tileEl) {
        var audioEl = peer.tileEl.querySelector('audio');
        if (audioEl) audioEl.srcObject = peer.remoteStream;
        var videoEl = peer.tileEl.querySelector('video');
        if (videoEl) {
          videoEl.srcObject = peer.remoteStream;
          var hasVideo = peer.remoteStream.getVideoTracks().length > 0;
          videoEl.style.display = hasVideo ? 'block' : 'none';
          var placeholder = peer.tileEl.querySelector('.peer-tile-placeholder');
          if (placeholder) placeholder.style.display = hasVideo ? 'none' : 'flex';
        }
      }
    };

    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'connected') {
        if (callStatus) callStatus.textContent = 'connected';
      }
      if (pc.connectionState === 'failed') {
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

  function createPeerTile(peerId, displayName, isHost) {
    if (!peersGrid) return null;
    var tile = document.createElement('div');
    tile.classList.add('peer-tile');
    tile.dataset.peerId = peerId;

    // Placeholder (letter avatar)
    var placeholder = document.createElement('div');
    placeholder.classList.add('peer-tile-placeholder');
    placeholder.textContent = (displayName || '?').charAt(0).toUpperCase();
    tile.appendChild(placeholder);

    // Name label
    var nameEl = document.createElement('div');
    nameEl.classList.add('peer-tile-name');
    nameEl.textContent = displayName || 'Unknown';
    tile.appendChild(nameEl);

    // Host badge
    if (isHost) {
      var hostBadge = document.createElement('div');
      hostBadge.classList.add('peer-tile-host');
      hostBadge.textContent = 'Host';
      tile.appendChild(hostBadge);
    }

    // Audio
    var audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    tile.appendChild(audioEl);

    // Video
    var videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.style.display = 'none';
    tile.appendChild(videoEl);

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
  }

  // ==================== ADD / REMOVE PEER ====================

  function addPeer(peerId, displayName, isHost, shouldOffer) {
    if (peers[peerId]) return;

    var pc = setupPeerConnection(peerId);
    var tileEl = createPeerTile(peerId, displayName, isHost);

    peers[peerId] = {
      pc: pc,
      remoteStream: null,
      displayName: displayName,
      isHost: isHost,
      tileEl: tileEl
    };

    if (shouldOffer) {
      pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer);
      }).then(function () {
        socket.emit('webrtc-offer', {
          targetPeerId: peerId,
          sdp: pc.localDescription
        });
      }).catch(function (err) {
        console.error('Offer to ' + peerId + ' failed:', err);
      });
    }

    // Clean up stale peers that never connect (e.g. from reload race)
    setTimeout(function () {
      var peer = peers[peerId];
      if (peer && peer.pc && (peer.pc.connectionState === 'new' || peer.pc.connectionState === 'connecting')) {
        console.warn('[meeting] Removing stale peer ' + peerId + ' (never connected)');
        removePeer(peerId);
      }
    }, 15000);
  }

  function removePeer(peerId) {
    var peer = peers[peerId];
    if (!peer) return;
    if (peer.pc) { try { peer.pc.close(); } catch (e) {} }
    removePeerTile(peerId);
    delete peers[peerId];
  }

  // ==================== SDP NEGOTIATION ====================

  function handleOffer(fromPeerId, sdp) {
    var peer = peers[fromPeerId];
    if (!peer || !peer.pc) return;
    peer.pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function () {
      return peer.pc.createAnswer();
    }).then(function (answer) {
      return peer.pc.setLocalDescription(answer);
    }).then(function () {
      socket.emit('webrtc-answer', { targetPeerId: fromPeerId, sdp: peer.pc.localDescription });
    }).catch(function (err) {
      console.error('Answer to ' + fromPeerId + ' failed:', err);
    });
  }

  function handleAnswer(fromPeerId, sdp) {
    var peer = peers[fromPeerId];
    if (!peer || !peer.pc) return;
    peer.pc.setRemoteDescription(new RTCSessionDescription(sdp))
      .catch(function (err) { console.error('Set remote desc failed:', err); });
  }

  function handleIceCandidate(fromPeerId, candidate) {
    var peer = peers[fromPeerId];
    if (peer && peer.pc && candidate) {
      peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(function () {});
    }
  }

  // ==================== MEDIA CONTROLS ====================

  function toggleMute() {
    if (!localStream) return;
    audioMuted = !audioMuted;
    localStream.getAudioTracks().forEach(function (t) { t.enabled = !audioMuted; });
    if (ctrlMic) ctrlMic.classList.toggle('muted', audioMuted);
    if (socket) socket.emit('media-toggle', { kind: 'audio', enabled: !audioMuted });
  }

  function toggleVideo() {
    if (!localStream) return;
    var videoTracks = localStream.getVideoTracks();
    if (videoTracks.length > 0) {
      videoEnabled = !videoEnabled;
      videoTracks.forEach(function (t) { t.enabled = videoEnabled; });
      if (localVideo) localVideo.style.display = videoEnabled ? 'block' : 'none';
      if (localPip) localPip.style.display = videoEnabled ? 'block' : 'none';
      if (ctrlCam) ctrlCam.classList.toggle('active', videoEnabled);
    } else {
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 } } })
        .then(function (vidStream) {
          var vidTrack = vidStream.getVideoTracks()[0];
          localStream.addTrack(vidTrack);
          Object.keys(peers).forEach(function (pid) {
            var peer = peers[pid];
            if (peer.pc) {
              peer.pc.addTrack(vidTrack, localStream);
              peer.pc.createOffer().then(function (offer) {
                return peer.pc.setLocalDescription(offer);
              }).then(function () {
                socket.emit('webrtc-offer', { targetPeerId: pid, sdp: peer.pc.localDescription });
              });
            }
          });
          videoEnabled = true;
          if (localVideo) { localVideo.srcObject = localStream; localVideo.style.display = 'block'; }
          if (localPip) localPip.style.display = 'block';
          if (ctrlCam) ctrlCam.classList.add('active');
        }).catch(function () {});
    }
    if (socket) socket.emit('media-toggle', { kind: 'video', enabled: videoEnabled });
  }

  function startScreenShare() {
    if (Object.keys(peers).length === 0) return;
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(function (screenStream) {
      var screenTrack = screenStream.getVideoTracks()[0];
      screenSharing = true;
      if (ctrlScreen) ctrlScreen.classList.add('active');

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
            socket.emit('webrtc-offer', { targetPeerId: pid, sdp: peer.pc.localDescription });
          });
        }
      });

      if (localVideo) { localVideo.srcObject = screenStream; localVideo.style.display = 'block'; }
      if (localPip) localPip.style.display = 'block';

      screenTrack.onended = function () {
        screenSharing = false;
        if (ctrlScreen) ctrlScreen.classList.remove('active');
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
      };
    }).catch(function () {});
  }

  // ==================== AUDIO LEVEL MONITOR ====================

  function startAudioMonitor() {
    if (!localStream || audioContext) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      var source = audioContext.createMediaStreamSource(localStream);
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 256;
      audioAnalyser.smoothingTimeConstant = 0.5;
      source.connect(audioAnalyser);
      var dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);

      function checkLevel() {
        if (!audioAnalyser) return;
        audioAnalyser.getByteFrequencyData(dataArray);
        var sum = 0;
        for (var i = 0; i < dataArray.length; i++) sum += dataArray[i];
        var avg = sum / dataArray.length;
        // Scale: 0-255 avg, threshold ~8 for speech
        if (ctrlMic) {
          if (!audioMuted && avg > 8) {
            ctrlMic.classList.add('mic-active');
          } else {
            ctrlMic.classList.remove('mic-active');
          }
        }
        audioLevelRAF = requestAnimationFrame(checkLevel);
      }
      checkLevel();
    } catch (e) {
      // Web Audio not supported — fail silently
    }
  }

  function stopAudioMonitor() {
    if (audioLevelRAF) { cancelAnimationFrame(audioLevelRAF); audioLevelRAF = null; }
    if (audioContext) { try { audioContext.close(); } catch(e) {} audioContext = null; }
    audioAnalyser = null;
    if (ctrlMic) ctrlMic.classList.remove('mic-active');
  }

  // ==================== LEAVE ====================

  function leaveMeeting() {
    inCall = false;

    // Stop audio monitor and AI notetaker
    stopAudioMonitor();
    stopNotetaker();

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
    if (callTimer) { clearInterval(callTimer); callTimer = null; }
    callSeconds = 0;
    audioMuted = false;
    videoEnabled = false;
    screenSharing = false;
    if (socket) { socket.disconnect(); socket = null; }
    if (localVideo) { localVideo.srcObject = null; }
    if (localPip) localPip.style.display = 'none';

    // Show left message
    if (incall) incall.style.display = 'none';
    if (prejoin) {
      prejoin.innerHTML = '<div class="prejoin-card"><h1>You left the meeting</h1><p style="color:rgba(245,243,239,0.6);margin-top:12px;">You can close this tab.</p></div>';
      prejoin.style.display = 'flex';
    }
  }

  // ==================== TIMER ====================

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

  // ==================== ERROR ====================

  function showError(msg) {
    if (!errorToast) return;
    errorToast.textContent = msg;
    errorToast.style.display = 'block';
    setTimeout(function () { errorToast.style.display = 'none'; }, 5000);
  }

  // ==================== AI NOTETAKER (Web Speech API) ====================

  var recognition = null;
  var notetakerActive = false;
  var transcriptBuffer = '';
  var transcriptFlushTimer = null;
  var FLUSH_INTERVAL = 120000; // 2 minutes
  var MIN_CHUNK_LENGTH = 80;   // minimum chars before sending to AI

  function startNotetaker() {
    // Desktop only — mobile browsers can't reliably run Web Speech API alongside WebRTC
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
      showError('Transcription is available on desktop Chrome or Safari.');
      return false;
    }

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showError('Speech recognition not supported in this browser. Use Chrome or Edge.');
      return false;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = function(event) {
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        var text = result[0].transcript;

        // Broadcast live transcript line to all peers
        if (socket) {
          socket.emit('transcript-line', {
            text: text,
            isFinal: result.isFinal,
          });
        }

        // Buffer final results for AI summarization
        if (result.isFinal) {
          transcriptBuffer += text + ' ';

          // Update local transcript display
          var evt = new CustomEvent('notetaker-transcript', { detail: { text: text, isFinal: true } });
          document.dispatchEvent(evt);
        }
      }
    };

    recognition.onerror = function(event) {
      console.warn('[notetaker] speech error:', event.error);
      if (event.error === 'not-allowed') {
        showError('Microphone access denied for speech recognition.');
        stopNotetaker();
      }
      // auto-restart on network/aborted errors
      if (notetakerActive && (event.error === 'network' || event.error === 'aborted' || event.error === 'no-speech')) {
        setTimeout(function() {
          if (notetakerActive && recognition) {
            try { recognition.start(); } catch(e) {}
          }
        }, 1000);
      }
    };

    recognition.onend = function() {
      // Auto-restart if still active (browser stops after silence)
      if (notetakerActive) {
        setTimeout(function() {
          if (notetakerActive && recognition) {
            try { recognition.start(); } catch(e) {}
          }
        }, 500);
      }
    };

    try {
      recognition.start();
      notetakerActive = true;
    } catch(e) {
      showError('Could not start speech recognition.');
      return false;
    }

    // Set up periodic flush to AI
    transcriptFlushTimer = setInterval(function() {
      flushTranscriptToAI();
    }, FLUSH_INTERVAL);

    return true;
  }


  function stopNotetaker() {
    notetakerActive = false;
    if (recognition) {
      try { recognition.stop(); } catch(e) {}
      recognition = null;
    }
    if (transcriptFlushTimer) {
      clearInterval(transcriptFlushTimer);
      transcriptFlushTimer = null;
    }
    // Flush any remaining buffer
    flushTranscriptToAI();
  }

  function flushTranscriptToAI(force) {
    var chunk = transcriptBuffer.trim();
    transcriptBuffer = '';
    if (!chunk) return;
    if (!force && chunk.length < MIN_CHUNK_LENGTH) return;
    if (!socket) return;
    socket.emit('transcription-chunk', { transcript: chunk });
  }

  function isNotetakerActive() {
    return notetakerActive;
  }

  // ==================== PUBLIC API ====================

  function getSocket() { return socket; }
  function getDisplayName() { return (nameInput ? nameInput.value.trim() : '') || 'Guest'; }

  window.MeetingRTC = {
    init: init,
    getSocket: getSocket,
    getDisplayName: getDisplayName,
    startNotetaker: startNotetaker,
    stopNotetaker: stopNotetaker,
    isNotetakerActive: isNotetakerActive,
    flushTranscriptToAI: flushTranscriptToAI,
  };
})();
