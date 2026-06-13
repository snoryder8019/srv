/**
 * Activity Monitor Client Script
 * Monitors activity token status and shows "Keep Playing" popup
 */

class ActivityMonitor {
  constructor() {
    this.checkInterval = null;
    this.warningShown = false;
    this.tokenStatus = null;
    this.CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
    this.WARNING_THRESHOLD_MS = 2 * 60 * 1000; // Show warning at 2 minutes remaining
  }

  /**
   * Initialize activity monitor
   */
  async init() {
    console.log('🔍 Activity monitor initializing...');

    // Create popup HTML if it doesn't exist
    this.createPopup();

    // Start checking token status
    await this.checkTokenStatus();
    this.startMonitoring();

    // Listen for user activity to potentially hide warning
    this.setupActivityListeners();
  }

  /**
   * Create the keep-playing popup HTML
   */
  createPopup() {
    if (document.getElementById('activity-popup')) {
      return; // Already exists
    }

    const popup = document.createElement('div');
    popup.id = 'activity-popup';
    popup.className = 'activity-popup hidden';
    popup.innerHTML = `
      <div class="activity-popup-overlay"></div>
      <div class="activity-popup-content">
        <div class="activity-popup-header">
          <h2>Session Expiring Soon</h2>
          <button class="activity-popup-close" aria-label="Close">&times;</button>
        </div>
        <div class="activity-popup-body">
          <p class="activity-message">
            Your session will expire in <span class="time-remaining">2 minutes</span>.
          </p>
          <p class="activity-submessage">
            Click "Keep Playing" to extend your session by another 20 minutes.
          </p>
        </div>
        <div class="activity-popup-footer">
          <button class="btn btn-secondary activity-btn-logout">
            Return to Character Selection
          </button>
          <button class="btn btn-primary activity-btn-renew">
            Keep Playing
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(popup);

    // Add event listeners
    popup.querySelector('.activity-popup-close').addEventListener('click', () => {
      this.hidePopup();
    });

    popup.querySelector('.activity-btn-renew').addEventListener('click', () => {
      this.renewToken();
    });

    popup.querySelector('.activity-btn-logout').addEventListener('click', () => {
      this.logout();
    });

    // Close on overlay click
    popup.querySelector('.activity-popup-overlay').addEventListener('click', () => {
      this.hidePopup();
    });
  }

  /**
   * Start monitoring token status
   */
  startMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.checkTokenStatus();
    }, this.CHECK_INTERVAL_MS);

    console.log('✅ Activity monitoring started');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('⏹️ Activity monitoring stopped');
  }

  /**
   * Check current token status
   */
  async checkTokenStatus() {
    try {
      const response = await fetch('/api/v1/activity/token/status', {
        credentials: 'include'
      });

      if (!response.ok) {
        console.error('Failed to check token status:', response.status);
        return;
      }

      const status = await response.json();
      this.tokenStatus = status;

      if (!status.active) {
        console.log('⚠️ No active token - redirecting to character selection');
        this.redirectToCharacterSelection(status.reason || 'no_token');
        return;
      }

      // Check if we should show warning
      const timeRemainingMs = status.timeRemaining;
      const minutes = Math.floor(timeRemainingMs / 60000);
      const seconds = Math.floor((timeRemainingMs % 60000) / 1000);

      console.log(`⏱️ Token expires in ${minutes}m ${seconds}s`);

      // Show warning if less than WARNING_THRESHOLD_MS remaining
      if (timeRemainingMs <= this.WARNING_THRESHOLD_MS && !this.warningShown) {
        this.showPopup(timeRemainingMs);
      }

      // Update time display if popup is visible
      if (!document.getElementById('activity-popup').classList.contains('hidden')) {
        this.updateTimeDisplay(timeRemainingMs);
      }

    } catch (error) {
      console.error('Error checking token status:', error);
    }
  }

  /**
   * Show the keep-playing popup
   */
  showPopup(timeRemaining) {
    const popup = document.getElementById('activity-popup');
    if (!popup) return;

    this.warningShown = true;
    this.updateTimeDisplay(timeRemaining);

    popup.classList.remove('hidden');
    popup.classList.add('visible');

    console.log('⚠️ Session expiring warning shown');
  }

  /**
   * Hide the popup
   */
  hidePopup() {
    const popup = document.getElementById('activity-popup');
    if (!popup) return;

    popup.classList.remove('visible');
    popup.classList.add('hidden');
  }

  /**
   * Update time remaining display
   */
  updateTimeDisplay(timeRemainingMs) {
    const timeElement = document.querySelector('.time-remaining');
    if (!timeElement) return;

    const minutes = Math.floor(timeRemainingMs / 60000);
    const seconds = Math.floor((timeRemainingMs % 60000) / 1000);

    if (minutes > 0) {
      timeElement.textContent = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
      timeElement.textContent = `${seconds} second${seconds !== 1 ? 's' : ''}`;
    }
  }

  /**
   * Renew the activity token
   */
  async renewToken() {
    try {
      const response = await fetch('/api/v1/activity/token/renew', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to renew token:', error);

        // Token might be expired - redirect to character selection
        if (error.reason === 'token_not_found' || error.reason === 'token_expired') {
          this.redirectToCharacterSelection('expired');
          return;
        }

        this.showError('Failed to renew session');
        return;
      }

      const result = await response.json();
      console.log('✅ Token renewed:', result);

      // Reset warning state
      this.warningShown = false;
      this.hidePopup();

      // Show success message
      this.showSuccess('Session extended by 20 minutes');

    } catch (error) {
      console.error('Error renewing token:', error);
      this.showError('Network error - please try again');
    }
  }

  /**
   * Logout and return to character selection
   */
  async logout() {
    try {
      await fetch('/api/v1/activity/token/invalidate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      this.redirectToCharacterSelection('user_logout');
    } catch (error) {
      console.error('Error logging out:', error);
      // Redirect anyway
      this.redirectToCharacterSelection('user_logout');
    }
  }

  /**
   * Redirect to character selection
   */
  redirectToCharacterSelection(reason) {
    this.stopMonitoring();
    window.location.href = `/characters?reason=${reason}&expired=true`;
  }

  /**
   * Setup activity listeners
   */
  setupActivityListeners() {
    // Could be extended to track user interactions
    // For now, just basic detection
  }

  /**
   * Show success message
   */
  showSuccess(message) {
    // Create a simple toast notification
    const toast = document.createElement('div');
    toast.className = 'activity-toast activity-toast-success';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('show');
    }, 100);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Show error message
   */
  showError(message) {
    const toast = document.createElement('div');
    toast.className = 'activity-toast activity-toast-error';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('show');
    }, 100);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stopMonitoring();
    const popup = document.getElementById('activity-popup');
    if (popup) {
      popup.remove();
    }
  }
}

// Auto-initialize on page load
let activityMonitor = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    activityMonitor = new ActivityMonitor();
    activityMonitor.init();
  });
} else {
  activityMonitor = new ActivityMonitor();
  activityMonitor.init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (activityMonitor) {
    activityMonitor.destroy();
  }
});

// Export for manual control if needed
window.ActivityMonitor = ActivityMonitor;
window.activityMonitor = activityMonitor;
