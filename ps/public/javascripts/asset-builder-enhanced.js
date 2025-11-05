/**
 * Enhanced Asset Builder Client Script
 * Supports stats, lore, and community features
 */

let pixelEditor = null;
let currentAssetId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize pixel editor
  pixelEditor = new PixelEditor('pixelEditorContainer', {
    gridSize: 32,
    pixelSize: 12,
    defaultColor: '#000000'
  });

  // Setup file upload previews
  setupFilePreview('pixelArtFile', 'pixelArtPreview');
  setupFilePreview('fullscreenFile', 'fullscreenPreview');
  setupFilePreview('indexCardFile', 'indexCardPreview');

  // Setup 3D model/texture upload handlers
  setup3DFileHandlers();

  // Setup form handlers
  document.getElementById('resetBtn').addEventListener('click', resetForm);
  document.getElementById('saveDraftBtn').addEventListener('click', saveDraft);
  document.getElementById('submitBtn').addEventListener('click', submitForApproval);

  // Setup asset type change handler
  document.getElementById('assetType').addEventListener('change', handleAssetTypeChange);

  // Setup enhanced hierarchy system
  setupEnhancedHierarchy();

  // Setup Build Interior button
  setupBuildInteriorButton();

  // Check if editing existing asset from URL
  const urlParams = new URLSearchParams(window.location.search);
  const assetId = urlParams.get('id');

  if (assetId) {
    console.log(`📂 Loading existing asset for editing: ${assetId}`);
    await loadExistingAsset(assetId);
  }

  // Load user's assets
  loadAssets();
});

/**
 * Setup file upload preview
 */
function setupFilePreview(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        preview.innerHTML = `
          <img src="${event.target.result}" class="preview-image" alt="Preview">
          <p class="file-info">${file.name} (${(file.size / 1024).toFixed(2)} KB)</p>
        `;
      };
      reader.readAsDataURL(file);
    }
  });
}

/**
 * Show alert message
 */
function showAlert(message, type = 'info') {
  const alertContainer = document.getElementById('alertContainer');
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;
  alertContainer.appendChild(alert);

  setTimeout(() => {
    alert.remove();
  }, 5000);
}

/**
 * Load existing asset for editing
 */
async function loadExistingAsset(assetId) {
  try {
    showAlert('Loading asset data...', 'info');

    const response = await fetch(`/api/v1/assets/${assetId}`, {
      credentials: 'same-origin'
    });

    const data = await response.json();

    if (!data.success || !data.asset) {
      throw new Error('Asset not found');
    }

    const asset = data.asset;
    console.log('✅ Asset loaded:', asset);

    // Store current asset ID for updates
    currentAssetId = assetId;

    // Populate basic fields
    document.getElementById('assetTitle').value = asset.title || '';
    document.getElementById('assetDescription').value = asset.description || '';
    document.getElementById('assetType').value = asset.assetType || '';

    // Trigger asset type change to show type-specific fields
    if (asset.assetType) {
      const event = new Event('change');
      document.getElementById('assetType').dispatchEvent(event);

      // Wait for type-specific fields to be created
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Populate subType if present
    if (asset.subType && document.getElementById('subType')) {
      document.getElementById('subType').value = asset.subType;
    }

    // Populate lore fields
    if (document.getElementById('lore')) {
      document.getElementById('lore').value = asset.lore || '';
    }
    if (document.getElementById('backstory')) {
      document.getElementById('backstory').value = asset.backstory || '';
    }
    if (document.getElementById('flavor')) {
      document.getElementById('flavor').value = asset.flavor || '';
    }

    // Populate tags
    if (asset.tags && document.getElementById('tags')) {
      document.getElementById('tags').value = asset.tags.join(', ');
    }

    // Populate environment-specific fields
    if (asset.assetType === 'environment') {
      if (asset.environmentType && document.getElementById('environmentType')) {
        document.getElementById('environmentType').value = asset.environmentType;
      }
      if (asset.climate && document.getElementById('climate')) {
        document.getElementById('climate').value = asset.climate;
      }
      if (asset.atmosphere && document.getElementById('atmosphere')) {
        document.getElementById('atmosphere').value = asset.atmosphere;
      }
      if (asset.gravity && document.getElementById('gravity')) {
        document.getElementById('gravity').value = asset.gravity;
      }
      if (asset.resources && document.getElementById('resources')) {
        document.getElementById('resources').value = Array.isArray(asset.resources) ? asset.resources.join(', ') : asset.resources;
      }
    }

    // Populate object-specific fields
    if (asset.assetType === 'object') {
      if (asset.objectType && document.getElementById('objectType')) {
        document.getElementById('objectType').value = asset.objectType;
      }
      if (document.getElementById('isInteractive')) {
        document.getElementById('isInteractive').checked = asset.isInteractive || false;
      }
      if (asset.interactionType && document.getElementById('interactionType')) {
        document.getElementById('interactionType').value = asset.interactionType;
      }
    }

    // Populate hierarchy parent
    if (asset.hierarchy && asset.hierarchy.parent) {
      if (document.getElementById('parentAsset')) {
        document.getElementById('parentAsset').value = asset.hierarchy.parent;
      }
      if (document.getElementById('parentAssetType')) {
        document.getElementById('parentAssetType').value = asset.hierarchy.parentType || '';
      }
    }

    // Populate 3D coordinates if present
    if (asset.coordinates3D) {
      if (document.getElementById('coord3D_x')) {
        document.getElementById('coord3D_x').value = asset.coordinates3D.x || 0;
      }
      if (document.getElementById('coord3D_y')) {
        document.getElementById('coord3D_y').value = asset.coordinates3D.y || 0;
      }
      if (document.getElementById('coord3D_z')) {
        document.getElementById('coord3D_z').value = asset.coordinates3D.z || 0;
      }
    }

    // Populate galactic coordinates if present
    if (asset.coordinates) {
      if (document.getElementById('coord_x')) {
        document.getElementById('coord_x').value = asset.coordinates.x || 0;
      }
      if (document.getElementById('coord_y')) {
        document.getElementById('coord_y').value = asset.coordinates.y || 0;
      }
    }

    // Load image previews if available
    if (asset.images) {
      if (asset.images.pixelArt) {
        document.getElementById('pixelArtPreview').innerHTML = `
          <img src="${asset.images.pixelArt}" class="preview-image" alt="Pixel Art">
          <p class="file-info">Current pixel art</p>
        `;
      }
      if (asset.images.fullscreen) {
        document.getElementById('fullscreenPreview').innerHTML = `
          <img src="${asset.images.fullscreen}" class="preview-image" alt="Fullscreen">
          <p class="file-info">Current fullscreen image</p>
        `;
      }
      if (asset.images.indexCard) {
        document.getElementById('indexCardPreview').innerHTML = `
          <img src="${asset.images.indexCard}" class="preview-image" alt="Index Card">
          <p class="file-info">Current index card</p>
        `;
      }
    }

    // Update button text to indicate update mode
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
      submitBtn.textContent = '💾 Update Asset';
    }

    showAlert(`✅ Loaded asset: ${asset.title}`, 'success');
  } catch (error) {
    console.error('❌ Error loading asset:', error);
    showAlert(`Failed to load asset: ${error.message}`, 'error');
  }
}

/**
 * Handle asset type change - show/hide type-specific fields
 */
