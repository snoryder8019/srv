(function () {
  var socket = window.__bihChatSocket;
  if (!socket) return;

  var overlayContentEl = null;
  var currentChannels = [];
  var joinedChannelId = null;
  var joinedChannelName = null;

  // === Socket events ===

  socket.on('channels-list', function (list) {
    currentChannels = list;
    if (overlayContentEl) renderChannelsList();
  });

  socket.on('channel-created', function (data) {
    joinedChannelId = data.callId;
    joinedChannelName = data.name;
    addChannelTab(data.callId, data.name);
    switchToChannelTab(data.callId);
    // Acquire media and show call overlay — room-joined arrives right after
    if (window.__bihWebRTC && window.__bihWebRTC.prepareCall) {
      window.__bihWebRTC.prepareCall(data.callId, data.callType || 'video').catch(function (err) {
        console.error('Channel media error:', err);
      });
    }
  });

  socket.on('channel-error', function (data) {
    console.warn('Channel error:', data.message);
  });

  socket.on('channel-message', function (data) {
    if (window.__bihChatInjectChannelMessage) {
      window.__bihChatInjectChannelMessage(data.channelId, {
        displayName: data.displayName,
        avatar: data.avatar,
        message: data.text,
        timestamp: data.timestamp
      });
    }
  });

  // When WebRTC call ends (could be a channel), clean up
  socket.on('call-ended', function (data) {
    if (data.callId === joinedChannelId) {
      cleanupJoinedChannel();
    }
  });

  socket.on('room-peer-left', function (data) {
    // If we got kicked from a channel that dissolved, the call-ended handles it
  });

  // === Rendering ===

  function renderChannelsList() {
    if (!overlayContentEl) return;
    overlayContentEl.innerHTML = '';

    // Create row
    var createRow = document.createElement('div');
    createRow.className = 'channels-create-row';

    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Channel name...';
    nameInput.maxLength = 60;

    var createBtn = document.createElement('button');
    createBtn.className = 'channels-create-btn';
    createBtn.textContent = 'CREATE';
    createBtn.type = 'button';

    // Disable if already in a call
    if (window.__bihWebRTC && window.__bihWebRTC.isInCall && window.__bihWebRTC.isInCall()) {
      createBtn.disabled = true;
      createBtn.title = 'Leave your current call first';
    }

    createBtn.addEventListener('click', function () {
      var name = nameInput.value.trim();
      if (!name) return;
      socket.emit('channel-create', { name: name, callType: 'video' });
      nameInput.value = '';
    });

    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        createBtn.click();
      }
    });

    createRow.appendChild(nameInput);
    createRow.appendChild(createBtn);
    overlayContentEl.appendChild(createRow);

    // Channel list
    if (currentChannels.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'shelf-overlay-empty';
      empty.textContent = 'No active channels';
      overlayContentEl.appendChild(empty);
      return;
    }

    var list = document.createElement('div');
    list.className = 'channels-list';

    currentChannels.forEach(function (ch) {
      list.appendChild(buildChannelCard(ch));
    });

    overlayContentEl.appendChild(list);
  }

  function buildChannelCard(ch) {
    var card = document.createElement('div');
    card.className = 'channel-card';
    if (ch.isPrivate) card.classList.add('is-private');

    // Info section
    var info = document.createElement('div');
    info.className = 'channel-card-info';

    var name = document.createElement('div');
    name.className = 'channel-card-name';
    name.textContent = ch.name;

    var host = document.createElement('div');
    host.className = 'channel-card-host';
    host.textContent = 'by ' + ch.creatorName;

    info.appendChild(name);
    info.appendChild(host);
    card.appendChild(info);

    // Participant avatars
    if (ch.participants && ch.participants.length > 0) {
      var avatars = document.createElement('div');
      avatars.className = 'channel-card-avatars';
      var shown = ch.participants.slice(0, 4);
      shown.forEach(function (p) {
        if (p.avatar) {
          var img = document.createElement('img');
          img.src = p.avatar;
          img.className = 'channel-card-avatar';
          avatars.appendChild(img);
        } else {
          var ph = document.createElement('div');
          ph.className = 'channel-card-avatar-placeholder';
          ph.textContent = (p.displayName || '?')[0].toUpperCase();
          avatars.appendChild(ph);
        }
      });
      card.appendChild(avatars);
    }

    // Count
    var count = document.createElement('span');
    count.className = 'channel-card-count';
    count.textContent = ch.participantCount + (ch.participantCount === 1 ? ' user' : ' users');
    card.appendChild(count);

    // Action button
    if (joinedChannelId === ch.callId) {
      var leaveBtn = document.createElement('button');
      leaveBtn.className = 'channel-card-leave';
      leaveBtn.textContent = 'LEAVE';
      leaveBtn.type = 'button';
      leaveBtn.addEventListener('click', function () {
        leaveChannel(ch.callId);
      });
      card.appendChild(leaveBtn);
    } else {
      var joinBtn = document.createElement('button');
      joinBtn.className = 'channel-card-join';
      joinBtn.textContent = 'JOIN';
      joinBtn.type = 'button';

      if (window.__bihWebRTC && window.__bihWebRTC.isInCall && window.__bihWebRTC.isInCall()) {
        joinBtn.disabled = true;
        joinBtn.title = 'Leave your current call first';
        joinBtn.style.opacity = '0.3';
        joinBtn.style.cursor = 'not-allowed';
      }

      joinBtn.addEventListener('click', function () {
        joinChannel(ch);
      });
      card.appendChild(joinBtn);
    }

    return card;
  }

  // === Channel actions ===

  function joinChannel(ch) {
    if (window.__bihWebRTC && window.__bihWebRTC.isInCall && window.__bihWebRTC.isInCall()) return;

    joinedChannelId = ch.callId;
    joinedChannelName = ch.name;

    // Use the existing WebRTC join path
    if (window.__bihWebRTC && window.__bihWebRTC.joinCall) {
      window.__bihWebRTC.joinCall(ch.callId);
    }

    addChannelTab(ch.callId, ch.name);
    switchToChannelTab(ch.callId);
    if (overlayContentEl) renderChannelsList();
  }

  function leaveChannel(channelId) {
    socket.emit('channel-leave', { channelId: channelId });

    // Also hang up the WebRTC call
    if (window.__bihWebRTC && window.__bihWebRTC.hangup) {
      window.__bihWebRTC.hangup();
    }

    cleanupJoinedChannel();
  }

  function cleanupJoinedChannel() {
    var id = joinedChannelId;
    joinedChannelId = null;
    joinedChannelName = null;

    if (id && window.__bihChatRemoveChannelTab) {
      window.__bihChatRemoveChannelTab(id);
    }
    if (overlayContentEl) renderChannelsList();
  }

  // === Chat tab management ===

  function addChannelTab(channelId, name) {
    var chatTabs = document.getElementById('chat-tabs');
    if (!chatTabs) return;
    if (chatTabs.querySelector('[data-tab="' + channelId + '"]')) return;

    var tab = document.createElement('button');
    tab.className = 'chat-tab';
    tab.setAttribute('data-tab', channelId);

    var label = name.length > 12 ? name.substring(0, 10) + '..' : name;
    tab.textContent = label;

    var close = document.createElement('span');
    close.className = 'chat-tab-close';
    close.textContent = '\u00d7';
    close.addEventListener('click', function (e) {
      e.stopPropagation();
      leaveChannel(channelId);
    });
    tab.appendChild(close);
    chatTabs.appendChild(tab);
  }

  function switchToChannelTab(channelId) {
    if (window.__bihChatSwitchTab) window.__bihChatSwitchTab(channelId);
    // Open the chat panel if closed
    var panel = document.getElementById('chat-panel');
    var bubble = document.getElementById('chat-bubble');
    if (panel && !panel.classList.contains('open')) {
      if (bubble) bubble.click();
    }
  }

  // === Public API ===

  window.__bihChannels = {
    open: function (contentEl) {
      overlayContentEl = contentEl;
      socket.emit('channels-request');
      renderChannelsList();
    },
    sendMessage: function (channelId, text) {
      socket.emit('channel-message', { channelId: channelId, text: text });
    },
    join: function (callId) {
      if (window.__bihWebRTC) window.__bihWebRTC.joinCall(callId);
    },
    isInChannel: function () { return !!joinedChannelId; },
    getJoinedChannelId: function () { return joinedChannelId; },
    getJoinedChannelName: function () { return joinedChannelName; }
  };
})();
