// Salón del automóvil: la presentación ya no es en el taller. Es un pabellón de exposición lejos
// del taller (la niebla lo separa): suelo oscuro brillante, pantalla LED gigante, estructura de
// focos, cordones y coches de otras marcas en sus peanas. El coche nuevo gira en la peana central.
import * as THREE from 'three';
import { tween, ease, mat, box, cyl } from './engine3d.js';
import { buildCar } from '../car3d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const HALL = { x: 0, z: -170 };
const W = 44, D = 30, H = 11;
const PODIUM_R = 3.3, PODIUM_H = 0.28;

function screenTexture() {
  const cv = document.createElement('canvas');
  cv.width = 2048; cv.height = 640;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return { cv, t };
}

export class CarShow {
  constructor(shop) {
    this.shop = shop;
    this.group = new THREE.Group();
    this.group.position.set(HALL.x, 0, HALL.z);
    this.group.visible = false; // solo existe durante la presentación (sus luces no cuestan en el taller)
    shop.scene.add(this.group);
    this.time = 0;
    this.spinning = false;
    this.title = 'SALÓN DEL AUTOMÓVIL';
    this.sub = 'PRESENTACIÓN MUNDIAL · NUEVO MODELO';
    this.lights = [];   // luces de sala (se atenúan para el redoble)
    this.spotsOn = [];  // focos de la peana
    this.build();
    this.update = (dt) => {
      this.time += dt;
      if (this.spinning) this.turn.rotation.y += dt * 0.35;
      this.ringMat.emissiveIntensity = 1.2 + Math.sin(this.time * 2.4) * 0.4;
      if (Math.floor(this.time * 10) !== this.lastDraw) { this.lastDraw = Math.floor(this.time * 10); this.drawScreen(); }
    };
    shop.onFrame.add(this.update);
  }

