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

function lights(group, front, rear, y, halfW, h = 0.1) {
  const head = mat('#fff6d8', { emissive: '#ffe9a8', emissiveIntensity: 1.2 });
  const tail = mat('#ff3b2f', { emissive: '#ff2a1a', emissiveIntensity: 1.1 });
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

  if (pr.type.id === 'turismo') {
    const W = 1.78;
    g.add(extrude([[-2.2, 0.3], [2.12, 0.3], [2.25, 0.5], [2.2, 0.72], [0.95, 0.86], [-1.65, 0.9], [-2.18, 0.86], [-2.26, 0.55]], W, body));
    g.add(extrude([[-1.55, 0.86], [0.92, 0.86], [0.2, 1.36], [-1.05, 1.36], [-1.62, 0.95]], W - 0.2, glass));
    g.add(extrude([[-1.08, 1.34], [0.22, 1.34], [0.16, 1.42], [-1.02, 1.42]], W - 0.16, body));
    g.add(box(0.12, 0.5, W - 0.17, body, -0.35, 1.1, 0)); // pilar B
    g.add(box(0.05, 0.16, 1.0, dark, 2.24, 0.48, 0)); // parrilla
    g.add(box(0.3, 0.12, W + 0.04, trim, 2.05, 0.33, 0)); // paragolpes
    g.add(box(0.3, 0.12, W + 0.04, trim, -2.1, 0.33, 0));
    lights(g, 2.21, -2.24, 0.66, W / 2);
    // espejos
    for (const z of [W / 2 + 0.06, -(W / 2 + 0.06)]) g.add(box(0.12, 0.09, 0.12, body, 0.75, 1.0, z));
    if (aero >= 0.5) {
      const h = aero >= 0.75 ? 0.28 : 0.1;
      for (const z of [0.55, -0.55]) g.add(box(0.08, h, 0.06, dark, -1.95, 0.88 + h / 2, z));
      g.add(box(0.36, 0.05, W - 0.1, aero >= 0.75 ? dark : body, -1.98, 0.9 + h, 0));
    }
    if (supercharger) g.add(box(0.5, 0.12, 0.42, dark, 1.45, 0.84, 0));
    if (turboCount >= 2) for (const z of [W / 2 + 0.005, -(W / 2 + 0.005)]) g.add(box(0.4, 0.08, 0.02, dark, 1.4, 0.55, z));
    exhausts(g, -2.27, 0.36, Math.min(exCount, 2), 0.55);
    addWheels(g, { wb: [1.38, -1.38], track: 0.82, rf: 0.36, rr: 0.36, wf: 0.26, wr: 0.26 }, rimColor);
  } else if (pr.type.id === 'pickup') {
    const W = 1.95;
    g.add(extrude([[-2.55, 0.5], [2.45, 0.5], [2.58, 0.75], [2.52, 1.12], [1.0, 1.22], [-0.35, 1.22], [-0.35, 1.02], [-2.55, 1.02]], W, body));
    g.add(extrude([[-0.35, 1.2], [0.98, 1.2], [0.55, 1.82], [-0.3, 1.82]], W - 0.18, glass));
    g.add(extrude([[-0.33, 1.8], [0.58, 1.8], [0.54, 1.9], [-0.33, 1.9]], W - 0.12, body));
    g.add(box(0.12, 0.62, W - 0.15, body, -0.3, 1.5, 0));
    // caja de carga
    g.add(box(2.15, 0.36, 0.1, body, -1.45, 1.2, W / 2 - 0.05));
    g.add(box(2.15, 0.36, 0.1, body, -1.45, 1.2, -(W / 2 - 0.05)));
    g.add(box(0.1, 0.36, W, body, -2.5, 1.2, 0));
    g.add(box(2.05, 0.04, W - 0.2, dark, -1.45, 1.04, 0));
    // carga aleatoria
    if (rnd() < 0.6) {
      const crate = mat('#b07a3c');
      g.add(box(0.6, 0.4, 0.6, crate, -1.7, 1.26, 0.35));
      if (rnd() < 0.5) g.add(box(0.5, 0.32, 0.5, crate, -1.0, 1.22, -0.4));
    }
    g.add(box(0.08, 0.32, 1.3, dark, 2.57, 0.92, 0)); // parrilla
    g.add(box(0.32, 0.18, W + 0.1, trim, 2.48, 0.6, 0));
    g.add(box(0.2, 0.18, W + 0.1, trim, -2.58, 0.6, 0));
    lights(g, 2.55, -2.57, 1.0, W / 2, 0.14);
    // estribos
    for (const z of [W / 2 + 0.08, -(W / 2 + 0.08)]) {
      g.add(box(1.4, 0.06, 0.18, trim, 0.3, 0.48, z));
      g.add(box(0.14, 0.12, 0.14, body, 0.85, 1.4, z * 1.02));
    }
    if (aero >= 0.5 || st.overallTier >= 3) {
      // barra antivuelco con focos
      const bar = mat('#2a2d31');
      for (const z of [0.8, -0.8]) g.add(box(0.08, 0.5, 0.08, bar, -0.55, 1.45, z));
      g.add(box(0.08, 0.08, 1.68, bar, -0.55, 1.7, 0));
      const lamp = mat('#fff6d8', { emissive: '#ffe9a8', emissiveIntensity: 0.9 });
      for (let i = 0; i < 4; i++) g.add(box(0.1, 0.1, 0.18, lamp, -0.33, 1.95, -0.45 + i * 0.3));
    }
    if (supercharger) g.add(box(0.55, 0.16, 0.45, dark, 1.8, 1.18, 0));
    exhausts(g, -2.6, 0.55, Math.min(exCount, 2), 0.7);
    addWheels(g, { wb: [1.6, -1.55], track: 0.9, rf: 0.48, rr: 0.48, wf: 0.36, wr: 0.36 }, rimColor);
  } else if (pr.type.id === 'utilitario') {
    const W = 1.6;
    g.add(extrude([[-1.8, 0.3], [1.7, 0.3], [1.82, 0.5], [1.78, 0.7], [0.8, 0.82], [-1.7, 0.86], [-1.82, 0.6]], W, body));
    g.add(extrude([[-1.7, 0.84], [0.75, 0.84], [0.1, 1.38], [-1.2, 1.38], [-1.72, 1.0]], W - 0.2, glass));
    g.add(extrude([[-1.22, 1.36], [0.12, 1.36], [0.08, 1.44], [-1.2, 1.44]], W - 0.16, body));
    g.add(box(0.1, 0.5, W - 0.17, body, -0.45, 1.1, 0));
    g.add(box(0.05, 0.14, 0.8, dark, 1.8, 0.5, 0));
    g.add(box(0.26, 0.12, W + 0.04, trim, 1.65, 0.33, 0));
    g.add(box(0.26, 0.12, W + 0.04, trim, -1.7, 0.33, 0));
    lights(g, 1.79, -1.82, 0.66, W / 2);
    for (const z of [W / 2 + 0.06, -(W / 2 + 0.06)]) g.add(box(0.12, 0.09, 0.12, body, 0.55, 1.0, z));
    if (aero >= 0.5) g.add(box(0.3, 0.05, W - 0.2, dark, -1.75, 1.0, 0));
    if (supercharger) g.add(box(0.4, 0.1, 0.36, dark, 1.2, 0.8, 0));
    exhausts(g, -1.84, 0.36, 1, 0.5);
    addWheels(g, { wb: [1.05, -1.05], track: 0.74, rf: 0.3, rr: 0.3, wf: 0.22, wr: 0.22 }, rimColor);
  } else if (pr.type.id === 'furgoneta') {
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
  } else if (pr.type.id === 'suv') {
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
  } else if (pr.type.id === 'coupe') {
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
    exhausts(g, -2.33, 0.36, 2, 0.55);
    addWheels(g, { wb: [1.45, -1.45], track: 0.85, rf: 0.37, rr: 0.38, wf: 0.28, wr: 0.3 }, rimColor);
  } else if (pr.type.id === 'deportivo') {
    const W = 1.95;
    g.add(extrude([[-2.2, 0.26], [2.15, 0.26], [2.32, 0.36], [2.2, 0.5], [0.9, 0.68], [-1.5, 0.84], [-2.2, 0.84], [-2.28, 0.5]], W, body));
    g.add(extrude([[-0.9, 0.68], [0.9, 0.62], [0.2, 1.06], [-0.5, 1.1], [-1.2, 0.84]], W - 0.5, glass));
    for (const s of [1, -1]) g.add(box(0.7, 0.18, 0.06, dark, -0.9, 0.55, s * (W / 2 + 0.01)));
    g.add(box(0.4, 0.04, W + 0.04, dark, 2.1, 0.27, 0));
    lights(g, 2.28, -2.28, 0.58, W / 2, 0.07);
    if (aero >= 0.5) {
      for (const z of [0.5, -0.5]) g.add(box(0.08, 0.2, 0.05, dark, -2.0, 0.94, z));
      g.add(box(0.4, 0.05, W - 0.2, aero >= 0.75 ? dark : body, -2.02, 1.05, 0));
    }
    if (turboCount >= 3 || supercharger) g.add(box(0.5, 0.06, 0.5, dark, -1.4, 0.86, 0));
    exhausts(g, -2.3, 0.45, Math.min(exCount, 3), 0.4);
    addWheels(g, { wb: [1.4, -1.35], track: 0.88, rf: 0.35, rr: 0.39, wf: 0.29, wr: 0.35 }, rimColor);
  } else {
    // Bólido
    const W = 2.0;
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
    if (turboCount >= 3 || supercharger) for (const s of [1, -1]) g.add(box(0.6, 0.06, 0.25, dark, -1.65, 0.81, s * 0.5));
    exhausts(g, -2.38, 0.5, Math.min(exCount + (turboCount >= 3 ? 1 : 0), 4), 0.35);
    addWheels(g, { wb: [1.45, -1.4], track: 0.9, rf: 0.36, rr: 0.4, wf: 0.3, wr: 0.38 }, rimColor);
  }

  // franja de rareza en el capó para coches especiales
  const STRIPE = { utilitario: [1.25, 0.775, -0.122], turismo: [1.55, 0.795, -0.11], coupe: [1.6, 0.755, -0.127], deportivo: [1.55, 0.6, -0.138], bolido: [1.55, 0.53, -0.17] };
  if (st.overallTier >= 3 && STRIPE[pr.type.id]) {
    const stripe = mat(legendary ? '#ffb627' : '#f5f1e8', { roughness: 0.5 });
    const [sx, y, rot] = STRIPE[pr.type.id];
    const s1 = box(1.2, 0.02, 0.16, stripe, sx, y, 0.16); s1.rotation.z = rot;
    const s2 = s1.clone(); s2.position.z = -0.16;
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
    for (let i = 0; i < 6; i++) place(bench(), R - 2.2, -22 + i * 9, -Math.PI / 2);

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
