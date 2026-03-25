/* Video Trimmer — videoTrimmer.js */
(function () {
  'use strict';

  let videoFile = null;
  let videoDuration = 0;
  let startTime = 0;
  let endTime = 0;
  let dragging = null; // 'start' | 'end'
  let dragStartX = 0;
  let dragStartVal = 0;
  let loopEnabled = false;
  let isLibraryAsset = false; // true when loaded from asset library URL

  const dropZone = document.getElementById('dropZone');
  const videoInput = document.getElementById('videoInput');
  const editor = document.getElementById('videoEditor');
  const video = document.getElementById('previewVideo');

  const viName = document.getElementById('viName');
  const viSize = document.getElementById('viSize');
  const viDuration = document.getElementById('viDuration');
  const viRange = document.getElementById('viRange');

  const timelineBg = document.getElementById('timelineBg');
  const timelineFill = document.getElementById('timelineFill');
  const handleStart = document.getElementById('handleStart');
  const handleEnd = document.getElementById('handleEnd');
  const playhead = document.getElementById('playhead');

  const startInput = document.getElementById('startInput');
  const endInput = document.getElementById('endInput');

  const trimBtn = document.getElementById('trimBtn');
  const resetTrimBtn = document.getElementById('resetTrimBtn');
  const trimProgress = document.getElementById('trimProgress');
  const trimPbInner = document.getElementById('trimPbInner');
  const trimPbLabel = document.getElementById('trimPbLabel');
  const trimResult = document.getElementById('trimResult');
  const trimResultUrl = document.getElementById('trimResultUrl');
  const copyTrimUrlBtn = document.getElementById('copyTrimUrlBtn');

  /* ── DROP ZONE ── */
  dropZone.addEventListener('click', (e) => {
    if (e.target === videoInput) return;
    videoInput.click();
  });
  videoInput.addEventListener('change', e => { if (e.target.files[0]) loadVideo(e.target.files[0]); });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('video/')) loadVideo(f);
  });

  /* ── PICK FROM LIBRARY ── */
  const pickBtn = document.getElementById('pickFromLibrary');
  if (pickBtn && typeof openAssetPicker === 'function') {
    pickBtn.addEventListener('click', () => {
      openAssetPicker({
        type: 'video',
        onSelect: (asset) => {
          if (asset.fileType !== 'video') { alert('Please select a video asset.'); return; }
          loadVideoFromUrl(asset.publicUrl, asset.title || asset.originalName, asset.size || 0);
        }
      });
    });
  }

  function loadVideoFromUrl(url, name, size) {
    isLibraryAsset = true;
    videoFile = null; // no local file — we'll fetch it for trim
    viName.textContent = name;
    viSize.textContent = formatBytes(size);

    video.removeEventListener('loadedmetadata', onMeta);
    video.removeEventListener('error', onVideoError);
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.addEventListener('error', onVideoError, { once: true });
    video.crossOrigin = 'anonymous';
    video.src = url;
    video.load();
  }

  /* ── LOAD VIDEO ── */
  function loadVideo(file) {
    isLibraryAsset = false;
    videoFile = file;
    const url = URL.createObjectURL(file);

    viName.textContent = file.name;
    viSize.textContent = formatBytes(file.size);

    video.removeEventListener('loadedmetadata', onMeta);
    video.removeEventListener('error', onVideoError);
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.addEventListener('error', onVideoError, { once: true });

    video.src = url;
    video.load();
  }

  function onMeta() {
    videoDuration = video.duration;
    viDuration.textContent = formatTime(videoDuration);
    startTime = 0;
    endTime = videoDuration;
    startInput.max = videoDuration;
    endInput.max = videoDuration;
    syncInputs();
    updateTimeline();
    dropZone.closest('.card').style.display = 'none';
    editor.style.display = '';
    trimResult.style.display = 'none';
    trimProgress.style.display = 'none';
  }

  function onVideoError() {
    alert('Could not load video. Make sure it is a valid video file (MP4, WebM, MOV).');
  }

  /* ── TIMELINE DRAG ── */
  handleStart.addEventListener('mousedown', e => startDrag(e, 'start'));
  handleEnd.addEventListener('mousedown', e => startDrag(e, 'end'));
  handleStart.addEventListener('touchstart', e => startDrag(e, 'start'), { passive: false });
  handleEnd.addEventListener('touchstart', e => startDrag(e, 'end'), { passive: false });

  function startDrag(e, handle) {
    e.preventDefault();
    dragging = handle;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    dragStartX = clientX;
    dragStartVal = handle === 'start' ? startTime : endTime;
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
  }

  function onDrag(e) {
    if (!dragging) return;
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = timelineBg.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = pct * videoDuration;

    if (dragging === 'start') {
      startTime = Math.max(0, Math.min(t, endTime - 0.5));
    } else {
      endTime = Math.min(videoDuration, Math.max(t, startTime + 0.5));
    }

    syncInputs();
    updateTimeline();
    video.currentTime = dragging === 'start' ? startTime : endTime;
  }

  function stopDrag() {
    dragging = null;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('touchend', stopDrag);
  }

  /* ── TIMELINE UPDATE ── */
  function updateTimeline() {
    if (!videoDuration) return;
    const startPct = (startTime / videoDuration) * 100;
    const endPct = (endTime / videoDuration) * 100;
    timelineFill.style.left = startPct + '%';
    timelineFill.style.width = (endPct - startPct) + '%';
    handleStart.style.left = startPct + '%';
    handleEnd.style.left = endPct + '%';
    viRange.textContent = `${formatTime(startTime)} → ${formatTime(endTime)} (${formatTime(endTime - startTime)})`;
  }

  /* ── TIME INPUTS ── */
  startInput.addEventListener('change', () => {
    startTime = Math.max(0, Math.min(parseFloat(startInput.value) || 0, endTime - 0.5));
    syncInputs();
    updateTimeline();
    video.currentTime = startTime;
  });
  endInput.addEventListener('change', () => {
    endTime = Math.min(videoDuration, Math.max(parseFloat(endInput.value) || videoDuration, startTime + 0.5));
    syncInputs();
    updateTimeline();
    video.currentTime = endTime;
  });

  function syncInputs() {
    startInput.value = startTime.toFixed(2);
    endInput.value = endTime.toFixed(2);
  }

  /* ── VIDEO PLAYHEAD ── */
  video.addEventListener('timeupdate', () => {
    if (!videoDuration) return;
    const pct = (video.currentTime / videoDuration) * 100;
    playhead.style.left = pct + '%';

    // Loop: if playing past end, wrap to start
    if (loopEnabled && video.currentTime >= endTime) {
      video.currentTime = startTime;
    }
  });

  /* ── PLAY SELECTION ── */
  const playSelBtn = document.getElementById('playSelectionBtn');
  if (playSelBtn) {
    playSelBtn.addEventListener('click', () => {
      video.currentTime = startTime;
      video.play();
      // Stop at end (non-loop mode)
      if (!loopEnabled) {
        const check = () => {
          if (video.currentTime >= endTime) {
            video.pause();
            video.removeEventListener('timeupdate', check);
          }
        };
        video.addEventListener('timeupdate', check);
      }
    });
  }

  /* ── LOOP TOGGLE ── */
  const loopBtn = document.getElementById('loopToggleBtn');
  if (loopBtn) {
    loopBtn.addEventListener('click', () => {
      loopEnabled = !loopEnabled;
      loopBtn.textContent = loopEnabled ? 'Loop On' : 'Loop Off';
      loopBtn.style.background = loopEnabled ? 'var(--gold)' : '';
      loopBtn.style.color = loopEnabled ? 'var(--dark)' : '';
      loopBtn.style.borderColor = loopEnabled ? 'var(--gold)' : '';
    });
  }

  /* ── PLAYBACK SPEED ── */
  const speedSel = document.getElementById('playbackSpeed');
  if (speedSel) {
    speedSel.addEventListener('change', () => {
      video.playbackRate = parseFloat(speedSel.value) || 1;
    });
  }

  /* ── PRESETS ── */
  document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preset;
      if (!videoDuration) return;
      if (p === 'first30') { startTime = 0; endTime = Math.min(30, videoDuration); }
      else if (p === 'first60') { startTime = 0; endTime = Math.min(60, videoDuration); }
      else if (p === 'last30') { startTime = Math.max(0, videoDuration - 30); endTime = videoDuration; }
      else if (p === 'middle') {
        const mid = videoDuration / 2;
        startTime = Math.max(0, mid - 30);
        endTime = Math.min(videoDuration, mid + 30);
      } else if (p === 'full') { startTime = 0; endTime = videoDuration; }
      // Social presets
      else if (p === 'reel15') { startTime = 0; endTime = Math.min(15, videoDuration); }
      else if (p === 'reel30') { startTime = 0; endTime = Math.min(30, videoDuration); }
      else if (p === 'reel60') { startTime = 0; endTime = Math.min(60, videoDuration); }
      else if (p === 'story') { startTime = 0; endTime = Math.min(15, videoDuration); }
      else if (p === 'tiktok') { startTime = 0; endTime = Math.min(60, videoDuration); }
      syncInputs();
      updateTimeline();
      video.currentTime = startTime;
    });
  });

  /* ── RESET ── */
  resetTrimBtn.addEventListener('click', () => {
    if (!videoDuration) return;
    startTime = 0; endTime = videoDuration;
    syncInputs();
    updateTimeline();
    video.currentTime = 0;
    trimResult.style.display = 'none';
    trimProgress.style.display = 'none';
  });

  /* ── TRIM & UPLOAD ── */
  trimBtn.addEventListener('click', trimAndUpload);

  async function trimAndUpload() {
    if (!videoDuration) return;
    // Need either a local file or a library URL
    if (!videoFile && !isLibraryAsset) return;

    const folder = document.getElementById('trimFolder').value || 'general';
    const customFilename = document.getElementById('trimFilename').value.trim();

    trimResult.style.display = 'none';
    trimProgress.style.display = '';
    trimPbInner.style.width = '10%';
    trimPbLabel.textContent = isLibraryAsset ? 'Fetching video...' : 'Recording trimmed clip...';
    trimBtn.disabled = true;

    try {
      // If from library, fetch the blob first
      let sourceFile = videoFile;
      if (isLibraryAsset && !videoFile) {
        trimPbInner.style.width = '5%';
        const resp = await fetch(video.src);
        const blob = await resp.blob();
        sourceFile = new File([blob], viName.textContent || 'library-video.mp4', { type: blob.type || 'video/mp4' });
        trimPbInner.style.width = '15%';
        trimPbLabel.textContent = 'Recording trimmed clip...';
      }

      const blob = await recordSegment(sourceFile, startTime, endTime, (pct) => {
        trimPbInner.style.width = (15 + pct * 55) + '%';
        trimPbLabel.textContent = `Encoding... ${Math.round(pct * 100)}%`;
      });

      trimPbInner.style.width = '75%';
      trimPbLabel.textContent = 'Uploading...';

      const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
      const srcName = videoFile ? videoFile.name : (viName.textContent || 'clip');
      const baseName = customFilename || srcName.replace(/\.[^.]+$/, '') + `-trim-${Math.round(startTime)}s-${Math.round(endTime)}s`;
      const filename = baseName.endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`;

      const fd = new FormData();
      fd.append('video', blob, filename);
      fd.append('folder', folder);
      fd.append('filename', filename);
      fd.append('startTime', startTime);
      fd.append('endTime', endTime);

      const r = await fetch('/admin/assets/trim-upload', { method: 'POST', body: fd });
      const data = await r.json();

      trimPbInner.style.width = '100%';
      trimPbLabel.textContent = 'Done!';

      if (data.success) {
        const url = data.asset.publicUrl;
        trimResultUrl.textContent = url;
        trimResultUrl.dataset.url = url;
        trimResult.style.display = '';
        copyTrimUrlBtn.onclick = () => {
          navigator.clipboard.writeText(url).then(() => {
            copyTrimUrlBtn.textContent = '✓ Copied';
            setTimeout(() => { copyTrimUrlBtn.textContent = '⧉ Copy URL'; }, 1500);
          });
        };
        setTimeout(() => { trimProgress.style.display = 'none'; }, 1000);
      } else {
        trimPbLabel.textContent = 'Error: ' + (data.error || 'Upload failed');
      }
    } catch (err) {
      trimPbLabel.textContent = 'Error: ' + err.message;
    } finally {
      trimBtn.disabled = false;
    }
  }

  /* ── RECORD SEGMENT via MediaRecorder ── */
  function recordSegment(file, start, end, onProgress) {
    return new Promise((resolve, reject) => {
      const sourceVideo = document.createElement('video');
      sourceVideo.src = URL.createObjectURL(file);
      sourceVideo.muted = true;
      sourceVideo.playbackRate = 1;

      sourceVideo.onloadedmetadata = () => {
        sourceVideo.currentTime = start;
      };

      sourceVideo.onseeked = () => {
        const stream = sourceVideo.captureStream ? sourceVideo.captureStream() : sourceVideo.mozCaptureStream();
        const supportedType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
          .find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

        const recorder = new MediaRecorder(stream, { mimeType: supportedType });
        const chunks = [];

        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: supportedType });
          URL.revokeObjectURL(sourceVideo.src);
          resolve(blob);
        };
        recorder.onerror = reject;

        recorder.start(250);
        sourceVideo.play();

        const duration = end - start;
        const interval = setInterval(() => {
          const elapsed = sourceVideo.currentTime - start;
          if (onProgress) onProgress(Math.min(elapsed / duration, 1));
          if (sourceVideo.currentTime >= end) {
            clearInterval(interval);
            sourceVideo.pause();
            recorder.stop();
          }
        }, 100);
      };

      sourceVideo.onerror = reject;
    });
  }

  /* ── HELPERS ── */
  function formatBytes(b) {
    if (!b) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatTime(s) {
    if (!s && s !== 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }
})();
