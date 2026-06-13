#!/usr/bin/env node

import fetch from 'node-fetch';

async function testFilter() {
  console.log('Testing Galactic Map Asset Filter\n');

  try {
    const response = await fetch('http://localhost:3399/api/v1/assets/approved');
    const data = await response.json();

    const validTypes = ['galaxy', 'anomaly', 'orbital', 'ship', 'structure'];
    const filtered = data.assets.filter(a => validTypes.includes(a.assetType));

    console.log('📊 Asset Filter Results:\n');
    console.log(`Total approved assets: ${data.assets.length}`);
    console.log(`Galactic map assets: ${filtered.length}`);
    console.log(`Hidden from map: ${data.assets.length - filtered.length}\n`);

    console.log('✅ Visible on Galactic Map:');
    const byType = {};
    filtered.forEach(a => {
      byType[a.assetType] = (byType[a.assetType] || 0) + 1;
    });
    Object.entries(byType).sort().forEach(([type, count]) => {
      console.log(`  ${type.padEnd(12)} ${count.toString().padStart(2)} assets`);
    });

    console.log('\n❌ Hidden from Galactic Map:');
    const hidden = data.assets.filter(a => !validTypes.includes(a.assetType));
    const hiddenByType = {};
    hidden.forEach(a => {
      hiddenByType[a.assetType] = (hiddenByType[a.assetType] || 0) + 1;
    });
    Object.entries(hiddenByType).sort().forEach(([type, count]) => {
      console.log(`  ${type.padEnd(12)} ${count.toString().padStart(2)} assets (too small for galactic scale)`);
    });

    console.log('\n🌟 Stars Hidden:');
    const stars = data.assets.filter(a => a.assetType === 'star');
    console.log(`  Removed ${stars.length} stars from galactic map`);
    console.log('  Reason: Stars are stellar scale (light-seconds), not galactic scale (light-years)');
    console.log('  Will appear in future star system view\n');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

testFilter();
