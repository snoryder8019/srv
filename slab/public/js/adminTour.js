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
 * - "Stop tutorials" option in every popover
 * - Progress badge on help button
 */
class AdminTour {
  static _driver = null;
  static _currentPage = null;
  static _currentSteps = null;
  static _tutorialState = null; // cached from /status

  /**
   * Initialize a tour for a specific page.
   * Checks server status first, only auto-plays if not yet seen.
   */
  static async init(pageName, steps) {
    if (!steps || !steps.length) return;

    AdminTour._currentPage = pageName;
    AdminTour._currentSteps = steps;

    // Check tutorial status
    var autoPlay = true;
    var pageSeen = false;
    try {
      var res = await fetch('/admin/tutorials/status');
      if (res.ok) {
        var data = await res.json();
        var tutorials = data.tutorials || {};
        AdminTour._tutorialState = tutorials;
        var seen = tutorials.seen || {};
        autoPlay = tutorials.autoPlay !== false;
        pageSeen = !!seen[pageName];
      }
    } catch (e) {
      try {
        var localSeen = JSON.parse(localStorage.getItem('slab_tours_seen') || '[]');
        pageSeen = localSeen.indexOf(pageName) !== -1;
      } catch (e2) { /* ignore */ }
    }

    // Add the floating help button (with state)
    AdminTour._addHelpButton(pageName, pageSeen);

    // If already seen or autoPlay is off, don't auto-play
    if (pageSeen || !autoPlay) return;

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
   * Stop all tutorials — set autoPlay false, dismiss current, update button.
   */
  static async stopAll() {
    // Dismiss current tour
    if (AdminTour._driver) {
      try { AdminTour._driver.destroy(); } catch (e) { /* ignore */ }
      AdminTour._driver = null;
    }

    // Set autoPlay false on server
    try {
      await fetch('/admin/tutorials/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoPlay: false })
      });
    } catch (e) { /* ignore */ }

    // Update cached state
    if (AdminTour._tutorialState) AdminTour._tutorialState.autoPlay = false;

    // Update help button to reflect stopped state
    AdminTour._updateHelpButton(true);
  }

  /**
   * Resume tutorials — set autoPlay true, update button.
   */
  static async resumeAll() {
    try {
      await fetch('/admin/tutorials/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoPlay: true })
      });
    } catch (e) { /* ignore */ }

    if (AdminTour._tutorialState) AdminTour._tutorialState.autoPlay = true;
    AdminTour._updateHelpButton(false);
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
      onPopoverRender: function(popover) {
        // Inject "Stop tutorials" link in footer
        var footer = popover.footerButtons;
        if (!footer) return;
        var stopLink = document.createElement('button');
        stopLink.className = 'tour-stop-link';
        stopLink.textContent = 'Stop tutorials';
        stopLink.title = 'Turn off auto-play for all tutorials';
        stopLink.addEventListener('click', function(e) {
          e.stopPropagation();
          AdminTour.stopAll();
        });
        footer.parentNode.appendChild(stopLink);
      },
      onDestroyStarted: function() {
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
   * Report tour completion to server + update help button.
   */
  static async _reportComplete(pageName) {
    try {
      var localSeen = JSON.parse(localStorage.getItem('slab_tours_seen') || '[]');
      if (localSeen.indexOf(pageName) === -1) {
        localSeen.push(pageName);
        localStorage.setItem('slab_tours_seen', JSON.stringify(localSeen));
      }
    } catch (e) { /* ignore */ }

    try {
      await fetch('/admin/tutorials/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: pageName })
      });
    } catch (e) { /* ignore */ }

    // Mark help button as completed
    var btn = document.getElementById('tour-help-btn');
    if (btn) {
      btn.classList.add('tour-seen');
      btn.innerHTML = '&#10003;';
    }
  }

  /**
   * Report tour dismissal to server.
   */
  static async _reportDismiss(pageName) {
    try {
      var localSeen = JSON.parse(localStorage.getItem('slab_tours_seen') || '[]');
      if (localSeen.indexOf(pageName) === -1) {
        localSeen.push(pageName);
        localStorage.setItem('slab_tours_seen', JSON.stringify(localSeen));
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
   * Update help button visual state.
   */
  static _updateHelpButton(stopped) {
    var btn = document.getElementById('tour-help-btn');
    if (!btn) return;
    if (stopped) {
      btn.classList.add('tour-stopped');
      btn.title = 'Tutorials paused — click to replay this page';
    } else {
      btn.classList.remove('tour-stopped');
      btn.title = 'Replay page tour';
    }
  }

  /**
   * Add a floating help button with seen/unseen state.
   */
  static _addHelpButton(pageName, pageSeen) {
    if (document.getElementById('tour-help-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'tour-help-btn';
    btn.className = 'tour-help-btn' + (pageSeen ? ' tour-seen' : '');
    btn.innerHTML = pageSeen ? '&#10003;' : '?';
    btn.title = pageSeen ? 'Tour completed — click to replay' : 'Replay page tour';
    btn.setAttribute('aria-label', 'Replay page tour');

    // Check if tutorials are stopped
    var autoPlay = AdminTour._tutorialState ? AdminTour._tutorialState.autoPlay !== false : true;
    if (!autoPlay) btn.classList.add('tour-stopped');

    btn.addEventListener('click', function() {
      AdminTour.replay(pageName);
    });
    document.body.appendChild(btn);
  }
}
