// Tour: Support Tickets
(function() {
  var pagePath = window.location.pathname;

  // Ticket list
  if (pagePath === '/admin/tickets') {
    AdminTour.init('tickets', [
      {
        popover: {
          title: 'Support Tickets',
          description: 'Track and manage support requests from your clients, team, or visitors. Tickets can be created from the floating button on any page, or manually here.'
        }
      },
      {
        element: '.stat-grid',
        popover: {
          title: 'Ticket Stats',
          description: 'See at a glance how many tickets are Open, In Progress, Escalated, Resolved, and Closed. Red numbers need your attention.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.topbar-actions',
        popover: {
          title: 'Create a Ticket',
          description: 'Click "+ New Ticket" to manually file a support request. Set the category, priority, and assign to a team member.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.btn-sm',
        popover: {
          title: 'Filter by Status',
          description: 'Use these filter buttons to show only tickets with a specific status. Combine with category or priority filters for precise results.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.table-wrap',
        popover: {
          title: 'Ticket List',
          description: 'All tickets sorted by newest first. Click any row to see full details, reply to the submitter, change status, or escalate to platform support.',
          side: 'top',
          align: 'start'
        }
      }
    ]);
  }

  // Ticket detail
  if (pagePath.match(/\/admin\/tickets\/[a-f0-9]{24}$/)) {
    AdminTour.init('ticket-detail', [
      {
        element: '.actions-bar',
        popover: {
          title: 'Ticket Actions',
          description: 'Resolve, Close, or Escalate this ticket. Escalation sends it to platform support (superadmin) for issues you cannot resolve at the tenant level.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#statusSelect',
        popover: {
          title: 'Status Selector',
          description: 'Change the ticket status — Open, In Progress, or Escalated. Changes save instantly, no page reload needed.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.ticket-meta',
        popover: {
          title: 'Ticket Metadata',
          description: 'See who submitted this ticket, its priority, category, and assignment. Escalation details appear here if the ticket has been escalated.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.debug-panel',
        popover: {
          title: 'Debug Data',
          description: 'When tickets are submitted via the bug button, debug data is captured — console errors, server logs, and client context. Click headers to expand each section.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '.reply-thread',
        popover: {
          title: 'Reply Thread',
          description: 'Communicate with the ticket submitter here. Add replies with text and file attachments. The full conversation thread is preserved.',
          side: 'top',
          align: 'start'
        }
      }
    ]);
  }
})();
