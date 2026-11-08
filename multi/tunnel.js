// Túnel de viento: instalación fija del taller. El coche entra por una puerta corredera lateral
// y una plataforma giratoria lo pone de cara al ventilador. El humo dibuja líneas que se doblan
// sobre la silueta real del coche y después se monta el kit aerodinámico según la carga.
import * as THREE from 'three';
import { tween, wait, ease, grow, mat, box, cyl } from './engine3d.js';
import { carDesign } from '../car3d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const put = (m, p) => { m.position.copy(p); return m; };
const HALF = 6.2;           // medio largo del túnel
const WALL_Z = 3.3, ROOF = 3.7;
const X0 = 5.4, X1 = -5.8;  // el humo va de delante (x+) hacia atrás (x-)
const STEP = 0.08;
const LINE_Z = [-0.7, -0.35, 0, 0.35, 0.7];
const LINE_Y = Array.from({ length: 16 }, (_, i) => 0.12 + i * 0.19);
const PER_LINE = 46;
const STREAKS = 140, DUST = 260;
const DOOR_W = 3.6; // hueco de la puerta lateral (pared trasera, la que da al taller)

function dotTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
function roadTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#26282c'; c.fillRect(0, 0, 256, 64);
  c.fillStyle = '#3a3d43';
  for (let i = 0; i < 8; i++) c.fillRect(i * 32, 0, 3, 64);
  c.fillStyle = '#ff6a1a'; c.fillRect(0, 30, 256, 4);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class WindTunnel {
  constructor(scene, station) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.set(station.x, 0, station.z);
    scene.add(this.group);
    this.wind = 0;      // 0..1, velocidad del ventilador
    this.fill = 0;      // hasta dónde ha llegado el humo (0..1)
    this.time = 0;
    this.lines = [];
    this.build();
  }

  build() {
    const g = this.group;
    const frameM = mat('#aeb4bb', { metalness: 0.6, roughness: 0.35 }), dark = mat('#2b2f35', { metalness: 0.4 });
    // Rodillo (suelo móvil) bajo el coche
    this.roadTex = roadTexture();
    this.roadTex.repeat.set(6, 1);
    this.turn = new THREE.Group();
    const disc = cyl(2.7, 2.7, 0.02, 48, mat('#33363c', { roughness: 0.6, metalness: 0.3 })); disc.position.y = 0.002; this.turn.add(disc);
    const edge = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.7, 64).rotateX(-Math.PI / 2), mat('#ff6a1a', { roughness: 0.6 })); edge.position.y = 0.014; this.turn.add(edge);
    this.road = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.6 }));
    this.road.position.y = 0.016;
    this.road.receiveShadow = true;
    this.turn.add(this.road);
    this.turn.rotation.y = -Math.PI / 2; // la cinta mira a la puerta: el coche entra de frente
    g.add(this.turn);
    // Paredes de cristal con marco
    this.walls = [];
    const glass = this.glass = new THREE.MeshStandardMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, roughness: 0.1, metalness: 0.2 });
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      const door = s < 0;
      if (!door) w.add(put(new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, ROOF), glass), V(0, ROOF / 2, 0)));
      else {
        const side = (HALF - DOOR_W / 2);
        for (const k of [-1, 1]) w.add(put(new THREE.Mesh(new THREE.PlaneGeometry(side, ROOF), glass), V(k * (DOOR_W / 2 + side / 2), ROOF / 2, 0)));
      }
      const top = box(2 * HALF + 0.1, 0.12, 0.12, frameM); top.position.y = ROOF; w.add(top);
      if (!door) { const bot = box(2 * HALF + 0.1, 0.12, 0.12, frameM); bot.position.y = 0.06; w.add(bot); }
      else for (const k of [-1, 1]) { const len = HALF - DOOR_W / 2; const bot = box(len, 0.12, 0.12, frameM); bot.position.set(k * (DOOR_W / 2 + len / 2), 0.06, 0); w.add(bot); }
      for (let x = -HALF; x <= HALF + 0.01; x += 2.48) if (!door || Math.abs(x) > DOOR_W / 2) { const p = box(0.1, ROOF, 0.1, frameM); p.position.set(x, ROOF / 2, 0); w.add(p); }
      if (door) {
        for (const k of [-1, 1]) { const j = box(0.14, ROOF, 0.14, frameM); j.position.set(k * DOOR_W / 2, ROOF / 2, 0); w.add(j); }
        // Hoja corredera (por fuera de la pared)
        const leaf = this.door = new THREE.Group();
        leaf.add(put(new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, ROOF - 0.25), glass), V(0, (ROOF - 0.25) / 2 + 0.05, 0)));
        for (const y of [0.08, ROOF - 0.2]) { const r = box(DOOR_W + 0.06, 0.08, 0.08, frameM); r.position.y = y; leaf.add(r); }
        for (const k of [-1, 1]) { const r = box(0.08, ROOF - 0.25, 0.08, frameM); r.position.set(k * DOOR_W / 2, (ROOF - 0.25) / 2 + 0.05, 0); leaf.add(r); }
        const handle = box(0.06, 0.5, 0.06, mat('#ff6a1a', { roughness: 0.5 })); handle.position.set(-DOOR_W / 2 + 0.25, 1.1, -0.08); leaf.add(handle);
        leaf.position.z = -0.16;
        w.add(leaf);
      }
      w.position.z = s * WALL_Z;
      g.add(w);
      this.walls.push(w);
    }
    // Techo con tiras de luz
    this.roof = new THREE.Group();
    this.ledMat = new THREE.MeshBasicMaterial({ color: '#e8f4ff' });
    for (let x = -HALF + 0.6; x <= HALF; x += 1.6) {
      this.roof.add(put(box(0.12, 0.12, 2 * WALL_Z, frameM), V(x, ROOF + 0.06, 0)));
      this.roof.add(put(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 2 * WALL_Z - 0.4), this.ledMat), V(x, ROOF - 0.01, 0)));
    }
    g.add(this.roof);
    // Ventilador gigante delante (sopla hacia -x)
    const fan = this.fan = new THREE.Group();
    const R = 1.75;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.12, 0.16, 12, 48), dark); ring.rotation.y = Math.PI / 2; fan.add(ring);
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 0.9, 48, 1, true), mat('#3a3f46', { side: THREE.DoubleSide, metalness: 0.4 }));
    shroud.rotation.z = Math.PI / 2; shroud.position.x = 0.4; fan.add(shroud);
    this.rotor = new THREE.Group();
    const bladeM = mat('#d8dde2', { metalness: 0.5, roughness: 0.35 });
    for (let i = 0; i < 7; i++) {
      const b = box(0.06, R * 0.88, 0.42, bladeM);
      b.position.y = R * 0.48;
      const arm = new THREE.Group(); arm.rotation.x = (i / 7) * Math.PI * 2; b.rotation.y = 0.5; arm.add(b);
      this.rotor.add(arm);
    }
    const hub = cyl(0.32, 0.32, 0.4, 16, mat('#ff6a1a', { roughness: 0.5 })); hub.rotation.z = Math.PI / 2; this.rotor.add(hub);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 16), mat('#ff6a1a', { roughness: 0.5 })); nose.rotation.z = Math.PI / 2; nose.position.x = -0.45; this.rotor.add(nose);
    fan.add(this.rotor);
    // Rejilla de protección
    for (const rr of [0.6, 1.1, 1.6]) { const t = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.015, 6, 40), dark); t.rotation.y = Math.PI / 2; t.position.x = -0.35; fan.add(t); }
    for (let i = 0; i < 8; i++) { const sp = box(0.02, R * 2, 0.02, dark); sp.rotation.x = (i / 8) * Math.PI; sp.position.x = -0.35; fan.add(sp); }
    for (const s of [-1, 1]) { const leg = box(0.16, 1.3, 0.16, dark); leg.position.set(0.3, -R + 0.1, s * 1.1); leg.rotation.x = s * 0.4; fan.add(leg); }
    fan.position.set(HALF + 0.5, R + 0.22, 0);
    g.add(fan);
    // Rejilla de salida detrás (panal)
    const exit = this.exit = new THREE.Group();
    exit.add(put(box(0.14, ROOF, 2 * WALL_Z, dark), V(0, ROOF / 2, 0)));
    const cell = mat('#4a4f57', { metalness: 0.5 });
    for (let y = 0.3; y < ROOF; y += 0.32) exit.add(put(box(0.18, 0.025, 2 * WALL_Z - 0.2, cell), V(-0.03, y, 0)));
    for (let z = -WALL_Z + 0.3; z < WALL_Z; z += 0.32) exit.add(put(box(0.18, ROOF - 0.2, 0.025, cell), V(-0.03, ROOF / 2, z)));
    exit.position.x = -HALF - 0.1;
    g.add(exit);
    // Peines de humo delante del coche
    this.rakes = new THREE.Group();
    for (const z of LINE_Z) {
      const bar = box(0.05, LINE_Y[LINE_Y.length - 1] + 0.2, 0.05, frameM); bar.position.set(X0 + 0.1, (LINE_Y[LINE_Y.length - 1] + 0.2) / 2, z); this.rakes.add(bar);
      for (const y of LINE_Y) { const n = cyl(0.025, 0.025, 0.08, 6, dark); n.rotation.z = Math.PI / 2; n.position.set(X0 + 0.05, y, z); this.rakes.add(n); }
    }
    g.add(this.rakes);
    // Partículas de humo
    const n = LINE_Z.length * LINE_Y.length * PER_LINE;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    g.add(this.points);
    this.trails = new THREE.Group();
    g.add(this.trails);
    // Ráfagas: estelas largas y rápidas por los lados y por encima del coche
    const sp = new Float32Array(STREAKS * 6);
    this.streakData = Array.from({ length: STREAKS }, () => this.newStreak(true));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.streaks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: '#cfe9ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.streaks.frustumCulled = false;
    g.add(this.streaks);
    // Polvo que barre el suelo
    this.dustData = Array.from({ length: DUST }, () => ({ x: X1 + Math.random() * (X0 - X1), y: 0.02 + Math.random() * 0.12, z: (Math.random() * 2 - 1) * (WALL_Z - 0.2), v: 0.6 + Math.random() * 0.8 }));
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.05, map: dotTexture(), color: '#d9c7a8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust.frustumCulled = false;
    g.add(this.dust);
    // Disco de palas en movimiento cuando el ventilador gira rápido
    this.blur = new THREE.Mesh(new THREE.CircleGeometry(1.65, 48).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#dfe8f2', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.blur.position.x = -0.05;
    this.fan.add(this.blur);
  }

  // Una ráfaga nueva: fuera de la silueta del coche (por los lados o por encima)
  newStreak(anywhere = false) {
    const side = Math.random() < 0.7;
    const z = side ? (Math.random() < 0.5 ? -1 : 1) * (1.25 + Math.random() * (WALL_Z - 1.4)) : (Math.random() * 2 - 1) * (WALL_Z - 0.3);
    const y = side ? 0.2 + Math.random() * (ROOF - 0.5) : 2.7 + Math.random() * (ROOF - 2.9);
    return { x: anywhere ? X1 + Math.random() * (X0 - X1) : X0 + Math.random() * 2, y, z, len: 0.4 + Math.random() * 0.9, v: 9 + Math.random() * 7 };
  }

  reset() {
    this.wind = 0; this.fill = 0;
    this.lines = [];
    for (const c of [...this.trails.children]) { this.trails.remove(c); c.geometry.dispose(); }
    this.door.position.x = 0;
    this.turn.rotation.y = -Math.PI / 2;
  }

  // Puerta corredera: se abre deslizando la hoja hacia un lado
  async openDoor(sfx) { sfx && sfx.whoosh(); const x0 = this.door.position.x; await tween(1.0, (t) => (this.door.position.x = x0 + (DOOR_W + 0.2 - x0) * t), ease.inOutCubic); sfx && sfx.clank(); }
  async closeDoor(sfx) { sfx && sfx.whoosh(); const x0 = this.door.position.x; await tween(1.0, (t) => (this.door.position.x = x0 * (1 - t)), ease.inOutCubic); sfx && sfx.thud(0.4); }
  // Plataforma giratoria: gira con el coche encima hasta el ángulo pedido
  async rotateTo(car, angle, dur = 2.2) {
    const a0 = this.turn.rotation.y, c0 = car.rotation.y;
    await tween(dur, (t) => { this.turn.rotation.y = a0 + (angle - a0) * t; car.rotation.y = c0 + (angle - a0) * t; }, ease.inOutCubic);
  }
  center() { return { x: this.group.position.x, z: this.group.position.z }; }

  // ---------- Líneas de humo ----------
  // Se miden la parte de arriba y los bajos del coche a lo largo del túnel y cada línea se
  // dobla por encima (o pasa por debajo) con una pequeña anticipación delante del morro.
  computeLines(car) {
    car.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    const xs = [];
    for (let x = X0; x >= X1 - 1e-6; x -= STEP) xs.push(x);
    const ox = this.group.position.x, oz = this.group.position.z;
    const prof = LINE_Z.map((z) => xs.map((x) => {
      rc.set(V(ox + x, 8, oz + z), V(0, -1, 0));
      const top = rc.intersectObject(car, true)[0];
      rc.set(V(ox + x, -2, oz + z), V(0, 1, 0));
      const bot = rc.intersectObject(car, true)[0];
      return { top: top ? top.point.y : -1, bot: bot ? bot.point.y : 9 };
    }));
    const tailIdx = (pz) => { let k = 0; pz.forEach((p, i) => { if (p.top > 0) k = i; }); return k; };
    this.lines = [];
    LINE_Z.forEach((z, zi) => {
      const pz = prof[zi];
      const tops = pz.map((p) => p.top);
      const hMax = Math.max(...tops);
      const bots = pz.filter((p) => p.top > 0).map((p) => p.bot);
      const under = bots.length ? Math.min(...bots) : 0.3;
      const tail = tailIdx(pz);
      for (const y0 of LINE_Y) {
        const ys = [];
        const goesUnder = y0 < under - 0.06;
        for (let i = 0; i < xs.length; i++) {
          if (goesUnder) {
            // Por debajo: se aprieta contra el suelo bajo el coche
            let b = 9; for (let k = i; k < Math.min(xs.length, i + 6); k++) b = Math.min(b, pz[k].bot);
            ys.push(Math.min(y0, b - 0.05));
            continue;
          }
          // Envolvente con anticipación: la línea empieza a subir antes de llegar al coche
          let e = -1; for (let k = i; k < Math.min(xs.length, i + 8); k++) e = Math.max(e, tops[k]);
          const hit = Math.max(0, e + 0.08 - y0);
          const far = e > 0 ? e * 0.32 * Math.exp(-Math.max(0, y0 - e) / 0.55) : 0;
          ys.push(y0 + Math.max(hit, far));
        }
        // Detrás del coche el flujo no baja de golpe: separación y estela
        for (let i = 1; i < ys.length; i++) if (ys[i] < ys[i - 1] - 0.03) ys[i] = ys[i - 1] - 0.03;
        // Suavizado
        const sm = ys.map((_, i) => { let a = 0, c = 0; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < ys.length) { a += ys[j]; c++; } } return a / c; });
        const pts = sm.map((y, i) => V(xs[i], y, z));
        const cols = sm.map((y, i) => {
          const near = !goesUnder && Math.abs(y - (tops[i] > 0 ? tops[i] : -9)) < 0.18;
          const wake = i > tail && tail > 0 && Math.abs(y - y0) > 0.04;
          return new THREE.Color(near ? '#ffffff' : wake ? '#ff9a5a' : goesUnder ? '#5fa8ff' : '#8fd0ff');
        });
        this.lines.push({ pts, cols, tail, wakeAmp: y0 < hMax + 0.4 ? 0.06 : 0.015, phase: Math.random() * 10 });
      }
    });
    // Rastro tenue de cada línea
    for (const c of [...this.trails.children]) { this.trails.remove(c); c.geometry.dispose(); }
    const trailMat = new THREE.LineBasicMaterial({ color: '#8fd0ff', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const l of this.lines) this.trails.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(l.pts), trailMat));
  }

  update(dt) {
    this.time += dt;
    const w = this.wind;
    this.rotor.rotation.x -= dt * w * 22;
    this.blur.material.opacity = Math.max(0, w - 0.4) * 0.45;
    // Ráfagas y polvo: más cuanto más fuerte sopla
    const spos = this.streaks.geometry.attributes.position.array;
    this.streakData.forEach((st, i) => {
      st.x -= dt * st.v * w;
      if (st.x + st.len < X1 - 0.5) Object.assign(st, this.newStreak());
      spos.set([st.x, st.y, st.z, st.x + st.len, st.y, st.z], i * 6);
    });
    this.streaks.geometry.attributes.position.needsUpdate = true;
    this.streaks.material.opacity = 0.55 * w * Math.min(1, this.fill * 2);
    const dpos = this.dust.geometry.attributes.position.array;
    this.dustData.forEach((p, i) => {
      p.x -= dt * p.v * 4 * w;
      if (p.x < X1) p.x = X0 + Math.random();
      dpos.set([p.x, p.y + Math.sin(this.time * 6 + i) * 0.02, p.z], i * 3);
    });
    this.dust.geometry.attributes.position.needsUpdate = true;
    this.dust.material.opacity = 0.7 * w;
    this.roadTex.offset.x += dt * w * 3;
    this.trails.visible = this.fill > 0.05 && w > 0.02; // sin viento no queda rastro de humo
    for (const c of this.trails.children) c.material.opacity = 0.2 * Math.min(1, this.fill);
    const pos = this.points.geometry.attributes.position.array, col = this.points.geometry.attributes.color.array;
    let k = 0;
    for (const l of this.lines) {
      const n = l.pts.length;
      for (let p = 0; p < PER_LINE; p++) {
        const s = (p / PER_LINE + this.time * 0.3 * (0.4 + w) + l.phase) % 1;
        if (s > this.fill || !w) { pos[k * 3 + 1] = -50; k++; continue; }
        const f = s * (n - 1), i = Math.floor(f), t = f - i;
        const a = l.pts[i], b = l.pts[Math.min(n - 1, i + 1)];
        let y = a.y + (b.y - a.y) * t;
        if (i > l.tail && l.tail > 0) y += Math.sin(this.time * 9 + s * 40 + l.phase) * l.wakeAmp * Math.min(1, (i - l.tail) / 15);
        pos[k * 3] = a.x + (b.x - a.x) * t; pos[k * 3 + 1] = y; pos[k * 3 + 2] = a.z;
        const c = l.cols[i];
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
        k++;
      }
    }
    for (; k < pos.length / 3; k++) pos[k * 3 + 1] = -50;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  // Lámparas de secado: el techo se pone naranja un momento
  async dry(dur = 1.4) {
    await tween(dur, (t) => this.ledMat.color.setHSL(0.07, 1, 0.55 + 0.35 * Math.sin(t * Math.PI) * 0.4), ease.linear);
    this.ledMat.color.set('#e8f4ff');
  }
  // El humo sale de los peines y recorre el túnel
  async smoke(dur = 2.2) {
    this.fill = 0;
    await tween(dur, (t) => (this.fill = t), ease.linear);
  }
}

