// Carrera arcade asistida. El coche sigue la trazada solo; el jugador decide los momentos clave:
//  - la salida (pulsar cuando se apagan las luces; antes de tiempo = salida en falso),
//  - la frenada de cada curva (hay un punto ideal: pronto pierde tiempo, tarde te abres, a la grava o trompo),
//  - el nitro (se recarga con curvas perfectas y con el rebufo; en curva puede hacerte trompear y en V2
//    castiga el motor), y el rebufo detrás de otro coche en recta.
// Cada jugador simula su propio coche y manda su posición; el anfitrión simula los bots y reparte todo.
import * as THREE from 'three';
import { mat, box } from './engine3d.js';
import { buildCar } from '../car3d.js';
import { carStats, isV2 } from './rules.js';
import { mulberry32 } from './build.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const TRACK_ORIGIN = { x: 0, z: 760 };
export const LAPS = 2;
const ARCADE = 1.35; // todo un poco más rápido que la realidad: es un juego
const W = 14;            // ancho de la pista
const DS = 2;            // muestreo del trazado (m)
const G = 9.81;
const EDGE = W / 2 - 1.3; // hasta dónde se abre la trazada sin pisar el piano
// Circuito técnico (≈1,6 km): recta de meta, horquilla, chicane, 90° a la izquierda, curva rápida
// larga, derecha cerrada, eses, izquierda larga y la última secuencia antes de meta.
const POINTS = [[0, 0], [150, 0], [290, 0], [322, 8], [334, 35], [320, 60], [290, 64], [258, 62], [238, 76], [234, 98], [212, 116], [196, 140], [206, 166], [245, 176], [300, 178], [350, 190], [372, 222], [368, 262], [340, 286], [302, 288], [266, 272], [244, 246], [208, 248], [182, 274], [150, 298], [95, 306], [40, 302], [0, 290], [-24, 262], [-22, 230], [-5, 205], [20, 185], [24, 150], [4, 122], [-30, 104], [-44, 70], [-40, 35], [-22, 10]];
const CORNER_K = 0.006; // curvatura a partir de la cual es curva (radio < 165 m)

// ---------- Trazado ----------
const smooth = (src, r) => { const n = src.length, out = new Float64Array(n); for (let i = 0; i < n; i++) { let a = 0; for (let j = -r; j <= r; j++) a += src[(i + j + n) % n]; out[i] = a / (2 * r + 1); } return out; };
function buildTrack() {
  const curve = new THREE.CatmullRomCurve3(POINTS.map(([x, z]) => V(x, 0, z)), true, 'centripetal');
  const L = curve.getLength(), n = Math.round(L / DS);
  const P = [], T = [];
  for (let i = 0; i <= n; i++) { const u = i / n; P.push(curve.getPointAt(u % 1)); T.push(curve.getTangentAt(u % 1)); }
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = T[(i - 1 + n) % n], b = T[(i + 1) % n];
    let d = Math.atan2(b.z, b.x) - Math.atan2(a.z, a.x);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    raw[i] = d / (2 * DS);
  }
  const k = smooth(raw, 4);           // curvatura del eje de la pista
  // Trazada ideal: por fuera al entrar, al vértice por dentro y por fuera al salir. Sale de comparar la
  // curvatura cercana con la de un tramo más largo; el lado interior es el contrario al signo de k.
  const kn = smooth(raw, 6), kw = smooth(raw, 32);
  const rawLine = new Float64Array(n);
  for (let i = 0; i < n; i++) rawLine[i] = -Math.max(-1, Math.min(1, (2 * kn[i] - kw[i]) * 34)) * EDGE;
  const line = smooth(rawLine, 10);
  // Lo cerrada que es la curva por la trazada (abrir la curva = radio más grande) y sin trazada
  const kLine = new Float64Array(n), kAxis = new Float64Array(n);
  for (let i = 0; i < n; i++) { kAxis[i] = Math.abs(kn[i]); kLine[i] = Math.abs(kn[i]) * 0.74; }
  // Curvas: cada pico de curvatura; entra y sale donde la curvatura baja a la mitad
  const ak = (q) => Math.abs(kn[((q % n) + n) % n]);
  const corners = [];
  const WIN = 25;
  for (let p = 0; p < n; p++) {
    if (ak(p) < CORNER_K) continue;
    let peak = true;
    for (let q = p - WIN; q <= p + WIN && peak; q++) if (q !== p && (ak(q) > ak(p) || (ak(q) === ak(p) && q < p))) peak = false;
    if (!peak) continue;
    const thr = ak(p) * 0.5, sg = Math.sign(kn[p]);
    let a = p, b = p;
    while (p - a < 60 && ak(a - 1) > thr && Math.sign(kn[((a - 1) % n + n) % n]) === sg) a--;
    while (b - p < 60 && ak(b + 1) > thr && Math.sign(kn[(b + 1) % n]) === sg) b++;
    corners.push({ start: a * DS, end: Math.max(b, a + 4) * DS, apex: p * DS, kmax: ak(p), side: sg });
  }
  corners.sort((x, y) => x.start - y.start);
  for (let q = corners.length - 1; q > 0; q--) {
    const a = corners[q - 1], b = corners[q];
    // Trozos de la misma curva, o curvas encadenadas (chicane, eses): una sola frenada
    if ((b.side === a.side && b.start - a.end < 24) || b.start - a.end < 45) { a.end = Math.max(a.end, b.end); if (b.kmax > a.kmax) { a.kmax = b.kmax; a.apex = b.apex; a.side = b.side; } corners.splice(q, 1); }
    else if (b.start < a.end) b.start = a.end;
  }
  corners.forEach((c, q) => (c.id = q));
  return { curve, L, n, P, T, k, kn, line, kLine, kAxis, corners };
}
const TRACK = buildTrack();
export const TRACK_LENGTH = TRACK.L;
export const CORNERS = TRACK.corners;

