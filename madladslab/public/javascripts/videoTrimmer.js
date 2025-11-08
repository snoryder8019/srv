/**
 * Video Trimmer - Client-side JavaScript
 * Handles video loading, trim preview, and client-side trimming using MediaRecorder API
 */

let videoFile = null;
let videoElement = null;
let videoDuration = 0;
let startTime = 0;
let endTime = 0;
let isDragging = false;
let dragHandle = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  videoElement = document.getElementById('preview-video');
  setupEventListeners();
});

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  const videoInput = document.getElementById('video-input');
  const startHandle = document.getElementById('start-handle');
  const endHandle = document.getElementById('end-handle');
  const inputStart = document.getElementById('input-start');
  const inputEnd = document.getElementById('input-end');
  const quickSelect = document.getElementById('quick-select');

  // Video file selection
  videoInput.addEventListener('change', handleVideoSelect);

  // Timeline handle dragging
  startHandle.addEventListener('mousedown', (e) => startDrag(e, 'start'));
  endHandle.addEventListener('mousedown', (e) => startDrag(e, 'end'));
  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('mouseup', stopDrag);

  // Touch support
  startHandle.addEventListener('touchstart', (e) => startDrag(e, 'start'));
  endHandle.addEventListener('touchstart', (e) => startDrag(e, 'end'));
  document.addEventListener('touchmove', handleDrag);
  document.addEventListener('touchend', stopDrag);

  // Time input changes
  inputStart.addEventListener('change', () => {
    startTime = Math.max(0, Math.min(parseFloat(inputStart.value) || 0, videoDuration));
    updateTimeline();
  });

  inputEnd.addEventListener('change', () => {
    endTime = Math.max(startTime, Math.min(parseFloat(inputEnd.value) || videoDuration, videoDuration));
    updateTimeline();
  });

  // Quick select presets
  quickSelect.addEventListener('change', handleQuickSelect);

  // Video loaded
  videoElement.addEventListener('loadedmetadata', handleVideoLoaded);
}

/**
 * Handle video file selection
 */
function handleVideoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Check file size (500MB limit)
  const maxSize = 500 * 1024 * 1024;
  if (file.size > maxSize) {
    showAlert('File too large! Maximum size is 500MB', 'error');
    return;
  }

  // Check file type
  if (!file.type.startsWith('video/')) {
    showAlert('Please select a video file', 'error');
    return;
  }

  videoFile = file;

  // Create object URL and load video
  const url = URL.createObjectURL(file);
  videoElement.src = url;
  videoElement.load();

  // Show editor, hide upload section
  document.getElementById('upload-section').classList.add('has-video');
  document.getElementById('video-editor').classList.add('active');

  // Update file info
  document.getElementById('info-filename').textContent = file.name;
  document.getElementById('info-size').textContent = formatBytes(file.size);
}

/**
 * Handle video metadata loaded
 */
function handleVideoLoaded() {
  videoDuration = videoElement.duration;
  endTime = videoDuration;

  // Update UI
  document.getElementById('info-duration').textContent = formatTime(videoDuration);
  document.getElementById('info-resolution').textContent = `${videoElement.videoWidth} × ${videoElement.videoHeight}`;
  document.getElementById('input-start').max = videoDuration;
  document.getElementById('input-end').max = videoDuration;
  document.getElementById('input-end').value = videoDuration;

  updateTimeline();
}

/**
 * Start dragging timeline handle
 */
function startDrag(e, handle) {
  e.preventDefault();
  isDragging = true;
  dragHandle = handle;
  document.body.style.cursor = 'ew-resize';
}

/**
 * Handle drag movement
 */
function handleDrag(e) {
  if (!isDragging) return;

  const timeline = document.getElementById('timeline');
  const rect = timeline.getBoundingClientRect();

  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const percent = x / rect.width;
  const time = percent * videoDuration;

  if (dragHandle === 'start') {
    startTime = Math.max(0, Math.min(time, endTime - 0.1));
  } else {
    endTime = Math.max(startTime + 0.1, Math.min(time, videoDuration));
  }

  updateTimeline();
}

/**
 * Stop dragging
 */
function stopDrag() {
  isDragging = false;
  dragHandle = null;
  document.body.style.cursor = 'default';
}

/**
 * Update timeline visual and displays
 */
function updateTimeline() {
  const startPercent = (startTime / videoDuration) * 100;
  const endPercent = (endTime / videoDuration) * 100;

  // Update handles
  document.getElementById('start-handle').style.left = `${startPercent}%`;
  document.getElementById('end-handle').style.left = `${endPercent}%`;

  // Update fill
  const fill = document.getElementById('timeline-fill');
  fill.style.left = `${startPercent}%`;
  fill.style.width = `${endPercent - startPercent}%`;

  // Update displays
  document.getElementById('display-start').textContent = formatTime(startTime);
  document.getElementById('display-end').textContent = formatTime(endTime);
  document.getElementById('display-duration').textContent = formatTime(endTime - startTime);

  // Update inputs
  document.getElementById('input-start').value = startTime.toFixed(2);
  document.getElementById('input-end').value = endTime.toFixed(2);

  // Seek video to start time
  if (videoElement && !videoElement.paused) {
    videoElement.pause();
  }
  if (videoElement) {
    videoElement.currentTime = startTime;
  }
}

/**
 * Handle quick select presets
 */
