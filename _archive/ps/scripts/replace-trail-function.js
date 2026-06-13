/**
 * Replace the createGalaxyTrail function to use actual position history
 */

import fs from 'fs';

const filePath = '/srv/ps/public/javascripts/galactic-map-3d.js';
const content = fs.readFileSync(filePath, 'utf8');

// Find the function start and end
const functionStart = content.indexOf('  /**\n   * Create or update purple orbital trail for a galaxy');
const functionEnd = content.indexOf('\n  }\n\n  /**\n   * Create or update character pin', functionStart);

if (functionStart === -1 || functionEnd === -1) {
  console.error('Could not find function boundaries');
  process.exit(1);
}

const newFunction = `  /**
   * Create or update purple orbital trail for a galaxy
   * Shows the galaxy's ACTUAL past trajectory (from physics position history)
   */
  createGalaxyTrail(galaxyMesh, galaxyId, trailHistory = null) {
    // Only works in galactic level
    if (this.currentLevel !== 'galactic') return;

    const asset = this.assets.get(galaxyId);
    if (!asset || !galaxyMesh) {
      console.warn(\`⚠️ Cannot create trail: asset or mesh missing for \${galaxyId}\`);
      return;
    }

    // Use trail history from server if provided, otherwise skip
    if (!trailHistory || trailHistory.length < 2) {
      // Not enough history yet, skip trail creation
      return;
    }

    // Convert trail history to Vector3 points (newest to oldest)
    const trailPoints = [];
    for (let i = trailHistory.length - 1; i >= 0; i--) {
      const pos = trailHistory[i];
      trailPoints.push(new THREE.Vector3(pos.x, pos.y, pos.z));
    }

    // Create line geometry from actual position history
    const trailGeometry = new THREE.BufferGeometry().setFromPoints(trailPoints);

    // Create colors array for gradient (bright purple at galaxy, fade to transparent)
    const colors = [];
    const numPoints = trailPoints.length;
    for (let i = 0; i < numPoints; i++) {
      const t = i / (numPoints - 1); // 0 to 1 (newest to oldest)
      const opacity = 1.0 - t; // Fade from 1.0 to 0.0
      // Purple color (RGB: 138, 79, 255 normalized) with fading opacity
      colors.push(opacity * 0.541, opacity * 0.31, opacity * 1.0);
    }
    trailGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Create line material with vertex colors (purple pen stripe)
    const trailMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      linewidth: 3,
      blending: THREE.AdditiveBlending // Bright purple additive blending
    });

    const trailLine = new THREE.Line(trailGeometry, trailMaterial);
    trailLine.frustumCulled = false;
    this.assetsGroup.add(trailLine);

    // Store trail data
    const existingOrbit = this.galaxyOrbits.find(o => o.galaxyId === galaxyId);
    if (existingOrbit) {
      // Remove old trail
      if (existingOrbit.trail) {
        this.assetsGroup.remove(existingOrbit.trail);
        existingOrbit.trail.geometry.dispose();
        existingOrbit.trail.material.dispose();
      }
      // Update existing entry
      existingOrbit.trail = trailLine;
      existingOrbit.trailPoints = trailPoints;
      existingOrbit.trailHistory = trailHistory;
    } else {
      // Add new entry
      this.galaxyOrbits.push({
        galaxyId: galaxyId,
        mesh: galaxyMesh,
        trail: trailLine,
        trailPoints: trailPoints,
        trailHistory: trailHistory
      });
    }
  }`;

const newContent = content.substring(0, functionStart) + newFunction + content.substring(functionEnd + 4);

fs.writeFileSync(filePath, newContent, 'utf8');
console.log('✅ Replaced createGalaxyTrail function with position history version');
