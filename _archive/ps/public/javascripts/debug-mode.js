/**
 * Debug Mode Handler
 * Listens for debug mode changes from the status bar and provides debugging utilities
 */

(function() {
  let debugMode = false;

  // Listen for debug mode changes
  window.addEventListener('debugModeChange', function(event) {
    debugMode = event.detail.enabled;

    if (debugMode) {
      enableDebugMode();
    } else {
      disableDebugMode();
    }
  });

  function enableDebugMode() {
    console.log('%c[DEBUG MODE ENABLED]', 'background: #ef4444; color: white; padding: 4px 8px; font-weight: bold;');

    // Add debug overlay to body
    document.body.classList.add('debug-mode');

    // Log page-specific information
    logPageInfo();

    // Enable enhanced console logging
    enableEnhancedLogging();

    // Show bounding boxes for elements
    if (window.THREE && window.scene) {
      enableThreeJSDebug();
    }

    // Log all fetch requests
    interceptFetch();
  }

  function disableDebugMode() {
    console.log('%c[DEBUG MODE DISABLED]', 'background: #6b7280; color: white; padding: 4px 8px; font-weight: bold;');

    document.body.classList.remove('debug-mode');

    // Clean up debug overlays
    document.querySelectorAll('.debug-overlay').forEach(el => el.remove());
  }

  function logPageInfo() {
    console.group('%cPage Information', 'color: #34d399; font-weight: bold;');
    console.log('URL:', window.location.href);
    console.log('Path:', window.location.pathname);
    console.log('User Agent:', navigator.userAgent);
    console.log('Viewport:', {
      width: window.innerWidth,
      height: window.innerHeight
    });

    // Log loaded scripts
    const scripts = Array.from(document.scripts).map(s => s.src).filter(Boolean);
    console.log('Scripts:', scripts);

    // Log loaded stylesheets
    const styles = Array.from(document.styleSheets)
      .map(s => s.href)
      .filter(Boolean);
    console.log('Stylesheets:', styles);

    // Log global variables
    const globals = Object.keys(window).filter(key =>
      !key.startsWith('webkit') &&
      !key.startsWith('moz') &&
      typeof window[key] !== 'function' ||
      ['socket', 'scene', 'camera', 'renderer'].includes(key)
    );
    console.log('Notable Globals:', globals.slice(0, 20));

    console.groupEnd();
  }

  function enableEnhancedLogging() {
    // Log Socket.IO events if socket exists
    if (window.io && window.socket) {
      console.log('%c[DEBUG] Socket.IO detected', 'color: #34d399;');

      const originalEmit = window.socket.emit;
      window.socket.emit = function(...args) {
        console.log('%c[SOCKET EMIT]', 'color: #fbbf24;', args[0], args.slice(1));
        return originalEmit.apply(this, args);
      };

      const originalOn = window.socket.on;
      window.socket.on = function(event, handler) {
        const wrappedHandler = function(...args) {
          console.log('%c[SOCKET ON]', 'color: #34d399;', event, args);
          return handler.apply(this, args);
        };
        return originalOn.call(this, event, wrappedHandler);
      };
    }
  }

  function enableThreeJSDebug() {
    console.group('%cThree.js Debug Info', 'color: #34d399; font-weight: bold;');

    if (window.scene) {
      console.log('Scene:', window.scene);
      console.log('Scene Children:', window.scene.children.length);
      console.log('Objects:', window.scene.children.map(child => ({
        type: child.type,
        name: child.name,
        visible: child.visible
      })));
    }

    if (window.renderer) {
      console.log('Renderer Info:', window.renderer.info);
    }

    if (window.camera) {
      console.log('Camera Position:', window.camera.position);
      console.log('Camera Rotation:', window.camera.rotation);
    }

    console.groupEnd();
  }

  function interceptFetch() {
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const url = args[0];
      const options = args[1] || {};

      console.group('%c[FETCH]', 'color: #60a5fa;', options.method || 'GET', url);
      console.log('Options:', options);

      return originalFetch.apply(this, args)
        .then(response => {
          console.log('Response:', response.status, response.statusText);
          console.groupEnd();
          return response;
        })
        .catch(error => {
          console.error('Error:', error);
          console.groupEnd();
          throw error;
        });
    };
  }

  // Expose debug utilities globally
  window.debugUtils = {
    isEnabled: () => debugMode,
    logScene: () => {
      if (window.scene) {
        console.log('Current Scene:', window.scene);
        console.table(window.scene.children.map(child => ({
          type: child.type,
          name: child.name,
          visible: child.visible,
          position: `${child.position.x.toFixed(2)}, ${child.position.y.toFixed(2)}, ${child.position.z.toFixed(2)}`
        })));
      }
    },
    logPerformance: () => {
      if (performance.memory) {
        console.table({
          'JS Heap Size': (performance.memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB',
          'JS Heap Limit': (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2) + ' MB',
          'Total Heap Size': (performance.memory.totalJSHeapSize / 1048576).toFixed(2) + ' MB'
        });
      }
    },
    screenshot: () => {
      if (window.renderer) {
        window.renderer.render(window.scene, window.camera);
        const dataURL = window.renderer.domElement.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `screenshot-${Date.now()}.png`;
        link.click();
        console.log('Screenshot saved');
      }
    }
  };

  console.log('%c[Debug Mode] System initialized. Use window.debugUtils for utilities.',
    'color: #9ca3af; font-style: italic;');
})();
