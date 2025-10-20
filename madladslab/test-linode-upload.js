#!/usr/bin/env node
/**
 * Test Linode Upload - Actually tries to upload a test file
 */

import dotenv from 'dotenv';
import { uploadToLinode, isLinodeConfigured } from './lib/linodeStorage.js';

dotenv.config();

console.log('\n🧪 Testing Linode Object Storage Upload...\n');

// Check configuration
console.log('Configuration Check:');
console.log('  S3_LOCATION:', process.env.S3_LOCATION || '❌ NOT SET');
console.log('  LINODE_ACCESS:', process.env.LINODE_ACCESS ? '✓ Set' : '❌ NOT SET');
console.log('  LINODE_SECRET:', process.env.LINODE_SECRET ? '✓ Set' : '❌ NOT SET');
console.log('');

if (!isLinodeConfigured()) {
  console.log('❌ Linode is NOT configured properly.\n');
  console.log('📝 Fix your .env file with:');
  console.log('   S3_LOCATION=your-bucket-name  (just the bucket name, not the URL!)');
  console.log('   LINODE_ACCESS=your-access-key');
  console.log('   LINODE_SECRET=your-secret-key');
  console.log('\nSee fix-linode.md for help!\n');
  process.exit(1);
}

console.log('✅ Configuration looks good!\n');
console.log('Attempting test upload...');

// Create a test file (1x1 transparent PNG)
const testImageBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const testFilename = 'test-upload.png';

try {
  console.log('  📤 Uploading test file to Linode...');
  console.log('  Bucket:', process.env.S3_LOCATION);
  console.log('  Region: us-ord-1 (Chicago, IL)');
  console.log('  Folder: test');
  console.log('');

  const url = await uploadToLinode(testImageBuffer, testFilename, 'test');

  console.log('✅ SUCCESS! File uploaded!\n');
  console.log('📸 Test image URL:');
  console.log('   ' + url);
  console.log('');
  console.log('🎉 Linode Object Storage is working perfectly!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Visit the URL above to see your test image');
  console.log('  2. Go to /backOffice/recipes and try uploading recipe images');
  console.log('  3. Delete the test file from your bucket if you want');
  console.log('');

} catch (error) {
  console.log('\n❌ Upload FAILED!\n');
  console.log('Error:', error.message);
  console.log('');

  if (error.message.includes('NoSuchBucket')) {
    console.log('💡 Problem: Bucket does not exist');
    console.log('   Your S3_LOCATION is:', process.env.S3_LOCATION);
    console.log('   Make sure this bucket exists in your Linode account!');
    console.log('   Go to: https://cloud.linode.com/object-storage/buckets');
  } else if (error.message.includes('InvalidAccessKeyId')) {
    console.log('💡 Problem: Access Key is wrong');
    console.log('   Check your LINODE_ACCESS in .env');
  } else if (error.message.includes('SignatureDoesNotMatch')) {
    console.log('💡 Problem: Secret Key is wrong');
    console.log('   Check your LINODE_SECRET in .env');
  } else if (error.message.includes('AccessDenied')) {
    console.log('💡 Problem: Permission denied');
    console.log('   Your access key might not have write permissions');
    console.log('   Check your Linode access key settings');
  } else {
    console.log('💡 Check:');
    console.log('   - Bucket name is correct (just the name, no URL)');
    console.log('   - Bucket is in Chicago region (us-ord-1)');
    console.log('   - Access keys are valid and not expired');
    console.log('   - Access key has write permissions');
  }

  console.log('\nFull error details:');
  console.log(error);
  console.log('');
  process.exit(1);
}