function handleAssetTypeChange(e) {
  const assetType = e.target.value;
  const container = document.getElementById('typeSpecificFields');

  // Clear existing fields
  container.innerHTML = '';

  if (!assetType) return;

  let fieldsHTML = '<div class="form-section"><h3>Type-Specific Properties</h3>';

  switch(assetType) {
    case 'environment':
      fieldsHTML += `
        <div class="form-group">
          <label for="environmentType">Environment Type *</label>
          <select id="environmentType" name="environmentType">
            <option value="">Select Environment Type</option>
            <option value="planet">Planet</option>
            <option value="moon">Moon</option>
            <option value="station">Space Station</option>
            <option value="asteroid">Asteroid</option>
            <option value="nebula">Nebula</option>
            <option value="ship">Ship Interior</option>
            <option value="habitat">Habitat</option>
            <option value="void">Void Space</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label for="climate">Climate</label>
          <input type="text" id="climate" name="climate" placeholder="e.g., Arid, Tropical, Frozen, Volcanic">
        </div>
        <div class="form-group">
          <label for="atmosphere">Atmosphere</label>
          <input type="text" id="atmosphere" name="atmosphere" placeholder="e.g., Breathable, Toxic, None, Thin">
        </div>
        <div class="form-group">
          <label for="gravity">Gravity</label>
          <input type="text" id="gravity" name="gravity" placeholder="e.g., Low (0.3g), Normal (1g), High (2.5g)">
        </div>
        <div class="form-group">
          <label for="resources">Resources (comma-separated)</label>
          <input type="text" id="resources" name="resources" placeholder="e.g., Water, Minerals, Fuel, Exotic Matter">
        </div>
      `;
      break;

    case 'object':
      fieldsHTML += `
        <div class="form-group">
          <label for="objectType">Object Type *</label>
          <select id="objectType" name="objectType">
            <option value="">Select Object Type</option>
            <option value="furniture">Furniture</option>
            <option value="decoration">Decoration</option>
            <option value="tool">Tool</option>
            <option value="machine">Machine</option>
            <option value="weapon">Weapon</option>
            <option value="container">Container</option>
            <option value="terminal">Terminal/Console</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="isInteractive" name="isInteractive">
            Is Interactive
          </label>
        </div>
        <div class="form-group" id="interactionTypeGroup" style="display: none;">
          <label for="interactionType">Interaction Type</label>
          <input type="text" id="interactionType" name="interactionType" placeholder="e.g., Open, Use, Activate, Examine">
        </div>
      `;
      break;

    case 'weapon':
    case 'armor':
    case 'item':
    case 'consumable':
      fieldsHTML += `
        <div class="form-group">
          <label for="buffs">
            Buffs/Effects (JSON array)
            <a href="/help/asset-json-guide#buffs" target="_blank" class="help-link" title="View JSON format guide">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom;">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM8 7a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V8a1 1 0 0 0-1-1zm0-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
              </svg>
            </a>
          </label>
          <textarea id="buffs" name="buffs" rows="3" placeholder='[{"type": "health", "value": 10, "duration": 60}]'></textarea>
          <small>Special effects this item provides when used/equipped</small>
        </div>
      `;
      break;

    case 'character':
      fieldsHTML += `
        <div class="form-group">
          <label for="characterBuffs">
            Character Traits (JSON array)
            <a href="/help/asset-json-guide#buffs" target="_blank" class="help-link" title="View JSON format guide">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom;">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM8 7a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V8a1 1 0 0 0-1-1zm0-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
              </svg>
            </a>
          </label>
          <textarea id="characterBuffs" name="buffs" rows="3" placeholder='[{"type": "defense", "value": 5}]'></textarea>
          <small>Innate character abilities and traits</small>
        </div>
      `;
      break;

    case 'species':
      fieldsHTML += `
        <div class="form-group">
          <label for="speciesBuffs">
            Racial Traits (JSON array)
            <a href="/help/asset-json-guide#buffs" target="_blank" class="help-link" title="View JSON format guide">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: text-bottom;">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM8 7a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0V8a1 1 0 0 0-1-1zm0-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
              </svg>
            </a>
          </label>
          <textarea id="speciesBuffs" name="buffs" rows="3" placeholder='[{"type": "night_vision", "value": 1}, {"type": "radiation_resistance", "value": 50}]'></textarea>
          <small>Species-specific abilities and resistances</small>
        </div>
      `;
      break;

    case 'planet':
      fieldsHTML += `
        <div class="form-group">
          <label for="subType">Planet Type *</label>
          <select id="subType" name="subType" required>
            <option value="">Select Planet Type</option>
            <option value="terrestrial">🌍 Terrestrial</option>
            <option value="gas_giant">🪐 Gas Giant</option>
            <option value="ice_world">❄️ Ice World</option>
            <option value="volcanic">🌋 Volcanic</option>
            <option value="ocean_world">🌊 Ocean World</option>
            <option value="desert">🏜️ Desert</option>
            <option value="jungle">🌴 Jungle</option>
            <option value="barren">🌑 Barren</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="stat_temperature">Temperature (°C)</label>
            <input type="number" id="stat_temperature" name="stat_temperature" placeholder="e.g., 22, -120, 450">
          </div>
          <div class="form-group">
            <label for="stat_gravity">Gravity (g)</label>
            <input type="number" id="stat_gravity" name="stat_gravity" step="0.1" placeholder="e.g., 1.0, 0.38, 2.5">
          </div>
        </div>
        <div class="form-group">
          <label for="stat_atmosphere">Atmosphere</label>
          <input type="text" id="stat_atmosphere" name="stat_atmosphere" placeholder="e.g., Breathable, Toxic, Thin CO2, None">
        </div>
        <div class="form-group">
          <label for="stat_resources">Available Resources (number)</label>
          <input type="number" id="stat_resources" name="stat_resources" placeholder="e.g., 5, 10, 0">
          <small>Number of unique resource types available on this planet</small>
        </div>
        <div class="form-group">
          <label for="climate">Climate Description</label>
          <input type="text" id="climate" name="climate" placeholder="e.g., Arid, Tropical, Frozen, Volcanic">
        </div>
        <div class="form-group">
          <label for="zoneName">Zone Name (optional)</label>
          <input type="text" id="zoneName" name="zoneName" placeholder="e.g., alpha-centauri-b">
          <small>Zone identifier for planetary explorer integration</small>
        </div>
      `;
      break;

    case 'orbital':
      fieldsHTML += `
        <div class="form-group">
          <label for="subType">Orbital Type *</label>
          <select id="subType" name="subType" required>
            <option value="">Select Orbital Type</option>
            <option value="trading-station">🏪 Trading Station</option>
            <option value="military-station">⚔️ Military Station</option>
            <option value="research-station">🔬 Research Station</option>
            <option value="mining-station">⛏️ Mining Station</option>
            <option value="habitat-station">🏘️ Habitat Station</option>
            <option value="refueling-station">⛽ Refueling Station</option>
            <option value="shipyard">🏭 Shipyard</option>
            <option value="satellite">🛰️ Satellite</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="stat_capacity">Population Capacity</label>
            <input type="number" id="stat_capacity" name="stat_capacity" placeholder="e.g., 5000, 10000">
          </div>
          <div class="form-group">
            <label for="stat_dockingBays">Docking Bays</label>
            <input type="number" id="stat_dockingBays" name="stat_dockingBays" placeholder="e.g., 10, 25, 50">
          </div>
        </div>
        <div class="form-group">
          <label for="stat_defenseRating">Defense Rating</label>
          <input type="number" id="stat_defenseRating" name="stat_defenseRating" placeholder="e.g., 100, 500, 1000">
          <small>Military defense capability of the station</small>
        </div>
        <div class="form-group">
          <label for="planetId">Orbits Planet (ID)</label>
          <input type="text" id="planetId" name="planetId" placeholder="Planet asset ID (leave empty if not orbiting)">
          <small>Leave empty for now - will be linked to planets after creation</small>
        </div>
        <div class="form-group">
          <label for="zoneName">Zone Name (optional)</label>
          <input type="text" id="zoneName" name="zoneName" placeholder="e.g., trading-post-sigma">
          <small>Zone identifier for orbital explorer integration</small>
        </div>
      `;
      break;

    // ===== STORYLINE ASSET TYPES =====
    case 'storyline_arc':
      fieldsHTML += `
        <div class="form-group">
          <label for="arc_setting">Story Setting *</label>
          <textarea id="arc_setting" name="arc_setting" rows="2" required placeholder="e.g., Subsurface mining colony beneath a fractured moon"></textarea>
          <small>Physical setting where this storyline takes place</small>
        </div>
        <div class="form-group">
          <label for="arc_themes">Themes (comma-separated) *</label>
          <input type="text" id="arc_themes" name="arc_themes" required placeholder="e.g., Labor struggle, Survival, Buried secrets">
          <small>Key themes explored in this storyline arc</small>
        </div>
        <div class="form-group">
          <label for="arc_conflict">Core Conflict *</label>
          <textarea id="arc_conflict" name="arc_conflict" rows="2" required placeholder="Central conflict that drives the narrative"></textarea>
        </div>
        <div class="form-group">
          <label for="arc_visual_mood">Visual Mood</label>
          <textarea id="arc_visual_mood" name="arc_visual_mood" rows="2" placeholder="e.g., Industrial grime, flickering lights, claustrophobic tunnels"></textarea>
          <small>Atmospheric description for visual design</small>
        </div>
        <div class="form-group">
          <label for="arc_quest_hooks">Quest Hooks (one per line)</label>
          <textarea id="arc_quest_hooks" name="arc_quest_hooks" rows="4" placeholder="Rescue trapped miners\nDecode tech from a buried vault\nSabotage a corrupt foreman"></textarea>
          <small>Potential quest starting points in this arc</small>
        </div>
        <div class="form-group">
          <label for="arc_linked_assets">Linked Universe Assets (comma-separated IDs)</label>
          <input type="text" id="arc_linked_assets" name="arc_linked_assets" placeholder="galaxy_id, planet_id, station_id">
          <small>Link this arc to existing galaxies, planets, or locations</small>
        </div>
      `;
      break;

    case 'storyline_npc':
      fieldsHTML += `
        <div class="form-group">
          <label for="npc_role">NPC Role *</label>
          <select id="npc_role" name="npc_role" required>
            <option value="">Select Role</option>
            <option value="protagonist">Protagonist</option>
            <option value="antagonist">Antagonist</option>
            <option value="companion">Companion</option>
            <option value="merchant">Merchant</option>
            <option value="quest_giver">Quest Giver</option>
            <option value="guide">Guide</option>
            <option value="catalyst">Catalyst</option>
            <option value="background">Background Character</option>
          </select>
        </div>
        <div class="form-group">
          <label for="npc_arc_id">Parent Storyline Arc</label>
          <input type="text" id="npc_arc_id" name="npc_arc_id" placeholder="Arc asset ID (leave empty for standalone NPC)">
          <small>Link this NPC to a specific storyline arc</small>
        </div>
        <div class="form-group">
          <label for="npc_traits">Character Traits (comma-separated) *</label>
          <input type="text" id="npc_traits" name="npc_traits" required placeholder="e.g., Stoic, Haunted, Resilient">
        </div>
        <div class="form-group">
          <label for="npc_dialogue_style">Dialogue Style *</label>
          <input type="text" id="npc_dialogue_style" name="npc_dialogue_style" required placeholder="e.g., Sparse, reflective">
          <small>How this character speaks</small>
        </div>
        <div class="form-group">
          <label for="npc_locations">Locations (comma-separated IDs)</label>
          <input type="text" id="npc_locations" name="npc_locations" placeholder="planet_id, station_id">
          <small>Where this NPC can be found</small>
        </div>
        <div class="form-group">
          <label for="npc_signature_items">Signature Items</label>
          <input type="text" id="npc_signature_items" name="npc_signature_items" placeholder="e.g., Dice, Old revolver, Badge">
          <small>Iconic items associated with this character</small>
        </div>
      `;
      break;

    case 'storyline_quest':
      fieldsHTML += `
        <div class="form-group">
          <label for="quest_arc_id">Parent Storyline Arc</label>
          <input type="text" id="quest_arc_id" name="quest_arc_id" placeholder="Arc asset ID">
          <small>Link this quest to a specific storyline arc</small>
        </div>
        <div class="form-group">
          <label for="quest_type">Quest Type *</label>
          <select id="quest_type" name="quest_type" required>
            <option value="">Select Type</option>
            <option value="main">Main Story Quest</option>
            <option value="side">Side Quest</option>
            <option value="radiant">Radiant/Repeatable</option>
            <option value="faction">Faction Quest</option>
            <option value="exploration">Exploration</option>
            <option value="combat">Combat Mission</option>
            <option value="delivery">Delivery/Transport</option>
            <option value="investigation">Investigation</option>
          </select>
        </div>
        <div class="form-group">
          <label for="quest_trigger_condition">Trigger Condition</label>
          <textarea id="quest_trigger_condition" name="quest_trigger_condition" rows="2" placeholder="e.g., Red alert initiated by AI glitch"></textarea>
          <small>What must happen for this quest to become available</small>
        </div>
        <div class="form-group">
          <label for="quest_objectives">Quest Objectives (one per line) *</label>
          <textarea id="quest_objectives" name="quest_objectives" rows="4" required placeholder="Reach the helm console\nInvestigate the anomaly\nReturn to base"></textarea>
        </div>
        <div class="form-group">
          <label for="quest_rewards">Rewards (comma-separated)</label>
          <input type="text" id="quest_rewards" name="quest_rewards" placeholder="e.g., 500 credits, Laser Rifle, Story progression">
        </div>
        <div class="form-group">
          <label for="quest_prerequisites">Prerequisite Quests (comma-separated IDs)</label>
          <input type="text" id="quest_prerequisites" name="quest_prerequisites" placeholder="quest_id_1, quest_id_2">
          <small>Quests that must be completed first</small>
        </div>
      `;
      break;

    case 'storyline_location':
      fieldsHTML += `
        <div class="form-group">
          <label for="location_arc_id">Parent Storyline Arc</label>
          <input type="text" id="location_arc_id" name="location_arc_id" placeholder="Arc asset ID">
        </div>
        <div class="form-group">
          <label for="location_mood_tags">Mood Tags (comma-separated) *</label>
          <input type="text" id="location_mood_tags" name="location_mood_tags" required placeholder="e.g., cold, dim, claustrophobic">
        </div>
        <div class="form-group">
          <label for="location_interactive_elements">Interactive Elements (comma-separated)</label>
          <input type="text" id="location_interactive_elements" name="location_interactive_elements" placeholder="e.g., bunk, AI terminal, control panel">
          <small>Objects players can interact with in this location</small>
        </div>
        <div class="form-group">
          <label for="location_linked_asset">Linked Universe Asset ID</label>
          <input type="text" id="location_linked_asset" name="location_linked_asset" placeholder="planet_id or station_id">
          <small>Map this story location to a real planet/station in the universe</small>
        </div>
        <div class="form-group">
          <label for="location_zone_name">Zone Identifier</label>
          <input type="text" id="location_zone_name" name="location_zone_name" placeholder="e.g., crew-quarters-ls01">
          <small>Unique zone ID for planetary explorer integration</small>
        </div>
      `;
      break;

    case 'storyline_script':
      fieldsHTML += `
        <div class="form-group">
          <label for="script_arc_id">Parent Storyline Arc *</label>
          <input type="text" id="script_arc_id" name="script_arc_id" required placeholder="Arc asset ID">
        </div>
        <div class="form-group">
          <label for="script_scene_title">Scene Title *</label>
          <input type="text" id="script_scene_title" name="script_scene_title" required placeholder="e.g., Craps Before the Void">
        </div>
        <div class="form-group">
          <label for="script_location_id">Location *</label>
          <input type="text" id="script_location_id" name="script_location_id" required placeholder="INT. STARSHIP REC ROOM – NIGHT">
          <small>Can be a story location ID or scene description</small>
        </div>
        <div class="form-group">
          <label for="script_scene_description">Scene Description *</label>
          <textarea id="script_scene_description" name="script_scene_description" rows="3" required placeholder="Dimly lit corner booth near a flickering gravity panel..."></textarea>
        </div>
        <div class="form-group">
          <label for="script_dialogue">Dialogue Script *</label>
          <textarea id="script_dialogue" name="script_dialogue" rows="10" required placeholder="JOHN: You roll a seven, you win. Snake eyes? You're toast.\nFAITHBENDER: So... this is a game of fate-time?"></textarea>
          <small>Full dialogue script with character names</small>
        </div>
        <div class="form-group">
          <label for="script_actions">Stage Directions/Actions (one per line)</label>
          <textarea id="script_actions" name="script_actions" rows="4" placeholder="John rolls a hard eight\nFaithbender stares at the dice like they're sacred\nGravity panel flickers"></textarea>
        </div>
        <div class="form-group">
          <label for="script_cinematic_trigger">Cinematic Trigger Condition</label>
          <input type="text" id="script_cinematic_trigger" name="script_cinematic_trigger" placeholder="e.g., Player approaches Void's Edge">
          <small>When should this script/cutscene play?</small>
        </div>
      `;
      break;
  }

  fieldsHTML += '</div>';
  container.innerHTML = fieldsHTML;

  // Add event listeners for conditional fields
  setupConditionalFields(assetType);

  // Show/hide terrain mapper for explorable zones
  const terrainMapperSection = document.getElementById('terrainMapperSection');
  if (terrainMapperSection) {
    if (assetType === 'planet' || assetType === 'orbital' || assetType === 'environment') {
      terrainMapperSection.style.display = 'block';
      initTerrainMapper();
    } else {
      terrainMapperSection.style.display = 'none';
    }
  }
}

