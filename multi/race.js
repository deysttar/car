// Carrera: el anfitrión simula la carrera con las estadísticas de cada coche (potencia, 0-100,
// punta, agarre, fiabilidad, ruedas y calidad) más un poco de suerte con semilla, y manda a todos
// el resultado: para cada coche, el tiempo en que pasa por cada punto del circuito. Así todos ven
// exactamente la misma carrera. Cada cliente la dibuja en un circuito 3D lejos del taller.
import * as THREE from 'three';
import { tween, ease, mat, box, cyl } from './engine3d.js';
import { buildCar } from '../car3d.js';
import { carStats, isV2 } from './rules.js';
import { mulberry32 } from './build.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const TRACK_ORIGIN = { x: 0, z: 700 };
export const LAPS = 3;
const W = 13;            // ancho de la pista
const DS = 2;            // paso de la simulación (m)
const G = 9.81;
// Trazado: recta de meta, horquilla, enlazadas y una curva rápida de vuelta a meta
const POINTS = [[0, 0], [70, 0], [130, 4], [168, 28], [172, 70], [142, 96], [96, 88], [70, 112], [28, 138], [-30, 134], [-78, 112], [-96, 66], [-80, 24], [-42, 4]];

function trackCurve() {
  return new THREE.CatmullRomCurve3(POINTS.map(([x, z]) => V(x, 0, z)), true, 'centripetal');
}
// Curvatura a lo largo de la vuelta (1/radio), muestreada cada DS metros
function trackProfile(curve) {
  const L = curve.getLength(), n = Math.round(L / DS);
  const k = new Float64Array(n);
  const head = (u) => { const t = curve.getTangentAt(((u % 1) + 1) % 1); return Math.atan2(t.z, t.x); };
  for (let i = 0; i < n; i++) {
    const u0 = (i - 1) / n, u1 = (i + 1) / n;
    let d = head(u1) - head(u0);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    k[i] = d / (2 * DS);
  }
  // Suavizado: el coche no reacciona a cada punto del trazado
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) { let a = 0; for (let j = -3; j <= 3; j++) a += k[(i + j + n) % n]; sm[i] = a / 7; }
  return { L, n, k: sm };
}

// Lo que cuenta de cada coche para correr
export function racePerf(entry) {
  const st = carStats(entry.spec);
  const v2 = isV2(entry.spec);
  const vmax = st.vmax / 3.6;
  const t0100 = Math.max(1.8, st.t0100);
  const a0 = Math.min(18, (-vmax / t0100) * Math.log(1 - Math.min(0.95, 27.78 / vmax)));
  const tireBonus = (entry.tires && entry.tires.bonus) || 0;
  let mu = Math.min(1.75, Math.max(0.85, 0.8 + 0.12 * st.grip + tireBonus * 0.012));
  const penalty = (entry.qc && entry.qc.penalty) || 0;
  // V2: el peso cuenta en curva y en frenada (más kilos, menos paso por curva y frenadas más largas)
  const heavy = v2 ? 1450 / st.weightKg : 1;
  if (v2) mu *= Math.pow(heavy, 0.15);
  const brake = G * mu * 0.9 + 3 * heavy;
  // V2: demasiados CV por kilo para el agarre que hay = el coche se vuelve nervioso (trompos)
  const spin = v2 ? Math.min(0.35, Math.max(0, st.pw / (230 * mu) - 1) * 0.25) : 0;
  // V2: la fiabilidad es una tirada; si es baja, el motor puede reventar durante la carrera
  const blow = v2 ? Math.pow((100 - st.reliability) / 100, 2.2) * 0.75 : 0;
  return { vmax, a0, mu, brake, spin, blow, reliability: st.reliability, penalty, hp: st.hp, v2 };
}

