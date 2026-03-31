/* Maintenance countdown banner — auto-attaches to any page with Socket.IO */
(function () {
  'use strict';

  function createBanner() {
    var banner = document.createElement('div');
    banner.id = 'maintenance-banner';
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;background:#1a1a00;' +
      'border-bottom:2px solid #e6b800;padding:12px 20px;text-align:center;' +
      'font-family:monospace;font-size:0.82rem;color:#e6b800;display:none;' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.5);';
    banner.innerHTML =
      '<div id="maint-msg" style="margin-bottom:4px"></div>' +
      '<div id="maint-countdown" style="font-size:1.2rem;font-weight:bold;letter-spacing:0.1em"></div>';
    document.body.appendChild(banner);
    return banner;
  }

  function startCountdown(minutes, message) {
    var banner = document.getElementById('maintenance-banner') || createBanner();
    banner.style.display = 'block';
    document.getElementById('maint-msg').textContent = message;

    var endTime = Date.now() + minutes * 60 * 1000;

    function tick() {
      var remaining = Math.max(0, endTime - Date.now());
      var mins = Math.floor(remaining / 60000);
      var secs = Math.floor((remaining % 60000) / 1000);
      var display = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      document.getElementById('maint-countdown').textContent = display;

      if (remaining <= 60000) {
        banner.style.background = '#2a0a0a';
        banner.style.borderColor = '#cd412b';
        banner.style.color = '#cd412b';
      }

      if (remaining > 0) {
        requestAnimationFrame(tick);
      } else {
        document.getElementById('maint-countdown').textContent = 'MAINTENANCE IN PROGRESS';
      }
    }

    tick();

    // Push page content down so banner doesn't cover it
    document.body.style.paddingTop = banner.offsetHeight + 'px';
  }

  // Listen on any available socket connection
  function listen() {
    if (typeof io === 'undefined') return;

    // Try each namespace
    var namespaces = ['/broadcasts', '/stats', '/'];
    for (var i = 0; i < namespaces.length; i++) {
      try {
        var s = io.managers && Object.values(io.managers)[0];
        if (s) break;
      } catch (e) {}
    }

    // Also listen on the default namespace
    try {
      var defaultSocket = io({ transports: ['websocket', 'polling'], autoConnect: true });
      defaultSocket.on('maintenance:warning', function (data) {
        startCountdown(data.minutes, data.message);
      });
    } catch (e) {}
  }

  // Also hook into any existing socket that gets created
  var origIO = window.io;
  if (origIO) {
    var origOf = origIO.prototype && origIO.prototype.connect;
  }

  // Simple approach: poll for socket availability
  var checkInterval = setInterval(function () {
    // Check if there's a global socket with the maintenance listener
    var sockets = document.querySelectorAll('[data-socket-connected]');
    // Just try to connect a lightweight listener
    if (typeof io !== 'undefined') {
      clearInterval(checkInterval);
      try {
        var mSocket = io('/', { transports: ['websocket', 'polling'] });
        mSocket.on('maintenance:warning', function (data) {
          startCountdown(data.minutes, data.message);
        });
      } catch (e) {}
    }
  }, 2000);

  // Expose for manual trigger (testing)
  window.showMaintenance = startCountdown;
})();
