import express from 'express';
const router = express.Router();

/**
 * GET /api/media
 * Fetch media files from graffiti-tv Linode bucket
 * Returns array of public URLs for videos and images
 */
router.get('/media', async (req, res) => {
  try {
    const baseUrl = 'https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv';

    // Add your media URLs here - use standard video formats (mp4, webm) for best compatibility
    const mediaItems = [
      // Example: Uncomment and add your actual media files
      // { url: `${baseUrl}/your-video.mp4`, type: 'video' },
      // { url: `${baseUrl}/your-image.jpg`, type: 'image' },

      // If you have .soprano files, they might need to be converted to mp4
      // For now, this will fall back to the default YouTube stream
    ];

    // Detect media type from file extension if not specified
    const processedMedia = mediaItems.map(item => {
      if (item.type) {
        return item; // Type already specified
      }

      const extension = item.url.split('.').pop().toLowerCase();
      const videoExts = ['mp4', 'webm', 'mov', 'avi', 'ogv'];
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];

      let type = 'unknown';
      if (videoExts.includes(extension)) {
        type = 'video';
      } else if (imageExts.includes(extension)) {
        type = 'image';
      }

      return {
        ...item,
        type,
        extension
      };
    });

    res.json({
      success: true,
      media: processedMedia,
      count: processedMedia.length
    });

  } catch (error) {
    console.error('Error fetching media:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/media/random
 * Get a random media item from the bucket
 */
router.get('/media/random', async (req, res) => {
  try {
    const baseUrl = 'https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv';

    const mediaItems = [
      `${baseUrl}/1762625082358-ae18de361ad77063.soprano`
    ];

    const randomItem = mediaItems[Math.floor(Math.random() * mediaItems.length)];
    const extension = randomItem.split('.').pop().toLowerCase();
    const videoExts = ['mp4', 'webm', 'mov', 'avi', 'soprano'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];

    let type = 'unknown';
    if (videoExts.includes(extension)) {
      type = 'video';
    } else if (imageExts.includes(extension)) {
      type = 'image';
    }

    res.json({
      success: true,
      media: {
        url: randomItem,
        type,
        extension
      }
    });

  } catch (error) {
    console.error('Error fetching random media:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
