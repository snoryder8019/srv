/**
 * Space-Themed Canvas Talent Tree
 * Features:
 * - 4 talent trees with 5 talents each
 * - Fog of war on locked tiers
 * - Animated connection lines with energy pulses
 */

class TalentTreeCanvas {
  constructor(canvasId, characterData) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.characterData = characterData;

    // Canvas dimensions
    this.width = 0;
    this.height = 0;

    // Animation state
    this.animationFrame = 0;
    this.particles = [];
    this.stars = [];

    // Talent tree data structure
    this.trees = this.initializeTalentTrees();

    // Selected node
    this.hoveredNode = null;
    this.selectedNode = null;

    this.init();
  }

  init() {
    this.resizeCanvas();
    this.generateStarfield();
    this.setupEventListeners();
    this.animate();
  }

  resizeCanvas() {
    const container = this.canvas.parentElement;
    this.width = container.clientWidth;
    this.height = Math.max(container.clientHeight, 800);

    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  initializeTalentTrees() {
    const trees = [
      {
        name: 'Combat',
        color: '#ef4444',
        icon: '⚔️',
        x: 0.2,
        talents: [
          { tier: 1, name: 'Strength I', icon: '💪', desc: '+2 Strength', maxRank: 5, rank: 0 },
          { tier: 1, name: 'Weapon Mastery', icon: '🗡️', desc: '+5% Weapon Dmg', maxRank: 3, rank: 0 },
          { tier: 2, name: 'Critical Strike', icon: '💥', desc: '+10% Crit Chance', maxRank: 3, rank: 0 },
          { tier: 2, name: 'Armor Piercing', icon: '🎯', desc: 'Ignore 15% Armor', maxRank: 3, rank: 0 },
          { tier: 3, name: 'Berserker Rage', icon: '😡', desc: 'Ultimate: +50% Dmg', maxRank: 1, rank: 0, ultimate: true }
        ]
      },
      {
        name: 'Tech',
        color: '#3b82f6',
        icon: '⚙️',
        x: 0.4,
        talents: [
          { tier: 1, name: 'Tech I', icon: '🔧', desc: '+2 Tech', maxRank: 5, rank: 0 },
          { tier: 1, name: 'Energy Efficiency', icon: '⚡', desc: '-10% Energy Cost', maxRank: 3, rank: 0 },
          { tier: 2, name: 'Shield Boost', icon: '🛡️', desc: '+25% Shields', maxRank: 3, rank: 0 },
          { tier: 2, name: 'Overcharge', icon: '⚡', desc: '+15% Tech Power', maxRank: 3, rank: 0 },
          { tier: 3, name: 'Tactical Mind', icon: '🧠', desc: 'Ultimate: -25% Cooldowns', maxRank: 1, rank: 0, ultimate: true }
        ]
      },
      {
        name: 'Faith',
        color: '#a855f7',
        icon: '✨',
        x: 0.6,
        talents: [
          { tier: 1, name: 'Faith I', icon: '🙏', desc: '+2 Faith', maxRank: 5, rank: 0 },
          { tier: 1, name: 'Blessing', icon: '✨', desc: '+10% Healing', maxRank: 3, rank: 0 },
          { tier: 2, name: 'Divine Shield', icon: '🌟', desc: 'Absorb 20% Dmg', maxRank: 3, rank: 0 },
          { tier: 2, name: 'Righteousness', icon: '⚡', desc: '+15% Faith Power', maxRank: 3, rank: 0 },
          { tier: 3, name: 'Divine Intervention', icon: '👼', desc: 'Ultimate: Cheat Death', maxRank: 1, rank: 0, ultimate: true }
        ]
      },
      {
        name: 'Agility',
        color: '#10b981',
        icon: '🏃',
        x: 0.8,
        talents: [
          { tier: 1, name: 'Agility I', icon: '🦅', desc: '+2 Agility', maxRank: 5, rank: 0 },
          { tier: 1, name: 'Speed', icon: '💨', desc: '+10% Move Speed', maxRank: 3, rank: 0 },
          { tier: 2, name: 'Evasion', icon: '🌪️', desc: '+15% Dodge', maxRank: 3, rank: 0 },
          { tier: 2, name: 'Precision', icon: '🎯', desc: '+10% Accuracy', maxRank: 3, rank: 0 },
          { tier: 3, name: 'Shadow Step', icon: '👻', desc: 'Ultimate: Teleport', maxRank: 1, rank: 0, ultimate: true }
        ]
      }
    ];

    // Calculate positions for each talent
    trees.forEach(tree => {
      const treeX = this.width * tree.x;
      const tierSpacing = 180;
      const nodeSpacing = 100;

      tree.talents.forEach((talent, idx) => {
        const tiersInTree = tree.talents.filter(t => t.tier === talent.tier).length;
        const indexInTier = tree.talents.filter(t => t.tier === talent.tier).indexOf(talent);

        talent.x = treeX;
        talent.y = 100 + (talent.tier - 1) * tierSpacing + indexInTier * nodeSpacing;
        talent.radius = talent.ultimate ? 45 : 35;
        talent.tree = tree;
      });
    });

    return trees;
  }

  generateStarfield() {
    this.stars = [];
    for (let i = 0; i < 150; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        radius: Math.random() * 1.5,
        opacity: Math.random() * 0.8 + 0.2,
        twinkleSpeed: Math.random() * 0.02 + 0.01
      });
    }
  }

  setupEventListeners() {
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('click', (e) => this.handleClick(e));

    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.trees = this.initializeTalentTrees();
      this.generateStarfield();
    });
  }

  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    this.hoveredNode = null;

    this.trees.forEach(tree => {
      tree.talents.forEach(talent => {
        const distance = Math.sqrt(
          Math.pow(mouseX - talent.x, 2) + Math.pow(mouseY - talent.y, 2)
        );

        if (distance < talent.radius) {
          this.hoveredNode = talent;
          this.canvas.style.cursor = 'pointer';
        }
      });
    });

    if (!this.hoveredNode) {
      this.canvas.style.cursor = 'default';
    }
  }

  handleClick(e) {
    if (this.hoveredNode) {
      this.selectedNode = this.hoveredNode;
      console.log('Selected talent:', this.selectedNode.name);
      // TODO: Implement talent point spending
    }
  }

  animate() {
    this.animationFrame++;
    this.draw();
    requestAnimationFrame(() => this.animate());
  }

  draw() {
    // Clear canvas
    this.ctx.fillStyle = '#0a0e27';
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Draw space background
    this.drawNebula();
    this.drawStarfield();

    // Draw connections first (behind nodes)
    this.drawConnections();

    // Draw talent nodes
    this.drawTalentNodes();

    // Draw fog of war
    this.drawFogOfWar();

    // Draw tooltip if hovering
    if (this.hoveredNode) {
      this.drawTooltip(this.hoveredNode);
    }
  }

  drawNebula() {
    const gradient = this.ctx.createRadialGradient(
      this.width / 2, this.height / 3, 0,
      this.width / 2, this.height / 3, this.width / 2
    );
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.1)');
    gradient.addColorStop(0.5, 'rgba(59, 130, 246, 0.05)');
    gradient.addColorStop(1, 'rgba(10, 14, 39, 0)');

    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  drawStarfield() {
    this.stars.forEach(star => {
      const twinkle = Math.sin(this.animationFrame * star.twinkleSpeed);
      const opacity = star.opacity + twinkle * 0.3;

      this.ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, Math.min(1, opacity))})`;
      this.ctx.beginPath();
      this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }

  drawConnections() {
    this.trees.forEach(tree => {
      const talents = tree.talents;

      // Connect talents within the same tree
      for (let i = 0; i < talents.length - 1; i++) {
        const from = talents[i];
        const to = talents[i + 1];

        // Only draw connection if to next tier
        if (to.tier > from.tier) {
          this.drawAnimatedConnection(from, to, tree.color);
        }
      }
    });
  }

  drawAnimatedConnection(from, to, color) {
    const isLocked = to.rank === 0 && from.rank === 0;

    // Base line
    this.ctx.strokeStyle = isLocked ? 'rgba(100, 116, 139, 0.3)' : color;
    this.ctx.lineWidth = isLocked ? 2 : 3;
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y + from.radius);
    this.ctx.lineTo(to.x, to.y - to.radius);
    this.ctx.stroke();

    // Animated energy pulse on active connections
    if (!isLocked) {
      const pulsePosition = (this.animationFrame % 60) / 60;
      const pulseX = from.x + (to.x - from.x) * pulsePosition;
      const pulseY = (from.y + from.radius) + ((to.y - to.radius) - (from.y + from.radius)) * pulsePosition;

      const gradient = this.ctx.createRadialGradient(pulseX, pulseY, 0, pulseX, pulseY, 15);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.5, `${color}80`);
      gradient.addColorStop(1, 'transparent');

      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(pulseX, pulseY, 15, 0, Math.PI * 2);
      this.ctx.fill();

      // Additional glow
      this.ctx.strokeStyle = `${color}40`;
      this.ctx.lineWidth = 6;
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y + from.radius);
      this.ctx.lineTo(to.x, to.y - to.radius);
      this.ctx.stroke();
    }
  }

  drawTalentNodes() {
    this.trees.forEach(tree => {
      tree.talents.forEach(talent => {
        this.drawTalentNode(talent);
      });
    });
  }

  drawTalentNode(talent) {
    const isHovered = this.hoveredNode === talent;
    const isSelected = this.selectedNode === talent;
    const isActive = talent.rank > 0;
    const isLocked = this.isTalentLocked(talent);

    const x = talent.x;
    const y = talent.y;
    const radius = talent.radius;

    // Outer glow
    if (isHovered || isActive) {
      const gradient = this.ctx.createRadialGradient(x, y, radius * 0.8, x, y, radius * 1.5);
      gradient.addColorStop(0, `${talent.tree.color}60`);
      gradient.addColorStop(1, 'transparent');
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Main node circle
    if (talent.ultimate) {
      // Ultimate talents have gradient fill
      const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, '#fbbf24');
      gradient.addColorStop(1, '#f59e0b');
      this.ctx.fillStyle = isLocked ? '#4b5563' : gradient;
    } else {
      this.ctx.fillStyle = isLocked ? '#374151' : (isActive ? talent.tree.color : '#1f2937');
    }

    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();

    // Border
    this.ctx.strokeStyle = isSelected ? '#fbbf24' : (isHovered ? '#ffffff' : talent.tree.color);
    this.ctx.lineWidth = isSelected ? 4 : (isHovered ? 3 : 2);
    this.ctx.stroke();

    // Icon
    this.ctx.font = `${radius * 0.8}px Arial`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = isLocked ? '#6b7280' : '#ffffff';
    this.ctx.fillText(talent.icon, x, y);

    // Rank indicator
    if (talent.rank > 0 || isHovered) {
      this.ctx.font = 'bold 12px Arial';
      this.ctx.fillStyle = '#ffffff';
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 3;
      const rankText = `${talent.rank}/${talent.maxRank}`;
      this.ctx.strokeText(rankText, x, y + radius + 15);
      this.ctx.fillText(rankText, x, y + radius + 15);
    }

    // Lock icon
    if (isLocked && talent.tier > 1) {
      this.ctx.font = '20px Arial';
      this.ctx.fillText('🔒', x + radius - 10, y - radius + 10);
    }
  }

  isTalentLocked(talent) {
    if (talent.tier === 1) return false;

    // Check if previous tier has enough points
    const tree = talent.tree;
    const previousTierTalents = tree.talents.filter(t => t.tier < talent.tier);
    const totalPoints = previousTierTalents.reduce((sum, t) => sum + t.rank, 0);
    const requiredPoints = (talent.tier - 1) * 3;

    return totalPoints < requiredPoints;
  }

  drawFogOfWar() {
    this.trees.forEach(tree => {
      tree.talents.forEach(talent => {
        if (this.isTalentLocked(talent)) {
          const x = talent.x;
          const y = talent.y;
          const radius = talent.radius * 1.8;

          // Animated fog
          const fogOpacity = 0.5 + Math.sin(this.animationFrame * 0.02) * 0.1;

          const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, `rgba(10, 14, 39, ${fogOpacity})`);
          gradient.addColorStop(0.6, `rgba(30, 41, 59, ${fogOpacity * 0.8})`);
          gradient.addColorStop(1, 'transparent');

          this.ctx.fillStyle = gradient;
          this.ctx.beginPath();
          this.ctx.arc(x, y, radius, 0, Math.PI * 2);
          this.ctx.fill();

          // Fog particles
          for (let i = 0; i < 3; i++) {
            const angle = (this.animationFrame * 0.01 + i * Math.PI * 2 / 3);
            const particleX = x + Math.cos(angle) * radius * 0.6;
            const particleY = y + Math.sin(angle) * radius * 0.6;

            this.ctx.fillStyle = `rgba(148, 163, 184, ${fogOpacity * 0.3})`;
            this.ctx.beginPath();
            this.ctx.arc(particleX, particleY, 3, 0, Math.PI * 2);
            this.ctx.fill();
          }
        }
      });
    });
  }

  drawTooltip(talent) {
    const mouseX = talent.x;
    const mouseY = talent.y - talent.radius - 20;

    // Tooltip background
    const padding = 10;
    const lines = [
      talent.name,
      talent.desc,
      `Rank: ${talent.rank}/${talent.maxRank}`,
      this.isTalentLocked(talent) ? `Requires ${(talent.tier - 1) * 3} points in tree` : ''
    ].filter(line => line);

    this.ctx.font = 'bold 14px Arial';
    const widths = lines.map(line => this.ctx.measureText(line).width);
    const maxWidth = Math.max(...widths);
    const tooltipWidth = maxWidth + padding * 2;
    const tooltipHeight = lines.length * 20 + padding * 2;

    let tooltipX = mouseX - tooltipWidth / 2;
    let tooltipY = mouseY - tooltipHeight - 10;

    // Keep tooltip on screen
    tooltipX = Math.max(10, Math.min(tooltipX, this.width - tooltipWidth - 10));
    tooltipY = Math.max(10, tooltipY);

    // Background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    this.ctx.strokeStyle = talent.tree.color;
    this.ctx.lineWidth = 2;
    this.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 8);
    this.ctx.fill();
    this.ctx.stroke();

    // Text
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';

    lines.forEach((line, idx) => {
      this.ctx.font = idx === 0 ? 'bold 14px Arial' : '12px Arial';
      this.ctx.fillText(line, tooltipX + padding, tooltipY + padding + idx * 20);
    });
  }

  roundRect(x, y, width, height, radius) {
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.quadraticCurveTo(x, y, x + radius, y);
    this.ctx.closePath();
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('talentTreeCanvas');
  if (canvas && window.CHARACTER_DATA) {
    window.talentTree = new TalentTreeCanvas('talentTreeCanvas', window.CHARACTER_DATA);
  }
});
