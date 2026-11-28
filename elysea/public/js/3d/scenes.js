/**
 * ELYSÉA — scènes : studio produit et intérieurs d'inspiration.
 * Partagé par le viewer interactif (studio) et tools/render-images.mjs (tout).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { createVanity, createAccessories, DIM } from './vanity-model.js';

/* ------------------------------------------------------------------ */
export function createRenderer(canvas, { alpha = false, pixelRatio } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio || Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function roomEnvironment(renderer, intensity = 0.04) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), intensity).texture;
  pmrem.dispose();
  return env;
}

/**
 * Miroir plan réel : remplace la surface du miroir par un Reflector three.js
 * (rendu de la scène depuis la caméra symétrique). Fidèle et sans artefact.
 */
export function createMirrorReflection(renderer, scene, vanity, size = 1024) {
  const mirror = vanity.parts.mirror;
  const reflector = new Reflector(mirror.geometry, {
    textureWidth: size, textureHeight: size, color: 0xc2bcb3, clipBias: 0.003, multisample: 4
  });
  reflector.position.copy(mirror.position);
  reflector.rotation.copy(mirror.rotation);
  reflector.rotateX(Math.PI); // Reflector regarde vers +Z local : on l'oriente comme la face inférieure
  reflector.position.y -= 0.0004;
  mirror.parent.add(reflector);
  mirror.visible = false;
  // voile de verre : reflet diagonal discret, lit la surface comme un miroir
  const c = cnv(256, 256), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(0.32, 'rgba(255,255,255,0.0)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.22)'); g.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.58, 'rgba(255,255,255,0.16)'); g.addColorStop(0.66, 'rgba(255,255,255,0.0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const veil = new THREE.Mesh(mirror.geometry, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  veil.position.copy(mirror.position); veil.rotation.copy(mirror.rotation); veil.position.y -= 0.0012;
  mirror.parent.add(veil);
  return {
    reflector,
    update() {},
    dispose() { reflector.dispose(); mirror.parent.remove(reflector); mirror.visible = true; }
  };
}

/* ------------------------------------------------------------------ */
/* Textures procédurales d'intérieur                                   */
/* ------------------------------------------------------------------ */
function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
function tex(c, { srgb = true, repeat = [1, 1] } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Parquet chêne : point de Hongrie simplifié (lames décalées) ou lames droites
function oakFloor({ tone = [190, 160, 124], herring = false, seed = 11 } = {}) {
  const S = 1024, c = cnv(S, S), x = c.getContext('2d');
  const r = rng(seed);
  x.fillStyle = `rgb(${tone})`; x.fillRect(0, 0, S, S);
  const plank = (px, py, w, h, rot) => {
    x.save(); x.translate(px, py); x.rotate(rot);
    const k = 0.86 + r() * 0.2;
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, `rgb(${tone.map((v) => v * k)})`);
    g.addColorStop(1, `rgb(${tone.map((v) => v * (k - 0.05))})`);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.globalAlpha = 0.09; x.strokeStyle = 'rgb(90,60,35)';
    for (let i = 0; i < 9; i++) {           // veinage
      x.beginPath();
      const yy = r() * h;
      x.moveTo(0, yy);
      for (let s = 0; s <= w; s += 24) x.lineTo(s, yy + Math.sin(s * 0.02 + i) * 2.5 + (r() - 0.5) * 1.5);
      x.lineWidth = 0.6 + r() * 1.2; x.stroke();
    }
    x.globalAlpha = 0.35; x.strokeStyle = 'rgba(70,45,25,1)'; x.lineWidth = 1.5; x.strokeRect(0, 0, w, h);
    x.restore(); x.globalAlpha = 1;
  };
  if (herring) {
    const w = 256, h = 64;
    for (let j = -4; j < 20; j++) for (let i = -2; i < 8; i++) {
      plank(i * 180 + (j % 2) * 0, j * 90 + i * 0, w, h, Math.PI / 4);
      plank(i * 180 + 45 + 0, j * 90 + 135, w, h, -Math.PI / 4);
    }
  } else {
    const h = 128;
    for (let j = 0; j < S / h; j++) {
      let px = -r() * 600;
      while (px < S) { const w = 500 + r() * 500; plank(px, j * h, w, h, 0); px += w; }
    }
  }
  return tex(c, { repeat: [4, 4] });
}