/**
 * Setup conditional field visibility
 */
function setupConditionalFields(assetType) {
  if (assetType === 'object') {
    const isInteractive = document.getElementById('isInteractive');
    const interactionTypeGroup = document.getElementById('interactionTypeGroup');

    if (isInteractive && interactionTypeGroup) {
      isInteractive.addEventListener('change', (e) => {
        interactionTypeGroup.style.display = e.target.checked ? 'block' : 'none';
      });
    }
  }
}

/**
 * Collect stats from form
 */
function collectStats() {
  const stats = {};

  // Collect all stat fields
  const statFields = [
    'damage', 'defense', 'accuracy', 'critChance',
    'health', 'energy', 'speed', 'weight',
    'value', 'durability', 'range', 'fireRate',
    'capacity', 'level', 'dockingBays', 'defenseRating',
    'temperature', 'resources'
  ];

  statFields.forEach(field => {
    const value = document.getElementById(`stat_${field}`)?.value;
    if (value && value !== '' && value !== '0') {
      stats[field] = parseFloat(value);
    }
  });

  // Collect string stat fields (for planets/orbitals)
  const stringStatFields = ['gravity', 'atmosphere'];
  stringStatFields.forEach(field => {
    const value = document.getElementById(`stat_${field}`)?.value;
    if (value && value !== '') {
      stats[field] = value.trim();
    }
  });

  return stats;
}

