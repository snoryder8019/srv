// Tour: Site Copy
(function() {
  AdminTour.init('copy', [
    {
      popover: {
        title: 'Site Copy Editor',
        description: 'This is where you write and refine all the text on your landing page — from your hero headline to your contact section. Every field maps directly to your live site.'
      }
    },
    {
      element: '#agentToggle',
      popover: {
        title: 'Copy Agent',
        description: 'Open the AI assistant to auto-write or refine your site copy. It can fill individual sections, rewrite everything at once, or match a specific tone you describe.',
        side: 'bottom',
        align: 'end'
      }
    },
    {
      element: '#copyForm .card',
      popover: {
        title: 'Section-by-Section Editing',
        description: 'Your site copy is organized by section — Hero, Services, About, Process, and Contact. Each has its own fields for headings, descriptions, and supporting text.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.ai-badge',
      popover: {
        title: 'AI-Filled Indicators',
        description: 'When the agent fills a field, it gets a green highlight and an "AI" badge so you can see what was auto-generated. Edit freely — your changes override the AI.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#field-hero_headline',
      popover: {
        title: 'Hero Section',
        description: 'The hero is the first thing visitors see. A strong headline and subtext here sets the tone for your entire site. Keep it clear and benefit-driven.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#field-services_heading',
      popover: {
        title: 'Services Section',
        description: 'List your services with titles and descriptions. These appear as cards on your landing page. The agent can generate service descriptions from your business profile.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#field-about_heading',
      popover: {
        title: 'About Section',
        description: 'Tell visitors who you are and what makes you different. This section builds trust — include your story, values, or team background.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '[type="submit"]',
      popover: {
        title: 'Save All Changes',
        description: 'Hit Save to apply your copy to the live site. Changes take effect immediately — refresh your public site to see them.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
