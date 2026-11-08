// Escena 3D de la construcción del motor: plano, bloque, pistones, culatas, admisión y arranque.
// Mismo estilo low poly que car3d.js (MeshStandardMaterial con flatShading).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RARITY } from '../data.js';
import { FAMILIES } from './build.js';

// ---------- Animación ----------
// Todas las animaciones (3D y HUD) pasan por aquí, así "Saltar" solo tiene que subir clock.scale.
const tweens = new Set();
export const clock = { scale: 1 };
export const ease = {
  linear: (x) => x,
  inQuad: (x) => x * x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outBack: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};
export function tween(dur, fn, e = ease.outCubic) {
  return new Promise((res) => {
    fn(e(0));
    tweens.add({ t: 0, dur: Math.max(1e-4, dur), fn, e, res });
  });
}
export const wait = (s) => tween(s, () => {}, ease.linear);
// Las piezas que llegan volando crecen desde un punto al empezar su trayecto: así nunca
// aparecen de golpe aunque su punto de partida quede dentro del encuadre.
// k = progreso de la aparición (0..1); base = escala final de la pieza.
export function grow(obj, base, k) {
  const f = Math.max(0.001, ease.outCubic(Math.min(1, Math.max(0, k))));
  obj.scale.set(base.x * f, base.y * f, base.z * f);
}
function stepTweens(dt) {
  for (const tw of [...tweens]) {
    tw.t += dt;
    const p = Math.min(1, tw.t / tw.dur);
    tw.fn(tw.e(p));
    if (p >= 1) { tweens.delete(tw); tw.res(); }
  }
}
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- Materiales y primitivas ----------
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, flatShading: true, ...opts }));
  return matCache.get(key);
}
const M = {
  block: () => mat('#9298a1', { roughness: 0.42, metalness: 0.55 }),
  blockDark: () => mat('#5c626b', { roughness: 0.5, metalness: 0.5 }),
  bore: () => mat('#121316', { roughness: 0.9 }),
  piston: () => mat('#dfe3e8', { roughness: 0.22, metalness: 0.85 }),
  ring: () => mat('#3b3f45', { roughness: 0.4, metalness: 0.6 }),
  rod: () => mat('#7d838c', { roughness: 0.35, metalness: 0.7 }),
  steel: () => mat('#c3c8ce', { roughness: 0.25, metalness: 0.85 }),
  hot: () => mat('#7a4a2e', { roughness: 0.45, metalness: 0.6 }),
  black: () => mat('#1d1f23', { roughness: 0.7 }),
};
const rarityMat = (tier) => mat(RARITY[tier].color, { roughness: 0.38, metalness: 0.35 });
function box(w, h, d, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, seg, material, open = false) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
// Caja de longitud 1 que crece en +X desde su origen: se estira con scale.x.
function growBox(h, d, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, h, d).translate(0.5, 0, 0), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const X = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

// ---------- Disposición de bancadas por familia ----------
// a = ángulo de la bancada alrededor del cigüeñal (0 = hacia arriba), y = desplazamiento vertical
// (motor H), st = escalonado a lo largo del eje. R0/H/W = distancia al cigüeñal, alto y ancho
// de la bancada; pr = radio del pistón.
const PITCH = 0.62;
const ROT_P = 0.4; // paso entre carcasas del rotativo
const FAMILY_GEO = {
  inline: { R0: 0.4, H: 1.05, W: 0.7, pr: 0.21, crank: [0.95, 0.95], pan: true, banks: [[0, 0, 0]] },
  v: { R0: 0.36, H: 1.0, W: 0.62, pr: 0.2, crank: [0.95, 1.0], pan: true, banks: [[-0.55, 0, 0], [0.55, 0, 0.5]] },
  inv: { R0: 0.36, H: 1.0, W: 0.62, pr: 0.2, crank: [0.95, 1.0], pan: true, banks: [[-0.55, 0, 0], [0.55, 0, 0.5]] },
  vr: { R0: 0.4, H: 1.05, W: 0.5, pr: 0.16, crank: [0.95, 0.95], pan: true, banks: [[-0.15, 0, 0], [0.15, 0, 0.5]] },
  w: { R0: 0.46, H: 0.95, W: 0.46, pr: 0.15, crank: [1.0, 1.15], pan: true, banks: [[-0.82, 0, 0], [-0.27, 0, 0.5], [0.27, 0, 0], [0.82, 0, 0.5]] },
  flat: { R0: 0.42, H: 0.9, W: 0.62, pr: 0.2, crank: [0.8, 0.9], pan: false, banks: [[-Math.PI / 2, 0, 0], [Math.PI / 2, 0, 0.5]] },
  h: { R0: 0.42, H: 0.85, W: 0.52, pr: 0.17, crank: [2.0, 0.9], pan: false, banks: [[-Math.PI / 2, 0.6, 0], [Math.PI / 2, 0.6, 0.5], [-Math.PI / 2, -0.6, 0.5], [Math.PI / 2, -0.6, 0]] },
};
export function bankAngles(family) {
  const g = FAMILY_GEO[family];
  return g ? g.banks.map(([a, y]) => ({ a, y, R0: g.R0, H: g.H, W: g.W })) : [];
}

