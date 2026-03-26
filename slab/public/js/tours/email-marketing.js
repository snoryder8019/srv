// Tour: Email Marketing
(function() {
  AdminTour.init('email-marketing', [
    {
      element: '.content > div:first-child',
      popover: {
        title: 'Email Marketing Stats',
        description: 'Track your contacts, campaigns sent, and funnel stages. See how many leads, prospects, and customers you have at a glance.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.tabs',
      popover: {
        title: 'Contacts & Campaigns',
        description: 'Switch between managing your contact list and creating email campaigns. Import contacts from CSV or sync from your client list.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#agentToggle',
      popover: {
        title: 'Marketing Agent',
        description: 'Use the AI agent to draft campaign emails, write subject lines, and create content. It understands your brand and audience.',
        side: 'bottom',
        align: 'end'
      }
    }
  ]);
})();
