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
      popover: {
        title: 'Master Agent Deep Dive',
        description: 'This tour covers the agent workflow in detail — how conversations work, how to apply changes, and how to use multi-step workflows to manage complex requests.'
      }
    },
    {
      element: '#ma-messages',
      popover: {
        title: 'Agent Conversation',
        description: 'Your chat history with the agent. It remembers context across messages so you can have a natural conversation — ask follow-ups, refine results, or chain requests.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#ma-voice-select',
      popover: {
        title: 'Voice Controls',
        description: 'Choose a text-to-speech voice for agent responses. Click the mic button to speak your requests instead of typing — hands-free content creation.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-result',
      popover: {
        title: 'Agent Results',
        description: 'When the agent generates content, the result card shows a preview. Blog posts, copy updates, section content — it all appears here before you apply.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-execute-btn',
      popover: {
        title: 'Apply Changes',
        description: 'Click "Apply Now" to save agent suggestions directly to your site. Blog posts save as drafts; copy, sections, and design changes apply immediately.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-editor-btn',
      popover: {
        title: 'Review in Editor',
        description: 'Prefer to review first? "Open in Editor" takes you to the relevant editor with the agent\'s content pre-filled, so you can tweak before saving.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '#ma-workflow',
      popover: {
        title: 'Multi-Step Workflows',
        description: 'Complex requests become a checklist of tasks. "Run All" executes them in sequence, or click individual tasks to run them one at a time for more control.',
        side: 'top',
        align: 'start'
      }
    }
  ];
})();
