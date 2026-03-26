// Tour: Design & Settings
(function() {
  AdminTour.init('design', [
    {
      element: '#agentToggle',
      popover: {
        title: 'Design Agent',
        description: 'Open the AI design assistant. Ask it to change your color palette, switch fonts, toggle section visibility, or apply a whole new theme.',
        side: 'bottom',
        align: 'end'
      }
    },
    {
      element: '.preview-wrap',
      popover: {
        title: 'Live Site Preview',
        description: 'See how your site looks right now. Toggle between desktop, tablet, and mobile viewports. Save your changes and refresh to see updates.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#field-color_primary',
      popover: {
        title: 'Color Palette',
        description: 'Set your brand colors here. Primary is used for navigation and headings, Accent for highlights and CTAs, Background for section fills.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#field-font_heading',
      popover: {
        title: 'Typography',
        description: 'Choose heading and body fonts to match your brand. The preview below shows how they look together.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.vis-grid',
      popover: {
        title: 'Section Visibility',
        description: 'Toggle which sections appear on your landing page. Uncheck any section to hide it from visitors without deleting its content.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.theme-grid',
      popover: {
        title: 'Saved Themes',
        description: 'Save your current design as a theme, then switch between themes instantly. Great for seasonal looks or client presentations.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
