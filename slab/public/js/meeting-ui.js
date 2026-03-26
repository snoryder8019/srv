/**
 * Meeting UI — share panel, notes/assets sidebar, AI notetaker controls.
 * Reads meeting token from document.body.dataset.token.
 * Depends on: socket.io client, meeting-rtc.js (window.MeetingRTC)
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var token = document.body.dataset.token;
    var tenantDb = document.body.dataset.db || '';
    window.MeetingRTC.init(token, tenantDb);

    // ── SHARE PANEL ──
    var sharePanel = document.getElementById('share-panel');
    var ctrlShare = document.getElementById('ctrl-share');
    var shareClose = document.getElementById('share-close');
    var shareCopy = document.getElementById('share-copy');
    var shareLink = document.getElementById('share-link');
    var inviteSend = document.getElementById('invite-send');
    var inviteEmail = document.getElementById('invite-email');
    var inviteName = document.getElementById('invite-name');
    var inviteStatus = document.getElementById('invite-status');
    var qrLoaded = false;

    ctrlShare.addEventListener('click', function () {
      sharePanel.classList.add('open');
      if (!qrLoaded) {
        fetch('/meeting/' + token + '/qr')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            document.getElementById('qr-container').innerHTML = '<img src="' + data.qr + '" alt="QR Code">';
            qrLoaded = true;
          })
          .catch(function () {
            document.getElementById('qr-loading').textContent = 'Could not load QR code';
          });
      }
    });

    shareClose.addEventListener('click', function () { sharePanel.classList.remove('open'); });
    sharePanel.addEventListener('click', function (e) { if (e.target === sharePanel) sharePanel.classList.remove('open'); });

    shareCopy.addEventListener('click', function () {
      navigator.clipboard.writeText(shareLink.value).then(function () {
        shareCopy.textContent = 'Copied!';
        setTimeout(function () { shareCopy.textContent = 'Copy'; }, 2000);
      });
    });

    inviteSend.addEventListener('click', function () {
      var email = inviteEmail.value.trim();
      if (!email) { inviteStatus.textContent = 'Enter an email address'; inviteStatus.className = 'invite-status error'; return; }
      inviteSend.disabled = true;
      inviteSend.textContent = 'Sending...';
      inviteStatus.textContent = '';
      inviteStatus.className = 'invite-status';

      fetch('/meeting/' + token + '/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, name: inviteName.value.trim() })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          if (result.ok) {
            inviteStatus.textContent = 'Invite sent to ' + email;
            inviteStatus.className = 'invite-status';
            inviteEmail.value = '';
            inviteName.value = '';
          } else {
            inviteStatus.textContent = result.data.error || 'Failed to send';
            inviteStatus.className = 'invite-status error';
          }
        })
        .catch(function () {
          inviteStatus.textContent = 'Failed to send invite';
          inviteStatus.className = 'invite-status error';
        })
        .finally(function () {
          inviteSend.disabled = false;
          inviteSend.textContent = 'Send Invite';
        });
    });

    inviteEmail.addEventListener('keydown', function (e) { if (e.key === 'Enter') inviteSend.click(); });

    // ── NOTES / ASSETS SIDEBAR ──
    var sidebarPanel = document.getElementById('sidebar-panel');
    var sidebarClose = document.getElementById('sidebar-close');
    var ctrlNotes = document.getElementById('ctrl-notes');
    var noteInput = document.getElementById('note-input');
    var noteSend = document.getElementById('note-send');
    var notesList = document.getElementById('notes-list');
    var notesEmpty = document.getElementById('notes-empty');
    var assetsList = document.getElementById('assets-list');
    var assetsEmpty = document.getElementById('assets-empty');
    var uploadZone = document.getElementById('upload-zone');
    var uploadInput = document.getElementById('upload-input');
    var uploadProgress = document.getElementById('upload-progress');
    var incallEl = document.getElementById('incall');

    ctrlNotes.addEventListener('click', function () {
      var isOpen = sidebarPanel.classList.toggle('open');
      ctrlNotes.classList.toggle('active', isOpen);
      incallEl.classList.toggle('sidebar-open', isOpen);
    });
    sidebarClose.addEventListener('click', function () {
      sidebarPanel.classList.remove('open');
      ctrlNotes.classList.remove('active');
      incallEl.classList.remove('sidebar-open');
    });

    // Tab switching
    document.querySelectorAll('.sidebar-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.sidebar-tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.sidebar-body').forEach(function (b) { b.classList.remove('active'); });
        tab.classList.add('active');
        document.querySelector('.sidebar-body[data-tab="' + tab.dataset.tab + '"]').classList.add('active');
      });
    });

    // Load existing notes + assets
    fetch('/meeting/' + token + '/data')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.notes && data.notes.length) {
          notesEmpty.style.display = 'none';
          data.notes.forEach(function (n) { appendNote(n); });
        }
        if (data.assets && data.assets.length) {
          assetsEmpty.style.display = 'none';
          data.assets.forEach(function (a) { appendAsset(a); });
        }
      })
      .catch(function () {});

    // Send note via socket
    noteSend.addEventListener('click', function () {
      var text = noteInput.value.trim();
      if (!text) return;
      var sock = window.MeetingRTC.getSocket();
      if (sock) sock.emit('meeting-note', { text: text });
      noteInput.value = '';
    });
    noteInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); noteSend.click(); }
    });

    // Receive notes from socket
    function listenForNotes() {
      var check = setInterval(function () {
        var sock = window.MeetingRTC.getSocket();
        if (sock) {
          clearInterval(check);
          sock.on('meeting-note-added', function (note) {
            notesEmpty.style.display = 'none';
            appendNote(note);
          });
          sock.on('meeting-asset-added', function (asset) {
            assetsEmpty.style.display = 'none';
            appendAsset(asset);
          });
        }
      }, 500);
    }
    listenForNotes();

    // ── NOTE RENDERING ──
    var noteCounter = 0;

    function appendNote(n) {
      var noteId = n._noteId || ('note-' + Date.now() + '-' + (++noteCounter));
      n._noteId = noteId;

      var div = document.createElement('div');
      div.className = 'note-item' + (n.isAI ? ' ai-note' : '');
      div.dataset.noteId = noteId;
      var time = n.createdAt ? new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      var authorHtml = escHtml(n.author || 'Unknown');
      if (n.isAI) authorHtml += '<span class="note-ai-badge">AI</span>';

      div.innerHTML = '<div class="note-meta"><span class="author">' + authorHtml + '</span><span>' + time + '</span></div>'
        + '<div class="note-text">' + escHtml(n.text) + '</div>'
        + '<div class="note-actions-row">'
        + (n.isAI ? '<button class="note-edit-btn">Edit</button>' : '<button class="note-reply-btn">Reply</button>')
        + '</div>'
        + '<div class="note-replies"></div>';

      var noteTextEl = div.querySelector('.note-text');
      var repliesContainer = div.querySelector('.note-replies');

      // AI notes: edit button
      if (n.isAI) {
        var editBtn = div.querySelector('.note-edit-btn');
        editBtn.addEventListener('click', function () {
          var currentText = noteTextEl.textContent;
          noteTextEl.style.display = 'none';
          editBtn.parentElement.style.display = 'none';

          var textarea = document.createElement('textarea');
          textarea.className = 'note-text-edit';
          textarea.value = currentText;
          div.insertBefore(textarea, repliesContainer);

          var btnRow = document.createElement('div');
          btnRow.className = 'note-actions-row';
          btnRow.innerHTML = '<button class="note-cancel-btn">Cancel</button><button class="note-save-btn">Save</button>';
          div.insertBefore(btnRow, repliesContainer);
          textarea.focus();

          btnRow.querySelector('.note-cancel-btn').addEventListener('click', function () {
            textarea.remove(); btnRow.remove();
            noteTextEl.style.display = ''; editBtn.parentElement.style.display = '';
          });
          btnRow.querySelector('.note-save-btn').addEventListener('click', function () {
            var newText = textarea.value.trim();
            if (!newText) return;
            noteTextEl.textContent = newText;
            textarea.remove(); btnRow.remove();
            noteTextEl.style.display = ''; editBtn.parentElement.style.display = '';
            var sock = window.MeetingRTC.getSocket();
            if (sock) sock.emit('meeting-note-edit', { noteId: noteId, text: newText, createdAt: n.createdAt });
          });
        });
      }

      // User notes: reply button
      if (!n.isAI) {
        var replyBtn = div.querySelector('.note-reply-btn');
        replyBtn.addEventListener('click', function () {
          if (div.querySelector('.reply-input-row')) return;
          var row = document.createElement('div');
          row.className = 'reply-input-row';
          row.innerHTML = '<input type="text" placeholder="Reply..." maxlength="2000"><button>Send</button>';
          repliesContainer.appendChild(row);
          var inp = row.querySelector('input');
          inp.focus();
          inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') row.querySelector('button').click();
            if (e.key === 'Escape') row.remove();
          });
          row.querySelector('button').addEventListener('click', function () {
            var txt = inp.value.trim();
            if (!txt) return;
            var sock = window.MeetingRTC.getSocket();
            if (sock) sock.emit('meeting-note-reply', { noteId: noteId, text: txt });
            row.remove();
          });
        });
      }

      // Render existing replies
      if (n.replies && n.replies.length) {
        n.replies.forEach(function (r) { appendReply(repliesContainer, r); });
      }

      notesList.appendChild(div);
      div.scrollIntoView({ behavior: 'smooth', block: 'end' });

      // AI notes: auto-open sidebar and flash
      if (n.isAI) {
        if (!sidebarPanel.classList.contains('open')) {
          sidebarPanel.classList.add('open');
          ctrlNotes.classList.add('active');
          incallEl.classList.add('sidebar-open');
        }
        document.querySelectorAll('.sidebar-tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.sidebar-body').forEach(function (b) { b.classList.remove('active'); });
        document.querySelector('.sidebar-tab[data-tab="notes"]').classList.add('active');
        document.querySelector('.sidebar-body[data-tab="notes"]').classList.add('active');
        div.classList.add('note-flash');
      }
    }

    function appendReply(container, r) {
      var el = document.createElement('div');
      el.className = 'note-reply';
      var time = r.createdAt ? new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      el.innerHTML = '<div class="reply-meta"><span class="author">' + escHtml(r.author || 'Unknown') + '</span> ' + time + '</div>'
        + '<div class="reply-text">' + escHtml(r.text) + '</div>';
      container.appendChild(el);
    }

    function appendAsset(a) {
      var div = document.createElement('div');
      div.className = 'asset-item';
      var ext = (a.name || '').split('.').pop().toUpperCase().slice(0, 4);
      var sizeStr = a.size ? formatBytes(a.size) : '';
      div.innerHTML = '<div class="asset-icon">' + ext + '</div>'
        + '<div class="asset-info"><div class="asset-name">' + escHtml(a.name) + '</div>'
        + '<div class="asset-meta">' + escHtml(a.uploadedBy || '') + (sizeStr ? ' &middot; ' + sizeStr : '') + '</div></div>'
        + '<a class="asset-dl" href="' + a.url + '" target="_blank" rel="noopener">Open</a>';
      assetsList.appendChild(div);
    }

    function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function formatBytes(b) {
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
      return (b / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ── FILE UPLOAD ──
    uploadZone.addEventListener('click', function () { uploadInput.click(); });
    uploadZone.addEventListener('dragover', function (e) { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', function () { uploadZone.classList.remove('dragover'); });
    uploadZone.addEventListener('drop', function (e) {
      e.preventDefault(); uploadZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files[0]);
    });
    uploadInput.addEventListener('change', function () {
      if (uploadInput.files.length) doUpload(uploadInput.files[0]);
      uploadInput.value = '';
    });

    function doUpload(file) {
      if (file.size > 20 * 1024 * 1024) { alert('Max file size is 20 MB'); return; }
      var fd = new FormData();
      fd.append('file', file);
      fd.append('displayName', window.MeetingRTC.getDisplayName ? window.MeetingRTC.getDisplayName() : 'Unknown');
      uploadProgress.style.display = 'block';
      uploadProgress.textContent = 'Uploading ' + file.name + '...';

      fetch('/meeting/' + token + '/upload', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          uploadProgress.style.display = 'none';
          if (data.ok && data.asset) {
            assetsEmpty.style.display = 'none';
            appendAsset(data.asset);
            var sock = window.MeetingRTC.getSocket();
            if (sock) sock.emit('meeting-asset-uploaded', { asset: data.asset });
          } else { alert(data.error || 'Upload failed'); }
        })
        .catch(function () { uploadProgress.style.display = 'none'; alert('Upload failed'); });
    }

    // ── AI NOTETAKER CONTROLS ──
    var ctrlNotetaker = document.getElementById('ctrl-notetaker');
    var transcriptPanel = document.getElementById('transcript-panel');
    var transcriptLines = document.getElementById('transcript-lines');
    var transcriptStatus = document.getElementById('transcript-status');
    var notetakerFlush = document.getElementById('notetaker-flush');
    var maxTranscriptLines = 50;

    ctrlNotetaker.addEventListener('click', function () {
      if (window.MeetingRTC.isNotetakerActive()) {
        window.MeetingRTC.stopNotetaker();
        ctrlNotetaker.classList.remove('notetaker-active');
        transcriptPanel.classList.remove('open');
        transcriptStatus.textContent = 'stopped';
        transcriptStatus.className = 'transcript-status';
      } else {
        var started = window.MeetingRTC.startNotetaker();
        if (started) {
          ctrlNotetaker.classList.add('notetaker-active');
          transcriptPanel.classList.add('open');
          transcriptStatus.textContent = 'listening';
          transcriptStatus.className = 'transcript-status listening';
        }
      }
    });

    notetakerFlush.addEventListener('click', function () {
      if (!window.MeetingRTC.isNotetakerActive()) return;
      window.MeetingRTC.flushTranscriptToAI(true);
      notetakerFlush.textContent = 'Summarizing...';
      notetakerFlush.disabled = true;
      setTimeout(function () { notetakerFlush.textContent = 'TLDR Now'; notetakerFlush.disabled = false; }, 15000);
    });

    // Local transcript display
    document.addEventListener('notetaker-transcript', function (e) {
      var line = document.createElement('div');
      line.className = 'transcript-line';
      line.innerHTML = '<span class="speaker">' + escHtml(window.MeetingRTC.getDisplayName()) + ':</span> ' + escHtml(e.detail.text);
      transcriptLines.appendChild(line);
      while (transcriptLines.children.length > maxTranscriptLines) transcriptLines.removeChild(transcriptLines.firstChild);
      transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
    });

    // Remote transcript + notetaker status + edits + replies
    function listenForSocketEvents() {
      var check = setInterval(function () {
        var sock = window.MeetingRTC.getSocket();
        if (!sock) return;
        clearInterval(check);

        // Remote transcript lines
        sock.on('transcript-line', function (data) {
          if (!transcriptPanel.classList.contains('open')) return;
          var line = document.createElement('div');
          line.className = 'transcript-line' + (data.isFinal ? '' : ' interim');
          line.innerHTML = '<span class="speaker">' + escHtml(data.speaker) + ':</span> ' + escHtml(data.text);
          if (!data.isFinal) {
            var last = transcriptLines.lastElementChild;
            if (last && last.classList.contains('interim')) transcriptLines.replaceChild(line, last);
            else transcriptLines.appendChild(line);
          } else {
            var lastEl = transcriptLines.lastElementChild;
            if (lastEl && lastEl.classList.contains('interim')) transcriptLines.removeChild(lastEl);
            transcriptLines.appendChild(line);
          }
          while (transcriptLines.children.length > maxTranscriptLines) transcriptLines.removeChild(transcriptLines.firstChild);
          transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
        });

        // Notetaker status
        sock.on('notetaker-status', function (data) {
          if (data.status === 'summarizing') {
            transcriptStatus.textContent = 'summarizing...';
            transcriptStatus.className = 'transcript-status summarizing';
          } else {
            transcriptStatus.textContent = 'listening';
            transcriptStatus.className = 'transcript-status listening';
            notetakerFlush.textContent = 'TLDR Now';
            notetakerFlush.disabled = false;
          }
        });

        // AI TLDR in transcript panel
        sock.on('meeting-note-added', function (note) {
          if (note.isAI && transcriptPanel.classList.contains('open')) {
            var tldr = document.createElement('div');
            tldr.className = 'transcript-tldr';
            tldr.innerHTML = '<div class="tldr-label">AI TLDR</div><div class="tldr-text">' + escHtml(note.text) + '</div>';
            transcriptLines.appendChild(tldr);
            transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
          }
        });

        // Note edits
        sock.on('meeting-note-edited', function (data) {
          var el = notesList.querySelector('[data-note-id="' + data.noteId + '"] .note-text');
          if (el) {
            el.textContent = data.text;
            el.closest('.note-item').classList.add('note-flash');
          }
        });

        // Note replies
        sock.on('meeting-note-reply-added', function (data) {
          var noteEl = notesList.querySelector('[data-note-id="' + data.noteId + '"]');
          if (noteEl) {
            var container = noteEl.querySelector('.note-replies');
            if (container) { appendReply(container, data.reply); noteEl.classList.add('note-flash'); }
          }
        });
      }, 500);
    }
    listenForSocketEvents();
  });
})();