// ---------- Plano (blueprint) ----------
const BP_W = 9, BP_H = 5.6, ROLL_R = 0.2;
class Blueprint {
  constructor(scene) {
    this.cv = document.createElement('canvas');
    this.cv.width = 1600; this.cv.height = Math.round(1600 * BP_H / BP_W);
    this.ctx = this.cv.getContext('2d');
    this.art = document.createElement('canvas');
    this.art.width = this.cv.width; this.art.height = this.cv.height;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.group = new THREE.Group();
    this.sheetMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.92, emissive: '#ffffff', emissiveMap: this.tex, emissiveIntensity: 0.18 });
    this.sheet = new THREE.Mesh(new THREE.PlaneGeometry(BP_W, BP_H).rotateX(-Math.PI / 2), this.sheetMat);
    this.sheet.position.y = 0.012;
    this.sheet.receiveShadow = true;
    this.group.add(this.sheet);
    this.roll = new THREE.Group();
    const r = cyl(ROLL_R, ROLL_R, BP_H + 0.04, 18, mat('#1a5a9c', { roughness: 0.9 }));
    r.rotation.x = Math.PI / 2;
    this.roll.add(r);
    const edge = cyl(ROLL_R * 0.35, ROLL_R * 0.35, BP_H + 0.1, 10, mat('#dfe9f5', { roughness: 0.9 }));
    edge.rotation.x = Math.PI / 2;
    this.roll.add(edge);
    this.group.add(this.roll);
    scene.add(this.group);
    this.reset();
  }
  reset() {
    this.group.visible = false;
    this.sheetMat.emissiveIntensity = 0.18;
    this.roll.visible = true;
    this.setUnroll(0);
    this.stamp = null;
    this.reveal = 0;
  }
  setUnroll(p) {
    p = Math.max(0.001, p);
    this.sheet.scale.x = p;
    this.sheet.position.x = -BP_W / 2 + (BP_W * p) / 2;
    this.tex.repeat.x = p;
    this.roll.position.set(-BP_W / 2 + BP_W * p, ROLL_R, 0);
    this.roll.rotation.z = -(BP_W * p) / ROLL_R;
    const s = 1 - p * 0.55;
    this.roll.scale.set(s, s, 1);
    this.roll.position.y = ROLL_R * s;
  }
  // Dibuja el esquema de la familia (vista frontal + lateral) en la capa "art".
  prepare(family, serial) {
    const c = this.art.getContext('2d');
    const W = this.art.width, H = this.art.height;
    c.clearRect(0, 0, W, H);
    c.strokeStyle = '#eaf3ff'; c.fillStyle = '#eaf3ff';
    c.lineCap = 'round'; c.lineJoin = 'round';
    const cx = W * 0.36, cy = H * 0.5, s = 150;
    c.lineWidth = 3;
    const f = family;
    if (f === 'rotary') {
      const path = (fn, n = 120) => { c.beginPath(); for (let i = 0; i <= n; i++) { const [x, y] = fn((i / n) * Math.PI * 2); i ? c.lineTo(cx + x * s, cy - y * s) : c.moveTo(cx + x * s, cy - y * s); } c.stroke(); };
      path((t) => [1.15 * Math.cos(t) + 0.16 * Math.cos(3 * t), 1.15 * Math.sin(t) + 0.16 * Math.sin(3 * t)]);
      c.strokeRect(cx - 1.75 * s, cy - 1.5 * s, 3.5 * s, 3 * s);
      c.lineWidth = 2;
      c.beginPath();
      const v = [0, 1, 2].map((i) => [Math.cos(Math.PI / 2 + (i * 2 * Math.PI) / 3) * 0.95, Math.sin(Math.PI / 2 + (i * 2 * Math.PI) / 3) * 0.95]);
      c.moveTo(cx + v[0][0] * s, cy - v[0][1] * s);
      for (let i = 0; i < 3; i++) { const b = v[(i + 1) % 3]; c.quadraticCurveTo(cx + (v[i][0] + b[0]) * 0.65 * s, cy - (v[i][1] + b[1]) * 0.65 * s, cx + b[0] * s, cy - b[1] * s); }
      c.stroke();
      c.beginPath(); c.arc(cx, cy, 0.28 * s, 0, Math.PI * 2); c.stroke();
    } else if (f === 'turbine') {
      for (const r of [1.4, 1.05, 0.45]) { c.beginPath(); c.arc(cx, cy, r * s, 0, Math.PI * 2); c.stroke(); }
      c.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * 0.45 * s, cy + Math.sin(a) * 0.45 * s);
        c.quadraticCurveTo(cx + Math.cos(a + 0.25) * 0.8 * s, cy + Math.sin(a + 0.25) * 0.8 * s, cx + Math.cos(a + 0.18) * 1.05 * s, cy + Math.sin(a + 0.18) * 1.05 * s);
        c.stroke();
      }
    } else {
      const g = FAMILY_GEO[f];
      const crankH = g.crank[0], crankD = g.crank[1];
      c.strokeRect(cx - (crankD / 2) * s, cy - (crankH / 2) * s, crankD * s, crankH * s);
      c.beginPath(); c.arc(cx, cy, 0.14 * s, 0, Math.PI * 2); c.stroke();
      if (f === 'h') for (const y of [0.6, -0.6]) { c.beginPath(); c.arc(cx, cy - y * s, 0.12 * s, 0, Math.PI * 2); c.stroke(); }
      for (const [a0, y] of g.banks) {
        const a = f === 'inv' ? a0 + Math.PI : a0;
        c.save();
        c.translate(cx, cy - y * s);
        c.rotate(a);
        // Bancada: rectángulo desde R0 hasta R0+H, con el cilindro y el pistón en discontinua.
        c.strokeRect(-(g.W / 2) * s, -(g.R0 + g.H) * s, g.W * s, g.H * s);
        c.setLineDash([10, 8]);
        c.strokeRect(-g.pr * s, -(g.R0 + g.H - 0.06) * s, g.pr * 2 * s, g.H * 0.55 * s);
        c.setLineDash([]);
        c.beginPath(); c.moveTo(0, -(g.R0 + g.H * 0.45) * s); c.lineTo(0, -0.1 * s); c.stroke();
        c.restore();
      }
    }
    // Cotas y textos técnicos
    c.lineWidth = 1.5;
    c.setLineDash([4, 6]);
    c.beginPath(); c.moveTo(cx - 2.3 * s, cy); c.lineTo(cx + 2.3 * s, cy); c.moveTo(cx, cy - 2.2 * s); c.lineTo(cx, cy + 2.0 * s); c.stroke();
    c.setLineDash([]);
    c.font = '600 26px "Satoshi", "Segoe UI", sans-serif';
    c.fillText('VISTA FRONTAL · SECCIÓN A-A', cx - 2.2 * s, cy - 2.25 * s);
    // Vista lateral genérica (bloque con cilindros "?" sin contar todavía)
    const lx = W * 0.66, ly = H * 0.36;
    c.strokeRect(lx, ly, 420, 150);
    c.setLineDash([8, 8]);
    for (let i = 0; i < 6; i++) c.strokeRect(lx + 22 + i * 66, ly + 18, 48, 92);
    c.setLineDash([]);
    c.fillText('VISTA LATERAL', lx, ly - 18);
    c.font = '700 64px "Clash Display", "Satoshi", sans-serif';
    c.fillText('? ? ?', lx + 140, ly + 98);
    c.font = '500 24px "Satoshi", "Segoe UI", sans-serif';
    c.fillText('Nº DE ' + (f === 'turbine' ? 'ETAPAS' : f === 'rotary' ? 'ROTORES' : 'CILINDROS') + ': POR DETERMINAR', lx, ly + 196);
    // Cajetín
    const bx = W - 560, by = H - 190;
    c.lineWidth = 3;
    c.strokeRect(bx, by, 520, 150);
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(bx, by + 50); c.lineTo(bx + 520, by + 50); c.moveTo(bx + 260, by + 50); c.lineTo(bx + 260, by + 150); c.moveTo(bx, by + 100); c.lineTo(bx + 520, by + 100); c.stroke();
    c.font = '700 28px "Clash Display", "Satoshi", sans-serif';
    c.fillText('RULETA MOTORS · PLANO DE MOTOR', bx + 18, by + 35);
    c.font = '500 22px "Satoshi", "Segoe UI", sans-serif';
    c.fillText('HOJA 01 / 05', bx + 18, by + 83);
    c.fillText('ESCALA 1:5', bx + 278, by + 83);
    c.fillText('Nº ' + serial, bx + 18, by + 133);
    c.fillText('CONFIGURACIÓN', bx + 278, by + 133);
  }
  draw() {
    const c = this.ctx, W = this.cv.width, H = this.cv.height;
    const grd = c.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#1d5f9f'); grd.addColorStop(1, '#134a82');
    c.fillStyle = grd; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(234,243,255,0.08)'; c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x < W; x += 25) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0; y < H; y += 25) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    c.strokeStyle = 'rgba(234,243,255,0.18)';
    c.beginPath();
    for (let x = 0; x < W; x += 125) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0; y < H; y += 125) { c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    c.strokeStyle = '#eaf3ff'; c.lineWidth = 4; c.strokeRect(24, 24, W - 48, H - 48);
    c.lineWidth = 1.5; c.strokeRect(36, 36, W - 72, H - 72);
    // El trazador revela el esquema de izquierda a derecha.
    const rx = this.reveal * W;
    if (rx > 0) {
      c.save(); c.beginPath(); c.rect(0, 0, rx, H); c.clip();
      c.drawImage(this.art, 0, 0);
      c.restore();
      if (this.reveal < 1) {
        const g2 = c.createLinearGradient(rx - 60, 0, rx + 4, 0);
        g2.addColorStop(0, 'rgba(255,255,255,0)'); g2.addColorStop(1, 'rgba(255,255,255,0.55)');
        c.fillStyle = g2; c.fillRect(rx - 60, 0, 64, H);
      }
    }
    if (this.stamp) {
      const { text, p } = this.stamp;
      const sc = lerp(2.4, 1, p);
      c.save();
      c.globalAlpha = Math.min(1, p * 1.6);
      c.translate(W * 0.73, H * 0.66);
      c.rotate(-0.12);
      c.scale(sc, sc);
      c.font = '700 92px "Clash Display", "Satoshi", sans-serif';
      const tw = c.measureText(text).width;
      c.strokeStyle = '#ff6a1a'; c.fillStyle = '#ff6a1a';
      c.lineWidth = 8; c.strokeRect(-tw / 2 - 34, -78, tw + 68, 120);
      c.lineWidth = 3; c.strokeRect(-tw / 2 - 22, -66, tw + 44, 96);
      c.fillText(text, -tw / 2, 12);
      c.restore();
    }
    this.tex.needsUpdate = true;
  }
}

