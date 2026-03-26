// Tour: Assets
(function() {
  AdminTour.init('assets', [
    {
      element: '.folder-panel',
      popover: {
        title: 'Folder Navigation',
        description: 'Browse your assets by folder. Each section of your site (blog, portfolio, sections) has its own folder for organized storage.',
        side: 'right',
        align: 'start'
      }
    },
    {
      element: '.upload-zone',
      popover: {
        title: 'Upload Files',
        description: 'Drag and drop files here, or click to browse. Supports images, videos, PDFs, and documents. Files are stored in cloud storage.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.grid-toolbar',
      popover: {
        title: 'Search and Filter',
        description: 'Search by file name or filter by type (images, videos, documents) to quickly find what you need.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.asset-grid',
      popover: {
        title: 'Asset Gallery',
        description: 'Click any asset to see its details, copy its URL, or delete it. Select multiple to batch-manage your files.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
