// Tour: Email Marketing
(function() {
  var pagePath = window.location.pathname;

  if (pagePath === '/admin/email-marketing') {
    AdminTour.init('email-marketing', [
      {
        popover: {
          title: 'Email Marketing Hub',
          description: 'Manage your contacts, create email campaigns, and track engagement — opens, clicks, and conversions. AI-powered content writing built in.'
        }
      },
      {
        element: '.content > div:first-child',
        popover: {
          title: 'Marketing Stats',
          description: 'Track your contacts, campaigns sent, and funnel stages at a glance. See how many leads, prospects, and customers you have across your pipeline.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.tabs',
        popover: {
          title: 'Contacts & Campaigns',
          description: 'Switch between managing your contact list and creating email campaigns. Import contacts from CSV, sync from your client list, or add manually.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#agentToggle',
        popover: {
          title: 'Marketing Agent',
          description: 'Use the AI agent to draft campaign emails, write compelling subject lines, and generate content. It knows your brand voice and audience.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.topbar-actions',
        popover: {
          title: 'Create a Campaign',
          description: 'Start a new email campaign. Choose recipients by segment, write your content (or let AI draft it), preview, and send — all from one flow.',
          side: 'bottom',
          align: 'end'
        }
      }
    ]);
  }

  // Campaign detail
  if (pagePath.match(/\/admin\/email-marketing\/[a-f0-9]{24}$/)) {
    AdminTour.init('campaign-detail', [
      {
        popover: {
          title: 'Campaign Analytics',
          description: 'Track how your campaign performed — who opened, who clicked, and which links got the most engagement.'
        }
      },
      {
        element: '.stat-grid',
        popover: {
          title: 'Engagement Stats',
          description: 'See counts for Sent, Opened, Unopened, and Clicked. These update as recipients interact with your email.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.engFilter',
        popover: {
          title: 'Filter by Engagement',
          description: 'Filter the recipient list by engagement level — see who opened, who clicked, or who has not opened yet. Useful for planning follow-up campaigns.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#fuSegment',
        popover: {
          title: 'Follow-Up Campaign',
          description: 'Create a follow-up targeting a specific segment — like people who opened but did not click. Set the segment, write a new message, and send.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#agentToggle',
        popover: {
          title: 'Campaign Agent',
          description: 'Open the AI agent to help draft your follow-up email. It can analyze what worked in the original campaign and suggest improvements.',
          side: 'bottom',
          align: 'end'
        }
      }
    ]);
  }
})();
