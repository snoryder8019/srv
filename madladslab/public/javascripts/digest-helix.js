/**
 * digest-helix.js  —  background art engine
 *
 * Pure WebGL helix. No cards. No interaction.
 * Two DNA strands, flowing data particles, electric rungs,
 * ambient nebula, and a pulse wave on new socket events.
 */
(function () {
  'use strict';

  /* ── Helix geometry params ─────────────────────────────── */
  const TURNS   = 3.5;
  const HEIGHT  = 1400;   // total helix height in scene units
  const RADIUS  = 110;
  const STEPS   = 500;    // strand resolution

  /* ── Colors ────────────────────────────────────────────── */
  const COL_STRAND1  = new THREE.Color(0x00d4ff);   // cyan
  const COL_STRAND2  = new THREE.Color(0x9333ea);   // purple
  const COL_RUNG     = new THREE.Color(0x00ff88);   // green
  const COL_FLOW1    = new THREE.Color(0x80f0ff);   // bright cyan
  const COL_FLOW2    = new THREE.Color(0xcc88ff);   // bright purple
  const COL_PULSE    = new THREE.Color(0xffffff);
  const COL_AMBIENT  = new THREE.Color(0x001a33);

  /* ── Runtime state ─────────────────────────────────────── */
  let scene, camera, renderer;
  let helixGroup;
  let strandMat1, strandMat2, glowMat1, glowMat2;
  let rungMeshes = [];           // { line, baseOpacity }
  let flowPtsMesh1, flowPtsMesh2;
  let flow1 = [], flow2 = [];    // flow particle T values (0-1)
  let ambientMesh;
  let pulseRing, pulseState = { active: false, t: 0, type: 'new' };
  let time = 0;

  window.digestHelix = { init, pulse };

  /* ══════════════════════════════════════════════════════════
     STRAND PATH HELPERS
  ══════════════════════════════════════════════════════════ */
  function strandPos(t, strand) {
    // t: 0..1, strand: 0 or 1
    const angle = t * TURNS * Math.PI * 2 + strand * Math.PI;
    return new THREE.Vector3(
      RADIUS * Math.cos(angle),
      t * HEIGHT - HEIGHT / 2,
      RADIUS * Math.sin(angle)
    );
  }

  /* ══════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */
  function init(canvas) {
    if (typeof THREE === 'undefined') return;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    onResize();

    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(58, canvas.clientWidth / canvas.clientHeight, 0.5, 8000);
    camera.position.set(0, 0, 480);

    helixGroup = new THREE.Group();
    scene.add(helixGroup);

    buildStrands();
    buildGlowOverlay();
    buildRungs();
    buildFlowParticles();
    buildAmbient();
    buildPulseRing();

    window.addEventListener('resize', onResize);
    animate();
  }

  /* ── Strand lines ──────────────────────────────────────── */
  function buildStrands() {
    const pts1 = [], pts2 = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      pts1.push(strandPos(t, 0));
      pts2.push(strandPos(t, 1));
    }

    strandMat1 = new THREE.LineBasicMaterial({ color: COL_STRAND1, transparent: true, opacity: 0.75 });
    strandMat2 = new THREE.LineBasicMaterial({ color: COL_STRAND2, transparent: true, opacity: 0.65 });

    helixGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts1), strandMat1));
    helixGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2), strandMat2));
  }

  /* ── Wide glow overlay (fake bloom) ────────────────────── */
  function buildGlowOverlay() {
    const pts1 = [], pts2 = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      pts1.push(strandPos(t, 0));
      pts2.push(strandPos(t, 1));
    }

    const pos1 = new Float32Array(pts1.length * 3);
    const pos2 = new Float32Array(pts2.length * 3);
    pts1.forEach((p, i) => { pos1[i*3]=p.x; pos1[i*3+1]=p.y; pos1[i*3+2]=p.z; });
    pts2.forEach((p, i) => { pos2[i*3]=p.x; pos2[i*3+1]=p.y; pos2[i*3+2]=p.z; });

    const geo1 = new THREE.BufferGeometry(); geo1.setAttribute('position', new THREE.BufferAttribute(pos1, 3));
    const geo2 = new THREE.BufferGeometry(); geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));

    glowMat1 = new THREE.PointsMaterial({
      color: COL_STRAND1, size: 5.5, transparent: true, opacity: 0.10,
      sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    glowMat2 = new THREE.PointsMaterial({
      color: COL_STRAND2, size: 5.5, transparent: true, opacity: 0.10,
      sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });

    helixGroup.add(new THREE.Points(geo1, glowMat1));
    helixGroup.add(new THREE.Points(geo2, glowMat2));
  }

  /* ── Rungs ─────────────────────────────────────────────── */
  function buildRungs() {
    const RUNG_COUNT = 42;
    for (let i = 0; i < RUNG_COUNT; i++) {
      const t   = i / RUNG_COUNT;
      const p1  = strandPos(t, 0);
      const p2  = strandPos(t, 1);
      const op  = 0.08 + Math.random() * 0.08;
      const mat = new THREE.LineBasicMaterial({ color: COL_RUNG, transparent: true, opacity: op });
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const line = new THREE.Line(geo, mat);
      helixGroup.add(line);
      rungMeshes.push({ line, mat, baseOp: op, t });
    }
  }

  /* ── Flow particles (travel along strands) ─────────────── */
  const FLOW_COUNT = 22;
  function buildFlowParticles() {
    // Strand 1
    const pos1 = new Float32Array(FLOW_COUNT * 3);
    flow1 = Array.from({ length: FLOW_COUNT }, (_, i) => i / FLOW_COUNT);
    const geo1 = new THREE.BufferGeometry();
    geo1.setAttribute('position', new THREE.BufferAttribute(pos1, 3));
    flowPtsMesh1 = new THREE.Points(geo1, new THREE.PointsMaterial({
      color: COL_FLOW1, size: 3.8, transparent: true, opacity: 0.95,
      sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    helixGroup.add(flowPtsMesh1);

    // Strand 2
    const pos2 = new Float32Array(FLOW_COUNT * 3);
    flow2 = Array.from({ length: FLOW_COUNT }, (_, i) => (i + 0.5) / FLOW_COUNT);
    const geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    flowPtsMesh2 = new THREE.Points(geo2, new THREE.PointsMaterial({
      color: COL_FLOW2, size: 3.8, transparent: true, opacity: 0.90,
      sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    helixGroup.add(flowPtsMesh2);
  }

  /* ── Ambient nebula cloud ──────────────────────────────── */
  function buildAmbient() {
    const N = 260;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 200 + Math.random() * 500;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI;
      pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
      pos[i*3+1] = (Math.random() - 0.5) * HEIGHT * 1.4;
      pos[i*3+2] = r * Math.sin(phi) * Math.sin(theta) - 300; // push behind
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ambientMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      color: COL_AMBIENT, size: 2.2, transparent: true, opacity: 0.55,
      sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    scene.add(ambientMesh);
  }

  /* ── Pulse ring (invisible until triggered) ────────────── */
  function buildPulseRing() {
    const N = 128;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: COL_PULSE, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    pulseRing = new THREE.Line(geo, mat);
    scene.add(pulseRing);
  }

  /* ══════════════════════════════════════════════════════════
     PULSE  —  called on new action / background tick
  ══════════════════════════════════════════════════════════ */
  function pulse(type) {
    pulseState.active = true;
    pulseState.t      = 0;
    pulseState.type   = type || 'new';
  }

  /* ══════════════════════════════════════════════════════════
     ANIMATE
  ══════════════════════════════════════════════════════════ */
  function animate() {
    requestAnimationFrame(animate);
    time += 0.012;

    const breathe   = 0.5 + 0.5 * Math.sin(time * 0.4);
    const flowSpeed = 0.0018 + (pulseState.active ? 0.006 * (1 - pulseState.t) : 0);

    /* ── Slow helix rotation + gentle tilt ── */
    helixGroup.rotation.y = time * 0.07;
    helixGroup.rotation.x = Math.sin(time * 0.11) * 0.06;

    /* ── Camera very slow drift ── */
    camera.position.x = Math.sin(time * 0.05) * 30;
    camera.position.y = Math.sin(time * 0.03) * 20;
    camera.lookAt(0, 0, 0);

    /* ── Strand glow breathe ── */
    const glowOp = 0.07 + breathe * 0.08;
    glowMat1.opacity = glowOp;
    glowMat2.opacity = glowOp * 0.9;

    /* ── Strand line pulse ── */
    const strandOp = 0.55 + breathe * 0.25;
    strandMat1.opacity = strandOp;
    strandMat2.opacity = strandOp * 0.88;

    /* ── Flow particles ── */
    updateFlowParticles(flowSpeed);

    /* ── Rung flicker ── */
    rungMeshes.forEach((r, idx) => {
      const flicker = Math.sin(time * 2.1 + idx * 0.8) * 0.5 + 0.5;
      let op = r.baseOp * (0.4 + flicker * 0.7);
      if (pulseState.active) {
        // wave front sweeps up the helix
        const waveFront = pulseState.t;
        const dist = Math.abs(r.t - waveFront);
        if (dist < 0.12) op = Math.min(1, op + (1 - dist / 0.12) * 0.9);
      }
      r.mat.opacity = op;
    });

    /* ── Ambient slow rotation ── */
    if (ambientMesh) ambientMesh.rotation.y += 0.0003;

    /* ── Pulse ring ── */
    if (pulseState.active) {
      pulseState.t = Math.min(1, pulseState.t + 0.018);
      const pt = pulseState.t;
      const scale = 40 + pt * 260;
      const yPos  = (pt - 0.5) * HEIGHT;
      pulseRing.scale.setScalar(scale);
      pulseRing.position.y = yPos;
      pulseRing.material.opacity = (1 - pt) * (pulseState.type === 'new' ? 0.9 : 0.45);
      pulseRing.material.color.set(pulseState.type === 'tick' ? COL_RUNG : COL_PULSE);
      if (pt >= 1) pulseState.active = false;
    } else {
      pulseRing.material.opacity = 0;
    }

    renderer.render(scene, camera);
  }

  /* ── Update flow particle positions ───────────────────── */
  function updateFlowParticles(speed) {
    const pos1 = flowPtsMesh1.geometry.attributes.position.array;
    const pos2 = flowPtsMesh2.geometry.attributes.position.array;

    for (let i = 0; i < FLOW_COUNT; i++) {
      flow1[i] = (flow1[i] + speed) % 1;
      flow2[i] = (flow2[i] + speed * 1.1) % 1;

      const p1 = strandPos(flow1[i], 0);
      pos1[i*3]   = p1.x; pos1[i*3+1] = p1.y; pos1[i*3+2] = p1.z;

      const p2 = strandPos(flow2[i], 1);
      pos2[i*3]   = p2.x; pos2[i*3+1] = p2.y; pos2[i*3+2] = p2.z;
    }

    flowPtsMesh1.geometry.attributes.position.needsUpdate = true;
    flowPtsMesh2.geometry.attributes.position.needsUpdate = true;
  }

  /* ── Resize ────────────────────────────────────────────── */
  function onResize() {
    if (!renderer) return;
    const W = window.innerWidth, H = window.innerHeight;
    renderer.setSize(W, H);
    if (camera) {
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }
  }
})();