// ---------- Piezas ----------
function makePiston(r) {
  const g = new THREE.Group();
  const crown = cyl(r, r, 0.34, 18, M.piston());
  g.add(crown);
  for (const y of [0.1, 0.04]) { const ring = cyl(r + 0.006, r + 0.006, 0.022, 18, M.ring()); ring.position.y = y; g.add(ring); }
  const pin = cyl(0.045, 0.045, r * 1.6, 8, M.rod()); pin.rotation.x = Math.PI / 2; pin.position.y = -0.08; g.add(pin);
  const rod = box(0.08, 0.6, 0.1, M.rod()); rod.position.y = -0.42; g.add(rod);
  const big = cyl(0.09, 0.09, 0.12, 10, M.rod()); big.rotation.x = Math.PI / 2; big.position.y = -0.74; g.add(big);
  return g;
}
function reuleauxShape(r) {
  const v = [0, 1, 2].map((i) => new THREE.Vector2(Math.cos(Math.PI / 2 + (i * 2 * Math.PI) / 3) * r, Math.sin(Math.PI / 2 + (i * 2 * Math.PI) / 3) * r));
  const side = v[0].distanceTo(v[1]);
  const s = new THREE.Shape();
  s.moveTo(v[1].x, v[1].y);
  for (let i = 0; i < 3; i++) {
    const c = v[i], a = v[(i + 1) % 3], b = v[(i + 2) % 3];
    s.absarc(c.x, c.y, side, Math.atan2(a.y - c.y, a.x - c.x), Math.atan2(b.y - c.y, b.x - c.x), false);
  }
  return s;
}
function makeRotor() {
  const geo = new THREE.ExtrudeGeometry(reuleauxShape(0.46), { depth: 0.3, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 10 });
  geo.translate(0, 0, -0.15).rotateY(Math.PI / 2);
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, M.piston()); m.castShadow = true;
  g.add(m);
  const gear = cyl(0.17, 0.17, 0.34, 14, M.ring()); gear.rotation.z = Math.PI / 2; g.add(gear);
  return g;
}
function makeRotorHousing(material) {
  const outer = new THREE.Shape();
  const w = 0.82, h = 0.74, rr = 0.2;
  outer.moveTo(-w + rr, -h); outer.lineTo(w - rr, -h); outer.quadraticCurveTo(w, -h, w, -h + rr); outer.lineTo(w, h - rr);
  outer.quadraticCurveTo(w, h, w - rr, h); outer.lineTo(-w + rr, h); outer.quadraticCurveTo(-w, h, -w, h - rr); outer.lineTo(-w, -h + rr); outer.quadraticCurveTo(-w, -h, -w + rr, -h);
  const hole = new THREE.Path();
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    // Epitrocoide de dos lóbulos (carcasa Wankel), eje mayor vertical.
    const x = 0.5 * Math.sin(t) + 0.06 * Math.sin(3 * t), y = 0.58 * Math.cos(t) + 0.07 * Math.cos(3 * t);
    i ? hole.lineTo(x, y) : hole.moveTo(x, y);
  }
  outer.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(outer, { depth: 0.36, bevelEnabled: false, curveSegments: 6 });
  geo.translate(0, 0, -0.18).rotateY(Math.PI / 2);
  const m = new THREE.Mesh(geo, material); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function makeTurbineStage(tier) {
  const g = new THREE.Group();
  const hub = cyl(0.2, 0.2, 0.14, 14, M.steel()); hub.rotation.z = Math.PI / 2; g.add(hub);
  const disc = cyl(0.36, 0.36, 0.06, 18, M.rod()); disc.rotation.z = Math.PI / 2; g.add(disc);
  const blade = M.piston();
  for (let i = 0; i < 16; i++) {
    const b = box(0.04, 0.34, 0.1, blade);
    const a = (i / 16) * Math.PI * 2;
    b.position.set(0, Math.cos(a) * 0.52, Math.sin(a) * 0.52);
    b.rotation.x = -a;
    b.rotation.y = 0.5;
    g.add(b);
  }
  return g;
}
function makeTurbo(tier) {
  const g = new THREE.Group();
  const comp = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.12, 10, 22), M.steel()); comp.castShadow = true; g.add(comp);
  const turb = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.1, 10, 22), M.hot()); turb.position.z = -0.24; turb.castShadow = true; g.add(turb);
  const core = cyl(0.12, 0.12, 0.5, 12, M.blockDark()); core.rotation.x = Math.PI / 2; core.position.z = -0.12; g.add(core);
  const inlet = cyl(0.19, 0.16, 0.24, 18, rarityMat(tier), true); inlet.material = inlet.material.clone(); inlet.material.side = THREE.DoubleSide;
  inlet.rotation.x = Math.PI / 2; inlet.position.z = 0.2; g.add(inlet);
  const wheel = new THREE.Group();
  for (let i = 0; i < 8; i++) { const b = box(0.02, 0.15, 0.05, M.piston()); const a = (i / 8) * Math.PI * 2; b.position.set(Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0); b.rotation.z = a + Math.PI / 2; wheel.add(b); }
  const nut = cyl(0.04, 0.04, 0.08, 8, M.piston()); nut.rotation.x = Math.PI / 2; wheel.add(nut);
  wheel.position.z = 0.22;
  g.add(wheel);
  const pipe = cyl(0.08, 0.08, 0.55, 10, M.hot()); pipe.rotation.x = Math.PI / 2; pipe.position.set(0, -0.1, -0.6); g.add(pipe);
  g.userData.spin = wheel;
  return g;
}
function makeSupercharger(len, tier) {
  const g = new THREE.Group();
  const body = rarityMat(tier);
  for (const z of [-0.17, 0.17]) { const c = cyl(0.23, 0.23, len, 16, body); c.rotation.z = Math.PI / 2; c.position.z = z; g.add(c); }
  const mid = box(len, 0.3, 0.34, body); g.add(mid);
  for (let i = 0; i < 5; i++) { const fin = box(len * 0.9, 0.04, 0.6, M.blockDark()); fin.position.y = 0.2 + 0; fin.position.x = 0; fin.scale.z = 1 - i * 0.12; fin.position.y = 0.16 + i * 0.03; if (i) g.add(fin); }
  const hat = cyl(0.26, 0.3, 0.28, 18, M.steel()); hat.position.set(len * 0.18, 0.38, 0); g.add(hat);
  const pulley = cyl(0.2, 0.2, 0.1, 18, M.black()); pulley.rotation.z = Math.PI / 2; pulley.position.x = -len / 2 - 0.08; g.add(pulley);
  const spokes = box(0.04, 0.34, 0.06, M.steel()); pulley.add(spokes);
  g.userData.spin = pulley;
  return g;
}

