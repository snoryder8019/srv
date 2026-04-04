// Tour: Pages
(function() {
  var pagePath = window.location.pathname;

  // Pages list
  if (pagePath === '/admin/pages') {
    AdminTour.init('pages', [
      {
        popover: {
          title: 'Page Manager',
          description: 'Build custom pages for your site — from simple content pages to data-driven listings and landing pages with a visual block builder.'
        }
      },
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
          description: 'Each published page gets its own URL on your website. Click a row to edit content, change status, or update navigation visibility.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '.empty',
        popover: {
          title: 'No Pages Yet',
          description: 'Create your first page to add custom content beyond your landing page. Pages can be linked from your site navigation or shared directly via URL.',
          side: 'bottom',
          align: 'center'
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
          description: 'Open the AI page writer. Describe what you need and it will write the content, suggest block layouts for landing pages, or help with SEO metadata.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.page-type-grid',
        popover: {
          title: 'Choose a Page Type',
          description: 'Content pages use a free-form HTML editor. Data List pages auto-display blog or portfolio feeds. Landing pages use a visual block builder with sections.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#field-title',
        popover: {
          title: 'Page Title & Slug',
          description: 'The title shows in the browser tab and navigation menu. The slug becomes the URL path (e.g. /about-us). Check "Show in Nav" to add it to your site menu.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#field-content',
        popover: {
          title: 'Page Content',
          description: 'Write or paste your content here. For Content pages use the HTML editor directly. The AI agent can generate content for any page type.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '.form-actions',
        popover: {
          title: 'Publish or Save Draft',
          description: 'Published pages are live and visible. Draft pages are hidden from visitors. You can toggle status any time without losing your content.',
          side: 'top',
          align: 'start'
        }
      }
    ]);
  }
})();
