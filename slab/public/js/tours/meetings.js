// Tour: Meetings
(function() {
  AdminTour.init('meetings', [
    {
      element: '.topbar-actions',
      popover: {
        title: 'Create a Meeting',
        description: 'Click "+ New Meeting" to generate a secure meeting room. Set an expiration, max participants, and tag clients or team members.',
        side: 'bottom',
        align: 'end'
      }
    },
    {
      element: '.table-wrap',
      popover: {
        title: 'Active Meetings',
        description: 'Your live meetings appear here with their invite links. Copy the link to share with clients, or join directly from this page.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.hist-card',
      popover: {
        title: 'Meeting History',
        description: 'Click any past meeting to expand it. You can review participants, notes taken during the call, and any files that were shared.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
