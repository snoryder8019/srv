// Tour: Users & Permissions
(function() {
  AdminTour.init('users', [
    {
      element: '.user-table',
      popover: {
        title: 'User Management',
        description: 'All registered users appear here. Click any row to expand and manage their role, permissions, and client link.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.role-badge',
      popover: {
        title: 'User Roles',
        description: 'Roles control access level: Admin has full access, Client sees their own portal, and Collaborator can edit content with limited permissions.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.card:last-child',
      popover: {
        title: 'Onboarding Link',
        description: 'Share this link with new clients. They can fill out an onboarding form and create an account to access their client portal.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
