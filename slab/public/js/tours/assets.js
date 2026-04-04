// Tour: Assets
(function() {
  AdminTour.init('assets', [
    {
      popover: {
        title: 'Asset Library',
        description: 'Your central file manager for all images, videos, PDFs, and documents. Files are stored in cloud storage and organized by folder.'
      }
    },
    {
      element: '.folder-panel',
      popover: {
        title: 'Folder Navigation',
        description: 'Browse your assets by folder. Each section of your site (blog, portfolio, sections) has its own folder. Create custom folders to stay organized.',
        side: 'right',
        align: 'start'
      }
    },
    {
      element: '.upload-zone',
      popover: {
        title: 'Upload Files',
        description: 'Drag and drop files here, or click to browse. Supports images, videos, PDFs, and documents. Files upload directly to cloud storage (S3).',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.grid-toolbar',
      popover: {
        title: 'Search and Filter',
        description: 'Search by file name or filter by type (images, videos, documents) to quickly find what you need across all folders.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.asset-grid',
      popover: {
        title: 'Asset Gallery',
        description: 'Click any asset to see its details and copy its URL. Select multiple files to batch-delete or move between folders.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.topbar-actions',
      popover: {
        title: 'Creative Tools',
        description: 'Access the Social Media Generator to create branded graphics, or the Video Trimmer to clip and export video files — all built into your asset library.',
        side: 'bottom',
        align: 'end'
      }
    }
  ]);
})();
