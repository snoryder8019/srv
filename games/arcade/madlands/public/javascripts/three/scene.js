/**
 * Reusable Three.js scene setup.
 * Configured for both desktop (mouse + scroll wheel) and mobile (1-finger rotate, 2-finger pan/zoom).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HEX } from './hex-grid.js';

export function createScene(host, opts = {}) {
  const width = host.clientWidth || 800;
  const height = host.clientHeight || 600;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.bg || 0x0a0a14);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
  camera.position.set(0, 22 * HEX.SIZE, 22 * HEX.SIZE);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap DPR on mobile
  renderer.setSize(width, height);
  // Touch behaviour - prevent the canvas from also scrolling the page
  renderer.domElement.style.touchAction = 'none';
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);

  // Touch-specific tuning: 1 finger rotates, 2 fingers dolly+pan
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };
  // Reasonable zoom limits so phone users don't get lost
  controls.minDistance = 4 * HEX.SIZE;
  controls.maxDistance = 80 * HEX.SIZE;
  controls.maxPolarAngle = Math.PI * 0.48; // can't go below the board

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(8, 12, 6);
  scene.add(dir);

  // ---- Generated environment art (SD textures), graceful fallback ----
  const texLoader = new THREE.TextureLoader();
  const setSRGB = (t) => { if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; return t; };
  if (opts.sky !== false) {
    texLoader.load(opts.skyUrl || '/assets/img/scene/sky-env.png',
      (tex) => { setSRGB(tex); scene.background = tex; },
      undefined, () => {});
  }
  if (opts.ground !== false) {
    texLoader.load(opts.groundUrl || '/assets/img/scene/ground-terrain.png',
      (tex) => {
        setSRGB(tex);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(12, 12);
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(200, 200),
          new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.06;
        ground.name = 'sd-ground';
        scene.add(ground);
      },
      undefined, () => {});
  }

  // Resize - debounced via rAF to avoid thrashing on iOS toolbar show/hide
  let resizePending = false;
  const onResize = () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      const w = host.clientWidth, h = host.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      resizePending = false;
    });
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // Recover from lost WebGL context (common on mobile under memory pressure)
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('[scene] WebGL context lost');
  });

  function animate(loopFn) {
    function tick() {
      requestAnimationFrame(tick);
      controls.update();
      if (loopFn) loopFn();
      renderer.render(scene, camera);
    }
    tick();
  }

  return { scene, camera, renderer, controls, animate, dispose: () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    renderer.dispose();
  }};
}
