/**
 * Galactic Map Renderer
 * ASCII-styled background with 2D canvas overlay for galactic centers
 */

class GalacticMap {
  constructor(canvasId, width = 1000, height = 1000) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.width = width;
    this.height = height;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    // Set canvas dimensions
    this.canvas.width = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;

    // Faction centers and zones
    this.factionCenters = [];
    this.zones = [];
    this.stars = [];

    // Mouse interaction
    this.hoveredZone = null;
    this.selectedZone = null;

    // Colors for factions
    this.factionColors = {
      'Silicate Consortium': '#667eea',
      'Lantern Collective': '#f59e0b',
      'Devan Empire': '#ef4444',
      'Human Federation': '#10b981',
      'Independent Systems': '#8b5cf6',
      'Unclaimed': '#6b7280'
    };

    this.initStarfield();
    this.setupEventListeners();
  }

  /**
   * Initialize starfield background
   */
  initStarfield() {
    // Create ASCII-style stars
    const starCount = 500;
    const starChars = ['·', '•', '*', '+', '×', '✦', '✧', '★'];

    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: Math.random() * 2 + 0.5,
        char: starChars[Math.floor(Math.random() * starChars.length)],
        brightness: Math.random() * 0.5 + 0.5,
        twinkleSpeed: Math.random() * 0.02 + 0.01
      });
    }
  }

  /**
   * Setup mouse event listeners
   */
  setupEventListeners() {
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));

    // Resize handler
    window.addEventListener('resize', () => this.handleResize());
  }

  /**
   * Handle mouse move for hover effects
   */
  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - this.offsetX) / this.scale;
    const y = (e.clientY - rect.top - this.offsetY) / this.scale;

    // Check if hovering over a zone
    this.hoveredZone = this.getZoneAt(x, y);
    this.render();
  }

  /**
   * Handle click for selection
   */
  handleClick(e) {
    if (this.hoveredZone) {
      this.selectedZone = this.hoveredZone;
      this.onZoneSelect?.(this.hoveredZone);
    }
  }

  /**
   * Handle mouse wheel for zoom
   */
  handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    this.scale *= delta;
    this.scale = Math.max(0.5, Math.min(3, this.scale));
    this.render();
  }

  /**
   * Handle canvas resize
   */
  handleResize() {
    this.canvas.width = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;
    this.render();
  }

  /**
   * Get zone at coordinates
   */
  getZoneAt(x, y) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zone = this.zones[i];
      const dx = x - zone.x;
      const dy = y - zone.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < zone.radius) {
        return zone;
      }
    }
    return null;
  }

  /**
   * Update faction centers from game state
   */
  updateFactionCenters(factions) {
    this.factionCenters = [];

    const factionNames = Object.keys(factions);
    const centerSpacing = this.width / (factionNames.length + 1);

    factionNames.forEach((name, index) => {
      const faction = factions[name];

      // Position faction centers in a distributed pattern
      const angle = (index / factionNames.length) * Math.PI * 2;
      const radius = this.width * 0.3;
      const centerX = this.width / 2 + Math.cos(angle) * radius;
      const centerY = this.height / 2 + Math.sin(angle) * radius;

      this.factionCenters.push({
        name: name,
        x: centerX,
        y: centerY,
        power: faction.power,
        territory: faction.territory,
        influence: faction.influence,
        radius: 20 + (faction.power / 100) * 30,
        color: this.factionColors[name] || '#6b7280'
      });
    });
  }

  /**
   * Update zones from planetary data
   */
  updateZones(zonesData) {
    this.zones = zonesData.map(zone => ({
      ...zone,
      x: zone.coordinates.x,
      y: zone.coordinates.y,
      radius: 5 + (zone.level / 50) * 10,
      color: this.factionColors[zone.controller] || this.factionColors['Unclaimed']
    }));
  }

  /**
   * Render the entire map
   */
  render() {
    const ctx = this.ctx;

    // Clear canvas
    ctx.fillStyle = '#0a0e1a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Save context
    ctx.save();

    // Apply transformations
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // Draw ASCII starfield
    this.renderStarfield();

    // Draw grid lines (ASCII style)
    this.renderGrid();

    // Draw faction influence zones
    this.renderInfluenceZones();

    // Draw zones
    this.renderZones();

    // Draw faction centers
    this.renderFactionCenters();

    // Draw connection lines
    this.renderConnections();

    // Restore context
    ctx.restore();

    // Draw UI overlays (not affected by zoom/pan)
    this.renderUI();
  }

  /**
   * Render starfield background
   */
  renderStarfield() {
    const ctx = this.ctx;
    const time = Date.now() * 0.001;

    this.stars.forEach(star => {
      const twinkle = Math.sin(time * star.twinkleSpeed) * 0.3 + 0.7;
      const alpha = star.brightness * twinkle;

      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.font = `${star.size * 8}px monospace`;
      ctx.fillText(star.char, star.x, star.y);
    });
  }

  /**
   * Render ASCII grid
   */
  renderGrid() {
    const ctx = this.ctx;
    const gridSize = 100;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    // Vertical lines
    for (let x = 0; x <= this.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y <= this.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  /**
   * Render faction influence zones (gradient circles)
   */
  renderInfluenceZones() {
    const ctx = this.ctx;

    this.factionCenters.forEach(center => {
      const influenceRadius = center.radius * (center.influence / 50);

      const gradient = ctx.createRadialGradient(
        center.x, center.y, 0,
        center.x, center.y, influenceRadius
      );

      gradient.addColorStop(0, `${center.color}40`);
      gradient.addColorStop(0.5, `${center.color}20`);
      gradient.addColorStop(1, `${center.color}00`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(center.x, center.y, influenceRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /**
   * Render individual zones
   */
  renderZones() {
    const ctx = this.ctx;

    this.zones.forEach(zone => {
      const isHovered = this.hoveredZone === zone;
      const isSelected = this.selectedZone === zone;

      // Draw zone circle
      ctx.fillStyle = zone.color + (zone.discovered ? '80' : '40');
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = isHovered || isSelected ? 2 : 1;

      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Draw ASCII marker for discovered zones
      if (zone.discovered) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('•', zone.x, zone.y + 3);
      }
    });
  }

  /**
   * Render faction centers
   */
  renderFactionCenters() {
    const ctx = this.ctx;

    this.factionCenters.forEach(center => {
      // Outer glow
      const glowGradient = ctx.createRadialGradient(
        center.x, center.y, 0,
        center.x, center.y, center.radius * 1.5
      );
      glowGradient.addColorStop(0, `${center.color}ff`);
      glowGradient.addColorStop(1, `${center.color}00`);

      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(center.x, center.y, center.radius * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Main circle
      ctx.fillStyle = center.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(center.x, center.y, center.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // ASCII symbol
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', center.x, center.y);

      // Label
      ctx.font = '12px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(center.name, center.x, center.y + center.radius + 15);

      // Power level
      ctx.font = '10px monospace';
      ctx.fillStyle = center.color;
      ctx.fillText(`PWR: ${Math.floor(center.power)}`, center.x, center.y + center.radius + 28);
    });
  }

  /**
   * Render connections between zones and faction centers
   */
  renderConnections() {
    const ctx = this.ctx;

    // Draw lines from zones to their controlling faction center
    ctx.globalAlpha = 0.1;

    this.zones.forEach(zone => {
      const factionCenter = this.factionCenters.find(f => f.name === zone.controller);

      if (factionCenter && zone.discovered) {
        ctx.strokeStyle = zone.color;
        ctx.lineWidth = 0.5;

        ctx.beginPath();
        ctx.moveTo(zone.x, zone.y);
        ctx.lineTo(factionCenter.x, factionCenter.y);
        ctx.stroke();
      }
    });

    ctx.globalAlpha = 1;
  }

  /**
   * Render UI overlays
   */
  renderUI() {
    const ctx = this.ctx;

    // Legend
    this.renderLegend();

    // Hovered zone info
    if (this.hoveredZone) {
      this.renderZoneInfo(this.hoveredZone);
    }

    // Zoom level
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, this.canvas.height - 30, 100, 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.fillText(`Zoom: ${(this.scale * 100).toFixed(0)}%`, 15, this.canvas.height - 15);
  }

  /**
   * Render legend
   */
  renderLegend() {
    const ctx = this.ctx;
    const x = 10;
    const y = 10;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(x, y, 200, 30 + this.factionCenters.length * 20);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('FACTIONS', x + 10, y + 20);

    ctx.font = '10px monospace';
    this.factionCenters.forEach((faction, index) => {
      const yPos = y + 40 + index * 20;

      ctx.fillStyle = faction.color;
      ctx.fillRect(x + 10, yPos - 8, 12, 12);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(faction.name, x + 30, yPos);
    });
  }

  /**
   * Render zone info tooltip
   */
  renderZoneInfo(zone) {
    const ctx = this.ctx;
    const padding = 10;
    const lineHeight = 16;

    const lines = [
      `Zone: ${zone.name}`,
      `Type: ${zone.type}`,
      `Level: ${zone.level}`,
      `Controller: ${zone.controller}`,
      `Population: ${this.formatNumber(zone.population)}`
    ];

    const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
    const boxWidth = maxWidth + padding * 2;
    const boxHeight = lines.length * lineHeight + padding * 2;

    const x = Math.min(this.canvas.width - boxWidth - 10, this.canvas.width - 220);
    const y = 10;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.fillRect(x, y, boxWidth, boxHeight);

    // Border
    ctx.strokeStyle = this.factionColors[zone.controller] || '#6b7280';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, boxWidth, boxHeight);

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    lines.forEach((line, index) => {
      ctx.fillText(line, x + padding, y + padding + (index + 1) * lineHeight);
    });
  }

  /**
   * Format large numbers
   */
  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  /**
   * Animation loop
   */
  animate() {
    this.render();
    requestAnimationFrame(() => this.animate());
  }

  /**
   * Start animation
   */
  start() {
    this.animate();
  }
}

export default GalacticMap;
