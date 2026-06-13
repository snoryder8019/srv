/**
 * Three.js Asset Viewer
 * Handles 3D model preview (GLTF) and planet texture preview
 */

class ThreeAssetViewer {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.warn(`Canvas ${canvasId} not found`);
      return;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0a);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      50,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 10);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // Controls
    this.controls = new THREE.OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 50;

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0x404040, 2);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    this.directionalLight.position.set(5, 5, 5);
    this.scene.add(this.directionalLight);

    this.directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    this.directionalLight2.position.set(-5, -5, -5);
    this.scene.add(this.directionalLight2);

    // State
    this.currentModel = null;
    this.wireframeMode = false;
    this.originalMaterials = new Map();

    // Start animation
    this.animate();

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    if (!this.canvas) return;
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  clear() {
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }
    this.originalMaterials.clear();
  }

  loadGLTF(url) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();

      loader.load(
        url,
        (gltf) => {
          this.clear();

          this.currentModel = gltf.scene;
          this.scene.add(this.currentModel);

          // Store original materials for wireframe toggle
          this.currentModel.traverse((child) => {
            if (child.isMesh && child.material) {
              this.originalMaterials.set(child, child.material.clone());
            }
          });

          // Center and scale model
          this.fitCameraToObject(this.currentModel);

          resolve(gltf);
        },
        (progress) => {
          // Progress callback
          const percent = (progress.loaded / progress.total) * 100;
          console.log(`Loading model: ${percent.toFixed(2)}%`);
        },
        (error) => {
          console.error('Error loading GLTF:', error);
          reject(error);
        }
      );
    });
  }

  loadPlanet(textureUrl, normalUrl = null, roughnessUrl = null, radius = 5) {
    return new Promise((resolve, reject) => {
      this.clear();

      const geometry = new THREE.SphereGeometry(radius, 64, 64);

      // Load textures
      const textureLoader = new THREE.TextureLoader();

      textureLoader.load(
        textureUrl,
        (texture) => {
          const material = new THREE.MeshStandardMaterial({
            map: texture,
            metalness: 0.1,
            roughness: 0.8,
          });

          // Load normal map if provided
          if (normalUrl) {
            textureLoader.load(normalUrl, (normalMap) => {
              material.normalMap = normalMap;
            });
          }

          // Load roughness map if provided
          if (roughnessUrl) {
            textureLoader.load(roughnessUrl, (roughnessMap) => {
              material.roughnessMap = roughnessMap;
            });
          }

          const planet = new THREE.Mesh(geometry, material);
          this.currentModel = planet;
          this.scene.add(planet);

          // Add rotation animation
          planet.userData.rotating = true;

          this.camera.position.set(0, 0, radius * 2.5);
          this.controls.target.set(0, 0, 0);
          this.controls.update();

          resolve(planet);
        },
        undefined,
        (error) => {
          console.error('Error loading planet texture:', error);
          reject(error);
        }
      );
    });
  }

  fitCameraToObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 2; // Add some padding

    this.camera.position.set(center.x, center.y, center.z + cameraZ);
    this.controls.target.copy(center);
    this.controls.update();
  }

  resetCamera() {
    if (this.currentModel) {
      this.fitCameraToObject(this.currentModel);
    } else {
      this.camera.position.set(0, 0, 10);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  toggleWireframe() {
    if (!this.currentModel) return;

    this.wireframeMode = !this.wireframeMode;

    this.currentModel.traverse((child) => {
      if (child.isMesh && child.material) {
        if (this.wireframeMode) {
          child.material.wireframe = true;
        } else {
          // Restore original material
          const original = this.originalMaterials.get(child);
          if (original) {
            child.material = original.clone();
          }
        }
      }
    });
  }

  getModelInfo() {
    if (!this.currentModel) return null;

    let vertices = 0;
    let triangles = 0;
    let meshCount = 0;

    this.currentModel.traverse((child) => {
      if (child.isMesh && child.geometry) {
        meshCount++;
        const geometry = child.geometry;

        if (geometry.index) {
          triangles += geometry.index.count / 3;
        } else {
          triangles += geometry.attributes.position.count / 3;
        }

        vertices += geometry.attributes.position.count;
      }
    });

    return {
      meshCount,
      vertices,
      triangles: Math.floor(triangles),
    };
  }
}

// Global viewers (will be initialized when needed)
let gltfViewer = null;
let planetViewer = null;

// Initialize GLTF viewer
function initGLTFViewer() {
  if (!gltfViewer && document.getElementById('gltfCanvas')) {
    gltfViewer = new ThreeAssetViewer('gltfCanvas');
  }
  return gltfViewer;
}

// Initialize planet viewer
function initPlanetViewer() {
  if (!planetViewer && document.getElementById('planetCanvas')) {
    planetViewer = new ThreeAssetViewer('planetCanvas');
  }
  return planetViewer;
}

// Reset camera functions (called from HTML buttons)
function resetGLTFCamera() {
  if (gltfViewer) {
    gltfViewer.resetCamera();
  }
}

function toggleWireframe() {
  if (gltfViewer) {
    gltfViewer.toggleWireframe();
  }
}

// Export for use in other scripts
window.ThreeAssetViewer = ThreeAssetViewer;
window.initGLTFViewer = initGLTFViewer;
window.initPlanetViewer = initPlanetViewer;
window.resetGLTFCamera = resetGLTFCamera;
window.toggleWireframe = toggleWireframe;
