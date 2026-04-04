// Tour: Users & Permissions
(function() {
  AdminTour.init('users', [
    {
      popover: {
        title: 'Users & Permissions',
        description: 'Manage everyone who has access to your site — admins, clients, and collaborators. Control roles, permissions, and portal access.'
      }
    },
    {
      element: '.user-table',
      popover: {
        title: 'User Management',
        description: 'All registered users appear here. Click any row to expand it and see their details — role assignment, linked client, and account info.',
        side: 'top',
        align: 'start'
      }
    },
    {
      element: '.role-badge',
      popover: {
        title: 'User Roles',
        description: 'Roles control access: Admin has full access to everything. Client sees their own portal with invoices and files. Collaborator can edit content with limited permissions.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.card:last-child',
      popover: {
        title: 'Onboarding Link',
        description: 'Share this link with new clients. They can fill out an onboarding form, create their account, and automatically get Client role access to their portal.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
