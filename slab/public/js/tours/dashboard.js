// Tour: Dashboard
(function() {
  AdminTour.init('dashboard', [
    {
      popover: {
        title: 'Welcome to Your Dashboard',
        description: 'This is your command center. From here you can monitor your site, manage content, and chat with your AI assistant — all in one place.'
      }
    },
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
        description: 'Click any chip to send a pre-written prompt to the agent, or hit the refresh button to cycle through more ideas. Great for discovering what the agent can do.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-input',
      popover: {
        title: 'Chat with the Agent',
        description: 'Type any request here — like "Write a blog post about local SEO" or "Change the color scheme to dark blue." The agent will research your site context and execute.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-voice-select',
      popover: {
        title: 'Voice Controls',
        description: 'Pick a text-to-speech voice to have agent responses read aloud. Use the mic button to speak your requests instead of typing.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-result',
      popover: {
        title: 'Agent Results',
        description: 'When the agent generates content, the result appears here. Use "Apply Now" to save directly to your site, or "Open in Editor" to review and tweak first.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-workflow',
      popover: {
        title: 'Workflow Checklist',
        description: 'When the agent plans multi-step tasks, they appear here as a checklist. Run them all at once or step through individually for more control.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.quick-actions-grid',
      popover: {
        title: 'Quick Actions',
        description: 'Jump straight to creating a new blog post, page, or portfolio item — or head to settings to customize your site. These shortcuts save you clicks.',
        side: 'left',
        align: 'start'
      }
    }
  ]);
})();
