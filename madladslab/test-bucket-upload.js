#!/usr/bin/env node

/**
 * Test Linode Bucket Upload
 * Run: node test-bucket-upload.js
 */

import dotenv from 'dotenv';
import { S3Client, ListBucketsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';

// Load environment variables
dotenv.config();

console.log('=== Linode Bucket Upload Test ===\n');

// Check environment variables
console.log('1. Checking environment variables...');
console.log('   S3_LOCATION:', process.env.S3_LOCATION || 'NOT SET');
console.log('   LINODE_ACCESS:', process.env.LINODE_ACCESS ? 'SET (hidden)' : 'NOT SET');
console.log('   LINODE_SECRET:', process.env.LINODE_SECRET ? 'SET (hidden)' : 'NOT SET');
console.log('');

// Parse S3_LOCATION
let bucketName = process.env.S3_LOCATION;

// If S3_LOCATION contains the endpoint URL, extract just the bucket name
if (bucketName && bucketName.includes('linodeobjects.com')) {
  console.log('⚠️  WARNING: S3_LOCATION should be just the bucket name, not the full URL!');
  console.log('   Example: "madladslab-bucket" not "US, Chicago, IL: us-ord-1.linodeobjects.com"');
  console.log('');
  console.log('Please update your .env file:');
  console.log('   S3_LOCATION=your-bucket-name-here');
  console.log('');
  process.exit(1);
}

if (!bucketName || !process.env.LINODE_ACCESS || !process.env.LINODE_SECRET) {
  console.log('❌ Missing environment variables. Please set:');
  console.log('   S3_LOCATION=your-bucket-name');
  console.log('   LINODE_ACCESS=your-access-key');
  console.log('   LINODE_SECRET=your-secret-key');
  console.log('');
  process.exit(1);
}

// Initialize S3 client
console.log('2. Initializing Linode S3 client...');
const region = 'us-ord-1';
const client = new S3Client({
  endpoint: `https://${region}.linodeobjects.com`,
  region: region,
  credentials: {
    accessKeyId: process.env.LINODE_ACCESS,
    secretAccessKey: process.env.LINODE_SECRET,
  },
});
console.log('   ✅ Client initialized');
console.log('');

// Test 1: List buckets
console.log('3. Testing connection (list buckets)...');
try {
  const listCommand = new ListBucketsCommand({});
  const response = await client.send(listCommand);

  console.log('   ✅ Connection successful!');
  console.log('   Available buckets:');
  response.Buckets.forEach(bucket => {
    console.log(`     - ${bucket.Name}`);
  });
  console.log('');

  // Check if our bucket exists
  const bucketExists = response.Buckets.some(b => b.Name === bucketName);
  if (!bucketExists) {
    console.log(`   ⚠️  Bucket "${bucketName}" not found in your account!`);
    console.log('   Please create it in Linode Cloud Manager or update S3_LOCATION');
    console.log('');
  }
} catch (error) {
  console.log('   ❌ Connection failed:', error.message);
  console.log('');
  process.exit(1);
}

// Test 2: Upload a test file
console.log('4. Testing upload...');
try {
  const testContent = Buffer.from('Test upload from bucket manager - ' + new Date().toISOString());
  const testKey = `test-uploads/test-${Date.now()}.txt`;

  const uploadCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: testKey,
    Body: testContent,
    ACL: 'public-read',
    ContentType: 'text/plain',
  });

  await client.send(uploadCommand);

  const publicUrl = `https://${bucketName}.${region}.linodeobjects.com/${testKey}`;
  console.log('   ✅ Upload successful!');
  console.log('   Test file URL:', publicUrl);
  console.log('');
} catch (error) {
  console.log('   ❌ Upload failed:', error.message);
  console.log('   Error details:', error);
  console.log('');
  process.exit(1);
}

console.log('=== All Tests Passed! ===');
console.log('');
console.log('Your Linode Object Storage is configured correctly!');
console.log('The bucket upload manager should now work.');
console.log('');
