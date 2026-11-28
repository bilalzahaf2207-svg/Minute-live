/**
 * ELYSÉA — modèle 3D procédural de la coiffeuse cylindrique.
 * ------------------------------------------------------------------
 * Construit à partir des caractéristiques communiquées (65 × 65 × 83 cm) :
 *  - corps cylindrique Ø 65 cm revêtu d'un tissu côtelé à rayures verticales
 *    beige / brun ;
 *  - plateau supérieur à charnière arrière dont la face inférieure est un
 *    miroir : relevé, il devient miroir de coiffeuse ;
 *  - compartiment de rangement ouvert sous le plateau ;
 *  - alcôve avant dans laquelle un pouf demi-lune se glisse entièrement :
 *    rangé, il reconstitue la silhouette cylindrique.
 *
 * Unités : mètres. Origine au sol, centre du cylindre. +Z = face avant.
 * Ce modèle est un prototype. Si un fichier GLB du produit réel est fourni
 * (admin › Produit › Modèle 3D), le viewer l'utilise à la place.
 */
import * as THREE from 'three';

export const DIM = {
  R: 0.325,          // rayon extérieur (Ø 65 cm)
  H: 0.83,           // hauteur totale plateau fermé
  plinth: 0.018,     // socle en retrait (ombre portée)
  alcoveTop: 0.50,   // plafond de l'alcôve du pouf
  trayFloor: 0.665,  // fond du compartiment de rangement
  bodyTop: 0.80,     // arête supérieure du corps
  lid: 0.03,         // épaisseur du plateau
  poufH: 0.462,      // hauteur d'assise
  poufTravel: 0.43,  // course de sortie du pouf
  mirrorMax: THREE.MathUtils.degToRad(99) // angle d'ouverture du miroir
};

const PALETTE = {
  beige: [214, 196, 170],
  beigeLight: [232, 219, 199],
  brown: [96, 68, 50],
  brownDeep: [78, 53, 39],
  cream: 0xe8dfd1,
  creamWarm: 0xe6dac8,
  wood: 0xc9ad8a,
  lining: 0x3a2a20,
  piping: 0x5e4232
};

/* ------------------------------------------------------------------ */
/* Textures procédurales                                               */
/* ------------------------------------------------------------------ */
const STRIPE_REPEAT_FULL = 56; // paires de rayures sur la circonférence (≈ 3,6 cm)

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Profil d'une paire de rayures : beige large, brun plus étroit. Chaque rayure
// est elle-même côtelée (fines côtes) et séparée par un sillon de couture.
function stripeProfile(u) {
  // u ∈ [0,1) sur une paire de rayures
  const beigeW = 0.62;
  const inBeige = u < beigeW;
  const local = inBeige ? u / beigeW : (u - beigeW) / (1 - beigeW);
  const ribs = inBeige ? 6 : 4;
  const rib = 0.5 - 0.5 * Math.cos(local * ribs * Math.PI * 2);           // côtes fines
  const channel = Math.pow(Math.sin(local * Math.PI), 0.35);               // bombé + sillon aux bords
  return { inBeige, height: channel * 0.75 + rib * 0.25, channel };
}

