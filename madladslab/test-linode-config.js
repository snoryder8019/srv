#!/usr/bin/env node
/**
 * Test Linode Storage Configuration
 *
 * This script checks if your Linode Object Storage is properly configured
 * for the Chicago, IL region (us-ord-1)
 */

import dotenv from 'dotenv';
import { isLinodeConfigured } from './lib/linodeStorage.js';

dotenv.config();

console.log('\n🔍 Checking Linode Object Storage Configuration...\n');

console.log('Environment Variables:');
console.log('  S3_LOCATION:', process.env.S3_LOCATION ? '✓ Set' : '✗ Not Set');
console.log('  LINODE_ACCESS:', process.env.LINODE_ACCESS ? '✓ Set' : '✗ Not Set');
console.log('  LINODE_SECRET:', process.env.LINODE_SECRET ? '✓ Set' : '✗ Not Set');

console.log('\nConfiguration:');
console.log('  Region: us-ord-1 (Chicago, IL)');
console.log('  Endpoint: us-ord-1.linodeobjects.com');

if (process.env.S3_LOCATION) {
  console.log('  Bucket:', process.env.S3_LOCATION);
  console.log('  Public URL Pattern:', `https://${process.env.S3_LOCATION}.us-ord-1.linodeobjects.com/[folder]/[filename]`);
}

console.log('\nStatus:');
if (isLinodeConfigured()) {
  console.log('  ✅ Linode Object Storage is CONFIGURED');
  console.log('\n✅ You can now upload images to your Linode bucket!');
  console.log('   Images will be uploaded to: recipes/[unique-filename]');
} else {
  console.log('  ❌ Linode Object Storage is NOT configured');
  console.log('\n📝 To configure, add these to your .env file:');
  console.log('   S3_LOCATION=your-bucket-name');
  console.log('   LINODE_ACCESS=your-access-key');
  console.log('   LINODE_SECRET=your-secret-key');
}

console.log('\n');
