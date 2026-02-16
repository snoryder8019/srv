/**
 * Linode Object Storage Integration
 *
 * This module provides functions to upload files to Linode Object Storage
 * which is S3-compatible.
 *
 * To use this, you'll need to:
 * 1. Install AWS SDK: npm install @aws-sdk/client-s3
 * 2. Set environment variables:
 *    - S3_LOCATION (your bucket name)
 *    - LINODE_ACCESS (access key)
 *    - LINODE_SECRET (secret key)
 *
 * Region: Chicago, IL (us-ord-1)
 * Endpoint: us-ord-1.linodeobjects.com
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

/**
 * Initialize S3-compatible client for Linode Object Storage
 * Chicago, IL region: us-ord-1
 */
function getLinodeClient() {
  if (!isLinodeConfigured()) {
    return null;
  }

  const region = 'us-ord-1'; // Chicago, IL region

  return new S3Client({
    endpoint: `https://${region}.linodeobjects.com`,
    region: region,
    credentials: {
      accessKeyId: process.env.LINODE_ACCESS,
      secretAccessKey: process.env.LINODE_SECRET,
    },
  });
}

/**
 * Generate a unique filename
 */
function generateUniqueFilename(originalFilename) {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  const extension = originalFilename.split('.').pop();
  return `${timestamp}-${randomString}.${extension}`;
}

/**
 * Upload a file to Linode Object Storage
 *
 * @param {Buffer} fileBuffer - The file data as a buffer
 * @param {string} originalFilename - Original filename
 * @param {string} folder - Optional folder path (e.g., 'training', 'tasks', 'recipes')
 * @param {boolean} preserveFilename - If true, use exact filename without generating unique name (default: false)
 * @returns {Promise<string>} - Returns the public URL of the uploaded file
 */
export async function uploadToLinode(fileBuffer, originalFilename, folder = 'general', preserveFilename = false) {
  const filename = preserveFilename ? originalFilename : generateUniqueFilename(originalFilename);
  const key = folder ? `${folder}/${filename}` : filename;

  const client = getLinodeClient();

  if (!client) {
    console.log(`[Linode Upload] Storage not configured. Would upload file: ${key}`);
    // Placeholder response when not configured
    return `/uploads/${key}`;
  }

  try {
    const bucketName = process.env.S3_LOCATION;
    const region = 'us-ord-1';

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ACL: 'public-read', // Make file publicly accessible
      ContentType: getContentType(originalFilename),
    });

    await client.send(command);

    // Return the public URL for Chicago region
    const publicUrl = `https://${bucketName}.${region}.linodeobjects.com/${key}`;
    console.log(`[Linode Upload] Successfully uploaded: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error('[Linode Upload] Error uploading file:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

/**
 * Get content type based on file extension
 */
function getContentType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const contentTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
  };
  return contentTypes[ext] || 'application/octet-stream';
}

/**
 * Delete a file from Linode Object Storage
 *
 * @param {string} fileUrl - The full URL or key of the file to delete
 */
export async function deleteFromLinode(fileUrl) {
  const client = getLinodeClient();

  if (!client) {
    console.log(`[Linode Delete] Storage not configured. Would delete file: ${fileUrl}`);
    return;
  }

  try {
    const bucketName = process.env.S3_LOCATION;

    // Extract the key from the URL
    const url = new URL(fileUrl);
    const key = url.pathname.substring(1); // Remove leading slash

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await client.send(command);
    console.log(`[Linode Delete] Successfully deleted: ${fileUrl}`);
  } catch (error) {
    console.error('[Linode Delete] Error deleting file:', error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

/**
 * Configuration check - returns whether Linode storage is properly configured
 */
export function isLinodeConfigured() {
  return !!(
    process.env.S3_LOCATION &&
    process.env.LINODE_ACCESS &&
    process.env.LINODE_SECRET
  );
}

export default {
  uploadToLinode,
  deleteFromLinode,
  isLinodeConfigured
};
