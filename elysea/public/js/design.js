/**
 * Conception : scrollytelling. La progression du défilement pilote le modèle 3D
 * (miroir, plateau, pouf, caméra). Repli : images fixes par étape.
 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const section = $('[data-scrolly]');
const steps = $$('[data-step]');
const imgs = $$('[data-step-img]');
const dots = $$('[data-dot]');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let sceneApi = null;

function progress() {
  const r = section.getBoundingClientRect();
  const total = r.height - innerHeight;
  return Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
}
function setActive(i) {
  steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
  imgs.forEach((s, k) => s.classList.toggle('is-active', k === i));
  dots.forEach((s, k) => s.classList.toggle('is-active', k === i));
}
let ticking = false;
function onScroll() {
  if (ticking) return; ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const p = progress();
    setActive(Math.min(2, Math.floor(p * 3)));
    sceneApi?.update(p);
  });
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

async function boot() {
  if (reduced) return;
  const { webglAvailable } = await import('./3d/viewer.js');
  if (!webglAvailable()) return;
  const THREE = await import('three');
  const { createRenderer, buildStudio, createMirrorReflection } = await import('./3d/scenes.js');
  const { createAccessories } = await import('./3d/vanity-model.js');
  const canvas = $('[data-scrolly-canvas]');
  const mobile = matchMedia('(max-width: 900px)').matches;
  const renderer = createRenderer(canvas, { pixelRatio: Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75) });
  const { scene, vanity } = buildStudio(renderer, { viewer: true });
  createMirrorReflection(renderer, scene, vanity, mobile ? 512 : 1024);
  const acc = createAccessories(); scene.add(acc);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.02, 40);
  const target = new THREE.Vector3();
  // images clés de caméra : [progression, position, cible]
  const K = [
    [0.00, [1.9, 1.05, 2.5], [0, 0.48, 0]],
    [0.30, [1.3, 1.35, 2.2], [0, 0.7, 0]],
    [0.45, [0.45, 1.75, 0.95], [0, 0.7, -0.05]],
    [0.62, [0.35, 1.7, 0.9], [0, 0.7, -0.05]],
    [0.80, [-1.6, 1.0, 2.3], [0, 0.45, 0.1]],
    [1.00, [-1.9, 0.95, 2.5], [0, 0.45, 0]]
  ].map(([p, a, b]) => [p, new THREE.Vector3(...a), new THREE.Vector3(...b)]);
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function pose(p) {
    let i = 0; while (i < K.length - 2 && p > K[i + 1][0]) i++;
    const [p0, a0, b0] = K[i], [p1, a1, b1] = K[i + 1];
    const k = sm(p0, p1, p);
    camera.position.lerpVectors(a0, a1, k);
    target.lerpVectors(b0, b1, k);
    camera.lookAt(target);
  }
  let last = -1;
  function update(p) {
    if (Math.abs(p - last) < 0.0005) return; last = p;
    // 01 OPEN : miroir + pouf sortent ; 03 CLOSE : tout se range
    const open = sm(0.04, 0.3, p) * (1 - sm(0.72, 0.95, p));
    const pouf = sm(0.12, 0.32, p) * (1 - sm(0.68, 0.86, p));
    vanity.setMirror(open);
    vanity.setPouf(pouf);
    acc.visible = open > 0.05;
    pose(p);
    renderer.render(scene, camera);
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.fov = camera.aspect < 0.9 ? 42 : 30;
    // bureau : décale l'image vers la gauche pour laisser la place aux cartes de texte
    if (camera.aspect > 1.2) camera.setViewOffset(w, h, w * 0.17, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    last = -1; update(progress());
  }
  new ResizeObserver(resize).observe(canvas);
  renderer.compile(scene, camera);
  sceneApi = { update };
  resize();
  section.classList.add('is-live');
}
boot().catch((err) => console.warn('3D indisponible', err));
