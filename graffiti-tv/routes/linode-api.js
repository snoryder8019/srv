import express from 'express';
const router = express.Router();
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config({ path: '../madladslab/.env' });

const BUCKET_NAME = 'madladslab';
const PREFIX = 'graffiti-tv/';
const REGION = 'us-ord-1';

/**
 * GET /api/linode/media
 * Fetch media files directly from Linode bucket (no database needed)
 */
router.get('/media', async (req, res) => {
  try {
    // Check if Linode is configured
    if (!process.env.LINODE_ACCESS || !process.env.LINODE_SECRET) {
      console.log('Linode not configured, returning empty array');
      return res.json({
        success: true,
        media: [],
        count: 0,
        message: 'Linode storage not configured'
      });
    }

    const client = new S3Client({
      endpoint: `https://${REGION}.linodeobjects.com`,
      region: REGION,
      credentials: {
        accessKeyId: process.env.LINODE_ACCESS,
        secretAccessKey: process.env.LINODE_SECRET,
      },
    });

    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: PREFIX,
    });

    const response = await client.send(command);

    if (!response.Contents || response.Contents.length === 0) {
      return res.json({
        success: true,
        media: [],
        count: 0,
        message: 'No files found in graffiti-tv bucket'
      });
    }

    const mediaItems = [];

    response.Contents.forEach((item) => {
      const filename = item.Key.replace(PREFIX, '');

      // Skip the directory itself
      if (!filename) return;

      const url = `https://${BUCKET_NAME}.${REGION}.linodeobjects.com/${item.Key}`;
      const ext = filename.split('.').pop().toLowerCase();

      // Detect media type
      // Note: .soprano files are non-standard and should be converted to .webm or .mp4
      const videoExts = ['mp4', 'webm', 'mov', 'avi', 'ogv', 'mkv', 'm4v', 'soprano'];
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];

      let type = 'unknown';
      if (videoExts.includes(ext)) {
        type = 'video';
      } else if (imageExts.includes(ext)) {
        type = 'image';
      }

      // Only add videos and images
      if (type !== 'unknown') {
        mediaItems.push({
          url,
          type,
          filename,
          size: item.Size
        });
      }
    });

    res.json({
      success: true,
      media: mediaItems,
      count: mediaItems.length
    });

  } catch (error) {
    console.error('Error fetching from Linode:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
