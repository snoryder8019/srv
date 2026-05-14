/**
 * Tower builder - upload a GLTF, preview it on a single hex, save stats.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createScene } from '../three/scene.js';
import { buildHexBoard } from '../three/hex-board.js';

const host = document.getElementById('td-builder-host');
const { scene, animate } = createScene(host);
buildHexBoard(scene, { radius: 1 }); // single-hex preview pad

let currentModel = null;
const loader = new GLTFLoader();

function loadModel(url) {
  if (currentModel) scene.remove(currentModel);
  loader.load(url, (gltf) => {
    currentModel = gltf.scene;
    currentModel.position.set(0, 0.1, 0);
    scene.add(currentModel);
  }, undefined, (err) => console.error('GLTF load failed', err));
}

// Upload handler
const fileInput = document.getElementById('gltf-upload');
const urlField = document.getElementById('gltfUrl');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('model', file);
  const res = await fetch('/api/v1/uploads/gltf', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.success) {
    urlField.value = data.url;
    loadModel(data.url);
  } else {
    alert('Upload failed: ' + data.error);
  }
});

// Form save
document.getElementById('tower-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('stats.')) {
      payload.stats = payload.stats || {};
      payload.stats[k.split('.')[1]] = isNaN(v) ? v : Number(v);
    } else {
      payload[k] = isNaN(v) || v === '' ? v : Number(v) || v;
    }
  }
  payload.gltfUrl = urlField.value;
  const res = await fetch('/api/v1/towers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.success) alert('Saved as draft! ID: ' + data.tower._id);
  else alert('Save failed: ' + data.error);
});

animate();
console.log('[td/builder] tower builder ready');
