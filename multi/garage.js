// Taller: nave alrededor del banco de motores, con elevador de dos columnas, grúa puente,
// carro de piezas y decoración (herramientas, neumáticos, bidones, rótulo de neón).
import * as THREE from 'three';
import { mat, box, cyl, tween, ease } from './engine3d.js';

export const LIFT_X = -11.5;         // centro del elevador
export const PAD_LOW = 0.42;         // altura de los tacos con el elevador abajo
export const PAD_HIGH = 1.55;        // altura de los tacos con el coche levantado
export const BEAM_Y = 8.8;           // carril de la grúa
export const CART = new THREE.Vector3(-14.8, 0, -4.2);
// Cada prueba tiene su zona: el túnel en el banco central y el resto en la fila delantera.
// La presentación vuelve a la plataforma central y el informe se imprime en la mesa del fondo.
export const STATIONS = {
  tunnel: { x: -19, z: 11.5 },
  paint: { x: -2, z: 11.5 },
  qc: { x: 8, z: 11.5 },
  dyno: { x: 18, z: 11.5 },
  stage: { x: 0, z: 0 },
  desk: { x: 10, z: -9.6 },
};
const FLOOR_Y = -0.02;

function at(m, x, y, z) { m.position.set(x, y, z); return m; }
function neonTexture() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 192;
  const c = cv.getContext('2d');
  c.fillStyle = '#16120f'; c.fillRect(0, 0, 1024, 192);
  c.strokeStyle = '#ff6a1a'; c.lineWidth = 7;
  c.beginPath(); c.arc(96, 96, 56, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(96, 96); c.lineTo(132, 60); c.stroke();
  c.shadowColor = '#ff6a1a'; c.shadowBlur = 24;
  c.fillStyle = '#ffd7bd';
  c.font = '700 96px "Clash Display", "Satoshi", sans-serif';
  c.fillText('RULETA MOTORS', 186, 130);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildGarage(scene) {
  const g = new THREE.Group();
  scene.add(g);
  const add = (m) => (g.add(m), m);

  // ---------- Suelo de resina con juntas y marcas de bahía ----------
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(62, 40).rotateX(-Math.PI / 2), mat('#5b5e64', { roughness: 0.32, metalness: 0.25 })));
  floor.position.set(0, FLOOR_Y, 5);
  floor.receiveShadow = true;
  const seam = mat('#4a4d52', { roughness: 0.5 });
  for (let x = -28; x <= 28; x += 4) add(at(box(0.04, 0.005, 40, seam), x, FLOOR_Y + 0.004, 5));
  for (let z = -12; z <= 24; z += 4) add(at(box(62, 0.005, 0.04, seam), 0, FLOOR_Y + 0.004, z));
  const yellow = mat('#f2c230', { roughness: 0.7 });
  const bx0 = LIFT_X - 3.8, bx1 = LIFT_X + 3.8, bz = 3.1;
  add(at(box(bx1 - bx0, 0.01, 0.14, yellow), LIFT_X, FLOOR_Y + 0.008, bz));
  add(at(box(bx1 - bx0, 0.01, 0.14, yellow), LIFT_X, FLOOR_Y + 0.008, -bz));
  add(at(box(0.14, 0.01, 2 * bz, yellow), bx0, FLOOR_Y + 0.008, 0));
  // franjas de peligro en la entrada de la bahía
  const dark = mat('#26282c');
  for (let i = 0; i < 12; i++) {
    const s = add(at(box(0.18, 0.012, 0.9, i % 2 ? dark : yellow), bx1 - 0.2, FLOOR_Y + 0.01, -2.6 + i * 0.47));
    s.rotation.y = 0.5;
  }

  // ---------- Paredes ----------
  const wallM = mat('#c9c7c0', { roughness: 0.95 }), dado = mat('#3f444b'), orange = mat('#ff6a1a', { roughness: 0.6 });
  const H = 10;
  // Pared del fondo (z = -12) y lateral izquierda (x = -28)
  add(at(box(56, H, 0.4, wallM), 0, H / 2, -12.2));
  add(at(box(56, 1.4, 0.45, dado), 0, 0.7, -12.15));
  add(at(box(56, 0.25, 0.47, orange), 0, 1.5, -12.14));
  add(at(box(0.4, H, 38, wallM), -28.2, H / 2, 7));
  add(at(box(0.45, 1.4, 38, dado), -28.15, 0.7, 7));
  add(at(box(0.47, 0.25, 38, orange), -28.14, 1.5, 7));
  // Pared derecha: plano de una cara (si la cámara queda detrás, no tapa)
  const right = add(new THREE.Mesh(new THREE.PlaneGeometry(38, H), mat('#c9c7c0', { roughness: 0.95 })));
  right.rotation.y = -Math.PI / 2; right.position.set(28, H / 2, 7);
  // Pilastras y ventanales altos
  const pil = mat('#a9aaac');
  const glassM = new THREE.MeshStandardMaterial({ color: '#9cc8e0', emissive: '#5f9ec0', emissiveIntensity: 0.9, roughness: 0.2, flatShading: true });
  for (let x = -26; x <= 27; x += 6.5) add(at(box(0.6, H, 0.3, pil), x, H / 2, -11.9));
  for (let x = -22.75; x <= 24; x += 6.5) if (Math.abs(x - LIFT_X) > 3.5) {
    add(at(box(4.6, 2.2, 0.12, glassM), x, 7.4, -11.95));
    for (let k = -1; k <= 1; k++) add(at(box(0.08, 2.2, 0.16, dado), x + k * 1.55, 7.4, -11.9));
  }
  for (let z = -8; z <= 22; z += 6) add(at(box(0.12, 2.2, 4.4, glassM), -27.95, 7.4, z));

  // Portón seccional detrás del elevador
  const doorM1 = mat('#d9dcdf', { roughness: 0.5, metalness: 0.3 }), doorM2 = mat('#b9bdc2', { roughness: 0.5, metalness: 0.3 });
  add(at(box(7.0, 5.8, 0.3, dado), LIFT_X, 2.9, -11.9));
  for (let i = 0; i < 14; i++) add(at(box(6.4, 0.38, 0.1, i % 2 ? doorM1 : doorM2), LIFT_X, 0.2 + i * 0.39, -11.72));
  for (let k = -2; k <= 2; k++) add(at(box(1.0, 0.3, 0.12, glassM), LIFT_X + k * 1.25, 4.0, -11.66));
  // Rótulo de neón sobre el portón
  const neon = add(new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2), new THREE.MeshBasicMaterial({ map: neonTexture(), toneMapped: false })));
  neon.position.set(LIFT_X, 6.6, -11.68);
  document.fonts && document.fonts.ready.then(() => { neon.material.map = neonTexture(); neon.material.needsUpdate = true; });

  // ---------- Banco de herramientas con panel perforado ----------
  const red = mat('#c8302a', { roughness: 0.45, metalness: 0.25 }), steel = mat('#b8bec5', { roughness: 0.3, metalness: 0.7 });
  const wood = mat('#8a6a46', { roughness: 0.85 });
  const benchX = -2.5;
  add(at(box(5.2, 0.12, 1.1, wood), benchX, 1.0, -11.3));
  for (const x of [-2.4, 2.4]) add(at(box(0.12, 1.0, 1.0, dado), benchX + x, 0.5, -11.3));
  add(at(box(5.2, 0.08, 1.0, dado), benchX, 0.25, -11.3));
  const peg = add(at(box(5.2, 2.6, 0.06, mat('#e8e4da', { roughness: 0.9 })), benchX, 2.75, -11.92));
  const tool = mat('#2b2e33', { roughness: 0.5, metalness: 0.4 });
  for (let i = 0; i < 9; i++) { // llaves de mayor a menor
    const len = 0.7 - i * 0.05;
    const w = add(at(box(0.06, len, 0.03, steel), benchX - 2.1 + i * 0.22, 3.3 - (0.7 - len) / 2, -11.86));
    add(at(new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 10), steel), w.position.x, w.position.y + len / 2, -11.86));
  }
  for (let i = 0; i < 6; i++) { // destornilladores
    add(at(cyl(0.035, 0.035, 0.22, 8, i % 2 ? red : orange), benchX + 0.3 + i * 0.22, 3.4, -11.86));
    add(at(cyl(0.01, 0.01, 0.3, 6, steel), benchX + 0.3 + i * 0.22, 3.14, -11.86));
  }
  for (let i = 0; i < 3; i++) { // martillos
    add(at(box(0.05, 0.5, 0.03, wood), benchX + 1.8 + i * 0.25, 2.5, -11.86));
    add(at(box(0.2, 0.08, 0.06, tool), benchX + 1.8 + i * 0.25, 2.78, -11.86));
  }
  add(at(box(0.36, 0.22, 0.3, tool), benchX - 1.9, 1.17, -11.2)); // tornillo de banco
  add(at(box(0.5, 0.06, 0.08, steel), benchX - 1.9, 1.3, -11.0));

  // ---------- Carros de herramientas rojos ----------
  for (const [x, h, w] of [[-19.2, 1.6, 1.8], [-17.0, 1.1, 1.6], [-21.3, 1.1, 1.6]]) {
    add(at(box(w, h, 0.8, red), x, h / 2 + 0.12, -11.4));
    const n = Math.round(h / 0.22);
    for (let i = 0; i < n; i++) {
      add(at(box(w - 0.12, 0.012, 0.02, dado), x, 0.2 + i * (h / n), -10.99));
      add(at(box(w * 0.4, 0.035, 0.05, steel), x, 0.2 + (i + 0.5) * (h / n), -10.98));
    }
    for (const s of [-1, 1]) add(at(cyl(0.07, 0.07, 0.06, 8, dark), x + s * (w / 2 - 0.15), 0.07, -11.1)).rotation.x = Math.PI / 2;
  }

  // ---------- Neumáticos apilados y bidones ----------
  const tire = mat('#1f2124', { roughness: 0.92 }), rim = mat('#8a9097', { metalness: 0.5, roughness: 0.4 });
  for (const [x, z, n] of [[-25.6, -9.4, 5], [-24.2, -9.6, 3], [-25.4, -7.8, 2]]) {
    for (let i = 0; i < n; i++) {
      add(at(cyl(0.42, 0.42, 0.28, 16, tire), x, 0.14 + i * 0.29, z)).rotation.y = i * 0.4;
      add(at(cyl(0.24, 0.24, 0.29, 10, rim), x, 0.14 + i * 0.29, z));
    }
  }
  for (const [x, z, c] of [[-26.9, -3.6, '#2b4c9b'], [-26.9, -2.6, '#2b4c9b'], [-25.9, -3.1, '#d6402b'], [-26.9, 4.5, '#2f8f5b']]) {
    const drum = add(at(cyl(0.38, 0.38, 1.1, 14, mat(c, { roughness: 0.5, metalness: 0.3 })), x, 0.55, z));
    for (const y of [-0.3, 0.3]) drum.add(at(cyl(0.39, 0.39, 0.04, 14, dark), 0, y, 0));
  }
  // Estantería con cajas en la pared izquierda
  const shelfM = mat('#5d636b', { metalness: 0.4, roughness: 0.5 }), cardboard = mat('#b07a3c', { roughness: 0.9 });
  for (const z of [1.2, 6.8]) for (const x of [-27.4, -26.6]) add(at(box(0.08, 4.2, 0.08, shelfM), x, 2.1, z));
  for (const y of [0.4, 1.6, 2.8, 4.0]) {
    add(at(box(1.0, 0.06, 5.7, shelfM), -27.0, y, 4.0));
    for (let i = 0; i < 4; i++) if ((i + y * 3) % 5 > 0.8) add(at(box(0.7, 0.5, 0.9, cardboard), -27.0, y + 0.28, 1.9 + i * 1.35));
  }

  // ---------- Lámparas colgantes ----------
  const shade = mat('#2c3036', { roughness: 0.6, metalness: 0.4 });
  const bulb = new THREE.MeshBasicMaterial({ color: '#fff2d6' });
  for (const [x, z] of [[0, -3], [0, 4], [LIFT_X, -3.5], [LIFT_X, 3.5], [-21, 0], [8, 0], [8, 11.5], [18, 11.5], [-2, 11.5], [-12, 15], [13, 16]]) {
    add(at(cyl(0.015, 0.015, 3, 4, dark), x, 9.6, z));
    add(at(cyl(0.18, 0.75, 0.45, 14, shade), x, 7.9, z));
    add(at(cyl(0.6, 0.6, 0.02, 14, bulb), x, 7.67, z));
    const pl = new THREE.PointLight('#ffe2b8', 9, 16, 1.6);
    pl.position.set(x, 7.4, z);
    g.add(pl);
  }
  // Foco con sombras sobre el elevador y luz fría de los ventanales
  const liftSpot = new THREE.SpotLight('#fff1dc', 240, 40, 0.5, 0.55, 1.6);
  liftSpot.position.set(LIFT_X + 3, 13, 5);
  liftSpot.target.position.set(LIFT_X, 1, 0);
  liftSpot.castShadow = true;
  liftSpot.shadow.mapSize.set(2048, 2048);
  liftSpot.shadow.bias = -0.0004;
  g.add(liftSpot, liftSpot.target);
  const windowLight = new THREE.DirectionalLight('#bfdcff', 0.5);
  windowLight.position.set(-6, 9, -14);
  g.add(windowLight);

  // ---------- Carro de piezas (aquí esperan los turbos mientras viaja el motor) ----------
  const cart = new THREE.Group();
  cart.position.copy(CART);
  cart.add(at(box(1.8, 0.08, 0.9, red), 0, 0.95, 0));
  cart.add(at(box(1.8, 0.08, 0.9, red), 0, 0.35, 0));
  for (const [x, z] of [[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]]) {
    cart.add(at(box(0.05, 0.9, 0.05, steel), x, 0.6, z));
    const w = at(cyl(0.08, 0.08, 0.05, 8, dark), x, 0.08, z); w.rotation.x = Math.PI / 2; cart.add(w);
  }
  cart.add(at(box(0.05, 0.05, 0.9, steel), 1.05, 1.2, 0));
  g.add(cart);

  // ---------- Elevador de dos columnas ----------
  const liftM = mat('#2b4c9b', { roughness: 0.45, metalness: 0.35 });
  const carriageM = mat('#f2c230', { roughness: 0.6 });
  const lift = new THREE.Group();
  lift.position.set(LIFT_X, 0, 0);
  g.add(lift);
  const COL_Z = 1.95, COL_H = 4.6;
  for (const s of [-1, 1]) {
    lift.add(at(box(0.36, COL_H, 0.36, liftM), 0, COL_H / 2, s * COL_Z));
    lift.add(at(box(0.7, 0.08, 0.7, dark), 0, 0.04, s * COL_Z));
    lift.add(at(box(0.06, COL_H - 0.6, 0.04, dark), 0.19, COL_H / 2, s * COL_Z));
  }
  lift.add(at(box(0.3, 0.3, COL_Z * 2 + 0.36, liftM), 0, COL_H + 0.05, 0)); // travesaño superior
  lift.add(at(box(0.2, 0.12, 0.5, orange), 0, COL_H + 0.05, COL_Z + 0.2)); // cuadro de mando
  // Parte móvil: carros, brazos y tacos
  const moving = new THREE.Group();
  lift.add(moving);
  for (const s of [-1, 1]) moving.add(at(box(0.5, 0.6, 0.5, carriageM), 0, -0.1, s * COL_Z));
  // Brazos y tacos: se colocan para cada coche entre sus ruedas (setArms)
  // Cuatro brazos fijos que giran y se alargan (largo 1 escalado) hasta los puntos de apoyo
  const armParts = [];
  for (const s of [-1, 1]) for (let k = 0; k < 2; k++) {
    const arm = box(1, 0.1, 0.16, carriageM), pad = cyl(0.14, 0.14, 0.1, 12, dark);
    moving.add(arm, pad);
    armParts.push({ s, k, arm, pad });
  }
  let arms = { xF: 1.2, xR: -1.2, z: 0.6 };
  const setArms = (xF, xR, pzAbs) => {
    arms = { xF, xR, z: pzAbs };
    for (const { s, k, arm, pad } of armParts) {
      const px = k ? xR : xF, pz = s * pzAbs;
      const dx = px, dz = pz - s * COL_Z;
      arm.scale.x = Math.hypot(dx, dz);
      arm.position.set(dx / 2, -0.12, s * COL_Z + dz / 2);
      arm.rotation.y = -Math.atan2(dz, dx);
      pad.position.set(px, -0.03, pz);
    }
  };
  setArms(1.2, -1.2, 0.6);
  // El coche va dentro de "moving": sus bajos apoyan en los tacos (la altura la ajusta fit()).
  const carHolder = new THREE.Group();
  carHolder.position.set(0, -0.3 + 0.02, 0);
  moving.add(carHolder);
  let padLow = PAD_LOW, padHigh = PAD_HIGH;
  const setPad = (y) => { moving.position.y = y; };
  setPad(PAD_LOW);

  // ---------- Grúa puente para el motor ----------
  const beamM = mat('#3a3f46', { roughness: 0.5, metalness: 0.5 });
  const beamX0 = 2.5, beamX1 = -15;
  const bxm = (beamX0 + beamX1) / 2, bl = beamX0 - beamX1;
  add(at(box(bl, 0.32, 0.08, beamM), bxm, BEAM_Y, 0));
  add(at(box(bl, 0.06, 0.34, beamM), bxm, BEAM_Y + 0.16, 0));
  add(at(box(bl, 0.06, 0.34, beamM), bxm, BEAM_Y - 0.16, 0));
  for (const x of [beamX0 - 0.5, bxm, beamX1 + 0.5]) add(at(box(0.08, 3, 0.08, dark), x, BEAM_Y + 1.6, 0));
  add(at(box(0.2, 0.12, 0.6, orange), beamX0 + 0.1, BEAM_Y, 0));
  add(at(box(0.2, 0.12, 0.6, orange), beamX1 - 0.1, BEAM_Y, 0));
  const trolley = new THREE.Group();
  trolley.add(at(box(0.7, 0.3, 0.5, orange), 0, BEAM_Y - 0.36, 0));
  trolley.add(at(box(0.4, 0.4, 0.4, mat('#ffb627', { roughness: 0.5 })), 0, BEAM_Y - 0.66, 0));
  for (const s of [-1, 1]) trolley.add(at(cyl(0.08, 0.08, 0.06, 10, dark), s * 0.25, BEAM_Y - 0.12, 0.22)).rotation.x = Math.PI / 2;
  g.add(trolley);
  const chainM = mat('#9aa0a6', { metalness: 0.7, roughness: 0.35 });
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6).translate(0, -0.5, 0), chainM);
  chain.position.y = BEAM_Y - 0.86;
  trolley.add(chain);
  const hook = new THREE.Group();
  hook.add(at(box(0.22, 0.26, 0.16, mat('#ffb627', { roughness: 0.5 })), 0, 0.13, 0));
  const hk = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12, Math.PI * 1.4), dark);
  hk.rotation.z = Math.PI * 0.8; hk.position.y = -0.06; hook.add(hk);
  trolley.add(hook);
  const crane = {
    trolley, hook,
    setX(x) { trolley.position.x = x; },
    // y del gancho en coordenadas del mundo (la cadena se estira desde el polipasto)
    setHook(y) {
      const top = BEAM_Y - 0.86;
      const len = Math.max(0.05, top - y);
      chain.scale.y = len;
      hook.position.y = top - len - 0.26;
    },
    hookY() { return hook.position.y + 0.26; },
  };
  crane.setX(0);
  crane.setHook(6.8);

  // ---------- Zonas de pruebas (fila delantera del taller) ----------
  // Rótulo pintado en el suelo de cada zona
  const floorSign = (text, x, z) => {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(0,0,0,0)'; c.fillRect(0, 0, 512, 96);
    c.fillStyle = '#f2c230'; c.font = '700 64px "Clash Display", "Satoshi", sans-serif'; c.textAlign = 'center';
    c.fillText(text, 256, 72);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    m.position.set(x, FLOOR_Y + 0.012, z + 3.0);
    add(m);
    document.fonts && document.fonts.ready.then(() => { c.clearRect(0, 0, 512, 96); c.fillText(text, 256, 72); t.needsUpdate = true; });
  };
  const bayLines = (x, z, w = 7.2, d = 4.6) => {
    for (const s of [-1, 1]) add(at(box(w, 0.01, 0.1, yellow), x, FLOOR_Y + 0.009, z + s * d / 2));
    for (const s of [-1, 1]) add(at(box(0.1, 0.01, d, yellow), x + s * w / 2, FLOOR_Y + 0.009, z));
  };
  for (const [key, label, w, d] of [['tunnel', 'TÚNEL DE VIENTO', 14.6, 7.4], ['paint', 'PINTURA', 7.8, 5.2], ['dyno', 'BANCO DE POTENCIA', 10.8, 4.6], ['qc', 'CONTROL DE CALIDAD', 7.6, 4.6]]) {
    const st = STATIONS[key];
    bayLines(st.x, st.z, w, d);
    floorSign(label, st.x, st.z + d / 2 - 2.3);
  }
  // Estantería de neumáticos junto al elevador (las ruedas se cambian allí)
  {
    const rx = LIFT_X - 6.5, rz = -4.8;
    const rackM = mat('#3a3f46', { metalness: 0.5 });
    for (const x of [-1.6, 1.6]) add(at(box(0.08, 2.2, 0.08, rackM), rx + x, 1.1, rz));
    for (const y of [0.5, 1.3, 2.1]) {
      add(at(box(3.3, 0.06, 0.5, rackM), rx, y, rz));
      for (let i = 0; i < 6; i++) { const t = cyl(0.3, 0.3, 0.22, 14, tire); t.rotation.x = Math.PI / 2; t.position.set(rx - 1.35 + i * 0.54, y + 0.32, rz); add(t); }
    }
    const machine = mat('#d6402b', { roughness: 0.45, metalness: 0.2 });
    add(at(box(0.7, 0.9, 0.6, machine), rx + 3.0, 0.45, rz + 0.2));
    add(at(cyl(0.38, 0.38, 0.12, 18, steel), rx + 3.0, 0.98, rz + 0.2));
  }
  // Banco de potencia: foso con rejilla, consola con monitor y ventilador de refrigeración
  {
    const st = STATIONS.dyno;
    add(at(box(0.9, 1.1, 0.5, dark), st.x - 1.8, 0.55, st.z - 2.9));
    const mon = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ color: '#0d2238' }));
    mon.position.set(st.x - 1.8, 1.45, st.z - 2.64); add(mon);
    add(at(box(0.86, 0.56, 0.06, dark), st.x - 1.8, 1.45, st.z - 2.68));
    for (let i = 0; i < 5; i++) add(at(box(0.6 - i * 0.08, 0.02, 0.01, new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff8a45' : '#7fc4ff' })), st.x - 1.8, 1.3 + i * 0.07, st.z - 2.63));
    const fanG = new THREE.Group();
    fanG.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.08, 10, 30), dark), 0, 0, 0));
    for (let i = 0; i < 5; i++) { const b = box(0.12, 0.62, 0.03, steel); b.rotation.z = (i / 5) * Math.PI * 2; b.position.set(Math.sin((i / 5) * Math.PI * 2) * 0.3, Math.cos((i / 5) * Math.PI * 2) * 0.3, 0); fanG.add(b); }
    fanG.add(at(box(0.12, 0.9, 0.12, dark), 0, -0.85, 0));
    // A un lado (no en el camino hacia la siguiente zona) y apuntando al coche
    fanG.rotation.y = Math.atan2(-3.4, 2.6);
    fanG.position.set(st.x + 3.4, 1.25, st.z - 2.6);
    add(fanG);
  }
  // Calidad: carriles del arco escáner y pantalla de inspección
  {
    const st = STATIONS.qc;
    for (const s of [-1, 1]) add(at(box(7.0, 0.04, 0.16, steel), st.x, 0.02, st.z + s * 1.7));
    add(at(box(0.06, 1.6, 0.06, dark), st.x + 3.2, 0.8, st.z - 2.6));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshBasicMaterial({ color: '#0f3a2c' }));
    scr.position.set(st.x + 3.2, 1.9, st.z - 2.55); add(scr);
    add(at(box(1.16, 0.76, 0.05, dark), st.x + 3.2, 1.9, st.z - 2.6));
  }


  return {
    group: g, crane, carHolder, cart, liftGroup: lift,
    lift: {
      moving,
      set: setPad,
      get low() { return padLow; },
      get high() { return padHigh; },
      // Ajusta brazos y altura al coche: tacos entre las ruedas, apoyados en los bajos, y con el
      // elevador abajo las ruedas tocan el suelo (no se hunden).
      fit({ xF, xR, z, bottom }) {
        // Los brazos giran y se estiran hasta sus puntos de apoyo; los tacos suben a la vez
        const a0 = { ...arms };
        carHolder.position.y = 0.02 - bottom;
        padLow = Math.max(PAD_LOW, bottom - 0.02 - FLOOR_Y);
        padHigh = padLow + (PAD_HIGH - PAD_LOW);
        const y0 = moving.position.y;
        return Promise.all([
          tween(1.1, (t) => setArms(a0.xF + (xF - a0.xF) * t, a0.xR + (xR - a0.xR) * t, a0.z + (z - a0.z) * t), ease.inOutCubic),
          tween(0.9, (t) => setPad(y0 + (padLow - y0) * t), ease.inOutCubic),
        ]);
      },
      raise: (y, dur = 2.4) => { const y0 = moving.position.y; return tween(dur, (t) => setPad(y0 + (y - y0) * t), ease.inOutCubic); },
    },
    reset() {
      setPad(PAD_LOW);
      setArms(1.2, -1.2, 0.6);
      carHolder.position.y = -0.28;
      padLow = PAD_LOW; padHigh = PAD_HIGH;
      crane.setX(0);
      crane.setHook(6.8);
      for (const c of [...carHolder.children]) carHolder.remove(c);
    },
  };
}
