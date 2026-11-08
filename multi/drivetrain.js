// Fase de tracción: el coche se vuelve transparente (rayos X) y desde el motor sale un hilo de
// energía que va construyendo la transmisión hasta las ruedas motrices: delantera, trasera o 4x4.
import * as THREE from 'three';
import { tween, wait, ease, grow, mat, box, cyl } from './engine3d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const isWheel = (o) => { for (let p = o; p; p = p.parent) if (p.userData.isWheel) return true; return false; };
const SPEED = 2.4; // velocidad del hilo (unidades por segundo)

// Textura de "energía": franjas brillantes que se desplazan a lo largo del tubo
function flowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 8;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,120,30,0.25)');
  g.addColorStop(0.55, 'rgba(255,170,80,0.9)');
  g.addColorStop(0.7, 'rgba(255,240,200,1)');
  g.addColorStop(0.85, 'rgba(255,140,40,0.6)');
  g.addColorStop(1, 'rgba(255,120,30,0.25)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 8);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Drivetrain {
  // xrayRoot: lo que se vuelve transparente (el elevador entero, que contiene el coche)
  constructor(shop, rig, traction, xrayRoot = null) {
    this.xrayRoot = xrayRoot || rig.car;
    this.shop = shop;
    this.rig = rig;
    this.traction = traction;
    this.car = rig.car;
    this.group = new THREE.Group();
    this.car.add(this.group);
    this.glows = [];
    this.spinning = [];
    this.flowOn = false;
    this.head = null; // punto que sigue la cámara (coordenadas del mundo)
    this.wheels = rig.body.filter((o) => o.userData.isWheel).map((w) => {
      const tire = w.children[0];
      const width = tire.geometry.parameters ? tire.geometry.parameters.height : 0.26;
      return { obj: w, pos: w.position.clone(), width, front: w.position.x > 0 };
    });
    this.tex = flowTexture();
    this.update = (dt) => {
      // cada tubo tiene su copia de la textura: se desplazan todas para que la energía fluya
      for (const g of this.glows) g.material.map.offset.x -= dt * 2.2;
      for (const w of this.spinning) w.obj.rotation.z -= dt * w.speed * (w.obj.position.z < 0 ? -1 : 1);
    };
    shop.onFrame.add(this.update);
  }

  // ---------- Rayos X ----------
  // Todo lo del coche salvo motor, ruedas y transmisión se vuelve casi transparente.
  async xray(on, dur = 0.7) {
    const engineRoot = this.shop.engine && this.shop.engine.root;
    const inEngine = (o) => { for (let p = o; p; p = p.parent) if (p === engineRoot) return true; return false; };
    if (on) {
      this.faded = [];
      // El motor se ocultó al cerrar el capó (asomaba por arriba): en rayos X vuelve a verse
      this.engineHidden = !!engineRoot && !engineRoot.visible;
      const own = new Set(this.rig.clones ? this.rig.clones.values() : []);
      const swapped = new Map();
      const inCar = (o) => { for (let p = o; p; p = p.parent) if (p === this.car) return true; return false; };
      this.xrayRoot.traverse((o) => {
        if (!o.isMesh || isWheel(o)) return;
        for (let p = o; p; p = p.parent) if (p === this.group) return;
        let m = o.material;
        if (!own.has(m)) {
          // Material compartido (caché): se usa una copia para no tocar el resto de la escena
          if (!swapped.has(m)) swapped.set(m, m.clone());
          o.userData.xrayOrig = m;
          m = o.material = swapped.get(m);
        }
        // El motor se queda medio visible; la carrocería casi desaparece
        if (!this.faded.some((f) => f.m === m)) this.faded.push({ m, op: m.opacity, tr: m.transparent, dw: m.depthWrite, eng: inEngine(o), to: inEngine(o) ? 0.4 : inCar(o) ? 0.14 : 0.22 });
      });
      for (const f of this.faded) { f.m.transparent = true; f.m.depthWrite = false; f.m.needsUpdate = true; }
      if (this.engineHidden) { for (const f of this.faded) if (f.eng) f.m.opacity = 0; engineRoot.visible = true; }
    }
    const from = this.faded.map((f) => f.m.opacity);
    const goal = (f) => (on ? f.to : this.engineHidden && f.eng ? 0 : f.op);
    await tween(dur, (t) => this.faded.forEach((f, i) => { f.m.opacity = from[i] + (goal(f) - from[i]) * t; }), ease.inOutCubic);
    if (!on) {
      if (this.engineHidden) engineRoot.visible = false;
      for (const f of this.faded) { f.m.opacity = f.op; f.m.transparent = f.tr; f.m.depthWrite = f.dw; f.m.needsUpdate = true; }
      this.xrayRoot.traverse((o) => { if (o.userData.xrayOrig) { o.material = o.userData.xrayOrig; delete o.userData.xrayOrig; } });
    }
  }

  // ---------- Geometría de la transmisión ----------
  layout() {
    const p = this.rig.place, bay = this.rig.bay;
    const fronts = this.wheels.filter((w) => w.front), rears = this.wheels.filter((w) => !w.front);
    const avg = (ws, k) => ws.reduce((a, w) => a + w.pos[k], 0) / ws.length;
    const Df = V(avg(fronts, 'x'), avg(fronts, 'y'), 0);
    const Dr = V(avg(rears, 'x'), avg(rears, 'y'), 0);
    const ys = Math.max(0.14, Math.min(Df.y, Dr.y, bay.bottom - 0.05)); // bajo el suelo
    const gy = Math.max(p.y0 + 0.15, ys + 0.08);
    const G = V(p.cx - p.L / 2 - 0.22, gy, 0); // caja de cambios detrás del motor
    const tail = V(G.x - 0.24, gy - 0.02, 0);
    return { G, tail, Df, Dr, ys, fronts, rears };
  }

  // Pieza mecánica de un tramo: cilindro que crece desde su inicio a lo largo de la dirección
  shaftPiece(a, b, r = 0.032) {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(r, r, len, 10).translate(0, len / 2, 0);
    const m = new THREE.Mesh(geo, mat('#a4aab1', { metalness: 0.75, roughness: 0.3 }));
    m.castShadow = true;
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    m.scale.y = 0.001;
    this.group.add(m);
    return { m, len };
  }

  joint(at, r = 0.05) {
    const j = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat('#5c626b', { metalness: 0.6, roughness: 0.4 }));
    j.position.copy(at);
    j.scale.setScalar(0.001);
    this.group.add(j);
    return tween(0.25, (t) => j.scale.setScalar(Math.max(0.001, t)), ease.outBack);
  }

  diff(at, sfx) {
    const g = new THREE.Group();
    const dm = mat('#4a4f57', { metalness: 0.55, roughness: 0.4 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), dm); core.scale.set(1, 0.85, 1.1); g.add(core);
    const ring = cyl(0.15, 0.15, 0.06, 16, dm); ring.rotation.x = Math.PI / 2; g.add(ring);
    for (let i = 0; i < 6; i++) { const b = cyl(0.012, 0.012, 0.07, 6, mat('#c9ced4', { metalness: 0.8 })); const a = (i / 6) * Math.PI * 2; b.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0); b.rotation.x = Math.PI / 2; g.add(b); }
    g.position.copy(at);
    g.scale.setScalar(0.001);
    this.group.add(g);
    sfx.clank();
    return tween(0.35, (t) => grow(g, V(1, 1, 1), t), ease.outBack);
  }

  // Recorre un camino: el hilo de energía avanza, el eje crece detrás y la cámara lo sigue.
  async route(points, { r = 0.032, follow = false } = {}) {
    const path = new THREE.CurvePath();
    for (let i = 0; i < points.length - 1; i++) path.add(new THREE.LineCurve3(points[i], points[i + 1]));
    const total = path.getLength();
    const segs = [];
    let acc = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const s = this.shaftPiece(points[i], points[i + 1], r);
      segs.push({ ...s, start: acc });
      acc += s.len;
    }
    // Tubo brillante que se dibuja por delante del eje
    const tubeGeo = new THREE.TubeGeometry(path, Math.max(8, Math.round(total * 24)), r * 2.4, 8, false);
    // El hilo se ve a través de todo, como en una radiografía
    const glowMat = new THREE.MeshBasicMaterial({ map: this.tex.clone(), color: '#ffffff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    glowMat.map.repeat.x = Math.max(1, total / 0.5);
    glowMat.map.needsUpdate = true;
    const tube = new THREE.Mesh(tubeGeo, glowMat);
    tube.renderOrder = 10;
    tubeGeo.setDrawRange(0, 0);
    this.group.add(tube);
    this.glows.push(tube);
    // Cabeza del hilo
    const head = new THREE.Mesh(new THREE.SphereGeometry(r * 2.6, 12, 10), new THREE.MeshBasicMaterial({ color: '#ffe3b0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    head.renderOrder = 11;
    this.group.add(head);
    const idx = tubeGeo.index.count;
    await tween(total / SPEED, (t) => {
      const d = t * total;
      tubeGeo.setDrawRange(0, Math.floor((idx * t) / 6) * 6);
      head.position.copy(path.getPointAt(Math.min(1, t)));
      head.scale.setScalar(0.8 + Math.sin(t * 40) * 0.2);
      for (const s of segs) s.m.scale.y = Math.max(0.001, Math.min(1, (d - s.start) / s.len));
      if (follow) this.head = this.car.localToWorld(head.position.clone());
    }, ease.linear);
    tubeGeo.setDrawRange(0, Infinity);
    for (const s of segs) s.m.scale.y = 1;
    this.group.remove(head);
  }

  // Llega a una rueda: destello en la llanta y empieza a girar
  async reachWheel(w, sfx) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(w.pos.y * 0.95, 0.03, 8, 28), new THREE.MeshBasicMaterial({ color: '#ffb36b', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    ring.renderOrder = 11;
    ring.position.copy(w.pos);
    ring.position.z += Math.sign(w.pos.z) * (w.width / 2 + 0.02);
    this.group.add(ring);
    sfx.reveal(3);
    this.spinning.push({ obj: w.obj, speed: 0 });
    const sp = this.spinning[this.spinning.length - 1];
    await tween(0.6, (t) => { ring.scale.setScalar(1 + t * 0.5); ring.material.opacity = 1 - t; sp.speed = t * 9; }, ease.outCubic);
    this.group.remove(ring);
  }

  // Palieres desde el diferencial hasta las dos ruedas del eje (en paralelo)
  async axle(D, ws, sfx) {
    await Promise.all(ws.map(async (w) => {
      const s = Math.sign(w.pos.z) || 1;
      const hub = V(w.pos.x, w.pos.y, w.pos.z - s * (w.width / 2 + 0.02));
      const a = V(D.x, D.y, s * 0.14);
      await this.route([a, V((a.x + hub.x) / 2, (a.y + hub.y) / 2, (a.z + hub.z) / 2), hub], { r: 0.026 });
      await this.joint(hub, 0.045);
      await this.reachWheel(w, sfx);
    }));
  }

  async build(sfx, onStep) {
    const L = this.layout();
    const { G, tail, Df, Dr, ys } = L;
    const t = this.traction.id;
    // Caja de cambios: sale del motor
    const gb = new THREE.Group();
    const gm = mat('#6b7179', { metalness: 0.55, roughness: 0.4 });
    const bell = cyl(0.17, 0.12, 0.3, 14, gm); bell.rotation.z = Math.PI / 2; bell.position.x = 0.06; gb.add(bell);
    const body = box(0.26, 0.2, 0.2, gm); body.position.x = -0.18; gb.add(body);
    for (let i = 0; i < 3; i++) { const fin = box(0.02, 0.21, 0.22, mat('#4a4f57')); fin.position.x = -0.1 - i * 0.07; gb.add(fin); }
    gb.position.copy(G);
    gb.scale.setScalar(0.001);
    this.group.add(gb);
    this.head = this.car.localToWorld(G.clone());
    onStep && onStep('gearbox');
    sfx.whoosh();
    await tween(0.6, (t2) => { gb.position.x = G.x + 0.25 * (1 - t2); grow(gb, V(1, 1, 1), t2); }, ease.outBack);
    sfx.clank();
    await wait(0.2);
    const toRear = async () => {
      onStep && onStep('rear');
      await this.route([tail, V(tail.x - 0.25, ys, 0), V(Dr.x + 0.35, ys, 0), V(Dr.x + 0.13, Dr.y, 0)], { follow: true });
      await this.diff(Dr, sfx);
      await this.axle(Dr, L.rears, sfx);
    };
    const toFront = async (follow) => {
      onStep && onStep('front');
      const start = t === 'AWD' ? V(tail.x + 0.05, ys + 0.04, 0.22) : V(G.x + 0.1, G.y - 0.1, 0.2);
      await this.route([start, V(start.x + 0.15, ys + 0.04, 0.22), V(Df.x - 0.3, Df.y, 0.22), V(Df.x - 0.12, Df.y, 0.05)], { follow });
      await this.diff(Df, sfx);
      await this.axle(Df, L.fronts, sfx);
    };
    if (t === 'TT') await toRear();
    else if (t === 'TD') await toFront(true);
    else {
      // 4x4: caja de transferencia y el hilo se divide hacia los dos ejes
      const tc = box(0.2, 0.16, 0.26, mat('#3c4047', { metalness: 0.5 }));
      tc.position.copy(tail).add(V(0, -0.02, 0.06));
      tc.scale.setScalar(0.001);
      this.group.add(tc);
      await tween(0.35, (t2) => grow(tc, V(1, 1, 1), t2), ease.outBack);
      sfx.clank();
      await Promise.all([toRear(), toFront(false)]);
    }
    this.head = null;
  }

  // Al terminar: la energía se queda fluyendo un momento y luego se apaga; las ruedas frenan.
  async settle() {
    await tween(1.2, (t) => {
      for (const g of this.glows) g.material.opacity = 0.95 * (1 - t);
      for (const s of this.spinning) s.speed = 9 * (1 - t);
    }, ease.inOutCubic);
    for (const g of this.glows) this.group.remove(g);
    this.spinning.length = 0;
  }

  dispose() {
    this.shop.onFrame.delete(this.update);
  }
}
