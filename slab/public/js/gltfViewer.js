/**
 * Slab — 3D Brand Viewer + Debug Panel
 * 2D ShapeGeometry text + PBR material + orbiting lights.
 * Header: full brand name. Logo: leading letter.
 */
(function () {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0';
  var THREE, GLTFLoader, OrbitControls, FontLoader;
  var libsReady = false;

  function loadLibs() {
    return new Promise(function (resolve, reject) {
      if (libsReady) return resolve();
      var im = document.createElement('script');
      im.type = 'importmap';
      im.textContent = JSON.stringify({ imports: {
        'three': CDN + '/build/three.module.js',
        'three/addons/': CDN + '/examples/jsm/',
      }});
      document.head.appendChild(im);
      var s = document.createElement('script');
      s.type = 'module';
      s.textContent = [
        "import * as THREE from 'three';",
        "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",
        "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';",
        "import { FontLoader } from 'three/addons/loaders/FontLoader.js';",
        "window.__S3={THREE,GLTFLoader,OrbitControls,FontLoader};",
        "window.dispatchEvent(new Event('s3r'));"
      ].join('\n');
      document.head.appendChild(s);
      window.addEventListener('s3r', function () {
        THREE = window.__S3.THREE;
        GLTFLoader = window.__S3.GLTFLoader;
        OrbitControls = window.__S3.OrbitControls;
        FontLoader = window.__S3.FontLoader;
        libsReady = true; resolve();
      }, { once: true });
      setTimeout(function () { reject('timeout'); }, 15000);
    });
  }

  // ── Debug panel ──────────────────────────────────────────────────────────
  function buildDebugPanel(container, C, onUpdate) {
    var btn = document.createElement('button');
    btn.textContent = '3D';
    btn.style.cssText = 'position:absolute;bottom:8px;left:8px;z-index:101;background:#C9A848;color:#000;border:none;border-radius:2px;font:bold 11px monospace;padding:4px 10px;cursor:pointer;opacity:0.85;';
    container.style.position = 'relative';
    container.appendChild(btn);

    var panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;bottom:32px;left:8px;z-index:100;background:rgba(0,0,0,0.92);color:#ccc;font:11px/1.6 monospace;padding:10px 14px;border-radius:4px;max-height:80%;overflow-y:auto;width:270px;display:none;';
    var open = false;
    btn.addEventListener('click', function () {
      open = !open;
      panel.style.display = open ? 'block' : 'none';
      btn.textContent = open ? 'X' : '3D';
    });

    function sec(t) {
      var d = document.createElement('div');
      d.textContent = t;
      d.style.cssText = 'color:#888;font-size:9px;text-transform:uppercase;letter-spacing:1px;margin:8px 0 2px;border-top:1px solid #333;padding-top:4px;';
      panel.appendChild(d);
    }
    function sl(label, key, min, max, step) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:5px;margin:2px 0;';
      var l = document.createElement('span'); l.textContent = label;
      l.style.cssText = 'width:75px;flex-shrink:0;font-size:10px;';
      var s = document.createElement('input');
      s.type='range'; s.min=min; s.max=max; s.step=step; s.value=C[key];
      s.style.cssText = 'flex:1;height:12px;accent-color:#C9A848;';
      var n = document.createElement('span');
      n.textContent = Number(C[key]).toFixed(2);
      n.style.cssText = 'width:38px;text-align:right;font-size:10px;color:#E8D08A;';
      s.addEventListener('input', function () {
        C[key] = parseFloat(s.value); n.textContent = C[key].toFixed(2); onUpdate(key);
      });
      row.appendChild(l); row.appendChild(s); row.appendChild(n);
      panel.appendChild(row);
    }
    function tog(label, key) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:5px;margin:2px 0;';
      var l = document.createElement('span'); l.textContent = label;
      l.style.cssText = 'width:75px;flex-shrink:0;font-size:10px;';
      var cb = document.createElement('input'); cb.type='checkbox'; cb.checked=C[key];
      cb.style.cssText = 'accent-color:#C9A848;';
      cb.addEventListener('change', function () { C[key]=cb.checked; onUpdate(key); });
      row.appendChild(l); row.appendChild(cb); panel.appendChild(row);
    }
    function bt(label, fn) {
      var b = document.createElement('button'); b.textContent = label;
      b.style.cssText = 'margin-top:4px;padding:4px 8px;background:#444;color:#ccc;border:none;border-radius:2px;font:bold 10px monospace;cursor:pointer;width:100%;';
      b.addEventListener('click', fn); panel.appendChild(b);
    }

    sec('CAMERA');
    sl('cam X','camX',-50,50,0.5); sl('cam Y','camY',-50,50,0.5); sl('cam Z','camZ',-50,50,0.5);
    sl('FOV','fov',5,150,1);
    sl('look X','lookX',-50,50,0.5); sl('look Y','lookY',-50,50,0.5); sl('look Z','lookZ',-50,50,0.5);
    tog('Orbit','orbit');

    sec('TEXT');
    sl('pos X','textX',-20,20,0.1); sl('pos Y','textY',-20,20,0.1); sl('pos Z','textZ',-30,30,0.1);
    sl('rot X','textRotX',-6.3,6.3,0.05); sl('rot Y','textRotY',-6.3,6.3,0.05); sl('rot Z','textRotZ',-6.3,6.3,0.05);
    sl('scale','textScale',0.1,10,0.1);
    sl('metalness','metalness',0,1,0.05); sl('roughness','roughness',0,1,0.05);
    sl('emissive','emissiveInt',0,1,0.05);
    bt('Rebuild Text', function () { onUpdate('rebuildText'); });

    sec('LIGHTS');
    sl('light X','lightX',-30,30,0.5); sl('light Y','lightY',-30,30,0.5); sl('light Z','lightZ',-30,30,0.5);
    sl('intensity','lightInt',0,20,0.1); sl('ambient','ambInt',0,5,0.05); sl('distance','lightDist',1,100,1);
    tog('orbit lights','lightOrbit');

    sec('PARTICLES');
    sl('count','partCount',0,1000,10); sl('size','partSize',0.001,0.5,0.005); sl('opacity','partOp',0,1,0.05);
    bt('Rebuild Particles', function () { onUpdate('rebuildPart'); });

    sec('ANIMATION');
    tog('text float','textFloat'); sl('float amp','floatAmp',0,2,0.01); sl('float spd','floatSpd',0.05,5,0.05);

    var cp = document.createElement('button'); cp.textContent = 'Copy Config JSON';
    cp.style.cssText = 'margin-top:8px;padding:5px 8px;background:#C9A848;color:#000;border:none;border-radius:2px;font:bold 10px monospace;cursor:pointer;width:100%;';
    cp.addEventListener('click', function () {
      navigator.clipboard.writeText(JSON.stringify(C,null,2));
      cp.textContent='Copied!'; setTimeout(function(){cp.textContent='Copy Config JSON';},1500);
    });
    panel.appendChild(cp);
    container.appendChild(panel);
  }

  // ── Viewer ───────────────────────────────────────────────────────────────
  function initViewer(container) {
    var url         = container.dataset.modelUrl || '';
    var brandName   = container.dataset.brandName || '';
    var mode        = container.dataset.mode || 'logo';
    var bgColor     = container.dataset.bgColor || '#0F1B30';
    var accentColor = container.dataset.accentColor || '#C9A848';
    var isHeader    = mode === 'header';
    var isText      = !url;
    var debug       = container.dataset.debug === 'true';

    // For logo text fallback: use leading letter
    var displayText = isHeader ? brandName : (brandName.charAt(0) || '');
    if (!url && !displayText) return;

    var rect   = container.getBoundingClientRect();
    var width  = rect.width  || (isHeader ? 800 : 200);
    var height = rect.height || (isHeader ? 300 : 200);

    // Logo mode: bigger font, tighter camera
    var C = {
      camX: 0, camY: 0, camZ: isHeader ? 4 : 2.5, fov: isHeader ? 35 : 40,
      lookX: 0, lookY: 0, lookZ: 0,
      orbit: false,
      textX: 0, textY: 0, textZ: 0,
      textRotX: 0, textRotY: 0, textRotZ: 0,
      textScale: 1, fontSize: isHeader ? 0.4 : 0.8,
      metalness: 0.7, roughness: 0.2, emissiveInt: 0.06,
      lightX: 0, lightY: 2, lightZ: 3, lightInt: 3, lightDist: 25, ambInt: 0.5,
      lightOrbit: true,
      partCount: isHeader ? 120 : 40, partSize: 0.015, partOp: isHeader ? 0.2 : 0.15,
      textFloat: true, floatAmp: 0.008, floatSpd: 0.3,
    };

    // Renderer
    var useAlpha = bgColor === 'transparent';
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: useAlpha });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    // Scene
    var scene = new THREE.Scene();
    if (!useAlpha) scene.background = new THREE.Color(bgColor);

    // Camera
    var camera = new THREE.PerspectiveCamera(C.fov, width/height, 0.1, 200);
    camera.position.set(C.camX, C.camY, C.camZ);
    camera.lookAt(C.lookX, C.lookY, C.lookZ);

    // Lights
    var accentCol = new THREE.Color(accentColor);
    var white = new THREE.Color(0xffffff);

    var ambientLight = new THREE.AmbientLight(0xffffff, C.ambInt);
    scene.add(ambientLight);

    var lightDefs = [
      { color: accentCol,                         mult: 1.0, ox: -2.5, oy:  1.0 },
      { color: white,                              mult: 0.7, ox:  2.5, oy:  1.0 },
      { color: accentCol.clone().lerp(white,0.5),  mult: 0.8, ox:  0,   oy: -1.5 },
      { color: accentCol.clone().lerp(white,0.3),  mult: 0.6, ox:  0,   oy:  2.5 },
    ];
    var lights = [];
    lightDefs.forEach(function (ld) {
      var pl = new THREE.PointLight(ld.color, C.lightInt * ld.mult, C.lightDist);
      pl.position.set(C.lightX + ld.ox, C.lightY + ld.oy, C.lightZ);
      pl.userData = { ox: ld.ox, oy: ld.oy, mult: ld.mult };
      scene.add(pl); lights.push(pl);
    });

    function syncLights() {
      lights.forEach(function (pl) {
        pl.position.set(C.lightX + pl.userData.ox, C.lightY + pl.userData.oy, C.lightZ);
        pl.intensity = C.lightInt * pl.userData.mult;
        pl.distance = C.lightDist;
      });
    }

    // Particles
    var particles = null;
    function buildParticles() {
      if (particles) scene.remove(particles);
      var n = Math.round(C.partCount);
      if (n <= 0) { particles = null; return; }
      var geo = new THREE.BufferGeometry();
      var p = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        p[i*3]   = (Math.random()-0.5) * (isHeader ? 10 : 4);
        p[i*3+1] = (Math.random()-0.5) * (isHeader ? 5 : 4);
        p[i*3+2] = C.textZ + (Math.random()-0.5) * 3;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      particles = new THREE.Points(geo, new THREE.PointsMaterial({
        color: accentCol, size: C.partSize, transparent: true,
        opacity: C.partOp, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      scene.add(particles);
    }
    buildParticles();

    // Text — flat 2D ShapeGeometry
    var model = null;
    var cachedFont = null;
    var textMat = new THREE.MeshStandardMaterial({
      color: accentCol,
      metalness: C.metalness,
      roughness: C.roughness,
      emissive: accentCol,
      emissiveIntensity: C.emissiveInt,
      side: THREE.DoubleSide,
    });

    function buildText() {
      if (model) { scene.remove(model); model = null; }
      if (!displayText) return;
      var go = function (font) {
        cachedFont = font;
        var shapes = font.generateShapes(displayText, C.fontSize);
        var geo = new THREE.ShapeGeometry(shapes);
        geo.computeBoundingBox();
        var bb = geo.boundingBox;
        geo.translate(
          -(bb.max.x + bb.min.x) / 2,
          -(bb.max.y + bb.min.y) / 2,
          0
        );
        model = new THREE.Mesh(geo, textMat);
        applyTextTransform();
        scene.add(model);
      };
      if (cachedFont) go(cachedFont);
      else new FontLoader().load(CDN + '/examples/fonts/helvetiker_bold.typeface.json', go);
    }

    function applyTextTransform() {
      if (!model) return;
      model.position.set(C.textX, C.textY, C.textZ);
      model.rotation.set(C.textRotX, C.textRotY, C.textRotZ);
      model.scale.setScalar(C.textScale);
    }

    function syncMaterial() {
      textMat.metalness = C.metalness;
      textMat.roughness = C.roughness;
      textMat.emissiveIntensity = C.emissiveInt;
    }

    // Load content
    if (url) {
      new GLTFLoader().load(url, function (gltf) {
        model = gltf.scene;
        var box = new THREE.Box3().setFromObject(model);
        var sz = box.getSize(new THREE.Vector3());
        var ctr = box.getCenter(new THREE.Vector3());
        var s = 2.0 / Math.max(sz.x, sz.y, sz.z);
        model.scale.setScalar(s);
        model.position.sub(ctr.multiplyScalar(s));
        scene.add(model);
      });
    } else {
      buildText();
    }

    // Orbit controls
    var controls = null;
    function enableOrbit() {
      if (controls) return;
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(C.lookX, C.lookY, C.lookZ);
      controls.update();
    }
    function disableOrbit() {
      if (!controls) return;
      controls.dispose(); controls = null;
      camera.position.set(C.camX, C.camY, C.camZ);
      camera.lookAt(C.lookX, C.lookY, C.lookZ);
    }

    // Debug wiring
    function onDebug(key) {
      if ('camX camY camZ fov lookX lookY lookZ'.split(' ').indexOf(key) > -1) {
        camera.position.set(C.camX, C.camY, C.camZ);
        camera.fov = C.fov; camera.updateProjectionMatrix();
        camera.lookAt(C.lookX, C.lookY, C.lookZ);
        if (controls) { controls.target.set(C.lookX, C.lookY, C.lookZ); controls.update(); }
      }
      if (key === 'orbit') C.orbit ? enableOrbit() : disableOrbit();
      if ('textX textY textZ textRotX textRotY textRotZ textScale'.split(' ').indexOf(key) > -1) applyTextTransform();
      if (key === 'rebuildText') buildText();
      if ('metalness roughness emissiveInt'.split(' ').indexOf(key) > -1) syncMaterial();
      if ('lightX lightY lightZ lightInt lightDist'.split(' ').indexOf(key) > -1) syncLights();
      if (key === 'ambInt') ambientLight.intensity = C.ambInt;
      if ('partSize partOp'.split(' ').indexOf(key) > -1 && particles) {
        particles.material.size = C.partSize; particles.material.opacity = C.partOp;
      }
      if (key === 'rebuildPart' || key === 'partCount') buildParticles();
    }

    if (debug) buildDebugPanel(container, C, onDebug);

    // Animate
    var clock = new THREE.Clock();
    (function animate() {
      requestAnimationFrame(animate);
      var t = clock.getElapsedTime();
      if (controls) controls.update();

      if (C.textFloat && model && isText) {
        model.position.y = C.textY + Math.sin(t * C.floatSpd) * C.floatAmp;
      }
      if (particles) particles.rotation.y = t * 0.005;

      if (C.lightOrbit) {
        lights.forEach(function (pl, i) {
          var spd = 0.15 + i * 0.04;
          var rad = 2.5 + i * 0.6;
          var ph = (i * Math.PI * 2) / lights.length;
          pl.position.x = C.lightX + Math.sin(t * spd + ph) * rad;
          pl.position.y = C.lightY + pl.userData.oy + Math.sin(t * spd * 0.6 + ph) * 1.5;
          pl.position.z = C.lightZ + Math.sin(t * spd * 0.3 + ph) * 0.5;
          pl.intensity = C.lightInt * pl.userData.mult * (0.7 + Math.sin(t * 0.5 + i) * 0.3);
        });
      }
      renderer.render(scene, camera);
    })();

    new ResizeObserver(function (e) {
      var w = e[0].contentRect.width, h = e[0].contentRect.height;
      if (w && h) { camera.aspect = w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h); }
    }).observe(container);
  }

  // Init
  function initAll() {
    var v = document.querySelectorAll('.gltf-viewer');
    if (!v.length) return;
    loadLibs().then(function () { v.forEach(initViewer); }).catch(function (e) { console.error('[3d]',e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
