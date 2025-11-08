import dotenv from 'dotenv';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

dotenv.config();

const client = new S3Client({
  endpoint: 'https://us-ord-1.linodeobjects.com',
  region: 'us-ord-1',
  credentials: {
    accessKeyId: process.env.LINODE_ACCESS,
    secretAccessKey: process.env.LINODE_SECRET,
  },
});

const command = new ListBucketsCommand({});
try {
  const response = await client.send(command);
  console.log('\n=== Your Linode Buckets ===');
  response.Buckets.forEach(b => console.log('  -', b.Name));
  console.log('\nUpdate your .env file with ONE of these bucket names:');
  console.log('S3_LOCATION=bucket-name-here\n');
} catch (error) {
  console.log('Error listing buckets:', error.message);
}
