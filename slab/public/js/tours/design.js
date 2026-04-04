// Tour: Design & Settings
(function() {
  AdminTour.init('design', [
    {
      popover: {
        title: 'Design Studio',
        description: 'Customize how your site looks — colors, fonts, section visibility, and themes. Changes preview in real-time before you save.'
      }
    },
    {
      element: '#agentToggle',
      popover: {
        title: 'Design Agent',
        description: 'Open the AI design assistant. Ask it to change your color palette, switch fonts, toggle section visibility, or apply a whole new theme — all via chat.',
        side: 'bottom',
        align: 'end'
      }
    },
    {
      element: '.preview-wrap',
      popover: {
        title: 'Live Site Preview',
        description: 'See how your site looks right now. Toggle between desktop, tablet, and mobile viewports to check responsiveness across devices.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#field-color_primary',
      popover: {
        title: 'Primary Color',
        description: 'Your primary color is used for navigation, headings, and key UI elements. Pick one that represents your brand identity.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#field-color_accent',
      popover: {
        title: 'Accent Color',
        description: 'The accent color highlights buttons, links, and calls-to-action. Choose something that stands out against your primary for good contrast.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#field-color_background',
      popover: {
        title: 'Background Color',
        description: 'This fills the background of your content sections. Light backgrounds work well for readability; dark gives a modern, premium feel.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#field-font_heading',
      popover: {
        title: 'Heading Font',
        description: 'Choose a font for titles and headings. Serif fonts feel traditional and elegant; sans-serif feels clean and modern. The preview updates live.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#field-font_body',
      popover: {
        title: 'Body Font',
        description: 'The body font is used for paragraphs and general text. Prioritize readability — clean, web-friendly fonts work best.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.vis-grid',
      popover: {
        title: 'Section Visibility',
        description: 'Toggle which sections appear on your landing page. Uncheck any section to hide it from visitors without deleting its content. Re-enable any time.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.theme-grid',
      popover: {
        title: 'Saved Themes',
        description: 'Save your current design as a named theme, then switch between themes instantly. Great for seasonal looks, A/B testing, or client presentations.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
