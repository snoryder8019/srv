/**
 * Scatter Repulsion System
 * Adds repulsion forces from specific coordinates to prevent northwest drift
 * Repulsion strength is 15% higher than edge gravity forces
 */

/**
 * Apply scatter repulsion from specified coordinates
 * @param {Object} asset - The asset to apply forces to
 * @param {number} repelX - X coordinate to repel from
 * @param {number} repelY - Y coordinate to repel from
 * @param {number} baseGravityStrength - Base edge gravity strength from physics
 * @param {number} repelRadius - Radius of repulsion effect (default: 800)
 * @param {number} speedMultiplier - Movement speed multiplier
 */
export function applyScatterRepulsion(asset, repelX, repelY, baseGravityStrength, repelRadius = 800, speedMultiplier = 1) {
  // Calculate 15% higher repulsion than edge gravity
  const REPULSION_MULTIPLIER = 1.15;
  const repulsionStrength = baseGravityStrength * REPULSION_MULTIPLIER;

  // Calculate distance from repulsion point
  const dx = asset.x - repelX;
  const dy = asset.y - repelY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Only apply if within repulsion radius
  if (distance > 0 && distance < repelRadius) {
    // Inverse square law for natural falloff
    const proximity = 1 - (distance / repelRadius);
    const force = proximity * proximity * repulsionStrength * speedMultiplier;

    // Normalize direction and apply force (push away from repel point)
    const normalizedX = dx / distance;
    const normalizedY = dy / distance;

    asset.vx += normalizedX * force;
    asset.vy += normalizedY * force;
  }
}

/**
 * Apply northwest corner anti-drift repulsion
 * Adds multiple repulsion points in northwest quadrant to counteract drift
 * @param {Object} asset - The asset to apply forces to
 * @param {number} mapWidth - Map width
 * @param {number} mapHeight - Map height
 * @param {number} baseGravityStrength - Base edge gravity strength
 * @param {number} speedMultiplier - Movement speed multiplier
 */
export function applyNorthwestAntiDrift(asset, mapWidth, mapHeight, baseGravityStrength, speedMultiplier = 1) {
  // Define repulsion points strategically placed in northwest quadrant
  // These create a "pressure system" that redistributes objects
  const repulsionPoints = [
    // Northwest corner - strongest repulsion
    { x: mapWidth * 0.15, y: mapHeight * 0.15, radius: 1000 },
    // North edge center-left
    { x: mapWidth * 0.25, y: mapHeight * 0.05, radius: 800 },
    // West edge center-top
    { x: mapWidth * 0.05, y: mapHeight * 0.25, radius: 800 },
    // Additional diagonal point
    { x: mapWidth * 0.20, y: mapHeight * 0.20, radius: 900 }
  ];

  // Apply each repulsion point
  repulsionPoints.forEach(point => {
    applyScatterRepulsion(
      asset,
      point.x,
      point.y,
      baseGravityStrength,
      point.radius,
      speedMultiplier
    );
  });
}

/**
 * Apply center attraction (weaker than repulsion)
 * Gently pulls objects toward center to balance the system
 * @param {Object} asset - The asset to apply forces to
 * @param {number} mapWidth - Map width
 * @param {number} mapHeight - Map height
 * @param {number} baseGravityStrength - Base edge gravity strength
 * @param {number} speedMultiplier - Movement speed multiplier
 */
export function applyCenterAttraction(asset, mapWidth, mapHeight, baseGravityStrength, speedMultiplier = 1) {
  const centerX = mapWidth / 2;
  const centerY = mapHeight / 2;

  const dx = centerX - asset.x;
  const dy = centerY - asset.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 0) {
    // Very weak center attraction (only 30% of base gravity)
    // This provides gentle redistribution without strong clustering
    const attractionStrength = baseGravityStrength * 0.3;
    const maxAttractionDistance = Math.min(mapWidth, mapHeight) * 0.4;

    // Only attract if far from center
    if (distance > maxAttractionDistance) {
      const proximity = (distance - maxAttractionDistance) / maxAttractionDistance;
      const force = Math.min(proximity, 1) * attractionStrength * speedMultiplier;

      const normalizedX = dx / distance;
      const normalizedY = dy / distance;

      asset.vx += normalizedX * force;
      asset.vy += normalizedY * force;
    }
  }
}

