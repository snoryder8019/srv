// Tour: Settings & Keys
(function() {
  AdminTour.init('settings', [
    {
      popover: {
        title: 'Settings & Integrations',
        description: 'Configure your business profile, connect payment gateways, set up email, and manage your domain. Each section has a setup guide to walk you through it.'
      }
    },
    {
      element: '.status-bar',
      popover: {
        title: 'Site Status',
        description: 'Shows whether your site is in Preview mode or Live. Preview mode is fully functional but uses a subdomain. Go Live when you are ready for your custom domain.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.setup-cta',
      popover: {
        title: 'Done-For-You Setup',
        description: 'Not comfortable with technical setup? Our team can configure all integrations for you — payments, email, DNS, SSL, and deliverability testing.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.settings-section:nth-of-type(1)',
      popover: {
        title: 'Business Profile',
        description: 'This is the most important section — fill in your business name, type, services, and voice. All AI agents use this information to write content that sounds like you.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.guide-toggle',
      popover: {
        title: 'Setup Guides',
        description: 'Every integration section has a setup guide button. Click it for step-by-step instructions — where to get API keys, what DNS records to add, and how to test.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.btn-test',
      popover: {
        title: 'Test Buttons',
        description: 'After entering API keys, use the Test button to verify your connection works before saving. Saves you from discovering issues later.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.field-set',
      popover: {
        title: 'Configuration Status',
        description: 'Green dots indicate that a secret key has been saved and encrypted. You never need to re-enter a working key — just leave the field blank to keep the existing one.',
        side: 'bottom',
        align: 'start'
      }
    }
  ]);
})();
