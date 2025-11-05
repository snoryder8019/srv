/**
 * Universal Builder Hub - Client Script
 * Manages hierarchy tree view, quick actions, and builder navigation
 */

let currentView = 'tree';
let assetsData = window.assetsData || [];
let filteredAssets = [...assetsData];

// Asset type icons
const assetIcons = {
  'anomaly': '🌀',
  'galaxy': '🌌',
  'star': '⭐',
  'planet': '🌍',
  'orbital': '🛰️',
  'zone': '🏛️',
  'sprite': '🎨',
  'sprite_sheet': '🖼️',
  'environment': '🗺️',
  'item': '⚔️',
  'weapon': '🗡️',
  'armor': '🛡️',
  'ship': '🚀',
  'module': '🔧',
  'character': '👤',
  'npc': '🎭',
  'faction': '🏰',
  'other': '📦'
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  console.log('🏛️ Universal Builder Hub initializing...');
  console.log(`Loaded ${assetsData.length} assets`);

  setupViewToggle();
  setupSearch();
  buildHierarchyTree();

  console.log('✅ Universal Builder Hub ready!');
});

/**
 * Setup view toggle between tree and grid
 */
function setupViewToggle() {
  const toggleButtons = document.querySelectorAll('.view-toggle button');
  const treeView = document.getElementById('treeView');
  const gridView = document.getElementById('gridView');

  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;

      // Update active button
      toggleButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Toggle views
      if (view === 'tree') {
        treeView.classList.add('active');
        gridView.classList.remove('active');
        currentView = 'tree';
      } else {
        treeView.classList.remove('active');
        gridView.classList.add('active');
        currentView = 'grid';
      }
    });
  });
}

/**
 * Setup search functionality
 */
function setupSearch() {
  const searchInput = document.getElementById('hierarchySearch');

  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();

    if (!searchTerm) {
      filteredAssets = [...assetsData];
    } else {
      filteredAssets = assetsData.filter(asset => {
        const title = (asset.title || asset.name || '').toLowerCase();
        const type = (asset.assetType || '').toLowerCase();
        const description = (asset.description || '').toLowerCase();

        return title.includes(searchTerm) ||
               type.includes(searchTerm) ||
               description.includes(searchTerm);
      });
    }

    buildHierarchyTree();
    filterGridView(searchTerm);
  });
}

/**
 * Filter grid view based on search
 */