// ---------- Kit aerodinámico ----------
// Cada tipo de coche lleva su propio kit, como en la vida real: un utilitario o un SUV llevan
// alerón de techo, una pick-up cubre la caja, un deportivo monta ala con soportes... Si el coche ya
// trae su alerón (bólidos, fastback, GT...) no se le pone otro encima: se mejora el que tiene.
// level: 0.25 baja · 0.5 media · 0.75 alta
const KITS = {
  utilitario: [['lip'], ['lip', 'roof'], ['lip', 'roofBig', 'skirts', 'diffuser']],
  turismo: [['lip'], ['lip', 'rear', 'skirts'], ['splitter', 'rearBig', 'skirts', 'diffuser']],
  suv: [['skid'], ['skid', 'roof'], ['skid', 'roofBig', 'skirts', 'diffuser']],
  pickup: [['airdam'], ['airdam', 'tailgate'], ['airdam', 'tonneau', 'tailgate', 'skirts']],
  furgoneta: [['airdam'], ['airdam', 'roof', 'skirts'], ['airdam', 'roofBig', 'skirts', 'boattail']],
  coupe: [['lip'], ['lip', 'ducktail', 'skirts'], ['splitter', 'wingLow', 'skirts', 'diffuser']],
  deportivo: [['splitter'], ['splitter', 'wing', 'skirts'], ['splitterBig', 'wingSwan', 'skirts', 'canards', 'diffuser']],
  bolido: [['gurney'], ['flap', 'canards'], ['flapBig', 'canards', 'frontFlaps']],
};

