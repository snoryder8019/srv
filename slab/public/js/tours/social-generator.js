// Tour: Social Media Generator
(function() {
  AdminTour.init('social-generator', [
    {
      popover: {
        title: 'Social Media Generator',
        description: 'Create branded social media graphics right in your browser. Use canvas layers for images, text, and shapes — with AI background generation built in.'
      }
    },
    {
      element: '.sz-grid',
      popover: {
        title: 'Canvas Size Presets',
        description: 'Pick the right size for your platform — Instagram Post, Story, Facebook Cover, Twitter, Pinterest, YouTube thumbnail, and more. Or set custom dimensions.',
        side: 'right',
        align: 'start'
      }
    },
    {
      element: '#sgCanvas',
      popover: {
        title: 'Canvas',
        description: 'This is your workspace. Drag and drop images, add text layers, draw shapes, and position everything visually. The canvas updates in real-time.',
        side: 'left',
        align: 'start'
      }
    },
    {
      element: '.sg-panel-left',
      popover: {
        title: 'Tools Panel',
        description: 'Add layers (images, text, rectangles, circles), set backgrounds, generate AI backgrounds from prompts, manage your color palette, and save presets.',
        side: 'right',
        align: 'start'
      }
    },
    {
      element: '.sg-panel-right',
      popover: {
        title: 'Layers & Properties',
        description: 'See all layers in your design. Click a layer to select it and edit its properties — position, size, color, font, and opacity. Reorder layers to control stacking.',
        side: 'left',
        align: 'start'
      }
    },
    {
      element: '#agentToggleBtn',
      popover: {
        title: 'AI Background Generator',
        description: 'Type a prompt and the AI generates a background image for your graphic. Try "sunset over mountains" or "abstract geometric pattern in blue."',
        side: 'bottom',
        align: 'end'
      }
    },
    {
      element: '.pal-row',
      popover: {
        title: 'Color Palette',
        description: 'Quick-access brand colors. Your site palette is loaded automatically. Click any swatch to apply it to the selected layer or background.',
        side: 'right',
        align: 'start'
      }
    }
  ]);
})();
