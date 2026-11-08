// Tiradas de la construcción del motor (modo multijugador).
// Todo sale de una semilla: la misma semilla da siempre el mismo motor. En partida online el
// servidor generará la semilla (o el resultado) y cada cliente solo reproduce la animación.
import { RARITY, ENGINES, INTAKES, TURBOS, CAR_TYPES, BODY_COLORS, TRACTIONS, AEROS, MODEL_NAMES } from '../data.js';
import { pickUniform, pickTurboV2, triangular100 } from './rules.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Familias de motor: lo que se revela en el plano antes de saber cuántos pistones caen.
export const FAMILIES = {
  inline: { name: 'En línea', title: 'Motor en línea', stamp: 'EN LÍNEA', code: 'I', piece: 'pistón', desc: 'Una sola fila de cilindros, sencillo y fiable.' },
  v: { name: 'En V', title: 'Motor en V', stamp: 'EN V', code: 'V', piece: 'pistón', desc: 'Dos bancadas en ángulo sobre un mismo cigüeñal.' },
  vr: { name: 'VR', title: 'Motor VR', stamp: 'VR', code: 'VR', piece: 'pistón', desc: 'Una V muy cerrada: dos filas escalonadas bajo una sola culata.' },
  w: { name: 'En W', title: 'Motor en W', stamp: 'EN W', code: 'W', piece: 'pistón', desc: 'Cuatro bancadas en abanico. Enorme y brutal.' },
  flat: { name: 'Bóxer', title: 'Motor bóxer', stamp: 'BÓXER', code: 'F', piece: 'pistón', desc: 'Cilindros tumbados y opuestos. Centro de gravedad bajo.' },
  h: { name: 'En H', title: 'Motor en H', stamp: 'EN H', code: 'H', piece: 'pistón', desc: 'Dos bóxer apilados con dos cigüeñales.' },
  inv: { name: 'V invertido', title: 'Motor en V invertido', stamp: 'V INVERTIDO', code: 'V', piece: 'pistón', desc: 'Una V que trabaja boca abajo, como en los motores de avión.' },
  rotary: { name: 'Rotativo', title: 'Motor rotativo', stamp: 'ROTATIVO', code: 'R', piece: 'rotor', desc: 'Sin pistones: rotores triangulares girando en carcasas Wankel.' },
  turbine: { name: 'Turbina', title: 'Turbina de gas', stamp: 'TURBINA', code: 'T', piece: 'etapa', desc: 'Una turbina de gas: etapas de álabes en lugar de cilindros.' },
};

export function familyOf(engine) {
  const n = engine.name;
  if (n.startsWith('In-Line')) return 'inline';
  if (n.startsWith('VR')) return 'vr';
  if (n.includes('Invertido')) return 'inv';
  if (n.startsWith('V')) return 'v';
  if (n.startsWith('W')) return 'w';
  if (n.startsWith('H')) return 'h';
  if (n.startsWith('F')) return 'flat';
  if (n.startsWith('Rotativo')) return 'rotary';
  return 'turbine';
}

// Piezas que caen: pistones (= cilindros), rotores, o 4 etapas en la turbina.
export const pieceCount = (engine, family) => (family === 'turbine' ? 4 : engine.cyl);

export function engineCode(family, n) {
  if (family === 'rotary') return n === 1 ? '1 rotor' : `${n} rotores`;
  if (family === 'turbine') return 'Turbina';
  if (family === 'inv') return `V${n} inv.`;
  return FAMILIES[family].code + n;
}
// Lo que se ve mientras caen las piezas (antes de dar la vuelta al V invertido).
export function countingCode(family, n) {
  if (family === 'turbine') return `Etapa ${n}`;
  if (family === 'inv') return `V${n}`;
  return engineCode(family, n);
}

// Primero se sortea la rareza (mismas probabilidades base que el juego original)
// y luego una pieza al azar de esa rareza.
function pickByTier(list, rng) {
  const tiers = [...new Set(list.map((x) => x.tier))];
  const total = tiers.reduce((a, t) => a + RARITY[t].odds, 0);
  let r = rng() * total, tier = tiers[tiers.length - 1];
  for (const t of tiers) { r -= RARITY[t].odds; if (r <= 0) { tier = t; break; } }
  const pool = list.filter((x) => x.tier === tier);
  return pool[Math.floor(rng() * pool.length)];
}