const idx = (s) => { const n = TRACK.n; return ((Math.round(s / DS) % n) + n) % n; };
// Trazada ideal (desplazamiento lateral) en s
export const lineAt = (s) => TRACK.line[idx(s)];
// Punto del trazado a una distancia s y desplazamiento lateral (positivo = izquierda mirando hacia delante)
function at(s, lat = 0) {
  const { L, n, P, T } = TRACK;
  const sm = ((s % L) + L) % L, f = sm / DS, i = Math.floor(f), t = f - i;
  const a = P[i], b = P[Math.min(n, i + 1)], ta = T[i], tb = T[Math.min(n, i + 1)];
  const tan = V(ta.x + (tb.x - ta.x) * t, 0, ta.z + (tb.z - ta.z) * t).normalize();
  const nrm = V(tan.z, 0, -tan.x);
  const p = V(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t).addScaledVector(nrm, lat);
  return { p, t: tan, head: Math.atan2(-tan.z, tan.x) };
}
// Próxima curva (o la actual) desde s: inicio y final en distancia absoluta
function cornerAhead(s) {
  const { L, corners } = TRACK;
  const base = Math.floor(s / L) * L;
  let best = null;
  for (const lapBase of [base - L, base, base + L]) for (const c of corners) {
    const cs = lapBase + c.start, ce = lapBase + c.end;
    if (ce <= s) continue;
    if (!best || cs < best.cs) best = { c, cs, ce, key: Math.round(cs) };
  }
  return best;
}

// ---------- Prestaciones de cada coche en pista ----------
export function racePerf(entry) {
  const st = carStats(entry.spec);
  const v2 = isV2(entry.spec);
  const vmax = (st.vmax / 3.6) * ARCADE;
  const t0100 = Math.max(1.8, st.t0100) / ARCADE;
  const a0 = Math.min(22, (-vmax / t0100) * Math.log(1 - Math.min(0.95, 27.78 / vmax)));
  const tireBonus = (entry.tires && entry.tires.bonus) || 0;
  let mu = Math.min(1.75, Math.max(0.85, 0.8 + 0.12 * st.grip + tireBonus * 0.012));
  const heavy = v2 ? 1450 / st.weightKg : 1;
  if (v2) mu *= Math.pow(heavy, 0.15);
  const brake = (G * mu * 0.9 + 3 * heavy) * ARCADE;
  const spin = v2 ? Math.min(0.35, Math.max(0, st.pw / (230 * mu) - 1) * 0.25) : 0;
  const blow = v2 ? Math.pow((100 - st.reliability) / 100, 2.2) * 0.75 : 0;
  return { vmax, a0, mu, brake, spin, blow, reliability: st.reliability, hp: st.hp, v2 };
}

// ---------- Un coche en carrera (la física es la misma para jugadores y bots) ----------
// El coche va solo por la trazada y acelera a fondo. Lo que no hace solo es FRENAR para las curvas
// fuertes: si el jugador no frena (o frena tarde), llega pasado de velocidad y, según cuánto, se abre,
// se va a la grava o hace un trompo. En las curvas suaves levanta el pie él solo.
export class Racer {
  constructor(entry, grid, lane, { ai = null, seed = 1 } = {}) {
    this.id = entry.id; this.entry = entry;
    this.p = racePerf(entry);
    this.rng = mulberry32(seed);
    this.ai = ai;                 // { skill } en los bots
    this.s = -grid; this.v = 0; this.lat = lane; this.latT = lane; this.pass = lane; this.passT = 0;
    this.nitro = 0.35; this.nitroOn = false;
    this.state = 'grid';          // grid · race · done · out
    this.spinT = 0; this.spinYaw = 0; this.slip = 0; this.offT = 0;
    this.braking = null; this.brakeQ = null; this.judged = null;
    this.lapStart = 0; this.laps = []; this.finishT = null; this.outT = null;
    this.launchT = null; this.jump = false; this.boost = 1;
    this.feedback = [];
    this.drafting = false;
    this.lambda = this.p.blow > 0 ? -Math.log(1 - this.p.blow) / (LAPS * TRACK.L) : 0;
  }
  say(text, kind = 'info') { this.feedback.push({ text, kind }); }
  // Velocidad máxima en un punto: por la trazada la curva es más abierta; fuera de ella, más cerrada
  limit(s, dev = 0) {
    const i = idx(s);
    const kk = TRACK.kLine[i] + (TRACK.kAxis[i] - TRACK.kLine[i]) * Math.min(1, Math.max(0, dev - 2.2) / 4);
    return Math.min(this.p.vmax * 1.2, Math.sqrt((this.p.mu * G * ARCADE * ARCADE) / Math.max(kk, 1e-5)));
  }
  // Lo más lento que hay que ir en la curva (por la trazada)
  target(a) { let v = 1e9; for (let x = a.cs; x <= a.ce; x += DS * 2) v = Math.min(v, this.limit(x)); return v; }
  // ¿Esta curva pide frenar de verdad? (si basta con levantar el pie, el coche lo hace solo).
  // Se decide al acercarse y se recuerda para toda la curva.
  needsBrake(a) {
    if (!this.need) this.need = new Map();
    if (!this.need.has(a.key)) {
      if (a.cs - this.s > 330) return this.target(a) < Math.min(this.v, this.p.vmax) * 0.9;
      this.need.set(a.key, this.target(a) < Math.min(Math.max(this.v, 20), this.p.vmax) * 0.9);
    }
    return this.need.get(a.key);
  }
  // Último punto en el que se puede frenar para llegar bien a cada punto de la curva
  idealBrake(a) {
    let sb = Infinity;
    for (let x = a.cs - 20; x <= a.ce; x += DS * 2) {
      const vl = this.limit(x);
      if (this.v > vl) sb = Math.min(sb, x - (this.v * this.v - vl * vl) / (2 * this.p.brake));
    }
    return sb === Infinity ? a.cs : sb;
  }
  tolerance() { return 6 + 12 * (this.p.mu - 0.85) + this.v * 0.05; }

  // El jugador pulsa FRENAR: frena para la curva que viene (si hace falta)
  pressBrake() {
    if (this.state !== 'race' || this.spinT > 0) return;
    const a = cornerAhead(this.s);
    if (!a || a.cs - this.s > 330 || this.s >= a.cs) return;
    if (this.braking === a.key) return;
    if (!this.needsBrake(a)) { this.say('Esta curva va a fondo', 'info'); return; }
    const diff = this.idealBrake(a) - this.s; // > 0: has frenado antes del punto ideal
    const tol = this.tolerance();
    this.braking = a.key;
    this.brakeQ = Math.abs(diff) <= tol ? 'perfect' : diff > 0 ? 'early' : 'late';
    if (this.brakeQ === 'perfect') this.say('¡Frenada perfecta!', 'good');
    else if (this.brakeQ === 'early') this.say('Pronto: pierdes tiempo', 'warn');
    else this.say('¡Tarde!', 'bad');
  }
  // Salida: pulsar al apagarse las luces
  pressLaunch(raceTime, lightsOn) {
    if (this.launchT != null || this.jump) return;
    if (lightsOn) { this.jump = true; this.say('¡Salida en falso!', 'bad'); return; }
    if (raceTime >= 0) {
      this.launchT = raceTime;
      const rt = raceTime;
      this.boost = rt < 0.25 ? 1.45 : rt < 0.5 ? 1.25 : rt < 0.9 ? 1.1 : 1;
      this.say(rt < 0.25 ? '¡Salida perfecta!' : rt < 0.5 ? 'Buena salida' : 'Salida lenta', rt < 0.5 ? 'good' : 'warn');
    }
  }

