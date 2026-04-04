// Tour: What's New — highlights recent platform features
// Auto-plays once on the dashboard for users who haven't seen it
(function() {
  if (window.location.pathname !== '/admin') return;

  AdminTour.init('whats-new', [
    {
      popover: {
        title: 'What\'s New in sLab',
        description: 'We have added several new features to help you manage your site better. Here is a quick overview of what is new.'
      }
    },
    {
      popover: {
        title: 'Support Ticket System',
        description: 'A full ticketing system is now built in. Clients and visitors can submit issues via the floating button on any page. You can track, reply, escalate, and resolve — all from the admin panel. Find it under Business > Support Tickets.'
      }
    },
    {
      popover: {
        title: 'Social Media Generator',
        description: 'Create branded social media graphics without leaving the platform. Canvas-based editor with layer support, size presets for every platform, and AI-powered background generation. Find it under Assets > Social Generator.'
      }
    },
    {
      popover: {
        title: 'Video Trimmer',
        description: 'Clip and trim video files right in your browser. Set trim points visually, preview the selection, and upload the result directly to your asset library. Find it under Assets > Video Trimmer.'
      }
    },
    {
      popover: {
        title: 'Interactive Tutorials',
        description: 'Every page now has a guided tour that walks you through its features. Tours auto-play on first visit. Click the ? button in the bottom-right to replay any time, or visit Profile to track your progress.'
      }
    },
    {
      popover: {
        title: 'Stop Tutorials Option',
        description: 'Every tour step now has a "Stop tutorials" link. Click it to turn off auto-play across the entire platform. You can always replay tours manually via the help button or your Profile page.'
      }
    },
    {
      popover: {
        title: 'Campaign Follow-Ups',
        description: 'After sending an email campaign, you can now create targeted follow-ups based on engagement. Filter by who opened, clicked, or ignored — then send a follow-up just to that segment.'
      }
    },
    {
      element: '.quick-actions-grid',
      popover: {
        title: 'Explore the New Features',
        description: 'Use the sidebar navigation or quick actions to try the new features. Each page has its own tutorial to guide you through. Enjoy!',
        side: 'left',
        align: 'start'
      }
    }
  ]);
})();