// Rendimiento 0-100 (100 = mejor). Distribución triangular centrada en 50, como el original.
export function perfTier(p) {
  return p >= 97 ? 6 : p >= 90 ? 5 : p >= 80 ? 4 : p >= 65 ? 3 : p >= 45 ? 2 : 1;
}
export function perfLabel(p) {
  return p >= 97 ? 'Perfecto' : p >= 90 ? 'Obra maestra' : p >= 80 ? 'Muy fino' : p >= 65 ? 'Bueno' : p >= 45 ? 'Normal' : p >= 25 ? 'Flojo' : 'Desastre';
}

// mode 'v2': motor y cilindrada con la misma probabilidad, admisión por familia y fiabilidad propia
export function rollEngineBuild(seed, mode = 'classic') {
  const rng = mulberry32(seed);
  const v2 = mode === 'v2';
  const engine = v2 ? pickUniform(ENGINES, rng) : pickByTier(ENGINES, rng);
  const family = familyOf(engine);
  const intake = v2 ? pickUniform(INTAKES, rng) : pickByTier(INTAKES, rng);
  const turbo = v2 ? pickTurboV2(rng) : pickByTier(TURBOS, rng);
  const perf = Math.round(((rng() + rng()) / 2) * 100);
  // Fiabilidad V2: tirada aparte (otra semilla derivada), con la misma forma que el rendimiento
  const reliability = v2 ? triangular100(mulberry32((seed ^ 0x4b1d) >>> 0)) : null;
  // CV orientativos con la fórmula del juego (rendimiento 0-100 -> 60-130 del original).
  const hp = Math.round(engine.power * intake.mult * turbo.mult * (60 + perf * 0.7));
  return { seed, mode, engine, family, count: pieceCount(engine, family), intake, turbo, perf, hp, reliability };
}

// Chasis: solo entran los que tienen hueco para motor + cilindrada + admisión (el bólido, 10, siempre cabe).
// Se sortea con el peso del juego original y una semilla derivada, así sigue siendo reproducible.
export function rollChassis(b) {
  const rng = mulberry32((b.seed ^ 0x9e3779b9) >>> 0);
  const need = b.engine.space + b.intake.space + b.turbo.space;
  const fits = CAR_TYPES.filter((t) => t.space >= need);
  const total = fits.reduce((a, t) => a + t.weight, 0);
  let r = rng() * total, type = fits[fits.length - 1];
  for (const t of fits) { r -= t.weight; if (r <= 0) { type = t; break; } }
  const color = BODY_COLORS[Math.floor(rng() * BODY_COLORS.length)];
  // Tracción y aerodinámica todavía no se sortean: valores neutros hasta su fase.
  const car = {
    typeId: type.id, engineId: b.engine.id, intakeId: b.intake.id, turboId: b.turbo.id,
    tractionId: 'TT', aeroId: 'a25', perf: Math.round(60 + b.perf * 0.7), color, seed: Math.floor(rng() * 1e9),
    mode: b.mode || 'classic',
  };
  if (b.reliability != null) car.reliability = b.reliability;
  return { type, fits, need, car };
}

// Tracción: con el peso del juego original (trasera y delantera comunes, integral poco común).
export function rollTraction(b) {
  const rng = mulberry32((b.seed ^ 0x51ed27) >>> 0);
  const total = TRACTIONS.reduce((a, t) => a + t.weight, 0);
  let r = rng() * total;
  for (const t of TRACTIONS) { r -= t.weight; if (r <= 0) return t; }
  return TRACTIONS[TRACTIONS.length - 1];
}

// Aerodinámica: carga baja, media o alta, con los pesos del juego original.
export function rollAero(b) {
  const rng = mulberry32((b.seed ^ 0x2c1b3c6d) >>> 0);
  const total = AEROS.reduce((a, t) => a + t.weight, 0);
  let r = rng() * total;
  for (const t of AEROS) { r -= t.weight; if (r <= 0) return t; }
  return AEROS[AEROS.length - 1];
}