/**
 * Collect effects from form
 */
function collectEffects() {
  const effectsText = document.getElementById('effects').value;
  if (!effectsText.trim()) return [];

  return effectsText.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/**
 * Save as draft
 */
async function saveDraft() {
  try {
    const formData = await buildFormData('draft');
    const method = currentAssetId ? 'PUT' : 'POST';
    const url = currentAssetId ? `/api/v1/assets/${currentAssetId}` : '/api/v1/assets';

    const response = await fetch(url, {
      method: method,
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Asset saved as draft!', 'success');
      currentAssetId = data.asset._id;
      loadAssets();
    } else {
      showAlert(data.error || 'Failed to save asset', 'error');
    }
  } catch (error) {
    console.error('Error saving draft:', error);
    showAlert('An error occurred while saving', 'error');
  }
}

/**
 * Submit for approval
 */
async function submitForApproval() {
  try {
    // First save as draft if not already saved
    if (!currentAssetId) {
      await saveDraft();
      // Wait a moment for the save to complete
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Then submit
    const response = await fetch(`/api/v1/assets/${currentAssetId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Asset submitted for approval!', 'success');
      loadAssets();
      resetForm();
    } else {
      showAlert(data.error || 'Failed to submit asset', 'error');
    }
  } catch (error) {
    console.error('Error submitting asset:', error);
    showAlert('An error occurred while submitting', 'error');
  }
}

/**
 * Build FormData object from form
 */
async function buildFormData(status) {
  const formData = new FormData();

  // Basic fields
  formData.append('title', document.getElementById('title').value);
  formData.append('description', document.getElementById('description').value);
  formData.append('assetType', document.getElementById('assetType').value);
  formData.append('rarity', document.getElementById('rarity').value);
  formData.append('status', status);

  // Tags
  const tagsValue = document.getElementById('tags').value;
  if (tagsValue) {
    const tags = tagsValue.split(',').map(t => t.trim()).filter(t => t);
    formData.append('tags', JSON.stringify(tags));
  }

  // Lore fields
  formData.append('lore', document.getElementById('lore').value);
  formData.append('backstory', document.getElementById('backstory').value);
  formData.append('flavor', document.getElementById('flavor').value);

  // Stats
  const stats = collectStats();
  formData.append('stats', JSON.stringify(stats));

  // Effects
  const effects = collectEffects();
  formData.append('effects', JSON.stringify(effects));

  // Stackable
  formData.append('stackable', document.getElementById('stackable').value);
  formData.append('maxStack', document.getElementById('maxStack').value);

  // Type-specific fields
  const assetType = document.getElementById('assetType').value;
  const typeSpecificData = getTypeSpecificData(assetType);
  for (const [key, value] of Object.entries(typeSpecificData)) {
    if (value !== null && value !== undefined) {
      if (typeof value === 'object') {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, value);
      }
    }
  }

  // Hierarchy data
  const hierarchyParent = document.getElementById('hierarchyParent').value;
  const hierarchyParentType = document.getElementById('hierarchyParentType').value;
  const hierarchyDepth = document.getElementById('hierarchyDepth').value;

  if (hierarchyParent) {
    const hierarchyData = {
      parent: hierarchyParent,
      parentType: hierarchyParentType,
      depth: parseInt(hierarchyDepth) || 0
    };
    formData.append('hierarchy', JSON.stringify(hierarchyData));
  }

  // Coordinates (for spatial assets)
  const coordX = document.getElementById('coordX').value;
  const coordY = document.getElementById('coordY').value;
  const coordZ = document.getElementById('coordZ').value;

  if (coordX || coordY || coordZ) {
    const coordinates = {
      x: parseFloat(coordX) || 0,
      y: parseFloat(coordY) || 0,
      z: parseFloat(coordZ) || 0
    };
    formData.append('coordinates', JSON.stringify(coordinates));
  }

  // Map Level (controls which zoom level asset appears on)
  const mapLevel = document.getElementById('mapLevel').value;
  if (mapLevel) {
    formData.append('mapLevel', mapLevel);
  }

  // Pixel editor data
  const pixelData = pixelEditor.getData();
  formData.append('pixelData', JSON.stringify(pixelData));

  // Add pixel art from editor as blob if no file uploaded
  const pixelArtFile = document.getElementById('pixelArtFile').files[0];
  if (!pixelArtFile) {
    const pixelBlob = await pixelEditor.exportToBlob();
    formData.append('pixelArt', pixelBlob, 'pixel-art.png');
  } else {
    formData.append('pixelArt', pixelArtFile);
  }

  // File uploads
  const fullscreenFile = document.getElementById('fullscreenFile').files[0];
  if (fullscreenFile) {
    formData.append('fullscreen', fullscreenFile);
  }

  const indexCardFile = document.getElementById('indexCardFile').files[0];
  if (indexCardFile) {
    formData.append('indexCard', indexCardFile);
  }

  return formData;
}

/**
 * Get type-specific data based on asset type
 */
function getTypeSpecificData(assetType) {
  const data = {};

  switch(assetType) {
    case 'environment':
      const environmentType = document.getElementById('environmentType');
      const climate = document.getElementById('climate');
      const atmosphere = document.getElementById('atmosphere');
      const gravity = document.getElementById('gravity');
      const resources = document.getElementById('resources');

      if (environmentType) data.environmentType = environmentType.value;
      if (climate) data.climate = climate.value;
      if (atmosphere) data.atmosphere = atmosphere.value;
      if (gravity) data.gravity = gravity.value;
      if (resources && resources.value) {
        data.resources = resources.value.split(',').map(r => r.trim()).filter(r => r);
      }
      break;

    case 'object':
      const objectType = document.getElementById('objectType');
      const isInteractive = document.getElementById('isInteractive');
      const interactionType = document.getElementById('interactionType');

      if (objectType) data.objectType = objectType.value;
      if (isInteractive) data.isInteractive = isInteractive.checked;
      if (interactionType && isInteractive?.checked) data.interactionType = interactionType.value;
      break;

    case 'weapon':
    case 'armor':
    case 'item':
    case 'consumable':
      const buffs = document.getElementById('buffs');
      if (buffs && buffs.value) {
        try {
          data.buffs = JSON.parse(buffs.value);
        } catch(e) {
          console.error('Invalid buffs JSON:', e);
        }
      }
      break;

    case 'character':
      const charBuffs = document.getElementById('characterBuffs');
      if (charBuffs && charBuffs.value) {
        try {
          data.buffs = JSON.parse(charBuffs.value);
        } catch(e) {
          console.error('Invalid character buffs JSON:', e);
        }
      }
      break;

    case 'species':
      const speciesBuffs = document.getElementById('speciesBuffs');
      if (speciesBuffs && speciesBuffs.value) {
        try {
          data.buffs = JSON.parse(speciesBuffs.value);
        } catch(e) {
          console.error('Invalid species buffs JSON:', e);
        }
      }
      break;
  }

  return data;
}

/**
 * Load user's assets
 */
async function loadAssets() {
  try {
    const response = await fetch('/api/v1/assets');
    const data = await response.json();

    if (data.success) {
      displayAssets(data.assets);
    } else {
      showAlert('Failed to load assets', 'error');
    }
  } catch (error) {
    console.error('Error loading assets:', error);
    showAlert('An error occurred while loading assets', 'error');
  }
}

/**
 * Display assets in list
 */
function displayAssets(assets) {
  const assetList = document.getElementById('assetList');

  if (assets.length === 0) {
    assetList.innerHTML = '<p>No assets yet. Create your first one!</p>';
    return;
  }

  assetList.innerHTML = assets.map(asset => {
    const statsCount = Object.keys(asset.stats || {}).length;
    const effectsCount = (asset.effects || []).length;

    return `
    <div class="asset-card">
      <img src="${asset.images.indexCard || asset.images.fullscreen || '/images/placeholder.png'}"
           alt="${asset.title}"
           class="asset-card-image">
      <div class="asset-card-content">
        <h3 class="asset-card-title">${asset.title}</h3>
        <p class="asset-card-description">${asset.description || 'No description'}</p>
        <div class="asset-card-meta">
          <span class="asset-status ${asset.status}">${asset.status}</span>
          <span>${asset.assetType}</span>
        </div>
        ${asset.rarity ? `<div style="margin: 0.5rem 0;"><span class="badge rarity-${asset.rarity}">${asset.rarity}</span></div>` : ''}
        ${statsCount > 0 ? `<div style="font-size: 0.85rem; color: #666; margin: 0.5rem 0;">📊 ${statsCount} stats</div>` : ''}
        ${effectsCount > 0 ? `<div style="font-size: 0.85rem; color: #666; margin: 0.5rem 0;">✨ ${effectsCount} effects</div>` : ''}
        ${asset.adminNotes ? `
          <div class="alert alert-info" style="margin-bottom: 1rem; padding: 0.5rem; font-size: 0.875rem;">
            <strong>Admin Notes:</strong> ${asset.adminNotes}
          </div>
        ` : ''}
        <div class="asset-card-actions">
          ${asset.status === 'draft' || asset.status === 'rejected' ? `
            <button class="btn btn-secondary btn-sm" onclick="editAsset('${asset._id}')">Edit</button>
          ` : ''}
          ${asset.status === 'draft' ? `
            <button class="btn btn-success btn-sm" onclick="submitAsset('${asset._id}')">Submit</button>
          ` : ''}
          ${asset.status === 'approved' ? `
            <span class="vote-count">👍 ${asset.votes} votes</span>
          ` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteAsset('${asset._id}')">Delete</button>
        </div>
      </div>
    </div>
  `}).join('');
}

/**
 * Edit asset
 */
async function editAsset(assetId) {
  try {
    const response = await fetch(`/api/v1/assets/${assetId}`);
    const data = await response.json();

    if (data.success) {
      const asset = data.asset;
      currentAssetId = assetId;

      // Fill basic fields
      document.getElementById('title').value = asset.title;
      document.getElementById('description').value = asset.description || '';
      document.getElementById('assetType').value = asset.assetType;
      document.getElementById('rarity').value = asset.rarity || '';

      // Fill tags
      if (asset.tags && asset.tags.length > 0) {
        document.getElementById('tags').value = asset.tags.join(', ');
      }

      // Fill lore fields
      document.getElementById('lore').value = asset.lore || '';
      document.getElementById('backstory').value = asset.backstory || '';
      document.getElementById('flavor').value = asset.flavor || '';

      // Fill stats
      if (asset.stats) {
        Object.keys(asset.stats).forEach(key => {
          const field = document.getElementById(`stat_${key}`);
          if (field) {
            field.value = asset.stats[key];
          }
        });
      }

      // Fill effects
      if (asset.effects && asset.effects.length > 0) {
        document.getElementById('effects').value = asset.effects.join('\n');
      }

      // Fill stackable
      document.getElementById('stackable').value = asset.stackable ? 'true' : 'false';
      document.getElementById('maxStack').value = asset.maxStack || 1;

      // Load pixel data
      if (asset.pixelData) {
        pixelEditor.loadData(asset.pixelData);
      }

      // Scroll to form
      document.getElementById('assetForm').scrollIntoView({ behavior: 'smooth' });
      showAlert('Asset loaded for editing', 'info');
    }
  } catch (error) {
    console.error('Error loading asset:', error);
    showAlert('Failed to load asset', 'error');
  }
}

/**
 * Submit asset for approval
 */
async function submitAsset(assetId) {
  if (!confirm('Submit this asset for approval?')) return;

  try {
    const response = await fetch(`/api/v1/assets/${assetId}/submit`, {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Asset submitted for approval!', 'success');
      loadAssets();
    } else {
      showAlert(data.error || 'Failed to submit', 'error');
    }
  } catch (error) {
    console.error('Error submitting asset:', error);
    showAlert('An error occurred', 'error');
  }
}

/**
 * Delete asset
 */
async function deleteAsset(assetId) {
  if (!confirm('Are you sure you want to delete this asset? This cannot be undone.')) return;

  try {
    const response = await fetch(`/api/v1/assets/${assetId}`, {
      method: 'DELETE'
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Asset deleted', 'success');
      loadAssets();

      if (currentAssetId === assetId) {
        resetForm();
      }
    } else {
      showAlert(data.error || 'Failed to delete', 'error');
    }
  } catch (error) {
    console.error('Error deleting asset:', error);
    showAlert('An error occurred', 'error');
  }
}

/**
 * Reset form
 */
function resetForm() {
  if (!confirm('Clear all form data?')) return;

  document.getElementById('builderForm').reset();
  document.getElementById('pixelArtPreview').innerHTML = '';
  document.getElementById('fullscreenPreview').innerHTML = '';
  document.getElementById('indexCardPreview').innerHTML = '';
  pixelEditor.clear();
  currentAssetId = null;
  showAlert('Form reset', 'info');
}

// Terrain Mapper Variables
let terrainCanvas = null;
let terrainCtx = null;
let terrainMapSize = 64;
let terrainPixelSize = 8;
let currentTerrain = 'walkable';
let isDrawingTerrain = false;
let terrainGrid = [];

const terrainColors = {
  'walkable': '#10b981',
  'obstacle': '#6b7280',
  'water': '#3b82f6',
  'hazard': '#ef4444',
  'interactive': '#f59e0b',
  'spawn': '#8b5cf6'
};

/**
 * Initialize terrain mapper
 */
function initTerrainMapper() {
  terrainCanvas = document.getElementById('terrainCanvas');
  if (!terrainCanvas) return;

  terrainCtx = terrainCanvas.getContext('2d');

  // Initialize grid
  initTerrainGrid();

  // Set canvas size
  updateCanvasSize();

  // Setup event listeners
  setupTerrainMapperEvents();

  // Render initial state
  renderTerrainMap();
}

/**
 * Initialize terrain grid
 */
function initTerrainGrid() {
  terrainGrid = [];
  for (let y = 0; y < terrainMapSize; y++) {
    terrainGrid[y] = [];
    for (let x = 0; x < terrainMapSize; x++) {
      terrainGrid[y][x] = 'walkable'; // Default terrain
    }
  }
}

/**
 * Update canvas size based on map size
 */
function updateCanvasSize() {
  const containerWidth = document.getElementById('terrainMapperContainer').offsetWidth - 32;
  const maxSize = Math.min(containerWidth, 800);
  terrainPixelSize = Math.floor(maxSize / terrainMapSize);

  terrainCanvas.width = terrainMapSize * terrainPixelSize;
  terrainCanvas.height = terrainMapSize * terrainPixelSize;
}

/**
 * Setup terrain mapper event listeners
 */
function setupTerrainMapperEvents() {
  // Terrain type selection
  const terrainTypes = document.querySelectorAll('.terrain-type');
  terrainTypes.forEach(type => {
    type.addEventListener('click', () => {
      terrainTypes.forEach(t => {
        t.style.border = 'none';
        t.classList.remove('active');
      });
      type.style.border = '3px solid white';
      type.classList.add('active');
      currentTerrain = type.dataset.terrain;
    });
  });

  // Map size change
  const mapSizeSelect = document.getElementById('terrainMapSize');
  if (mapSizeSelect) {
    mapSizeSelect.addEventListener('change', (e) => {
      terrainMapSize = parseInt(e.target.value);
      initTerrainGrid();
      updateCanvasSize();
      renderTerrainMap();
    });
  }

  // Canvas drawing
  terrainCanvas.addEventListener('mousedown', (e) => {
    isDrawingTerrain = true;
    drawTerrain(e);
  });

  terrainCanvas.addEventListener('mousemove', (e) => {
    if (isDrawingTerrain) {
      drawTerrain(e);
    }
  });

  terrainCanvas.addEventListener('mouseup', () => {
    isDrawingTerrain = false;
  });

  terrainCanvas.addEventListener('mouseleave', () => {
    isDrawingTerrain = false;
  });

  // Touch events for mobile
  terrainCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDrawingTerrain = true;
    const touch = e.touches[0];
    const rect = terrainCanvas.getBoundingClientRect();
    const mouseEvent = {
      offsetX: touch.clientX - rect.left,
      offsetY: touch.clientY - rect.top
    };
    drawTerrain(mouseEvent);
  });

  terrainCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (isDrawingTerrain) {
      const touch = e.touches[0];
      const rect = terrainCanvas.getBoundingClientRect();
      const mouseEvent = {
        offsetX: touch.clientX - rect.left,
        offsetY: touch.clientY - rect.top
      };
      drawTerrain(mouseEvent);
    }
  });

  terrainCanvas.addEventListener('touchend', () => {
    isDrawingTerrain = false;
  });

  // Clear button
  const clearBtn = document.getElementById('clearTerrainBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Clear entire terrain map?')) {
        initTerrainGrid();
        renderTerrainMap();
      }
    });
  }

  // Export button
  const exportBtn = document.getElementById('exportTerrainBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportTerrainData();
    });
  }
}

/**
 * Draw terrain at cursor position
 */
function drawTerrain(e) {
  const rect = terrainCanvas.getBoundingClientRect();
  const x = Math.floor((e.offsetX || (e.clientX - rect.left)) / terrainPixelSize);
  const y = Math.floor((e.offsetY || (e.clientY - rect.top)) / terrainPixelSize);

  if (x >= 0 && x < terrainMapSize && y >= 0 && y < terrainMapSize) {
    terrainGrid[y][x] = currentTerrain;
    renderTerrainMap();
  }
}

/**
 * Render the terrain map
 */
function renderTerrainMap() {
  if (!terrainCtx) return;

  // Clear canvas
  terrainCtx.fillStyle = '#1a1a1a';
  terrainCtx.fillRect(0, 0, terrainCanvas.width, terrainCanvas.height);

  // Draw terrain grid
  for (let y = 0; y < terrainMapSize; y++) {
    for (let x = 0; x < terrainMapSize; x++) {
      const terrain = terrainGrid[y][x];
      terrainCtx.fillStyle = terrainColors[terrain] || '#10b981';
      terrainCtx.fillRect(
        x * terrainPixelSize,
        y * terrainPixelSize,
        terrainPixelSize,
        terrainPixelSize
      );
    }
  }

  // Draw grid lines
  terrainCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  terrainCtx.lineWidth = 1;
  for (let i = 0; i <= terrainMapSize; i++) {
    terrainCtx.beginPath();
    terrainCtx.moveTo(i * terrainPixelSize, 0);
    terrainCtx.lineTo(i * terrainPixelSize, terrainCanvas.height);
    terrainCtx.stroke();

    terrainCtx.beginPath();
    terrainCtx.moveTo(0, i * terrainPixelSize);
    terrainCtx.lineTo(terrainCanvas.width, i * terrainPixelSize);
    terrainCtx.stroke();
  }
}

/**
 * Export terrain data
 */
function exportTerrainData() {
  const terrainData = {
    size: terrainMapSize,
    grid: terrainGrid,
    metadata: {
      created: new Date().toISOString(),
      terrainTypes: Object.keys(terrainColors)
    }
  };

  // Store in hidden field
  document.getElementById('terrainData').value = JSON.stringify(terrainData);

  // Show preview
  const previewDiv = document.getElementById('terrainPreview');
  const displayPre = document.getElementById('terrainDataDisplay');

  previewDiv.style.display = 'block';
  displayPre.textContent = JSON.stringify(terrainData, null, 2);

  showAlert('Terrain data exported successfully! It will be saved with your asset.', 'success');
}

/**
 * Enhanced Hierarchy System - Dynamic parent selection based on asset type
 */
function setupEnhancedHierarchy() {
  const assetTypeSelect = document.getElementById('assetType');
  const parentAssetSelect = document.getElementById('parentAsset');
  const parentAssetLabel = document.getElementById('parentAssetLabel');
  const parentAssetHint = document.getElementById('parentAssetHint');
  const parentAssetHelp = document.getElementById('parentAssetHelp');
  const hierarchyBreadcrumb = document.getElementById('hierarchyBreadcrumb');
  const breadcrumbPath = document.getElementById('breadcrumbPath');
  const buildInteriorGroup = document.getElementById('buildInteriorGroup');
  const coordinatesRow = document.getElementById('coordinatesRow');

  if (!assetTypeSelect || !parentAssetSelect) return;

  // Define parent-child relationships
  const hierarchyMap = {
    'galaxy': { parentTypes: ['anomaly', 'anomoly'], label: 'Parent Anomaly', hint: '(optional - galaxies can be standalone)' },
    'star': { parentTypes: ['galaxy'], label: 'Parent Galaxy', hint: '(required for star systems)', required: true },
    'planet': { parentTypes: ['star'], label: 'Parent Star System', hint: '(required for planets)', required: true },
    'orbital': { parentTypes: ['star', 'planet'], label: 'Parent Location', hint: '(star system or planet)', required: true },
    'environment': { parentTypes: ['planet', 'orbital', 'star'], label: 'Parent Location', hint: '(planet, station, or star system)' },
    'zone': { parentTypes: ['planet', 'orbital', 'environment'], label: 'Parent Location', hint: '(for interior zones)' }
  };

  // Assets that can have interiors built
  const buildableInteriors = ['planet', 'orbital', 'environment', 'zone'];

  // Handle asset type change - update parent options
  assetTypeSelect.addEventListener('change', async (e) => {
    const assetType = e.target.value;
    console.log(`[Hierarchy] Asset type changed to: ${assetType}`);

    const hierarchyConfig = hierarchyMap[assetType];
    console.log(`[Hierarchy] Hierarchy config:`, hierarchyConfig);

    // Reset parent dropdown
    parentAssetSelect.innerHTML = '<option value="">None (Standalone Asset)</option>';
    parentAssetSelect.disabled = true;
    hierarchyBreadcrumb.style.display = 'none';
    coordinatesRow.style.display = 'none';
    document.getElementById('mapLevelRow').style.display = 'none';

    // Show/hide Build Interior button
    if (buildableInteriors.includes(assetType)) {
      buildInteriorGroup.style.display = 'block';
    } else {
      buildInteriorGroup.style.display = 'none';
    }

    if (!hierarchyConfig) {
      parentAssetHelp.textContent = 'This asset type does not require a parent in the hierarchy';
      return;
    }

    // Update label and hint
    parentAssetLabel.textContent = hierarchyConfig.label;
    parentAssetHint.textContent = hierarchyConfig.hint;
    parentAssetHelp.textContent = `Select a ${hierarchyConfig.parentTypes.join(' or ')} to link this asset to`;

    // Fetch available parents
    try {
      parentAssetSelect.innerHTML = '<option value="">Loading...</option>';

      const parentTypes = hierarchyConfig.parentTypes;
      const parents = [];

      console.log(`[Hierarchy] Fetching parent types for ${assetType}:`, parentTypes);

      // Fetch assets of each parent type
      for (const parentType of parentTypes) {
        console.log(`[Hierarchy] Fetching ${parentType} assets...`);
        const response = await fetch(`/api/v1/assets?assetType=${parentType}&limit=1000`, {
          credentials: 'same-origin'
        });
        const data = await response.json();

        console.log(`[Hierarchy] Response for ${parentType}:`, data);

        if (data.success && data.assets) {
          console.log(`[Hierarchy] Found ${data.assets.length} ${parentType} assets`);
          parents.push(...data.assets.map(asset => ({ ...asset, type: parentType })));
        } else if (data.error) {
          console.error(`[Hierarchy] Error fetching ${parentType}:`, data.error);
        }
      }

      console.log(`[Hierarchy] Total parents found:`, parents.length, parents);

      // Populate dropdown
      parentAssetSelect.innerHTML = hierarchyConfig.required
        ? '<option value="">-- Select Required Parent --</option>'
        : '<option value="">None (Standalone Asset)</option>';

      if (parents.length > 0) {
        // Group by type if multiple parent types
        if (parentTypes.length > 1) {
          parentTypes.forEach(type => {
            const typeParents = parents.filter(p => p.type === type);
            if (typeParents.length > 0) {
              const optgroup = document.createElement('optgroup');
              optgroup.label = `${type.charAt(0).toUpperCase() + type.slice(1)}s`;

              typeParents.forEach(parent => {
                const option = document.createElement('option');
                option.value = parent._id;
                option.textContent = parent.title || parent.name;
                option.dataset.parentType = type;
                optgroup.appendChild(option);
              });

              parentAssetSelect.appendChild(optgroup);
            }
          });
        } else {
          // Single type - no grouping
          parents.forEach(parent => {
            const option = document.createElement('option');
            option.value = parent._id;
            option.textContent = parent.title || parent.name;
            option.dataset.parentType = parent.type;
            parentAssetSelect.appendChild(option);
          });
        }

        parentAssetSelect.disabled = false;

        // Show coordinates for spatial assets
        if (['galaxy', 'star', 'planet', 'orbital', 'anomaly', 'anomoly', 'station', 'starship', 'zone'].includes(assetType)) {
          coordinatesRow.style.display = 'flex';
          // Also show mapLevel for assets that appear on 3D maps
          document.getElementById('mapLevelRow').style.display = 'block';
        }
      } else {
        parentAssetSelect.innerHTML = `<option value="">No ${parentTypes.join('/')} assets found</option>`;
        showAlert(`Please create a ${parentTypes[0]} asset first`, 'info');
      }
    } catch (error) {
      console.error('Error fetching parent assets:', error);
      parentAssetSelect.innerHTML = '<option value="">Error loading parents</option>';
      showAlert('Failed to load parent assets', 'error');
    }
  });

  // Handle parent selection - show hierarchy path
  parentAssetSelect.addEventListener('change', async (e) => {
    const parentId = e.target.value;

    if (!parentId) {
      hierarchyBreadcrumb.style.display = 'none';
      document.getElementById('hierarchyParent').value = '';
      document.getElementById('hierarchyParentType').value = '';
      document.getElementById('hierarchyDepth').value = '0';
      return;
    }

    const selectedOption = e.target.options[e.target.selectedIndex];
    const parentType = selectedOption.dataset.parentType;

    // Set hidden fields
    document.getElementById('hierarchyParent').value = parentId;
    document.getElementById('hierarchyParentType').value = parentType;

    // Fetch hierarchy tree to show breadcrumb
    try {
      const response = await fetch(`/api/v1/hierarchy/ancestors/${parentId}`, {
        credentials: 'same-origin'
      });
      const data = await response.json();

      if (data.success && data.ancestors) {
        const ancestors = data.ancestors.reverse(); // Root to parent order
        const currentParent = { _id: parentId, title: selectedOption.textContent, assetType: parentType };
        const fullPath = [...ancestors, currentParent];

        // Set depth (parent depth + 1)
        document.getElementById('hierarchyDepth').value = fullPath.length;

        // Build breadcrumb
        breadcrumbPath.innerHTML = fullPath.map((asset, index) => {
          const icon = getAssetIcon(asset.assetType);
          const isLast = index === fullPath.length - 1;
          return `
            <span style="display: flex; align-items: center; gap: 0.25rem;">
              <span>${icon} ${asset.title || asset.name}</span>
              ${!isLast ? '<span style="color: #888;">→</span>' : ''}
            </span>
          `;
        }).join('');

        hierarchyBreadcrumb.style.display = 'block';
      }
    } catch (error) {
      console.error('Error fetching hierarchy:', error);
    }
  });
}

/**
 * Get icon for asset type
 */
function getAssetIcon(assetType) {
  const icons = {
    'anomaly': '🌀',
    'galaxy': '🌌',
    'star': '⭐',
    'planet': '🌍',
    'orbital': '🛰️',
    'environment': '🗺️',
    'zone': '🏛️'
  };
  return icons[assetType] || '📦';
}

/**
 * Setup Build Interior button handler
 */
function setupBuildInteriorButton() {
  const buildInteriorBtn = document.getElementById('buildInteriorBtn');

  if (buildInteriorBtn) {
    buildInteriorBtn.addEventListener('click', async () => {
      const assetType = document.getElementById('assetType').value;
      const title = document.getElementById('title').value;

      if (!title) {
        showAlert('Please enter an asset title first', 'warning');
        return;
      }

      // If asset exists (editing), use existing ID
      if (currentAssetId) {
        window.location.href = `/universe/interior-map-builder?parentAssetId=${currentAssetId}&parentAssetType=${assetType}`;
        return;
      }

      // Otherwise, save as draft first
      showAlert('Saving asset draft...', 'info');

      try {
        await saveDraft();

        // Wait for asset to be created
        setTimeout(() => {
          if (currentAssetId) {
            window.location.href = `/universe/interior-map-builder?parentAssetId=${currentAssetId}&parentAssetType=${assetType}`;
          } else {
            showAlert('Please save the asset first, then use Build Interior', 'warning');
          }
        }, 1000);
      } catch (error) {
        showAlert('Please save the asset as a draft first', 'warning');
      }
    });
  }
}

/**
 * Setup 3D model and texture file upload handlers
 */
function setup3DFileHandlers() {
  // GLTF Model Upload
  const gltfFile = document.getElementById('gltfFile');
  if (gltfFile) {
    gltfFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Show preview container
      const preview = document.getElementById('gltfPreview');
      const infoDiv = document.getElementById('gltfInfo');
      preview.style.display = 'block';

      // Create blob URL
      const url = URL.createObjectURL(file);

      try {
        // Initialize viewer if needed
        const viewer = initGLTFViewer();

        // Load model
        infoDiv.innerHTML = '<p style="color: #8a4fff;">Loading model...</p>';
        await viewer.loadGLTF(url);

        // Show model info
        const info = viewer.getModelInfo();
        infoDiv.innerHTML = `
          <div style="background: rgba(138, 79, 255, 0.1); padding: 0.5rem; border-radius: 4px; margin-top: 0.5rem;">
            <p style="color: #8a4fff; font-weight: bold; margin: 0;">Model Info:</p>
            <p style="color: #aaa; margin: 0.25rem 0; font-size: 0.9rem;">
              Meshes: ${info.meshCount} | Vertices: ${info.vertices.toLocaleString()} | Triangles: ${info.triangles.toLocaleString()}
            </p>
            <p style="color: #00ff88; margin: 0.25rem 0; font-size: 0.85rem;">
              ✓ File: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          </div>
        `;
      } catch (error) {
        infoDiv.innerHTML = `<p style="color: #ff4f4f;">Error loading model: ${error.message}</p>`;
        console.error('GLTF load error:', error);
      }
    });
  }

  // Planet Texture Upload
  const planetTextureFile = document.getElementById('planetTextureFile');
  if (planetTextureFile) {
    planetTextureFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const preview = document.getElementById('planetTexturePreview');
      preview.style.display = 'block';

      const url = URL.createObjectURL(file);

      try {
        // Initialize planet viewer
        const viewer = initPlanetViewer();

        // Load planet texture
        await viewer.loadPlanet(url);

        console.log('Planet texture loaded:', file.name);
      } catch (error) {
        console.error('Planet texture load error:', error);
      }
    });
  }

  // Normal Map Preview (simple image preview)
  const normalMapFile = document.getElementById('normalMapFile');
  if (normalMapFile) {
    normalMapFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const preview = document.getElementById('normalMapPreview');
      const reader = new FileReader();

      reader.onload = (e) => {
        preview.innerHTML = `<img src="${e.target.result}" style="max-width: 200px; margin-top: 0.5rem; border-radius: 4px;">`;
      };

      reader.readAsDataURL(file);
    });
  }

  // Roughness Map Preview
  const roughnessMapFile = document.getElementById('roughnessMapFile');
  if (roughnessMapFile) {
    roughnessMapFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const preview = document.getElementById('roughnessMapPreview');
      const reader = new FileReader();

      reader.onload = (e) => {
        preview.innerHTML = `<img src="${e.target.result}" style="max-width: 200px; margin-top: 0.5rem; border-radius: 4px;">`;
      };

      reader.readAsDataURL(file);
    });
  }
}
