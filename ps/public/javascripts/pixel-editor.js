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
    this.pixelData = this.createEmptyGrid();

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
            <label for="colorPicker">Color:</label>
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
            </select>
          </div>
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
    this.clearBtn = document.getElementById('clearBtn');
    this.fillBtn = document.getElementById('fillBtn');
    this.exportBtn = document.getElementById('exportBtn');
    this.gridSizeSelect = document.getElementById('gridSizeSelect');

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
      this.pixelData[y][x] = this.currentColor;
      this.renderPixel(x, y);
    }
  }

  renderPixel(x, y) {
    this.ctx.fillStyle = this.pixelData[y][x];
    this.ctx.fillRect(
      x * this.pixelSize,
      y * this.pixelSize,
      this.pixelSize,
      this.pixelSize
    );

    // Draw grid lines
    this.ctx.strokeStyle = '#ddd';
    this.ctx.lineWidth = 0.5;
    this.ctx.strokeRect(
      x * this.pixelSize,
      y * this.pixelSize,
      this.pixelSize,
      this.pixelSize
    );
  }

  render() {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Render all pixels
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        this.renderPixel(x, y);
      }
    }
  }

  clear() {
    if (confirm('Clear the entire canvas?')) {
      this.pixelData = this.createEmptyGrid();
      this.render();
    }
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
    // Create a new canvas for export (without grid lines)
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.gridSize * this.pixelSize;
    exportCanvas.height = this.gridSize * this.pixelSize;
    const exportCtx = exportCanvas.getContext('2d');

    // Render pixels without grid lines
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        exportCtx.fillStyle = this.pixelData[y][x];
        exportCtx.fillRect(
          x * this.pixelSize,
          y * this.pixelSize,
          this.pixelSize,
          this.pixelSize
        );
      }
    }

    return exportCanvas.toDataURL('image/png');
  }

  exportToBlob() {
    return new Promise((resolve) => {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = this.gridSize * this.pixelSize;
      exportCanvas.height = this.gridSize * this.pixelSize;
      const exportCtx = exportCanvas.getContext('2d');

      for (let y = 0; y < this.gridSize; y++) {
        for (let x = 0; x < this.gridSize; x++) {
          exportCtx.fillStyle = this.pixelData[y][x];
          exportCtx.fillRect(
            x * this.pixelSize,
            y * this.pixelSize,
            this.pixelSize,
            this.pixelSize
          );
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
