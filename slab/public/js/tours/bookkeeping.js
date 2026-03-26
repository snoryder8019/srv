// Tour: Bookkeeping
(function() {
  AdminTour.init('bookkeeping', [
    {
      popover: {
        title: 'Welcome to Bookkeeping',
        description: 'Track invoices, payments, and revenue all in one place. Integrated with PayPal and Stripe for automatic payment tracking.'
      }
    },
    {
      element: '.content > div:first-child',
      popover: {
        title: 'Financial Overview',
        description: 'See your total revenue, outstanding balances, and refunds at a glance. The Gateways card shows which payment providers are connected.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: 'form[action="/admin/bookkeeping"]',
      popover: {
        title: 'Filter Invoices',
        description: 'Filter your invoice ledger by status (paid, unpaid, overdue), payment provider, or specific client to find exactly what you need.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.table-wrap',
      popover: {
        title: 'Invoice Ledger',
        description: 'Your complete invoice history with amounts, statuses, and transaction IDs. Click any invoice to manage it — send reminders, mark paid, or void.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
