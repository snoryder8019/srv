/**
 * Character Detail Page - Talent Tree and Equipment Management
 */

const characterData = window.CHARACTER_DATA || {};
const characterId = window.CHARACTER_ID;

// Talent definitions
const TALENT_DEFINITIONS = {
  // Tier 1
  strength_boost_1: {
    name: "Strength I",
    maxRank: 5,
    tier: 1,
    effect: { stat: 'strength', value: 2 }
  },
  intelligence_boost_1: {
    name: "Intelligence I",
    maxRank: 5,
    tier: 1,
    effect: { stat: 'intelligence', value: 2 }
  },
  agility_boost_1: {
    name: "Agility I",
    maxRank: 5,
    tier: 1,
    effect: { stat: 'agility', value: 2 }
  },
  // Tier 2
  combat_mastery: {
    name: "Combat Mastery",
    maxRank: 3,
    tier: 2,
    requires: 5,
    effect: { type: 'damage_percent', value: 5 }
  },
  tech_affinity: {
    name: "Tech Affinity",
    maxRank: 3,
    tier: 2,
    requires: 5,
    effect: { stat: 'tech', value: 3 }
  },
  faith_power: {
    name: "Faith Power",
    maxRank: 3,
    tier: 2,
    requires: 5,
    effect: { stat: 'faith', value: 3 }
  },
  // Tier 3
  berserker_rage: {
    name: "Berserker Rage",
    maxRank: 1,
    tier: 3,
    requires: 10,
    effect: { type: 'ability', name: 'Berserker Rage' }
  },
  tactical_mind: {
    name: "Tactical Mind",
    maxRank: 1,
    tier: 3,
    requires: 10,
    effect: { type: 'ability', name: 'Tactical Mind' }
  }
};

// Current talent state
let talentState = {
  availablePoints: characterData.talents?.availablePoints || 0,
  spent: characterData.talents?.spent || {},
  unlocked: characterData.talents?.unlocked || []
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeTalentTree();
  initializeEquipment();

  // Set up event listeners
  document.getElementById('resetTalents')?.addEventListener('click', resetTalents);
});

/**
 * Initialize talent tree
 */
function initializeTalentTree() {
  const talentNodes = document.querySelectorAll('.talent-node');

  talentNodes.forEach(node => {
    const talentId = node.dataset.talent;
    const currentRank = talentState.spent[talentId] || 0;

    // Update UI with current rank
    const rankSpan = node.querySelector('.current-rank');
    if (rankSpan) {
      rankSpan.textContent = currentRank;
    }

    // Mark as active if has ranks
    if (currentRank > 0) {
      node.classList.add('active');
    }

    // Add click handler
    node.addEventListener('click', () => handleTalentClick(talentId, node));
  });

  // Update talent point display
  updateTalentPoints();

  // Check and update locked states
  updateTalentLocks();
}

/**
 * Handle talent node click
 */
function handleTalentClick(talentId, node) {
  // Don't allow if locked
  if (node.classList.contains('locked')) {
    showAlert('This talent is locked. Meet the requirements first.', 'warning');
    return;
  }

  // Don't allow if no points available
  if (talentState.availablePoints <= 0) {
    showAlert('No talent points available!', 'warning');
    return;
  }

  const talent = TALENT_DEFINITIONS[talentId];
  const currentRank = talentState.spent[talentId] || 0;

  // Don't allow if maxed
  if (currentRank >= talent.maxRank) {
    showAlert('Talent already at maximum rank!', 'warning');
    return;
  }

  // Increase rank
  talentState.spent[talentId] = currentRank + 1;
  talentState.availablePoints--;

  // Update UI
  const rankSpan = node.querySelector('.current-rank');
  rankSpan.textContent = talentState.spent[talentId];
  node.classList.add('active');

  updateTalentPoints();
  updateTalentLocks();

  // Save to server
  saveTalents();
}

