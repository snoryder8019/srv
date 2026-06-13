#!/usr/bin/env node
/**
 * Test Linode Object Storage Connection
 */

import linodeStorage from '../utilities/linodeStorage.js';

async function test() {
  console.log('🧪 Testing Linode Object Storage Connection...\n');

  const result = await linodeStorage.testConnection();

  console.log('📊 Connection Test Results:');
  console.log('  Status:', result.success ? '✅ SUCCESS' : '❌ FAILED');
  console.log('  Bucket:', result.bucket);
  console.log('  Region:', result.region);
  console.log('  Endpoint:', result.endpoint);

  if (result.success) {
    console.log('\n✨ Successfully connected to Linode Object Storage!');

    // Test listing files
    console.log('\n📂 Listing existing files...');
    const listResult = await linodeStorage.listFiles('sprites/', 10);

    if (listResult.success) {
      console.log(`  Found ${listResult.count} files in sprites/ prefix:`);
      if (listResult.files.length > 0) {
        listResult.files.forEach(file => {
          console.log(`    - ${file.key} (${(file.size / 1024).toFixed(2)} KB)`);
        });
      } else {
        console.log('    (No files yet - bucket is ready for uploads)');
      }
    }
  } else {
    console.log('\n❌ Connection failed:', result.error);
    console.log('\n📋 Troubleshooting:');
    console.log('  1. Check .env file has:');
    console.log('     - LINODE_ACCESS');
    console.log('     - LINODE_SECRET');
    console.log('     - S3_LOCATION (e.g., "us-east-1")');
    console.log('     - LINODE_BUCKET (e.g., "stringborn-assets")');
    console.log('  2. Verify bucket exists in Linode Cloud Manager');
    console.log('  3. Verify access keys have read/write permissions');
  }

  process.exit(result.success ? 0 : 1);
}

test();