// ---------- Etiqueta de cilindrada ----------
function labelTexture(main, sub, color) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#16181c'; c.fillRect(0, 0, 512, 128);
  c.strokeStyle = color; c.lineWidth = 8; c.strokeRect(6, 6, 500, 116);
  c.fillStyle = '#f6f0e6';
  c.font = '700 70px "Clash Display", "Satoshi", sans-serif';
  c.fillText(main, 28, 88);
  c.font = '600 28px "Satoshi", "Segoe UI", sans-serif';
  c.fillStyle = color;
  const w = c.measureText(sub).width;
  c.fillText(sub, 484 - w, 82);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- Motor ----------
class Engine {
  constructor(scene, build) {
    this.build = build;
    this.family = build.family;
    this.geo = FAMILY_GEO[this.family] || null;
    this.root = new THREE.Group(); // alineado con el mundo, centrado en x
    this.inner = new THREE.Group(); // crece en +X; se recentra y se puede voltear
    this.root.add(this.inner);
    scene.add(this.root);
    this.parts = [];      // piezas que caen (pistones / rotores / etapas)
    this.spinners = [];   // cosas que giran al arrancar
    this.flames = [];
    this.exhaustParts = [];
    this.intakeItems = [];
    this.counts = [];
    this.running = 0;
    this.pumping = 0;
    this.phase = 0;
    this.makeBase();
  }

  makeBase() {
    const f = this.family, inner = this.inner;
    this.grow = []; // [mesh, start, extraLen] que siguen la longitud total
    if (this.geo) {
      const g = this.geo;
      const [ch, cd] = g.crank;
      this.crankcase = growBox(ch, cd, M.block());
      inner.add(this.crankcase);
      if (g.pan) { const pan = growBox(0.32, cd * 0.82, M.blockDark()); pan.position.y = -ch / 2 - 0.16; inner.add(pan); this.grow.push([pan, 0.08, -0.16]); }
      this.grow.push([this.crankcase, 0, 0]);
      this.banks = g.banks.map(([a, y, st], i) => {
        const grp = new THREE.Group();
        grp.rotation.x = a; grp.position.y = y;
        const m = growBox(g.H, g.W, M.block());
        m.position.set(st * PITCH + 0.1, g.R0 + g.H / 2, 0);
        grp.add(m);
        inner.add(grp);
        this.counts[i] = 0;
        return { a, y, st: st * PITCH, grp, mesh: m };
      });
      // Tapa de distribución delante y volante detrás
      const front = box(0.12, ch * 1.08, cd * 1.08, M.blockDark()); front.position.x = -0.06; inner.add(front);
      const pul = cyl(0.26, 0.26, 0.1, 18, M.black()); pul.rotation.z = Math.PI / 2; pul.position.x = -0.17; inner.add(pul);
      this.spinners.push([pul, 'x', 1]);
      if (f === 'h') { const p2 = pul.clone(); p2.position.y = 0.6; const p3 = pul.clone(); p3.position.y = -0.6; inner.add(p2, p3); this.spinners.push([p2, 'x', 1], [p3, 'x', 1]); pul.visible = false; }
      this.fly = cyl(0.62, 0.62, 0.1, 24, M.blockDark()); this.fly.rotation.z = Math.PI / 2; inner.add(this.fly);
      this.spinners.push([this.fly, 'x', 1]);
    } else if (f === 'rotary') {
      // Placas de los extremos con el mismo hueco que las carcasas: así se ve el rotor girar.
      const plate = makeRotorHousing(M.blockDark()); plate.scale.x = 0.33; plate.position.x = 0.06; inner.add(plate);
      this.backPlate = makeRotorHousing(M.blockDark()); this.backPlate.scale.x = 0.33; inner.add(this.backPlate);
      this.shaft = growBox(0.12, 0.12, M.rod()); this.shaft.scale.x = 0.4; this.shaft.position.x = -0.2; inner.add(this.shaft);
      this.counts[0] = 0;
    } else {
      // Turbina: carcasa inferior abierta por arriba para que caigan las etapas
      const shellGeo = new THREE.CylinderGeometry(0.8, 0.8, 1, 26, 1, true, 0, Math.PI).rotateZ(-Math.PI / 2).translate(0.5, 0, 0);
      this.shell = new THREE.Mesh(shellGeo, mat('#8d939b', { roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }));
      this.shell.castShadow = true; this.shell.receiveShadow = true;
      inner.add(this.shell);
      const nose = cyl(0.04, 0.36, 0.7, 16, M.steel()); nose.rotation.z = Math.PI / 2; nose.position.x = -0.35; inner.add(nose);
      this.spinners.push([nose, 'x', 3]);
      this.nozzle = cyl(0.62, 0.5, 0.6, 22, M.hot(), true); this.nozzle.material = this.nozzle.material.clone(); this.nozzle.material.side = THREE.DoubleSide; this.nozzle.rotation.z = Math.PI / 2; inner.add(this.nozzle);
      this.axle = growBox(0.14, 0.14, M.rod()); inner.add(this.axle);
      this.counts[0] = 0;
    }
    this.setLength(true);
  }

