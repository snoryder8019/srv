// Tour: Portfolio
(function() {
  var pagePath = window.location.pathname;

  if (pagePath === '/admin/portfolio') {
    AdminTour.init('portfolio', [
      {
        popover: {
          title: 'Portfolio Gallery',
          description: 'Showcase your best work here. Each portfolio item gets a card on your site with an image, description, and client attribution.'
        }
      },
      {
        element: '.topbar-actions',
        popover: {
          title: 'Add Portfolio Items',
          description: 'Click "+ New Item" to showcase a project. Add an image, description, client name, category, and tags to build your portfolio gallery.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.table-wrap',
        popover: {
          title: 'Your Portfolio',
          description: 'All your work samples listed here. The Order column controls display sequence on your site. Toggle Featured to highlight your best projects.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '.portfolio-table tbody tr:first-child',
        popover: {
          title: 'Edit or Remove',
          description: 'Click Edit to update any portfolio item — change the image, description, or category. Delete removes it permanently from your site.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.empty',
        popover: {
          title: 'No Projects Yet',
          description: 'Add your first portfolio item to start showcasing your work. Include a high-quality image and a brief description of the project.',
          side: 'bottom',
          align: 'center'
        }
      }
    ]);
  }

  // Portfolio form (new/edit)
  if (pagePath.match(/\/admin\/portfolio\/(new|\w+\/edit)/)) {
    AdminTour.init('portfolio-form', [
      {
        element: '#field-title',
        popover: {
          title: 'Project Title',
          description: 'Name your project. This appears as the heading on your portfolio card and detail page.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#field-category',
        popover: {
          title: 'Category & Tags',
          description: 'Categorize your work (e.g. "Web Design", "Branding") so visitors can filter your portfolio. Tags add more specific keywords.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#field-description',
        popover: {
          title: 'Project Description',
          description: 'Describe what you did, the challenge, and the result. Keep it concise — visitors skim portfolio items, so lead with impact.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '.asset-pick-btn',
        popover: {
          title: 'Pick from Assets',
          description: 'Select an image from your asset library instead of uploading a new file. Great for reusing images you have already uploaded.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#featured',
        popover: {
          title: 'Featured Toggle',
          description: 'Mark this item as Featured to highlight it at the top of your portfolio. Featured items get more visibility.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.form-actions',
        popover: {
          title: 'Save Your Item',
          description: 'Save to add this project to your public portfolio. You can edit it later at any time.',
          side: 'top',
          align: 'start'
        }
      }
    ]);
  }
})();
