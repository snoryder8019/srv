// Tour: Video Trimmer
(function() {
  AdminTour.init('video-trimmer', [
    {
      popover: {
        title: 'Video Trimmer',
        description: 'Clip, trim, and export video segments right in your browser. Set start and end points visually, then save the trimmed clip directly to your asset library.'
      }
    },
    {
      element: '.drop-zone',
      popover: {
        title: 'Load a Video',
        description: 'Drag a video file here or click to browse. You can also pick from your existing asset library. Supports common formats like MP4, WebM, and MOV.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#previewVideo',
      popover: {
        title: 'Video Preview',
        description: 'Watch your video and find the section you want to keep. The preview updates in real-time as you adjust the trim handles below.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.timeline-wrap',
      popover: {
        title: 'Timeline & Trim Handles',
        description: 'Drag the green start and red end handles to set your trim points. The filled area between them is the portion that will be kept in the output.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#startInput',
      popover: {
        title: 'Precise Time Inputs',
        description: 'Type exact start and end times for frame-accurate trimming. Format: seconds (e.g. 12.5) or MM:SS. Faster than dragging for precise cuts.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '.preset-row',
      popover: {
        title: 'Duration Presets',
        description: 'Quick presets for common social media lengths — 15s for Stories, 30s for Reels, 60s for posts. Click to auto-set the trim duration from your current position.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#playSelectionBtn',
      popover: {
        title: 'Playback Controls',
        description: 'Play just the selected trim region to preview your clip. Use loop mode to repeat the selection, and adjust playback speed for faster review.',
        side: 'bottom',
        align: 'start'
      }
    },
    {
      element: '#trimBtn',
      popover: {
        title: 'Trim & Upload',
        description: 'Click to process the trim and upload the clip directly to your asset library. Choose which folder to save to and set a custom filename.',
        side: 'top',
        align: 'start'
      }
    }
  ]);
})();
