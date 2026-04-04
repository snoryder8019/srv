// Tour: Sections
(function() {
  AdminTour.init('sections', [
    {
      popover: {
        title: 'Section Manager',
        description: 'Sections are the building blocks of your landing page. Each card represents a section — edit content, toggle visibility, add new ones, or use AI to write copy.'
      }
    },
    {
      element: '.sections-grid',
      popover: {
        title: 'Your Site Sections',
        description: 'These cards represent every section on your landing page. Each can be toggled on or off, edited, and rearranged. The order here matches the order on your site.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.section-card',
      popover: {
        title: 'Section Card',
        description: 'Click "Edit" to open the section editor modal where you can change headings, body text, images, and layout settings. The eye icon toggles public visibility.',
        side: 'right',
        align: 'start'
      }
    },
    {
      element: '.add-section-card',
      popover: {
        title: 'Add Custom Sections',
        description: 'Create new sections from templates — text blocks, split layouts (image + text), call-to-action banners, FAQ accordions, or feature card grids. Pick a template and customize.',
        side: 'left',
        align: 'start'
      }
    },
    {
      element: '.btn-agent-section',
      popover: {
        title: 'AI Section Writer',
        description: 'Let the agent write section content for you. It reads your business profile and generates headings, descriptions, and bullet points that match your brand voice.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
