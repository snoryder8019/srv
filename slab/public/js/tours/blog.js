// Tour: Blog
(function() {
  var pagePath = window.location.pathname;

  // Blog list page
  if (pagePath === '/admin/blog') {
    AdminTour.init('blog', [
      {
        popover: {
          title: 'Blog Manager',
          description: 'Create, edit, and publish blog posts for your site. Posts support rich HTML content, categories, tags, and AI-assisted writing.'
        }
      },
      {
        element: '.topbar-actions',
        popover: {
          title: 'Create a Blog Post',
          description: 'Click "+ New Post" to start writing. You can write manually in the editor or let the AI Blog Agent draft the entire post for you.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '.table-wrap',
        popover: {
          title: 'Your Blog Posts',
          description: 'All your posts are listed here with their status, category, and dates. Click any row to edit. Published posts are live on your site; drafts stay hidden.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '.empty',
        popover: {
          title: 'Getting Started',
          description: 'No posts yet! Create your first one manually, or use the AI agent from the editor to have one researched and written for you automatically.',
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
          description: 'Open the AI agent panel. It can research topics on the web and write complete blog posts — title, excerpt, content, tags, and category — all at once.',
          side: 'bottom',
          align: 'end'
        }
      },
      {
        element: '#field-title',
        popover: {
          title: 'Post Title',
          description: 'Give your post a compelling title. The URL slug is auto-generated from it — you can edit the slug manually for a custom URL.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#field-slug',
        popover: {
          title: 'URL Slug',
          description: 'This becomes the post URL on your site (e.g. /blog/my-post-title). Auto-generated from the title, but you can customize it for cleaner, SEO-friendly URLs.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#field-content',
        popover: {
          title: 'Content Editor',
          description: 'Write your post content here. Use the toolbar for formatting — bold, italic, headings, lists, links, and images. Or let the AI agent write it all.',
          side: 'top',
          align: 'start'
        }
      },
      {
        element: '#field-excerpt',
        popover: {
          title: 'Post Excerpt',
          description: 'A short summary shown in blog listings and social media previews. Keep it under 160 characters for best SEO results. The agent can generate this too.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#field-category',
        popover: {
          title: 'Category & Tags',
          description: 'Organize your posts with categories and comma-separated tags. Visitors can filter by these on your blog page, and they help with SEO.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '#field-featuredImage',
        popover: {
          title: 'Featured Image',
          description: 'Upload a cover image or pick one from your asset library. This image appears at the top of the post and in social media share cards.',
          side: 'bottom',
          align: 'start'
        }
      },
      {
        element: '.form-actions',
        popover: {
          title: 'Save Your Work',
          description: 'Save as a draft to keep editing privately, or set status to Published to make it live. You can switch between draft and published any time.',
          side: 'top',
          align: 'start'
        }
      }
    ]);
  }
})();
