// Tour: Site Copy
(function() {
  AdminTour.init('copy', [
    {
      element: '#agentToggle',
      popover: {
        title: 'Copy Agent',
        description: 'Open the AI assistant to auto-write or refine your site copy. It can fill individual sections or rewrite everything at once.',
        side: 'bottom',
        align: 'end'
      }
    },
    {
      element: '#copyForm .card',
      popover: {
        title: 'Section-by-Section Editing',
        description: 'Your site copy is organized by section — Hero, Services, About, Process, and Contact. Edit any field directly or let the AI fill them in.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.ai-badge',
      popover: {
        title: 'AI-Filled Indicators',
        description: 'When the agent fills a field, it gets a green highlight and an "AI" badge. You can always revert back to the original text.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '[type="submit"]',
      popover: {
        title: 'Save All Changes',
        description: 'Remember to hit Save when you are happy with the copy. Changes are not applied to your live site until you save.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
