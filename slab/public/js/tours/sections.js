// Tour: Sections
(function() {
  AdminTour.init('sections', [
    {
      element: '.sections-grid',
      popover: {
        title: 'Your Site Sections',
        description: 'These cards represent the sections on your landing page. Each one can be toggled on or off, edited, and rearranged.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.section-card',
      popover: {
        title: 'Section Card',
        description: 'Click "Edit" to modify the content and images. The visibility toggle controls whether this section appears on your public site.',
        side: 'right',
        align: 'start'
      }
    },
    {
      element: '.add-section-card',
      popover: {
        title: 'Add Custom Sections',
        description: 'Create new sections using templates — text blocks, split layouts, call-to-action banners, FAQ accordions, or feature cards.',
        side: 'left',
        align: 'start'
      }
    },
    {
      element: '.btn-agent-section',
      popover: {
        title: 'AI Section Writer',
        description: 'Let the agent write section content for you. It will fill in headings, descriptions, and suggest images based on your business.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