  // Bots: frenan con más o menos acierto según su nivel y gastan el nitro en las rectas
  think(raceTime) {
    const ai = this.ai;
    if (this.launchT == null && raceTime >= ai.react) this.pressLaunch(raceTime, false);
    const a = cornerAhead(this.s);
    if (!a) return;
    if (this.braking !== a.key && this.s < a.cs && this.needsBrake(a)) {
      if (!ai.noise.has(a.key)) ai.noise.set(a.key, (this.rng() + this.rng() + this.rng() - 1.5) * 2 * (3 + 22 * (1 - ai.skill)) + 3 * (1 - ai.skill));
      if (this.s >= this.idealBrake(a) - ai.noise.get(a.key)) this.pressBrake();
    }
    const far = a.cs - this.s;
    if (!this.nitroOn && this.nitro > 0.5 && far > 240 && this.s < a.cs) this.nitroOn = true;
    if (this.nitroOn && (this.nitro < 0.12 || far < 110)) this.nitroOn = false;
  }

  update(dt, raceTime) {
    if (this.state === 'grid') return;
    const p = this.p;
    const line = lineAt(this.s);
    if (this.state === 'out') { this.v = Math.max(0, this.v - 9 * dt); this.s += this.v * dt; this.latT = W / 2 + 1.5; this.nitroOn = false; this.steerLat(dt); return; }
    if (this.state === 'done') { this.v += (24 - this.v) * Math.min(1, dt * 0.6); this.s += this.v * dt; this.nitroOn = false; this.latT = line; this.steerLat(dt); return; }
    if (this.jump && raceTime < 1.2) return; // penalización por salida en falso
    if (this.spinT > 0) {
      this.spinT -= dt; this.spinYaw += dt * 8 * (this.spinT > 0.3 ? 1 : this.spinT / 0.3);
      this.v = Math.max(2, this.v - 20 * dt); this.s += this.v * dt; this.nitroOn = false;
      if (this.spinT <= 0) this.spinYaw = 0;
      return;
    }
    // Nitro
    if (this.nitroOn && this.nitro <= 0) this.nitroOn = false;
    if (this.nitroOn) this.nitro = Math.max(0, this.nitro - 0.3 * dt);
    else this.nitro = Math.min(1, this.nitro + (0.025 + (this.drafting ? 0.1 : 0)) * dt);
    const a = cornerAhead(this.s);
    const launch = this.launchT != null && raceTime - this.launchT < 2.5 ? this.boost : 1;
    const vmaxE = p.vmax * (this.nitroOn ? 1.16 : 1) * (this.drafting ? 1.07 : 1);
    let acc = p.a0 * Math.max(0.05, 1 - this.v / vmaxE) * (this.nitroOn ? 1.7 : 1) * launch;
    if (this.launchT == null && raceTime > 1.0) { this.launchT = raceTime; this.boost = 1; } // nadie se queda parado
    // Por dónde va: la trazada, salvo que esté adelantando (se aparta un poco)
    this.passT = Math.max(0, this.passT - dt);
    if (this.passT <= 0) this.pass *= Math.max(0, 1 - dt * 0.8);
    this.latT = Math.max(-EDGE - 0.6, Math.min(EDGE + 0.6, line + this.pass));
    const dev = Math.abs(this.lat - line);
    const lim = this.limit(this.s, dev);
    const offTrack = Math.abs(this.lat) > W / 2 + 0.2;
    if (offTrack) acc *= 0.35; // en la grava no hay tracción
    const braked = a && this.braking === a.key && this.s < a.ce;
    if (braked) {
      // Frenada pedida para esta curva: frena fuerte hasta la velocidad de la curva
      const tgt = this.target(a) * (this.brakeQ === 'perfect' ? 1.0 : 0.96);
      if (this.v > tgt) this.v = Math.max(tgt, this.v - p.brake * dt);
      else this.v = Math.min(tgt, this.v + acc * dt);
    } else this.v = Math.min(vmaxE, this.v + acc * dt);
    if (offTrack) this.v = Math.max(0, this.v - 10 * dt);
    // ¿Va más rápido de lo que permite la curva en este punto?
    const over = this.v / lim;
    const hard = a && this.s >= a.cs - 6 && this.needsBrake(a);
    if (hard && over > 1.06 && this.judged !== a.key) {
      // Llega pasado: cuanto más, peor (se abre, se va a la grava o hace un trompo)
      this.judged = a.key;
      const out = (Math.sign(TRACK.kn[idx(this.s)]) || a.c.side) * EDGE;
      if (over < 1.15) { this.v = lim * 0.78; this.offSide = out * 1.08; this.offT = 1.2; this.slip = -Math.sign(out) * 0.28; this.say('Te abres en la curva', 'warn'); }
      else if (over < 1.32) { this.v = lim * 0.42; this.offSide = out + Math.sign(out) * 3.6; this.offT = 2.0; this.slip = -Math.sign(out) * 0.5; this.say('¡Te vas a la grava!', 'bad'); }
      else this.spin('¡Trompo!');
    }
    if (this.offT > 0) { this.offT -= dt; this.latT = this.offSide; this.sliding = true; } else this.sliding = false;
    // Con el coche bajo control nunca pasa del límite (en curvas suaves levanta el pie solo)
    if (this.spinT <= 0 && this.v > lim) this.v = Math.max(lim, this.v - p.brake * 1.2 * dt);
    // Nitro en plena curva: el coche se descoloca
    if (this.nitroOn && TRACK.kAxis[idx(this.s)] > CORNER_K * 1.6 && this.rng() < (0.55 + p.spin) * dt) this.spin('¡Trompo por el nitro!');
    const s0 = this.s;
    this.s += this.v * dt;
    if (!this.sliding) this.slip *= Math.max(0, 1 - dt * 2.2);
    this.steerLat(dt);
    // Salida de curva: si sobra potencia para el agarre, puede trompear (V2); se olvida la frenada
    if (a && s0 < a.ce && this.s >= a.ce) {
      if (p.spin && this.rng() < p.spin * (this.nitroOn ? 2 : 0.5)) this.spin('¡Trompo: demasiada potencia!');
      this.braking = null; this.brakeQ = null;
    }
    // Motor (V2): cuanto menos fiable, más papeletas de reventar; el nitro lo castiga
    if (this.lambda && this.rng() < this.lambda * (this.s - s0) * (this.nitroOn ? 3 : 1)) {
      this.state = 'out'; this.outT = raceTime; this.say('¡Te ha reventado el motor!', 'bad');
      return;
    }
    // Vueltas y meta
    const L = TRACK.L;
    const lap = Math.floor(this.s / L), lap0 = Math.floor(s0 / L);
    if (lap > lap0 && s0 >= 0) {
      this.laps.push(raceTime - this.lapStart); this.lapStart = raceTime;
      if (lap >= LAPS) { this.state = 'done'; this.finishT = raceTime - (this.s - lap * L) / Math.max(1, this.v); }
      else if (lap === LAPS - 1) this.say('¡Última vuelta!', 'info');
    }
  }
  // Sólo se castiga el exceso en curvas que piden frenar; en las suaves basta con levantar el pie
  needsBrakeOver(over) { return over > 1.04; }
  // El volante: se acerca al carril deseado sin saltos (más despacio cuanto más rápido va)
  steerLat(dt) {
    const rate = 2.6 + 4 / Math.max(1, this.v / 10);
    const d = this.latT - this.lat;
    this.latV = Math.max(-rate, Math.min(rate, d * 2.4));
    this.lat += this.latV * dt;
  }
  spin(text) { this.spinT = 1.3; this.v = Math.min(this.v, 14); this.say(text, 'bad'); }
  // Adelantar: apartarse de la trazada hacia un lado durante un rato
  overtake(side) { this.pass = side * 3.2; this.passT = 1.2; }

