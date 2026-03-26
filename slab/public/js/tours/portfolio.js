// Tour: Portfolio
(function() {
  AdminTour.init('portfolio', [
    {
      element: '.topbar-actions',
      popover: {
        title: 'Add Portfolio Items',
        description: 'Click "+ New Item" to showcase a project. Add an image, description, client name, and category to build your portfolio gallery.',
        side: 'bottom',
        align: 'end'
      }
    },
    {
      element: '.table-wrap',
      popover: {
        title: 'Your Portfolio',
        description: 'All your work samples are listed here. Drag the Order values to control display sequence. Mark items as Featured to highlight them.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.portfolio-table tbody tr:first-child',
      popover: {
        title: 'Edit or Remove',
        description: 'Click Edit to update any portfolio item, or Delete to remove it. Changes appear on your public site immediately.',
        side: 'bottom',
        align: 'start'
      }
    }
  ]);
})();
