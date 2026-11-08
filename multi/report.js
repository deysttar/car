// Mesa del informe: una mesa de oficina con sus cosas (monitor, teclado, taza, bolis, lámpara...)
// y una impresora. La hoja del informe se dibuja en un canvas y sale de la impresora sobre la mesa.
import * as THREE from 'three';
import { tween, wait, ease, mat, box, cyl } from './engine3d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DESK_H = 0.78;
const TOP = DESK_H + 0.001;  // superficie de la mesa
const SLOT_X = 0.76;         // boca de la impresora (la hoja sale hacia -x)
const LANE_Z = 0.12;         // por dónde sale la hoja
const PW = 0.44;             // ancho de la hoja

function canvasTex(cv) { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

// Dibuja el informe en un canvas. data: { serial, date, model, type, sections: [{ title, rows: [[label, value, tag?, color?]] }], score, ok }
export function drawReport(data) {
  const W = 880, pad = 56, line = 46;
  const rows = data.sections.reduce((a, s) => a + s.rows.length, 0);
  const H = pad * 2 + 300 + data.sections.length * 90 + rows * line + 260;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#f7f2e6'; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(0,0,0,0.035)'; c.lineWidth = 1;
  for (let y = 0; y < H; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  const ink = '#1d1b18', grey = '#6b655c';
  let y = pad + 40;
  c.fillStyle = ink; c.font = '700 44px "Clash Display", "Satoshi", sans-serif'; c.fillText('RULETA MOTORS', pad, y);
  y += 40;
  c.font = '600 20px "Satoshi", sans-serif'; c.fillStyle = grey;
  c.fillText('INFORME DE FABRICACIÓN', pad, y); c.textAlign = 'right'; c.fillText(data.date, W - pad, y);
  y += 30; c.textAlign = 'left'; c.fillText('Nº DE SERIE', pad, y); c.textAlign = 'right'; c.fillText(data.serial, W - pad, y); c.textAlign = 'left';
  y += 72; c.fillStyle = ink; c.font = '700 64px "Clash Display", "Satoshi", sans-serif'; c.fillText(data.model, pad, y);
  y += 38; c.fillStyle = grey; c.font = '500 26px "Satoshi", sans-serif'; c.fillText(data.type, pad, y);
  y += 26;
  for (const sec of data.sections) {
    y += 58;
    c.fillStyle = ink; c.font = '700 21px "Satoshi", sans-serif'; c.fillText(sec.title.toUpperCase().split('').join(' '), pad, y);
    c.fillRect(pad, y + 10, W - 2 * pad, 3);
    y += 12;
    for (const [label, value, tag, color] of sec.rows) {
      y += line;
      c.font = '500 25px "Satoshi", sans-serif'; c.fillStyle = '#57524a'; c.textAlign = 'left'; c.fillText(label, pad, y);
      let x = W - pad;
      c.textAlign = 'right';
      if (tag) { c.font = '700 18px "Satoshi", sans-serif'; c.fillStyle = color || grey; c.fillText(`● ${tag}`, x, y); x -= c.measureText(`● ${tag}`).width + 14; }
      c.font = '700 25px "Satoshi", sans-serif'; c.fillStyle = ink; c.fillText(value, x, y);
      c.textAlign = 'left';
      c.setLineDash([2, 5]); c.strokeStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.moveTo(pad, y + 14); c.lineTo(W - pad, y + 14); c.stroke(); c.setLineDash([]);
    }
  }
  // Puntuación
  y += 70; c.fillStyle = ink; c.fillRect(pad, y - 40, W - 2 * pad, 3); c.fillRect(pad, y - 34, W - 2 * pad, 2);
  c.font = '700 26px "Satoshi", sans-serif'; c.fillText('PUNTUACIÓN FINAL', pad, y + 30);
  c.font = '700 84px "Clash Display", "Satoshi", sans-serif'; c.textAlign = 'right'; c.fillText(`${data.score}/100`, W - pad, y + 50); c.textAlign = 'left';
  // Código de barras
  y += 90; let bx = pad + 120;
  for (const ch of (data.serial + 'RULETA').split('')) { const k = ch.charCodeAt(0); for (let j = 0; j < 4; j++) { const w = 2 + ((k >> j) & 3) * 2; c.fillRect(bx, y, w, 56); bx += w + 3 + ((k >> (j + 1)) & 1) * 3; } }
  c.font = '600 16px "Satoshi", sans-serif'; c.fillStyle = grey; c.textAlign = 'center';
  c.fillText('GRACIAS POR CONSTRUIR CON RULETA MOTORS', W / 2, y + 90); c.textAlign = 'left';
  return cv;
}

function stampCanvas(ok) {
  const cv = document.createElement('canvas'); cv.width = 520; cv.height = 180;
  const c = cv.getContext('2d');
  const col = ok ? '#2f8f5b' : '#c27a00';
  c.strokeStyle = col; c.fillStyle = col;
  c.lineWidth = 10; c.strokeRect(14, 14, 492, 152);
  c.lineWidth = 4; c.strokeRect(30, 30, 460, 120);
  c.font = '700 74px "Clash Display", "Satoshi", sans-serif'; c.textAlign = 'center'; c.fillText(ok ? 'APROBADO' : 'APROBADO*', 260, 116);
  return cv;
}

export class ReportDesk {
  constructor(scene, station) {
    this.group = new THREE.Group();
    this.group.position.set(station.x, 0, station.z);
    scene.add(this.group);
    this.build();
    this.paper = null;
  }

  build() {
    const g = this.group;
    const put = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
    const wood = mat('#8b6a4a', { roughness: 0.75 }), metal = mat('#3a3f46', { metalness: 0.5, roughness: 0.4 }), dark = mat('#1f2125', { roughness: 0.6 });
    // Mesa, patas y cajonera
    put(box(2.6, 0.05, 1.25, wood), 0, DESK_H - 0.025, 0);
    for (const [x, z] of [[-1.24, -0.56], [1.24, -0.56], [-1.24, 0.56], [1.24, 0.56]]) put(box(0.05, DESK_H - 0.05, 0.05, metal), x, (DESK_H - 0.05) / 2, z);
    put(box(0.45, 0.62, 1.05, mat('#4a4f57', { roughness: 0.6 })), 0.95, 0.33, 0);
    for (let i = 0; i < 3; i++) put(box(0.2, 0.02, 0.02, mat('#c9cdd2', { metalness: 0.7 })), 0.72, 0.15 + i * 0.2, 0);
    // Silla
    put(box(0.5, 0.08, 0.5, dark), -0.2, 0.48, 0.85);
    const back = put(box(0.5, 0.6, 0.06, dark), -0.2, 0.86, 1.1); back.rotation.x = -0.12;
    put(cyl(0.03, 0.03, 0.4, 8, metal), -0.2, 0.24, 0.85);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const leg = box(0.3, 0.03, 0.04, metal); leg.rotation.y = a; leg.position.set(-0.2 + Math.cos(a) * 0.15, 0.04, 0.85 - Math.sin(a) * 0.15); g.add(leg); }
    // Monitor con un panel de datos en pantalla
    put(box(0.26, 0.02, 0.18, dark), -0.2, TOP + 0.01, -0.52);
    put(box(0.05, 0.32, 0.05, dark), -0.2, TOP + 0.17, -0.54);
    put(box(1.02, 0.6, 0.04, dark), -0.2, TOP + 0.52, -0.53);
    const scv = document.createElement('canvas'); scv.width = 512; scv.height = 300;
    const sc = scv.getContext('2d');
    sc.fillStyle = '#0d1b2a'; sc.fillRect(0, 0, 512, 300);
    sc.fillStyle = '#ff6a1a'; sc.font = '700 30px "Satoshi", sans-serif'; sc.fillText('RULETA MOTORS', 24, 46);
    sc.strokeStyle = '#7fc4ff'; sc.lineWidth = 4; sc.beginPath();
    for (let i = 0; i <= 20; i++) { const x = 24 + i * 22, yy = 240 - Math.pow(i / 20, 1.4) * Math.exp(1.4 * (1 - i / 20)) * 150; i ? sc.lineTo(x, yy) : sc.moveTo(x, yy); }
    sc.stroke();
    sc.fillStyle = '#5fd38d'; for (let i = 0; i < 4; i++) sc.fillRect(330, 90 + i * 34, 60 + i * 30, 16);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.55), new THREE.MeshBasicMaterial({ map: canvasTex(scv) }));
    put(screen, -0.2, TOP + 0.52, -0.508);
    for (const [x, c] of [[0.24, '#ffe066'], [0.19, '#ff9fb2']]) { const n = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.07), mat(c, { roughness: 0.9 })); n.position.set(x, TOP + 0.74, -0.506); n.rotation.z = 0.1; g.add(n); }
    // Teclado y ratón con alfombrilla
    put(box(0.62, 0.025, 0.2, mat('#2b2d33', { roughness: 0.5 })), -0.2, TOP + 0.013, -0.3);
    const keyM = mat('#d8dde2', { roughness: 0.6 });
    for (let r = 0; r < 4; r++) for (let k = 0; k < 13; k++) put(box(0.036, 0.012, 0.034, keyM), -0.2 - 0.27 + k * 0.045, TOP + 0.03, -0.37 + r * 0.045);
    put(box(0.26, 0.004, 0.22, mat('#1d1f23')), 0.33, TOP + 0.002, -0.32);
    put(box(0.065, 0.03, 0.11, mat('#d8dde2', { roughness: 0.4 })), 0.33, TOP + 0.02, -0.32);
    // Taza de café
    const mug = mat('#f2efe6', { roughness: 0.3 });
    put(cyl(0.05, 0.045, 0.11, 16, mug), -0.95, TOP + 0.055, 0.32);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 6, 14), mug); handle.position.set(-0.9, TOP + 0.06, 0.32); handle.rotation.y = Math.PI / 2; g.add(handle);
    put(cyl(0.046, 0.046, 0.005, 16, mat('#3b2416', { roughness: 0.2 })), -0.95, TOP + 0.1, 0.32);
    // Bote de bolis y bolis sueltos
    put(cyl(0.05, 0.05, 0.11, 12, mat('#2b4c9b', { roughness: 0.5 })), -1.05, TOP + 0.055, -0.36);
    ['#d6402b', '#1d1f23', '#2f8fd8', '#ffb627'].forEach((c, i) => { const p = cyl(0.006, 0.006, 0.17, 6, mat(c)); p.position.set(-1.05 + (i - 1.5) * 0.02, TOP + 0.13, -0.36 + (i % 2) * 0.02); p.rotation.set((i - 1.5) * 0.12, 0, (i - 1.5) * 0.1); g.add(p); });
    for (const [x, z, a, c] of [[-0.62, 0.46, 0.4, '#1d1f23'], [-0.55, 0.5, -0.3, '#d6402b']]) { const p = cyl(0.006, 0.006, 0.15, 6, mat(c)); p.rotation.set(Math.PI / 2, 0, 0); p.rotation.y = a; p.position.set(x, TOP + 0.007, z); g.add(p); }
    // Papeles y libreta
    for (let i = 0; i < 3; i++) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.42).rotateX(-Math.PI / 2), mat('#f4f1ea', { roughness: 0.95 })); sh.position.set(-0.78, TOP + 0.002 + i * 0.002, -0.12); sh.rotation.y = (i - 1) * 0.12; g.add(sh); }
    put(box(0.2, 0.015, 0.28, mat('#c8302a', { roughness: 0.7 })), -1.08, TOP + 0.008, 0.05);
    // Lámpara de mesa con su luz
    put(cyl(0.08, 0.09, 0.025, 14, dark), 1.1, TOP + 0.013, -0.45);
    const arm = box(0.025, 0.42, 0.025, dark); arm.position.set(1.08, TOP + 0.22, -0.4); arm.rotation.x = 0.35; g.add(arm);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 14, 1, true), mat('#ff6a1a', { side: THREE.DoubleSide, roughness: 0.5 }));
    head.position.set(1.06, TOP + 0.42, -0.26); head.rotation.x = -0.6; g.add(head);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff1d6' })); bulb.position.set(1.06, TOP + 0.4, -0.24); g.add(bulb);
    this.lamp = new THREE.PointLight('#fff1d6', 2.5, 3, 1.5); this.lamp.position.set(1.0, TOP + 0.35, -0.15); g.add(this.lamp);
    // Planta
    put(cyl(0.07, 0.055, 0.12, 12, mat('#b5651d', { roughness: 0.8 })), 1.18, TOP + 0.06, 0.5);
    for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), mat('#2f8f5b', { roughness: 0.7 })); l.position.set(1.18 + Math.cos(i) * 0.05, TOP + 0.16 + (i % 3) * 0.04, 0.5 + Math.sin(i * 2) * 0.05); l.scale.set(1, 1.4, 0.6); g.add(l); }
    // Impresora (la hoja sale por la boca hacia -x)
    put(box(0.42, 0.17, 0.4, mat('#3a3d43', { roughness: 0.5 })), 0.98, TOP + 0.085, LANE_Z);
    put(box(0.4, 0.02, 0.36, mat('#4a4f57', { roughness: 0.4 })), 0.98, TOP + 0.18, LANE_Z);
    put(box(0.02, 0.012, 0.32, mat('#0b0c0e')), SLOT_X, TOP + 0.05, LANE_Z);
    this.led = new THREE.MeshBasicMaterial({ color: '#2a3a30' });
    put(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.02), this.led), 1.12, TOP + 0.192, LANE_Z + 0.14);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  // Punto de la mesa en coordenadas del mundo
  world(x, y, z) { return V(this.group.position.x + x, y, this.group.position.z + z); }
  slotWorld() { return this.world(SLOT_X, TOP, LANE_Z); }

  reset() {
    for (const o of [this.paper, this.stampMesh]) if (o) { this.group.remove(o); o.geometry.dispose(); }
    this.paper = this.stampMesh = null;
    this.led.color.set('#2a3a30');
  }

  // Imprime: la hoja sale de la impresora. onLen(longitud que ya ha salido) para mover la cámara.
  async print(data, sfx, onLen) {
    this.reset();
    const cv = drawReport(data);
    const PL = PW * (cv.height / cv.width);
    this.paperLen = PL;
    const geo = new THREE.PlaneGeometry(PW, PL).rotateX(-Math.PI / 2).rotateY(Math.PI / 2).translate(-PL / 2, 0, 0);
    // Lo que aún está dentro de la impresora no se ve
    const slot = this.slotWorld();
    const clip = new THREE.Plane(V(-1, 0, 0), slot.x);
    const paper = this.paper = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: canvasTex(cv), roughness: 0.9, clippingPlanes: [clip] }));
    paper.receiveShadow = true;
    paper.position.set(SLOT_X + PL, TOP + 0.004, LANE_Z);
    this.group.add(paper);
    this.led.color.set('#5fd38d');
    let lastLine = -1;
    await tween(Math.max(3.5, PL * 3.2), (t) => {
      const l = PL * t;
      paper.position.x = SLOT_X - l + PL;
      onLen && onLen(l, PL);
      const line = Math.floor(l / 0.02);
      if (line !== lastLine) { lastLine = line; sfx.printTick(); }
    }, ease.linear);
    paper.position.x = SLOT_X;
    this.led.color.set('#2a3a30');
  }

  // Sello sobre la hoja ya impresa
  async stamp(ok, sfx) {
    const cv = stampCanvas(ok);
    const w = 0.2, h = w * (cv.height / cv.width);
    const geo = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).rotateY(Math.PI / 2 + 0.22);
    const m = this.stampMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: canvasTex(cv), transparent: true, opacity: 0, depthWrite: false }));
    m.position.set(SLOT_X - this.paperLen + 0.13, TOP + 0.006, LANE_Z - 0.1); // junto a la cabecera, sin tapar datos
    this.group.add(m);
    await tween(0.25, (t) => { m.scale.setScalar(2.4 - 1.4 * t); m.material.opacity = Math.min(0.9, t * 1.5); }, ease.inQuad);
    sfx.stamp();
  }

  // Límites del recorrido de la cámara por la hoja (x del mundo): de arriba a abajo
  paperRange() {
    const top = this.group.position.x + SLOT_X - this.paperLen;
    return [top + 0.3, this.group.position.x + SLOT_X - 0.2];
  }
  laneZ() { return this.group.position.z + LANE_Z; }
  topY() { return TOP; }
}