  build() {
    const g = this.group;
    const dark = mat('#15171b', { roughness: 0.6 }), steel = mat('#2f3338', { roughness: 0.4, metalness: 0.7 });
    // Suelo: resina oscura muy pulida y moqueta bajo la peana
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1d2026', roughness: 0.18, metalness: 0.45 }));
    floor.receiveShadow = true; g.add(floor);
    const carpet = new THREE.Mesh(new THREE.CircleGeometry(6.2, 64).rotateX(-Math.PI / 2), mat('#2a1c22', { roughness: 0.95 }));
    carpet.position.y = 0.004; carpet.receiveShadow = true; g.add(carpet);
    // Paredes y techo negros con tiras de luz
    const wallM = mat('#101216', { roughness: 0.9 });
    for (const [w, x, z, ry] of [[W, 0, -D / 2, 0], [D, -W / 2, 0, Math.PI / 2], [D, W / 2, 0, -Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallM); m.position.set(x, H / 2, z); m.rotation.y = ry; g.add(m);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), wallM); ceil.position.y = H; g.add(ceil);
    const strip = new THREE.MeshBasicMaterial({ color: '#ff8a3d' });
    for (const z of [-D / 2 + 0.05]) for (const y of [0.25, 9.6]) { const s = box(W, 0.06, 0.02, strip); s.position.set(0, y, z + 0.02); g.add(s); }
    for (const s of [-1, 1]) for (const y of [0.25, 9.6]) { const b = box(0.02, 0.06, D, strip); b.position.set(s * (W / 2 - 0.03), y, 0); g.add(b); }
    // Pantalla LED gigante al fondo
    this.scr = screenTexture();
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(19, 5.9), new THREE.MeshBasicMaterial({ map: this.scr.t, toneMapped: false }));
    screen.position.set(0, 4.6, -D / 2 + 0.3); g.add(screen);
    const frame = box(19.4, 6.3, 0.2, dark); frame.position.set(0, 4.6, -D / 2 + 0.18); g.add(frame);
    // Peana giratoria con anillo de luz
    this.turn = new THREE.Group();
    this.turn.position.y = PODIUM_H;
    const base = cyl(PODIUM_R + 0.15, PODIUM_R + 0.3, PODIUM_H, 64, mat('#22252b', { roughness: 0.3, metalness: 0.6 }));
    base.position.y = PODIUM_H / 2; base.receiveShadow = true; g.add(base);
    this.ringMat = new THREE.MeshStandardMaterial({ color: '#ff6a1a', emissive: '#ff6a1a', emissiveIntensity: 1.2 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(PODIUM_R + 0.28, 0.025, 8, 96), this.ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    const top = cyl(PODIUM_R, PODIUM_R, 0.04, 64, mat('#3a3e45', { roughness: 0.25, metalness: 0.5 }));
    top.position.y = -0.02; top.receiveShadow = true; this.turn.add(top);
    this.top = top;
    g.add(this.turn);
    // Cordones alrededor
    const ropeM = mat('#7a1424', { roughness: 0.7 }), chrome = mat('#cfd6dc', { roughness: 0.2, metalness: 0.9 });
    const posts = 14, R = 5.6;
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      if (Math.abs(Math.sin(a)) < 0.25 && Math.cos(a) > 0) continue; // hueco delante, hacia el público
      const p = cyl(0.04, 0.04, 0.95, 10, chrome); p.position.set(Math.cos(a) * R, 0.48, Math.sin(a) * R); g.add(p);
      const b = cyl(0.18, 0.2, 0.04, 16, chrome); b.position.set(Math.cos(a) * R, 0.02, Math.sin(a) * R); g.add(b);
      const a2 = ((i + 1) / posts) * Math.PI * 2;
      if (Math.abs(Math.sin(a2)) < 0.25 && Math.cos(a2) > 0) continue;
      const pa = V(Math.cos(a) * R, 0.85, Math.sin(a) * R), pb = V(Math.cos(a2) * R, 0.85, Math.sin(a2) * R);
      const mid = pa.clone().lerp(pb, 0.5); mid.y -= 0.12;
      const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(pa, mid, pb), 10, 0.025, 6), ropeM); g.add(rope);
    }
    // Estructura de focos (truss) sobre la peana
    const trussY = 7.2, T = 6.6; // las torres quedan fuera de los planos de cámara
    for (const s of [-1, 1]) {
      for (const k of [-1, 1]) { const bar = box(2 * T, 0.08, 0.08, steel); bar.position.set(0, trussY + k * 0.2, s * T); g.add(bar); }
      for (const k of [-1, 1]) { const bar = box(0.08, 0.08, 2 * T, steel); bar.position.set(s * T, trussY + k * 0.2, 0); g.add(bar); }
      for (const k of [-1, 1]) { const col = box(0.25, trussY, 0.25, steel); col.position.set(s * T, trussY / 2, k * T); g.add(col); }
    }
    // Focos de la peana: fijos en el truss; se encienden en la presentación (suaves, sin deslumbrar)
    for (const [x, z] of [[T, T], [-T, T], [T, -T], [-T, -T]]) {
      const head = cyl(0.16, 0.22, 0.4, 12, dark); head.position.set(x * 0.92, trussY - 0.35, z * 0.92); g.add(head);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), new THREE.MeshBasicMaterial({ color: '#2a2a2a' }));
      lens.position.set(x * 0.92, trussY - 0.56, z * 0.92); lens.rotation.x = Math.PI / 2; g.add(lens);
      const sp = new THREE.SpotLight('#ffe9d0', 0, 22, 0.42, 0.7, 1.4);
      sp.userData.showcase = true;
      sp.position.set(x * 0.92, trussY - 0.5, z * 0.92);
      sp.target.position.set(0, 0.6, 0);
      g.add(sp, sp.target);
      this.spotsOn.push({ sp, lens });
    }
    // Luz de sala: cálida y repartida
    for (const [x, z] of [[-12, -6], [12, -6], [-12, 7], [12, 7], [0, 9]]) {
      const pl = new THREE.PointLight('#ffd9b0', 0, 26, 1.5);
      pl.userData.showcase = true; pl.userData.house = 34;
      pl.position.set(x, 8.5, z); g.add(pl); this.lights.push(pl);
    }
    const key = new THREE.SpotLight('#fff1e0', 0, 30, 0.5, 0.8, 1.2);
    key.userData.showcase = true; key.userData.house = 90;
    key.position.set(4, 10, 9); key.target.position.set(0, 0.5, 0); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    g.add(key, key.target); this.lights.push(key);
    // Otros coches del salón en sus peanas
    const others = [
      ['deportivo', '#c9ccd1', -13.5, -6.5, 0.6], ['suv', '#1f3f6b', 13.5, -6.5, -0.6],
      ['coupe', '#8a1f24', -14, 6, 2.4], ['turismo', '#e7e4dc', 14, 6, -2.4],
    ];
    others.forEach(([typeId, color, x, z, ry], i) => {
      const ped = cyl(2.6, 2.7, 0.18, 48, mat('#24272d', { roughness: 0.3, metalness: 0.5 })); ped.position.set(x, 0.09, z); ped.receiveShadow = true; g.add(ped);
      const c = buildCar({ typeId, engineId: 'e9', intakeId: 'i4', turboId: 't0', tractionId: 'TT', aeroId: 'a50', perf: 90, color, seed: 401 + i * 17 });
      c.position.set(x, 0.18, z); c.rotation.y = ry;
      c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(c);
      const sp = new THREE.SpotLight('#fff0dc', 0, 14, 0.5, 0.8, 1.4);
      sp.userData.showcase = true; sp.userData.house = 26;
      sp.position.set(x * 0.8, 8, z * 0.8 + 1); sp.target.position.set(x, 0.5, z); g.add(sp, sp.target); this.lights.push(sp);
      // Tótem con la ficha
      const totem = box(0.7, 1.6, 0.08, dark); totem.position.set(x + (x > 0 ? -2.9 : 2.9), 0.8, z + 2.2); g.add(totem);
      const face = box(0.6, 1.2, 0.01, new THREE.MeshBasicMaterial({ color: '#ff8a3d' })); face.position.set(totem.position.x, 0.95, z + 2.245); g.add(face);
    });
    this.drawScreen();
  }

  drawScreen() {
    const { cv, t } = this.scr, c = cv.getContext('2d');
    const w = cv.width, h = cv.height, k = this.time;
    const gr = c.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#0b0d14'); gr.addColorStop(0.5 + Math.sin(k * 0.4) * 0.25, '#3a1608'); gr.addColorStop(1, '#0b0d14');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,138,61,0.18)'; c.lineWidth = 3;
    for (let i = 0; i < 14; i++) { const x = ((i * 170 + k * 120) % (w + 400)) - 200; c.beginPath(); c.moveTo(x, h); c.lineTo(x + 260, 0); c.stroke(); }
    c.textAlign = 'center';
    c.fillStyle = '#ff8a3d'; c.font = '600 54px "Clash Display", sans-serif';
    c.fillText(this.sub, w / 2, 190);
    c.fillStyle = '#ffffff'; c.font = '700 190px "Clash Display", sans-serif';
    c.fillText(this.title, w / 2, 420, w - 120);
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.font = '500 44px "Satoshi", sans-serif';
    c.fillText('RULETA MOTORS', w / 2, 540);
    t.needsUpdate = true;
  }
  setScreen(title, sub) { this.title = title; this.sub = sub; this.drawScreen(); }

  center() { return V(HALL.x, PODIUM_H + 0.6, HALL.z); }

  // El coche aparece en la peana (durante el fundido a negro)
  place(rig) {
    const car = rig.car;
    car.position.set(0, -0.006, 0);
    car.rotation.set(0, -0.55, 0);
    this.turn.add(car);
    this.turn.rotation.y = 0;
    car.updateMatrixWorld(true);
  }

  // Luz de sala: 0 apagada, 1 normal
  house(k, dur = 0.8) {
    const from = this.lights.map((l) => l.intensity);
    return tween(dur, (t) => this.lights.forEach((l, i) => { l.intensity = from[i] + (l.userData.house * k - from[i]) * t; }), ease.inOutCubic);
  }

  // Focos de la peana, uno a uno: luz blanda que no deslumbra
  async spots(sfx, power = 38) {
    for (const { sp, lens } of this.spotsOn) {
      sfx.thud(0.5); sfx.clank();
      lens.material.color.set('#fff3dc');
      await tween(0.35, (t) => (sp.intensity = power * t), ease.outCubic);
    }
  }

  // Ambiente del salón: niebla y fondo propios (se restauran al volver al taller)
  enter() {
    const s = this.shop.scene;
    this.group.visible = true;
    this.saved = { bg: s.background.clone(), fog: s.fog.color.clone(), near: s.fog.near, far: s.fog.far };
    s.background.set('#07080b'); s.fog.color.set('#07080b'); s.fog.near = 30; s.fog.far = 70;
  }
  leave() {
    this.group.visible = false;
    if (!this.saved) return;
    const s = this.shop.scene;
    s.background.copy(this.saved.bg); s.fog.color.copy(this.saved.fog); s.fog.near = this.saved.near; s.fog.far = this.saved.far;
    this.saved = null;
  }

  reset() {
    this.leave();
    this.spinning = false;
    this.turn.rotation.y = 0;
    for (const c of [...this.turn.children]) if (c !== this.top) this.turn.remove(c);
    for (const { sp, lens } of this.spotsOn) { sp.intensity = 0; lens.material.color.set('#2a2a2a'); }
    for (const l of this.lights) l.intensity = 0;
    this.setScreen('SALÓN DEL AUTOMÓVIL', 'PRESENTACIÓN MUNDIAL · NUEVO MODELO');
  }
}