// Simulación completa (la hace el anfitrión). entries: [{ id, name, spec, tires, qc, ... }]
export function simulateRace(entries, seed) {
  const curve = trackCurve();
  const { L, n, k } = trackProfile(curve);
  const end = LAPS * L + 70; // los coches siguen rodando un poco después de la meta
  const cars = entries.map((e, gi) => {
    const p = racePerf(e);
    let h = seed >>> 0;
    for (const c of e.id) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
    const rng = mulberry32(h);
    const grid = 6 + gi * 7; // parrilla escalonada
    const m = Math.ceil((end + grid) / DS) + 1;
    const vlim = new Float64Array(m);
    const lapForm = Array.from({ length: LAPS + 1 }, () => 0.965 + 0.035 * rng()); // inspiración de cada vuelta
    const events = [];
    for (let j = 0; j < m; j++) {
      const s = -grid + j * DS, lap = Math.max(0, Math.floor(s / L));
      const kk = Math.abs(k[(((Math.round(s / DS)) % n) + n) % n]);
      vlim[j] = Math.min(p.vmax, Math.sqrt((p.mu * G) / Math.max(kk, 1e-4))) * lapForm[Math.min(LAPS, lap)];
    }
    // Errores: cuanto menos fiable (o con defecto de calidad), más fácil pasarse de frenada
    const pErr = 0.05 + (100 - p.reliability) / 260 + (p.penalty ? 0.06 : 0);
    for (let lap = 0; lap < LAPS; lap++) {
      if (rng() >= pErr) continue;
      const corners = [];
      for (let i = 0; i < n; i++) if (Math.abs(k[i]) > 0.018) corners.push(i);
      if (!corners.length) continue;
      const ci = corners[Math.floor(rng() * corners.length)];
      const s0 = lap * L + ci * DS;
      for (let s = s0; s < s0 + 26; s += DS) { const j = Math.round((s + grid) / DS); if (j < m) vlim[j] *= 0.32; }
      events.push({ s: s0, kind: 'error' });
    }
    // Trompos por exceso de potencia (V2): a la salida de una curva, casi se para
    for (let lap = 0; lap < LAPS; lap++) {
      if (!p.spin || rng() >= p.spin) continue;
      const corners = [];
      for (let i = 0; i < n; i++) if (Math.abs(k[i]) > 0.012) corners.push(i);
      if (!corners.length) continue;
      const s0 = lap * L + corners[Math.floor(rng() * corners.length)] * DS;
      for (let s = s0; s < s0 + 18; s += DS) { const j = Math.round((s + grid) / DS); if (j < m) vlim[j] = Math.min(vlim[j], 3); }
      events.push({ s: s0, kind: 'spin' });
    }
    // Motor roto (V2): a partir de ahí el coche se va parando en 60 m y abandona
    let stopJ = m - 1, dnf = false;
    if (p.blow && rng() < p.blow) {
      const sFail = (0.12 + rng() * 0.83) * LAPS * L;
      const j0 = Math.round((sFail + grid) / DS);
      stopJ = Math.min(m - 1, j0 + Math.round(60 / DS));
      for (let j = j0; j <= stopJ; j++) vlim[j] = Math.min(vlim[j], Math.max(0.8, 38 * (1 - (j - j0) / (stopJ - j0))));
      dnf = true;
      events.push({ s: sFail, kind: 'blowup' });
    }
    // Velocidad: acelera hasta el límite y frena a tiempo para el siguiente
    const v = new Float64Array(m);
    v[0] = 0;
    for (let j = 0; j < m - 1; j++) {
      const a = p.a0 * Math.max(0.04, 1 - v[j] / p.vmax);
      v[j + 1] = Math.min(vlim[j + 1], Math.sqrt(v[j] * v[j] + 2 * a * DS));
    }
    const brake = p.brake;
    for (let j = m - 2; j >= 1; j--) v[j] = Math.min(v[j], Math.sqrt(v[j + 1] * v[j + 1] + 2 * brake * DS));
    // Tiempo en cada punto
    const t = new Array(m);
    t[0] = 0;
    for (let j = 0; j < m - 1; j++) t[j + 1] = t[j] + DS / Math.max(0.6, (v[j] + v[j + 1]) / 2);
    const timeAt = (s) => { const f = (s + grid) / DS, j = Math.floor(f); return t[j] + (t[j + 1] - t[j]) * (f - j); };
    const stopS = -grid + stopJ * DS; // donde se queda parado si abandona
    const laps = []; let prev = timeAt(0);
    for (let l = 1; l <= LAPS && (!dnf || l * L < stopS); l++) { const tl = timeAt(l * L); laps.push(tl - prev); prev = tl; }
    for (const ev of events) ev.t = Math.round(timeAt(Math.min(ev.s, stopS - DS)) * 100) / 100;
    return {
      id: e.id, grid,
      t: t.slice(0, stopJ + 1).map((x) => Math.round(x * 1000) / 1000),
      finish: dnf ? null : Math.round(timeAt(LAPS * L) * 1000) / 1000,
      dnf, stopS, stopT: Math.round(t[stopJ] * 1000) / 1000,
      laps: laps.map((x) => Math.round(x * 1000) / 1000),
      events: events.filter((ev) => !dnf || ev.s < stopS),
    };
  });
  return { seed, L, laps: LAPS, ds: DS, cars };
}

