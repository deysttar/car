// Modos de juego. «Original» usa las cuentas de siempre (sim.js). «V2» cambia las reglas:
//  - todos los motores y cilindradas salen con la misma probabilidad (la rareza solo es una etiqueta);
//  - la admisión se sortea primero por familia (atmosférico, turbo o compresor) y luego dentro de ella;
//  - no hay tope de potencia por chasis ni de velocidad punta: manda el PESO del coche;
//  - la fiabilidad es una tirada propia (como el rendimiento) y en carrera puede romper el motor.
import { ENGINES, INTAKES, TURBOS, TRACTIONS, AEROS, CAR_TYPES, BODY_COLORS } from '../data.js';
import { stats as classicStats, mulberry32 } from '../sim.js';

export const MODES = {
  classic: { id: 'classic', name: 'Original', desc: 'Las reglas de siempre: rarezas, tope de potencia por chasis y fiabilidad según las piezas.' },
  v2: { id: 'v2', name: 'V2', desc: 'Piezas al azar sin rarezas, sin topes, el peso cuenta y la fiabilidad es una tirada: el motor puede reventar en carrera.' },
};
export const isV2 = (specOrMode) => (typeof specOrMode === 'string' ? specOrMode : specOrMode && specOrMode.mode) === 'v2';

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
const E = byId(ENGINES), I = byId(INTAKES), T = byId(TURBOS), TR = byId(TRACTIONS), A = byId(AEROS), C = byId(CAR_TYPES);

// ---------- Sorteos V2 ----------
export const pickUniform = (list, rng) => list[Math.floor(rng() * list.length)];
export const TURBO_FAMILIES = [
  { id: 'na', name: 'Atmosférico', list: TURBOS.filter((t) => t.count === 0) },
  { id: 'turbo', name: 'Turbo', list: TURBOS.filter((t) => t.count > 0 && !t.supercharger) },
  { id: 'sc', name: 'Compresor', list: TURBOS.filter((t) => t.supercharger) },
];
// Admisión: 1/3 cada familia y, dentro de la familia, todas igual de probables
export function pickTurboV2(rng) {
  const fam = TURBO_FAMILIES[Math.floor(rng() * TURBO_FAMILIES.length)];
  return pickUniform(fam.list, rng);
}
// Tirada de 0 a 100 con forma de triángulo (lo más probable es 50), como el rendimiento
export const triangular100 = (rng) => Math.round(((rng() + rng()) / 2) * 100);

// ---------- Peso ----------
// Peso del chasis + motor (más cilindros, más kilos) + bloque según la cilindrada + turbos/compresores
export function weightParts(spec) {
  const type = C[spec.typeId], eng = E[spec.engineId], intake = I[spec.intakeId], turbo = T[spec.turboId];
  const n = eng.name;
  const engineKg = n === 'Turbina' ? 140 : n.startsWith('Rotativo') ? 40 + 45 * eng.cyl : 60 + 14 * eng.cyl;
  const blockKg = Math.round(parseFloat(intake.name) * 8);
  const turboKg = turbo.count * (turbo.supercharger ? 28 : 18);
  return { chassis: type.weightKg, engine: engineKg, block: blockKg, turbo: turboKg, total: type.weightKg + engineKg + blockKg + turboKg };
}

// ---------- Estadísticas V2 ----------
function rawV2(spec) {
  const type = C[spec.typeId], eng = E[spec.engineId], intake = I[spec.intakeId], turbo = T[spec.turboId];
  const traction = TR[spec.tractionId], aero = A[spec.aeroId];
  const mult = eng.power * intake.mult * turbo.mult;
  const hp = Math.round(mult * spec.perf);              // sin tope de chasis
  const weightKg = weightParts(spec).total;
  const accelMult = traction.accel * turbo.accel * aero.accel;
  const grip = traction.grip * aero.grip * type.gripMult;
  const ratio = weightKg / (hp * accelMult);
  const t0100 = Math.min(60, Math.max(4 * Math.pow(ratio, 0.6), 1.6 + 3 / grip));
  // Punta: potencia contra aire; el peso resta un poco (sin tope)
  const vmax = (60 + 9.5 * Math.sqrt(hp)) * type.vmaxMult * (1.12 - aero.level * 0.25) * Math.pow(1500 / weightKg, 0.1);
  const pw = (hp / weightKg) * 1000;                     // CV por tonelada
  const consumption = Math.round(3 + mult * 1.35 + (weightKg - 1300) / 400);
  const reliability = spec.reliability ?? 50;
  // Índice de carrera: punta, potencia por kilo y agarre
  const index = 0.45 * Math.log(vmax) + 0.35 * Math.log(Math.max(1, pw)) + 0.2 * Math.log(grip);
  return { hp, weightKg, accelMult, grip, t0100, vmax, pw, consumption, reliability, index, mult };
}

// Referencia: 20.000 coches V2 al azar (siempre los mismos) para puntuar de 0 a 100 contra todos
let REF = null;
function reference() {
  if (REF) return REF;
  const rng = mulberry32(24680);
  const out = [];
  for (let i = 0; i < 20000; i++) {
    const engine = pickUniform(ENGINES, rng), intake = pickUniform(INTAKES, rng), turbo = pickTurboV2(rng);
    const need = engine.space + intake.space + turbo.space;
    const fits = CAR_TYPES.filter((t) => t.space >= need);
    const total = fits.reduce((a, t) => a + t.weight, 0);
    let r = rng() * total, type = fits[fits.length - 1];
    for (const t of fits) { r -= t.weight; if (r <= 0) { type = t; break; } }
    const w = (list) => { const tt = list.reduce((a, x) => a + x.weight, 0); let q = rng() * tt; for (const x of list) { q -= x.weight; if (q <= 0) return x; } return list[list.length - 1]; };
    const spec = { mode: 'v2', typeId: type.id, engineId: engine.id, intakeId: intake.id, turboId: turbo.id, tractionId: w(TRACTIONS).id, aeroId: w(AEROS).id, perf: Math.round(60 + triangular100(rng) * 0.7), reliability: 50, color: BODY_COLORS[0] };
    out.push(rawV2(spec).index);
  }
  REF = out.sort((a, b) => a - b);
  return REF;
}

const cache = new Map();
export function statsV2(spec) {
  const key = [spec.typeId, spec.engineId, spec.intakeId, spec.turboId, spec.tractionId, spec.aeroId, spec.perf, spec.reliability].join('|');
  if (cache.has(key)) return cache.get(key);
  const s = rawV2(spec);
  const ref = reference();
  let lo = 0, hi = ref.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ref[m] < s.index) lo = m + 1; else hi = m; }
  s.rating = Math.max(1, Math.min(100, Math.round((lo / ref.length) * 100)));
  s.overallTier = s.rating >= 95 ? 4 : s.rating >= 80 ? 3 : s.rating >= 50 ? 2 : 1;
  cache.set(key, s);
  return s;
}

// Las cuentas del coche según su modo
export const carStats = (spec) => (isV2(spec) ? statsV2(spec) : classicStats(spec));