function plaster(base = [236, 230, 221], seed = 5, amp = 7) {
  const S = 512, c = cnv(S, S), x = c.getContext('2d');
  const img = x.createImageData(S, S); const r = rng(seed);
  const n = new Float32Array(S * S); for (let i = 0; i < n.length; i++) n[i] = r();
  for (let p = 0; p < 2; p++) for (let i = 0; i < n.length; i++) n[i] = (n[i] + n[(i + 1) % n.length] + n[(i + S) % n.length] + n[(i + S + 1) % n.length]) / 4;
  for (let i = 0; i < S * S; i++) {
    const k = (n[i] - 0.5) * amp;
    img.data[i * 4] = base[0] + k; img.data[i * 4 + 1] = base[1] + k; img.data[i * 4 + 2] = base[2] + k; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return tex(c, { repeat: [3, 3] });
}

function stone(base = [214, 206, 194], seed = 9) {
  const S = 1024, c = cnv(S, S), x = c.getContext('2d'); const r = rng(seed);
  x.fillStyle = `rgb(${base})`; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '120,105,90'},${0.03 + r() * 0.05})`;
    const s = 2 + r() * 18; x.beginPath(); x.arc(r() * S, r() * S, s, 0, 7); x.fill();
  }
  x.strokeStyle = 'rgba(150,135,118,.35)'; x.lineWidth = 2;
  for (let i = 0; i <= 2; i++) { x.beginPath(); x.moveTo(0, i * S / 2); x.lineTo(S, i * S / 2); x.stroke(); x.beginPath(); x.moveTo(i * S / 2, 0); x.lineTo(i * S / 2, S); x.stroke(); }
  return tex(c, { repeat: [1, 1] });
}

function linen(base = [240, 236, 228], seed = 4) {
  const S = 256, c = cnv(S, S), x = c.getContext('2d'); const r = rng(seed);
  x.fillStyle = `rgb(${base})`; x.fillRect(0, 0, S, S);
  for (let i = 0; i < S; i += 2) {
    x.fillStyle = `rgba(0,0,0,${0.015 + r() * 0.03})`; x.fillRect(0, i, S, 1);
    x.fillStyle = `rgba(0,0,0,${0.015 + r() * 0.03})`; x.fillRect(i, 0, 1, S);
  }
  return tex(c, { repeat: [4, 4] });
}

function radialShadow() {
  const S = 256, c = cnv(S, S), x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.45, 'rgba(0,0,0,0.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); return t;
}

/* ------------------------------------------------------------------ */
/* Ombre de contact douce sous le meuble                               */
/* ------------------------------------------------------------------ */
export function contactShadow(radius = DIM.R * 1.45, opacity = 0.55) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), new THREE.MeshBasicMaterial({ map: radialShadow(), transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.0015; m.renderOrder = 1;
  return m;
}

/* Dôme hors-champ (derrière la caméra) : donne au miroir quelque chose de
   crédible à refléter — dégradé chaud + deux boîtes à lumière. */
function reflectionDome() {
  const g = new THREE.Group();
  const c = cnv(16, 256), x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#fbf6ee'); gr.addColorStop(0.5, '#e9dccb'); gr.addColorStop(0.62, '#cbb9a2'); gr.addColorStop(1, '#a8957e');
  x.fillStyle = gr; x.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9, 48, 24), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide }));
  g.add(dome);
  for (const [px, py, pz, w, h] of [[-1.2, 2.6, 3.4, 1.8, 2.6], [1.6, 2.2, 3.8, 0.8, 2.4]]) {
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    sb.position.set(px, py, pz); sb.lookAt(0, 0.9, 0); g.add(sb);
  }
  return g;
}

/* Dôme clair et uniforme pour le viewer : sert de fond sous tous les angles. */
function viewerDome() {
  const c = cnv(16, 256), x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#f6f0e7'); gr.addColorStop(0.47, '#ece3d6'); gr.addColorStop(0.5, '#e6dbcb'); gr.addColorStop(1, '#ddd0bd');
  x.fillStyle = gr; x.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(12, 48, 24), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, toneMapped: false, depthWrite: false }));
  dome.renderOrder = -1;
  return dome;
}

/* ------------------------------------------------------------------ */
/* STUDIO — fond infini crème                                          */
/* ------------------------------------------------------------------ */
export function buildStudio(renderer, { background = 0xe9dfcf, floor = true, viewer = false } = {}) {
  const scene = new THREE.Scene();
  scene.background = background === null || viewer ? null : new THREE.Color(background);
  if (viewer) floor = false;
  scene.environment = roomEnvironment(renderer, 0.04);
  scene.environmentIntensity = 0.42;

  if (floor) {
    // cyclo : sol + courbe + fond
    const shape = new THREE.Shape();
    shape.moveTo(-6, 0); shape.lineTo(-6, 0.0001);
    const prof = [];
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI / 2; prof.push(new THREE.Vector2(-2.2 - Math.sin(a) * 1.2 + 1.2, (1 - Math.cos(a)) * 1.2)); }
    const pts = [new THREE.Vector3(0, 0, 6), new THREE.Vector3(0, 0, -1)];
    for (const p of prof) pts.push(new THREE.Vector3(0, p.y, p.x));
    pts.push(new THREE.Vector3(0, 6, -2.2));
    const pos = []; const idx = [];
    for (let i = 0; i < pts.length; i++) { pos.push(-8, pts[i].y, pts[i].z, 8, pts[i].y, pts[i].z); if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const cyc = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: background ?? 0xe9dfcf, roughness: 0.95 }));
    cyc.receiveShadow = true;
    scene.add(cyc);
  } else {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.22 }));
    sh.rotation.x = -Math.PI / 2; sh.receiveShadow = true; scene.add(sh);
  }
  scene.add(contactShadow());
  scene.add(viewer ? viewerDome() : reflectionDome());

  const hemi = new THREE.HemisphereLight(0xfff6ea, 0xcdbda6, 0.32); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0dc, 2.9);
  key.position.set(-3.0, 3.1, 1.3); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 8; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -1.2, right: 1.2, top: 1.6, bottom: -0.4, near: 0.5, far: 8 });
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe8eefc, 0.35); fill.position.set(2.5, 1.4, 2.4); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe2c0, 1.1); rim.position.set(1.5, 2.2, -2.6); scene.add(rim);

  const vanity = createVanity();
  scene.add(vanity.group);
  return { scene, vanity, lights: { key, fill, rim, hemi } };
}

/* ------------------------------------------------------------------ */
/* Mobilier d'ambiance (volumes simples, matières soignées)            */
/* ------------------------------------------------------------------ */
const M = {
  std: (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra }),
  phys: (o) => new THREE.MeshPhysicalMaterial(o)
};
function box(w, h, d, mat, r = 0.01) { const m = new THREE.Mesh(r ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d), mat); m.castShadow = m.receiveShadow = true; return m; }

function bed({ linenTone = [242, 238, 230], throwColor = 0xb89c7e, headboard = 0xd8ccbb, width = 1.8 } = {}) {
  const g = new THREE.Group();
  const lin = M.phys({ map: linen(linenTone), roughness: 0.95, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });
  const frame = box(width + 0.08, 0.32, 2.12, M.std(headboard, 0.9), 0.03); frame.position.y = 0.16; g.add(frame);
  const mattress = box(width, 0.26, 2.0, lin, 0.08); mattress.position.set(0, 0.45, 0.02); g.add(mattress);
  const duvet = box(width + 0.04, 0.12, 1.45, lin, 0.06); duvet.position.set(0, 0.6, 0.3); g.add(duvet);
  const thr = box(width + 0.1, 0.03, 0.5, M.phys({ color: throwColor, roughness: 1, sheen: 0.8, sheenColor: new THREE.Color(0xf0d8c0) }), 0.012); thr.position.set(0, 0.67, 0.7); g.add(thr);
  const hb = box(width + 0.12, 1.1, 0.1, M.phys({ color: headboard, roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color(0xfff2e0) }), 0.04); hb.position.set(0, 0.75, -1.02); g.add(hb);
  for (const sx of [-0.45, 0.45]) {
    const p = box(0.62, 0.18, 0.4, lin, 0.08); p.position.set(sx * width / 1.8, 0.72, -0.78); p.rotation.x = -0.35; g.add(p);
  }
  return g;
}

function nightstand(color = 0xcbb79d) {
  const g = new THREE.Group();
  const b = box(0.5, 0.52, 0.42, M.std(color, 0.55), 0.02); b.position.y = 0.26; g.add(b);
  const lampBase = new THREE.Mesh(new THREE.SphereGeometry(0.09, 32, 24), M.phys({ color: 0xe9e1d4, roughness: 0.3, clearcoat: 0.6 }));
  lampBase.position.set(0.05, 0.61, 0); lampBase.castShadow = true; g.add(lampBase);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.2, 48, 1, true), M.std(0xf6efe2, 0.9, { side: THREE.DoubleSide, emissive: 0xffe3bd, emissiveIntensity: 0.55 }));
  shade.position.set(0.05, 0.82, 0); g.add(shade);
  const bulb = new THREE.PointLight(0xffd7a8, 0.9, 2.4, 2); bulb.position.set(0.05, 0.8, 0); g.add(bulb);
  return g;
}

function curtain(width = 1.6, height = 2.8, color = 0xe9e0d2, folds = 14) {
  const g = new THREE.PlaneGeometry(width, height, folds * 8, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / width) * folds * Math.PI * 2) * 0.035);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, M.phys({ color, roughness: 0.95, sheen: 0.7, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide, transmission: 0.0 }));
  m.castShadow = m.receiveShadow = true;
  return m;
}

function vase(height = 0.38, color = 0xd8cbb8) {
  const pts = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push(new THREE.Vector2(0.03 + Math.sin(t * Math.PI) * 0.09 + (t > 0.85 ? (t - 0.85) * 0.1 : 0), t * height)); }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), M.phys({ color, roughness: 0.55, clearcoat: 0.3 }));
  m.castShadow = m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m);
  // branches séchées
  const stemMat = M.std(0x8a6c4e, 0.9);
  const r = rng(21);
  for (let i = 0; i < 9; i++) {
    const len = 0.45 + r() * 0.4;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.004, len, 6), stemMat);
    s.position.set((r() - 0.5) * 0.04, height + len / 2 - 0.05, (r() - 0.5) * 0.04);
    s.rotation.set((r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6); s.castShadow = true; g.add(s);
    const plume = new THREE.Mesh(new THREE.SphereGeometry(0.035 + r() * 0.02, 12, 10), M.phys({ color: 0xe8dcc6, roughness: 1, sheen: 1, sheenColor: new THREE.Color(0xffffff) }));
    plume.scale.set(0.6, 2.2, 0.6);
    plume.position.copy(s.position).add(new THREE.Vector3(Math.sin(s.rotation.z) * -len / 2, len / 2, Math.sin(s.rotation.x) * len / 2));
    plume.castShadow = true; g.add(plume);
  }
  return g;
}

function roundRug(radius = 1.0, color = 0xe2d6c4) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.012, 96), M.phys({ color, roughness: 1, sheen: 1, sheenColor: new THREE.Color(0xfff6ea), normalMap: linen().clone(), normalScale: new THREE.Vector2(0.4, 0.4) }));
  m.position.y = 0.006; m.receiveShadow = true;
  return m;
}

function wallPanels(width, height, color) {
  // moulures de boiseries
  const g = new THREE.Group();
  const mat = M.std(color, 0.85);
  const n = Math.max(1, Math.round(width / 0.9));
  const w = width / n;
  for (let i = 0; i < n; i++) {
    for (const [y0, h] of [[0.18, 0.62], [1.0, height - 1.25]]) {
      const cx = -width / 2 + w * i + w / 2;
      const frameW = w - 0.18;
      for (const [dx, dy, ww, hh] of [[0, h / 2, frameW, 0.022], [0, -h / 2, frameW, 0.022], [-frameW / 2, 0, 0.022, h], [frameW / 2, 0, 0.022, h]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, 0.015), mat);
        b.position.set(cx + dx, y0 + h / 2 + dy, 0.0075); b.castShadow = true; b.receiveShadow = true; g.add(b);
      }
    }
  }
  return g;
}

function room({ width = 6, depth = 6, height = 2.9, wall, floor, ceiling = 0xf3efe9, baseboard }) {
  const g = new THREE.Group();
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floor); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; g.add(fl);
  const bw = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wall); bw.position.set(0, height / 2, -depth / 2 + 0.0); bw.receiveShadow = true; g.add(bw);
  const lw = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), wall); lw.rotation.y = Math.PI / 2; lw.position.set(-width / 2, height / 2, 0); lw.receiveShadow = true; g.add(lw);
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), wall); rw.rotation.y = -Math.PI / 2; rw.position.set(width / 2, height / 2, 0); rw.receiveShadow = true; g.add(rw);
  const fw = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wall); fw.rotation.y = Math.PI; fw.position.set(0, height / 2, depth / 2); g.add(fw);
  const ce = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), M.std(ceiling, 0.95)); ce.rotation.x = Math.PI / 2; ce.position.y = height; g.add(ce);
  if (baseboard) {
    const bb = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, 0.015), M.std(baseboard, 0.6)); bb.position.set(0, 0.05, -depth / 2 + 0.008); g.add(bb);
  }
  return g;
}

// fenêtre lumineuse : découpe émissive + lumière directionnelle chaude
function windowLight(scene, { pos = [-3, 1.6, -0.5], size = [1.6, 2.2], rotY = Math.PI / 2, sun = { dir: [-3, 3.2, 1.4], color: 0xffe7c9, intensity: 3.2 } }) {
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), new THREE.MeshBasicMaterial({ color: 0xfff8ee }));
  glow.position.set(...pos); glow.rotation.y = rotY; scene.add(glow);
  const d = new THREE.DirectionalLight(sun.color, sun.intensity);
  d.position.set(...sun.dir); d.target.position.set(0, 0.4, 0);
  d.castShadow = true; d.shadow.mapSize.set(2048, 2048); d.shadow.radius = 6; d.shadow.bias = -0.0004; d.shadow.normalBias = 0.02;
  Object.assign(d.shadow.camera, { left: -3, right: 3, top: 3, bottom: -1, near: 0.5, far: 12 });
  scene.add(d); scene.add(d.target);
  return d;
}

/* ------------------------------------------------------------------ */
/* INTÉRIEURS                                                          */
/* ------------------------------------------------------------------ */
export const INTERIORS = ['bedroom', 'suite', 'apartment', 'dressing', 'minimal'];

export function buildInterior(renderer, kind) {
  const scene = new THREE.Scene();
  scene.environment = roomEnvironment(renderer, 0.04);
  scene.environmentIntensity = 0.18;
  const vanity = createVanity();
  const acc = createAccessories();
  let camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 40);

  const hemi = (sky, ground, i) => { const h = new THREE.HemisphereLight(sky, ground, i); scene.add(h); return h; };

  if (kind === 'bedroom') {
    // Chambre contemporaine — greige chaud, boiseries, chêne clair
    const wallMat = M.std(0xe4dbcf, 0.95, { map: plaster([228, 219, 207]) });
    scene.add(room({ wall: wallMat, floor: M.std(0xffffff, 0.6, { map: oakFloor({ tone: [196, 168, 132] }) }), baseboard: 0xe4dbcf }));
    const panels = wallPanels(6, 2.9, 0xd9cebf); panels.position.z = -3; scene.add(panels);
    const b = bed({ headboard: 0xcbbca7 }); b.position.set(1.35, 0, -1.9); scene.add(b);
    const ns = nightstand(); ns.position.set(-0.05, 0, -2.65); scene.add(ns);
    const c1 = curtain(1.4, 2.85, 0xe6d8c6); c1.rotation.y = Math.PI / 2; c1.position.set(-2.95, 1.43, -1.6); scene.add(c1);
    windowLight(scene, { pos: [-2.99, 1.55, -0.2], size: [1.4, 2.3], sun: { dir: [-4, 3.4, 1.0], color: 0xffe4c2, intensity: 3.0 } });
    const rug = roundRug(0.95, 0xcfc1ad); rug.position.set(0.9, 0, -0.3); scene.add(rug);
    const fwin = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.1), new THREE.MeshBasicMaterial({ color: 0xfff6ea })); fwin.position.set(-0.3, 1.75, 2.985); fwin.rotation.y = Math.PI; scene.add(fwin);
    const v = vase(0.34, 0xc9b59c); v.position.set(-0.85, 0, -2.6); scene.add(v);
    vanity.group.position.set(-0.85, 0.012, -1.15); vanity.group.rotation.y = 0.32;
    hemi(0xfff4e6, 0xb9a58c, 0.55);
    camera.position.set(0.55, 1.18, 1.9); camera.lookAt(-0.6, 0.62, -1.2);
  }

  if (kind === 'suite') {
    // Suite parentale — taupe profond, rideaux longs, banc de lit
    const wallMat = M.std(0xbcab98, 0.95, { map: plaster([190, 172, 152], 8, 9) });
    scene.add(room({ width: 7, depth: 7, height: 3.1, wall: wallMat, floor: M.std(0xffffff, 0.55, { map: oakFloor({ tone: [150, 115, 84], herring: true, seed: 3 }) }), baseboard: 0xb2a08c }));
    const b = bed({ headboard: 0x8f7660, throwColor: 0x6e4f3a, width: 2.0 }); b.position.set(1.4, 0, -2.2); scene.add(b);
    const bench = box(1.5, 0.44, 0.42, M.phys({ color: 0xd9cbb7, roughness: 0.95, sheen: 0.8, sheenColor: new THREE.Color(0xffffff) }), 0.05); bench.position.set(1.4, 0.22, -0.68); scene.add(bench);
    for (const z of [-2.6, -0.4]) { const c = curtain(1.3, 3.05, 0xd8c8b2, 12); c.rotation.y = Math.PI / 2; c.position.set(-3.45, 1.53, z); scene.add(c); }
    windowLight(scene, { pos: [-3.49, 1.6, -1.5], size: [1.2, 2.5], sun: { dir: [-4, 3, 0.4], color: 0xffd9b0, intensity: 2.6 } });
    const ns = nightstand(0x8a705a); ns.position.set(0.0, 0, -2.95); scene.add(ns);
    scene.add(Object.assign(roundRug(1.1, 0xcdbda7), {}));
    vanity.group.position.set(-1.1, 0.012, -1.4); vanity.group.rotation.y = 0.5;
    vanity.setMirror(1);
    acc.position.copy(vanity.group.position); acc.rotation.copy(vanity.group.rotation); scene.add(acc);
    hemi(0xffeedd, 0x8f7a63, 0.5);
    const lamp = new THREE.PointLight(0xffcf98, 1.2, 4, 2); lamp.position.set(-1.6, 2.2, 0.3); scene.add(lamp);
    camera.position.set(0.9, 1.35, 2.0); camera.lookAt(-0.9, 0.7, -1.4);
  }

  if (kind === 'apartment') {
    // Appartement moderne — blanc cassé, béton ciré clair, miroir arche
    const wallMat = M.std(0xf1ede6, 0.95, { map: plaster([242, 238, 231], 12, 5) });
    scene.add(room({ wall: wallMat, floor: M.std(0xffffff, 0.45, { map: stone([205, 199, 190]) }) }));
    // grande baie à droite
    windowLight(scene, { pos: [2.99, 1.4, -0.8], size: [2.2, 2.6], rotY: -Math.PI / 2, sun: { dir: [4, 3.0, 0.6], color: 0xfff0dc, intensity: 3.4 } });
    const arch = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6), M.phys({ color: 0xcfc8bd, metalness: 0.1, roughness: 0.12, clearcoat: 1 }));
    arch.position.set(-0.9, 1.5, -2.985); scene.add(arch);
    const archTop = new THREE.Mesh(new THREE.CircleGeometry(0.4, 48, 0, Math.PI), arch.material); archTop.position.set(-0.9, 2.3, -2.985); scene.add(archTop);
    const sofa = box(2.1, 0.42, 0.9, M.phys({ color: 0xd6cdc0, roughness: 1, sheen: 0.8, sheenColor: new THREE.Color(0xffffff) }), 0.12); sofa.position.set(1.4, 0.21, -2.4); scene.add(sofa);
    const back = box(2.1, 0.42, 0.22, sofa.material, 0.1); back.position.set(1.4, 0.55, -2.78); scene.add(back);
    const v = vase(0.42, 0x2b2420); v.position.set(0.25, 0, -2.75); scene.add(v);
    vanity.group.position.set(-0.6, 0.012, -1.6); vanity.group.rotation.y = -0.15;
    vanity.setPouf(1);
    hemi(0xf7f4ef, 0xc7bdb0, 0.6);
    camera.position.set(0.9, 1.05, 1.5); camera.lookAt(-0.5, 0.55, -1.6);
  }

  if (kind === 'dressing') {
    // Dressing haut de gamme — façades cannelées, LED chaude
    const wallMat = M.std(0xd9cbb9, 0.9);
    scene.add(room({ width: 5, depth: 5, height: 2.8, wall: wallMat, floor: M.std(0xffffff, 0.6, { map: oakFloor({ tone: [176, 142, 106], seed: 8 }) }) }));
    const doorMat = M.std(0xcdbba5, 0.7);
    for (let i = 0; i < 6; i++) {
      const x = -2.1 + i * 0.62;
      const d = box(0.6, 2.5, 0.05, doorMat, 0.004); d.position.set(x, 1.27, -2.47); scene.add(d);
      for (let f = 0; f < 10; f++) { const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.36, 12, 1, false, 0, Math.PI), doorMat); fl.rotation.y = -Math.PI / 2; fl.position.set(x - 0.26 + f * 0.058, 1.27, -2.445); scene.add(fl); }
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 12), M.std(0xb79b67, 0.3, { metalness: 1 })); h.position.set(x + 0.24, 1.15, -2.42); scene.add(h);
    }
    const led = new THREE.Mesh(new THREE.BoxGeometry(4, 0.012, 0.02), new THREE.MeshBasicMaterial({ color: 0xffe2b8 })); led.position.set(0, 2.55, -2.42); scene.add(led);
    const ledL = new THREE.RectAreaLight ? null : null; void ledL;
    const spot = new THREE.SpotLight(0xffd9a6, 9, 5, 0.9, 0.7, 2); spot.position.set(-0.4, 2.7, -0.6); spot.target.position.set(-0.4, 0, -1.2); spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.radius = 6; scene.add(spot, spot.target);
    scene.add(Object.assign(roundRug(0.9, 0xe9dfd0)));
    vanity.group.position.set(-0.4, 0.012, -1.2); vanity.group.rotation.y = 0.2;
    vanity.setMirror(1); vanity.setPouf(1);
    acc.position.copy(vanity.group.position); acc.rotation.copy(vanity.group.rotation); scene.add(acc);
    hemi(0xffeedd, 0x9e8a72, 0.6);
    camera.position.set(0.55, 1.4, 1.2); camera.lookAt(-0.4, 0.75, -1.3);
  }

  if (kind === 'minimal') {
    // Intérieur minimaliste — tout blanc cassé, niche en arche, lumière rasante
    const wallMat = M.std(0xece6dc, 0.97, { map: plaster([236, 230, 220], 2, 6) });
    scene.add(room({ wall: wallMat, floor: M.std(0xffffff, 0.75, { map: stone([222, 214, 202], 4) }) }));
    const niche = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.9), M.std(0xe0d7ca, 0.97)); niche.position.set(0.0, 1.05, -2.99); scene.add(niche);
    const nicheTop = new THREE.Mesh(new THREE.CircleGeometry(0.65, 64, 0, Math.PI), niche.material); nicheTop.position.set(0, 2.0, -2.99); scene.add(nicheTop);
    windowLight(scene, { pos: [-2.99, 1.6, 0.6], size: [0.9, 2.0], sun: { dir: [-5, 2.2, 0.9], color: 0xffe0bb, intensity: 3.6 } });
    const v = vase(0.3, 0xd4c7b4); v.position.set(1.2, 0, -2.6); scene.add(v);
    vanity.group.position.set(0, 0.012, -1.9); vanity.group.rotation.y = 0;
    hemi(0xfdf8f0, 0xcfc2ae, 0.55);
    camera.position.set(0.0, 1.0, 1.6); camera.lookAt(0, 0.55, -1.9);
  }

  const cs = contactShadow(); cs.position.x = vanity.group.position.x; cs.position.z = vanity.group.position.z; scene.add(cs);
  scene.add(vanity.group);
  return { scene, vanity, camera, accessories: acc };
}