// Piezas aerodinámicas que ya trae la carrocería: alerón trasero (con o sin soportes) y splitter
function existingAero(rig) {
  const car = rig.car;
  car.updateMatrixWorld(true);
  const inv = car.matrixWorld.clone().invert();
  const boxes = [];
  for (const root of rig.body) {
    if (root.userData.isWheel) continue;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.geometry.type !== 'BoxGeometry') return;
      const b = new THREE.Box3().setFromObject(o).applyMatrix4(inv);
      boxes.push({ o, b, s: b.getSize(V()), c: b.getCenter(V()) });
    });
  }
  const rear = boxes.filter(({ s, c }) => s.y <= 0.075 && s.z >= 1.0 && s.x <= 0.8 && c.x < rig.carMin + 0.8 && c.y > 0.6)
    .sort((a, b) => b.c.y - a.c.y)[0] || null;
  let posts = [];
  if (rear) posts = boxes.filter(({ s, c }) => s.x <= 0.14 && s.z <= 0.1 && s.y > 0.1 && Math.abs(c.x - rear.c.x) < 0.25 && c.y < rear.c.y);
  const front = boxes.filter(({ s, c }) => s.y <= 0.06 && s.z >= 1.6 && s.x <= 0.6 && c.x > rig.carMax - 0.55 && c.y < 0.36)
    .sort((a, b) => b.b.max.x - a.b.max.x)[0] || null;
  return { rear, wing: !!rear && posts.length > 0, front };
}