/**
 * Apply quadrant balancing forces
 * Ensures even distribution across all four quadrants
 * @param {Object} asset - The asset to apply forces to
 * @param {number} mapWidth - Map width
 * @param {number} mapHeight - Map height
 * @param {number} baseGravityStrength - Base edge gravity strength
 * @param {number} speedMultiplier - Movement speed multiplier
 */
export function applyQuadrantBalancing(asset, mapWidth, mapHeight, baseGravityStrength, speedMultiplier = 1) {
  const centerX = mapWidth / 2;
  const centerY = mapHeight / 2;

  // Determine which quadrant the asset is in
  const isWest = asset.x < centerX;
  const isNorth = asset.y < centerY;

  // Apply additional repulsion from quadrant corners to prevent clustering
  const cornerRepulsionStrength = baseGravityStrength * 0.8;
  const cornerRepulsionRadius = 600;

  // Define corner positions
  const corners = {
    nw: { x: mapWidth * 0.1, y: mapHeight * 0.1 },   // Northwest (problem area)
    ne: { x: mapWidth * 0.9, y: mapHeight * 0.1 },   // Northeast
    sw: { x: mapWidth * 0.1, y: mapHeight * 0.9 },   // Southwest
    se: { x: mapWidth * 0.9, y: mapHeight * 0.9 }    // Southeast
  };

  // Apply stronger repulsion for northwest corner
  if (isWest && isNorth) {
    // Asset is in northwest quadrant - apply STRONG corner repulsion
    applyScatterRepulsion(
      asset,
      corners.nw.x,
      corners.nw.y,
      baseGravityStrength * 1.5, // 50% stronger for problem corner
      cornerRepulsionRadius,
      speedMultiplier
    );
  } else if (!isWest && isNorth) {
    // Northeast quadrant
    applyScatterRepulsion(
      asset,
      corners.ne.x,
      corners.ne.y,
      cornerRepulsionStrength,
      cornerRepulsionRadius,
      speedMultiplier
    );
  } else if (isWest && !isNorth) {
    // Southwest quadrant
    applyScatterRepulsion(
      asset,
      corners.sw.x,
      corners.sw.y,
      cornerRepulsionStrength,
      cornerRepulsionRadius,
      speedMultiplier
    );
  } else {
    // Southeast quadrant
    applyScatterRepulsion(
      asset,
      corners.se.x,
      corners.se.y,
      cornerRepulsionStrength,
      cornerRepulsionRadius,
      speedMultiplier
    );
  }
}

/**
 * Main scatter repulsion system
 * Combines all repulsion strategies to prevent drift and ensure even distribution
 * @param {Object} asset - The asset to apply forces to
 * @param {number} mapWidth - Map width
 * @param {number} mapHeight - Map height
 * @param {number} baseGravityStrength - Base edge gravity strength from physics
 * @param {number} speedMultiplier - Movement speed multiplier
 */
export function applyScatterSystem(asset, mapWidth, mapHeight, baseGravityStrength, speedMultiplier = 1) {
  // 1. Apply northwest anti-drift (strongest effect)
  applyNorthwestAntiDrift(asset, mapWidth, mapHeight, baseGravityStrength, speedMultiplier);

  // 2. Apply quadrant balancing
  applyQuadrantBalancing(asset, mapWidth, mapHeight, baseGravityStrength, speedMultiplier);

  // 3. Apply gentle center attraction for long-term balance
  applyCenterAttraction(asset, mapWidth, mapHeight, baseGravityStrength, speedMultiplier);
}

export default {
  applyScatterRepulsion,
  applyNorthwestAntiDrift,
  applyCenterAttraction,
  applyQuadrantBalancing,
  applyScatterSystem
};
