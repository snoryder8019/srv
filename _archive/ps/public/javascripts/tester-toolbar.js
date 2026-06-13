/**
 * Tester Toolbar
 * Debug toolbar for testers with screenshot, ticket creation, and game state visibility
 */

class TesterToolbar {
  constructor(user, character) {
    this.user = user;
    this.character = character;
    this.isVisible = false;
    this.screenshotMode = false;

    if (user && user.userRole === 'tester') {
      this.createToolbar();
      this.attachEventListeners();
      this.adjustForAdminDebug();
    }
  }

  adjustForAdminDebug() {
    // Check if admin status bar exists and adjust positioning
    const adminStatusBar = document.getElementById('admin-status-bar');

    if (adminStatusBar && adminStatusBar.style.display !== 'none') {
      // Get admin status bar height
      const adminHeight = adminStatusBar.offsetHeight;

      // Set CSS variable for positioning
      document.documentElement.style.setProperty('--admin-debug-height', `${adminHeight}px`);

      // Add class to body for additional styling
      document.body.classList.add('has-admin-debug');

      console.log(`📊 Admin status bar detected (${adminHeight}px), tester toolbar stacked above`);

      // Re-adjust if admin bar expands/collapses
      this.watchAdminBarChanges();
    } else {
      // No admin bar, position at bottom
      document.documentElement.style.setProperty('--admin-debug-height', '0px');
      console.log('📊 No admin status bar, tester toolbar at bottom');
    }
  }

