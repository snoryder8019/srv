// Tour: Bookkeeping
(function() {
  AdminTour.init('bookkeeping', [
    {
      popover: {
        title: 'Welcome to Bookkeeping',
        description: 'Track invoices, payments, and revenue all in one place. Integrated with Stripe and PayPal for automatic payment tracking and gateway status.'
      }
    },
    {
      element: '.content > div:first-child',
      popover: {
        title: 'Financial Overview',
        description: 'See your total revenue, outstanding balances, and refunds at a glance. The Gateways card shows which payment providers are connected and active.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.stat-grid',
      popover: {
        title: 'Revenue Stats',
        description: 'Track paid, unpaid, and overdue invoice totals. These numbers update in real-time as payments come in through your connected gateways.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: 'form[action="/admin/bookkeeping"]',
      popover: {
        title: 'Filter Invoices',
        description: 'Filter your invoice ledger by status (paid, unpaid, overdue), payment provider (Stripe, PayPal, manual), or by specific client name.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.table-wrap',
      popover: {
        title: 'Invoice Ledger',
        description: 'Your complete invoice history with amounts, statuses, and transaction IDs. Click any invoice to manage it — send payment reminders, mark paid, issue refunds, or void.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.topbar-actions',
      popover: {
        title: 'Create Invoices',
        description: 'Create a new invoice manually, or generate one from a client\'s detail page. Invoices can be sent via email with a secure payment link.',
        side: 'bottom',
        align: 'end'
      }
    }
  ]);
})();
