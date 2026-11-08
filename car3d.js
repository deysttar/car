// Escena 3D low poly y constructor procedural de coches.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mulberry32, parts, stats } from './sim.js';
import { CAR_TYPES } from './data.js';

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6, metalness: 0.05, ...opts }));
  }
  return matCache.get(key);
}

function extrude(points, depth, material) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, seg, material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.castShadow = true;
  return m;
}

function wheel(r, w, rimColor, spokes = 5) {
  const g = new THREE.Group();
  const tire = cyl(r, r, w, 10, mat('#1d1f22', { roughness: 0.9 }));
  tire.rotation.x = Math.PI / 2;
  g.add(tire);
  const rim = cyl(r * 0.6, r * 0.6, w + 0.02, 10, mat(rimColor, { metalness: 0.5, roughness: 0.35 }));
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const hub = cyl(r * 0.18, r * 0.18, w + 0.06, 6, mat('#2a2d31'));
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < spokes; i++) {
    const s = box(r * 0.1, r * 1.05, 0.04, mat('#3a3e44'), 0, 0, w / 2 + 0.01);
    s.rotation.z = (i / spokes) * Math.PI;
    g.add(s);
  }
  g.userData.isWheel = true;
  return g;
}

function addWheels(group, cfg, rimColor) {
  const { wb, track, rf, rr, wf, wr } = cfg;
  const places = [
    [wb[0], rf, track, wf], [wb[0], rf, -track, wf],
    [wb[1], rr, track, wr], [wb[1], rr, -track, wr],
  ];
  for (const [x, r, z, w] of places) {
    const wh = wheel(r, w, rimColor);
    wh.position.set(x, r, z);
    if (z < 0) wh.rotation.y = Math.PI;
    group.add(wh);
  }
}

const headMat = () => mat('#fff6d8', { emissive: '#ffe9a8', emissiveIntensity: 1.2 });
const tailMat = () => mat('#ff3b2f', { emissive: '#ff2a1a', emissiveIntensity: 1.1 });
function isLight(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
}

function lights(group, front, rear, y, halfW, h = 0.1) {
  const head = headMat();
  const tail = tailMat();
  for (const z of [halfW - 0.22, -(halfW - 0.22)]) {
    group.add(box(0.06, h, 0.32, head, front, y, z));
    group.add(box(0.06, h, 0.36, tail, rear, y, z));
  }
}

function exhausts(group, x, y, count, spread) {
  const m = mat('#9aa0a6', { metalness: 0.8, roughness: 0.3 });
  const inner = mat('#111214');
  for (let i = 0; i < count; i++) {
    const z = count === 1 ? spread * 0.6 : -spread + (2 * spread * i) / (count - 1);
    const p = cyl(0.055, 0.055, 0.22, 8, m); p.rotation.z = Math.PI / 2; p.position.set(x, y, z); group.add(p);
    const q = cyl(0.035, 0.035, 0.23, 8, inner); q.rotation.z = Math.PI / 2; q.position.set(x - 0.005, y, z); group.add(q);
  }
}

// Variantes de carrocería por chasis (0 = diseño original). Se deriva de la semilla
// del coche, así que un modelo conserva su diseño en cada versión.
export const DESIGNS = {
  utilitario: ['Compacto', 'Microcoche', 'Retro'],
  furgoneta: ['Furgón', 'Monovolumen', 'Reparto'],
  turismo: ['Berlina', 'Familiar', 'Fastback'],
  suv: ['Urbano', 'Todoterreno', 'SUV coupé'],
  pickup: ['Cabina simple', 'Doble cabina', 'Off-road'],
  coupe: ['Clásico', 'Muscle', 'Descapotable'],
  deportivo: ['Superdeportivo', 'Cuña', 'Gran turismo'],
  bolido: ['Hiperdeportivo', 'Prototipo', 'Monoplaza'],
};
export function carDesign(car) {
  if (car.design != null) return car.design;
  const n = (DESIGNS[car.typeId] || ['']).length;
  return Math.floor(mulberry32(((car.seed || 1) ^ 0x5bd1e995) >>> 0)() * n);
}
export const designName = (car) => (DESIGNS[car.typeId] || [])[carDesign(car)] || '';

