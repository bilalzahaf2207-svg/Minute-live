/**
 * ELYSÉA — viewer 3D interactif (fiche produit).
 * Rendu à la demande : la boucle ne tourne que pendant une interaction,
 * une animation ou la rotation automatique, et s'arrête hors écran.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer, buildStudio, createMirrorReflection } from './scenes.js';
import { createAccessories } from './vanity-model.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGL2RenderingContext && c.getContext('webgl2')); } catch (_) { return false; }
}

export async function mountViewer(root, { onState } = {}) {
  const canvas = root.querySelector('canvas');
  const mobile = matchMedia('(max-width: 900px)').matches;
  const renderer = createRenderer(canvas, { pixelRatio: Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75) });
  const studio = buildStudio(renderer, { viewer: true });
  const { scene, vanity, lights } = studio;
  lights.key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const acc = createAccessories(); acc.visible = false; scene.add(acc);

  // Modèle GLB fourni par l'admin : remplace le prototype procédural.
  const modelUrl = root.dataset.model;
  if (modelUrl) {
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(modelUrl);
      vanity.group.visible = false;
      gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      scene.add(gltf.scene);
    } catch (err) { console.warn('GLB non chargé, prototype conservé', err); }
  }
  const mirror = createMirrorReflection(renderer, scene, vanity, mobile ? 512 : 1024);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 40);
  const HOME = { pos: new THREE.Vector3(1.5, 1.05, 1.95), target: new THREE.Vector3(0, 0.55, 0.05) };
  const FABRIC = { pos: new THREE.Vector3(0.34, 0.66, 0.78), target: new THREE.Vector3(0.1, 0.6, 0.28) };
  camera.position.copy(HOME.pos);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(HOME.target);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 0.55; controls.maxDistance = 4.2;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
  controls.autoRotateSpeed = 1.6;
  controls.update();

  /* ---- animations d'état ---- */
  const anims = [];
  function animate(from, to, ms, apply, done) {
    const a = { t0: performance.now(), from, to, ms, apply, done };
    anims.push(a); wake();
    return a;
  }
  const state = { mirror: 0, pouf: 0, rotate: false, fabric: false };
  function setMirror(open) {
    state.mirror = open ? 1 : 0;
    acc.visible = true;
    animate(vanity.state.mirror, state.mirror, 1300, (v) => { vanity.setMirror(v); });
    emit();
  }
  function setPouf(out) {
    state.pouf = out ? 1 : 0;
    animate(vanity.state.pouf, state.pouf, 1100, (v) => vanity.setPouf(v));
    emit();
  }
  function flyTo(view, ms = 1400) {
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    animate(0, 1, ms, (k) => {
      const e = ease(k);
      camera.position.lerpVectors(p0, view.pos, e);
      controls.target.lerpVectors(t0, view.target, e);
    });
  }
  function setRotate(on) { state.rotate = on; if (on) state.fabric = false; emit(); wake(); }
  function setFabric(on) {
    state.fabric = on; if (on) setRotate(false);
    flyTo(on ? FABRIC : HOME); emit();
  }
  function reset() {
    setRotate(false); state.fabric = false;
    if (state.mirror) setMirror(false);
    if (state.pouf) setPouf(false);
    flyTo(HOME); emit();
  }
  const emit = () => onState && onState({ ...state });

  /* ---- boucle à la demande ---- */
  let running = false, visible = true, idleFrames = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.9 ? 40 : 30;
    camera.updateProjectionMatrix();
    wake();
  }
  function frame(now) {
    running = false;
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      const k = Math.max(0, Math.min(1, (now - a.t0) / a.ms));
      a.apply(a.from + (a.to - a.from) * k);
      if (k >= 1) { anims.splice(i, 1); a.done?.(); }
    }
    controls.autoRotate = state.rotate && visible;
    const changed = controls.update();
    renderer.render(scene, camera);
    if (anims.length || controls.autoRotate || changed) idleFrames = 0; else idleFrames++;
    if (idleFrames < 12) wake();
  }
  // La visibilité ne bloque jamais une interaction : elle suspend seulement la rotation continue.
  function wake() { if (!running) { running = true; requestAnimationFrame(frame); } }
  controls.addEventListener('change', wake);
  controls.addEventListener('start', () => { if (state.fabric) { state.fabric = false; emit(); } });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) wake(); }, { rootMargin: '100px' }).observe(root);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

  // clavier : flèches pour pivoter
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.3 : 0.12;
    const off = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    if (e.key === 'ArrowLeft') sph.theta -= step; else if (e.key === 'ArrowRight') sph.theta += step;
    else if (e.key === 'ArrowUp') sph.phi = Math.max(0.2, sph.phi - step); else if (e.key === 'ArrowDown') sph.phi = Math.min(controls.maxPolarAngle, sph.phi + step);
    else return;
    e.preventDefault();
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
    wake();
  });

  resize();
  renderer.compile(scene, camera);
  wake();
  return { setMirror, setPouf, setRotate, setFabric, reset, state, renderer, vanity, anims, camera, dispose: () => { mirror.dispose(); renderer.dispose(); } };
}
