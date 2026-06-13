/**
 * Linode Object Storage Utility
 * S3-compatible storage client for sprite atlases and assets
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const LINODE_ACCESS_KEY = process.env.LINODE_ACCESS;
const LINODE_SECRET_KEY = process.env.LINODE_SECRET;
const LINODE_REGION = process.env.S3_LOCATION || 'us-east-1';
const BUCKET_NAME = 'madladslab'; // Linode bucket name
const BUCKET_PREFIX = 'stringborn/'; // Project directory within bucket

// Linode Object Storage endpoint format: {region}.linodeobjects.com
const ENDPOINT = `https://${LINODE_REGION}.linodeobjects.com`;

// Initialize S3 client
const s3Client = new S3Client({
  region: LINODE_REGION,
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: LINODE_ACCESS_KEY,
    secretAccessKey: LINODE_SECRET_KEY,
  },
  forcePathStyle: false, // Linode uses virtual-hosted-style URLs
});

/**
 * Upload a file to Linode Object Storage
 *
 * @param {string} key - Object key (path) in bucket
 * @param {Buffer} fileBuffer - File data
 * @param {string} contentType - MIME type
 * @param {Object} metadata - Optional metadata
 * @returns {Promise<Object>} - Upload result with URL
 */
export async function uploadFile(key, fileBuffer, contentType, metadata = {}) {
  try {
    // Prepend bucket prefix to key
    const fullKey = BUCKET_PREFIX + key;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fullKey,
      Body: fileBuffer,
      ContentType: contentType,
      ACL: 'public-read', // Make publicly accessible
      Metadata: metadata,
    });

    const response = await s3Client.send(command);

    // Construct public URL
    const publicUrl = `https://${BUCKET_NAME}.${LINODE_REGION}.linodeobjects.com/${fullKey}`;

    return {
      success: true,
      key: fullKey,
      url: publicUrl,
      etag: response.ETag,
      metadata: response.Metadata,
    };
  } catch (error) {
    console.error('Linode Storage Upload Error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get public URL for an object
 *
 * @param {string} key - Object key
 * @returns {string} - Public URL
 */
export function getPublicUrl(key) {
  const fullKey = key.startsWith(BUCKET_PREFIX) ? key : BUCKET_PREFIX + key;
  return `https://${BUCKET_NAME}.${LINODE_REGION}.linodeobjects.com/${fullKey}`;
}

/**
 * Generate a signed URL for temporary access
 *
 * @param {string} key - Object key
 * @param {number} expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns {Promise<string>} - Signed URL
 */
export async function getSignedUrlForObject(key, expiresIn = 3600) {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
}

/**
 * Delete an object from storage
 *
 * @param {string} key - Object key to delete
 * @returns {Promise<Object>} - Deletion result
 */
export async function deleteFile(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);

    return {
      success: true,
      key,
    };
  } catch (error) {
    console.error('Linode Storage Delete Error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * List objects with a given prefix
 *
 * @param {string} prefix - Key prefix to filter by
 * @param {number} maxKeys - Maximum number of keys to return
 * @returns {Promise<Array>} - List of objects
 */
export async function listFiles(prefix = '', maxKeys = 1000) {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await s3Client.send(command);

    return {
      success: true,
      files: response.Contents?.map(obj => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
        url: getPublicUrl(obj.Key),
      })) || [],
      count: response.KeyCount || 0,
    };
  } catch (error) {
    console.error('Linode Storage List Error:', error);
    return {
      success: false,
      error: error.message,
      files: [],
    };
  }
}

/**
 * Check if an object exists
 *
 * @param {string} key - Object key
 * @returns {Promise<boolean>} - True if exists
 */
export async function fileExists(key) {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    console.error('Linode Storage Exists Check Error:', error);
    throw error;
  }
}

/**
 * Get object metadata without downloading
 *
 * @param {string} key - Object key
 * @returns {Promise<Object>} - Metadata
 */
export async function getFileMetadata(key) {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);

    return {
      success: true,
      key,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
      etag: response.ETag,
      metadata: response.Metadata,
    };
  } catch (error) {
    console.error('Linode Storage Metadata Error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Upload sprite atlas with automatic path generation
 *
 * @param {string} atlasName - Atlas filename (e.g., "forest-terrain-001.png")
 * @param {Buffer} fileBuffer - PNG file data
 * @param {string} category - Category (terrain, monsters, npcs, buildings, dungeon)
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} - Upload result
 */
export async function uploadSpriteAtlas(atlasName, fileBuffer, category, metadata = {}) {
  const key = `sprites/packs/${category}/${atlasName}`;

  return uploadFile(key, fileBuffer, 'image/png', {
    category,
    type: 'sprite-atlas',
    ...metadata,
  });
}

/**
 * Upload player-created custom object
 *
 * @param {string} userId - User ID
 * @param {string} filename - Filename
 * @param {Buffer} fileBuffer - Image data
 * @param {string} contentType - MIME type
 * @returns {Promise<Object>} - Upload result
 */
export async function uploadPlayerAsset(userId, filename, fileBuffer, contentType) {
  const key = `player-uploads/${userId}/sprites/${filename}`;

  return uploadFile(key, fileBuffer, contentType, {
    uploadedBy: userId,
    type: 'player-asset',
  });
}

/**
 * Upload planet thumbnail
 *
 * @param {string} planetId - Planet ID
 * @param {Buffer} fileBuffer - Image data
 * @returns {Promise<Object>} - Upload result
 */
export async function uploadPlanetThumbnail(planetId, fileBuffer) {
  const key = `thumbnails/planets/${planetId}-thumb.png`;

  return uploadFile(key, fileBuffer, 'image/png', {
    planetId,
    type: 'planet-thumbnail',
  });
}

/**
 * Test connection to Linode Object Storage
 *
 * @returns {Promise<Object>} - Test result
 */
export async function testConnection() {
  try {
    // Try to list objects (this will succeed even if bucket is empty)
    const result = await listFiles('', 1);

    return {
      success: true,
      message: 'Successfully connected to Linode Object Storage',
      bucket: BUCKET_NAME,
      region: LINODE_REGION,
      endpoint: ENDPOINT,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to connect to Linode Object Storage',
      error: error.message,
      bucket: BUCKET_NAME,
      region: LINODE_REGION,
      endpoint: ENDPOINT,
    };
  }
}

// Export configured client for advanced use
export { s3Client, BUCKET_NAME, LINODE_REGION, ENDPOINT };

export default {
  uploadFile,
  getPublicUrl,
  getSignedUrlForObject,
  deleteFile,
  listFiles,
  fileExists,
  getFileMetadata,
  uploadSpriteAtlas,
  uploadPlayerAsset,
  uploadPlanetThumbnail,
  testConnection,
};
