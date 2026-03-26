// Tour: Pages
(function() {
  var pagePath = window.location.pathname;

  // Pages list
  if (pagePath === '/admin/pages') {
    AdminTour.init('pages', [
      {
        element: '.topbar-actions',
        popover: {
          title: 'Create a New Page',
          description: 'Add dynamic pages to your site. Choose from Content pages (free-form HTML), Data List pages (blog/portfolio feeds), or Landing pages (block builder).',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.table-wrap',
        popover: {
          title: 'Your Pages',
          description: 'Each published page gets its own URL on your website. You can control status, navigation visibility, and page type from here.',
          side: 'top',
          align: 'start'
        }
      }
    ]);
  }

  // Pages form (new/edit)
  if (pagePath.match(/\/admin\/pages\/(new|\w+\/edit)/)) {
    AdminTour.init('pages-form', [
      {
        element: '.agent-btn',
        popover: {
          title: 'Page Agent',
          description: 'Open the AI page writer. Describe what you need and it will write the content, suggest block layouts for landing pages, or help with SEO.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.page-type-grid',
        popover: {
          title: 'Choose a Page Type',
          description: 'Content pages have a free-form editor. Data List pages auto-display blog or portfolio feeds. Landing pages use a visual block builder.',
          side: 'bottom',
          align: 'start'
        }
      }
    ]);
  }
})();
