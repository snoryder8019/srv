/**
 * Space Image Helper
 * Provides default images for assets using free space/planetary APIs
 *
 * Available APIs:
 * - NASA APOD (Astronomy Picture of the Day)
 * - NASA Image Library
 * - Unsplash (space category)
 * - Placeholder images for different asset types
 */

/**
 * Get image URL for an asset based on its type
 * Falls back to placeholder images if no custom image provided
 */
export function getAssetImageUrl(asset) {
  // If asset has a custom uploaded image, use that
  if (asset.imageUrl) {
    return asset.imageUrl;
  }

  // If asset has uploaded image file
  if (asset.image) {
    return `/uploads/${asset.image}`;
  }

  // Otherwise, return default image based on asset type
  return getDefaultImageForType(asset.assetType, asset.title);
}

/**
 * Get default image URL based on asset type
 * Uses Unsplash Source API for free, random space images
 */
export function getDefaultImageForType(assetType, seed = '') {
  const baseUrl = 'https://source.unsplash.com/800x600/?';

  // Use title as seed for consistent images per asset
  const seedParam = seed ? `&sig=${encodeURIComponent(seed)}` : '';

  switch (assetType) {
    case 'galaxy':
      return `${baseUrl}galaxy,space,nebula${seedParam}`;

    case 'planet':
      return `${baseUrl}planet,space,astronomy${seedParam}`;

    case 'orbital':
      return `${baseUrl}space-station,satellite,orbit${seedParam}`;

    case 'anomaly':
      return `${baseUrl}nebula,cosmic,space-phenomenon${seedParam}`;

    case 'character':
      return `${baseUrl}astronaut,space-suit,sci-fi${seedParam}`;

    case 'item':
    case 'weapon':
      return `${baseUrl}technology,futuristic,sci-fi${seedParam}`;

    case 'environment':
      return `${baseUrl}alien-landscape,exoplanet,space${seedParam}`;

    case 'monster':
    case 'creature':
      return `${baseUrl}alien,creature,sci-fi${seedParam}`;

    default:
      return `${baseUrl}space,stars,universe${seedParam}`;
  }
}

/**
 * NASA API endpoints (for future implementation)
 * Note: Requires API key from https://api.nasa.gov/
 */
export const NASA_ENDPOINTS = {
  APOD: 'https://api.nasa.gov/planetary/apod',
  IMAGE_LIBRARY: 'https://images-api.nasa.gov/search',
  MARS_ROVER: 'https://api.nasa.gov/mars-photos/api/v1/rovers/curiosity/photos'
};

/**
 * Get NASA APOD image (requires API key)
 * @param {string} apiKey - NASA API key
 * @returns {Promise<string>} Image URL
 */
export async function getNASAApodImage(apiKey = 'DEMO_KEY') {
  try {
    const response = await fetch(`${NASA_ENDPOINTS.APOD}?api_key=${apiKey}`);
    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error('Failed to fetch NASA APOD:', error);
    return null;
  }
}

/**
 * Search NASA Image Library
 * @param {string} query - Search term
 * @returns {Promise<string[]>} Array of image URLs
 */
export async function searchNASAImages(query) {
  try {
    const response = await fetch(`${NASA_ENDPOINTS.IMAGE_LIBRARY}?q=${encodeURIComponent(query)}&media_type=image`);
    const data = await response.json();

    if (data.collection && data.collection.items) {
      return data.collection.items
        .filter(item => item.links && item.links.length > 0)
        .map(item => item.links[0].href)
        .slice(0, 10);
    }

    return [];
  } catch (error) {
    console.error('Failed to search NASA images:', error);
    return [];
  }
}

/**
 * Picsum (Lorem Picsum) - Alternative free image service
 * Good for placeholder images with consistent sizing
 */
export function getPicsumImage(width = 800, height = 600, seed = '') {
  const seedParam = seed ? `?random=${encodeURIComponent(seed)}` : '';
  return `https://picsum.photos/seed/${seed}/${width}/${height}`;
}

/**
 * Generate planetary image URL using a combination of services
 * Prioritizes variety and quality
 */
export function getPlanetaryImage(planetName, style = 'realistic') {
  // Create a hash from planet name for consistent images
  const seed = planetName.toLowerCase().replace(/\s+/g, '-');

  if (style === 'realistic') {
    return `https://source.unsplash.com/800x600/?planet,${seed}`;
  } else if (style === 'artistic') {
    return `https://source.unsplash.com/800x600/?nebula,cosmic,${seed}`;
  }

  return getDefaultImageForType('planet', seed);
}

/**
 * Generate galaxy image URL
 */
export function getGalaxyImage(galaxyName) {
  const seed = galaxyName.toLowerCase().replace(/\s+/g, '-');
  return `https://source.unsplash.com/800x600/?galaxy,spiral,${seed}`;
}

/**
 * Fallback placeholder image (base64 encoded simple space pattern)
 * Used when all external services fail
 */
export function getFallbackImage() {
  // Return a simple data URI with a space gradient
  return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8ZGVmcz4KICAgIDxyYWRpYWxHcmFkaWVudCBpZD0ic3BhY2VHcmFkaWVudCI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMxYTFhMmU7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6IzBhMGExYTtzdG9wLW9wYWNpdHk6MSIgLz4KICAgIDwvcmFkaWFsR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSI4MDAiIGhlaWdodD0iNjAwIiBmaWxsPSJ1cmwoI3NwYWNlR3JhZGllbnQpIi8+CiAgPGNpcmNsZSBjeD0iMTAwIiBjeT0iMTAwIiByPSIyIiBmaWxsPSJ3aGl0ZSIgb3BhY2l0eT0iMC44Ii8+CiAgPGNpcmNsZSBjeD0iMzAwIiBjeT0iMjAwIiByPSIxIiBmaWxsPSJ3aGl0ZSIgb3BhY2l0eT0iMC42Ii8+CiAgPGNpcmNsZSBjeD0iNjAwIiBjeT0iMTUwIiByPSIxLjUiIGZpbGw9IndoaXRlIiBvcGFjaXR5PSIwLjciLz4KICA8Y2lyY2xlIGN4PSI0NTAiIGN5PSI0MDAiIHI9IjEiIGZpbGw9IndoaXRlIiBvcGFjaXR5PSIwLjUiLz4KICA8Y2lyY2xlIGN4PSI3MDAiIGN5PSI1MDAiIHI9IjIiIGZpbGw9IndoaXRlIiBvcGFjaXR5PSIwLjkiLz4KICA8dGV4dCB4PSI0MDAiIHk9IjMwMCIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIyNCIgZmlsbD0iIzhhNGZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgb3BhY2l0eT0iMC41Ij5TdHJpbmdib3JuIFVuaXZlcnNlPC90ZXh0Pgo8L3N2Zz4=';
}

/**
 * Image error handler - returns fallback image
 */
export function handleImageError(event) {
  event.target.src = getFallbackImage();
  event.target.onerror = null; // Prevent infinite loop
}

/**
 * Preload image to check if it exists
 * @param {string} url - Image URL to check
 * @returns {Promise<boolean>} True if image loads successfully
 */
export async function checkImageExists(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
