/**
 * Pixel Editor Component
 * Allows users to create pixel art for assets
 */
class PixelEditor {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.gridSize = options.gridSize || 32;
    this.pixelSize = options.pixelSize || 16;
    this.currentColor = options.defaultColor || '#000000';
    this.isDrawing = false;
    this.isEraser = false;
    this.pixelData = this.createEmptyGrid();

    // Default 32-color palette for pixel art
    this.palette = options.palette || [
      '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
      '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
      '#291814', '#111D35', '#422136', '#125359', '#742F29', '#49333B', '#A28879', '#F3EF7D',
      '#BE4A2F', '#D77643', '#EAD4AA', '#E0F8A0', '#5FCDE4', '#CBDBFC', '#9BADB7', '#847E87'
    ];

    this.init();
  }

  createEmptyGrid() {
    const grid = [];
    for (let y = 0; y < this.gridSize; y++) {
      grid[y] = [];
      for (let x = 0; x < this.gridSize; x++) {
        grid[y][x] = 'transparent';
      }
    }
    return grid;
  }

  init() {
    this.container.innerHTML = `
      <div class="pixel-editor">
        <div class="pixel-editor-toolbar">
          <div class="tool-group">
            <button id="drawBtn" class="btn btn-primary" style="opacity: 1;">✏️ Draw</button>
            <button id="eraserBtn" class="btn btn-secondary" style="opacity: 0.5;">🧹 Eraser</button>
          </div>
          <div class="tool-group">
            <label for="colorPicker">Custom:</label>
            <input type="color" id="colorPicker" value="${this.currentColor}">
          </div>
          <div class="tool-group">
            <button id="clearBtn" class="btn btn-secondary">Clear</button>
            <button id="fillBtn" class="btn btn-secondary">Fill</button>
            <button id="exportBtn" class="btn btn-primary">Export PNG</button>
          </div>
          <div class="tool-group">
            <label>Grid Size:</label>
            <select id="gridSizeSelect">
              <option value="16" ${this.gridSize === 16 ? 'selected' : ''}>16x16</option>
              <option value="32" ${this.gridSize === 32 ? 'selected' : ''}>32x32</option>
              <option value="64" ${this.gridSize === 64 ? 'selected' : ''}>64x64</option>
              <option value="80" ${this.gridSize === 80 ? 'selected' : ''}>80x80</option>
            </select>
          </div>
        </div>
        <div class="pixel-palette" id="pixelPalette" style="display: grid; grid-template-columns: repeat(16, 1fr); gap: 2px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; margin-bottom: 8px;">
          ${this.palette.map((color, i) => `
            <div class="palette-swatch" data-color="${color}" style="width: 20px; height: 20px; background: ${color}; border: 2px solid ${color === this.currentColor ? '#00ff88' : '#444'}; cursor: pointer; border-radius: 2px;" title="${color}"></div>
          `).join('')}
        </div>
        <canvas id="pixelCanvas"
                width="${this.gridSize * this.pixelSize}"
                height="${this.gridSize * this.pixelSize}">
        </canvas>
      </div>
    `;

    this.canvas = document.getElementById('pixelCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.colorPicker = document.getElementById('colorPicker');
    this.drawBtn = document.getElementById('drawBtn');
    this.eraserBtn = document.getElementById('eraserBtn');
    this.clearBtn = document.getElementById('clearBtn');
    this.fillBtn = document.getElementById('fillBtn');
    this.exportBtn = document.getElementById('exportBtn');
    this.gridSizeSelect = document.getElementById('gridSizeSelect');
    this.paletteSwatches = document.querySelectorAll('.palette-swatch');

    this.attachEventListeners();
    this.render();
  }

  attachEventListeners() {
    // Drawing events
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDrawing = true;
      this.drawPixel(e);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDrawing) {
        this.drawPixel(e);
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isDrawing = false;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isDrawing = false;
    });

    // Touch events for mobile
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.isDrawing = true;
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.drawPixel(mouseEvent);
    });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (this.isDrawing) {
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousemove', {
          clientX: touch.clientX,
          clientY: touch.clientY
        });
        this.drawPixel(mouseEvent);
      }
    });

    this.canvas.addEventListener('touchend', () => {
      this.isDrawing = false;
    });

    // Color picker
    this.colorPicker.addEventListener('change', (e) => {
      this.currentColor = e.target.value;
      this.updatePaletteSelection();
    });

    // Palette swatches
    this.paletteSwatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        this.currentColor = swatch.dataset.color;
        this.colorPicker.value = this.currentColor;
        this.updatePaletteSelection();
        // Switch to draw mode when selecting a color
        if (this.isEraser) {
          this.drawBtn.click();
        }
      });
    });

    // Tool selection
    this.drawBtn.addEventListener('click', () => {
      this.isEraser = false;
      this.drawBtn.style.opacity = '1';
      this.eraserBtn.style.opacity = '0.5';
      this.drawBtn.classList.remove('btn-secondary');
      this.drawBtn.classList.add('btn-primary');
      this.eraserBtn.classList.remove('btn-primary');
      this.eraserBtn.classList.add('btn-secondary');
    });

    this.eraserBtn.addEventListener('click', () => {
      this.isEraser = true;
      this.drawBtn.style.opacity = '0.5';
      this.eraserBtn.style.opacity = '1';
      this.eraserBtn.classList.remove('btn-secondary');
      this.eraserBtn.classList.add('btn-primary');
      this.drawBtn.classList.remove('btn-primary');
      this.drawBtn.classList.add('btn-secondary');
    });

    // Toolbar buttons
    this.clearBtn.addEventListener('click', () => {
      this.clear();
    });

    this.fillBtn.addEventListener('click', () => {
      this.fill();
    });

    this.exportBtn.addEventListener('click', () => {
      this.exportToPNG();
    });

    // Grid size change
    this.gridSizeSelect.addEventListener('change', (e) => {
      if (confirm('Changing grid size will clear your current work. Continue?')) {
        this.gridSize = parseInt(e.target.value);
        this.canvas.width = this.gridSize * this.pixelSize;
        this.canvas.height = this.gridSize * this.pixelSize;
        this.pixelData = this.createEmptyGrid();
        this.render();
      } else {
        e.target.value = this.gridSize;
      }
    });
  }

  drawPixel(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / this.pixelSize);
    const y = Math.floor((e.clientY - rect.top) / this.pixelSize);

    if (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
      this.pixelData[y][x] = this.isEraser ? 'transparent' : this.currentColor;

      // For efficiency during drawing, just update the pixel without full render
      this.renderSinglePixel(x, y);
    }
  }

  renderSinglePixel(x, y) {
    // Clear and redraw just this pixel area
    const px = x * this.pixelSize;
    const py = y * this.pixelSize;

    this.ctx.clearRect(px, py, this.pixelSize, this.pixelSize);

    // Draw the pixel if not transparent
    if (this.pixelData[y][x] !== 'transparent') {
      this.ctx.fillStyle = this.pixelData[y][x];
      this.ctx.fillRect(px, py, this.pixelSize, this.pixelSize);
    }

    // Redraw fine grid line for this cell
    this.ctx.strokeStyle = 'rgba(221, 221, 221, 0.3)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(px, py, this.pixelSize, this.pixelSize);

    // Redraw sprite tile grid if on boundary
    if (this.gridSize === 80) {
      this.ctx.strokeStyle = '#8a4fff';
      this.ctx.lineWidth = 2;

      // Check if this pixel is on a tile boundary
      if (x % 16 === 0) {
        this.ctx.beginPath();
        this.ctx.moveTo(px, 0);
        this.ctx.lineTo(px, this.canvas.height);
        this.ctx.stroke();
      }
      if (y % 16 === 0) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, py);
        this.ctx.lineTo(this.canvas.width, py);
        this.ctx.stroke();
      }
    }
  }

  render() {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Render all pixels
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        const px = x * this.pixelSize;
        const py = y * this.pixelSize;

        // Draw the pixel if not transparent
        if (this.pixelData[y][x] !== 'transparent') {
          this.ctx.fillStyle = this.pixelData[y][x];
          this.ctx.fillRect(px, py, this.pixelSize, this.pixelSize);
        }
      }
    }

    // Draw fine grid lines (light gray, semi-transparent)
    this.ctx.strokeStyle = 'rgba(221, 221, 221, 0.3)';
    this.ctx.lineWidth = 1;
    for (let i = 0; i <= this.gridSize; i++) {
      // Vertical lines
      this.ctx.beginPath();
      this.ctx.moveTo(i * this.pixelSize, 0);
      this.ctx.lineTo(i * this.pixelSize, this.canvas.height);
      this.ctx.stroke();

      // Horizontal lines
      this.ctx.beginPath();
      this.ctx.moveTo(0, i * this.pixelSize);
      this.ctx.lineTo(this.canvas.width, i * this.pixelSize);
      this.ctx.stroke();
    }

    // Draw sprite tile grid (5×5 grid for 80×80 canvas = every 16 pixels)
    if (this.gridSize === 80) {
      this.ctx.strokeStyle = '#8a4fff';
      this.ctx.lineWidth = 2;

      for (let i = 0; i <= 5; i++) {
        // Vertical lines
        this.ctx.beginPath();
        this.ctx.moveTo(i * 16 * this.pixelSize, 0);
        this.ctx.lineTo(i * 16 * this.pixelSize, this.canvas.height);
        this.ctx.stroke();

        // Horizontal lines
        this.ctx.beginPath();
        this.ctx.moveTo(0, i * 16 * this.pixelSize);
        this.ctx.lineTo(this.canvas.width, i * 16 * this.pixelSize);
        this.ctx.stroke();
      }
    }
  }

  clear() {
    if (confirm('Clear the entire canvas?')) {
      this.pixelData = this.createEmptyGrid();
      this.render();
    }
  }

  clearCanvas() {
    this.pixelData = this.createEmptyGrid();
    this.render();
  }

  updatePaletteSelection() {
    this.paletteSwatches.forEach(swatch => {
      if (swatch.dataset.color === this.currentColor) {
        swatch.style.border = '2px solid #00ff88';
        swatch.style.transform = 'scale(1.1)';
      } else {
        swatch.style.border = '2px solid #444';
        swatch.style.transform = 'scale(1)';
      }
    });
  }

  fill() {
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        this.pixelData[y][x] = this.currentColor;
      }
    }
    this.render();
  }

  exportToPNG() {
    // Create a new canvas for export at actual size (gridSize × gridSize, not pixelSize scaled)
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.gridSize;
    exportCanvas.height = this.gridSize;
    const exportCtx = exportCanvas.getContext('2d');

    // Render pixels without grid lines at 1:1 scale
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        if (this.pixelData[y][x] !== 'transparent') {
          exportCtx.fillStyle = this.pixelData[y][x];
          exportCtx.fillRect(x, y, 1, 1);
        }
      }
    }

    return exportCanvas.toDataURL('image/png');
  }

  exportToBlob() {
    return new Promise((resolve) => {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = this.gridSize;
      exportCanvas.height = this.gridSize;
      const exportCtx = exportCanvas.getContext('2d');

      for (let y = 0; y < this.gridSize; y++) {
        for (let x = 0; x < this.gridSize; x++) {
          if (this.pixelData[y][x] !== 'transparent') {
            exportCtx.fillStyle = this.pixelData[y][x];
            exportCtx.fillRect(x, y, 1, 1);
          }
        }
      }

      exportCanvas.toBlob(resolve, 'image/png');
    });
  }

  getData() {
    return {
      gridSize: this.gridSize,
      pixelSize: this.pixelSize,
      pixels: this.pixelData
    };
  }

  loadData(data) {
    if (data && data.pixels) {
      this.gridSize = data.gridSize || this.gridSize;
      this.pixelSize = data.pixelSize || this.pixelSize;
      this.pixelData = data.pixels;

      this.canvas.width = this.gridSize * this.pixelSize;
      this.canvas.height = this.gridSize * this.pixelSize;
      this.gridSizeSelect.value = this.gridSize;

      this.render();
    }
  }
}

// Make it globally available
window.PixelEditor = PixelEditor;
