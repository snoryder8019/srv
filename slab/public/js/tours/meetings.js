// Tour: Meetings
(function() {
  var pagePath = window.location.pathname;

  if (pagePath === '/admin/meetings') {
    AdminTour.init('meetings', [
      {
        popover: {
          title: 'Meeting Room',
          description: 'Create secure video meetings, share links with clients, and keep a history of all calls with notes and shared files.'
        }
      },
      {
        element: '.topbar-actions',
        popover: {
          title: 'Create a Meeting',
          description: 'Click "+ New Meeting" to generate a secure meeting room. Set an expiration time, max participants, and optionally tag clients or team members.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '#createModal',
        popover: {
          title: 'Meeting Settings',
          description: 'Configure your meeting — set a title, expiration (auto-close after time), participant limit, and choose which clients to invite.',
          side: 'left',
          align: 'start'
        }
      },
      {
        element: '.table-wrap',
        popover: {
          title: 'Active Meetings',
          description: 'Your live meetings appear here with their invite links. Copy the link to share with clients via email or chat, or join directly from this page.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.hist-card',
        popover: {
          title: 'Meeting History',
          description: 'Past meetings are saved here with participants, notes, and shared files. Click any meeting to see its full detail — including QR codes and tagged clients.',
          side: 'top',
          align: 'start'
        }
      }
    ]);
  }

  // Meeting detail
  if (pagePath.match(/\/admin\/meetings\/[a-f0-9]{24}$/)) {
    AdminTour.init('meeting-detail', [
      {
        element: '#detail-link',
        popover: {
          title: 'Meeting Link',
          description: 'Copy this link and share it with participants. Anyone with the link can join while the meeting is active.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#detail-qr',
        popover: {
          title: 'QR Code',
          description: 'Scan this QR code to join the meeting from a mobile device. Great for in-person handoffs — no need to type the URL.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#tags-display',
        popover: {
          title: 'Tagged Participants',
          description: 'Tag clients and team members to this meeting for easy reference. Tagged meetings appear in their client profile automatically.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.table-wrap',
        popover: {
          title: 'Shared Assets',
          description: 'Files shared during the meeting are saved here. View images and PDFs directly, or download any file for offline use.',
          side: 'top',
          align: 'start'
        }
      }
    ]);
  }
})();