function filterGridView(searchTerm) {
  const gridCards = document.querySelectorAll('.grid-card');

  gridCards.forEach(card => {
    const assetId = card.dataset.assetId;
    const asset = assetsData.find(a => a._id === assetId);

    if (!asset) {
      card.style.display = 'none';
      return;
    }

    if (!searchTerm) {
      card.style.display = 'block';
      return;
    }

    const title = (asset.title || asset.name || '').toLowerCase();
    const type = (asset.assetType || '').toLowerCase();

    if (title.includes(searchTerm.toLowerCase()) || type.includes(searchTerm.toLowerCase())) {
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  });
}

/**
 * Build hierarchical tree structure
 */
function buildHierarchyTree() {
  const treeContainer = document.getElementById('hierarchyTreeContent');

  if (!treeContainer) return;

  // Build tree structure from flat array
  const tree = buildTreeStructure(filteredAssets);

  // Render tree
  treeContainer.innerHTML = renderTreeNodes(tree, 0);

  // Setup tree interactions
  setupTreeInteractions();
}

/**
 * Build tree structure from flat asset array
 */
function buildTreeStructure(assets) {
  // Create a map for quick lookup
  const assetMap = new Map();
  assets.forEach(asset => {
    assetMap.set(asset._id.toString(), { ...asset, children: [] });
  });

  // Build parent-child relationships
  const roots = [];

  assets.forEach(asset => {
    const node = assetMap.get(asset._id.toString());

    if (asset.hierarchy && asset.hierarchy.parent) {
      const parentId = asset.hierarchy.parent.toString();
      const parent = assetMap.get(parentId);

      if (parent) {
        parent.children.push(node);
      } else {
        // Parent not in filtered list, treat as root
        roots.push(node);
      }
    } else {
      // No parent, it's a root node
      roots.push(node);
    }
  });

  return roots;
}

/**
 * Render tree nodes recursively
 */
function renderTreeNodes(nodes, depth) {
  if (!nodes || nodes.length === 0) return '';

  return nodes.map(node => {
    const hasChildren = node.children && node.children.length > 0;
    const icon = assetIcons[node.assetType] || '📦';
    const childCount = hasChildren ? node.children.length : 0;

    return `
      <div class="tree-node" data-asset-id="${node._id}" data-depth="${depth}">
        <div class="tree-node-content ${hasChildren ? 'has-children' : ''}">
          ${hasChildren ? `
            <div class="tree-expand-btn" data-action="toggle">
              ▶
            </div>
          ` : '<div style="width: 24px;"></div>'}

          <div class="tree-node-icon">${icon}</div>

          <div class="tree-node-info">
            <div class="tree-node-title">${node.title || node.name}</div>
            <div class="tree-node-meta">
              ${node.assetType}${hasChildren ? ` • ${childCount} child${childCount > 1 ? 'ren' : ''}` : ''}
              ${node.hierarchy?.depth ? ` • Depth: ${node.hierarchy.depth}` : ''}
            </div>
          </div>

          <div class="tree-node-actions">
            ${getActionButtons(node)}
          </div>
        </div>

        ${hasChildren ? `
          <div class="tree-children">
            ${renderTreeNodes(node.children, depth + 1)}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Get action buttons based on asset type
 */
function getActionButtons(asset) {
  const buttons = [];

  // Edit button for all assets
  buttons.push(`
    <button class="tree-action-btn" data-action="edit" data-asset-id="${asset._id}" data-asset-type="${asset.assetType}">
      ✏️ Edit
    </button>
  `);

  // Build Interior button for spatial assets
  if (['planet', 'orbital', 'environment', 'zone', 'anomaly'].includes(asset.assetType)) {
    buttons.push(`
      <button class="tree-action-btn" data-action="interior" data-asset-id="${asset._id}" data-asset-type="${asset.assetType}">
        🗺️ Interior
      </button>
    `);
  }

  // Add Sprites button for zones
  if (asset.assetType === 'zone') {
    buttons.push(`
      <button class="tree-action-btn" data-action="sprites" data-asset-id="${asset._id}">
        🎨 Sprites
      </button>
    `);
  }

  // View Hierarchy button for assets with children
  if (asset.children && asset.children.length > 0) {
    buttons.push(`
      <button class="tree-action-btn" data-action="hierarchy" data-asset-id="${asset._id}">
        🌳 Expand
      </button>
    `);
  }

  // Delete button (with warning style)
  buttons.push(`
    <button class="tree-action-btn btn-delete" data-action="delete" data-asset-id="${asset._id}" data-asset-title="${(asset.title || asset.name || 'Untitled').replace(/"/g, '&quot;')}" style="background: rgba(255, 0, 0, 0.2); border-color: #ff3333; color: #ff3333;">
      🗑️ Delete
    </button>
  `);

  return buttons.join('');
}

/**
 * Setup tree interactions (expand/collapse, actions)
 */
function setupTreeInteractions() {
  // Expand/collapse tree nodes
  document.querySelectorAll('[data-action="toggle"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const treeNode = btn.closest('.tree-node');
      const children = treeNode.querySelector('.tree-children');
      const expandBtn = btn;

      if (children) {
        children.classList.toggle('expanded');
        expandBtn.classList.toggle('expanded');
      }
    });
  });

  // Edit action - smart routing based on asset type
  document.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const assetId = btn.dataset.assetId;
      const assetType = btn.dataset.assetType;

      let editorUrl;

      switch(assetType) {
        case 'zone':
          editorUrl = `/universe/interior-map-builder?zoneId=${assetId}`;
          break;

        case 'sprite':
        case 'sprite_sheet':
          editorUrl = `/assets/builder?assetId=${assetId}`;
          break;

        default:
          editorUrl = `/assets/builder-enhanced?id=${assetId}`;
          break;
      }

      console.log(`📝 Opening editor for ${assetType}: ${editorUrl}`);
      window.location.href = editorUrl;
    });
  });

  // Interior builder action
  document.querySelectorAll('[data-action="interior"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const assetId = btn.dataset.assetId;
      const assetType = btn.dataset.assetType;
      window.location.href = `/universe/interior-map-builder?parentAssetId=${assetId}&parentAssetType=${assetType}`;
    });
  });

  // Delete action
  document.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const assetId = btn.dataset.assetId;
      const assetTitle = btn.dataset.assetTitle;

      // Confirm deletion
      if (!confirm(`⚠️ Delete "${assetTitle}"?\n\nThis will permanently delete this asset and unlink it from any parent/children. This action cannot be undone.`)) {
        return;
      }

      try {
        const response = await fetch(`/api/v1/assets/${assetId}`, {
          method: 'DELETE',
          credentials: 'same-origin'
        });

        const result = await response.json();

        if (result.success) {
          console.log(`✅ Deleted asset: ${assetTitle}`);

          // Remove the node from the tree
          const treeNode = btn.closest('.tree-node');
          if (treeNode) {
            treeNode.style.transition = 'opacity 0.3s, transform 0.3s';
            treeNode.style.opacity = '0';
            treeNode.style.transform = 'translateX(-20px)';

            setTimeout(() => {
              treeNode.remove();

              // Check if tree is empty
              const treeContent = document.getElementById('hierarchyTreeContent');
              if (treeContent && treeContent.children.length === 0) {
                treeContent.innerHTML = `
                  <div class="empty-state">
                    <div class="empty-state-icon">📦</div>
                    <div class="empty-state-text">No assets remaining. Create your first asset!</div>
                    <a href="/assets/builder-enhanced" class="empty-state-cta">Create Asset</a>
                  </div>
                `;
              }
            }, 300);
          }

          // Show success message
          alert(`✅ Successfully deleted "${assetTitle}"`);
        } else {
          console.error('❌ Failed to delete asset:', result.error);
          alert(`Failed to delete asset: ${result.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('❌ Error deleting asset:', error);
        alert(`Error deleting asset: ${error.message}`);
      }
    });
  });

  // Sprites action
  document.querySelectorAll('[data-action="sprites"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const assetId = btn.dataset.assetId;
      window.location.href = `/assets/sprite-creator?zoneId=${assetId}`;
    });
  });

  // Hierarchy action (expand children)
  document.querySelectorAll('[data-action="hierarchy"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const treeNode = btn.closest('.tree-node');
      const children = treeNode.querySelector('.tree-children');
      const expandBtn = treeNode.querySelector('.tree-expand-btn');

      if (children) {
        children.classList.add('expanded');
        if (expandBtn) {
          expandBtn.classList.add('expanded');
        }
      }
    });
  });

  // Grid card clicks
  document.querySelectorAll('.grid-card').forEach(card => {
    card.addEventListener('click', () => {
      const assetId = card.dataset.assetId;
      window.location.href = `/assets/builder-enhanced?id=${assetId}`;
    });
  });
}

console.log('🏛️ Builder Hub script loaded');
