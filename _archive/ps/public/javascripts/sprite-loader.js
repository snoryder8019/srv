/**
 * Sprite Atlas Loader
 * Client-side sprite management for planetary rendering
 */

class SpriteAtlasLoader {
  constructor() {
    this.atlases = new Map(); // atlasKey → Image
    this.manifests = new Map(); // atlasKey → manifest data
    this.loadingPromises = new Map(); // Track loading state
    this.loaded = new Set(); // Successfully loaded atlases
  }

  /**
   * Load a sprite atlas
   *
   * @param {string} atlasKey - Atlas key (e.g., "forest-terrain-001")
   * @param {string} atlasUrl - Image URL
   * @param {Object} manifest - Tile manifest
   * @returns {Promise<Image>} - Loaded image
   */
  async loadAtlas(atlasKey, atlasUrl, manifest) {
    // Return existing if already loaded
    if (this.atlases.has(atlasKey)) {
      return this.atlases.get(atlasKey);
    }

    // Return existing loading promise if in progress
    if (this.loadingPromises.has(atlasKey)) {
      return this.loadingPromises.get(atlasKey);
    }

    // Create new loading promise
    const loadPromise = new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        this.atlases.set(atlasKey, img);
        this.manifests.set(atlasKey, manifest);
        this.loaded.add(atlasKey);
        this.loadingPromises.delete(atlasKey);

        console.log(`✓ Loaded atlas: ${atlasKey} (${img.width}×${img.height})`);
        resolve(img);
      };

      img.onerror = (error) => {
        this.loadingPromises.delete(atlasKey);
        console.error(`✗ Failed to load atlas: ${atlasKey}`, error);
        reject(new Error(`Failed to load atlas: ${atlasKey}`));
      };