  // Longitud total según piezas montadas; mueve volante/placas y recentra el motor.
  totalLength() {
    if (this.geo) return Math.max(0.7, ...this.banks.map((b, i) => b.st + 0.4 + this.counts[i] * PITCH));
    if (this.family === 'rotary') return 0.12 + this.counts[0] * ROT_P + 0.12;
    return 0.2 + Math.max(1, this.counts[0]) * 0.46 + 0.2;
  }
  bankLen(i) { return this.counts[i] * PITCH + 0.2; }
  applyLength(L, bankLens) {
    if (this.geo) {
      for (const [m, s, extra] of this.grow) { m.position.x = s; m.scale.x = Math.max(0.1, L + extra); }
      this.banks.forEach((b, i) => { b.mesh.scale.x = bankLens[i]; });
      this.fly.position.x = L + 0.06;
    } else if (this.family === 'rotary') {
      this.backPlate.position.x = L - 0.06;
      this.shaft.scale.x = L + 0.6;
    } else {
      this.shell.scale.x = L;
      this.axle.scale.x = L;
      this.nozzle.position.x = L + 0.3;
    }
    this.inner.position.x = -L / 2;
    this.curL = L;
    this.curBanks = bankLens;
  }
  // Estira el bloque desde lo que se ve ahora hasta la longitud que pide lo montado.
  setLength(instant = false) {
    const L = this.totalLength();
    const bl = this.banks ? this.banks.map((b, i) => this.bankLen(i)) : [];
    if (instant) { this.applyLength(L, bl); return Promise.resolve(); }
    const L0 = this.curL, b0 = this.curBanks;
    return tween(0.3, (t) => this.applyLength(lerp(L0, L, t), bl.map((v, i) => lerp(b0[i], v, t))), ease.outCubic);
  }

  // Dirección "arriba del mundo" expresada en coordenadas de inner (cambia al voltear el V invertido).
  localUp() {
    const q = new THREE.Quaternion();
    this.inner.getWorldQuaternion(q);
    return UP.clone().applyQuaternion(q.invert());
  }

  // Siguiente hueco: devuelve {pos, dir, bank}
  nextSlot(j) {
    if (this.geo) {
      const bi = j % this.banks.length;
      const b = this.banks[bi], g = this.geo;
      const k = this.counts[bi];
      const x = b.st + 0.2 + (k + 0.5) * PITCH;
      const dir = UP.clone().applyAxisAngle(X, b.a);
      const pos = new THREE.Vector3(x, g.R0 + g.H, 0).applyAxisAngle(X, b.a).add(new THREE.Vector3(0, b.y, 0));
      return { pos, dir, bank: bi };
    }
    const k = this.counts[0];
    const x = this.family === 'rotary' ? 0.12 + (k + 0.5) * ROT_P : 0.2 + (k + 0.5) * 0.46;
    return { pos: new THREE.Vector3(x, 0, 0), dir: UP.clone(), bank: 0 };
  }

  // Deja caer una pieza en su hueco. onLand se llama al encajar.
  async dropPiece(j, onLand, sfx) {
    const slot = this.nextSlot(j);
    this.counts[slot.bank]++;
    const growing = this.setLength();
    let piece, bore = null;
    if (this.geo) {
      piece = makePiston(this.geo.pr);
      bore = cyl(this.geo.pr + 0.035, this.geo.pr + 0.035, 0.03, 18, M.bore());
      bore.quaternion.setFromUnitVectors(UP, slot.dir);
      bore.position.copy(slot.pos);
      bore.scale.setScalar(0.001);
      this.inner.add(bore);
      tween(0.25, (t) => bore.scale.setScalar(Math.max(0.001, t)), ease.outBack);
    } else if (this.family === 'rotary') piece = makeRotor();
    else piece = makeTurbineStage();
    if (this.geo) piece.quaternion.setFromUnitVectors(UP, slot.dir);
    // Posición final: corona del pistón a ras de la bancada
    const final = this.geo ? slot.pos.clone().addScaledVector(slot.dir, -0.15) : slot.pos.clone();
    const up = this.localUp();
    const vertical = slot.dir.dot(up) > 0.95;
    const hover = final.clone().addScaledVector(slot.dir, vertical ? 0 : 1.0);
    const start = hover.clone().addScaledVector(up, 5.2);
    piece.position.copy(start);
    piece.userData.home = final.clone();
    piece.userData.dir = slot.dir.clone();
    this.inner.add(piece);
    this.parts.push(piece);
    const spin = this.family === 'rotary' ? 1 : 0;
    const pBase = piece.scale.clone();
    await tween(0.5, (t) => { piece.position.lerpVectors(start, hover, t); grow(piece, pBase, t * 4); if (spin) piece.rotation.x = (1 - t) * 6; }, ease.inQuad);
    if (!vertical) await tween(0.2, (t) => piece.position.lerpVectors(hover, final, t), ease.outCubic);
    await growing;
    if (this.family === 'rotary') {
      const hs = makeRotorHousing(M.block());
      hs.position.copy(final);
      this.inner.add(hs);
      hs.scale.setScalar(0.001);
      tween(0.35, (t) => hs.scale.set(Math.max(0.001, t), Math.max(0.001, t), Math.max(0.001, t)), ease.outBack);
    }
    if (this.family === 'turbine') this.spinners.push([piece, 'x', 2.5]);
    if (this.family === 'rotary') this.spinners.push([piece, 'x', 0.8]);
    // Pequeño rebote al encajar
    const d = this.geo ? slot.dir : up;
    await tween(0.16, (t) => piece.position.copy(final).addScaledVector(d, Math.sin(t * Math.PI) * 0.06), ease.linear);
    sfx && sfx(piece.getWorldPosition(new THREE.Vector3()));
    onLand && onLand();
  }