  // Ayuda de frenada para el HUD: cuánto falta para el punto ideal
  brakeHint() {
    if (this.state !== 'race' || this.spinT > 0) return null;
    const a = cornerAhead(this.s);
    if (!a || this.s >= a.cs || a.cs - this.s > 330) return null;
    if (!this.needsBrake(a)) return { flat: true, dist: a.cs - this.s };
    if (this.braking === a.key) return { done: true, q: this.brakeQ };
    const d = this.idealBrake(a) - this.s, tol = this.tolerance();
    return { d, tol, dist: a.cs - this.s };
  }
}

// ---------- Texturas ----------
function canvasTex(w, h, draw, repeat = false) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return t;
}
const asphaltTex = () => canvasTex(256, 256, (c, w, h) => {
  c.fillStyle = '#3a3d42'; c.fillRect(0, 0, w, h);
  const r = mulberry32(5);
  for (let i = 0; i < 5000; i++) { const g = 40 + r() * 40; c.fillStyle = `rgb(${g},${g + 2},${g + 6})`; c.fillRect(r() * w, r() * h, 1.5, 1.5); }
  c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(w * 0.18, 0, w * 0.12, h); c.fillRect(w * 0.7, 0, w * 0.12, h); // marcas de neumático
  c.fillStyle = '#e9e6df'; c.fillRect(w / 2 - 2, 0, 4, h * 0.5);                                       // línea discontinua
}, true);
const barrierTex = () => canvasTex(128, 32, (c, w, h) => {
  c.fillStyle = '#e6e3dc'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#d6402b'; c.fillRect(0, 0, w / 2, h);
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, h * 0.45, w, 3);
}, true);
const skyTex = () => canvasTex(16, 256, (c, w, h) => {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2f6fb8'); g.addColorStop(0.45, '#8cc3ef'); g.addColorStop(0.52, '#e7f1f8'); g.addColorStop(1, '#e7f1f8');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
});
function checkerTexture() {
  return canvasTex(64, 64, (c) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; c.fillRect(x * 8, y * 8, 8, 8); } });
}
const ADS = [['RULETA MOTORS', '#ff6a1a', '#16120f'], ['PISTÓN OIL', '#f2c230', '#1f2a44'], ['NITRO X', '#4fd1ff', '#0d1b2a'], ['TURBO TINA', '#ffffff', '#c2185b'], ['BUJÍAS BRUNO', '#16120f', '#9be15d'], ['CÁRTER RACING', '#ffffff', '#2b4c9b']];
const adTex = ([text, fg, bg]) => canvasTex(512, 128, (c, w, h) => {
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.fillStyle = fg; c.font = '800 64px "Clash Display", Satoshi, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, w / 2, h / 2 + 4, w - 40);
});
const boardTex = (num) => canvasTex(128, 160, (c, w, h) => {
  c.fillStyle = '#f4f4f4'; c.fillRect(0, 0, w, h);
  c.strokeStyle = '#16120f'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
  c.fillStyle = '#16120f'; c.font = '800 70px Satoshi, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(num), w / 2, h / 2 + 4);
});
function nameTag(name, color) {
  const t = canvasTex(512, 128, (c) => {
    c.fillStyle = 'rgba(20,17,14,0.82)';
    c.beginPath(); c.roundRect(8, 16, 496, 96, 24); c.fill();
    c.fillStyle = color; c.fillRect(30, 40, 16, 48);
    c.fillStyle = '#fff'; c.font = '700 54px Satoshi, sans-serif'; c.textBaseline = 'middle';
    c.fillText(name, 66, 66, 420);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(3.2, 0.8, 1);
  s.renderOrder = 10;
  return s;
}

// ---------- Escena ----------
export class RaceScene {
  constructor(shop) {
    this.shop = shop;
    this.group = new THREE.Group();
    this.group.position.set(TRACK_ORIGIN.x, 0, TRACK_ORIGIN.z);
    this.group.visible = false;
    shop.scene.add(this.group);
    this.cars = [];
    this.time = -99;
    this.running = false;
    this.build();
    this.update = (dt) => this.frame(dt);
    shop.onFrame.add(this.update);
  }
  at(s, lat) { return at(s, lat); }
  get L() { return TRACK.L; }

  build() {
    const g = this.group, N = TRACK.n;
    const rnd = mulberry32(77);
    // Cielo y montañas lejanas
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.position.set(165, 0, 150); g.add(sky);
    const hillM = new THREE.MeshStandardMaterial({ color: '#7f9db0', roughness: 1, flatShading: true });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + rnd() * 0.1, r = 900 + rnd() * 200, h = 90 + rnd() * 160;
      const m = new THREE.Mesh(new THREE.ConeGeometry(160 + rnd() * 140, h, 6), hillM);
      m.position.set(165 + Math.cos(a) * r, h / 2 - 10, 150 + Math.sin(a) * r); g.add(m);
    }
    // Césped
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600).rotateX(-Math.PI / 2), mat('#4f7a3a', { roughness: 1 }));
    grass.position.set(165, -0.03, 150); grass.receiveShadow = true; g.add(grass);
    // Cintas a lo largo del trazado (suelo y muros), con coordenadas de textura a lo largo
    const ribbon = (l0, l1, y0, y1, material, uvLen = 0) => {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const a = at(i * DS, l0).p, b = at(i * DS, l1).p;
        pos.push(a.x, y0, a.z, b.x, y1, b.z);
        const v = uvLen ? (i * DS) / uvLen : 0;
        uv.push(0, v, 1, v);
        if (i < N) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      material.side = THREE.DoubleSide;
      const m = new THREE.Mesh(geo, material); m.receiveShadow = true; g.add(m);
      return m;
    };
    ribbon(W / 2 + 5, -W / 2 - 5, 0, 0, mat('#a28f6b', { roughness: 1 }));                    // grava
    const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.92 });
    ribbon(W / 2, -W / 2, 0.02, 0.02, asphalt, 9);
    for (const s of [-1, 1]) ribbon(s * (W / 2 - 0.3), s * (W / 2 - 0.65), 0.03, 0.03, new THREE.MeshBasicMaterial({ color: '#efece5' }));
    // Muros (guardarraíles a rayas) a los dos lados
    const bt = barrierTex();
    for (const s of [-1, 1]) {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const p = at(i * DS, s * (W / 2 + 6.5)).p;
        pos.push(p.x, 0, p.z, p.x, 1.0, p.z);
        uv.push((i * DS) / 6, 0, (i * DS) / 6, 1);
        if (i < N) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: bt, roughness: 0.6, side: THREE.DoubleSide })));
    }
    // Pianos en las curvas
    const red = mat('#d6402b', { roughness: 0.7 }), white = mat('#f0ede6', { roughness: 0.7 });
    const kerbGeo = new THREE.BoxGeometry(DS * 1.02, 0.09, 1.3);
    const kerbs = [[], []];
    for (let i = 0; i < N; i++) {
      if (Math.abs(TRACK.k[i]) < CORNER_K * 1.4) continue;
      for (const s of [-1, 1]) {
        const { p, head } = at(i * DS, s * (W / 2 + 0.6));
        kerbs[i % 2].push(new THREE.Matrix4().makeRotationY(head).setPosition(p.x, 0.045, p.z));
      }
    }
    kerbs.forEach((list, k) => { const im = new THREE.InstancedMesh(kerbGeo, k ? red : white, list.length); list.forEach((m4, i) => im.setMatrixAt(i, m4)); g.add(im); });
    // Postes cada 12 m: lo que pasa volando al lado y da sensación de velocidad
    const posts = [];
    for (let s = 0; s < TRACK.L; s += 12) for (const side of [-1, 1]) posts.push(at(s, side * (W / 2 + 4.2)).p);
    const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), mat('#f4f1ea', { roughness: 0.5 }), posts.length);
    const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.25, 0.18), mat('#16120f'), posts.length);
    posts.forEach((p, i) => { postMesh.setMatrixAt(i, new THREE.Matrix4().setPosition(p.x, 0.75, p.z)); capMesh.setMatrixAt(i, new THREE.Matrix4().setPosition(p.x, 1.5, p.z)); });
    g.add(postMesh, capMesh);
    // Farolas cada 48 m en el exterior
    const lamps = [];
    for (let s = 0; s < TRACK.L; s += 48) lamps.push(at(s, (Math.floor(s / 48) % 2 ? 1 : -1) * (W / 2 + 8.5)));
    const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 9, 6), mat('#3a3f46', { metalness: 0.5 }), lamps.length);
    lamps.forEach(({ p }, i) => poleMesh.setMatrixAt(i, new THREE.Matrix4().setPosition(p.x, 4.5, p.z)));
    g.add(poleMesh);
    // Vallas publicitarias y carteles de frenada (150/100/50) antes de cada curva
    const adMats = ADS.map((a) => new THREE.MeshBasicMaterial({ map: adTex(a) }));
    for (let s = 40; s < TRACK.L; s += 95) {
      const side = rnd() < 0.5 ? -1 : 1;
      const { p, head } = at(s, side * (W / 2 + 7.2));
      const ad = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), adMats[Math.floor(rnd() * adMats.length)]);
      ad.position.set(p.x, 2.2, p.z); ad.rotation.y = head - side * Math.PI / 2; ad.material.side = THREE.DoubleSide;
      g.add(ad);
      const legM = mat('#2b2f35');
      for (const d of [-3.8, 3.8]) { const leg = box(0.15, 1.2, 0.15, legM); const q = at(s + d, side * (W / 2 + 7.25)).p; leg.position.set(q.x, 0.6, q.z); g.add(leg); }
    }
    const boards = { 150: new THREE.MeshBasicMaterial({ map: boardTex(150) }), 100: new THREE.MeshBasicMaterial({ map: boardTex(100) }), 50: new THREE.MeshBasicMaterial({ map: boardTex(50) }) };
    for (const c of TRACK.corners) {
      const out = c.side;
      for (const d of [150, 100, 50]) {
        const s = c.start - d;
        const { p, head } = at(s, out * (W / 2 + 3.4));
        const b = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), boards[d]);
        b.position.set(p.x, 1.3, p.z); b.rotation.y = head + Math.PI / 2; // mira hacia los coches que llegan
        g.add(b);
        const leg = box(0.1, 0.6, 0.1, mat('#2b2f35')); leg.position.set(p.x, 0.3, p.z); g.add(leg);
      }
    }
    // Muros de neumáticos en la escapatoria de las curvas
    const tyres = [];
    for (const c of TRACK.corners) for (let s = c.start; s < c.end; s += 2.2) tyres.push(at(s, c.side * (W / 2 + 6.1)).p);
    const tyreMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 10), mat('#18191b', { roughness: 0.9 }), tyres.length);
    tyres.forEach((p, i) => tyreMesh.setMatrixAt(i, new THREE.Matrix4().setPosition(p.x, 0.45, p.z)));
    g.add(tyreMesh);
    // Línea de meta, pórtico con semáforo y tribuna
    const start = at(0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2.4, W).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: checkerTexture() }));
    line.position.set(start.p.x, 0.04, start.p.z); line.rotation.y = start.head; g.add(line);
    const gantry = new THREE.Group();
    const steel = mat('#3a3f46', { roughness: 0.4, metalness: 0.6 });
    for (const s of [-1, 1]) { const post = box(0.6, 8, 0.6, steel); post.position.set(0, 4, s * (W / 2 + 1.4)); gantry.add(post); }
    const beam = box(1.4, 1.4, W + 3.4, steel); beam.position.y = 8.2; gantry.add(beam);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(W + 2.8, 1.2), new THREE.MeshBasicMaterial({ map: adTex(ADS[0]), side: THREE.DoubleSide }));
    banner.position.set(-0.72, 8.2, 0); banner.rotation.y = Math.PI / 2; gantry.add(banner);
    this.lamps = [];
    for (let i = 0; i < 5; i++) {
      const lm = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10), new THREE.MeshBasicMaterial({ color: '#2a0f0c' }));
      lm.position.set(-0.8, 7.0, (i - 2) * 1.2); gantry.add(lm); this.lamps.push(lm);
    }
    gantry.position.copy(start.p); gantry.rotation.y = start.head; g.add(gantry);
    const stand = new THREE.Group();
    const conc = mat('#9b9a95', { roughness: 0.9 });
    for (let r = 0; r < 8; r++) { const step = box(120, 0.6, 1.4, conc); step.position.set(60, 0.3 + r * 0.6, -(W / 2 + 10 + r * 1.4)); stand.add(step); }
    const roof = box(122, 0.3, 13, mat('#2b2f35')); roof.position.set(60, 8.6, -(W / 2 + 15)); stand.add(roof);
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.8, 0.4), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 8 * 170);
    const col = new THREE.Color();
    let ci = 0;
    for (let r = 0; r < 8; r++) for (let i = 0; i < 170; i++) {
      if (rnd() < 0.15) continue;
      crowd.setMatrixAt(ci, new THREE.Matrix4().setPosition(1 + i * 0.7 + rnd() * 0.2, 1.0 + r * 0.6, -(W / 2 + 10 + r * 1.4)));
      crowd.setColorAt(ci, col.setHSL(rnd(), 0.6, 0.35 + rnd() * 0.3)); ci++;
    }
    crowd.count = ci; stand.add(crowd);
    const sp = at(0);
    stand.position.copy(sp.p); stand.rotation.y = sp.head; stand.position.addScaledVector(sp.t, -30);
    g.add(stand);
    // Árboles
    const trees = [];
    const near = (x, z) => { for (let i = 0; i < N; i += 4) { const p = TRACK.P[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < 26 * 26) return true; } return false; };
    for (let i = 0; i < 900 && trees.length < 420; i++) {
      const x = -170 + rnd() * 720, z = -170 + rnd() * 650;
      if (!near(x, z)) trees.push([x, z, 0.8 + rnd() * 0.9]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6), mat('#5b4330'), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 6.5, 7), mat('#2f5a2c', { roughness: 0.9 }), trees.length);
    trees.forEach(([x, z, s], i) => {
      trunk.setMatrixAt(i, new THREE.Matrix4().compose(V(x, 1.2 * s, z), new THREE.Quaternion(), V(s, s, s)));
      crown.setMatrixAt(i, new THREE.Matrix4().compose(V(x, (2.4 + 3.2) * s, z), new THREE.Quaternion(), V(s, s, s)));
    });
    g.add(trunk, crown);
    // Luz propia
    this.sun = new THREE.DirectionalLight('#fff4e0', 0);
    this.sun.position.set(240, 280, -120); this.sun.target.position.set(165, 0, 150);
    this.hemi = new THREE.HemisphereLight('#cfe6ff', '#56703f', 0);
    g.add(this.sun, this.sun.target, this.hemi);
    // Efectos de cada coche: llama de nitro y luz de freno
    this.flameTex = canvasTex(64, 64, (c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(120,200,255,0.9)'); gr.addColorStop(1, 'rgba(60,120,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); });
    this.smokeTex = canvasTex(64, 64, (c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); });
    this.smoke = [];
  }

  // ---------- Entrar y salir ----------
  enter() {
    const s = this.shop.scene, cam = this.shop.camera;
    this.saved = { bg: s.background.clone(), fog: s.fog.color.clone(), near: s.fog.near, far: s.fog.far, fov: cam.fov, lights: [] };
    s.traverse((o) => { if (o.isLight && !this.isMine(o)) { this.saved.lights.push([o, o.intensity]); o.intensity = 0; } });
    s.background.set('#9cc9ec'); s.fog.color.set('#cfe2f0'); s.fog.near = 260; s.fog.far = 1300;
    this.sun.intensity = 2.6; this.hemi.intensity = 1.35;
    cam.far = 2000; cam.updateProjectionMatrix();
    this.group.visible = true;
  }
  isMine(o) { for (let p = o; p; p = p.parent) if (p === this.group) return true; return false; }
  leave() {
    this.running = false;
    this.group.visible = false;
    this.sun.intensity = 0; this.hemi.intensity = 0;
    if (!this.saved) return;
    const s = this.shop.scene, cam = this.shop.camera;
    s.background.copy(this.saved.bg); s.fog.color.copy(this.saved.fog); s.fog.near = this.saved.near; s.fog.far = this.saved.far;
    for (const [l, i] of this.saved.lights) l.intensity = i;
    cam.far = 200; cam.fov = this.saved.fov; cam.updateProjectionMatrix();
    this.saved = null;
  }

  // ---------- Parrilla ----------
  // race: { seed, entries, bots: { id: skill } }. myId: mi coche (lo simulo yo). simulate: ids que simula
  // este navegador (el mío y, en el anfitrión, los bots). El resto llega por la red.
  setup(race, myId, simulate) {
    for (const c of this.cars) this.group.remove(c.root);
    for (const sp of this.smoke) this.group.remove(sp);
    this.smoke = [];
    this.race = race; this.myId = myId;
    this.cars = race.entries.map((e, i) => {
      const grid = 8 + i * 8, lane = (i % 2 ? -1 : 1) * 2.6;
      const skill = race.bots && race.bots[e.id];
      const racer = new Racer(e, grid, lane, { ai: skill != null ? { skill, react: 0.2 + (1 - skill) * 0.5, noise: new Map() } : null, seed: (race.seed ^ (i * 7919)) >>> 0 });
      const root = new THREE.Group();
      const body = new THREE.Group(); root.add(body);
      const car = buildCar(e.spec);
      car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      body.add(car);
      const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.38, depthWrite: false }));
      blob.scale.set(2.7, 1, 1.25); blob.position.y = 0.04; root.add(blob);
      const tag = nameTag(e.name, e.spec.color); tag.position.y = 3.0; root.add(tag);
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      flame.position.set(-2.6, 0.5, 0); flame.scale.set(1.6, 0.9, 1); body.add(flame);
      const brakeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ff2a1a', map: this.smokeTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      brakeGlow.position.set(-2.45, 0.75, 0); brakeGlow.scale.set(2.2, 0.8, 1); body.add(brakeGlow);
      this.group.add(root);
      const wheels = []; car.traverse((o) => { if (o.userData.isWheel) wheels.push(o); });
      const local = simulate.includes(e.id);
      return { id: e.id, entry: e, racer, root, body, car, wheels, tag, flame, brakeGlow, local, buf: [], s: racer.s, lat: lane, v: 0, flags: 0 };
    });
    this.me = this.cars.find((c) => c.id === myId) || this.cars[0];
    this.me.tag.visible = false; // el tuyo no necesita cartel
    this.time = -99; this.running = false; this.lightsOn = false;
    for (const l of this.lamps) l.material.color.set('#2a0f0c');
    for (const c of this.cars) this.place(c, 0);
  }

  // Semáforo: cinco luces rojas y una espera al azar (igual para todos) antes del apagado
  async countdown(sfx, wait) {
    this.lightsOn = true;
    this.time = -99;
    for (const l of this.lamps) { l.material.color.set('#ff2a1a'); sfx && sfx.tick(); await wait(0.7); }
    await wait(0.4 + ((this.race.seed % 9) / 10));
    for (const l of this.lamps) l.material.color.set('#2a0f0c');
    this.lightsOn = false;
    this.time = 0;
    this.running = true;
    for (const c of this.cars) if (c.local) c.racer.state = 'race';
  }

  // Entradas del jugador
  brake() { const r = this.me && this.me.local && this.me.racer; if (!r) return; if (this.lightsOn || this.time < 1.2) this.launch(); else r.pressBrake(); }
  nitro(on) { const r = this.me && this.me.racer; if (!r) return; if (on && (this.lightsOn || this.time < 1.2) && r.launchT == null) { this.launch(); return; } r.nitroOn = on && r.state === 'race' && r.nitro > 0.02; }
  launch() { const r = this.me.racer; r.pressLaunch(this.time, this.lightsOn); }

  // Estado de un coche remoto que llega por la red (s, lat, v, flags)
  remote(id, s, lat, v, flags, finishT) {
    const c = this.cars.find((x) => x.id === id);
    if (!c || c.local) return;
    if (finishT != null) c.finishT = finishT;
    c.buf.push({ t: performance.now(), s, lat, v, flags });
    if (c.buf.length > 20) c.buf.shift();
  }
  // Lo que este navegador manda de los coches que simula
  snapshot() {
    return this.cars.filter((c) => c.local).map((c) => [c.id, Math.round(c.racer.s * 10) / 10, Math.round(c.racer.lat * 100) / 100, Math.round(c.racer.v * 10) / 10, this.flagsOf(c.racer), c.racer.finishT]);
  }
  flagsOf(r) { return (r.nitroOn ? 1 : 0) | (r.braking ? 2 : 0) | (r.spinT > 0 ? 4 : 0) | (r.state === 'out' ? 8 : 0) | (r.state === 'done' ? 16 : 0); }

  // Clasificación en vivo
  standings() {
    const done = (c) => c.flags & 16, out = (c) => c.flags & 8;
    return [...this.cars].sort((a, b) => {
      if (done(a) && done(b)) return (a.finishT ?? 1e9) - (b.finishT ?? 1e9);
      if (!!done(a) !== !!done(b)) return done(a) ? -1 : 1;
      if (!!out(a) !== !!out(b)) return out(a) ? 1 : -1;
      return b.s - a.s;
    });
  }

  frame(dt) {
    if (!this.group.visible || !this.cars.length) return;
    dt = Math.min(dt, 0.05);
    if (this.running) this.time += dt;
    const now = performance.now();
    // Simulación de mis coches; interpolación del resto (con 150 ms de retraso)
    for (const c of this.cars) {
      if (c.local) {
        const r = c.racer;
        if (this.running) {
          if (r.ai) r.think(this.time);
          r.update(dt, this.time);
        }
        const d = r.s - c.s;
        c.s = r.s; c.v = r.v; c.flags = this.flagsOf(r);
        if (r.finishT != null) c.finishT = r.finishT;
        c.latV = r.latV || 0; c.lat = r.lat; c.slip = r.slip;
        c.dist = d;
      } else if (c.buf.length) {
        const tt = now - 150;
        let a = c.buf[0], b = c.buf[c.buf.length - 1];
        for (let i = 0; i < c.buf.length - 1; i++) if (c.buf[i].t <= tt && c.buf[i + 1].t >= tt) { a = c.buf[i]; b = c.buf[i + 1]; break; }
        const f = b.t > a.t ? Math.min(1.5, Math.max(0, (tt - a.t) / (b.t - a.t))) : 1;
        const s = a.s + (b.s - a.s) * f;
        const lat = a.lat + (b.lat - a.lat) * Math.min(1, f);
        c.latV = dt ? (lat - c.lat) / dt : 0;
        c.dist = s - c.s; c.s = s; c.lat = lat; c.v = b.v; c.flags = b.flags;
      }
    }
    // Rebufo y adelantamientos (solo afectan a los coches que simulo)
    for (const c of this.cars) {
      if (!c.local || c.racer.state !== 'race') continue;
      const r = c.racer;
      r.drafting = false;
      const a = cornerAhead(r.s);
      const straight = !a || r.s < a.cs - 30;
      for (const o of this.cars) {
        if (o === c || (o.flags & 8)) continue;
        const gap = o.s - r.s, side = Math.abs(o.lat - c.lat);
        if (gap > 4 && gap < 24 && side < 2.6 && straight && r.v > 25) r.drafting = true;
        if (gap > 0 && gap < 5.5 && side < 2.3) {
          r.v = Math.min(r.v, o.v + 0.5);
          if (r.passT <= 0) r.overtake(o.lat > lineAt(r.s) ? -1 : 1); // por el lado contrario al que lleva el de delante
        }
      }
    }
    // Dibujo; los carteles con el nombre mantienen su tamaño en pantalla y no tapan la vista de cerca
    const camPos = this.shop.camera.position;
    for (const c of this.cars) {
      this.place(c, dt);
      if (c === this.me) continue;
      const d = c.root.getWorldPosition(V()).distanceTo(camPos);
      c.tag.visible = d > 11;
      const k = Math.min(3.2, Math.max(1, d * 0.05));
      c.tag.scale.set(3.2 * k, 0.8 * k, 1);
    }
    this.updateSmoke(dt);
    this.followCam(dt);
  }

  place(c, dt) {
    const { p, head } = at(c.s, c.lat);
    c.root.position.set(p.x, 0.02, p.z);
    const r = c.local ? c.racer : null;
    const spinning = c.flags & 4;
    c.spinYaw = r ? r.spinYaw : spinning ? (c.spinYaw || 0) + dt * 9 : 0;
    const v = Math.max(1, c.v || 0), kk = TRACK.kn[idx(c.s)];
    const drift = Math.atan2(c.latV || 0, v) + (c.slip || 0);
    const y0 = c.yaw ?? head, dy = head + drift - y0;
    c.yaw = y0 + Math.atan2(Math.sin(dy), Math.cos(dy)) * (dt ? Math.min(1, dt * 10) : 1);
    c.root.rotation.y = c.yaw + (c.spinYaw || 0);
    // Cabeceo (frenada: morro abajo; nitro: morro arriba) y balanceo hacia el exterior de la curva
    const braking = c.flags & 2, nitro = c.flags & 1;
    c.body.rotation.z += (((braking ? -0.025 : 0) + (nitro ? 0.02 : 0)) - c.body.rotation.z) * Math.min(1, dt * 6);
    const roll = Math.max(-0.07, Math.min(0.07, v * v * kk * 0.004));
    c.body.rotation.x += (roll - c.body.rotation.x) * Math.min(1, dt * 5);
    const steer = Math.max(-0.5, Math.min(0.5, -kk * 2.8 + (c.latV || 0) * 0.04 - (c.slip || 0) * 1.2));
    for (const w of c.wheels) {
      w.rotation.z += (w.position.z < 0 ? 1 : -1) * (c.dist || 0) / 0.36;
      if (w.position.x > 0) { if (w.userData.yaw0 == null) w.userData.yaw0 = w.rotation.y; w.rotation.y = w.userData.yaw0 + steer; }
    }
    c.flame.material.opacity = nitro ? 0.6 + Math.random() * 0.4 : 0;
    c.flame.scale.set(1.2 + Math.random() * 1.2, 0.7 + Math.random() * 0.3, 1);
    c.brakeGlow.material.opacity = braking && c.v > 8 ? 0.8 : 0;
    if (c.flags & 8 && dt) this.puff(c, dt);
  }

  // Humo del motor roto
  puff(c, dt) {
    c.smokeT = (c.smokeT || 0) - dt;
    if (c.smokeT > 0 || this.smoke.length > 160) return;
    c.smokeT = 0.08;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, color: Math.random() < 0.2 ? '#ff7a2a' : '#3a3a3a', transparent: true, opacity: 0.8, depthWrite: false }));
    const fwd = V(Math.cos(c.root.rotation.y), 0, -Math.sin(c.root.rotation.y));
    sp.position.copy(c.root.position).addScaledVector(fwd, 1.4).add(V((Math.random() - 0.5) * 0.4, 1.0, (Math.random() - 0.5) * 0.4));
    sp.scale.setScalar(0.8); sp.userData.life = 0;
    this.group.add(sp); this.smoke.push(sp);
  }
  updateSmoke(dt) {
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const sp = this.smoke[i];
      sp.userData.life += dt;
      const t = sp.userData.life / 2.4;
      sp.position.y += dt * 1.6; sp.position.x += dt * 0.6;
      sp.scale.setScalar(0.8 + t * 3.5);
      sp.material.opacity = Math.max(0, 0.8 * (1 - t));
      if (t >= 1) { this.group.remove(sp); sp.material.dispose(); this.smoke.splice(i, 1); }
    }
  }

  // Cámara de persecución baja: se abre con la velocidad y tiembla a tope
  followCam(dt) {
    const cam = this.shop.camera, ctl = this.shop.controls, me = this.me;
    if (!me) return;
    const portrait = (cam.aspect || 1) < 1;
    const v = me.v || 0, nitro = me.flags & 1, finished = me.flags & 24;
    const baseFov = portrait ? 66 : 54;
    const fov = baseFov + Math.min(26, v * 0.32) + (nitro ? 7 : 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
    const o = V(TRACK_ORIGIN.x, 0, TRACK_ORIGIN.z);
    const { p, t } = at(me.s, me.lat);
    const wp = p.add(o);
    const k = 1 - Math.exp(-dt * (finished ? 1.5 : 7));
    let goal, look;
    if (finished && this.running) {
      // Ya en meta: cámara de televisión que lo ve pasar
      goal = wp.clone().add(V(t.z * 12, 5, -t.x * 12)).addScaledVector(t, 8);
      look = wp.clone().add(V(0, 1, 0));
    } else {
      const back = (portrait ? 8.5 : 7.2) + v * 0.035;
      goal = wp.clone().addScaledVector(t, -back).add(V(0, portrait ? 2.9 : 2.4, 0));
      look = wp.clone().addScaledVector(t, 12).add(V(0, 1.1, 0));
      const shake = Math.max(0, v - 30) * 0.0016 + (nitro ? 0.03 : 0);
      goal.add(V((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    }
    cam.position.lerp(goal, k);
    ctl.target.lerp(look, Math.min(1, k * 1.5));
  }

  // Minimapa: el trazado en 2D (normalizado 0..1) para dibujarlo en el HUD
  static outline() {
    const xs = TRACK.P.map((p) => p.x), zs = TRACK.P.map((p) => p.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), sc = Math.max(x1 - x0, z1 - z0);
    return { pts: TRACK.P.filter((_, i) => i % 4 === 0).map((p) => [(p.x - x0) / sc, (p.z - z0) / sc]), map: (s) => { const q = at(s).p; return [(q.x - x0) / sc, (q.z - z0) / sc]; }, w: (x1 - x0) / sc, h: (z1 - z0) / sc };
  }
}
