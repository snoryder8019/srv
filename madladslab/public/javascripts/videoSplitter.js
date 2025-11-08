/**
 * Video Splitter - Client-side JavaScript
 * Splits large video files into smaller segments for trimming
 */

let videoFile = null;
let videoElement = null;
let videoDuration = 0;
let selectedSplitCount = 0;
let segments = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  videoElement = document.getElementById('processor-video');
  setupEventListeners();
  checkBrowserCompatibility();
});

/**
 * Check browser compatibility
 */
function checkBrowserCompatibility() {
  const canvas = document.createElement('canvas');
  const isCompatible =
    typeof canvas.captureStream === 'function' &&
    typeof MediaRecorder !== 'undefined';

  if (!isCompatible) {
    showAlert(
      '⚠️ Browser not fully supported. Please use Chrome or Edge for best results.',
      'error'
    );
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  const uploadZone = document.getElementById('upload-zone');
  const videoInput = document.getElementById('video-input');

  // Click to upload
  uploadZone.addEventListener('click', () => videoInput.click());

  // File selection
  videoInput.addEventListener('change', handleVideoSelect);

  // Drag and drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragging');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragging');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragging');

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      videoInput.files = e.dataTransfer.files;
      handleVideoSelect({ target: { files: [file] } });
    }
  });

  // Video metadata loaded
  videoElement.addEventListener('loadedmetadata', handleVideoLoaded);
}

/**
 * Handle video file selection
 */
function handleVideoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

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

  // Update file info
  document.getElementById('info-filename').textContent = file.name;
  document.getElementById('info-size').textContent = formatBytes(file.size);

  // Show video info section
  document.getElementById('video-info').classList.add('active');

  // Show warning if file is large
  const maxSize = 500 * 1024 * 1024; // 500MB
  if (file.size > maxSize) {
    document.getElementById('size-warning').classList.add('show');
  }
}

/**
 * Handle video metadata loaded
 */
function handleVideoLoaded() {
  videoDuration = videoElement.duration;

  // Update UI
  document.getElementById('info-duration').textContent = formatTime(videoDuration);
  document.getElementById('info-resolution').textContent =
    `${videoElement.videoWidth} × ${videoElement.videoHeight}`;

  // Show split options
  document.getElementById('split-options').classList.add('active');
}

/**
 * Select split count
 */
function selectSplit(count) {
  selectedSplitCount = count;

  // Update button states
  document.querySelectorAll('.split-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.closest('.split-btn').classList.add('active');

  // Calculate segments
  calculateSegments(count);
}

/**
 * Calculate segment information
 */
function calculateSegments(count) {
  segments = [];
  const segmentDuration = videoDuration / count;
  const estimatedSegmentSize = videoFile.size / count;

  for (let i = 0; i < count; i++) {
    const startTime = i * segmentDuration;
    const endTime = (i + 1) * segmentDuration;

    segments.push({
      index: i,
      name: `${videoFile.name.replace(/\.[^/.]+$/, '')}-segment-${i + 1}`,
      startTime: startTime,
      endTime: endTime,
      duration: segmentDuration,
      estimatedSize: estimatedSegmentSize
    });
  }

  // Display segment preview
  displaySegmentPreview();
}

/**
 * Display segment preview
 */
function displaySegmentPreview() {
  const segmentList = document.getElementById('segment-list');
  const maxSize = 500 * 1024 * 1024; // 500MB

  segmentList.innerHTML = segments.map(seg => {
    const overLimit = seg.estimatedSize > maxSize;
    const sizeClass = overLimit ? 'over-limit' : '';

    return `
      <div class="segment-item">
        <div class="segment-info">
          <div class="segment-name">Segment ${seg.index + 1}</div>
          <div class="segment-details">
            ${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}
            (${formatTime(seg.duration)})
          </div>
        </div>
        <div class="segment-size ${sizeClass}">
          ~${formatBytes(seg.estimatedSize)}
          ${overLimit ? '⚠️' : '✓'}
        </div>
      </div>
    `;
  }).join('');

  // Show preview and action buttons
  document.getElementById('segments-preview').classList.add('active');
  document.getElementById('action-buttons').classList.add('active');

  // Check if any segments are over limit
  const anyOverLimit = segments.some(s => s.estimatedSize > maxSize);
  if (anyOverLimit) {
    showAlert(
      'Warning: Some segments may still exceed 500MB. Consider splitting into more segments.',
      'error'
    );
  }
}

/**
 * Process and download segments
 */
async function processSegments() {
  if (segments.length === 0) {
    showAlert('Please select a split option first', 'error');
    return;
  }

  const processBtn = document.getElementById('process-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  processBtn.disabled = true;
  progressContainer.classList.add('active');

  try {
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const progress = ((i / segments.length) * 100).toFixed(0);

      // Update progress
      progressFill.style.width = `${progress}%`;
      progressFill.textContent = `${progress}%`;
      progressText.textContent = `Processing segment ${i + 1} of ${segments.length}...`;

      // Trim video segment
      const blob = await trimVideoSegment(segment.startTime, segment.endTime);

      // Download segment
      downloadBlob(blob, `${segment.name}.webm`);

      // Small delay between segments
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Complete
    progressFill.style.width = '100%';
    progressFill.textContent = '100%';
    progressText.textContent = 'All segments processed!';

    showAlert(
      `✅ Successfully split video into ${segments.length} segments! Check your downloads folder.`,
      'success'
    );

    // Reset after 3 seconds
    setTimeout(() => {
      progressContainer.classList.remove('active');
      processBtn.disabled = false;
    }, 3000);

  } catch (error) {
    console.error('Processing error:', error);
    showAlert('❌ Error processing segments: ' + error.message, 'error');
    processBtn.disabled = false;
    progressContainer.classList.remove('active');
  }
}

/**
 * Trim video segment using canvas and MediaRecorder
 */
async function trimVideoSegment(start, end) {
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
        reject(new Error('Browser does not support video processing. Please use Chrome or Edge.'));
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

      let stopped = false;
      recorder.onstop = () => {
        if (!stopped) {
          stopped = true;
          const blob = new Blob(chunks, { type: 'video/webm' });
          resolve(blob);
        }
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
              if (recorder.state !== 'inactive') {
                recorder.stop();
              }
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
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
        reject(new Error('Segment processing timeout'));
      }, (end - start + 10) * 1000); // Duration + 10s buffer

      // Clear timeout on success
      const originalOnStop = recorder.onstop;
      recorder.onstop = () => {
        clearTimeout(timeout);
        if (originalOnStop) originalOnStop();
      };

    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Download blob as file
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Reset splitter to initial state
 */
function resetSplitter() {
  // Reset variables
  videoFile = null;
  videoDuration = 0;
  selectedSplitCount = 0;
  segments = [];

  // Reset video element
  videoElement.src = '';
  document.getElementById('video-input').value = '';

  // Hide sections
  document.getElementById('video-info').classList.remove('active');
  document.getElementById('split-options').classList.remove('active');
  document.getElementById('segments-preview').classList.remove('active');
  document.getElementById('action-buttons').classList.remove('active');
  document.getElementById('size-warning').classList.remove('show');

  // Reset buttons
  document.querySelectorAll('.split-btn').forEach(btn => {
    btn.classList.remove('active');
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
