// Tour: Clients
(function() {
  var pagePath = window.location.pathname;

  // Client list
  if (pagePath === '/admin/clients') {
    AdminTour.init('clients', [
      {
        popover: {
          title: 'Client Management',
          description: 'Track all your clients in one place — contact info, status, invoices, files, and meeting history. Each client gets their own portal too.'
        }
      },
      {
        element: '.topbar-actions',
        popover: {
          title: 'Add a Client',
          description: 'Click "+ New Client" to create a client record with their contact details, company info, and initial status (Prospect, Active, or Inactive).',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.table-wrap',
        popover: {
          title: 'Client List',
          description: 'View all your clients with their status. Click any name to open their full detail page with invoices, files, meeting history, and AI research.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '.status-toggle',
        popover: {
          title: 'Quick Status Change',
          description: 'Change a client\'s status directly from the list — Prospect, Active, or Inactive. The change saves automatically, no page reload needed.',
          side: 'left',
          align: 'start'
        }
      }
    ]);
  }

  // Client detail
  if (pagePath.match(/\/admin\/clients\/[a-f0-9]{24}$/)) {
    AdminTour.init('client-detail', [
      {
        popover: {
          title: 'Client Profile',
          description: 'Everything about this client is organized here — meetings, invoices, files, emails, and AI research. Use the tabs to navigate between sections.'
        }
      },
      {
        element: '#startMeetingBtn',
        popover: {
          title: 'Start a Meeting',
          description: 'Create a video meeting room and email the invite link to this client. Notes and files shared during the meeting are saved automatically.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '#openAgentBtn',
        popover: {
          title: 'AI Research',
          description: 'Let the AI agent research this client\'s business online. It generates a report with industry analysis, competitors, and tailored service recommendations.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.tabs',
        popover: {
          title: 'Client Tabs',
          description: 'Switch between Overview (contact & notes), Invoices (billing history), Assets (shared files), Files, Emails (sent correspondence), and Onboarding progress.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.tab-overview',
        popover: {
          title: 'Overview Tab',
          description: 'See contact details, company info, and internal notes. Quick access to the most important client information at a glance.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.tab-invoices',
        popover: {
          title: 'Invoices Tab',
          description: 'View and create invoices for this client. Track payment status, send reminders, and see complete billing history all in one place.',
          side: 'bottom',
          align: 'start'
        }
      }
    ]);
  }
})();