export function buildCar(car) {
  const rnd = mulberry32(car.seed || 1);
  const pr = parts(car);
  const st = stats(car);
  const g = new THREE.Group();
  const body = mat(car.color, { roughness: 0.45, metalness: 0.15 });
  const dark = mat('#1b1d21', { roughness: 0.8 });
  const trim = mat('#2c3036');
  const glass = mat('#203546', { roughness: 0.15, metalness: 0.4 });
  const legendary = st.overallTier >= 4;
  const rimColor = legendary ? '#ffb627' : st.overallTier >= 3 ? '#cfd6dc' : ['pickup', 'furgoneta', 'suv'].includes(pr.type.id) ? '#3a3e44' : '#aab2ba';
  const supercharger = pr.turbo.supercharger;
  const turboCount = pr.turbo.count;
  const aero = pr.aero.level;
  const exCount = Math.max(1, Math.min(4, Math.ceil((pr.engine.cyl || 4) / 4)));

  const design = carDesign(car);
  // franja del capó: [centro x, altura, inclinación, largo, separación z]
  let stripe = null;
  const hood = (x1, y1, x2, y2, maxLen = 1.2, z = 0.16) => {
    stripe = [(x1 + x2) / 2, (y1 + y2) / 2 + 0.012, Math.atan2(y1 - y2, x1 - x2), Math.min(maxLen, Math.hypot(x1 - x2, y1 - y2) * 0.85), z];
  };
  const mirrors = (x, y, W, m = body) => { for (const z of [W / 2 + 0.06, -(W / 2 + 0.06)]) g.add(box(0.12, 0.09, 0.12, m, x, y, z)); };
  const pillar = (x, y, h, W, m = body) => g.add(box(0.12, h, W - 0.17, m, x, y, 0));
  const wing = (x, baseY, h, w, W) => {
    for (const z of [0.55, -0.55]) g.add(box(0.08, h, 0.06, dark, x, baseY + h / 2, z));
    g.add(box(w, 0.05, W - 0.1, aero >= 0.75 ? dark : body, x - 0.02, baseY + h, 0));
  };

  if (pr.type.id === 'turismo') {
    const W = 1.78;
    if (design === 1) {
      // Familiar: techo prolongado hasta la zaga y barras de techo
      g.add(extrude([[-2.3, 0.3], [2.12, 0.3], [2.25, 0.5], [2.2, 0.72], [0.95, 0.86], [-2.28, 0.9], [-2.34, 0.55]], W, body));
      g.add(extrude([[-2.22, 0.88], [0.92, 0.86], [0.2, 1.36], [-2.1, 1.38], [-2.26, 1.0]], W - 0.2, glass));
      g.add(extrude([[-2.14, 1.36], [0.22, 1.34], [0.16, 1.42], [-2.12, 1.44]], W - 0.16, body));
      pillar(-0.35, 1.1, 0.5, W); pillar(-1.35, 1.12, 0.5, W);
      for (const z of [0.6, -0.6]) g.add(box(2.0, 0.05, 0.05, dark, -1.0, 1.48, z));
      lights(g, 2.21, -2.32, 0.66, W / 2);
      g.add(box(0.3, 0.12, W + 0.04, trim, -2.24, 0.33, 0));
    } else if (design === 2) {
      // Fastback: luneta muy inclinada y cola corta con alerón integrado
      g.add(extrude([[-2.2, 0.3], [2.12, 0.3], [2.25, 0.5], [2.2, 0.72], [0.95, 0.86], [-1.9, 0.9], [-2.2, 0.86], [-2.28, 0.55]], W, body));
      g.add(extrude([[-1.95, 0.88], [0.92, 0.86], [0.25, 1.34], [-0.6, 1.36], [-1.95, 0.94]], W - 0.2, glass));
      g.add(extrude([[-0.62, 1.34], [0.27, 1.34], [0.21, 1.42], [-0.6, 1.42]], W - 0.16, body));
      pillar(-0.3, 1.1, 0.5, W);
      g.add(box(0.22, 0.05, W - 0.1, aero >= 0.75 ? dark : body, -2.05, 0.92, 0));
      lights(g, 2.21, -2.24, 0.66, W / 2);
      g.add(box(0.3, 0.12, W + 0.04, trim, -2.1, 0.33, 0));
    } else {
      g.add(extrude([[-2.2, 0.3], [2.12, 0.3], [2.25, 0.5], [2.2, 0.72], [0.95, 0.86], [-1.65, 0.9], [-2.18, 0.86], [-2.26, 0.55]], W, body));
      g.add(extrude([[-1.55, 0.86], [0.92, 0.86], [0.2, 1.36], [-1.05, 1.36], [-1.62, 0.95]], W - 0.2, glass));
      g.add(extrude([[-1.08, 1.34], [0.22, 1.34], [0.16, 1.42], [-1.02, 1.42]], W - 0.16, body));
      pillar(-0.35, 1.1, 0.5, W);
      lights(g, 2.21, -2.24, 0.66, W / 2);
      g.add(box(0.3, 0.12, W + 0.04, trim, -2.1, 0.33, 0));
      if (aero >= 0.5) wing(-1.95, 0.88, aero >= 0.75 ? 0.28 : 0.1, 0.36, W);
    }
    g.add(box(0.05, 0.16, 1.0, dark, 2.24, 0.48, 0)); // parrilla
    g.add(box(0.3, 0.12, W + 0.04, trim, 2.05, 0.33, 0)); // paragolpes
    mirrors(0.75, 1.0, W);
    hood(2.2, 0.72, 0.95, 0.86);
    if (supercharger) g.add(box(0.5, 0.12, 0.42, dark, 1.45, 0.84, 0));
    if (turboCount >= 2) for (const z of [W / 2 + 0.005, -(W / 2 + 0.005)]) g.add(box(0.4, 0.08, 0.02, dark, 1.4, 0.55, z));
    exhausts(g, design === 1 ? -2.35 : -2.27, 0.36, Math.min(exCount, 2), 0.55);
    addWheels(g, { wb: [1.38, design === 1 ? -1.42 : -1.38], track: 0.82, rf: 0.36, rr: 0.36, wf: 0.26, wr: 0.26 }, rimColor);
  } else if (pr.type.id === 'pickup') {
    const W = 1.95;
    // el diseño 2 es un todoterreno elevado: carrocería subida y ruedas enormes
    const lift = design === 2 ? 0.3 : 0;
    const pg = new THREE.Group(); pg.position.y = lift; g.add(pg);
    const cab = design === 1 ? -1.2 : -0.35; // trasera de la cabina
    const rear = design === 1 ? -2.7 : -2.55;
    pg.add(extrude([[rear, 0.5], [2.45, 0.5], [2.58, 0.75], [2.52, 1.12], [1.0, 1.22], [cab, 1.22], [cab, 1.02], [rear, 1.02]], W, body));
    pg.add(extrude([[cab, 1.2], [0.98, 1.2], [0.55, 1.82], [cab + 0.05, 1.82]], W - 0.18, glass));
    pg.add(extrude([[cab + 0.02, 1.8], [0.58, 1.8], [0.54, 1.9], [cab + 0.02, 1.9]], W - 0.12, body));
    pg.add(box(0.12, 0.62, W - 0.15, body, cab + 0.05, 1.5, 0));
    if (design === 1) pg.add(box(0.12, 0.62, W - 0.15, body, -0.3, 1.5, 0)); // pilar B de la doble cabina
    // caja de carga
    const bedL = cab - 0.1 - rear, bedX = (cab - 0.1 + rear) / 2;
    pg.add(box(bedL, 0.36, 0.1, body, bedX, 1.2, W / 2 - 0.05));
    pg.add(box(bedL, 0.36, 0.1, body, bedX, 1.2, -(W / 2 - 0.05)));
    pg.add(box(0.1, 0.36, W, body, rear + 0.05, 1.2, 0));
    pg.add(box(bedL - 0.1, 0.04, W - 0.2, dark, bedX, 1.04, 0));
    // carga aleatoria
    if (rnd() < 0.6) {
      const crate = mat('#b07a3c');
      pg.add(box(0.6, 0.4, 0.6, crate, bedX - 0.25, 1.26, 0.35));
      if (rnd() < 0.5 && bedL > 1.8) pg.add(box(0.5, 0.32, 0.5, crate, bedX + 0.45, 1.22, -0.4));
    }
    pg.add(box(0.08, 0.32, 1.3, dark, 2.57, 0.92, 0)); // parrilla
    pg.add(box(0.32, 0.18, W + 0.1, trim, 2.48, 0.6, 0));
    pg.add(box(0.2, 0.18, W + 0.1, trim, rear - 0.03, 0.6, 0));
    lights(pg, 2.55, rear - 0.02, 1.0, W / 2, 0.14);
    // estribos y espejos
    for (const z of [W / 2 + 0.08, -(W / 2 + 0.08)]) {
      pg.add(box(design === 1 ? 2.2 : 1.4, 0.06, 0.18, trim, design === 1 ? -0.1 : 0.3, 0.48, z));
      pg.add(box(0.14, 0.12, 0.14, body, 0.85, 1.4, z * 1.02));
    }
    if (design === 2) {
      // defensa delantera, pasos de rueda y amortiguadores a la vista
      const bar = mat('#2a2d31');
      pg.add(box(0.1, 0.5, 1.5, bar, 2.72, 0.8, 0));
      for (const z of [0.55, -0.55]) pg.add(box(0.3, 0.08, 0.08, bar, 2.62, 1.0, z));
      for (const x of [1.6, -1.55]) for (const s of [1, -1]) {
        pg.add(box(1.4, 0.1, 0.24, dark, x, 0.98, s * (W / 2 + 0.06)));
        g.add(box(0.12, 0.45, 0.12, mat('#d6402b'), x + 0.15, 0.75, s * 0.62));
      }
    }
    if (aero >= 0.5 || st.overallTier >= 3 || design === 2) {
      // barra antivuelco con focos
      const bar = mat('#2a2d31');
      const bx = cab - 0.2;
      for (const z of [0.8, -0.8]) pg.add(box(0.08, 0.5, 0.08, bar, bx, 1.45, z));
      pg.add(box(0.08, 0.08, 1.68, bar, bx, 1.7, 0));
      const lamp = mat('#fff6d8', { emissive: '#ffe9a8', emissiveIntensity: 0.9 });
      for (let i = 0; i < 4; i++) pg.add(box(0.1, 0.1, 0.18, lamp, cab + 0.02, 1.95, -0.45 + i * 0.3));
    }
    if (supercharger) pg.add(box(0.55, 0.16, 0.45, dark, 1.8, 1.18, 0));
    exhausts(pg, rear - 0.05, 0.55, Math.min(exCount, 2), 0.7);
    const r = design === 2 ? 0.62 : 0.48, w = design === 2 ? 0.44 : 0.36;
    addWheels(g, { wb: [1.6, design === 1 ? -1.75 : -1.55], track: design === 2 ? 1.02 : 0.9, rf: r, rr: r, wf: w, wr: w }, rimColor);
  } else if (pr.type.id === 'utilitario') {
    if (design === 1) {
      // Microcoche cúbico (kei car): morro corto y techo alto
      const W = 1.55;
      g.add(extrude([[-1.7, 0.3], [1.6, 0.3], [1.7, 0.45], [1.68, 0.78], [1.2, 0.86], [-1.7, 0.88]], W, body));
      g.add(extrude([[-1.66, 0.86], [1.15, 0.86], [0.85, 1.62], [-1.64, 1.62]], W - 0.18, glass));
      g.add(extrude([[-1.7, 1.6], [0.88, 1.6], [0.84, 1.7], [-1.7, 1.7]], W - 0.12, body));
      pillar(-0.3, 1.24, 0.76, W); pillar(-1.62, 1.24, 0.76, W);
      g.add(box(0.05, 0.12, 0.7, dark, 1.69, 0.55, 0));
      g.add(box(0.24, 0.12, W + 0.04, trim, 1.6, 0.33, 0));
      g.add(box(0.24, 0.12, W + 0.04, trim, -1.62, 0.33, 0));
      lights(g, 1.68, -1.72, 0.68, W / 2, 0.14);
      mirrors(0.95, 1.0, W);
      for (const z of [0.5, -0.5]) g.add(box(1.8, 0.04, 0.05, dark, -0.4, 1.73, z));
      hood(1.68, 0.78, 1.2, 0.86, 0.5);
      if (supercharger) g.add(box(0.3, 0.08, 0.3, dark, 1.45, 0.84, 0));
      exhausts(g, -1.72, 0.36, 1, 0.5);
      addWheels(g, { wb: [1.1, -1.1], track: 0.72, rf: 0.29, rr: 0.29, wf: 0.22, wr: 0.22 }, rimColor);
    } else if (design === 2) {
      // Retro: formas redondeadas, faros circulares, cromados y techo bicolor
      const W = 1.62;
      const roofM = mat(isLight(car.color) ? '#24272c' : '#f2efe6', { roughness: 0.45 });
      const chrome = mat('#cfd6dc', { metalness: 0.7, roughness: 0.25 });
      g.add(extrude([[-1.6, 0.3], [1.55, 0.3], [1.68, 0.42], [1.7, 0.62], [1.5, 0.78], [0.75, 0.86], [-1.45, 0.88], [-1.66, 0.78], [-1.7, 0.5]], W, body));
      g.add(extrude([[-1.5, 0.86], [0.7, 0.86], [0.25, 1.3], [-1.15, 1.32], [-1.55, 1.0]], W - 0.2, glass));
      g.add(extrude([[-1.18, 1.3], [0.28, 1.3], [0.22, 1.4], [-1.12, 1.42]], W - 0.14, roofM));
      pillar(-0.45, 1.08, 0.46, W, roofM);
      for (const z of [0.55, -0.55]) {
        const hl = cyl(0.12, 0.12, 0.08, 12, headMat()); hl.rotation.z = Math.PI / 2; hl.position.set(1.66, 0.64, z); g.add(hl);
        const ring = cyl(0.14, 0.14, 0.06, 12, chrome); ring.rotation.z = Math.PI / 2; ring.position.set(1.64, 0.64, z); g.add(ring);
        g.add(box(0.06, 0.14, 0.14, tailMat(), -1.68, 0.66, z));
      }
      g.add(box(0.12, 0.08, W + 0.06, chrome, 1.66, 0.36, 0));
      g.add(box(0.12, 0.08, W + 0.06, chrome, -1.69, 0.36, 0));
      g.add(box(0.04, 0.06, 0.5, chrome, 1.7, 0.5, 0));
      mirrors(0.6, 0.98, W, chrome);
      hood(1.5, 0.78, 0.75, 0.86, 0.6);
      if (aero >= 0.5) g.add(box(0.26, 0.05, W - 0.3, roofM, -1.12, 1.44, 0));
      if (supercharger) g.add(box(0.36, 0.08, 0.3, dark, 1.15, 0.86, 0));
      exhausts(g, -1.72, 0.36, 1, 0.5);
      addWheels(g, { wb: [1.05, -1.0], track: 0.75, rf: 0.29, rr: 0.29, wf: 0.22, wr: 0.22 }, rimColor);
    } else {
      const W = 1.6;
      g.add(extrude([[-1.8, 0.3], [1.7, 0.3], [1.82, 0.5], [1.78, 0.7], [0.8, 0.82], [-1.7, 0.86], [-1.82, 0.6]], W, body));
      g.add(extrude([[-1.7, 0.84], [0.75, 0.84], [0.1, 1.38], [-1.2, 1.38], [-1.72, 1.0]], W - 0.2, glass));
      g.add(extrude([[-1.22, 1.36], [0.12, 1.36], [0.08, 1.44], [-1.2, 1.44]], W - 0.16, body));
      g.add(box(0.1, 0.5, W - 0.17, body, -0.45, 1.1, 0));
      g.add(box(0.05, 0.14, 0.8, dark, 1.8, 0.5, 0));
      g.add(box(0.26, 0.12, W + 0.04, trim, 1.65, 0.33, 0));
      g.add(box(0.26, 0.12, W + 0.04, trim, -1.7, 0.33, 0));
      lights(g, 1.79, -1.82, 0.66, W / 2);
      mirrors(0.55, 1.0, W);
      if (aero >= 0.5) g.add(box(0.3, 0.05, W - 0.2, dark, -1.75, 1.0, 0));
      if (supercharger) g.add(box(0.4, 0.1, 0.36, dark, 1.2, 0.8, 0));
      stripe = [1.25, 0.775, -0.122, 1.2, 0.16];
      exhausts(g, -1.84, 0.36, 1, 0.5);
      addWheels(g, { wb: [1.05, -1.05], track: 0.74, rf: 0.3, rr: 0.3, wf: 0.22, wr: 0.22 }, rimColor);
    }
  } else if (pr.type.id === 'furgoneta') {
    if (design === 1) {
      // Monovolumen: un solo volumen con ventanas corridas
      const W = 1.9;
      g.add(extrude([[-2.4, 0.4], [2.3, 0.4], [2.42, 0.65], [2.38, 0.95], [1.6, 1.15], [-2.4, 1.15]], W, body));
      g.add(extrude([[-2.36, 1.13], [1.6, 1.13], [0.9, 1.72], [-2.34, 1.72]], W - 0.16, glass));
      g.add(extrude([[-2.42, 1.7], [0.92, 1.7], [0.62, 1.95], [-2.4, 1.95]], W - 0.04, body));
      for (const x of [0.62, -0.5, -1.5, -2.3]) pillar(x, 1.42, 0.6, W + 0.02);
      for (const s of [1, -1]) {
        g.add(box(4.6, 0.08, 0.02, trim, 0, 0.95, s * (W / 2 + 0.005)));
        g.add(box(1.5, 0.04, 0.03, dark, -0.5, 1.72, s * (W / 2 + 0.01))); // guía de puerta corredera
      }
      if (rnd() < 0.5) for (const z of [0.6, -0.6]) g.add(box(2.6, 0.06, 0.06, dark, -0.9, 2.0, z));
      g.add(box(0.06, 0.22, 1.1, dark, 2.41, 0.78, 0));
      g.add(box(0.3, 0.16, W + 0.06, trim, 2.3, 0.52, 0));
      g.add(box(0.2, 0.16, W + 0.06, trim, -2.42, 0.52, 0));
      lights(g, 2.39, -2.42, 0.88, W / 2, 0.12);
      mirrors(1.4, 1.25, W);
      if (supercharger) g.add(box(0.5, 0.12, 0.4, dark, 2.0, 1.02, 0));
      exhausts(g, -2.43, 0.5, 1, 0.7);
      addWheels(g, { wb: [1.55, -1.5], track: 0.85, rf: 0.4, rr: 0.4, wf: 0.28, wr: 0.28 }, rimColor);
    } else if (design === 2) {
      // Camión de reparto: cabina con deflector y caja de carga separada
      const W = 2.0;
      const cargo = mat('#ecebe6', { roughness: 0.7 });
      g.add(box(4.6, 0.18, 1.0, dark, -0.05, 0.55, 0)); // bastidor
      g.add(extrude([[0.4, 0.45], [2.3, 0.45], [2.42, 0.75], [2.38, 1.15], [1.9, 1.3], [0.4, 1.3]], W, body));
      g.add(extrude([[0.5, 1.28], [1.92, 1.28], [1.6, 1.95], [0.5, 1.95]], W - 0.2, glass));
      g.add(extrude([[0.45, 1.93], [1.62, 1.93], [1.55, 2.05], [0.45, 2.05]], W - 0.1, body));
      g.add(extrude([[0.45, 2.04], [1.45, 2.04], [0.45, 2.6]], W - 0.3, body)); // deflector
      pillar(0.5, 1.62, 0.66, W);
      g.add(box(2.85, 2.1, W + 0.1, cargo, -1.05, 1.62, 0));
      g.add(box(2.87, 0.28, W + 0.12, body, -1.05, 1.15, 0));
      g.add(box(0.02, 1.9, 0.04, dark, -2.485, 1.62, 0)); // puertas traseras
      for (const s of [1, -1]) {
        g.add(box(0.06, 0.24, 0.1, trim, 1.75, 1.55, s * (W / 2 + 0.08)));
        g.add(box(0.04, 0.4, 0.06, trim, 1.75, 1.75, s * (W / 2 + 0.12)));
      }
      g.add(box(0.06, 0.3, 1.2, dark, 2.41, 0.85, 0));
      g.add(box(0.3, 0.18, W + 0.06, trim, 2.3, 0.55, 0));
      lights(g, 2.4, -2.49, 1.0, W / 2, 0.12);
      if (supercharger) g.add(box(0.5, 0.12, 0.4, dark, 1.95, 1.2, 0));
      exhausts(g, -2.5, 0.5, 1, 0.7);
      addWheels(g, { wb: [1.7, -1.45], track: 0.88, rf: 0.42, rr: 0.42, wf: 0.3, wr: 0.38 }, rimColor);
    } else {
      const W = 1.9;
      g.add(extrude([[-2.4, 0.4], [2.25, 0.4], [2.35, 0.7], [2.3, 1.05], [1.35, 1.2], [-2.4, 1.2]], W, body));
      g.add(box(3.1, 1.1, W, body, -0.85, 1.75, 0));
      g.add(extrude([[0.7, 1.2], [1.38, 1.2], [0.95, 1.85], [0.7, 1.85]], W - 0.2, glass));
      g.add(box(0.03, 0.9, W - 0.1, dark, -2.4, 1.75, 0));
      g.add(box(0.06, 0.3, 1.2, dark, 2.34, 0.82, 0));
      g.add(box(0.3, 0.16, W + 0.06, trim, 2.25, 0.55, 0));
      g.add(box(0.2, 0.16, W + 0.06, trim, -2.42, 0.55, 0));
      lights(g, 2.33, -2.42, 0.95, W / 2, 0.12);
      for (const z of [W / 2 + 0.07, -(W / 2 + 0.07)]) g.add(box(0.12, 0.1, 0.12, body, 1.2, 1.5, z));
      if (supercharger) g.add(box(0.5, 0.14, 0.4, dark, 1.8, 1.1, 0));
      exhausts(g, -2.43, 0.5, 1, 0.7);
      addWheels(g, { wb: [1.5, -1.5], track: 0.85, rf: 0.4, rr: 0.4, wf: 0.28, wr: 0.28 }, rimColor);
    }
  } else if (pr.type.id === 'suv') {
    if (design === 1) {
      // Todoterreno clásico: caja cuadrada, rueda de repuesto, snorkel y defensa
      const W = 1.92;
      g.add(extrude([[-2.1, 0.5], [2.0, 0.5], [2.08, 0.7], [2.06, 1.15], [1.0, 1.2], [-2.1, 1.2]], W, body));
      g.add(extrude([[-2.05, 1.18], [1.0, 1.18], [0.85, 1.85], [-2.03, 1.85]], W - 0.18, glass));
      g.add(extrude([[-2.1, 1.83], [0.88, 1.83], [0.86, 1.93], [-2.1, 1.93]], W - 0.1, body));
      for (const x of [-0.35, -1.3, -2.02]) pillar(x, 1.52, 0.66, W);
      for (const x of [1.4, -1.35]) for (const s of [1, -1]) g.add(box(1.1, 0.12, 0.16, dark, x, 1.0, s * (W / 2 + 0.05)));
      const spare = wheel(0.4, 0.24, rimColor); spare.rotation.y = Math.PI / 2; spare.position.set(-2.24, 1.2, 0); g.add(spare);
      g.add(box(0.1, 0.8, 0.1, dark, 1.05, 1.55, W / 2 + 0.07)); // snorkel
      g.add(box(0.2, 0.1, 0.1, dark, 1.12, 1.98, W / 2 + 0.07));
      const bar = mat('#2a2d31');
      g.add(box(0.1, 0.4, 1.6, bar, 2.18, 0.8, 0));
      for (const z of [0.5, -0.5]) g.add(box(0.2, 0.06, 0.06, bar, 2.1, 1.0, z));
      g.add(box(2.4, 0.08, 1.5, bar, -0.6, 2.0, 0)); // baca
      if (rnd() < 0.5) g.add(box(0.8, 0.3, 0.9, mat('#6d6a5c'), -1.0, 2.19, 0));
      g.add(box(0.06, 0.26, 1.1, dark, 2.08, 0.95, 0));
      g.add(box(0.2, 0.16, W + 0.04, trim, -2.12, 0.6, 0));
      lights(g, 2.07, -2.12, 1.02, W / 2, 0.14);
      mirrors(0.85, 1.4, W);
      if (supercharger) g.add(box(0.5, 0.14, 0.4, dark, 1.5, 1.24, 0));
      exhausts(g, -2.15, 0.55, Math.min(exCount, 2), 0.6);
      addWheels(g, { wb: [1.4, -1.35], track: 0.9, rf: 0.46, rr: 0.46, wf: 0.34, wr: 0.34 }, rimColor);
    } else if (design === 2) {
      // SUV coupé: caída de techo deportiva
      const W = 1.95;
      g.add(extrude([[-2.2, 0.42], [2.1, 0.42], [2.22, 0.62], [2.18, 0.98], [1.0, 1.1], [-2.15, 1.06], [-2.25, 0.75]], W, body));
      g.add(extrude([[-1.95, 1.06], [1.0, 1.08], [0.35, 1.66], [-0.6, 1.68], [-1.95, 1.2]], W - 0.2, glass));
      g.add(extrude([[-0.62, 1.66], [0.38, 1.66], [0.33, 1.75], [-0.6, 1.75]], W - 0.16, body));
      pillar(-0.35, 1.38, 0.6, W);
      g.add(box(0.25, 0.05, W - 0.2, aero >= 0.75 ? dark : body, -1.98, 1.22, 0));
      g.add(box(3.8, 0.1, W + 0.04, trim, 0, 0.46, 0));
      g.add(box(0.06, 0.26, 1.2, dark, 2.2, 0.8, 0));
      g.add(box(0.3, 0.14, W + 0.06, trim, 2.1, 0.52, 0));
      g.add(box(0.3, 0.14, W + 0.06, trim, -2.2, 0.52, 0));
      lights(g, 2.2, -2.24, 0.88, W / 2, 0.1);
      mirrors(0.85, 1.32, W);
      hood(2.18, 0.98, 1.0, 1.1, 1.0);
      if (supercharger) g.add(box(0.5, 0.14, 0.4, dark, 1.5, 1.12, 0));
      exhausts(g, -2.24, 0.5, Math.max(2, Math.min(exCount, 4)), 0.6);
      addWheels(g, { wb: [1.45, -1.4], track: 0.9, rf: 0.44, rr: 0.44, wf: 0.32, wr: 0.34 }, rimColor);
    } else {
      const W = 1.9;
      g.add(extrude([[-2.2, 0.42], [2.1, 0.42], [2.22, 0.62], [2.18, 0.98], [1.0, 1.1], [-2.2, 1.12]], W, body));
      g.add(extrude([[-2.12, 1.08], [1.0, 1.08], [0.4, 1.72], [-1.95, 1.72]], W - 0.2, glass));
      g.add(extrude([[-2.0, 1.7], [0.42, 1.7], [0.38, 1.8], [-1.98, 1.8]], W - 0.16, body));
      g.add(box(0.12, 0.62, W - 0.17, body, -0.6, 1.4, 0));
      for (const z of [0.6, -0.6]) g.add(box(2.2, 0.05, 0.05, dark, -0.8, 1.85, z));
      g.add(box(3.8, 0.1, W + 0.04, trim, 0, 0.46, 0));
      g.add(box(0.06, 0.26, 1.2, dark, 2.2, 0.8, 0));
      g.add(box(0.3, 0.14, W + 0.06, trim, 2.1, 0.52, 0));
      g.add(box(0.3, 0.14, W + 0.06, trim, -2.2, 0.52, 0));
      lights(g, 2.2, -2.22, 0.88, W / 2, 0.12);
      for (const z of [W / 2 + 0.06, -(W / 2 + 0.06)]) g.add(box(0.12, 0.1, 0.12, body, 0.85, 1.35, z));
      if (supercharger) g.add(box(0.5, 0.14, 0.4, dark, 1.5, 1.12, 0));
      exhausts(g, -2.22, 0.5, Math.min(exCount, 2), 0.6);
      addWheels(g, { wb: [1.45, -1.4], track: 0.88, rf: 0.44, rr: 0.44, wf: 0.32, wr: 0.32 }, rimColor);
    }
  } else if (pr.type.id === 'coupe') {
    if (design === 1) {
      // Muscle car: capó larguísimo con toma de aire y zaga truncada
      const W = 1.9;
      g.add(extrude([[-2.3, 0.32], [2.3, 0.32], [2.4, 0.5], [2.36, 0.78], [0.55, 0.86], [-1.6, 0.9], [-2.28, 0.9], [-2.36, 0.55]], W, body));
      g.add(extrude([[-1.55, 0.88], [0.5, 0.85], [-0.1, 1.3], [-0.9, 1.32], [-1.6, 0.95]], W - 0.22, glass));
      g.add(extrude([[-0.92, 1.3], [-0.08, 1.3], [-0.12, 1.38], [-0.9, 1.38]], W - 0.18, body));
      g.add(extrude([[1.0, 0.82], [1.7, 0.8], [1.6, 0.94], [1.1, 0.96]], 0.36, supercharger ? dark : body)); // toma del capó
      g.add(box(0.04, 0.08, 0.3, dark, 1.61, 0.88, 0));
      g.add(box(0.22, 0.06, W - 0.1, aero >= 0.75 ? dark : body, -2.2, 0.95, 0));
      g.add(box(0.05, 0.2, 1.5, dark, 2.39, 0.62, 0));
      g.add(box(0.06, 0.1, W - 0.4, tailMat(), -2.37, 0.72, 0)); // piloto corrido
      g.add(box(0.3, 0.1, W + 0.04, trim, 2.24, 0.36, 0));
      g.add(box(0.3, 0.1, W + 0.04, trim, -2.25, 0.36, 0));
      lights(g, 2.39, -2.37, 0.62, W / 2, 0.1);
      mirrors(0.4, 0.98, W);
      hood(2.36, 0.78, 0.55, 0.86, 1.6, 0.42);
      exhausts(g, -2.38, 0.38, 2, 0.6);
      addWheels(g, { wb: [1.5, -1.45], track: 0.86, rf: 0.38, rr: 0.4, wf: 0.28, wr: 0.34 }, rimColor);
    } else if (design === 2) {
      // Descapotable: sin techo, asientos a la vista y jorobas tras los reposacabezas
      const W = 1.82;
      const leather = mat('#5a3424', { roughness: 0.8 });
      g.add(extrude([[-2.2, 0.3], [2.15, 0.3], [2.3, 0.46], [2.24, 0.64], [0.75, 0.8], [-1.7, 0.84], [-2.2, 0.8], [-2.28, 0.5]], W, body));
      g.add(extrude([[0.72, 0.8], [0.84, 0.8], [0.36, 1.18], [0.27, 1.18]], W - 0.3, glass));
      g.add(box(0.08, 0.05, W - 0.28, dark, 0.31, 1.19, 0));
      g.add(box(1.6, 0.03, W - 0.32, mat('#1a1b1e'), -0.4, 0.83, 0));
      for (const z of [0.38, -0.38]) {
        g.add(box(0.5, 0.12, 0.42, leather, -0.5, 0.9, z));
        const back = box(0.12, 0.5, 0.42, leather, -0.78, 1.1, z); back.rotation.z = 0.2; g.add(back);
        g.add(box(0.6, 0.16, 0.34, body, -1.25, 0.9, z)); // joroba
      }
      const sw = cyl(0.15, 0.15, 0.04, 10, dark); sw.rotation.z = Math.PI / 2 - 0.45; sw.position.set(0.15, 1.0, 0.38); g.add(sw);
      g.add(box(0.05, 0.14, 1.0, dark, 2.29, 0.48, 0));
      g.add(box(0.3, 0.1, W + 0.04, trim, 2.14, 0.33, 0));
      g.add(box(0.3, 0.1, W + 0.04, trim, -2.18, 0.33, 0));
      lights(g, 2.27, -2.28, 0.6, W / 2, 0.08);
      mirrors(0.55, 0.92, W);
      if (aero >= 0.5) g.add(box(0.26, 0.05, W - 0.2, aero >= 0.75 ? dark : body, -2.08, 0.86, 0));
      hood(2.24, 0.64, 0.75, 0.8);
      if (supercharger) g.add(box(0.5, 0.1, 0.4, dark, 1.4, 0.76, 0));
      exhausts(g, -2.3, 0.36, 2, 0.55);
      addWheels(g, { wb: [1.45, -1.4], track: 0.84, rf: 0.36, rr: 0.37, wf: 0.27, wr: 0.3 }, rimColor);
    } else {
      const W = 1.85;
      g.add(extrude([[-2.25, 0.3], [2.2, 0.3], [2.34, 0.48], [2.26, 0.66], [1.0, 0.82], [-1.6, 0.86], [-2.24, 0.8], [-2.32, 0.52]], W, body));
      g.add(extrude([[-1.45, 0.84], [0.7, 0.8], [0.05, 1.28], [-0.85, 1.3], [-1.55, 0.92]], W - 0.22, glass));
      g.add(extrude([[-0.88, 1.27], [0.08, 1.27], [0.04, 1.35], [-0.86, 1.35]], W - 0.18, body));
      g.add(box(0.05, 0.14, 1.0, dark, 2.33, 0.5, 0));
      g.add(box(0.3, 0.1, W + 0.04, trim, 2.14, 0.33, 0));
      g.add(box(0.3, 0.1, W + 0.04, trim, -2.2, 0.33, 0));
      lights(g, 2.3, -2.32, 0.62, W / 2, 0.08);
      for (const z of [W / 2 + 0.06, -(W / 2 + 0.06)]) g.add(box(0.12, 0.08, 0.12, body, 0.6, 0.98, z));
      if (aero >= 0.5) g.add(box(0.3, 0.05, W - 0.15, aero >= 0.75 ? dark : body, -2.2, 0.92, 0));
      if (supercharger) g.add(box(0.5, 0.1, 0.4, dark, 1.4, 0.8, 0));
      stripe = [1.6, 0.755, -0.127, 1.2, 0.16];
      exhausts(g, -2.33, 0.36, 2, 0.55);
      addWheels(g, { wb: [1.45, -1.45], track: 0.85, rf: 0.37, rr: 0.38, wf: 0.28, wr: 0.3 }, rimColor);
    }
  } else if (pr.type.id === 'deportivo') {
    const W = 1.95;
    if (design === 1) {
      // Cuña de motor central: perfil anguloso y rejillas sobre el motor
      g.add(extrude([[-2.2, 0.26], [2.2, 0.26], [2.3, 0.34], [0.8, 0.66], [-1.6, 0.86], [-2.2, 0.86], [-2.26, 0.5]], W, body));
      g.add(extrude([[-1.2, 0.83], [0.8, 0.66], [0.1, 1.02], [-0.7, 1.04]], W - 0.55, glass));
      for (let i = 0; i < 5; i++) g.add(box(0.05, 0.03, 1.1, dark, -1.7 - i * 0.1, 0.875, 0));
      for (const s of [1, -1]) {
        const vent = extrude([[-1.3, 0.4], [-0.5, 0.4], [-0.6, 0.7]], 0.04, dark); vent.position.z = s * (W / 2 + 0.01); g.add(vent);
      }
      g.add(box(0.35, 0.04, W + 0.02, dark, 2.1, 0.27, 0));
      lights(g, 2.22, -2.24, 0.42, W / 2, 0.05);
      g.add(box(0.06, 0.08, W - 0.3, tailMat(), -2.23, 0.7, 0));
      if (aero >= 0.5) wing(-1.95, 0.86, 0.26, 0.45, W);
      hood(2.3, 0.34, 0.8, 0.66);
      if (turboCount >= 3 || supercharger) g.add(box(0.4, 0.08, 0.5, dark, -1.2, 0.9, 0));
      exhausts(g, -2.27, 0.42, Math.min(exCount, 4), 0.45);
      addWheels(g, { wb: [1.4, -1.35], track: 0.88, rf: 0.35, rr: 0.39, wf: 0.29, wr: 0.36 }, rimColor);
    } else if (design === 2) {
      // Gran turismo de motor delantero: capó largo, cabina retrasada y branquias laterales
      g.add(extrude([[-2.25, 0.28], [2.25, 0.28], [2.4, 0.4], [2.3, 0.58], [0.3, 0.78], [-1.5, 0.86], [-2.2, 0.82], [-2.3, 0.5]], W, body));
      g.add(extrude([[-1.45, 0.84], [0.25, 0.78], [-0.35, 1.14], [-1.0, 1.16], [-1.62, 0.88]], W - 0.3, glass));
      g.add(extrude([[-1.02, 1.14], [-0.33, 1.14], [-0.37, 1.21], [-1.0, 1.21]], W - 0.26, body));
      for (const s of [1, -1]) for (let i = 0; i < 3; i++) g.add(box(0.05, 0.16, 0.02, dark, 0.75 + i * 0.12, 0.52, s * (W / 2 + 0.005)));
      const bulge = box(1.4, 0.06, 0.6, body, 1.3, 0.69, 0); bulge.rotation.z = Math.atan2(-0.2, 2.0); g.add(bulge);
      g.add(box(0.05, 0.12, 1.2, dark, 2.38, 0.45, 0));
      g.add(box(0.4, 0.04, W + 0.04, dark, 2.2, 0.29, 0));
      g.add(box(0.2, 0.05, W - 0.2, aero >= 0.75 ? dark : body, -2.12, 0.86, 0));
      lights(g, 2.33, -2.3, 0.54, W / 2, 0.07);
      mirrors(0.15, 0.92, W);
      hood(2.3, 0.58, 0.3, 0.78, 1.4, 0.4);
      if (turboCount >= 3 || supercharger) g.add(box(0.4, 0.06, 0.4, dark, 1.6, 0.66, 0));
      exhausts(g, -2.31, 0.38, Math.max(2, Math.min(exCount, 4)), 0.55);
      addWheels(g, { wb: [1.5, -1.4], track: 0.88, rf: 0.36, rr: 0.39, wf: 0.29, wr: 0.35 }, rimColor);
    } else {
      g.add(extrude([[-2.2, 0.26], [2.15, 0.26], [2.32, 0.36], [2.2, 0.5], [0.9, 0.68], [-1.5, 0.84], [-2.2, 0.84], [-2.28, 0.5]], W, body));
      g.add(extrude([[-0.9, 0.68], [0.9, 0.62], [0.2, 1.06], [-0.5, 1.1], [-1.2, 0.84]], W - 0.5, glass));
      for (const s of [1, -1]) g.add(box(0.7, 0.18, 0.06, dark, -0.9, 0.55, s * (W / 2 + 0.01)));
      g.add(box(0.4, 0.04, W + 0.04, dark, 2.1, 0.27, 0));
      lights(g, 2.28, -2.28, 0.58, W / 2, 0.07);
      if (aero >= 0.5) wing(-2.0, 0.84, 0.2, 0.4, W - 0.1);
      if (turboCount >= 3 || supercharger) g.add(box(0.5, 0.06, 0.5, dark, -1.4, 0.86, 0));
      stripe = [1.55, 0.6, -0.138, 1.2, 0.16];
      exhausts(g, -2.3, 0.45, Math.min(exCount, 3), 0.4);
      addWheels(g, { wb: [1.4, -1.35], track: 0.88, rf: 0.35, rr: 0.39, wf: 0.29, wr: 0.35 }, rimColor);
    }
  } else {
    // Bólido
    const W = 2.0;
    const rearWing = (x, baseY, span) => {
      const wingH = 0.25 + aero * 0.6;
      const wingW = 0.35 + aero * 0.35;
      for (const z of [0.4, -0.4]) g.add(box(0.1, wingH, 0.06, dark, x + 0.05, baseY + wingH / 2, z));
      g.add(box(wingW, 0.06, span, aero >= 0.75 ? dark : body, x, baseY + wingH, 0));
      for (const z of [span / 2, -span / 2]) g.add(box(wingW + 0.1, 0.22, 0.03, dark, x, baseY - 0.05 + wingH, z));
    };
    if (design === 1) {
      // Prototipo de resistencia: cabina burbuja, aletas sobre las ruedas y aleta de tiburón
      g.add(extrude([[-2.4, 0.22], [2.3, 0.22], [2.45, 0.3], [2.35, 0.42], [1.3, 0.55], [0.6, 0.5], [-1.6, 0.62], [-2.4, 0.62]], W, body));
      for (const s of [1, -1]) {
        const ff = extrude([[0.9, 0.4], [2.1, 0.4], [1.85, 0.8], [1.1, 0.82]], 0.42, body); ff.position.z = s * 0.72; g.add(ff);
        const rf = extrude([[-2.1, 0.4], [-0.8, 0.4], [-1.05, 0.86], [-1.85, 0.86]], 0.46, body); rf.position.z = s * 0.72; g.add(rf);
        g.add(box(0.3, 0.12, 0.05, dark, 0.45, 0.45, s * (W / 2 - 0.1)));
      }
      g.add(extrude([[-0.9, 0.55], [0.75, 0.5], [0.1, 1.0], [-0.6, 1.04], [-1.3, 0.66]], W - 1.05, glass));
      g.add(extrude([[-0.55, 1.02], [-2.2, 0.62], [-2.2, 1.15], [-1.4, 1.08]], 0.04, body)); // aleta de tiburón
      g.add(box(0.5, 0.05, W + 0.1, dark, 2.2, 0.23, 0));
      lights(g, 2.4, -2.4, 0.5, W / 2 - 0.05, 0.06);
      for (let i = 0; i < 5; i++) g.add(box(0.4, 0.16, 0.03, dark, -2.25, 0.3, -0.6 + i * 0.3));
      rearWing(-2.1, 0.62, W - 0.05);
      exhausts(g, -2.42, 0.48, Math.min(exCount, 2), 0.25);
      addWheels(g, { wb: [1.5, -1.45], track: 0.88, rf: 0.36, rr: 0.4, wf: 0.3, wr: 0.38 }, rimColor);
    } else if (design === 2) {
      // Monoplaza de ruedas descubiertas: morro afilado, pontones, halo y alerones
      const BW = 0.72;
      const helmet = mat(isLight(car.color) ? '#24272c' : '#f2efe6', { roughness: 0.3, metalness: 0.2 });
      g.add(extrude([[-2.0, 0.18], [2.5, 0.18], [2.6, 0.26], [1.0, 0.48], [0.1, 0.6], [-0.3, 0.76], [-1.5, 0.7], [-2.0, 0.5]], BW, body));
      for (const s of [1, -1]) {
        const pod = extrude([[-1.6, 0.2], [0.4, 0.2], [0.2, 0.55], [-1.4, 0.5]], 0.4, body); pod.position.z = s * 0.55; g.add(pod);
        g.add(box(0.05, 0.25, 0.3, dark, 0.38, 0.38, s * 0.55));
        // brazos de suspensión
        for (const x of [1.75, -1.35]) for (const y of [0.3, 0.42]) g.add(box(0.04, 0.03, 0.75, dark, x, y, s * 0.62));
      }
      g.add(box(0.75, 0.03, 0.46, mat('#111214'), -0.05, 0.61, 0)); // hueco del piloto
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), helmet); head.position.set(-0.2, 0.8, 0); g.add(head);
      g.add(box(0.04, 0.05, 0.3, mat('#203546'), -0.06, 0.82, 0)); // visera
      g.add(box(0.06, 0.3, 0.06, dark, 0.32, 0.75, 0)); // halo
      for (const z of [0.24, -0.24]) g.add(box(0.7, 0.05, 0.05, dark, -0.05, 0.92, z));
      g.add(box(0.05, 0.05, 0.5, dark, 0.3, 0.92, 0));
      g.add(extrude([[-0.45, 0.76], [-0.3, 1.02], [-0.7, 1.06], [-1.5, 0.72]], 0.3, body)); // toma de aire
      g.add(box(0.5, 0.04, 2.0, dark, 2.4, 0.2, 0)); // alerón delantero
      g.add(box(0.35, 0.03, 1.9, aero >= 0.75 ? dark : body, 2.3, 0.27, 0));
      for (const z of [1.0, -1.0]) g.add(box(0.55, 0.2, 0.03, dark, 2.38, 0.27, z));
      g.add(box(0.05, 0.1, 0.12, tailMat(), -2.02, 0.42, 0)); // luz de lluvia
      rearWing(-1.95, 0.7, 1.5);
      exhausts(g, -2.05, 0.56, 1, 0);
      addWheels(g, { wb: [1.75, -1.35], track: 1.0, rf: 0.36, rr: 0.4, wf: 0.32, wr: 0.42 }, rimColor);
    } else {
      g.add(extrude([[-2.3, 0.24], [2.25, 0.24], [2.42, 0.32], [2.3, 0.42], [1.1, 0.62], [-1.45, 0.78], [-2.28, 0.8], [-2.36, 0.48]], W, body));
      g.add(extrude([[-1.0, 0.7], [0.95, 0.58], [0.05, 1.04], [-0.75, 1.07], [-1.4, 0.82]], W - 0.7, glass));
      // pontones laterales
      for (const s of [1, -1]) {
        const pod = extrude([[-1.6, 0.3], [0.7, 0.3], [0.35, 0.66], [-1.5, 0.76]], 0.24, body);
        pod.position.z = s * (W / 2 - 0.02); g.add(pod);
        g.add(box(0.5, 0.2, 0.05, dark, 0.1, 0.5, s * (W / 2 + 0.11)));
      }
      g.add(box(0.5, 0.05, W + 0.1, dark, 2.18, 0.25, 0)); // splitter
      g.add(box(0.08, 0.06, W - 0.4, dark, 2.38, 0.33, 0));
      lights(g, 2.32, -2.36, 0.55, W / 2, 0.06);
      // difusor
      for (let i = 0; i < 4; i++) g.add(box(0.4, 0.14, 0.03, dark, -2.2, 0.3, -0.45 + i * 0.3));
      // alerón trasero según aerodinámica
      const wingH = 0.25 + aero * 0.6;
      const wingW = 0.35 + aero * 0.35;
      for (const z of [0.55, -0.55]) g.add(box(0.1, wingH, 0.06, dark, -2.0, 0.8 + wingH / 2, z));
      g.add(box(wingW, 0.06, W - 0.05, aero >= 0.75 ? dark : body, -2.05, 0.8 + wingH, 0));
      for (const z of [W / 2 - 0.05, -(W / 2 - 0.05)]) g.add(box(wingW + 0.1, 0.22, 0.03, dark, -2.05, 0.75 + wingH, z));
      // toma de aire superior
      g.add(box(0.5, 0.14, 0.32, dark, -0.95, 1.08, 0));
      stripe = [1.55, 0.53, -0.17, 1.2, 0.16];
      exhausts(g, -2.38, 0.5, Math.min(exCount + (turboCount >= 3 ? 1 : 0), 4), 0.35);
      addWheels(g, { wb: [1.45, -1.4], track: 0.9, rf: 0.36, rr: 0.4, wf: 0.3, wr: 0.38 }, rimColor);
    }
    if (turboCount >= 3 || supercharger) for (const s of [1, -1]) g.add(box(0.6, 0.06, 0.25, dark, -1.65, design === 2 ? 0.74 : 0.81, s * 0.5));
  }

  // franja de rareza en el capó para coches especiales
  if (st.overallTier >= 3 && stripe) {
    const stripeM = mat(legendary ? '#ffb627' : '#f5f1e8', { roughness: 0.5 });
    const [sx, y, rot, len, sz] = stripe;
    const s1 = box(len, 0.02, 0.16, stripeM, sx, y, sz); s1.rotation.z = rot;
    const s2 = s1.clone(); s2.position.z = -sz;
    g.add(s1, s2);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---------- Escena ----------
export class Showroom {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#2b2d32');
    scene.fog = new THREE.Fog('#2b2d32', 70, 140);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    camera.position.set(9.6, 4.4, 10.2);
    this.camera = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0.7, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 22;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.enablePan = false;
    this.controls = controls;


    scene.add(new THREE.HemisphereLight('#e8eef5', '#5a564f', 1.5));
    const sun = new THREE.DirectionalLight('#fff4e2', 2.0);
    sun.position.set(-8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -10; sc.right = 10; sc.top = 10; sc.bottom = -10; sc.near = 1; sc.far = 40;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    const rim = new THREE.DirectionalLight('#9fc4ff', 0.6);
    rim.position.set(8, 4, -8);
    scene.add(rim);

    this.buildWorld();

    this.turntable = new THREE.Group();
    scene.add(this.turntable);
    this.carHolder = new THREE.Group();
    this.turntable.add(this.carHolder);
    this.car = null;
    this.dropAnim = null;
    this.spinning = false;
    this.particles = [];
    this.autoRotate = true;
    this.clock = new THREE.Clock();
    this.time = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
  }

  buildWorld() {
    const scene = this.scene;
    const r = mulberry32(77);
    // ===== Interior de la fábrica: nave de montaje =====
    const R = 32, H = 16;
    const env = new THREE.Group();
    const steel = mat('#9aa1ab', { roughness: 0.5, metalness: 0.3 }), dark = mat('#2b2f35'), orange = mat('#ff6a1a', { roughness: 0.5 });
    const yellow = mat('#ffb627', { roughness: 0.7 });
    const glassM = new THREE.MeshStandardMaterial({ color: '#8cc3d9', emissive: '#3b7fa0', emissiveIntensity: 0.7, roughness: 0.2, flatShading: true });
    const lampM = new THREE.MeshStandardMaterial({ color: '#fff6df', emissive: '#fff0c8', emissiveIntensity: 1.4 });

    // Suelo de resina con juntas y líneas de seguridad
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R).rotateX(-Math.PI / 2), mat('#6d7077', { roughness: 0.35, metalness: 0.12 }));
    floor.receiveShadow = true; scene.add(floor);
    const joint = mat('#585b61');
    for (let i = -3; i <= 3; i++) { env.add(box(2 * R, 0.01, 0.08, joint, 0, 0.01, i * 8)); env.add(box(0.08, 0.01, 2 * R, joint, i * 8, 0.01, 0)); }
    for (const s of [-1, 1]) { env.add(box(2 * R - 4, 0.02, 0.3, yellow, 0, 0.02, s * (R - 2))); env.add(box(0.3, 0.02, 2 * R - 4, yellow, s * (R - 2), 0.02, 0)); }
    const hazard = new THREE.Mesh(new THREE.RingGeometry(14.6, 15, 48).rotateX(-Math.PI / 2), yellow);
    hazard.position.y = 0.04; env.add(hazard);

    // Paredes con zócalo, franja naranja, ventanales altos y pilastras
    const wallM = mat('#cbc7bb', { roughness: 1 }), dado = mat('#454b53'), pil = mat('#aeb0b3');
    const wall = (x, z, ry) => {
      const g = new THREE.Group();
      g.add(box(2 * R, H, 0.6, wallM, 0, H / 2, 0));
      g.add(box(2 * R, 3, 0.7, dado, 0, 1.5, 0.05));
      g.add(box(2 * R, 0.35, 0.72, orange, 0, 3.2, 0.06));
      for (let i = -R + 5; i < R - 2; i += 8) g.add(box(5.5, 2.4, 0.1, glassM, i, 12, 0.32));
      for (let i = -R; i <= R; i += 16) g.add(box(1, H, 1.2, pil, i, H / 2, 0.5));
      g.position.set(x, 0, z); g.rotation.y = ry; env.add(g);
    };
    wall(0, -R, 0); wall(0, R, Math.PI); wall(-R, 0, Math.PI / 2); wall(R, 0, -Math.PI / 2);

    // Techo con cerchas y lámparas
    env.add(box(2 * R + 1, 0.5, 2 * R + 1, mat('#2f3238'), 0, H + 0.25, 0));
    for (let i = -3; i <= 3; i++) env.add(box(0.6, 0.9, 2 * R, steel, i * 9, H - 0.5, 0));
    for (let j = -2; j <= 2; j++) env.add(box(2 * R, 0.6, 0.5, steel, 0, H - 0.4, j * 14));
    for (const x of [-18, -6, 6, 18]) for (const z of [-20, -7, 7, 20]) {
      const rod = cyl(0.04, 0.04, 1.6, 4, dark); rod.position.set(x, H - 1.3, z); env.add(rod);
      env.add(box(2.6, 0.22, 0.9, lampM, x, H - 2.2, z));
    }

    // Plataforma / podio
    const plat = cyl(4.2, 4.5, 0.35, 18, mat('#e9e1d2', { roughness: 0.9 }));
    plat.position.y = -0.14; plat.receiveShadow = true; scene.add(plat);
    this.platformTop = cyl(3.9, 3.9, 0.06, 18, mat('#d8cfbd', { roughness: 0.8 }));
    this.platformTop.position.y = 0.06; this.platformTop.receiveShadow = true; scene.add(this.platformTop);
    this.ringMat = new THREE.MeshStandardMaterial({ color: '#ff6a1a', emissive: '#ff6a1a', emissiveIntensity: 0.6, flatShading: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.0, 0.06, 4, 36), this.ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; scene.add(ring);
    this.ring = ring;

    // ---- Equipamiento del taller ----
    const rand = r;
    const place = (g, x, z, ry = 0) => { g.position.set(x, 0, z); g.rotation.y = ry; env.add(g); return g; };
    const spec = (typeId, color, i) => buildCar({ typeId, engineId: 'e9', intakeId: 'i4', turboId: 't0', tractionId: 'TT', aeroId: 'a50', perf: 90, color, seed: 21 + i });

    // Línea de montaje con coches que avanzan
    env.add(box(2 * R - 6, 0.5, 5.4, mat('#3a3e45', { roughness: 0.6 }), 0, 0.25, -19));
    for (const s of [-1, 1]) env.add(box(2 * R - 6, 0.08, 0.25, yellow, 0, 0.52, -19 + s * 2.6));
    for (let i = -14; i <= 14; i++) env.add(box(0.28, 0.04, 5, mat('#50555d', { metalness: 0.4 }), i * 2, 0.52, -19));
    this.line = [];
    const lineTypes = ['turismo', 'suv', 'coupe', 'utilitario', 'pickup', 'deportivo'];
    const lineCols = ['#c8483c', '#e8e2d4', '#3f86a8', '#e0b043', '#4f8a6a', '#8a95a3'];
    for (let i = 0; i < 6; i++) { const c = spec(lineTypes[i], lineCols[i], i); c.position.set(-26 + i * 9.4, 0.56, -19); env.add(c); this.line.push(c); }

    // Brazos robóticos sobre la línea
    this.robots = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const base = cyl(1, 1.25, 0.6, 10, steel); base.position.y = 0.3; g.add(base);
      const turret = new THREE.Group(); turret.position.y = 0.6; g.add(turret);
      const col = cyl(0.75, 0.75, 1.2, 10, orange); col.position.y = 0.6; turret.add(col);
      const lower = new THREE.Group(); lower.position.y = 1.2; turret.add(lower);
      lower.add(box(0.5, 3.2, 0.5, orange, 0, 1.6, 0));
      const upper = new THREE.Group(); upper.position.y = 3.2; lower.add(upper);
      upper.add(box(0.4, 2.8, 0.4, orange, 0, 1.4, 0));
      upper.add(box(0.55, 0.5, 0.9, dark, 0, 2.9, 0.1));
      place(g, -22.5 + i * 9, -24.2); this.robots.push({ turret, lower, upper });
    }

    // Puente grúa
    const crane = new THREE.Group();
    for (const s of [-1, 1]) env.add(box(0.5, 0.6, 2 * R - 2, yellow, s * 27, 13, 0));
    crane.add(box(55, 0.9, 1.1, yellow, 0, 13, 0));
    crane.add(box(1.6, 0.7, 1.6, dark, 4, 12.4, 0));
    const cable = cyl(0.05, 0.05, 6, 4, dark); cable.position.set(4, 9, 0); crane.add(cable);
    crane.add(box(0.7, 0.8, 0.7, orange, 4, 5.8, 0));
    crane.position.z = -6; env.add(crane); this.crane = crane;

    // Elevadores con coches en revisión (pared izquierda)
    [['pickup', '#e0b043', -9], ['coupe', '#c8483c', 3], ['suv', '#3f86a8', 15]].forEach(([t, col, z], i) => {
      const g = new THREE.Group();
      for (const s of [-1, 1]) { g.add(box(0.45, 4.2, 0.55, orange, s * 1.7, 2.1, 0)); g.add(box(0.3, 0.2, 4.2, steel, s * 0.8, 1.55, 0)); }
      g.add(box(3.9, 0.3, 0.6, dark, 0, 4.3, 0));
      const c = spec(t, col, 10 + i); c.rotation.y = Math.PI / 2; c.position.y = 1.7; g.add(c);
      g.add(box(4, 0.02, 7, yellow, 0, 0.03, 0).translateY(0));
      place(g, -24.5, z);
    });

    // Bancos de trabajo con cajas de herramientas y motores (pared derecha)
    const bench = () => {
      const g = new THREE.Group();
      g.add(box(4, 0.15, 1.4, mat('#a9835a'), 0, 1, 0));
      for (const sx of [-1.8, 1.8]) for (const sz of [-0.55, 0.55]) g.add(box(0.12, 1, 0.12, dark, sx, 0.5, sz));
      g.add(box(1.3, 0.95, 0.9, mat('#c8483c'), -1.2, 0.48, 0));
      for (let n = 0; n < 3; n++) g.add(box(1.25, 0.05, 0.02, dark, -1.2, 0.25 + n * 0.3, 0.46));
      g.add(box(1.1, 0.5, 0.55, mat('#8a8f98'), 0.9, 1.35, 0));
      for (let n = 0; n < 4; n++) { const p = cyl(0.12, 0.12, 0.3, 6, mat('#5d636c')); p.position.set(0.55 + n * 0.33, 1.75, 0); g.add(p); }
      return g;
    };
    for (let i = 0; i < 5; i++) place(bench(), R - 2.2, -13 + i * 9, -Math.PI / 2);

    // Túneles industriales en los extremos de la línea: los coches entran por una
    // puerta oscura (montaje) y salen por otra, en lugar de atravesar la pared.
    const tunnel = (cx, dir) => {
      const g = new THREE.Group();
      const W = 6, D = 5, H = 7.5;
      g.add(box(W, H, D, steel, 0, H / 2, 0));                      // cuerpo
      g.add(box(W, 0.45, D + 0.15, orange, 0, 0.35, 0));            // zócalo de seguridad
      g.add(box(W, 0.3, D + 0.15, orange, 0, H - 1.5, 0));         // franja alta
      g.add(box(0.3, H - 1.5, D - 1.2, dark, dir * (W / 2), H / 2 - 0.2, 0)); // portal oscuro
      for (const s of [-1, 1]) g.add(box(0.45, H - 1.3, 0.45, yellow, dir * (W / 2), (H - 1.5) / 2 + 0.6, s * ((D - 1.2) / 2))); // jambas
      g.add(box(0.45, 0.45, D - 0.6, yellow, dir * (W / 2), H - 0.85, 0)); // dintel
      g.add(box(W - 0.8, 0.3, 1.6, glassM, 0, H + 0.15, 0));       // lucernario
      g.position.set(cx, 0, -19);
      env.add(g);
    };
    tunnel(-29, 1); // entrada de montaje: el portal mira hacia la nave
    tunnel(29, -1); // bahía de salida

    // Estanterías con piezas (pared frontal)
    const boxCols = ['#b88a55', '#c9a46a', '#7f8791', '#3f6e9a'];
    const rack = () => {
      const g = new THREE.Group(), blue = mat('#2f5f9a');
      for (const sx of [-1.8, 1.8]) for (const sz of [-0.55, 0.55]) g.add(box(0.15, 5, 0.15, blue, sx, 2.5, sz));
      for (let s = 0; s < 3; s++) {
        g.add(box(3.8, 0.1, 1.3, orange, 0, 0.6 + s * 1.7, 0));
        for (let n = 0; n < 3; n++) { const h = 0.8 + rand() * 0.3; g.add(box(0.7 + rand() * 0.4, h, 0.8, mat(boxCols[Math.floor(rand() * boxCols.length)]), -1.2 + n * 1.2, 0.65 + s * 1.7 + h / 2, 0)); }
      }
      return g;
    };
    for (let i = 0; i < 5; i++) place(rack(), -20 + i * 9, R - 1.6, Math.PI);

    // Cartel y portón en la pared del fondo
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 160;
    const cx = cv.getContext('2d'); cx.fillStyle = '#1d1a17'; cx.fillRect(0, 0, 1024, 160);
    cx.fillStyle = '#ff6a1a'; cx.fillRect(0, 0, 1024, 12); cx.fillRect(0, 148, 1024, 12);
    cx.fillStyle = '#f6f0e6'; cx.font = '700 92px "Clash Display", "Segoe UI", sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText('RULETA MOTORS', 512, 84);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.4), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(-6, 9.2, -R + 0.42); env.add(sign);
    env.add(box(22.6, 4, 0.3, dark, -6, 9.2, -R + 0.3));
    env.add(box(9, 8, 0.2, mat('#8a96a3', { metalness: 0.3 }), 21, 4, -R + 0.45));
    for (let n = 0; n < 8; n++) env.add(box(9, 0.06, 0.05, dark, 21, 0.5 + n, -R + 0.58));

    // el fondo no proyecta sombras (solo el coche y la plataforma)
    env.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    scene.add(env);
    this.clouds = [];
  }

  resize() {
    const c = this.canvas;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    if (this._w === w && this._h === h) return;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // en pantallas estrechas alejar la cámara
    const narrow = w / h < 0.9;
    this.camera.fov = narrow ? 44 : 38;
    if (narrow !== this._narrow) {
      this._narrow = narrow;
      this.camera.position.set(...(narrow ? [7.4, 3.9, 7.9] : [9.6, 4.4, 10.2]));
      if (this.controls) this.controls.target.set(0, narrow ? 0.4 : 0.7, 0);
    }
    this.camera.updateProjectionMatrix();
  }

  setFocusOffset(px) {
    // desplaza el encuadre para dejar sitio al panel lateral
    this.camera.setViewOffset(this._w, this._h, px, 0, this._w, this._h);
    this.camera.updateProjectionMatrix();
  }

  // Refleja las mejoras de fábrica compradas en la nave (más maquinaria, oficinas,
  // centro de pruebas, división de competición...). Estilo low-poly, poco coste.
  setFactoryVisuals(factory) {
    if (this.factoryExtras) {
      this.scene.remove(this.factoryExtras);
      this.factoryExtras.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      this.factoryExtras = null;
    }
    const lvl = (id) => (factory && factory.upgrades && factory.upgrades[id]) || 0;
    const g = new THREE.Group();
    const steel = mat('#9aa1ab', { roughness: 0.5, metalness: 0.3 });
    const dark = mat('#2b2f35'), orange = mat('#ff6a1a', { roughness: 0.5 });
    const white = mat('#e9e1d2', { roughness: 0.9 });
    const glassW = new THREE.MeshStandardMaterial({ color: '#8cc3d9', emissive: '#3b7fa0', emissiveIntensity: 0.5, roughness: 0.2, flatShading: true });

    if (lvl('u_rd')) {
      // Oficina de I+D con ventanal
      const o = new THREE.Group();
      o.add(box(7, 3.6, 5, white, 0, 1.8, 0));
      o.add(box(7.1, 1.4, 0.2, glassW, 0, 2.6, 2.55));
      o.add(box(7.2, 0.25, 5.2, dark, 0, 3.75, 0));
      o.add(box(0.15, 3.6, 0.15, steel, -3.2, 1.8, 2.6));
      o.add(box(0.15, 3.6, 0.15, steel, 3.2, 1.8, 2.6));
      o.position.set(-24, 0, 21); g.add(o);
    }
    if (lvl('u_qc')) {
      // Cabina de control de calidad con toldo a rayas
      const q = new THREE.Group();
      q.add(box(3, 2.6, 3, white, 0, 1.3, 0));
      q.add(box(3.6, 0.18, 0.5, orange, 0, 2.75, 1.4));
      q.add(box(3.6, 0.18, 0.5, white, 0, 2.75, 0.6));
      q.add(box(0.8, 0.9, 0.15, glassW, 0, 1.7, 1.53));
      q.position.set(-14, 0, 23); g.add(q);
    }
    if (lvl('u_test')) {
      // Banco de pruebas (rodillos) con marco
      const t = new THREE.Group();
      for (const s of [-1.4, 1.4]) t.add(box(0.35, 2.2, 0.35, steel, s, 1.1, 0));
      t.add(box(3.6, 0.3, 1.2, dark, 0, 2.3, 0));
      for (const x of [-0.9, 0.9]) { const r = cyl(0.5, 0.5, 0.5, 12, steel); r.rotation.z = Math.PI / 2; r.position.set(x, 0.5, 0); t.add(r); }
      t.add(box(3.4, 0.06, 2.2, mat('#3a3e45'), 0, 0.05, 0));
      t.position.set(-3, 0, 23); g.add(t);
    }
    if (lvl('u_race')) {
      // Podio de la división de competición con un bólido de exhibición
      const p = new THREE.Group();
      p.add(cyl(2.6, 2.9, 0.5, 14, white));
      p.add(cyl(2.2, 2.2, 0.08, 14, orange)); p.children[1].position.y = 0.54;
      const c = buildCar({ typeId: 'bolido', engineId: 'e13', intakeId: 'i12', turboId: 't2', tractionId: 'AWD', aeroId: 'a75', perf: 118, color: '#d6402b', seed: 99 });
      c.position.y = 0.58; c.rotation.y = -0.6; p.add(c);
      p.position.set(11, 0, 21); g.add(p);
    }
    // Un módulo de línea extra por cada 3 ampliaciones (de cualquier chasis), máximo 4.
    const lineUps = Object.entries((factory && factory.upgrades) || {}).filter(([k]) => k.startsWith('u_lines')).reduce((s, [, v]) => s + v, 0);
    const lines = Math.min(4, Math.ceil(lineUps / 3));
    for (let i = 0; i < lines; i++) {
      // Módulos de línea extra: brazo robot y estación de trabajo
      const m = new THREE.Group();
      const base = cyl(0.9, 1.1, 0.5, 10, steel); base.position.y = 0.25; m.add(base);
      m.add(box(0.4, 2.6, 0.4, orange, 0, 1.6, 0));
      m.add(box(0.9, 0.3, 0.7, dark, 0, 3.0, 0));
      m.add(box(2.6, 1.2, 1.2, white, 2.4, 0.6, 0));
      m.add(box(2.7, 0.1, 1.3, dark, 2.4, 1.25, 0));
      m.position.set(24, 0, 6 - i * 7); g.add(m);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    this.factoryExtras = g;
    this.scene.add(g);
  }

  clearCar() {
    if (this.car) {
      this.carHolder.remove(this.car);
      this.car.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      this.car = null;
    }
  }

  showCar(car, animate = false) {
    this.clearCar();
    if (!car) return;
    this.car = buildCar(car);
    this.carHolder.add(this.car);
    if (animate) {
      this.dropAnim = { t: 0 };
      this.car.position.y = 5;
    } else {
      this.dropAnim = null;
      this.car.position.y = 0;
    }
  }

  _ensureGhosts() {
    if (this.ghosts) return;
    // siluetas en alambre: alternan mientras gira el chasis y se queda fija la del chasis elegido
    const wire = new THREE.MeshBasicMaterial({ color: '#ff8a45', wireframe: true, transparent: true, opacity: 0.85 });
    this.ghosts = CAR_TYPES.map((t, i) => {
      const g = buildCar({ typeId: t.id, engineId: 'e9', intakeId: 'i4', turboId: 't0', tractionId: 'TT', aeroId: 'a50', perf: 90, color: '#ffffff', seed: 3 + i });
      g.traverse((o) => { if (o.isMesh) { o.material = wire; o.castShadow = false; } });
      g.visible = false; g.userData.typeId = t.id;
      this.carHolder.add(g);
      return g;
    });
  }

  setSpinning(v) {
    this.spinning = v;
    if (v) this.clearCar();
    this._ensureGhosts();
  }

  // Deja fija la silueta del chasis ya elegido mientras se montan el resto de piezas (null = quitarla).
  setBuildGhost(typeId) {
    this._ensureGhosts();
    this.lockType = typeId || null;
    if (typeId) this.clearCar();
  }

  dust() {
    const m = mat('#efe6d6', { roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const p = new THREE.Mesh(new THREE.TetrahedronGeometry(0.08 + Math.random() * 0.1, 0), m);
      const a = Math.random() * Math.PI * 2;
      p.position.set(Math.cos(a) * 1.8, 0.15, Math.sin(a) * 1.2);
      p.userData.v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), 1 + Math.random() * 1.5, Math.sin(a) * (1 + Math.random() * 2));
      p.userData.life = 0.9;
      this.scene.add(p); this.particles.push(p);
    }
  }

  update(dt) {
    this.time += dt;
    if (this.ghosts) {
      const k = this.spinning && !this.lockType ? Math.floor(this.time * 6) % this.ghosts.length : -1;
      this.ghosts.forEach((g, i) => (g.visible = this.lockType ? g.userData.typeId === this.lockType : i === k));
    }
    const spinSpeed = this.spinning && !this.lockType ? 4.5 : this.spinning || this.lockType ? 0.9 : this.autoRotate ? 0.25 : 0;
    this.turntable.rotation.y += spinSpeed * dt;
    this.platformTop.rotation.y = this.turntable.rotation.y;
    this.ringMat.emissiveIntensity = this.spinning ? 1.2 + Math.sin(this.time * 18) * 0.8 : 0.5 + Math.sin(this.time * 2) * 0.15;
    if (this.dropAnim && this.car) {
      const a = this.dropAnim; a.t += dt;
      const t = Math.min(1, a.t / 0.7);
      // caída con rebote
      const bounce = (x) => { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375; return n * (x -= 2.625 / d) * x + 0.984375; };
      this.car.position.y = 5 * (1 - bounce(t));
      if (!a.dusted && t > 0.36) { a.dusted = true; this.dust(); }
      if (t >= 1) { this.car.position.y = 0; this.dropAnim = null; }
    }
    // suspensión leve
    if (this.car && !this.dropAnim) this.car.position.y = Math.sin(this.time * 2.2) * 0.008;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.userData.life -= dt;
      p.userData.v.y -= 4 * dt;
      p.position.addScaledVector(p.userData.v, dt);
      p.scale.setScalar(Math.max(0.01, p.userData.life));
      if (p.userData.life <= 0 || p.position.y < 0) { this.scene.remove(p); p.geometry.dispose(); this.particles.splice(i, 1); }
    }
    for (const c of this.clouds) { c.position.x += dt * 0.6; if (c.position.x > 90) c.position.x = -90; }
    for (const c of this.line) { c.position.x += dt * 0.7; if (c.position.x > 28) c.position.x -= 56; }
    this.robots.forEach((r, i) => {
      const t = this.time * 1.3 + i * 1.1;
      r.turret.rotation.y = Math.sin(t * 0.7) * 0.35;
      r.lower.rotation.x = 0.55 + Math.sin(t) * 0.25;
      r.upper.rotation.x = 1.15 + Math.sin(t * 1.4 + 1) * 0.35;
    });
    this.crane.position.z = -6 + Math.sin(this.time * 0.18) * 16;
    this.controls.update();
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
