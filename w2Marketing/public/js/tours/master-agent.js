// Tour: Master Agent (loaded on dashboard, targets agent-specific elements)
// This tour is separate from the dashboard tour, focused on the agent workflow
(function() {
  // Only run on dashboard
  if (window.location.pathname !== '/admin') return;

  // Don't auto-start — this tour is triggered manually or after first agent use
  // Register steps so replay works
  AdminTour._currentPage = 'master-agent';
  AdminTour._currentSteps = [
    {
      element: '#ma-messages',
      popover: {
        title: 'Agent Conversation',
        description: 'This is your chat history with the agent. It remembers context across messages so you can have a natural conversation about your site.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#ma-voice-select',
      popover: {
        title: 'Voice Controls',
        description: 'Choose a text-to-speech voice for agent responses. Click the mic button to speak your requests instead of typing.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-result',
      popover: {
        title: 'Agent Results',
        description: 'When the agent generates content, the result card shows what was created. Use "Apply Now" to save directly, or "Open in Editor" to review first.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-workflow',
      popover: {
        title: 'Multi-Step Workflows',
        description: 'Complex requests become a checklist of tasks. "Run All" executes them in sequence, or click individual tasks to run them one at a time.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-execute-btn',
      popover: {
        title: 'Apply Changes',
        description: 'Click "Apply Now" to write agent suggestions directly to your site. This saves blog posts as drafts and updates copy, sections, and design immediately.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-editor-btn',
      popover: {
        title: 'Review in Editor',
        description: 'Prefer to review first? "Open in Editor" takes you to the relevant editor with the agent\'s suggestions pre-filled, so you can tweak before saving.',
        side: 'top',
        align: 'start'
      }
    }
  ];
})();