  watchAdminBarChanges() {
    // Watch for changes to admin bar size (expand/collapse)
    const adminStatusBar = document.getElementById('admin-status-bar');
    if (!adminStatusBar) return;

    // Use ResizeObserver to detect size changes
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
          const newHeight = entry.target.offsetHeight;
          document.documentElement.style.setProperty('--admin-debug-height', `${newHeight}px`);
          console.log(`📊 Admin status bar resized to ${newHeight}px`);
        }
      });

      resizeObserver.observe(adminStatusBar);
      this.adminBarObserver = resizeObserver;
    }
  }

  createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = 'tester-toolbar';
    toolbar.className = 'tester-toolbar';
    toolbar.innerHTML = `
      <div class="tester-toolbar-header">
        <div class="status-services">
          <span class="status-label">TESTER:</span>
          <span class="tester-user">${this.user.username}</span>
        </div>
        <div class="status-resources">
          <span class="status-item">
            <span class="status-label">LOC:</span>
            <span id="quick-location" class="status-value">--</span>
          </span>
          <span class="status-item">
            <span class="status-label">FPS:</span>
            <span id="quick-fps" class="status-value">--</span>
          </span>
          <span class="status-item">
            <span class="status-label">PING:</span>
            <span id="quick-ping" class="status-value">--</span>
          </span>
        </div>
        <div class="tester-toolbar-actions">
          <button class="tester-btn" id="toggle-debug-info" title="Toggle Debug Info">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z"/>
            </svg>
          </button>
          <button class="tester-btn" id="take-screenshot" title="Take Screenshot">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
            </svg>
          </button>
          <button class="tester-btn" id="create-ticket" title="Create Ticket">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
            </svg>
          </button>
          <button class="tester-btn" id="toggle-chat" title="Toggle Chat">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z"/>
              <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="tester-debug-info hidden" id="tester-debug-info">
        <div class="debug-section">
          <h4>Character</h4>
          <div class="debug-row">
            <span class="debug-label">ID:</span>
            <span class="debug-value">${this.character?._id || 'None'}</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">Name:</span>
            <span class="debug-value">${this.character?.name || 'None'}</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">Location:</span>
            <span class="debug-value" id="debug-location">--</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">Docked:</span>
            <span class="debug-value" id="debug-docked">--</span>
          </div>
        </div>
        <div class="debug-section">
          <h4>Connection</h4>
          <div class="debug-row">
            <span class="debug-label">Socket:</span>
            <span class="debug-value" id="debug-socket-status">Disconnected</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">Players:</span>
            <span class="debug-value" id="debug-player-count">0</span>
          </div>
        </div>
        <div class="debug-section">
          <h4>View Sync</h4>
          <!-- Sync Indicator (moved from bottom-right corner) -->
          <div id="syncIndicator" style="background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(74, 222, 128, 0.4); border-radius: 3px; padding: 6px 8px; display: flex; align-items: center; gap: 8px; font-family: 'Courier New', monospace; font-size: 0.75em; margin-bottom: 8px;">
            <div id="syncStatus" style="width: 8px; height: 8px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 8px #4ade80;"></div>
            <div id="syncDetails" style="color: #00ff00; white-space: nowrap; flex: 1;">Loading...</div>
            <div id="mapDetails" style="color: #888; font-size: 0.9em; border-left: 1px solid rgba(74, 222, 128, 0.3); padding-left: 8px;">--</div>
            <button id="syncRefreshBtn" style="background: transparent; border: none; color: #4ade80; padding: 0; cursor: pointer; font-size: 1.1em; opacity: 0.7; transition: opacity 0.2s;" title="Refresh" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">⟳</button>
          </div>
          <div class="debug-row">
            <span class="debug-label">Game State:</span>
            <span class="debug-value" id="debug-game-state-status">Checking...</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">Map Assets:</span>
            <span class="debug-value" id="debug-map-assets">--</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">View X:</span>
            <span class="debug-value" id="debug-view-x">--</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">View Y:</span>
            <span class="debug-value" id="debug-view-y">--</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">Zoom:</span>
            <span class="debug-value" id="debug-zoom">--</span>
          </div>
          <div class="debug-row">
            <button class="debug-btn" id="force-sync-btn" title="Force Sync">🔄 Force Sync</button>
            <button class="debug-btn" id="center-character-btn" title="Center on Character">📍 Center</button>
          </div>
        </div>
        <div class="debug-section">
          <h4>⚡ Teleport</h4>
          <div class="debug-row" style="margin-bottom: 8px;">
            <select id="teleport-location-select" style="background: #1a1a1a; border: 1px solid #4ade80; color: #e0e0e0; padding: 4px 8px; font-family: 'Courier New', monospace; font-size: 0.85em; width: 100%; border-radius: 3px;">
              <option value="">Loading locations...</option>
            </select>
          </div>
          <div class="debug-row">
            <button class="debug-btn" id="teleport-btn" style="width: 100%; padding: 6px 12px; background: #1a1a1a; border: 1px solid #f59e0b; color: #f59e0b; cursor: pointer; border-radius: 3px; font-family: 'Courier New', monospace; transition: all 0.2s;">
              🚀 Teleport Character
            </button>
          </div>
          <div id="teleport-status" style="margin-top: 4px; font-size: 0.75em; color: #888; display: none;"></div>
        </div>
        <div class="debug-section">
          <h4>Performance</h4>
          <div class="debug-row">
            <span class="debug-label">FPS:</span>
            <span class="debug-value" id="debug-fps">--</span>
          </div>
          <div class="debug-row">
            <span class="debug-label">Latency:</span>
            <span class="debug-value" id="debug-latency">--</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(toolbar);
    this.toolbar = toolbar;
  }

  attachEventListeners() {
    // Toggle debug info
    document.getElementById('toggle-debug-info')?.addEventListener('click', () => {
      const debugInfo = document.getElementById('tester-debug-info');
      debugInfo.classList.toggle('hidden');
    });

    // Take screenshot
    document.getElementById('take-screenshot')?.addEventListener('click', () => {
      this.takeScreenshot();
    });

    // Create ticket
    document.getElementById('create-ticket')?.addEventListener('click', () => {
      this.openTicketModal();
    });

    // Toggle chat
    document.getElementById('toggle-chat')?.addEventListener('click', () => {
      if (window.globalChat) {
        window.globalChat.toggleChat();
      } else {
        // Fallback if globalChat not initialized
        const chatWindow = document.getElementById('global-chat-window');
        if (chatWindow) {
          chatWindow.classList.toggle('hidden');
          if (!chatWindow.classList.contains('hidden')) {
            const input = document.getElementById('chat-input');
            if (input) input.focus();
          }
        } else {
          console.warn('⚠️ Global chat not initialized yet');
        }
      }
    });

    // Force sync button
    document.getElementById('force-sync-btn')?.addEventListener('click', () => {
      this.forceSyncView();
    });

    // Center on character button
    document.getElementById('center-character-btn')?.addEventListener('click', () => {
      this.centerOnCharacter();
    });

    // Teleport button
    document.getElementById('teleport-btn')?.addEventListener('click', () => {
      this.teleportCharacter();
    });

    // Load teleport locations
    this.loadTeleportLocations();
  }

  updateDebugInfo(data) {
    if (!this.toolbar) return;

    if (data.location && this.character) {
      document.getElementById('debug-location').textContent =
        `(${Math.round(this.character.location.x)}, ${Math.round(this.character.location.y)})`;
      document.getElementById('debug-docked').textContent =
        this.character.location.assetId ? 'Yes' : 'No';
    }

    if (data.socketStatus !== undefined) {
      const statusEl = document.getElementById('debug-socket-status');
      statusEl.textContent = data.socketStatus ? 'Connected' : 'Disconnected';
      statusEl.style.color = data.socketStatus ? '#00ff00' : '#ff0000';
      statusEl.style.textShadow = data.socketStatus ? '0 0 5px rgba(0, 255, 0, 0.5)' : '0 0 5px rgba(255, 0, 0, 0.5)';
    }

    if (data.playerCount !== undefined) {
      document.getElementById('debug-player-count').textContent = data.playerCount;
    }

    if (data.fps !== undefined) {
      document.getElementById('debug-fps').textContent = Math.round(data.fps);
    }

    if (data.latency !== undefined) {
      document.getElementById('debug-latency').textContent = `${data.latency}ms`;
    }
  }

  async takeScreenshot() {
    try {
      // Use html2canvas if available
      if (typeof html2canvas === 'function') {
        const canvas = await html2canvas(document.body, {
          allowTaint: true,
          useCORS: true,
          logging: false
        });

        // Convert to blob
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `screenshot-${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(url);

          this.showNotification('Screenshot saved!', 'success');
        });
      } else {
        this.showNotification('Screenshot library not loaded', 'error');
      }
    } catch (error) {
      console.error('Screenshot failed:', error);
      this.showNotification('Screenshot failed', 'error');
    }
  }

  openTicketModal() {
    // Create ticket modal if it doesn't exist
    let modal = document.getElementById('ticket-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ticket-modal';
      modal.className = 'ticket-modal';
      modal.innerHTML = `
        <div class="ticket-modal-overlay" onclick="window.testerToolbar?.closeTicketModal()"></div>
        <div class="ticket-modal-content">
          <div class="ticket-modal-header">
            <h3>Create Bug Report / Feedback</h3>
            <button class="ticket-modal-close" onclick="window.testerToolbar?.closeTicketModal()">&times;</button>
          </div>
          <div class="ticket-modal-body">
            <form id="ticket-form">
              <div class="form-group">
                <label for="ticket-type">Type</label>
                <select id="ticket-type" required>
                  <option value="bug">Bug Report</option>
                  <option value="feedback">Feedback</option>
                  <option value="feature">Feature Request</option>
                  <option value="ui">UI/UX Issue</option>
                </select>
              </div>
              <div class="form-group">
                <label for="ticket-title">Title</label>
                <input type="text" id="ticket-title" placeholder="Brief description" required>
              </div>
              <div class="form-group">
                <label for="ticket-description">Description</label>
                <textarea id="ticket-description" rows="6" placeholder="Detailed description of the issue or feedback" required></textarea>
              </div>
              <div class="form-group">
                <label for="ticket-severity">Severity</label>
                <select id="ticket-severity">
                  <option value="low">Low - Minor issue</option>
                  <option value="medium" selected>Medium - Affects usability</option>
                  <option value="high">High - Major issue</option>
                  <option value="critical">Critical - Blocks testing</option>
                </select>
              </div>
              <div class="form-group checkbox-group">
                <label>
                  <input type="checkbox" id="ticket-include-screenshot">
                  Include screenshot (auto-captured)
                </label>
              </div>
              <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="window.testerToolbar?.closeTicketModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Submit Ticket</button>
              </div>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Attach form submit handler
      document.getElementById('ticket-form').addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitTicket();
      });
    }

    modal.classList.add('active');
  }

  closeTicketModal() {
    const modal = document.getElementById('ticket-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  }

  async submitTicket() {
    const type = document.getElementById('ticket-type').value;
    const title = document.getElementById('ticket-title').value;
    const description = document.getElementById('ticket-description').value;
    const severity = document.getElementById('ticket-severity').value;
    const includeScreenshot = document.getElementById('ticket-include-screenshot').checked;

    const ticketData = {
      type,
      title,
      description,
      severity,
      userId: this.user._id || this.user.id,
      username: this.user.username,
      characterId: this.character?._id,
      characterName: this.character?.name,
      location: this.character?.location,
      userAgent: navigator.userAgent,
      timestamp: new Date(),
      url: window.location.href
    };

    try {
      const response = await fetch('/api/v1/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketData)
      });

      const result = await response.json();

      if (result.success) {
        this.showNotification('Ticket submitted successfully!', 'success');
        this.closeTicketModal();
        document.getElementById('ticket-form').reset();
      } else {
        this.showNotification('Failed to submit ticket', 'error');
      }
    } catch (error) {
      console.error('Error submitting ticket:', error);
      this.showNotification('Error submitting ticket', 'error');
    }
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `tester-notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('show');
    }, 10);

    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  /**
   * Connect toolbar to Socket.IO for real-time updates
   */
  connectSocket(socket) {
    this.socket = socket;

    // Update socket status
    socket.on('connect', () => {
      this.updateDebugInfo({ socketStatus: true });
    });

    socket.on('disconnect', () => {
      this.updateDebugInfo({ socketStatus: false });
    });

    // Update online player count
    socket.on('onlineCount', (count) => {
      this.updateDebugInfo({ playerCount: count });
    });

    // Measure latency
    this.startLatencyMonitor();
  }

  /**
   * Connect toolbar to map for real-time updates
   */
  connectMap(map) {
    this.map = map;

    // Update location from map
    this.startLocationMonitor();

    // Start FPS monitor
    this.startFPSMonitor();

    // Start sync monitor
    this.startSyncMonitor();
  }

  /**
   * Start monitoring character location
   */
  startLocationMonitor() {
    setInterval(() => {
      if (this.map && this.map.currentCharacter && this.map.currentCharacter.location) {
        const loc = this.map.currentCharacter.location;
        const locStr = `${Math.round(loc.x)},${Math.round(loc.y)}`;

        // Update expanded debug panel
        const debugLoc = document.getElementById('debug-location');
        if (debugLoc) {
          debugLoc.textContent = `(${locStr})`;
        }

        const debugDocked = document.getElementById('debug-docked');
        if (debugDocked) {
          debugDocked.textContent = loc.assetId ? 'Yes' : 'No';
        }

        // Update compact quick view
        const quickLoc = document.getElementById('quick-location');
        if (quickLoc) {
          quickLoc.textContent = locStr;
        }
      }
    }, 1000);
  }

  /**
   * Start monitoring FPS
   */
  startFPSMonitor() {
    let lastTime = performance.now();
    let frameCount = 0;
    let fps = 0;

    const measureFPS = () => {
      const now = performance.now();
      frameCount++;

      if (now - lastTime >= 1000) {
        fps = Math.round((frameCount * 1000) / (now - lastTime));
        this.updateDebugInfo({ fps });

        // Update compact quick view
        const quickFps = document.getElementById('quick-fps');
        if (quickFps) {
          quickFps.textContent = fps;
        }

        frameCount = 0;
        lastTime = now;
      }

      requestAnimationFrame(measureFPS);
    };

    measureFPS();
  }

  /**
   * Start monitoring latency
   */
  startLatencyMonitor() {
    if (!this.socket) return;

    setInterval(() => {
      const startTime = Date.now();

      this.socket.emit('ping', startTime);

      this.socket.once('pong', () => {
        const latency = Date.now() - startTime;
        this.updateDebugInfo({ latency });

        // Update compact quick view
        const quickPing = document.getElementById('quick-ping');
        if (quickPing) {
          quickPing.textContent = `${latency}ms`;
        }
      });
    }, 3000);
  }

  /**
   * Start monitoring view sync status
   */
  startSyncMonitor() {
    if (!this.map) return;

    setInterval(() => {
      // Update map asset count
      const mapAssetsEl = document.getElementById('debug-map-assets');
      if (mapAssetsEl && this.map.publishedAssets) {
        mapAssetsEl.textContent = this.map.publishedAssets.length;
      }

      // Update view position
      const viewXEl = document.getElementById('debug-view-x');
      const viewYEl = document.getElementById('debug-view-y');
      const zoomEl = document.getElementById('debug-zoom');

      if (viewXEl && this.map.offsetX !== undefined) {
        viewXEl.textContent = Math.round(this.map.offsetX);
      }
      if (viewYEl && this.map.offsetY !== undefined) {
        viewYEl.textContent = Math.round(this.map.offsetY);
      }
      if (zoomEl && this.map.scale !== undefined) {
        zoomEl.textContent = `${(this.map.scale * 100).toFixed(0)}%`;
      }
    }, 500);

    // Check game state sync
    this.checkGameStateSync();
    setInterval(() => this.checkGameStateSync(), 10000);
  }

  /**
   * Check game state synchronization
   */
  async checkGameStateSync() {
    const statusEl = document.getElementById('debug-game-state-status');
    if (!statusEl) return;

    try {
      const response = await fetch('/api/v1/characters/check', {
        credentials: 'include'
      });

      if (!response.ok) {
        statusEl.textContent = 'Error';
        statusEl.style.color = '#ef4444';
        return;
      }

      const data = await response.json();

      if (data.gameState && data.gameState.status === 'connected') {
        if (data.sync && data.sync.inSync) {
          statusEl.textContent = '✓ Synced';
          statusEl.style.color = '#00ff00';
          statusEl.style.textShadow = '0 0 5px rgba(0, 255, 0, 0.5)';
        } else {
          statusEl.textContent = '⚠ Out of Sync';
          statusEl.style.color = '#ffff00';
          statusEl.style.textShadow = '0 0 5px rgba(255, 255, 0, 0.5)';
          console.warn('Sync issues:', data.sync?.issues);
        }
      } else {
        statusEl.textContent = `${data.gameState?.status || 'Disconnected'}`;
        statusEl.style.color = '#ff0000';
        statusEl.style.textShadow = '0 0 5px rgba(255, 0, 0, 0.5)';
      }
    } catch (error) {
      console.error('Sync check failed:', error);
      statusEl.textContent = 'Check Failed';
      statusEl.style.color = '#ff0000';
      statusEl.style.textShadow = '0 0 5px rgba(255, 0, 0, 0.5)';
    }
  }

  /**
   * Force sync view with game state
   */
  async forceSyncView() {
    const btn = document.getElementById('force-sync-btn');
    if (!btn) return;

    const originalText = btn.textContent;
    btn.textContent = '🔄 Syncing...';
    btn.disabled = true;

    try {
      // Reload map assets
      if (this.map && this.map.loadPublishedAssets) {
        await this.map.loadPublishedAssets();
      }

      // Reload travel connections
      if (this.map && this.map.loadTravelConnections) {
        await this.map.loadTravelConnections();
      }

      // Check sync status
      await this.checkGameStateSync();

      this.showNotification('View synced successfully', 'success');
    } catch (error) {
      console.error('Force sync failed:', error);
      this.showNotification('Sync failed: ' + error.message, 'error');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }

  /**
   * Center view on current character
   */
  centerOnCharacter() {
    if (!this.map || !this.map.currentCharacter || !this.map.currentCharacter.location) {
      this.showNotification('No character location to center on', 'error');
      return;
    }

    const char = this.map.currentCharacter;

    // Center view on character
    this.map.offsetX = -char.location.x * this.map.scale + this.map.canvas.width / 2;
    this.map.offsetY = -char.location.y * this.map.scale + this.map.canvas.height / 2;

    // Zoom to comfortable level
    this.map.scale = Math.max(0.5, this.map.scale);

    // Update offsets after zoom
    this.map.offsetX = -char.location.x * this.map.scale + this.map.canvas.width / 2;
    this.map.offsetY = -char.location.y * this.map.scale + this.map.canvas.height / 2;

    console.log(`📍 Centered on ${char.name} at (${Math.round(char.location.x)}, ${Math.round(char.location.y)})`);
    this.showNotification(`Centered on ${char.name}`, 'success');
  }

  async loadTeleportLocations() {
    try {
      const response = await fetch('/api/v1/characters/teleport/locations');
      const data = await response.json();

      if (data.success && data.locations) {
        const select = document.getElementById('teleport-location-select');
        if (!select) return;

        select.innerHTML = '<option value="">-- Select Location --</option>';

        data.locations.forEach(loc => {
          const option = document.createElement('option');
          option.value = loc.name;
          option.textContent = `${loc.icon || '📍'} ${loc.name} (${Math.round(loc.x)}, ${Math.round(loc.y)})`;
          option.dataset.x = loc.x;
          option.dataset.y = loc.y;
          option.dataset.description = loc.description;
          select.appendChild(option);
        });

        console.log(`🚀 Loaded ${data.locations.length} teleport locations`);
      }
    } catch (err) {
      console.error('Failed to load teleport locations:', err);
      const select = document.getElementById('teleport-location-select');
      if (select) {
        select.innerHTML = '<option value="">Error loading locations</option>';
      }
    }
  }

  async teleportCharacter() {
    const select = document.getElementById('teleport-location-select');
    const statusDiv = document.getElementById('teleport-status');
    const btn = document.getElementById('teleport-btn');

    if (!select || !this.character) return;

    const locationName = select.value;
    if (!locationName) {
      this.showTeleportStatus('Please select a location', 'error');
      return;
    }

    const selectedOption = select.options[select.selectedIndex];
    const description = selectedOption.dataset.description || locationName;

    // Confirm teleport
    if (!confirm(`Teleport ${this.character.name} to ${locationName}?\n\n${description}`)) {
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = '⏳ Teleporting...';
      this.showTeleportStatus('Teleporting...', 'info');

      const response = await fetch(`/api/v1/characters/${this.character._id}/teleport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ locationName })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        this.showTeleportStatus(`✅ ${data.message}`, 'success');
        this.showNotification(`Teleported to ${locationName}`, 'success');

        // Update character location in memory
        if (this.character && data.location) {
          this.character.location = data.location;
        }

        // Reload the page after short delay to sync map
        setTimeout(() => {
          window.location.reload();
        }, 1000);

        console.log(`🚀 Teleported to ${locationName}:`, data.location);
      } else {
        throw new Error(data.error || 'Teleport failed');
      }
    } catch (err) {
      console.error('Teleport error:', err);
      this.showTeleportStatus(`❌ ${err.message}`, 'error');
      this.showNotification(`Teleport failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🚀 Teleport Character';
    }
  }

  showTeleportStatus(message, type = 'info') {
    const statusDiv = document.getElementById('teleport-status');
    if (!statusDiv) return;

    statusDiv.style.display = 'block';
    statusDiv.textContent = message;

    // Color based on type
    const colors = {
      success: '#4ade80',
      error: '#ef4444',
      info: '#60a5fa',
      warning: '#f59e0b'
    };
    statusDiv.style.color = colors[type] || colors.info;

    // Auto-hide after 5 seconds for success/error
    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 5000);
    }
  }
}

// Global instance
let testerToolbar = null;

function initTesterToolbar(user, character) {
  if (user && user.userRole === 'tester') {
    testerToolbar = new TesterToolbar(user, character);
  }
  return testerToolbar;
}
