#!/usr/bin/env node
/**
 * Randomize Galactic Map Positions
 * This script clears spatial data and forces all assets to regenerate with random positions
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const GAME_STATE_URL = process.env.GAME_STATE_SERVICE_URL || 'http://localhost:3500';
const PS_URL = 'http://localhost:3399';

async function randomizeMap() {
  console.log('🎲 Randomizing Galactic Map Positions...\n');

  try {
    // Step 1: Clear spatial data
    console.log('1️⃣  Clearing spatial data from game-state-service...');
    const clearResponse = await fetch(`${GAME_STATE_URL}/api/spatial/assets`, {
      method: 'DELETE'
    });

    if (!clearResponse.ok) {
      throw new Error(`Failed to clear spatial data: ${clearResponse.statusText}`);
    }

    const clearData = await clearResponse.json();
    console.log(`   ✅ ${clearData.message}`);

    // Step 2: Verify it's empty
    console.log('\n2️⃣  Verifying spatial data is empty...');
    const checkResponse = await fetch(`${GAME_STATE_URL}/api/spatial/assets`);
    const checkData = await checkResponse.json();
    console.log(`   📊 Current assets in spatial service: ${checkData.assets?.length || 0}`);

    if (checkData.assets?.length > 0) {
      console.log(`   ⚠️  Warning: Spatial service still has ${checkData.assets.length} assets`);
      console.log(`   These will be overwritten on next map load`);
    }

    // Step 3: Load assets from PS API
    console.log('\n3️⃣  Loading approved assets from PS service...');
    const assetsResponse = await fetch(`${PS_URL}/api/v1/assets/approved/list`);
    const assetsData = await assetsResponse.json();

    if (!assetsData.success || !assetsData.assets) {
      throw new Error('Failed to load assets from PS service');
    }

    const validTypes = ['galaxy', 'orbital', 'anomaly'];
    const filteredAssets = assetsData.assets.filter(a => validTypes.includes(a.assetType));
    console.log(`   📦 Loaded ${filteredAssets.length} assets (${assetsData.assets.length} total)`);

    // Step 4: Generate random positions
    console.log('\n4️⃣  Generating random positions for all assets...');
    const WIDTH = 5000;
    const HEIGHT = 5000;
    const PADDING = 200;

    const newAssets = filteredAssets.map(asset => {
      let x, y, vx, vy, radius, isStationary;

      // Space hubs get fixed corner positions (ONLY for space hubs, ignore all other initialPosition data)
      if (asset.hubData?.isStartingLocation && asset.hubData?.location) {
        x = asset.hubData.location.x;
        y = asset.hubData.location.y;
        vx = 0;
        vy = 0;
        radius = 50;
        isStationary = true;
      } else {
        // FORCE random position across entire map (ignore any initialPosition fields)
        x = PADDING + Math.random() * (WIDTH - PADDING * 2);
        y = PADDING + Math.random() * (HEIGHT - PADDING * 2);

        // Anomalies are stationary
        isStationary = asset.assetType === 'anomaly';

        if (isStationary) {
          vx = 0;
          vy = 0;
        } else {
          // Random velocity for moving objects
          const velocityMagnitude = Math.random() * 0.04 + 0.01;
          const velocityAngle = Math.random() * Math.PI * 2;
          vx = Math.cos(velocityAngle) * velocityMagnitude;
          vy = Math.sin(velocityAngle) * velocityMagnitude;
        }

        radius = 8 + (asset.votes || 0) * 0.15;
      }

      return {
        _id: asset._id,
        title: asset.title,
        assetType: asset.assetType,
        x,
        y,
        vx,
        vy,
        radius,
        isStationary
      };
    });

    console.log(`   ✨ Generated ${newAssets.length} randomized positions`);

    // Step 5: Save to spatial service
    console.log('\n5️⃣  Saving randomized positions to spatial service...');
    const saveResponse = await fetch(`${GAME_STATE_URL}/api/spatial/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assets: newAssets })
    });

    if (!saveResponse.ok) {
      throw new Error(`Failed to save spatial data: ${saveResponse.statusText}`);
    }

    const saveData = await saveResponse.json();
    console.log(`   ✅ ${saveData.message}`);

    // Step 6: Verify final state
    console.log('\n6️⃣  Verifying final positions...');
    const finalResponse = await fetch(`${GAME_STATE_URL}/api/spatial/assets`);
    const finalData = await finalResponse.json();

    console.log(`   📊 Total assets with positions: ${finalData.assets?.length || 0}`);

    if (finalData.assets && finalData.assets.length > 0) {
      const xs = finalData.assets.map(a => a.x);
      const ys = finalData.assets.map(a => a.y);
      const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
      const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;

      console.log('   📍 Distribution:');
      console.log(`      X range: ${Math.min(...xs).toFixed(0)} to ${Math.max(...xs).toFixed(0)} (center: ${avgX.toFixed(0)})`);
      console.log(`      Y range: ${Math.min(...ys).toFixed(0)} to ${Math.max(...ys).toFixed(0)} (center: ${avgY.toFixed(0)})`);
    }

    console.log('\n✅ Randomization complete! Reload galactic map to see new positions.');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

randomizeMap();
