// Tour: Profile & Tutorial Progress
(function() {
  AdminTour.init('profile', [
    {
      popover: {
        title: 'Your Profile',
        description: 'Manage your account details and track your tutorial progress. This is also where you control whether tours auto-play on new pages.'
      }
    },
    {
      element: '.profile-header',
      popover: {
        title: 'Account Info',
        description: 'Your display name, email, and role. Update your display name here — it appears in ticket submissions, meeting notes, and email signatures.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.progress-wrap',
      popover: {
        title: 'Tutorial Progress',
        description: 'See how many page tutorials you have completed. The progress bar fills as you finish tours across the platform.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.tutorial-list',
      popover: {
        title: 'Tutorial Checklist',
        description: 'Each tutorial is listed with its completion status. Click "Replay" to watch any tour again, or "Mark Complete" to skip one you do not need.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#resetAllBtn',
      popover: {
        title: 'Reset Tutorials',
        description: 'Reset all tutorials to unseen. Useful if you want a fresh walkthrough after platform updates or if a new team member is using your account.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
