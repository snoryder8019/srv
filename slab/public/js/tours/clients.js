// Tour: Clients
(function() {
  var pagePath = window.location.pathname;

  // Client list
  if (pagePath === '/admin/clients') {
    AdminTour.init('clients', [
      {
        element: '.topbar-actions',
        popover: {
          title: 'Add a Client',
          description: 'Click "+ New Client" to create a client record. Track their contact info, status, and onboarding progress all in one place.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.table-wrap',
        popover: {
          title: 'Client List',
          description: 'View all your clients with their status (Prospect, Active, Inactive). Click a name to open their full detail page with invoices, files, and notes.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '.status-toggle',
        popover: {
          title: 'Quick Status Change',
          description: 'Change a client\'s status right from the list — no need to open their profile. The change saves automatically.',
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
        element: '#startMeetingBtn',
        popover: {
          title: 'Start a Meeting',
          description: 'Create a video meeting and email the invite link to this client. Notes and files shared during the meeting are saved here.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '#openAgentBtn',
        popover: {
          title: 'AI Research',
          description: 'Let the AI agent research this client\'s business online. It generates a report with industry, competitors, and service recommendations.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.tabs',
        popover: {
          title: 'Client Tabs',
          description: 'Switch between Overview, Invoices, Assets, Files, Emails, and Onboarding. Everything about this client is organized here.',
          side: 'bottom',
          align: 'start'
        }
      }
    ]);
  }
})();