let _fabricCache = null;
export function fabricTextures() {
  if (_fabricCache) return _fabricCache;
  const W = 512, Hh = 512;
  const col = canvas(W, Hh), nrm = canvas(W, Hh), rgh = canvas(W, Hh);
  const cc = col.getContext('2d'), nc = nrm.getContext('2d'), rc = rgh.getContext('2d');
  const ci = cc.createImageData(W, Hh), ni = nc.createImageData(W, Hh), ri = rc.createImageData(W, Hh);
  // une tuile = 2 paires de rayures (variation subtile entre elles)
  const heights = new Float32Array(W);
  const info = [];
  for (let x = 0; x < W; x++) {
    const u = (x / W) * 2;
    const p = stripeProfile(u % 1);
    heights[x] = p.height;
    info.push(p);
  }
  // bruit de fibre déterministe
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fiber = new Float32Array(W * Hh);
  for (let i = 0; i < fiber.length; i++) fiber[i] = rnd();
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const p = info[x];
      const f = fiber[y * W + x] * 0.5 + fiber[y * W + ((x + 1) % W)] * 0.5;
      const shade = 0.86 + 0.14 * p.channel + (f - 0.5) * 0.06;
      const base = p.inBeige ? PALETTE.beige : PALETTE.brown;
      ci.data[i] = Math.min(255, base[0] * shade);
      ci.data[i + 1] = Math.min(255, base[1] * shade);
      ci.data[i + 2] = Math.min(255, base[2] * shade);
      ci.data[i + 3] = 255;
      const hl = heights[(x - 1 + W) % W], hr = heights[(x + 1) % W];
      let dx = (hl - hr) * 3.2 + (f - 0.5) * 0.08;
      let dy = (fiber[((y + 1) % Hh) * W + x] - fiber[y * W + x]) * 0.06;
      const len = Math.hypot(dx, dy, 1);
      ni.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      ni.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      ni.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      ni.data[i + 3] = 255;
      const r = 0.78 + (1 - p.channel) * 0.18 + (f - 0.5) * 0.08;
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = Math.min(255, r * 255);
      ri.data[i + 3] = 255;
    }
  }
  cc.putImageData(ci, 0, 0); nc.putImageData(ni, 0, 0); rc.putImageData(ri, 0, 0);
  const mk = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  _fabricCache = { map: mk(col, true), normalMap: mk(nrm, false), roughnessMap: mk(rgh, false) };
  return _fabricCache;
}

// Bouclé crème pour l'assise du pouf
let _boucleCache = null;
function boucleTextures() {
  if (_boucleCache) return _boucleCache;
  const S = 256;
  const n = canvas(S, S), c = n.getContext('2d');
  const img = c.createImageData(S, S);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const h = new Float32Array(S * S);
  for (let k = 0; k < 900; k++) {              // petites boucles
    const cx = rnd() * S, cy = rnd() * S, r = 2 + rnd() * 3.5;
    for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
      const d = Math.hypot(x, y);
      if (d > r) continue;
      const px = ((Math.floor(cx + x) % S) + S) % S, py = ((Math.floor(cy + y) % S) + S) % S;
      h[py * S + px] = Math.max(h[py * S + px], Math.cos((d / r) * Math.PI / 2));
    }
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const dx = (h[y * S + ((x - 1 + S) % S)] - h[y * S + ((x + 1) % S)]) * 1.6;
    const dy = (h[((y - 1 + S) % S) * S + x] - h[((y + 1) % S) * S + x]) * 1.6;
    const l = Math.hypot(dx, dy, 1);
    img.data[i] = (dx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  _boucleCache = { normalMap: t };
  return _boucleCache;
}

function fabricMaterial(repeatU, heightM) {
  const tx = fabricTextures();
  const repV = heightM / 0.09; // tuile ≈ 9 cm de haut (bruit de fibre)
  const clone = (t) => { const c = t.clone(); c.repeat.set(repeatU / 2, repV); c.needsUpdate = true; return c; };
  return new THREE.MeshPhysicalMaterial({
    map: clone(tx.map),
    normalMap: clone(tx.normalMap),
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: clone(tx.roughnessMap),
    roughness: 1,
    metalness: 0,
    sheen: 0.55,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0xf3e3cc)
  });
}

/* ------------------------------------------------------------------ */
/* Géométries utilitaires                                              */
/* ------------------------------------------------------------------ */
// Cylindre ouvert. theta mesuré comme dans three.js : x = r·sinθ, z = r·cosθ (θ=0 → +Z)
function openCylinder(r, h, thetaStart, thetaLength, seg = 160) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true, thetaStart, thetaLength);
  return g;
}

function halfDiscShape(r, front = true) {
  // demi-disque dans le plan (x, y-forme) ; on mappera y-forme → +Z monde
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.absarc(0, 0, r, Math.PI, 0, true);
  s.lineTo(-r, 0);
  if (!front) s.closePath();
  return s;
}

