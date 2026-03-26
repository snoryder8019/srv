// Tour: Dashboard
(function() {
  AdminTour.init('dashboard', [
    {
      element: '.stat-grid',
      popover: {
        title: 'Your Site at a Glance',
        description: 'These cards show your key metrics — portfolio items, clients, open invoices, blog posts, and pages. Keep an eye on them to track growth.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.agent-card',
      popover: {
        title: 'Meet Your AI Assistant',
        description: 'This is the Master Agent. It can write blog posts, update site copy, create sections, modify design settings, and more — all from one chat interface.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-quick-wrap',
      popover: {
        title: 'Quick Prompt Suggestions',
        description: 'Click any chip to send a pre-written prompt to the agent, or hit the refresh button to cycle through more ideas.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-input',
      popover: {
        title: 'Chat with the Agent',
        description: 'Type any request here — like "Write a blog post about local SEO" or "Change the color scheme to dark blue." The agent will research and execute.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-workflow',
      popover: {
        title: 'Workflow Checklist',
        description: 'When the agent plans multi-step tasks, they appear here. You can run them all at once or step through individually.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.quick-actions-grid',
      popover: {
        title: 'Quick Actions',
        description: 'Jump straight to creating a new blog post, page, or portfolio item — or head to settings to customize your site.',
        side: 'left',
        align: 'start'
      }
    }
  ]);
})();