export function buildAeroKit(rig, level, color) {
  const car = rig.car;
  car.updateMatrixWorld(true);
  const inv = car.matrixWorld.clone().invert();
  const rc = new THREE.Raycaster();
  const local = (p) => p.clone().applyMatrix4(inv);
  const world = (p) => p.clone().applyMatrix4(car.matrixWorld);
  const body = rig.body.filter((o) => !o.userData.isWheel);
  const castDown = (x, z) => { rc.set(world(V(x, 8, z)), V(0, -1, 0)); const h = rc.intersectObjects(body, true)[0]; return h ? local(h.point).y : null; };
  const castUp = (x, z) => { rc.set(world(V(x, -3, z)), V(0, 1, 0)); const h = rc.intersectObjects(body, true)[0]; return h ? local(h.point).y : null; };
  const castSide = (x, y) => { rc.set(world(V(x, y, 5)), V(0, 0, -1)); const h = rc.intersectObjects(body, true)[0]; return h ? local(h.point).z : null; };
  const xMin = rig.carMin, xMax = rig.carMax;
  const typeId = rig.spec.typeId, design = carDesign(rig.spec);
  const ex = existingAero(rig);
  // Zaga: el punto más alto de los últimos 50 cm (maletero, techo o borde de la caja)
  let rx = xMin + 0.2, ry = 0.8;
  for (let x = xMin + 0.12; x < xMin + 0.6; x += 0.04) { const y = castDown(x, 0.3); if (y != null && y > ry - 0.5) { if (y > ry || rx === xMin + 0.2) { ry = y; rx = x; } } }
  // Techo: el punto más alto y su borde trasero (donde va un alerón de techo)
  // Se mide a un lado del centro para no apoyarlo en la baca o en las barras; si a ese lado ya no
  // hay techo (coches estrechos), en el centro.
  const roofScan = (z) => {
    let top = 0, edge = xMin + 0.3;
    for (let x = xMax - 0.3; x > xMin; x -= 0.04) { const y = castDown(x, z); if (y != null && y > top) top = y; }
    for (let x = xMax - 0.3; x > xMin; x -= 0.04) { const y = castDown(x, z); if (y != null && y >= top - 0.06) edge = x; }
    return { top, edge };
  };
  const r0 = roofScan(0), r1 = roofScan(0.8);
  const roof = r1.top > r0.top - 0.25 ? r1 : r0;
  const roofY = roof.top, roofX = roof.edge;
  const rearIsRoof = ry > roofY - 0.15; // portón (hatchback, SUV, furgoneta) o maletero
  const midY = Math.max(0.3, ry - 0.2);
  const halfW = Math.max(0.5, (castSide(xMin + 0.3, midY) ?? 0.8));
  const fy = (castUp(xMax - 0.25, 0) ?? 0.25);
  const sideY = (castUp(0, halfW - 0.1) ?? 0.3);
  const rearY = (castUp(xMin + 0.25, 0) ?? fy);
  const carbon = mat('#1b1d21', { roughness: 0.4, metalness: 0.3 }), accent = rig.paintMat || mat(color, { roughness: 0.45, metalness: 0.15 });
  const metal = mat('#8a9097', { roughness: 0.35, metalness: 0.7 });
  const parts = [], hide = [];
  let focus = null;
  const add = (m, x, y, z, rz = 0) => { m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; parts.push(m); return m; };
  const group = (x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parts.push(g); return g; };

  // ---- Delantera ----
  const frontPiece = (len, thick = 0.025) => {
    if (ex.front) { // ya tiene splitter: se alarga por delante
      const f = ex.front;
      return add(box(len, thick, f.s.z * 0.96, carbon), f.b.max.x + len / 2 - 0.03, f.c.y - 0.005, 0);
    }
    return add(box(len, thick, halfW * 1.85, carbon), xMax - 0.05 + len / 2 - 0.12, fy - 0.02, 0);
  };
  // ---- Alerón de techo: sale del borde trasero del techo, un poco caído ----
  const roofSpoiler = (len, big) => {
    const g = focus = group(roofX + 0.06, roofY + 0.012, 0);
    const p = box(len, 0.04, halfW * 1.8, big ? carbon : accent); p.position.x = -len / 2; p.rotation.z = 0.1; g.add(p);
    if (big) for (const s of [-1, 1]) { const w = box(len * 0.9, 0.12, 0.03, accent); w.position.set(-len * 0.45, -0.04, s * halfW * 0.9); g.add(w); }
  };
  // ---- Alerón sobre el maletero: labio, cola de pato o ala con soportes ----
  const ducktail = (h) => {
    const base = ex.rear && !ex.wing ? ex.rear : null; // si ya hay labio, la cola sale de su borde
    const x = base ? base.b.min.x + 0.04 : rx - 0.02, y = base ? base.b.max.y : ry + 0.01;
    const g = focus = group(x, y, 0);
    const p = box(0.2, 0.03, (base ? base.s.z : halfW * 1.7) * 0.98, accent); p.position.set(-0.07, h / 2, 0); p.rotation.z = -Math.atan2(h, 0.2); g.add(p);
  };
  const postWing = (h, chord, span, { flap = false, plates = false, swan = false } = {}) => {
    // Si había un labio en ese sitio, el ala lo sustituye (no se apilan alerones)
    if (ex.rear && !ex.wing) hide.push(ex.rear.o);
    const g = focus = group(rx + 0.04, ry, 0);
    for (const s of [-1, 1]) {
      if (swan) { // cuello de cisne: los soportes cogen el ala por arriba
        const st = box(0.05, h + 0.08, 0.035, carbon); st.position.set(-0.04, (h + 0.08) / 2, s * span * 0.28); g.add(st);
      } else { const st = box(0.06, h, 0.04, carbon); st.position.set(0, h / 2, s * span * 0.3); g.add(st); }
    }
    const plane = box(chord, 0.035, span, flap ? carbon : accent); plane.position.set(-0.02, h, 0); plane.rotation.z = -0.1; g.add(plane);
    if (flap) { const f = box(chord * 0.45, 0.025, span, accent); f.position.set(-chord * 0.5, h + 0.06, 0); f.rotation.z = -0.42; g.add(f); }
    if (plates) for (const s of [-1, 1]) { const ep = box(chord + 0.12, 0.26, 0.02, accent); ep.position.set(-0.06, h + 0.01, s * span / 2); g.add(ep); }
  };
  // ---- Mejoras del alerón que ya trae (bólidos): no se añade otro, se le ponen elementos ----
  const upgradeWing = (k) => {
    const P = ex.rear;
    const chord = P.s.x, span = P.s.z;
    const g = focus = group(P.c.x, P.b.max.y, 0);
    const gurney = box(0.02, 0.04, span * 0.98, carbon); gurney.position.set(-chord / 2 + 0.01, 0.02, 0); g.add(gurney);
    if (k >= 1) { const f = box(chord * 0.55, 0.025, span * 0.98, accent); f.position.set(-chord * 0.42, 0.06 + k * 0.02, 0); f.rotation.z = -(0.3 + k * 0.12); g.add(f); }
    if (k >= 2) {
      for (const s of [-1, 1]) { const ep = box(chord + 0.3, 0.42, 0.025, accent); ep.position.set(-0.08, -0.06, s * (span / 2 + 0.015)); g.add(ep); }
      const beam = box(chord * 0.6, 0.03, span * 0.7, carbon); beam.position.set(0.02, -Math.max(0.2, P.c.y - ry) * 0.55 - 0.08, 0); g.add(beam);
    }
  };

  const level01 = level >= 0.75 ? 2 : level >= 0.5 ? 1 : 0;
  let items = (KITS[typeId] || KITS.turismo)[level01];
  // Con alerón propio con soportes: las alas se convierten en mejoras de ese alerón
  if (ex.wing) items = items.map((it) => (it.startsWith('wing') || it === 'rear' || it === 'rearBig' ? (level01 >= 2 ? 'flapBig' : level01 ? 'flap' : 'gurney') : it));
  for (const it of items) {
    switch (it) {
      case 'lip': frontPiece(0.16); break;
      case 'splitter': frontPiece(0.28); break;
      case 'splitterBig': frontPiece(0.4, 0.03); for (const s of [-1, 1]) add(box(0.3, 0.1, 0.02, carbon), xMax - 0.05, fy + 0.02, s * halfW * 0.92); break;
      case 'skid': add(box(0.55, 0.03, Math.min(1.1, halfW * 1.3), metal), xMax - 0.3, fy - 0.02, 0, -0.12); break;
      case 'airdam': add(box(0.06, 0.13, halfW * 1.75, carbon), xMax - 0.14, fy - 0.05, 0); break;
      case 'roof': roofSpoiler(0.24, false); break;
      case 'roofBig': roofSpoiler(0.38, true); break;
      case 'rear': if (rearIsRoof) roofSpoiler(0.24, false); else ducktail(0.06); break;
      case 'rearBig': if (rearIsRoof) roofSpoiler(0.38, true); else postWing(0.2, 0.28, halfW * 1.75, { plates: true }); break;
      case 'ducktail': ducktail(0.1); break;
      case 'tailgate': ducktail(0.07); break;
      case 'wingLow': postWing(0.12, 0.26, halfW * 1.7); break;
      case 'wing': postWing(0.18, 0.3, halfW * 1.8); break;
      case 'wingSwan': postWing(0.36, 0.36, halfW * 2 + 0.06, { flap: true, plates: true, swan: true }); break;
      case 'gurney': upgradeWing(0); break;
      case 'flap': upgradeWing(1); break;
      case 'flapBig': upgradeWing(2); break;
      case 'tonneau': {
        // Lona rígida sobre la caja de la pick-up (la carga se guarda debajo)
        const lift = design === 2 ? 0.3 : 0, cab = design === 1 ? -1.2 : -0.35, rearX = design === 1 ? -2.7 : -2.55;
        const len = cab - 0.1 - rearX - 0.1;
        add(box(len, 0.035, halfW * 2 - 0.12, accent), (cab - 0.1 + rearX) / 2, 1.4 + lift, 0);
        for (const root of rig.body) root.traverse((o) => { if (o.isMesh && o.material && o.material.color && o.material.color.getHexString() === 'b07a3c') hide.push(o); });
        break;
      }
      case 'boattail': for (const s of [-1, 1]) add(box(0.32, Math.max(0.6, roofY - rearY - 0.5), 0.025, carbon), xMin - 0.12, (roofY + rearY) / 2 + 0.1, s * (halfW - 0.08)).rotation.y = s * 0.25; break;
      case 'skirts': {
        const fr = (rig.arches || []).filter((a) => a.x > 0), rr = (rig.arches || []).filter((a) => a.x <= 0);
        const sx1 = fr.length ? Math.min(...fr.map((a) => a.x - a.R)) - 0.04 : xMax - (xMax - xMin) * 0.22;
        const sx0 = rr.length ? Math.max(...rr.map((a) => a.x + a.R)) + 0.04 : xMin + (xMax - xMin) * 0.22;
        if (sx1 - sx0 > 0.3) for (const s of [-1, 1]) add(box(sx1 - sx0, 0.05, 0.05, carbon), (sx0 + sx1) / 2, sideY - 0.02, s * (halfW + 0.01));
        break;
      }
      case 'canards': for (const s of [-1, 1]) for (const k of [0, 1]) add(box(0.16, 0.012, 0.1, carbon), xMax - 0.14 - k * 0.08, fy + 0.12 + k * 0.08, s * (halfW - 0.08), 0.25); break;
      case 'diffuser': for (let i = 0; i < 5; i++) add(box(0.32, 0.12, 0.02, carbon), xMin + 0.18, rearY + 0.04, -halfW * 0.6 + (i * halfW * 1.2) / 4); break;
      case 'frontFlaps': {
        // Monoplaza: flaps extra sobre el alerón delantero; el resto, aletas en el morro
        const f = ex.front;
        if (f && f.s.z >= 1.8) for (const s of [-1, 1]) for (const k of [0, 1]) add(box(0.18, 0.02, f.s.z * 0.4, accent), f.c.x - 0.04 - k * 0.1, f.b.max.y + 0.04 + k * 0.04, s * f.s.z * 0.27, -0.3);
        else for (const s of [-1, 1]) add(box(0.22, 0.015, 0.14, carbon), xMax - 0.2, fy + 0.2, s * (halfW - 0.05), 0.3);
        break;
      }
    }
  }
  // La cámara del túnel mira a la zaga: siempre hay una pieza trasera de referencia
  if (!focus) focus = group(rx, ry, 0);
  for (const p of parts) p.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const g = new THREE.Group();
  for (const p of parts) g.add(p);
  car.add(g);
  return { group: g, parts, wing: focus, hide };
}