/**
 * Update talent points display
 */
function updateTalentPoints() {
  const pointsEl = document.getElementById('talentPoints');
  if (pointsEl) {
    pointsEl.textContent = talentState.availablePoints;
  }
}

/**
 * Update talent locks based on requirements
 */
function updateTalentLocks() {
  const totalSpent = Object.values(talentState.spent).reduce((sum, val) => sum + val, 0);

  // Check each talent's requirements
  Object.keys(TALENT_DEFINITIONS).forEach(talentId => {
    const talent = TALENT_DEFINITIONS[talentId];
    const node = document.querySelector(`[data-talent="${talentId}"]`);

    if (!node) return;

    if (talent.requires) {
      if (totalSpent >= talent.requires) {
        node.classList.remove('locked');
      } else {
        node.classList.add('locked');
      }
    }
  });
}

/**
 * Reset talents
 */
async function resetTalents() {
  if (!confirm('Reset all talents? This will refund all spent talent points.')) {
    return;
  }

  try {
    const response = await fetch(`/api/v1/characters/${characterId}/talents/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Talents reset successfully!', 'success');

      // Reset local state
      const totalSpent = Object.values(talentState.spent).reduce((sum, val) => sum + val, 0);
      talentState.availablePoints += totalSpent;
      talentState.spent = {};

      // Update UI
      document.querySelectorAll('.talent-node').forEach(node => {
        const rankSpan = node.querySelector('.current-rank');
        if (rankSpan) rankSpan.textContent = '0';
        node.classList.remove('active');
      });

      updateTalentPoints();
      updateTalentLocks();
    } else {
      showAlert(data.error || 'Failed to reset talents', 'error');
    }
  } catch (error) {
    console.error('Error resetting talents:', error);
    showAlert('An error occurred', 'error');
  }
}

/**
 * Save talents to server
 */
async function saveTalents() {
  try {
    const response = await fetch(`/api/v1/characters/${characterId}/talents`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        talents: talentState
      })
    });

    const data = await response.json();

    if (!data.success) {
      showAlert(data.error || 'Failed to save talents', 'error');
    }
  } catch (error) {
    console.error('Error saving talents:', error);
    showAlert('An error occurred while saving', 'error');
  }
}

/**
 * Initialize equipment
 */
function initializeEquipment() {
  const equipmentSlots = document.querySelectorAll('.equipment-slot');

  equipmentSlots.forEach(slot => {
    slot.addEventListener('click', () => {
      const slotType = slot.dataset.slot;
      showEquipmentSelector(slotType);
    });
  });
}

/**
 * Show equipment selector modal
 */
function showEquipmentSelector(slotType) {
  // TODO: Implement equipment selector modal
  // This would show available items from inventory that can be equipped in this slot
  showAlert(`Equipment selector for ${slotType} slot (Coming soon!)`, 'info');
}

/**
 * Show alert message
 */
function showAlert(message, type = 'info') {
  // Create alert element
  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 9999;
    max-width: 400px;
    animation: slideIn 0.3s ease;
  `;

  if (type === 'success') {
    alert.style.background = '#d1fae5';
    alert.style.color = '#065f46';
    alert.style.border = '1px solid #10b981';
  } else if (type === 'error') {
    alert.style.background = '#fee2e2';
    alert.style.color = '#991b1b';
    alert.style.border = '1px solid #ef4444';
  } else if (type === 'warning') {
    alert.style.background = '#fef3c7';
    alert.style.color = '#92400e';
    alert.style.border = '1px solid #f59e0b';
  } else {
    alert.style.background = '#dbeafe';
    alert.style.color = '#1e40af';
    alert.style.border = '1px solid #3b82f6';
  }

  alert.textContent = message;
  document.body.appendChild(alert);

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);

  // Remove after 5 seconds
  setTimeout(() => {
    alert.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => alert.remove(), 300);
  }, 5000);
}
