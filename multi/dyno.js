// Banco de potencia: rodillos bajo las ruedas motrices, cinchas de sujeción y un acelerón a fondo
// mientras se dibuja en directo la curva de potencia (y la de par) en el panel.
import * as THREE from 'three';
import { tween, wait, ease, mat, box, cyl } from './engine3d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const RR = 0.11; // radio de los rodillos

// Curva de potencia: crece con las vueltas, pico en peakRpm y cae un poco hasta el corte
export const powerAt = (hp, rpm, peak) => { const u = rpm / peak; return Math.max(0, hp * Math.pow(u, 1.4) * Math.exp(1.4 * (1 - u))); };

// Instalación fija: plataforma baja con rampas, rodillos traseros fijos y un carro delantero que
// se desliza hasta la batalla de cada coche. Solo giran los rodillos de las ruedas motrices.
export const DECK_H = 0.14;              // altura de la plataforma
const DECK_X0 = -3.2, DECK_X1 = 3.4;     // tramo plano (relativo a la zona)
const RAMP = 1.1;                        // largo de cada rampa
const DECK_W = 2.7;
export const REAR_ROLL = -1.3;           // eje trasero: rodillos fijos
const FRONT_PARK = 1.7, ROLL_DX = 0.2, POKE = 0.03; // los rodillos asoman 3 cm por encima

export class Dyno {
  constructor(shop, station) {
    this.shop = shop;
    this.st = station;
    this.group = new THREE.Group();
    this.group.position.set(station.x, 0, station.z);
    shop.scene.add(this.group);
    this.extra = new THREE.Group(); // cinchas y llamas (se ponen y se quitan en cada prueba)
    shop.scene.add(this.extra);
    this.flames = [];
    this.spin = 0;
    this.throttle = 0;
    this.build();
    this.update = (dt) => {
      // El cilindro está tumbado (rotation.x): su eje propio es la y local, así gira sobre sí mismo
      for (const r of this.spinning || []) r.rotation.y += dt * this.spin * 1.6;
      for (const w of this.driven || []) w.rotation.z -= dt * this.spin * (w.position.z < 0 ? -1 : 1) * 0.5;
      for (const f of this.flames) {
        f.material.opacity = this.throttle > 0.6 ? 0.3 + Math.random() * 0.7 * this.throttle : 0;
        f.scale.set(0.6 + Math.random() * this.throttle, 1, 1);
        f.material.color.set(Math.random() < 0.3 ? '#7fb6ff' : '#ff8a2a');
      }
      if (this.car && this.throttle > 0) {
        const j = 0.006 + this.throttle * 0.012;
        this.car.position.z = this.baseZ + (Math.random() - 0.5) * j;
      }
    };
    shop.onFrame.add(this.update);
  }

  build() {
    const g = this.group;
    const deckM = mat('#3a3e45', { roughness: 0.7, metalness: 0.35 }), dark = mat('#1f2226'), yellow = mat('#f2c230', { roughness: 0.6 });
    const rollM = mat('#9aa0a6', { metalness: 0.75, roughness: 0.3 }), groove = mat('#5c626b');
    const L = DECK_X1 - DECK_X0, cx = (DECK_X0 + DECK_X1) / 2;
    const deck = box(L, DECK_H, DECK_W, deckM); deck.position.set(cx, DECK_H / 2, 0); deck.receiveShadow = true; g.add(deck);
    // Chapa estriada y bordes amarillos
    for (let i = 0; i < 26; i++) { const r = box(0.03, 0.006, DECK_W - 0.3, dark); r.position.set(DECK_X0 + 0.15 + i * (L - 0.3) / 25, DECK_H + 0.003, 0); g.add(r); }
    for (const s of [-1, 1]) { const e = box(L, 0.012, 0.1, yellow); e.position.set(cx, DECK_H + 0.006, s * (DECK_W / 2 - 0.05)); g.add(e); }
    // Rampas a los dos lados
    const rampLen = Math.hypot(RAMP, DECK_H), ang = Math.atan2(DECK_H, RAMP);
    for (const [x, sgn] of [[DECK_X0 - RAMP / 2, 1], [DECK_X1 + RAMP / 2, -1]]) {
      const r = box(rampLen, 0.03, DECK_W, deckM); r.position.set(x, DECK_H / 2, 0); r.rotation.z = sgn * ang; r.receiveShadow = true; g.add(r);
      for (let i = 0; i < 5; i++) { const t = box(0.05, 0.012, DECK_W - 0.2, dark); t.position.set(x - sgn * (RAMP / 2 - 0.15 - i * 0.2), DECK_H * (0.12 + i * 0.18) + 0.02, 0); g.add(t); }
    }
    // Pareja de rodillos: el cilindro asoma un poco por la ranura de la plataforma
    const pair = () => {
      const p = new THREE.Group();
      const slot = box(0.75, 0.008, DECK_W - 0.24, dark); slot.position.y = DECK_H + 0.002; p.add(slot);
      p.rolls = [];
      for (const s of [-1, 1]) {
        const roll = cyl(RR, RR, DECK_W - 0.3, 18, rollM); roll.rotation.x = Math.PI / 2; roll.position.set(s * ROLL_DX, DECK_H + POKE - RR, 0);
        for (let k = 0; k < 6; k++) { const gg = box(0.012, DECK_W - 0.32, 0.03, groove); const a = (k / 6) * Math.PI * 2; gg.position.set(Math.cos(a) * RR, 0, Math.sin(a) * RR); gg.rotation.y = -a; roll.add(gg); } // estrías: se nota el giro
        p.add(roll); p.rolls.push(roll);
      }
      g.add(p);
      return p;
    };
    this.rear = pair(); this.rear.position.x = REAR_ROLL;
    this.front = pair(); this.front.position.x = FRONT_PARK;
    // Carril por el que corre el carro delantero
    for (const s of [-1, 1]) { const rail = box(2.4, 0.01, 0.05, mat('#8a9097', { metalness: 0.7 })); rail.position.set(1.65, DECK_H + 0.004, s * (DECK_W / 2 - 0.2)); g.add(rail); }
  }