// Lo que se sustituye se recoge primero; después las piezas llegan volando y crecen hasta su
// sitio, una detrás de otra (la pieza trasera principal al final).
export async function fitAeroKit(kit, sfx) {
  if (kit.hide.length) {
    sfx.whoosh();
    await Promise.all(kit.hide.map((o) => { const s0 = o.scale.clone(); return tween(0.4, (t) => o.scale.copy(s0).multiplyScalar(Math.max(0.001, 1 - t)), ease.inQuad).then(() => { o.visible = false; o.scale.copy(s0); }); }));
  }
  const items = kit.parts;
  for (const o of items) { o.userData.home = o.position.clone(); o.userData.s0 = o.scale.clone(); grow(o, o.userData.s0, 0); }
  await Promise.all(items.map(async (o, i) => {
    await wait(i * 0.09 + (o === kit.wing ? 0.35 : 0));
    const home = o.userData.home, start = home.clone().add(V(0, 1.6, 0));
    await tween(0.55, (t) => { o.position.lerpVectors(start, home, t); grow(o, o.userData.s0, t * 2.5); }, ease.outBack);
    o.scale.copy(o.userData.s0);
    if (o === kit.wing) { sfx.thud(0.6); sfx.clank(); } else if (i % 3 === 0) sfx.clank();
  }));
}