// ---------- Pasos finales ----------
const pickWeighted = (list, rng) => {
  const total = list.reduce((a, t) => a + t.weight, 0);
  let r = rng() * total;
  for (const t of list) { r -= t.weight; if (r <= 0) return t; }
  return list[list.length - 1];
};
// Nombres de los colores de carrocería (mismo orden que BODY_COLORS)
const COLOR_NAMES = ['Rojo', 'Naranja', 'Amarillo', 'Verde', 'Azul petróleo', 'Azul', 'Blanco', 'Grafito', 'Violeta', 'Frambuesa', 'Oliva', 'Plata', 'Turquesa', 'Cobre'];
export const colorName = (hex) => COLOR_NAMES[BODY_COLORS.indexOf(hex)] || 'Personalizado';
// Acabados de pintura: rugosidad y metalizado del barniz
export const FINISHES = [
  { id: 'solid', code: 0, name: 'Sólido', tier: 1, weight: 0.45, rough: 0.45, metal: 0.15, desc: 'Pintura de toda la vida: limpia y resistente.' },
  { id: 'metal', code: 1, name: 'Metalizado', tier: 2, weight: 0.3, rough: 0.26, metal: 0.72, desc: 'Escamas metálicas que brillan al sol.' },
  { id: 'matte', code: 2, name: 'Mate', tier: 3, weight: 0.1, rough: 0.92, metal: 0.05, desc: 'Sin brillo: aspecto de coche de exposición.' },
  { id: 'pearl', code: 3, name: 'Perlado', tier: 4, weight: 0.1, rough: 0.3, metal: 0.4, desc: 'Cambia de tono según desde dónde lo mires.' },
  { id: 'duo', code: 4, name: 'Bicolor', tier: 3, weight: 0.05, rough: 0.4, metal: 0.2, desc: 'Techo y pilares en un color distinto.' },
];
export function rollPaint(b) { return pickWeighted(FINISHES, mulberry32((b.seed ^ 0x7f4a7c15) >>> 0)); }
// Neumáticos y frenos: dan un poco de agarre extra (puntos de puntuación)
export const TIRES = [
  { id: 'street', name: 'De calle', tier: 1, weight: 0.5, bonus: 0, brakes: 'Discos ventilados', caliper: '#8a9097', rim: '#aab2ba', spokes: 5, desc: 'Cómodos y duraderos.' },
  { id: 'sport', name: 'Deportivos', tier: 2, weight: 0.35, bonus: 3, brakes: 'Pinzas de 4 pistones', caliper: '#d6402b', rim: '#3a3e44', spokes: 10, desc: 'Más agarre en curva y frenada.' },
  { id: 'semi', name: 'Semislick', tier: 3, weight: 0.15, bonus: 6, brakes: 'Carbono-cerámicos', caliper: '#ffb627', rim: '#1d1f23', spokes: 6, desc: 'Casi de competición: se pegan al asfalto.' },
];
export function rollTires(b) { return pickWeighted(TIRES, mulberry32((b.seed ^ 0x1b873593) >>> 0)); }
// Control de calidad: casi siempre perfecto; a veces un defecto leve que resta puntos
export const QC_ITEMS = ['Motor', 'Transmisión', 'Carrocería', 'Pintura', 'Electrónica'];
export function rollQC(b) {
  const rng = mulberry32((b.seed ^ 0x68e31da4) >>> 0);
  const defect = rng() < 0.12 ? Math.floor(rng() * QC_ITEMS.length) : -1;
  return { defect, penalty: defect >= 0 ? 3 : 0 };
}
export const modelNameOf = (b) => MODEL_NAMES[Math.floor(mulberry32((b.seed ^ 0x3c6ef372) >>> 0)() * MODEL_NAMES.length)];

export const serialOf = (seed) => 'RM-' + (seed >>> 0).toString(36).toUpperCase().padStart(6, '0');
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

// El coche completo que sale de una semilla, sin animación (bots y comprobaciones de la carrera).
export function carFromSeed(seed, mode = 'classic') {
  const b = rollEngineBuild(seed, mode);
  const ch = rollChassis(b);
  const spec = { ...ch.car, tractionId: rollTraction(b).id, aeroId: rollAero(b).id };
  return { spec, model: modelNameOf(b), tires: rollTires(b), qc: mode === 'v2' ? { defect: -1, penalty: 0 } : rollQC(b), finish: rollPaint(b) };
}
