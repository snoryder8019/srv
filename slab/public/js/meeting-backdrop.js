/**
 * Virtual backdrop pipeline for meetings.
 *
 * Lazy-loads MediaPipe Selfie Segmentation from CDN, runs each camera frame
 * through it, and composites the person over a chosen backdrop image on an
 * offscreen canvas. Exposes the composite via canvas.captureStream() so
 * meeting-rtc.js can swap that track into peer connections.
 *
 * Public API on window.MeetingBackdrop:
 *   start(rawStream, backdropUrl) -> Promise<MediaStream>   // begins processing
 *   setBackdrop(url) -> Promise<void>                       // swap image, keep running
 *   stop()                                                  // pause loop, keep output stream
 *   destroy()                                               // tear everything down
 *   getOutputStream() -> MediaStream | null
 *   isRunning() -> boolean
 */
(function () {
  var MEDIAPIPE_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation';
  var SCRIPT_URL    = MEDIAPIPE_BASE + '/selfie_segmentation.js';

  var loading       = null;   // Promise<void>
  var seg           = null;   // SelfieSegmentation instance
  var canvas        = null;   // HTMLCanvasElement
  var ctx           = null;   // 2d context
  var outputStream  = null;   // MediaStream from canvas.captureStream
  var inputVideo    = null;   // hidden HTMLVideoElement carrying raw camera
  var backdropImg   = null;   // HTMLImageElement of current backdrop
  var running       = false;
  var processing    = false;
  var rafId         = null;
  var width         = 640;
  var height        = 480;

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-mp-selfie]');
      if (existing) {
        if (window.SelfieSegmentation) return resolve();
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error('Failed to load ' + url)); });
        return;
      }
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.dataset.mpSelfie = '1';
      s.crossOrigin = 'anonymous';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + url)); };
      document.head.appendChild(s);
    });
  }

  function loadMediaPipe() {
    if (loading) return loading;
    loading = loadScript(SCRIPT_URL).then(function () {
      if (!window.SelfieSegmentation) throw new Error('SelfieSegmentation not on window');
      seg = new window.SelfieSegmentation({
        locateFile: function (file) { return MEDIAPIPE_BASE + '/' + file; },
      });
      // 0 = general (256x256, faster), 1 = landscape (256x144, better for wide framing)
      seg.setOptions({ modelSelection: 1, selfieMode: true });
      seg.onResults(onResults);
      return seg.initialize ? seg.initialize() : null;
    });
    return loading;
  }

  function onResults(results) {
    if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // 1) draw segmentation mask (white where person is, transparent elsewhere)
    ctx.drawImage(results.segmentationMask, 0, 0, width, height);

    // 2) keep only mask-covered area, but paint it with the camera image (person)
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(results.image, 0, 0, width, height);

    // 3) paint backdrop behind everything (where mask was transparent)
    ctx.globalCompositeOperation = 'destination-over';
    if (backdropImg && backdropImg.complete && backdropImg.naturalWidth > 0) {
      drawCover(backdropImg, 0, 0, width, height);
    } else {
      ctx.fillStyle = '#1C2B4A';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  }

  // object-fit: cover behavior for the backdrop image
  function drawCover(img, dx, dy, dw, dh) {
    var iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return;
    var ir = iw / ih, dr = dw / dh;
    var sx, sy, sw, sh;
    if (ir > dr) {           // image is wider — crop sides
      sh = ih;
      sw = ih * dr;
      sx = (iw - sw) / 2;
      sy = 0;
    } else {                  // image is taller — crop top/bottom
      sw = iw;
      sh = iw / dr;
      sx = 0;
      sy = (ih - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function tick() {
    if (!running) return;
    if (!processing && seg && inputVideo && inputVideo.readyState >= 2) {
      processing = true;
      seg.send({ image: inputVideo })
        .catch(function () {})
        .then(function () { processing = false; });
    }
    rafId = requestAnimationFrame(tick);
  }

  function ensurePipeline(rawStream) {
    if (!inputVideo) {
      inputVideo = document.createElement('video');
      inputVideo.autoplay = true;
      inputVideo.playsInline = true;
      inputVideo.muted = true;
      inputVideo.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;top:0;';
      document.body.appendChild(inputVideo);
    }
    inputVideo.srcObject = rawStream;

    var tr = rawStream.getVideoTracks()[0];
    if (tr) {
      var s = tr.getSettings();
      if (s.width)  width  = s.width;
      if (s.height) height = s.height;
    }

    if (!canvas) {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
    }
    canvas.width  = width;
    canvas.height = height;

    if (!outputStream) outputStream = canvas.captureStream(30);
  }

  function start(rawStream, backdropUrl) {
    ensurePipeline(rawStream);
    return loadMediaPipe().then(function () {
      return setBackdrop(backdropUrl);
    }).then(function () {
      if (!running) {
        running = true;
        var startTicker = function () { tick(); };
        if (inputVideo.readyState >= 2) startTicker();
        else inputVideo.addEventListener('loadeddata', startTicker, { once: true });
      }
      return outputStream;
    });
  }

  function setBackdrop(url) {
    return new Promise(function (resolve) {
      if (!url) { backdropImg = null; resolve(); return; }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = function () { backdropImg = img; resolve(); };
      img.onerror = function () { resolve(); };
      img.src = url;
    });
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    // Keep outputStream and canvas alive so a restart skips renegotiation.
  }

  function destroy() {
    stop();
    if (outputStream) {
      outputStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      outputStream = null;
    }
    if (inputVideo && inputVideo.parentNode) inputVideo.parentNode.removeChild(inputVideo);
    inputVideo = null;
    backdropImg = null;
  }

  function getOutputStream() { return outputStream; }
  function isRunning()       { return running; }

  window.MeetingBackdrop = {
    start: start,
    setBackdrop: setBackdrop,
    stop: stop,
    destroy: destroy,
    getOutputStream: getOutputStream,
    isRunning: isRunning,
  };
})();