/* ------------------------------------------------------------------ */
/* Assemblage                                                          */
/* ------------------------------------------------------------------ */
export function createVanity(opts = {}) {
  const { R, plinth, alcoveTop, trayFloor, bodyTop, lid, poufH } = DIM;
  const shadows = opts.shadows !== false;
  const root = new THREE.Group();
  root.name = 'ELYSEA_Vanity';

  const mats = {
    cream: new THREE.MeshPhysicalMaterial({ color: PALETTE.cream, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
    creamMatte: new THREE.MeshStandardMaterial({ color: PALETTE.creamWarm, roughness: 0.75 }),
    wood: new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.55 }),
    lining: new THREE.MeshStandardMaterial({ color: PALETTE.lining, roughness: 0.92, side: THREE.DoubleSide }),
    piping: new THREE.MeshStandardMaterial({ color: PALETTE.piping, roughness: 0.6 }),
    plinth: new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.7 }),
    mirror: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.015, envMapIntensity: 1.15 }),
    boucle: new THREE.MeshPhysicalMaterial({
      color: 0xd9ccb8, roughness: 0.95, sheen: 0.8, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xf6ead8),
      normalMap: boucleTextures().normalMap, normalScale: new THREE.Vector2(0.45, 0.45)
    }),
    hinge: new THREE.MeshStandardMaterial({ color: 0xb59a6a, metalness: 0.9, roughness: 0.3 })
  };

  const add = (mesh, parent = root, cast = true, receive = true) => {
    mesh.castShadow = shadows && cast;
    mesh.receiveShadow = shadows && receive;
    parent.add(mesh);
    return mesh;
  };

  /* --- Socle en retrait ------------------------------------------- */
  const plinthMesh = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.012, R - 0.012, plinth, 96, 1, false, Math.PI / 2, Math.PI), mats.plinth);
  plinthMesh.position.y = plinth / 2;
  add(plinthMesh);

  /* --- Corps : moitié arrière basse (0 → alcoveTop) ---------------- */
  const lowH = alcoveTop - plinth;
  const back = new THREE.Mesh(openCylinder(R, lowH, Math.PI / 2, Math.PI), fabricMaterial(STRIPE_REPEAT_FULL / 2, lowH));
  back.position.y = plinth + lowH / 2;
  add(back);

  /* --- Corps : partie haute pleine (alcoveTop → bodyTop) ------------ */
  const upH = bodyTop - alcoveTop;
  const upper = new THREE.Mesh(openCylinder(R, upH, 0, Math.PI * 2), fabricMaterial(STRIPE_REPEAT_FULL, upH));
  upper.position.y = alcoveTop + upH / 2;
  add(upper);

  // liseré (passepoil) sous la partie haute, côté alcôve
  const pip1 = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0045, 10, 96, Math.PI), mats.piping);
  pip1.rotation.x = Math.PI / 2;
  pip1.position.y = alcoveTop;
  add(pip1);

  /* --- Alcôve du pouf ---------------------------------------------- */
  // paroi du fond (plan z = 0)
  const alcBack = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, lowH), mats.lining);
  alcBack.position.set(0, plinth + lowH / 2, 0.001);
  add(alcBack, root, false, true);
  // plafond de l'alcôve (demi-disque avant, face vers le bas)
  const ceil = new THREE.Mesh(new THREE.ShapeGeometry(halfDiscShape(R - 0.001), 48), mats.lining);
  ceil.rotation.x = Math.PI / 2; // forme (x,y) → (x, z) avec y-forme → +z, normale vers -Y
  ceil.position.y = alcoveTop - 0.0005;
  add(ceil, root, false, true);
  // sol de l'alcôve
  const floorA = new THREE.Mesh(new THREE.ShapeGeometry(halfDiscShape(R - 0.012), 48), mats.lining);
  floorA.rotation.x = Math.PI / 2; // lining est DoubleSide
  floorA.position.y = 0.002;
  add(floorA, root, false, true);

  /* --- Compartiment de rangement (sous le plateau) ----------------- */
  const inner = R - 0.022;
  const trayWall = new THREE.Mesh(new THREE.CylinderGeometry(inner, inner, bodyTop - trayFloor, 96, 1, true), mats.creamMatte);
  trayWall.material = mats.creamMatte.clone();
  trayWall.material.side = THREE.BackSide;
  trayWall.position.y = (bodyTop + trayFloor) / 2;
  add(trayWall, root, false, true);
  const trayBottom = new THREE.Mesh(new THREE.CircleGeometry(inner, 96), mats.wood);
  trayBottom.rotation.x = -Math.PI / 2;
  trayBottom.position.y = trayFloor;
  add(trayBottom, root, false, true);
  // séparateurs : une cloison centrale et un cylindre pour pinceaux
  const divH = 0.095;
  const div1 = new THREE.Mesh(new THREE.BoxGeometry(inner * 2 - 0.004, divH, 0.008), mats.creamMatte);
  div1.position.set(0, trayFloor + divH / 2, -0.06);
  add(div1);
  const div2 = new THREE.Mesh(new THREE.BoxGeometry(0.008, divH, inner - 0.06 - 0.004), mats.creamMatte);
  div2.position.set(0.08, trayFloor + divH / 2, -0.06 - (inner - 0.06) / 2);
  add(div2);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, divH, 48, 1, true), mats.creamMatte.clone());
  cup.material.side = THREE.DoubleSide;
  cup.position.set(-0.17, trayFloor + divH / 2, 0.12);
  add(cup);
  // anneau supérieur (arête bois laqué crème)
  const rim = new THREE.Mesh(new THREE.RingGeometry(inner, R, 128), mats.cream);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = bodyTop;
  add(rim);

  const pipRim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.004, 10, 160), mats.piping);
  pipRim.rotation.x = Math.PI / 2;
  pipRim.position.y = bodyTop;
  add(pipRim);

  /* --- Plateau / miroir ------------------------------------------- */
  const hinge = new THREE.Group();          // pivot sur l'arête arrière
  hinge.position.set(0, bodyTop + 0.002, -R + 0.012);
  root.add(hinge);
  const lidG = new THREE.Group();
  lidG.position.set(0, 0, R - 0.012);        // recentre le plateau sur le cylindre
  hinge.add(lidG);

  const lidSide = new THREE.Mesh(openCylinder(R, lid, 0, Math.PI * 2), fabricMaterial(STRIPE_REPEAT_FULL, lid));
  lidSide.position.y = lid / 2;
  add(lidSide, lidG);
  const lidTop = new THREE.Mesh(new THREE.CircleGeometry(R, 128), mats.cream);
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.y = lid;
  add(lidTop, lidG);
  const pipTop = new THREE.Mesh(new THREE.TorusGeometry(R - 0.001, 0.004, 10, 160), mats.piping);
  pipTop.rotation.x = Math.PI / 2;
  pipTop.position.y = lid;
  add(pipTop, lidG);
  // face inférieure : cadre crème + miroir
  const under = new THREE.Mesh(new THREE.RingGeometry(R - 0.03, R, 128), mats.creamMatte);
  under.rotation.x = Math.PI / 2;
  add(under, lidG);
  const mirror = new THREE.Mesh(new THREE.CircleGeometry(R - 0.03, 128), mats.mirror);
  mirror.rotation.x = Math.PI / 2;
  mirror.position.y = -0.0008;
  mirror.name = 'mirror';
  add(mirror, lidG, false, false);
  // charnières
  for (const sx of [-0.12, 0.12]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 16), mats.hinge);
    h.rotation.z = Math.PI / 2;
    h.position.set(sx, 0, 0);
    add(h, hinge);
  }

  /* --- Pouf demi-lune --------------------------------------------- */
  const pouf = new THREE.Group();
  pouf.name = 'pouf';
  root.add(pouf);
  const pr = R - 0.006;
  const seatT = 0.075;                      // coussin
  const baseH = poufH - seatT;
  const poufSide = new THREE.Mesh(openCylinder(pr, baseH - 0.012, -Math.PI / 2, Math.PI), fabricMaterial(STRIPE_REPEAT_FULL / 2, baseH));
  poufSide.position.y = 0.012 + (baseH - 0.012) / 2;
  add(poufSide, pouf);
  const poufBack = new THREE.Mesh(new THREE.PlaneGeometry(2 * pr, baseH - 0.012), fabricMaterial(STRIPE_REPEAT_FULL * (2 * pr) / (2 * Math.PI * R), baseH));
  poufBack.rotation.y = Math.PI;
  poufBack.position.set(0, 0.012 + (baseH - 0.012) / 2, 0.003);
  add(poufBack, pouf);
  const poufPlinth = new THREE.Mesh(new THREE.ExtrudeGeometry(halfDiscShape(pr - 0.01), { depth: 0.012, bevelEnabled: false, curveSegments: 48 }), mats.plinth);
  poufPlinth.rotation.x = Math.PI / 2; // forme y → +Z, extrusion vers le bas
  poufPlinth.position.set(0, 0.012, 0.01);
  add(poufPlinth, pouf);
  // coussin d'assise bouclé, bords arrondis
  const seatShape = halfDiscShape(pr - 0.026);
  const seatGeo = new THREE.ExtrudeGeometry(seatShape, {
    depth: seatT - 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 6, curveSegments: 64
  });
  const seat = new THREE.Mesh(seatGeo, mats.boucle);
  seat.rotation.x = Math.PI / 2; // extrusion vers le bas depuis le dessus de l'assise
  seat.position.set(0, poufH - 0.015, 0.014);
  add(seat, pouf);
  const pipSeat = new THREE.Mesh(new THREE.TorusGeometry(pr - 0.001, 0.0045, 10, 96, Math.PI), mats.piping);
  pipSeat.rotation.x = Math.PI / 2;
  pipSeat.position.y = baseH;
  add(pipSeat, pouf);

  /* --- États animables -------------------------------------------- */
  const state = { mirror: 0, pouf: 0 };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function setMirror(t) {
    state.mirror = THREE.MathUtils.clamp(t, 0, 1);
    hinge.rotation.x = -DIM.mirrorMax * ease(state.mirror);
  }
  function setPouf(t) {
    state.pouf = THREE.MathUtils.clamp(t, 0, 1);
    const e = ease(state.pouf);
    pouf.position.z = DIM.poufTravel * e;
    pouf.rotation.y = 0;
  }

  return {
    group: root,
    parts: { hinge, lid: lidG, mirror, pouf, tray: trayBottom, seat, upper },
    materials: mats,
    state,
    setMirror,
    setPouf,
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach((m) => m.dispose());
      });
    }
  };
}

