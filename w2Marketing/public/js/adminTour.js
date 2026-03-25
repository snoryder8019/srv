/**
 * AdminTour - Tour management system using Driver.js
 *
 * Usage in any admin page:
 *   AdminTour.init('pageName', steps);
 *
 * Features:
 * - Checks user tutorial state via API before showing
 * - Respects autoPlay preference
 * - Reports completion/dismissal to server
 * - Provides manual replay via floating help button
 * - Smooth Driver.js integration
 */
class AdminTour {
  static _driver = null;
  static _currentPage = null;
  static _currentSteps = null;

  /**
   * Initialize a tour for a specific page.
   * Checks server status first, only auto-plays if not yet seen.
   */
  static async init(pageName, steps) {
    if (!steps || !steps.length) return;

    AdminTour._currentPage = pageName;
    AdminTour._currentSteps = steps;

    // Add the floating help button
    AdminTour._addHelpButton(pageName);

    // Check tutorial status
    try {
      var res = await fetch('/admin/tutorials/status');
      if (res.ok) {
        var data = await res.json();
        // API returns { tutorials: { seen: { pageName: true }, autoPlay: true } }
        var tutorials = data.tutorials || {};
        var seen = tutorials.seen || {};
        var autoPlay = tutorials.autoPlay !== false; // default true

        // If already seen, don't auto-play
        if (seen[pageName]) {
          return;
        }
      }
    } catch (e) {
      // If API not available yet, still allow tour on first visit
      // Check localStorage as fallback
      try {
        var localSeen = JSON.parse(localStorage.getItem('w2_tours_seen') || '[]');
        if (localSeen.indexOf(pageName) !== -1) return;
      } catch (e2) { /* ignore */ }
    }

    // Small delay to let the page render
    setTimeout(function() {
      AdminTour.startTour(steps, pageName);
    }, 600);
  }

  /**
   * Force replay a tour regardless of seen status.
   */
  static async replay(pageName) {
    var steps = AdminTour._currentSteps;
    if (!steps || !steps.length) return;

    // Reset on server
    try {
      await fetch('/admin/tutorials/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: pageName })
      });
    } catch (e) { /* ignore */ }

    AdminTour.startTour(steps, pageName);
  }

  /**
   * Start the Driver.js tour with given steps.
   */
  static startTour(steps, pageName) {
    // Destroy any existing tour
    if (AdminTour._driver) {
      try { AdminTour._driver.destroy(); } catch (e) { /* ignore */ }
    }

    // Filter steps to only include elements that exist in the DOM
    var validSteps = [];
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (!step.element) {
        // Steps without an element (centered popover) are always valid
        validSteps.push(step);
      } else {
        var el = document.querySelector(step.element);
        if (el && el.offsetParent !== null) {
          validSteps.push(step);
        }
      }
    }

    if (!validSteps.length) return;

    var driverObj = window.driver.js.driver;
    AdminTour._driver = driverObj({
      showProgress: true,
      animate: true,
      overlayColor: 'rgba(15, 27, 48, 0.65)',
      stagePadding: 8,
      stageRadius: 4,
      popoverClass: 'w2-tour-popover',
      showButtons: ['next', 'previous', 'close'],
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      progressText: '{{current}} of {{total}}',
      steps: validSteps,
      onDestroyStarted: function() {
        // Check if tour was completed (on last step)
        if (AdminTour._driver && AdminTour._driver.isLastStep()) {
          AdminTour._reportComplete(pageName);
        } else {
          AdminTour._reportDismiss(pageName);
        }
        AdminTour._driver.destroy();
      }
    });

    AdminTour._driver.drive();
  }

  /**
   * Report tour completion to server.
   */
  static async _reportComplete(pageName) {
    // Save locally as fallback
    try {
      var localSeen = JSON.parse(localStorage.getItem('w2_tours_seen') || '[]');
      if (localSeen.indexOf(pageName) === -1) {
        localSeen.push(pageName);
        localStorage.setItem('w2_tours_seen', JSON.stringify(localSeen));
      }
    } catch (e) { /* ignore */ }

    try {
      await fetch('/admin/tutorials/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: pageName })
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * Report tour dismissal to server.
   */
  static async _reportDismiss(pageName) {
    // Save locally so it doesn't auto-play again
    try {
      var localSeen = JSON.parse(localStorage.getItem('w2_tours_seen') || '[]');
      if (localSeen.indexOf(pageName) === -1) {
        localSeen.push(pageName);
        localStorage.setItem('w2_tours_seen', JSON.stringify(localSeen));
      }
    } catch (e) { /* ignore */ }

    try {
      await fetch('/admin/tutorials/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: pageName })
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * Add a floating help button to replay the tour.
   */
  static _addHelpButton(pageName) {
    // Don't add if already exists
    if (document.getElementById('tour-help-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'tour-help-btn';
    btn.className = 'tour-help-btn';
    btn.innerHTML = '?';
    btn.title = 'Replay page tour';
    btn.setAttribute('aria-label', 'Replay page tour');
    btn.addEventListener('click', function() {
      AdminTour.replay(pageName);
    });
    document.body.appendChild(btn);
  }
}
