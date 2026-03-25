// Tour: Blog
(function() {
  var pagePath = window.location.pathname;

  // Blog list page
  if (pagePath === '/admin/blog') {
    AdminTour.init('blog', [
      {
        element: '.topbar-actions',
        popover: {
          title: 'Create a Blog Post',
          description: 'Click "+ New Post" to start writing. You can also let the AI Blog Agent draft the entire post for you.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.table-wrap',
        popover: {
          title: 'Your Blog Posts',
          description: 'All your posts are listed here with their status, category, and dates. Published posts are live on your site; drafts are hidden until you publish.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '.empty',
        popover: {
          title: 'Getting Started',
          description: 'No posts yet! Create your first one manually, or use the AI agent from the editor page to have one written for you.',
          side: 'bottom',
          align: 'center'
        }
      }
    ]);
  }

  // Blog form (new/edit)
  if (pagePath.match(/\/admin\/blog\/(new|\w+\/edit)/)) {
    AdminTour.init('blog-form', [
      {
        element: '#agentToggle',
        popover: {
          title: 'Blog Agent',
          description: 'Open the AI agent panel. It can research topics on the web and write complete blog posts — title, excerpt, content, tags, and category.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '#field-title',
        popover: {
          title: 'Post Title',
          description: 'Give your post a compelling title. The URL slug is auto-generated from it. You can also let the AI fill this in.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#field-content',
        popover: {
          title: 'Content Editor',
          description: 'Write your post content here using HTML. Use the toolbar buttons below for quick formatting, or ask the AI agent to write it all.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '.form-actions',
        popover: {
          title: 'Save Your Work',
          description: 'Save as a draft to keep editing, or publish when you are ready for it to go live on your blog.',
          side: 'top',
          align: 'start'
        }
      }
    ]);
  }
})();
