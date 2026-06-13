/**
 * Client-Side Analytics Tracker
 * Tracks user interactions on the frontend
 */

class AnalyticsTracker {
  constructor() {
    this.sessionStart = Date.now();
    this.actionsQueue = [];
    this.flushInterval = 5000; // Flush every 5 seconds
    this.init();
  }

  init() {
    // Track page load
    this.trackAction('page_load', {
      url: window.location.href,
      referrer: document.referrer
    });

    // Track time on page
    window.addEventListener('beforeunload', () => {
      const timeOnPage = Math.floor((Date.now() - this.sessionStart) / 1000);
      this.trackAction('page_unload', {
        url: window.location.href,
        timeOnPage
      }, true); // Synchronous send
    });

    // Track clicks on important elements
    this.setupClickTracking();

    // Start flush interval
    setInterval(() => this.flush(), this.flushInterval);
  }

  setupClickTracking() {
    // Track button clicks
    document.addEventListener('click', (e) => {
      const target = e.target.closest('button, a, [data-track]');
      if (target) {
        const actionData = {
          element: target.tagName.toLowerCase(),
          text: target.textContent?.trim().substring(0, 50),
          href: target.href || null,
          trackLabel: target.dataset.track || null
        };

        this.trackAction('click', actionData);
      }
    });
  }

  /**
   * Track a user action
   */
  trackAction(actionType, metadata = {}, sync = false) {
    const action = {
      actionType,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`
      }
    };

    if (sync) {
      // Send immediately using sendBeacon for page unload
      this.sendAction(action, true);
    } else {
      this.actionsQueue.push(action);
    }
  }

  /**
   * Flush queued actions to server
   */
  async flush() {
    if (this.actionsQueue.length === 0) return;

    const actions = [...this.actionsQueue];
    this.actionsQueue = [];

    for (const action of actions) {
      await this.sendAction(action);
    }
  }

  /**
   * Send action to server
   */
  async sendAction(action, useBeacon = false) {
    try {
      if (useBeacon && navigator.sendBeacon) {
        // Use sendBeacon for guaranteed delivery on page unload
        const blob = new Blob([JSON.stringify(action)], { type: 'application/json' });
        navigator.sendBeacon('/admin/api/track-action', blob);
      } else {
        // Use fetch for normal tracking
        await fetch('/admin/api/track-action', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(action),
          credentials: 'same-origin'
        });
      }
    } catch (error) {
      console.error('Error sending analytics:', error);
    }
  }

  /**
   * Track custom event
   */
  track(eventName, data = {}) {
    this.trackAction(eventName, data);
  }
}

// Initialize tracker
const analytics = new AnalyticsTracker();

// Export for use in other scripts
window.analytics = analytics;
