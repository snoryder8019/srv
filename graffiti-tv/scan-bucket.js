/**
 * Scan graffiti-tv Linode bucket and list all media files
 * This helps you quickly see what's available to add to the carousel
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const BUCKET_NAME = 'madladslab';
const PREFIX = 'graffiti-tv/';
const REGION = 'us-ord-1';

async function scanBucket() {
  try {
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
      console.log('No files found in graffiti-tv bucket');
      return;
    }

    console.log('\n=== Graffiti TV Bucket Contents ===\n');
    console.log(`Found ${response.Contents.length} files:\n`);

    const mediaItems = [];

    response.Contents.forEach((item, index) => {
      const filename = item.Key.replace(PREFIX, '');
      if (filename) { // Skip the directory itself
        const url = `https://${BUCKET_NAME}.${REGION}.linodeobjects.com/${item.Key}`;
        const ext = filename.split('.').pop().toLowerCase();

        const videoExts = ['mp4', 'webm', 'mov', 'avi', 'soprano'];
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];

        let type = 'unknown';
        if (videoExts.includes(ext)) type = 'video';
        else if (imageExts.includes(ext)) type = 'image';

        console.log(`${index + 1}. ${filename}`);
        console.log(`   Type: ${type}`);
        console.log(`   URL: ${url}`);
        console.log(`   Size: ${(item.Size / 1024 / 1024).toFixed(2)} MB`);
        console.log('');

        mediaItems.push({
          url: `\${baseUrl}/${filename}`,
          type,
        });
      }
    });

    console.log('\n=== Copy/Paste into routes/api.js ===\n');
    console.log('const mediaItems = [');
    mediaItems.forEach((item, index) => {
      const comma = index < mediaItems.length - 1 ? ',' : '';
      console.log(`      {`);
      console.log(`        url: \`${item.url}\`,`);
      console.log(`        type: '${item.type}',`);
      console.log(`      }${comma}`);
    });
    console.log('    ];');
    console.log('');

  } catch (error) {
    console.error('Error scanning bucket:', error.message);
    console.log('\nMake sure your .env file has:');
    console.log('  LINODE_ACCESS=your_access_key');
    console.log('  LINODE_SECRET=your_secret_key');
  }
}

scanBucket();