/**
 * Accessoires de beauté déposés dans le compartiment (rendus d'ambiance).
 */
export function createAccessories() {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xf4ece2, roughness: 0.05, transmission: 0.9, thickness: 0.02, ior: 1.45 });
  const amber = new THREE.MeshPhysicalMaterial({ color: 0x9a5a2a, roughness: 0.1, transmission: 0.6, thickness: 0.02 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc8a96a, metalness: 1, roughness: 0.25 });
  const black = new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 0.35 });
  const blush = new THREE.MeshStandardMaterial({ color: 0xd9a79a, roughness: 0.6 });
  const y0 = DIM.trayFloor;
  const put = (mesh, x, y, z) => { mesh.position.set(x, y0 + y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.09, 32), amber), 0.16, 0.045, -0.15);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 16), gold), 0.16, 0.1, -0.15);
  put(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.03), glass), 0.04, 0.035, -0.19);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.018, 32), black), -0.1, 0.009, 0.05);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.006, 32), blush), -0.1, 0.021, 0.05);
  for (let i = 0; i < 4; i++) {
    const b = put(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.16, 12), i % 2 ? black : gold), -0.17 + (i - 1.5) * 0.012, 0.08, 0.12 + (i % 2) * 0.01);
    b.rotation.z = (i - 1.5) * 0.08;
  }
  put(new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 10, 32), gold), 0.1, 0.004, 0.08).rotation.x = Math.PI / 2;
  put(new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass), 0.18, 0, 0.06);
  return g;
}
