// Plans de vue utilisés pour générer les visuels du site (voir render-images.mjs).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createRenderer, buildStudio, buildInterior, createMirrorReflection } from '/js/3d/scenes.js';
import { createAccessories, DIM } from '/js/3d/vanity-model.js';

const canvas = document.getElementById('c');
const renderer = createRenderer(canvas, { pixelRatio: 1 });

function studioShot(setup) {
  return () => {
    const s = buildStudio(renderer, setup.studio || {});
    const cam = new THREE.PerspectiveCamera(setup.fov || 28, 1, 0.01, 30);
    if (setup.mirror) s.vanity.setMirror(setup.mirror);
    if (setup.pouf) s.vanity.setPouf(setup.pouf);
    if (setup.accessories) s.scene.add(createAccessories());
    s.vanity.group.rotation.y = setup.rotY || 0;
    cam.position.set(...setup.cam); cam.lookAt(...setup.target);
    return { scene: s.scene, camera: cam, vanity: s.vanity };
  };
}
function interiorShot(kind, tweak) {
  return () => {
    const s = buildInterior(renderer, kind);
    if (tweak) tweak(s);
    return { scene: s.scene, camera: s.camera, vanity: s.vanity };
  };
}

const T = [0, 0.48, 0];
export const SHOTS = {
  'studio-front':       studioShot({ cam: [0, 0.62, 3.1], target: [0, 0.43, 0] }),
  'studio-threequarter':studioShot({ cam: [1.9, 1.05, 2.3], target: T }),
  'studio-top':         studioShot({ cam: [0.0, 2.9, 0.55], target: [0, 0.6, 0.02], fov: 24 }),
  'studio-mirror':      studioShot({ cam: [1.6, 1.15, 2.4], target: [0, 0.68, 0], mirror: 1, accessories: true }),
  'studio-storage':     studioShot({ cam: [0.35, 1.45, 0.75], target: [0, 0.72, -0.05], mirror: 1, accessories: true, fov: 34 }),
  'studio-pouf-out':    studioShot({ cam: [2.2, 1.05, 2.0], target: [0, 0.4, 0.2], pouf: 1 }),
  'studio-pouf-in':     studioShot({ cam: [-1.7, 0.85, 2.4], target: [0, 0.42, 0] }),
  'studio-open-all':    studioShot({ cam: [2.0, 1.25, 2.3], target: [0, 0.6, 0.15], mirror: 1, pouf: 1, accessories: true }),
  'macro-fabric':       studioShot({ cam: [0.18, 0.62, 0.62], target: [0.06, 0.6, 0.3], fov: 22 }),
  'macro-seat':         studioShot({ cam: [0.25, 0.75, 1.05], target: [0, 0.44, 0.5], pouf: 1, fov: 22 }),
  'macro-hinge':        studioShot({ cam: [0.55, 0.98, -0.05], target: [0.05, 0.82, -0.3], mirror: 0.55, fov: 26 }),
  'macro-mirror':       studioShot({ cam: [0.45, 1.05, 0.85], target: [0, 1.0, -0.2], mirror: 1, fov: 30 }),
  'macro-wood':         studioShot({ cam: [0.12, 1.25, 0.25], target: [0, 0.68, -0.1], mirror: 1, fov: 30 }),
  'step-open':          studioShot({ cam: [1.5, 1.2, 2.2], target: [0, 0.7, 0], mirror: 1, studio: { background: 0xe9e1d5 } }),
  'step-organize':      studioShot({ cam: [0.5, 1.55, 1.0], target: [0, 0.7, -0.05], mirror: 1, accessories: true, studio: { background: 0xe9e1d5 } }),
  'step-close':         studioShot({ cam: [1.6, 0.95, 2.4], target: [0, 0.42, 0], studio: { background: 0xe9e1d5 } }),
  'interior-bedroom':   interiorShot('bedroom'),
  'interior-suite':     interiorShot('suite'),
  'interior-apartment': interiorShot('apartment'),
  'interior-dressing':  interiorShot('dressing'),
  'interior-minimal':   interiorShot('minimal'),
  'hero':               interiorShot('bedroom', (s) => { s.vanity.setMirror(1); const a = createAccessories(); a.position.copy(s.vanity.group.position); a.rotation.copy(s.vanity.group.rotation); s.scene.add(a); s.camera.position.set(-0.15, 1.12, 3.0); s.camera.lookAt(-1.72, 0.78, -0.9); }),
  'hero-portrait':      interiorShot('bedroom', (s) => { s.vanity.setMirror(1); s.camera.fov = 46; s.camera.position.set(0.05, 1.55, 3.3); s.camera.lookAt(-0.82, 0.1, -1.15); })
};

window.SHOT_NAMES = Object.keys(SHOTS);
window.renderShot = async (name, w, h, { ao = true } = {}) => {
  const { scene, camera, vanity } = SHOTS[name]();
  const refl = createMirrorReflection(renderer, scene, vanity, 1024);
  refl.update();
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  // laisse le temps aux textures canvas d'être téléversées
  renderer.compile(scene, camera);
  const composer = new EffectComposer(renderer);
  composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  if (ao) {
    const gtao = new GTAOPass(scene, camera, w, h);
    gtao.updateGtaoMaterial({ radius: 0.18, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16 });
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
  }
  composer.addPass(new OutputPass());
  composer.render();
  composer.render();
  const url = canvas.toDataURL('image/png');
  composer.dispose();
  return url;
};
window.READY = true;
