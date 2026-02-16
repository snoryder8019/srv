(function () {
  const socket = window.__bihChatSocket || io('/chat');
  const bubble = document.getElementById('chat-bubble');
  const panel = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const messages = document.getElementById('chat-messages');
  const onlineEl = document.getElementById('chat-online');
  const badge = document.getElementById('chat-badge');

  let isOpen = false;
  let unread = 0;
  let hasMore = false;
  let loadingMore = false;
  let loadMoreEl = null;

  // Generate a short ping tone via Web Audio API
  function playPing() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  }

  // Softer blip for incoming chat messages
  function playBlip() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  var urlRegex = /(https?:\/\/[^\s<]+)/g;
  var pendingPreviews = {}; // url -> array of container elements

  function createMsgEl(data) {
    var div = document.createElement('div');
    div.classList.add('chat-msg');

    // Avatar
    if (data.avatar) {
      var img = document.createElement('img');
      img.src = data.avatar;
      img.classList.add('chat-avatar');
      div.appendChild(img);
    } else {
      var placeholder = document.createElement('div');
      placeholder.classList.add('chat-avatar-placeholder');
      placeholder.textContent = (data.displayName || '?')[0].toUpperCase();
      div.appendChild(placeholder);
    }

    var body = document.createElement('div');
    body.classList.add('chat-msg-body');

    var name = document.createElement('strong');
    name.textContent = data.displayName;

    var text = document.createElement('span');
    // Detect URLs and make them clickable
    var msgText = data.message;
    var urls = msgText.match(urlRegex);
    if (urls) {
      var parts = msgText.split(urlRegex);
      text.textContent = '';
      parts.forEach(function (part) {
        if (urlRegex.test(part)) {
          var a = document.createElement('a');
          a.href = part;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = part;
          a.classList.add('chat-link');
          text.appendChild(a);
        } else {
          text.appendChild(document.createTextNode(part));
        }
        urlRegex.lastIndex = 0;
      });
    } else {
      text.textContent = ' ' + msgText;
    }

    var time = document.createElement('small');
    var d = new Date(data.createdAt || data.timestamp);
    time.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    body.appendChild(name);
    body.appendChild(text);

    // Request link previews for any URLs found
    if (urls) {
      urls.forEach(function (url) {
        var previewBox = document.createElement('div');
        previewBox.classList.add('chat-link-preview');
        previewBox.dataset.url = url;
        body.appendChild(previewBox);
        if (!pendingPreviews[url]) {
          pendingPreviews[url] = [];
          socket.emit('link-preview', url);
        }
        pendingPreviews[url].push(previewBox);
      });
    }

    body.appendChild(time);
    div.appendChild(body);
    return div;
  }

  function showLoadMore() {
    if (loadMoreEl) loadMoreEl.remove();
    if (!hasMore) return;
    loadMoreEl = document.createElement('div');
    loadMoreEl.classList.add('chat-load-more');
    loadMoreEl.textContent = '[ load more ]';
    loadMoreEl.addEventListener('click', loadOlder);
    messages.prepend(loadMoreEl);
  }

  function loadOlder() {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    if (loadMoreEl) loadMoreEl.textContent = '[ loading... ]';
    var firstMsg = messages.querySelector('.chat-msg');
    var oldest = firstMsg ? firstMsg.dataset.ts : null;
    if (oldest) socket.emit('load-more', oldest);
  }

  // Initial history
  socket.on('chat-history', function (data) {
    messages.innerHTML = '';
    data.messages.forEach(function (msg) {
      var el = createMsgEl(msg);
      el.dataset.ts = msg.createdAt;
      messages.appendChild(el);
    });
    hasMore = data.hasMore;
    showLoadMore();
    messages.scrollTop = messages.scrollHeight;
  });

  // Older history prepended
  socket.on('chat-history-older', function (data) {
    loadingMore = false;
    if (loadMoreEl) loadMoreEl.remove();
    var scrollBefore = messages.scrollHeight;
    var firstChild = messages.firstChild;
    data.messages.forEach(function (msg) {
      var el = createMsgEl(msg);
      el.dataset.ts = msg.createdAt;
      messages.insertBefore(el, firstChild);
    });
    hasMore = data.hasMore;
    showLoadMore();
    // Keep scroll position stable
    messages.scrollTop = messages.scrollHeight - scrollBefore;
  });

  // Scroll to top triggers load more
  messages.addEventListener('scroll', function () {
    if (messages.scrollTop <= 40 && hasMore && !loadingMore) {
      loadOlder();
    }
  });

  bubble.addEventListener('click', function () {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    bubble.classList.toggle('active', isOpen);
    if (isOpen) {
      unread = 0;
      badge.style.display = 'none';
      input.focus();
      messages.scrollTop = messages.scrollHeight;
    }
  });

  closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    isOpen = false;
    panel.classList.remove('open');
    bubble.classList.remove('active');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = input.value.trim();
    if (!msg) return;
    socket.emit('chat-message', msg);
    input.value = '';
  });

  socket.on('chat-message', function (data) {
    playBlip();
    var el = createMsgEl(data);
    el.dataset.ts = data.timestamp;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;

    if (!isOpen) {
      unread++;
      badge.textContent = unread;
      badge.style.display = 'flex';
    }
  });

  socket.on('user-joined', function (data) {
    playPing();
    var div = document.createElement('div');
    div.classList.add('chat-msg', 'chat-system');
    div.textContent = data.displayName + ' connected';
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  });

  socket.on('online-users', function (users) {
    onlineEl.textContent = users.length + ' online';
  });

  socket.on('connect_error', function () {
    document.getElementById('hover-chat').style.display = 'none';
  });

  // Reconnect — server re-sends history + user list on new connection
  // Just show the chat widget again if it was hidden
  socket.io.on('reconnect', function () {
    document.getElementById('hover-chat').style.display = '';
  });

  // Re-connect socket when tab/screen comes back
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !socket.connected) {
      socket.connect();
    }
  });

  // Handle link preview results from server
  socket.on('link-preview-result', function (data) {
    var containers = pendingPreviews[data.url];
    if (!containers) return;
    containers.forEach(function (box) {
      if (!data.title && !data.description && !data.image) {
        box.remove();
        return;
      }
      box.innerHTML = '';
      if (data.image) {
        var img = document.createElement('img');
        img.src = data.image;
        img.classList.add('chat-preview-img');
        box.appendChild(img);
      }
      var info = document.createElement('div');
      info.classList.add('chat-preview-info');
      if (data.title) {
        var title = document.createElement('div');
        title.classList.add('chat-preview-title');
        title.textContent = data.title;
        info.appendChild(title);
      }
      if (data.description) {
        var desc = document.createElement('div');
        desc.classList.add('chat-preview-desc');
        desc.textContent = data.description.length > 120 ? data.description.substring(0, 120) + '...' : data.description;
        info.appendChild(desc);
      }
      if (data.siteName) {
        var site = document.createElement('div');
        site.classList.add('chat-preview-site');
        site.textContent = data.siteName;
        info.appendChild(site);
      }
      box.appendChild(info);
      var a = document.createElement('a');
      a.href = data.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.classList.add('chat-preview-overlay');
      box.appendChild(a);
      messages.scrollTop = messages.scrollHeight;
    });
    delete pendingPreviews[data.url];
  });
})();
