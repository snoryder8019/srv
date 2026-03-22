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
    // Guard: synthetic click on the hidden input bubbles back here — break the loop
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

  /* ── LOAD VIDEO ── */
  function loadVideo(file) {
    videoFile = file;
    const url = URL.createObjectURL(file);

    viName.textContent = file.name;
    viSize.textContent = formatBytes(file.size);

    // Remove any previous listener then attach fresh
    video.removeEventListener('loadedmetadata', onMeta);
    video.removeEventListener('error', onVideoError);
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.addEventListener('error', onVideoError, { once: true });

    video.src = url;
    video.load(); // force metadata fetch
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
    // Show editor, hide drop zone card
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
  });

  /* ── PRESETS ── */
  document.querySelectorAll('.preset-btn').forEach(btn => {
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
    if (!videoFile || !videoDuration) return;

    const folder = document.getElementById('trimFolder').value || 'general';
    const customFilename = document.getElementById('trimFilename').value.trim();

    trimResult.style.display = 'none';
    trimProgress.style.display = '';
    trimPbInner.style.width = '10%';
    trimPbLabel.textContent = 'Recording trimmed clip...';
    trimBtn.disabled = true;

    try {
      const blob = await recordSegment(videoFile, startTime, endTime, (pct) => {
        trimPbInner.style.width = (10 + pct * 60) + '%';
        trimPbLabel.textContent = `Encoding... ${Math.round(pct * 100)}%`;
      });

      trimPbInner.style.width = '75%';
      trimPbLabel.textContent = 'Uploading...';

      const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
      const baseName = customFilename || videoFile.name.replace(/\.[^.]+$/, '') + `-trim-${Math.round(startTime)}s-${Math.round(endTime)}s`;
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

        recorder.start(250); // collect in 250ms chunks
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