function handleQuickSelect(e) {
  const preset = e.target.value;

  switch (preset) {
    case 'first30':
      startTime = 0;
      endTime = Math.min(30, videoDuration);
      break;
    case 'first60':
      startTime = 0;
      endTime = Math.min(60, videoDuration);
      break;
    case 'last30':
      startTime = Math.max(0, videoDuration - 30);
      endTime = videoDuration;
      break;
    case 'middle60':
      const middle = videoDuration / 2;
      startTime = Math.max(0, middle - 30);
      endTime = Math.min(videoDuration, middle + 30);
      break;
  }

  updateTimeline();
}

/**
 * Reset trim to full video
 */
function resetTrim() {
  startTime = 0;
  endTime = videoDuration;
  document.getElementById('quick-select').value = '';
  updateTimeline();
}

/**
 * Trim video and upload
 */
async function trimAndUpload() {
  if (!videoFile) {
    showAlert('No video loaded', 'error');
    return;
  }

  if (endTime - startTime < 0.1) {
    showAlert('Trim duration too short (minimum 0.1 seconds)', 'error');
    return;
  }

  const bucket = document.getElementById('upload-bucket').value;
  const subdirectory = document.getElementById('upload-subdirectory').value;
  const filename = document.getElementById('upload-filename').value;

  // Confirm action
  const duration = formatTime(endTime - startTime);
  if (!confirm(`Trim video from ${formatTime(startTime)} to ${formatTime(endTime)} (${duration}) and upload to ${bucket}?`)) {
    return;
  }

  // Show progress
  const progressBar = document.getElementById('progress-bar');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const trimButton = document.getElementById('trim-button');

  progressBar.classList.add('active');
  trimButton.disabled = true;

  try {
    // Update progress
    progressText.textContent = 'Trimming video...';
    progressFill.style.width = '30%';

    // Trim video using canvas + MediaRecorder
    const trimmedBlob = await trimVideo(startTime, endTime);

    // Update progress
    progressText.textContent = 'Uploading to bucket...';
    progressFill.style.width = '70%';

    // Upload trimmed video
    const formData = new FormData();
    // Generate proper filename with .webm extension (MediaRecorder output format)
    const baseFilename = filename || videoFile.name.replace(/\.[^/.]+$/, '');
    const trimmedFilename = `trimmed-${baseFilename}.webm`;
    formData.append('video', trimmedBlob, trimmedFilename);
    formData.append('startTime', startTime);
    formData.append('endTime', endTime);
    formData.append('bucket', bucket);
    if (subdirectory) formData.append('subdirectory', subdirectory);
    // Send the full filename with .webm extension
    formData.append('filename', `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webm`);

    const response = await fetch('/api/v1/bucket/trim-video', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      progressFill.style.width = '100%';
      progressText.textContent = 'Upload complete!';
      showAlert(`✅ Video trimmed and uploaded successfully!\nURL: ${data.asset.publicUrl}`);

      // Reset after 2 seconds
      setTimeout(() => {
        window.location.href = '/bucketUpload';
      }, 2000);
    } else {
      throw new Error(data.error || 'Upload failed');
    }

  } catch (error) {
    console.error('Trim and upload error:', error);
    showAlert('❌ Error: ' + error.message, 'error');
  } finally {
    progressBar.classList.remove('active');
    trimButton.disabled = false;
    progressFill.style.width = '0%';
  }
}

/**
 * Trim video using canvas and MediaRecorder
 */
async function trimVideo(start, end) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;

      // Try to capture stream from canvas
      let stream;
      try {
        stream = canvas.captureStream(30); // 30 FPS
      } catch (e) {
        console.error('Canvas captureStream not supported:', e);
        reject(new Error('Browser does not support video trimming. Please use Chrome or Edge.'));
        return;
      }

      // Try to add audio track
      try {
        if (typeof videoElement.captureStream === 'function') {
          const audioStream = videoElement.captureStream();
          const audioTrack = audioStream.getAudioTracks()[0];
          if (audioTrack) stream.addTrack(audioTrack);
        }
      } catch (e) {
        console.warn('Could not capture audio:', e);
        // Continue without audio
      }

      const chunks = [];

      // Try WebM VP9 first, fall back to VP8
      let mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 2500000
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(blob);
      };

      recorder.onerror = (e) => {
        reject(new Error('Recording failed: ' + e.error));
      };

      // Set video to start time
      videoElement.currentTime = start;

      videoElement.onseeked = () => {
        // Start recording
        recorder.start(100); // Timeslice every 100ms
        videoElement.play();

        // Draw frames
        const drawFrame = () => {
          if (videoElement.currentTime >= end || videoElement.paused || videoElement.ended) {
            videoElement.pause();
            setTimeout(() => {
              recorder.stop();
            }, 100);
            return;
          }

          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          requestAnimationFrame(drawFrame);
        };

        drawFrame();
      };

      // Timeout safety
      const timeout = setTimeout(() => {
        videoElement.pause();
        recorder.stop();
        reject(new Error('Trimming timeout'));
      }, (end - start + 5) * 1000); // Duration + 5s buffer

      recorder.onstop = () => {
        clearTimeout(timeout);
        const blob = new Blob(chunks, { type: 'video/webm' });
        resolve(blob);
      };

    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Format time in MM:SS
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Show alert notification
 */
function showAlert(message, type = 'success') {
  const alert = document.getElementById('alert');
  alert.textContent = message;
  alert.className = `alert ${type} active`;

  setTimeout(() => {
    alert.classList.remove('active');
  }, 5000);
}