// ---------- Escena de la carrera ----------
function nameTag(name, color) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(20,17,14,0.82)';
  c.beginPath(); c.roundRect(8, 16, 496, 96, 24); c.fill();
  c.fillStyle = color; c.fillRect(30, 40, 16, 48);
  c.fillStyle = '#fff'; c.font = '700 54px Satoshi, sans-serif'; c.textBaseline = 'middle';
  c.fillText(name, 66, 66, 420);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(3.6, 0.9, 1);
  s.renderOrder = 10;
  return s;
}
function checkerTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const c = cv.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; c.fillRect(x * 8, y * 8, 8, 8); }
  const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class RaceScene {
  constructor(shop) {
    this.shop = shop;
    this.group = new THREE.Group();
    this.group.position.set(TRACK_ORIGIN.x, 0, TRACK_ORIGIN.z);
    this.group.visible = false;
    shop.scene.add(this.group);
    this.curve = trackCurve();
    this.prof = trackProfile(this.curve);
    this.cars = [];
    this.time = 0;
    this.running = false;
    this.camMode = 'me';
    this.build();
    this.update = (dt) => this.frame(dt);
    shop.onFrame.add(this.update);
  }

  // Punto del circuito a una distancia s (m) y desplazamiento lateral (positivo = izquierda)
  at(s, lat = 0) {
    const L = this.prof.L, u = (((s % L) + L) % L) / L;
    const p = this.curve.getPointAt(u), t = this.curve.getTangentAt(u);
    const nrm = V(t.z, 0, -t.x); // izquierda mirando hacia delante
    return { p: p.addScaledVector(nrm, lat), t, head: Math.atan2(-t.z, t.x) };
  }

  build() {
    const g = this.group;
    const N = this.prof.n;
    // Césped y escapatorias
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), mat('#4f7a3a', { roughness: 1 }));
    grass.position.set(40, -0.02, 70); grass.receiveShadow = true; g.add(grass);
    // Cinta de asfalto, líneas blancas y pianos en las curvas
    const ribbon = (half0, half1, y, material) => {
      const pos = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const a = this.at(i * DS, half0).p, b = this.at(i * DS, half1).p;
        pos.push(a.x, y, a.z, b.x, y, b.z);
        if (i < N) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, material);
      m.material.side = THREE.DoubleSide;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    ribbon(W / 2 + 4, -W / 2 - 4, 0.0, mat('#8c7a5c', { roughness: 1 })); // grava/arcén
    ribbon(W / 2, -W / 2, 0.02, mat('#33363b', { roughness: 0.9 }));
    for (const s of [-1, 1]) ribbon(s * (W / 2 - 0.35), s * (W / 2 - 0.6), 0.03, new THREE.MeshBasicMaterial({ color: '#e9e6df' }));
    // Pianos rojos y blancos donde la curva es cerrada
    const red = mat('#d6402b', { roughness: 0.7 }), white = mat('#f0ede6', { roughness: 0.7 });
    const kerbGeo = new THREE.BoxGeometry(DS * 1.02, 0.08, 1.1);
    const kerbs = [[], []];
    for (let i = 0; i < N; i++) {
      if (Math.abs(this.prof.k[i]) < 0.012) continue;
      for (const s of [-1, 1]) {
        const { p, head } = this.at(i * DS, s * (W / 2 + 0.55));
        const m4 = new THREE.Matrix4().makeRotationY(head).setPosition(p.x, 0.04, p.z);
        kerbs[i % 2].push(m4);
      }
    }
    kerbs.forEach((list, k) => {
      const im = new THREE.InstancedMesh(kerbGeo, k ? red : white, list.length);
      list.forEach((m4, i) => im.setMatrixAt(i, m4));
      g.add(im);
    });
    // Línea de meta, parrilla y pórtico con semáforo
    const start = this.at(0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2.2, W).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: checkerTexture() }));
    line.position.set(start.p.x, 0.035, start.p.z); line.rotation.y = start.head; g.add(line);
    const gantry = new THREE.Group();
    const steel = mat('#3a3f46', { roughness: 0.4, metalness: 0.6 });
    for (const s of [-1, 1]) { const post = box(0.5, 7, 0.5, steel); post.position.set(0, 3.5, s * (W / 2 + 1.2)); gantry.add(post); }
    const beam = box(1.2, 1.2, W + 3, steel); beam.position.y = 7.2; gantry.add(beam);
    const banner = box(0.1, 1.0, W + 2.4, new THREE.MeshBasicMaterial({ color: '#ff6a1a' })); banner.position.set(0.62, 7.2, 0); gantry.add(banner);
    this.lamps = [];
    for (let i = 0; i < 5; i++) {
      const lm = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), new THREE.MeshBasicMaterial({ color: '#2a0f0c' }));
      lm.position.set(-0.7, 6.2, (i - 2) * 1.1); gantry.add(lm); this.lamps.push(lm);
    }
    gantry.position.copy(start.p); gantry.rotation.y = start.head; g.add(gantry);
    // Tribuna con público a lo largo de la recta
    const stand = new THREE.Group();
    const conc = mat('#9b9a95', { roughness: 0.9 });
    for (let r = 0; r < 6; r++) { const step = box(70, 0.6, 1.4, conc); step.position.set(35, 0.3 + r * 0.6, -(W / 2 + 8 + r * 1.4)); stand.add(step); }
    const roof = box(72, 0.3, 10, mat('#2b2f35')); roof.position.set(35, 7.2, -(W / 2 + 11.5)); stand.add(roof);
    const crowdGeo = new THREE.BoxGeometry(0.45, 0.8, 0.4);
    const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), 6 * 100);
    const col = new THREE.Color(), rnd = mulberry32(77);
    let ci = 0;
    for (let r = 0; r < 6; r++) for (let i = 0; i < 100; i++) {
      if (rnd() < 0.18) continue;
      crowd.setMatrixAt(ci, new THREE.Matrix4().setPosition(1 + i * 0.68 + rnd() * 0.2, 1.0 + r * 0.6, -(W / 2 + 8 + r * 1.4)));
      crowd.setColorAt(ci, col.setHSL(rnd(), 0.55, 0.35 + rnd() * 0.3));
      ci++;
    }
    crowd.count = ci;
    stand.add(crowd);
    g.add(stand);
    // Muros de neumáticos en el exterior de las curvas y árboles alrededor
    const tyreGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.9, 10);
    const tyres = [];
    for (let i = 0; i < N; i += 2) {
      const kk = this.prof.k[i];
      if (Math.abs(kk) < 0.02) continue;
      const side = kk > 0 ? -1 : 1; // por fuera de la curva
      tyres.push(this.at(i * DS, side * (W / 2 + 7)).p);
    }
    const tyreMesh = new THREE.InstancedMesh(tyreGeo, mat('#18191b', { roughness: 0.9 }), tyres.length);
    tyres.forEach((p, i) => tyreMesh.setMatrixAt(i, new THREE.Matrix4().setPosition(p.x, 0.45, p.z)));
    g.add(tyreMesh);
    const trees = [];
    const near = (x, z) => { for (let i = 0; i < N; i += 3) { const p = this.at(i * DS).p; if ((p.x - x) ** 2 + (p.z - z) ** 2 < 24 * 24) return true; } return false; };
    for (let i = 0; i < 260 && trees.length < 140; i++) {
      const x = -180 + rnd() * 440, z = -90 + rnd() * 330;
      if (z < -10 && x > -10 && x < 90) continue; // la tribuna
      if (!near(x, z)) trees.push([x, z, 0.8 + rnd() * 0.7]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6), mat('#5b4330'), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 6, 8), mat('#2f5a2c', { roughness: 0.9 }), trees.length);
    trees.forEach(([x, z, s], i) => {
      trunk.setMatrixAt(i, new THREE.Matrix4().compose(V(x, 1.2 * s, z), new THREE.Quaternion(), V(s, s, s)));
      crown.setMatrixAt(i, new THREE.Matrix4().compose(V(x, (2.4 + 3) * s, z), new THREE.Quaternion(), V(s, s, s)));
    });
    g.add(trunk, crown);
    // Luz propia: sol y cielo
    this.sun = new THREE.DirectionalLight('#fff4e0', 0);
    this.sun.position.set(80, 120, -60);
    this.sun.target.position.set(40, 0, 70);
    this.hemi = new THREE.HemisphereLight('#cfe6ff', '#56703f', 0);
    g.add(this.sun, this.sun.target, this.hemi);
  }

  // ---------- Entrar y salir de la escena ----------
  enter() {
    const s = this.shop.scene;
    this.saved = { bg: s.background.clone(), fog: s.fog.color.clone(), near: s.fog.near, far: s.fog.far, lights: [] };
    s.traverse((o) => { if (o.isLight && !this.isMine(o)) { this.saved.lights.push([o, o.intensity]); o.intensity = 0; } });
    s.background.set('#9cc9ec'); s.fog.color.set('#b9d6ee'); s.fog.near = 120; s.fog.far = 420;
    this.sun.intensity = 2.6; this.hemi.intensity = 1.3;
    this.shop.camera.far = 600; this.shop.camera.updateProjectionMatrix();
    this.group.visible = true;
  }
  isMine(o) { for (let p = o; p; p = p.parent) if (p === this.group) return true; return false; }
  leave() {
    this.running = false;
    this.group.visible = false;
    this.sun.intensity = 0; this.hemi.intensity = 0;
    if (!this.saved) return;
    const s = this.shop.scene;
    s.background.copy(this.saved.bg); s.fog.color.copy(this.saved.fog); s.fog.near = this.saved.near; s.fog.far = this.saved.far;
    for (const [l, i] of this.saved.lights) l.intensity = i;
    this.shop.camera.far = 200; this.shop.camera.updateProjectionMatrix();
    this.saved = null;
  }

  // Coloca los coches en la parrilla. entries: datos de cada jugador; race: lo que mandó el anfitrión
  setup(entries, race, myId) {
    for (const c of this.cars) this.group.remove(c.root);
    if (this.smoke) { for (const sp of this.smoke) this.group.remove(sp); this.smoke = []; }
    this.race = race;
    this.myId = myId;
    this.cars = race.cars.map((rc, i) => {
      const e = entries.find((x) => x.id === rc.id);
      const root = new THREE.Group();
      const car = buildCar(e.spec);
      car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      root.add(car);
      const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
      blob.scale.set(2.6, 1, 1.2); blob.position.y = 0.04; root.add(blob);
      const tag = nameTag(e.name, e.spec.color);
      tag.position.y = 3.0; root.add(tag);
      this.group.add(root);
      const wheels = [];
      car.traverse((o) => { if (o.userData.isWheel) wheels.push(o); });
      const lane = (i % 2 ? -1 : 1) * 2.6;
      return { id: rc.id, entry: e, rc, root, car, wheels, lane, lat: lane, s: -rc.grid, done: false, speed: 0 };
    });
    this.time = -1;
    this.running = false;
    for (const c of this.cars) this.place(c, -c.rc.grid);
    for (const l of this.lamps) l.material.color.set('#2a0f0c');
  }

  // Distancia recorrida por un coche en el instante t (búsqueda binaria en sus tiempos)
  distAt(rc, t) {
    const ts = rc.t;
    if (t <= 0) return -rc.grid;
    if (t >= ts[ts.length - 1]) return -rc.grid + (ts.length - 1) * this.race.ds;
    let lo = 0, hi = ts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
    const f = (t - ts[lo]) / Math.max(1e-6, ts[hi] - ts[lo]);
    return -rc.grid + (lo + f) * this.race.ds;
  }
  place(c, s) {
    const { p, head } = this.at(s, c.lat);
    c.root.position.set(p.x, 0.02, p.z);
    c.root.rotation.y = head;
  }

  // Semáforo: cinco luces rojas y apagado = salida
  async countdown(sfx) {
    for (const l of this.lamps) { l.material.color.set('#ff2a1a'); sfx && sfx.tick(); await tween(0.75, () => {}, ease.linear); }
    await tween(0.5 + ((this.race.seed % 7) / 10), () => {}, ease.linear);
    for (const l of this.lamps) l.material.color.set('#2a0f0c');
    this.time = 0;
    this.running = true;
  }

  // Clasificación en vivo: primero los que han terminado (por tiempo), después por distancia
  standings() {
    const total = this.race.laps * this.race.L;
    const out = (c) => c.rc.dnf && this.time >= c.rc.stopT;
    return [...this.cars].sort((a, b) => {
      const fa = a.s >= total, fb = b.s >= total;
      if (fa && fb) return a.rc.finish - b.rc.finish;
      if (fa !== fb) return fa ? -1 : 1;
      const oa = out(a), ob = out(b);
      if (oa !== ob) return oa ? 1 : -1;
      return b.s - a.s;
    });
  }

  frame(dt) {
    if (!this.group.visible || !this.cars.length) return;
    if (this.running) this.time += dt;
    const total = this.race.laps * this.race.L;
    for (const c of this.cars) {
      const s = this.running ? this.distAt(c.rc, this.time) : c.s;
      const d = s - c.s;
      c.speed = dt > 0 ? (c.speed * 0.85 + (d / dt) * 0.15) : c.speed;
      c.s = s;
      // Ruedas: giran según lo recorrido
      for (const w of c.wheels) w.rotation.z += (w.position.z < 0 ? 1 : -1) * d / 0.36;
      if (!c.done && s >= total) c.done = true;
    }
    // Coche roto: humo y a un lado de la pista
    for (const c of this.cars) {
      if (!c.rc.dnf) continue;
      const broken = c.s >= c.rc.stopS - 60;
      if (broken) this.puff(c, dt);
    }
    this.updateSmoke(dt);
    // Carriles: el que viene detrás se abre para adelantar en vez de atravesar al de delante
    for (const c of this.cars) {
      let target = c.lane;
      if (c.rc.dnf && c.s >= c.rc.stopS - 60) { c.lat += (5.4 - c.lat) * Math.min(1, dt * 1.2); this.place(c, c.s); continue; }
      for (const o of this.cars) {
        if (o === c) continue;
        const gap = o.s - c.s;
        if (gap > 0 && gap < 9 && Math.abs(o.lat - c.lat) < 2.4) target = o.lat > 0 ? -3.2 : 3.2;
      }
      c.lat += (Math.max(-4.6, Math.min(4.6, target)) - c.lat) * Math.min(1, dt * 1.6);
      this.place(c, c.s);
    }
    this.followCam(dt);
  }

  // Humo del motor roto
  puff(c, dt) {
    c.smokeT = (c.smokeT || 0) - dt;
    if (c.smokeT > 0) return;
    c.smokeT = 0.08;
    if (!this.smokeTex) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      this.smokeTex = new THREE.CanvasTexture(cv);
      this.smoke = [];
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: Math.random() < 0.2 ? '#ff7a2a' : '#3a3a3a', transparent: true, opacity: 0.8, depthWrite: false }));
    const fwd = V(Math.cos(c.root.rotation.y), 0, -Math.sin(c.root.rotation.y));
    sp.position.copy(c.root.position).addScaledVector(fwd, 1.4).add(V((Math.random() - 0.5) * 0.4, 1.0, (Math.random() - 0.5) * 0.4));
    sp.scale.setScalar(0.8);
    sp.userData.life = 0;
    this.group.add(sp);
    this.smoke.push(sp);
  }
  updateSmoke(dt) {
    if (!this.smoke) return;
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const sp = this.smoke[i];
      sp.userData.life += dt;
      const t = sp.userData.life / 2.4;
      sp.position.y += dt * 1.6;
      sp.position.x += dt * 0.6;
      sp.scale.setScalar(0.8 + t * 3.5);
      sp.material.opacity = Math.max(0, 0.8 * (1 - t));
      if (t >= 1) { this.group.remove(sp); sp.material.dispose(); this.smoke.splice(i, 1); }
    }
  }

  followCam(dt) {
    const cam = this.shop.camera, ctl = this.shop.controls;
    const order = this.standings();
    const focus = this.camMode === 'leader' ? order[0] : this.cars.find((c) => c.id === this.myId) || order[0];
    if (!focus) return;
    const k = 1 - Math.exp(-dt * 3);
    if (this.camMode === 'tv') {
      // Cámaras fijas de televisión: la más cercana al líder
      const L = this.race.L, s = ((focus.s % L) + L) % L;
      const slot = Math.round(s / 90) * 90;
      const { p } = this.at(slot, 22);
      const goal = p.add(V(TRACK_ORIGIN.x, 9, TRACK_ORIGIN.z));
      cam.position.lerp(goal, k);
    } else {
      const { p, t } = this.at(focus.s, focus.lat);
      const wp = p.add(V(TRACK_ORIGIN.x, 0, TRACK_ORIGIN.z));
      const portrait = Math.max(1, Math.pow(1 / Math.max(0.3, cam.aspect || 1), 0.7));
      const goal = wp.clone().addScaledVector(t, -11 * portrait).add(V(0, 4.2 * portrait, 0));
      cam.position.lerp(goal, k);
    }
    const tgt = focus.root.getWorldPosition(V()).add(V(0, 1.0, 0));
    ctl.target.lerp(tgt, k * 1.4);
  }
}