      // Start loading
      img.src = atlasUrl;
    });

    this.loadingPromises.set(atlasKey, loadPromise);
    return loadPromise;
  }

  /**
   * Draw a tile from an atlas
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {string} atlasKey - Atlas key
   * @param {number} tileIndex - Tile index (0-24 for 5×5)
   * @param {number} destX - Destination X
   * @param {number} destY - Destination Y
   * @param {number} scale - Scale multiplier (default 1)
   * @returns {boolean} - True if drawn successfully
   */
  drawTile(ctx, atlasKey, tileIndex, destX, destY, scale = 1) {
    const atlas = this.atlases.get(atlasKey);
    if (!atlas) {
      console.warn(`Atlas not loaded: ${atlasKey}`);
      return false;
    }

    const manifest = this.manifests.get(atlasKey);
    const gridSize = manifest?.gridSize || { cols: 5, rows: 5, tileWidth: 16, tileHeight: 16 };

    // Calculate source position in atlas
    const col = tileIndex % gridSize.cols;
    const row = Math.floor(tileIndex / gridSize.cols);
    const sourceX = col * gridSize.tileWidth;
    const sourceY = row * gridSize.tileHeight;

    // Draw tile
    const destWidth = gridSize.tileWidth * scale;
    const destHeight = gridSize.tileHeight * scale;

    try {
      ctx.drawImage(
        atlas,
        sourceX,
        sourceY,
        gridSize.tileWidth,
        gridSize.tileHeight,
        destX,
        destY,
        destWidth,
        destHeight
      );
      return true;
    } catch (error) {
      console.error(`Error drawing tile ${tileIndex} from ${atlasKey}:`, error);
      return false;
    }
  }

  /**
   * Draw a tile by name (uses manifest lookup)
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {string} atlasKey - Atlas key
   * @param {string} tileName - Tile name (e.g., "grass", "oak_tree")
   * @param {number} destX - Destination X
   * @param {number} destY - Destination Y
   * @param {number} scale - Scale multiplier
   * @returns {boolean} - True if drawn successfully
   */
  drawTileByName(ctx, atlasKey, tileName, destX, destY, scale = 1) {
    const manifest = this.manifests.get(atlasKey);
    if (!manifest) {
      console.warn(`Manifest not found: ${atlasKey}`);
      return false;
    }

    const tile = manifest.tiles?.find(t => t.name === tileName);
    if (!tile) {
      console.warn(`Tile not found: ${tileName} in ${atlasKey}`);
      return false;
    }

    return this.drawTile(ctx, atlasKey, tile.index, destX, destY, scale);
  }

  /**
   * Draw a tile with rotation
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {string} atlasKey - Atlas key
   * @param {number} tileIndex - Tile index
   * @param {number} destX - Destination X (center)
   * @param {number} destY - Destination Y (center)
   * @param {number} rotation - Rotation in degrees (0, 90, 180, 270)
   * @param {number} scale - Scale multiplier
   * @returns {boolean} - True if drawn successfully
   */
  drawTileRotated(ctx, atlasKey, tileIndex, destX, destY, rotation, scale = 1) {
    const atlas = this.atlases.get(atlasKey);
    if (!atlas) return false;

    const manifest = this.manifests.get(atlasKey);
    const gridSize = manifest?.gridSize || { cols: 5, rows: 5, tileWidth: 16, tileHeight: 16 };

    const col = tileIndex % gridSize.cols;
    const row = Math.floor(tileIndex / gridSize.cols);
    const sourceX = col * gridSize.tileWidth;
    const sourceY = row * gridSize.tileHeight;

    const destWidth = gridSize.tileWidth * scale;
    const destHeight = gridSize.tileHeight * scale;

    ctx.save();
    ctx.translate(destX + destWidth / 2, destY + destHeight / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(
      atlas,
      sourceX,
      sourceY,
      gridSize.tileWidth,
      gridSize.tileHeight,
      -destWidth / 2,
      -destHeight / 2,
      destWidth,
      destHeight
    );
    ctx.restore();

    return true;
  }

  /**
   * Draw a tile flipped horizontally
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {string} atlasKey - Atlas key
   * @param {number} tileIndex - Tile index
   * @param {number} destX - Destination X
   * @param {number} destY - Destination Y
   * @param {number} scale - Scale multiplier
   * @returns {boolean} - True if drawn successfully
   */
  drawTileFlipped(ctx, atlasKey, tileIndex, destX, destY, scale = 1) {
    const atlas = this.atlases.get(atlasKey);
    if (!atlas) return false;

    const manifest = this.manifests.get(atlasKey);
    const gridSize = manifest?.gridSize || { cols: 5, rows: 5, tileWidth: 16, tileHeight: 16 };

    const col = tileIndex % gridSize.cols;
    const row = Math.floor(tileIndex / gridSize.cols);
    const sourceX = col * gridSize.tileWidth;
    const sourceY = row * gridSize.tileHeight;

    const destWidth = gridSize.tileWidth * scale;
    const destHeight = gridSize.tileHeight * scale;

    ctx.save();
    ctx.translate(destX + destWidth, destY);
    ctx.scale(-1, 1);
    ctx.drawImage(
      atlas,
      sourceX,
      sourceY,
      gridSize.tileWidth,
      gridSize.tileHeight,
      0,
      0,
      destWidth,
      destHeight
    );
    ctx.restore();

    return true;
  }

  /**
   * Get tile info from manifest
   *
   * @param {string} atlasKey - Atlas key
   * @param {number|string} tileIdentifier - Tile index or name
   * @returns {Object|null} - Tile info
   */
  getTileInfo(atlasKey, tileIdentifier) {
    const manifest = this.manifests.get(atlasKey);
    if (!manifest) return null;

    if (typeof tileIdentifier === 'number') {
      return manifest.tiles?.find(t => t.index === tileIdentifier) || null;
    } else {
      return manifest.tiles?.find(t => t.name === tileIdentifier) || null;
    }
  }

  /**
   * Check if atlas is loaded
   *
   * @param {string} atlasKey - Atlas key
   * @returns {boolean} - True if loaded
   */
  isLoaded(atlasKey) {
    return this.loaded.has(atlasKey);
  }

  /**
   * Unload an atlas (free memory)
   *
   * @param {string} atlasKey - Atlas key
   */
  unloadAtlas(atlasKey) {
    this.atlases.delete(atlasKey);
    this.manifests.delete(atlasKey);
    this.loaded.delete(atlasKey);
    console.log(`Unloaded atlas: ${atlasKey}`);
  }

  /**
   * Preload multiple atlases
   *
   * @param {Array<Object>} atlasConfigs - Array of {key, url, manifest}
   * @returns {Promise<Array>} - Array of loaded images
   */
  async preloadAtlases(atlasConfigs) {
    console.log(`Preloading ${atlasConfigs.length} sprite atlases...`);

    const promises = atlasConfigs.map(config =>
      this.loadAtlas(config.key, config.url, config.manifest)
    );

    try {
      const results = await Promise.all(promises);
      console.log(`✓ Preloaded ${results.length} atlases successfully`);
      return results;
    } catch (error) {
      console.error('Error preloading atlases:', error);
      throw error;
    }
  }

  /**
   * Get all loaded atlas keys
   *
   * @returns {Array<string>} - Atlas keys
   */
  getLoadedAtlases() {
    return Array.from(this.loaded);
  }

  /**
   * Get memory usage estimate
   *
   * @returns {Object} - Memory stats
   */
  getMemoryStats() {
    let totalPixels = 0;
    this.atlases.forEach(img => {
      totalPixels += img.width * img.height;
    });

    // Estimate: 4 bytes per pixel (RGBA)
    const estimatedBytes = totalPixels * 4;
    const estimatedMB = (estimatedBytes / 1024 / 1024).toFixed(2);

    return {
      loadedAtlases: this.loaded.size,
      totalPixels,
      estimatedMB: parseFloat(estimatedMB),
    };
  }

  /**
   * Clear all loaded atlases
   */
  clearAll() {
    this.atlases.clear();
    this.manifests.clear();
    this.loaded.clear();
    this.loadingPromises.clear();
    console.log('Cleared all sprite atlases');
  }
}

// Create global instance
const spriteLoader = new SpriteAtlasLoader();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpriteAtlasLoader, spriteLoader };
}