  // Altura del suelo bajo un punto del mundo (para que el coche suba y baje la rampa)
  heightAt(x, z) {
    const lx = x - this.st.x, lz = z - this.st.z;
    if (Math.abs(lz) > DECK_W / 2 + 0.2) return 0;
    if (lx < DECK_X0 - RAMP || lx > DECK_X1 + RAMP) return 0;
    if (lx < DECK_X0) return DECK_H * (lx - DECK_X0 + RAMP) / RAMP;
    if (lx > DECK_X1) return DECK_H * (DECK_X1 + RAMP - lx) / RAMP;
    return DECK_H;
  }
  // Dónde debe pararse el coche para que el eje trasero caiga en los rodillos fijos
  stopX(rig) {
    const rear = rig.body.filter((o) => o.userData.isWheel && o.position.x <= 0);
    return this.st.x + REAR_ROLL - rear[0].position.x;
  }

  reset() {
    for (const c of [...this.extra.children]) this.extra.remove(c);
    this.flames = []; this.driven = null; this.spinning = null; this.car = null;
    this.spin = 0; this.throttle = 0;
    this.front.position.x = FRONT_PARK;
  }

  // El carro delantero se coloca bajo el eje delantero, el coche asienta en los rodillos y se ata
  async setup(rig, traction, sfx) {
    const car = this.car = rig.car;
    this.baseZ = car.position.z;
    const wheels = rig.body.filter((o) => o.userData.isWheel);
    const front = wheels.filter((w) => w.position.x > 0), rear = wheels.filter((w) => w.position.x <= 0);
    this.driven = traction === 'TD' ? front : traction === 'TT' ? rear : wheels;
    this.spinning = [...(traction !== 'TT' ? this.front.rolls : []), ...(traction !== 'TD' ? this.rear.rolls : [])];
    const fx = car.position.x + front[0].position.x - this.st.x;
    const x0 = this.front.position.x;
    sfx.whoosh();
    await tween(Math.min(1.4, 0.4 + Math.abs(fx - x0)), (t) => (this.front.position.x = x0 + (fx - x0) * t), ease.inOutCubic);
    sfx.clank();
    // Las ruedas se encajan entre los dos rodillos
    const r = wheels[0].children[0].geometry.parameters.radiusTop;
    const sink = Math.max(0, r + RR - POKE - Math.sqrt((r + RR) ** 2 - ROLL_DX * ROLL_DX));
    const y0 = car.position.y;
    await tween(0.35, (t) => (car.position.y = y0 - sink * t), ease.inOutCubic);
    this.sink = sink;
    sfx.thud(0.4);
    // Cinchas a los anclajes de la plataforma
    const strapM = new THREE.LineBasicMaterial({ color: '#ffb627' });
    const baseM = mat('#2b2f35');
    const bottom = rig.underAt(0, 0.5);
    for (const [lx, ax] of [[rig.carMax - 0.3, 0.9], [rig.carMin + 0.3, -0.9]]) for (const s of [-1, 1]) {
      const a = car.localToWorld(V(lx, bottom + 0.05, s * 0.6));
      const b = V(a.x + ax, DECK_H + 0.02, a.z + s * 0.75);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([b, b.clone()]), strapM);
      this.extra.add(line);
      const anchor = cyl(0.06, 0.06, 0.04, 8, baseM); anchor.position.copy(b); this.extra.add(anchor);
      tween(0.4, (t) => { line.geometry.attributes.position.setXYZ(1, b.x + (a.x - b.x) * t, b.y + (a.y - b.y) * t, b.z + (a.z - b.z) * t); line.geometry.attributes.position.needsUpdate = true; }, ease.outCubic);
    }
    await wait(0.45);
    sfx.clank();
    // Llamas en el escape (detrás)
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 10).rotateZ(Math.PI / 2).translate(-0.25, 0, 0), new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      f.position.copy(car.localToWorld(V(rig.carMin - 0.02, Math.max(0.25, bottom + 0.08), s * 0.3)));
      this.extra.add(f);
      this.flames.push(f);
    }
  }

  // Acelerón a fondo: onSample(rpm, cv, nm, frac) para dibujar la curva
  async pull(hp, peak, redline, sfxHooks, onSample) {
    const idle = 900;
    await tween(5.5, (t) => {
      const rpm = idle + (redline - idle) * t;
      const cv = powerAt(hp, rpm, peak);
      this.throttle = 1;
      this.spin = rpm / 500;
      sfxHooks.rpm(rpm / redline);
      onSample(rpm, cv, cv * 7023 / rpm, t);
    }, ease.inQuad);
    // Suelta el gas
    await tween(1.4, (t) => { this.throttle = 1 - t; this.spin = (redline / 500) * (1 - t); sfxHooks.rpm((1 - t) * 0.9); }, ease.outCubic);
    this.throttle = 0; this.spin = 0;
    if (this.car) this.car.position.z = this.baseZ;
  }

  // Se sueltan las cinchas y el coche sale de los rodillos
  async teardown(rig) {
    const car = rig.car;
    const y0 = car.position.y, sink = this.sink || 0;
    for (const c of [...this.extra.children]) this.extra.remove(c);
    this.flames = [];
    await tween(0.4, (t) => (car.position.y = y0 + sink * t), ease.inOutCubic);
    this.driven = null; this.spinning = null; this.car = null;
  }
}