  // V invertido: se da la vuelta al terminar de montar los pistones.
  async flip() {
    await tween(1.2, (t) => { this.inner.rotation.x = t * Math.PI; }, ease.inOutCubic);
  }

  // Culatas / tapas con la cilindrada grabada (color = rareza de la cilindrada).
  async addCovers(intake, sfx) {
    const color = RARITY[intake.tier].color;
    const tex = labelTexture(intake.name, RARITY[intake.tier].name.toUpperCase(), color);
    const labelMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2 });
    const body = rarityMat(intake.tier);
    const covers = [];
    if (this.geo) {
      const g = this.geo;
      this.banks.forEach((b, i) => {
        if (!this.counts[i]) return;
        const len = this.bankLen(i) + 0.04;
        const cover = new THREE.Group();
        const base = box(len, 0.12, g.W + 0.06, M.blockDark()); base.position.y = 0.06; cover.add(base);
        const top = box(len - 0.08, 0.2, g.W - 0.04, body); top.position.y = 0.22; cover.add(top);
        for (let k = 0; k < 3; k++) { const fin = box(len - 0.2, 0.04, 0.05, body); fin.position.set(0, 0.34, (k - 1) * (g.W * 0.28)); cover.add(fin); }
        const lw = Math.min(len * 0.7, 1.7);
        const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw / 4).rotateX(-Math.PI / 2), labelMat);
        label.position.y = 0.325; cover.add(label);
        // Coordenadas de la bancada -> inner
        const local = new THREE.Vector3(b.st + 0.1 + len / 2 - 0.02, g.R0 + g.H, 0);
        const home = local.clone().applyAxisAngle(X, b.a).add(new THREE.Vector3(0, b.y, 0));
        cover.rotation.x = b.a;
        covers.push([cover, home, UP.clone().applyAxisAngle(X, b.a)]);
      });
    } else if (this.family === 'rotary') {
      const L = this.totalLength();
      const cover = new THREE.Group();
      const plenum = box(L - 0.1, 0.34, 0.7, body); plenum.position.y = 0.17; cover.add(plenum);
      for (let k = 0; k < this.counts[0]; k++) { const r = cyl(0.09, 0.09, 0.3, 10, M.steel()); r.position.set(-L / 2 + 0.12 + (k + 0.5) * ROT_P, -0.08, 0.28); cover.add(r); }
      const lw = Math.min(L * 0.8, 1.5);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw / 4).rotateX(-Math.PI / 2), labelMat); label.position.y = 0.345; cover.add(label);
      covers.push([cover, new THREE.Vector3(L / 2, 0.74, 0), UP.clone()]);
    } else {
      const L = this.totalLength();
      const geo = new THREE.CylinderGeometry(0.82, 0.82, L, 26, 1, true, Math.PI, Math.PI).rotateZ(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat(color, { roughness: 0.38, metalness: 0.35, side: THREE.DoubleSide })); m.castShadow = true;
      const cover = new THREE.Group(); cover.add(m);
      const lw = Math.min(L * 0.7, 1.4);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw / 4).rotateX(-Math.PI / 2), labelMat); label.position.y = 0.83; cover.add(label);
      covers.push([cover, new THREE.Vector3(L / 2, 0, 0), UP.clone()]);
    }
    const up = this.localUp();
    await Promise.all(covers.map(async ([cover, home, dir], i) => {
      await wait(i * 0.15);
      const hover = home.clone().addScaledVector(dir, dir.dot(up) > 0.95 ? 0 : 1.2);
      const start = hover.clone().addScaledVector(up, 5);
      cover.position.copy(start);
      this.inner.add(cover);
      const cBase = cover.scale.clone();
      await tween(0.5, (t) => { cover.position.lerpVectors(start, hover, t); grow(cover, cBase, t * 4); }, ease.inQuad);
      if (!hover.equals(home)) await tween(0.22, (t) => cover.position.lerpVectors(hover, home, t), ease.outCubic);
      sfx && sfx();
    }));
  }

  // Caja de todo el motor (bloque + admisión) en coordenadas del root, sin su escala.
  fullBounds() {
    this.root.updateMatrixWorld(true);
    const inv = this.root.matrixWorld.clone().invert();
    const b = new THREE.Box3();
    const tmp = new THREE.Box3();
    this.root.traverse((o) => {
      if (!o.isMesh || !o.visible || this.exhaustParts.includes(o)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      b.union(tmp);
    });
    return b;
  }

  bounds() {
    this.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(this.inner);
    b.min.sub(this.root.position); b.max.sub(this.root.position);
    return b;
  }

  // Admisión: atmosférico (trompetas), turbos (caracolas) o compresor volumétrico.
  async addIntake(turbo, sfx) {
    const b = this.bounds();
    const L = b.max.x - b.min.x;
    const items = [];
    if (turbo.supercharger) {
      const n = turbo.count;
      for (let i = 0; i < n; i++) {
        const sc = makeSupercharger(Math.min(1.8, Math.max(0.8, L * 0.5)), turbo.tier);
        const z = n === 1 ? 0 : (i ? 0.45 : -0.45);
        items.push([sc, new THREE.Vector3(0, b.max.y + 0.26, z), new THREE.Vector3(0, 1, 0)]);
        this.spinners.push([sc.userData.spin, 'x', 2]);
      }
    } else if (turbo.count) {
      const spots = [
        [-L * 0.18, 1], [-L * 0.18, -1], [L * 0.22, 1], [L * 0.22, -1],
      ].slice(0, turbo.count);
      const yc = (b.min.y + b.max.y) / 2;
      for (const [x, side] of spots) {
        const t = makeTurbo(turbo.tier);
        if (side < 0) t.rotation.y = Math.PI;
        items.push([t, new THREE.Vector3(x, yc + 0.1, side > 0 ? b.max.z + 0.32 : b.min.z - 0.32), new THREE.Vector3(0, 0, side)]);
        this.spinners.push([t.userData.spin, 'z', 9]);
      }
    } else {
      // Atmosférico: plenum con trompetas de admisión
      const g = new THREE.Group();
      const n = Math.max(2, Math.min(8, this.build.count || 4));
      const len = Math.max(0.8, L * 0.7);
      const plen = box(len, 0.16, 0.5, M.blockDark()); g.add(plen);
      for (let i = 0; i < n; i++) {
        const tr = cyl(0.14, 0.085, 0.34, 14, M.steel(), true);
        tr.material = tr.material.clone(); tr.material.side = THREE.DoubleSide;
        tr.position.set(-len / 2 + (i + 0.5) * (len / n), 0.25, 0);
        g.add(tr);
      }
      items.push([g, new THREE.Vector3(0, b.max.y + 0.1, 0), new THREE.Vector3(0, 1, 0)]);
    }
    await Promise.all(items.map(async ([obj, home, out], i) => {
      await wait(i * 0.22);
      const start = home.clone().addScaledVector(out, 5).add(new THREE.Vector3(0, 3, 0));
      obj.position.copy(start);
      this.root.add(obj);
      const r0 = obj.rotation.z;
      const oBase = obj.scale.clone();
      await tween(0.7, (t) => { obj.position.lerpVectors(start, home, t); grow(obj, oBase, t * 2.5); obj.rotation.z = r0 + (1 - t) * 6; }, ease.outBack);
      obj.scale.copy(oBase);
      obj.rotation.z = r0;
      obj.userData.home = home.clone();
      obj.userData.rot = obj.rotation.clone();
      sfx && sfx();
    }));
    this.intakeItems = items.map(([obj]) => obj);
    // Escapes detrás: de ahí salen las llamas al arrancar
    const bb = this.bounds();
    const ex = [];
    for (const z of [-0.3, 0.3]) {
      const pipe = cyl(0.09, 0.11, 0.6, 12, M.hot()); pipe.rotation.z = Math.PI / 2; pipe.position.set(bb.max.x + 0.1, bb.min.y + 0.3, z);
      this.root.add(pipe);
      // El escape sale deslizándose desde el bloque
      tween(0.45, (t) => { pipe.position.x = bb.max.x - 0.3 + 0.4 * t; pipe.scale.y = Math.max(0.001, t); }, ease.outBack);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.7, 10).rotateZ(-Math.PI / 2).translate(0.35, 0, 0), new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.position.set(bb.max.x + 0.4, bb.min.y + 0.3, z);
      this.root.add(flame);
      ex.push(flame);
      this.exhaustParts.push(pipe, flame);
    }
    this.flames = ex;
  }

  update(dt, t) {
    const speed = this.running ? 1 + this.running * 3 : this.pumping ? 1.6 : 0;
    this.phase += dt * speed * 9;
    if (this.pumping || this.running) {
      for (let i = 0; i < this.parts.length; i++) {
        const p = this.parts[i];
        if (!this.geo) continue;
        const off = (1 - Math.cos(this.phase + i * 2.1)) * 0.11;
        p.position.copy(p.userData.home).addScaledVector(p.userData.dir, -off);
      }
    }
    for (const [obj, axis, k] of this.spinners) if (speed) obj.rotation[axis] += dt * speed * k * (this.running ? 3 : 0.5);
    const r = this.running;
    if (r) {
      const j = 0.012 + r * 0.02;
      this.inner.position.y = (Math.random() - 0.5) * j;
      this.inner.position.z = (Math.random() - 0.5) * j;
      for (const f of this.flames) {
        f.material.opacity = Math.max(0, 0.35 + r * 0.6 * Math.random());
        f.scale.set(0.4 + r * (0.8 + Math.random() * 0.9), 1, 1);
        f.material.color.set(Math.random() < r * 0.4 ? '#7fb6ff' : '#ff8a2a');
      }
    }
  }

  dispose(scene) {
    scene.remove(this.root);
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

// ---------- Escena ----------
export class Workshop {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true; // para abrir el hueco del capó en la carrocería
    this.renderer = renderer;
    this.canvas = canvas;
    this.onFrame = new Set();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1b1917');
    scene.fog = new THREE.Fog('#1b1917', 40, 95);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    this.camera.position.set(0, 11, 8);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 24;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.target.set(0, 0, 0);
    this.controls.enabled = false;
    this.goodCam = [this.camera.position.clone(), this.controls.target.clone()];

    scene.add(new THREE.HemisphereLight('#e8eef5', '#4a4640', 1.1));
    const key = new THREE.SpotLight('#fff1dc', 220, 40, 0.55, 0.5, 1.6);
    key.position.set(-4, 13, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight('#9fc4ff', 0.9);
    rim.position.set(7, 5, -8);
    scene.add(rim);
    const fill = new THREE.DirectionalLight('#ffb98a', 0.35);
    fill.position.set(-8, 3, -2);
    scene.add(fill);

    // Banco de montaje: plataforma octogonal con banda de seguridad
    // El suelo y el resto del taller los pone garage.js
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.6, 0.3, 8), mat('#45474b', { roughness: 0.55, metalness: 0.35 }));
    deck.position.y = -0.15; deck.rotation.y = Math.PI / 8; deck.receiveShadow = true; scene.add(deck);
    const band = new THREE.Mesh(new THREE.RingGeometry(5.9, 6.15, 8).rotateX(-Math.PI / 2), mat('#ff6a1a', { roughness: 0.7 }));
    band.position.y = 0.004; band.rotation.y = Math.PI / 8; scene.add(band);
    this.halo = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.75, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff6a1a', transparent: true, opacity: 0 }));
    this.halo.position.y = 0.03; scene.add(this.halo);

    this.blueprint = new Blueprint(scene);
    this.engine = null;
    this.sparks = [];
    this.clock = new THREE.Clock();
    this.time = 0;
    this.camTween = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    // Una pestaña en segundo plano puede medir 0×0: con eso la proporción sería NaN y la cámara también
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Con la hoja de montaje a la derecha (solo en el motor) el encuadre se desplaza para no taparlo
    if (this.offsetRight && w > 760) this.camera.setViewOffset(w, h, Math.min(170, w * 0.12), 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // Mueve la cámara a una posición relativa al objetivo; en pantallas estrechas se aleja.
  shot(pos, target, dur = 1.4) {
    const aspect = Number.isFinite(this.camera.aspect) && this.camera.aspect > 0 ? this.camera.aspect : 1.6;
    const fit = 1.3 * Math.max(1, Math.pow(1.35 / aspect, 0.8)); // en vertical el coche llena más el ancho
    const p1 = new THREE.Vector3(...pos).sub(new THREE.Vector3(...target)).multiplyScalar(fit).add(new THREE.Vector3(...target));
    const t1 = new THREE.Vector3(...target);
    // Si la cámara venía mal (NaN), el movimiento arranca ya desde el destino
    const ok = (v) => Number.isFinite(v.x + v.y + v.z);
    const p0 = ok(this.camera.position) ? this.camera.position.clone() : p1.clone();
    const t0 = ok(this.controls.target) ? this.controls.target.clone() : t1.clone();
    return tween(dur, (t) => { this.camera.position.lerpVectors(p0, p1, t); this.controls.target.lerpVectors(t0, t1, t); }, ease.inOutCubic);
  }

  reset() {
    if (this.engine) { this.engine.dispose(this.scene); this.engine = null; }
    this.blueprint.reset();
    this.halo.material.opacity = 0;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  async showBlueprint(family, serial, sfx) {
    const bp = this.blueprint;
    bp.prepare(family, serial);
    bp.draw();
    bp.group.visible = true;
    // El rollo cae sobre el banco…
    bp.roll.position.y = 6;
    await tween(0.55, (t) => { bp.roll.position.y = lerp(6, ROLL_R, t); }, ease.inQuad);
    sfx.thud(0.6);
    // …y se despliega
    sfx.whoosh();
    await tween(1.1, (t) => bp.setUnroll(t), ease.outCubic);
    bp.roll.visible = false;
    // El trazador dibuja el esquema
    sfx.plotter(1.4);
    await tween(1.5, (t) => { bp.reveal = t; bp.draw(); }, ease.inOutCubic);
  }
  async stampBlueprint(text, sfx) {
    const bp = this.blueprint;
    bp.stamp = { text, p: 0 };
    await tween(0.28, (t) => { bp.stamp.p = t; bp.draw(); }, ease.inQuad);
    sfx.stamp();
  }

  async engineIn(build, sfx) {
    this.engine = new Engine(this.scene, build);
    const e = this.engine;
    e.root.position.y = 1.3;
    // Del plano al metal: el bloque base aparece en blanco "de plano" y se vuelve acero.
    const mats = new Set();
    e.root.traverse((o) => { if (o.isMesh) mats.add(o.material); });
    const saved = [...mats].map((m) => [m, m.emissive ? m.emissive.clone() : null, m.emissiveIntensity]);
    for (const [m] of saved) if (m.emissive) { m.emissive.set('#9fd0ff'); m.emissiveIntensity = 1; }
    e.root.scale.setScalar(0.001);
    tween(0.6, (t) => { this.blueprint.sheetMat.emissiveIntensity = lerp(0.18, 0.04, t); this.halo.material.opacity = t * 0.5; }, ease.linear);
    sfx.whoosh();
    await tween(0.55, (t) => e.root.scale.setScalar(Math.max(0.001, t)), ease.outBack);
    await tween(0.6, (t) => { for (const [m, em, ei] of saved) if (m.emissive) { m.emissive.lerpColors(new THREE.Color('#9fd0ff'), em, t); m.emissiveIntensity = lerp(1, ei, t); } }, ease.linear);
    for (const [m, em, ei] of saved) if (m.emissive) { m.emissive.copy(em); m.emissiveIntensity = ei; }
  }

  async dropPieces(n, onLand, sfx) {
    const e = this.engine;
    const gap = Math.max(0.14, 0.34 - n * 0.012);
    const all = [];
    for (let j = 0; j < n; j++) {
      all.push(e.dropPiece(j, onLand, (wp) => { sfx.clank(); this.burst(wp); }));
      await wait(gap);
    }
    await Promise.all(all);
    if (e.family === 'inv') {
      sfx.whoosh();
      await e.flip();
      sfx.thud(0.8);
    }
    await this.settle();
  }
  // Ajusta la altura para que el motor no atraviese el banco.
  async settle(dur = 0.4) {
    const e = this.engine;
    const b = e.bounds();
    const y1 = Math.max(0.6, 0.45 - b.min.y);
    const y0 = e.root.position.y;
    if (Math.abs(y1 - y0) > 0.01) await tween(dur, (t) => (e.root.position.y = lerp(y0, y1, t)), ease.inOutCubic);
  }
  engineFocus() {
    const e = this.engine;
    const L = e ? e.totalLength() : 2;
    const k = Math.max(1, L / 3.4);
    const y = e ? e.root.position.y : 1.2;
    return { k, y };
  }

  burst(at) {
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ffd27a' : '#ff8a2a', transparent: true }));
      m.position.copy(at);
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3);
      this.scene.add(m);
      this.sparks.push({ m, v, life: 0.5 + Math.random() * 0.3 });
    }
  }

  // manual/skipRender solo los usa el modo ?debug para avanzar el tiempo a mano.
  frame(manual, skipRender = false) {
    const raw = manual ?? Math.min(this.clock.getDelta(), 0.05);
    const dt = raw * clock.scale;
    this.time += dt;
    stepTweens(dt);
    if (this.engine) this.engine.update(dt, this.time);
    for (const f of this.onFrame) f(dt);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.v.y -= 9 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.material.opacity = Math.max(0, s.life * 2);
      if (s.life <= 0) { this.scene.remove(s.m); s.m.geometry.dispose(); s.m.material.dispose(); this.sparks.splice(i, 1); }
    }
    this.controls.update();
    // Red de seguridad: si la cámara acaba en NaN (OrbitControls en casos límite), vuelve a la última buena.
    const cp = this.camera.position, ct = this.controls.target;
    if (Number.isFinite(cp.x + cp.y + cp.z + ct.x + ct.y + ct.z)) { (this.goodCam ||= [cp.clone(), ct.clone()])[0].copy(cp); this.goodCam[1].copy(ct); }
    else if (this.goodCam) { cp.copy(this.goodCam[0]); ct.copy(this.goodCam[1]); }
    if (!skipRender) this.renderer.render(this.scene, this.camera);
  }
}

export { FAMILIES, mat, box, cyl, M };
