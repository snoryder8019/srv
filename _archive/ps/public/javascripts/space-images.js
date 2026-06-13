/**
 * Client-side Space Image Helper
 * Provides default images for assets using free space/planetary APIs
 *
 * Sources:
 * - NASA Image Library (no API key)
 * - Unsplash (space photos)
 * - Pexels (requires API key)
 * - Fallback SVG placeholder
 */

/**
 * NASA Image Library - Real space images!
 * No API key required
 */
const NASA_IMAGE_LIBRARY = 'https://images-api.nasa.gov/search';

/**
 * Get image URL for an asset based on its type
 */
window.getAssetImageUrl = function(asset) {
  // If asset has a custom uploaded image, use that
  if (asset.imageUrl) {
    return asset.imageUrl;
  }

  // If asset has uploaded image file
  if (asset.image) {
    return `/uploads/${asset.image}`;
  }

  // Otherwise, return default image based on asset type
  return getDefaultImageForType(asset.assetType, asset.title || asset._id);
};

/**
 * Fetch NASA image for a specific search term
 * Returns promise with image URL
 */
window.fetchNASAImage = async function(searchTerm) {
  try {
    const response = await fetch(`${NASA_IMAGE_LIBRARY}?q=${encodeURIComponent(searchTerm)}&media_type=image`);
    const data = await response.json();

    if (data.collection && data.collection.items && data.collection.items.length > 0) {
      // Get first item with an image
      const item = data.collection.items[0];
      if (item.links && item.links.length > 0) {
        return item.links[0].href;
      }
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch NASA image:', error);
    return null;
  }
};

/**
 * Get NASA search terms for asset types
 * These will fetch REAL Hubble/NASA images!
 */
function getNASASearchTerm(assetType) {
  switch (assetType) {
    case 'galaxy':
      return 'hubble galaxy';
    case 'planet':
      return 'planet mars jupiter saturn';
    case 'orbital':
      return 'international space station';
    case 'anomaly':
      return 'hubble nebula';
    case 'environment':
      return 'mars landscape';
    default:
      return 'space hubble';
  }
}

/**
 * Get default image URL based on asset type
 * Uses multiple sources with fallback chain
 */
function getDefaultImageForType(assetType, seed = '') {
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
 * Note: HUBBLE_IMAGES constant is defined in the page's <head> section
 * to avoid duplicate declarations. The getHubbleImage function is also
 * defined there for immediate availability.
 */

/**
 * Note: handleSpaceImageError function is also defined in the page's <head>
 * section for immediate availability when images load.
 */
