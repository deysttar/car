// Lógica del juego: generación de coches, estadísticas y simulación de mercado.
import {
  RARITY, ENGINES, INTAKES, TURBOS, TRACTIONS, AEROS, CAR_TYPES, PERF_MIN, PERF_MAX,
  BODY_COLORS, MODEL_NAMES, RIVALS,
} from './data.js';

// ---------- RNG ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = Math.random;
export const setRng = (f) => { rng = f; };
export const rand = () => rng();
export const randInt = (a, b) => Math.floor(rand() * (b - a + 1)) + a;
export const pick = (arr) => arr[Math.floor(rand() * arr.length)];
export function weightedPick(list) {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = rand() * total;
  for (const x of list) { r -= x.weight; if (r <= 0) return x; }
  return list[list.length - 1];
}

export const byId = {
  type: Object.fromEntries(CAR_TYPES.map((x) => [x.id, x])),
  engine: Object.fromEntries(ENGINES.map((x) => [x.id, x])),
  intake: Object.fromEntries(INTAKES.map((x) => [x.id, x])),
  turbo: Object.fromEntries(TURBOS.map((x) => [x.id, x])),
  traction: Object.fromEntries(TRACTIONS.map((x) => [x.id, x])),
  aero: Object.fromEntries(AEROS.map((x) => [x.id, x])),
};

// ---------- Ruleta ----------
// Cada pieza se tira por separado (chasis -> motor -> cilindrada -> turbo -> tracción -> aero -> rendimiento)
// y cada una respeta el espacio que le queda al chasis elegido.
export const STAGES = ['type', 'engine', 'intake', 'turbo', 'traction', 'aero', 'perf'];
export function rollStage(key, p = {}) {
  switch (key) {
    case 'type': return weightedPick(CAR_TYPES);
    case 'engine': {
      const minIntake = Math.min(...INTAKES.map((i) => i.space));
      return weightedPick(ENGINES.filter((e) => e.space + minIntake <= p.type.space));
    }
    case 'intake': return weightedPick(INTAKES.filter((i) => i.space <= p.type.space - p.engine.space));
    case 'turbo': return weightedPick(TURBOS.filter((t) => t.space <= p.type.space - p.engine.space - p.intake.space));
    case 'traction': return weightedPick(TRACTIONS);
    case 'aero': return weightedPick(AEROS);
    default: return Math.round(PERF_MIN + ((rand() + rand()) / 2) * (PERF_MAX - PERF_MIN));
  }
}
export function buildFromPicks(p) {
  return {
    typeId: p.type.id, engineId: p.engine.id, intakeId: p.intake.id, turboId: p.turbo.id,
    tractionId: p.traction.id, aeroId: p.aero.id, perf: p.perf,
    color: pick(BODY_COLORS), seed: Math.floor(rand() * 1e9),
  };
}
export function rollBuild() {
  const p = {};
  for (const k of STAGES) p[k] = rollStage(k, p);
  return buildFromPicks(p);
}
// Repetir una pieza: el coste se duplica con cada repetición de esa misma pieza.
export const REROLL_BASE = { type: 30000, engine: 30000, intake: 20000, turbo: 20000, traction: 10000, aero: 10000, perf: 25000 };
export const rerollCost = (key, n) => REROLL_BASE[key] * Math.pow(2, n);

export function modelName(brand) {
  return pick(MODEL_NAMES) + ' ' + pick(['', 'GT', 'S', 'R', 'RS', 'Sport', 'X', 'Turbo', 'Evo', 'Plus', '']).trim();
}

// ---------- Estadísticas ----------
export function parts(car) {
  return {
    type: byId.type[car.typeId], engine: byId.engine[car.engineId], intake: byId.intake[car.intakeId],
    turbo: byId.turbo[car.turboId], traction: byId.traction[car.tractionId], aero: byId.aero[car.aeroId],
  };
}

export function rawStats(car) {
  const p = parts(car);
  const mult = p.engine.power * p.intake.mult * p.turbo.mult;
  const hp = Math.round(mult * car.perf);
  const accelMult = p.traction.accel * p.turbo.accel * p.aero.accel;
  const accelIndex = (accelMult * hp) / 100; // fórmula del Excel: (Aceleración × HP) / 100
  const grip = p.traction.grip * p.aero.grip * p.type.gripMult;
  const ratio = p.type.weightKg / (hp * accelMult);
  const t0100 = Math.min(25, Math.max(4 * Math.pow(ratio, 0.6), 1.6 + 3 / grip));
  const vmax = Math.min(520, (60 + 9.5 * Math.sqrt(hp)) * p.type.vmaxMult * (1.12 - p.aero.level * 0.25));
  const space = p.engine.space + p.intake.space + p.turbo.space;
  const unitCost = p.type.baseCost * p.engine.price * p.intake.price * p.turbo.price * (0.9 + (car.perf - 60) / 350);
  const tierScore = p.engine.tier + p.intake.tier + p.turbo.tier + p.traction.tier + p.aero.tier;
  const composite = 0.55 * Math.log(hp) + 0.25 * Math.log(accelIndex) + 0.2 * Math.log(grip);
  return { p, mult, hp, accelMult, accelIndex, grip, t0100, vmax, space, unitCost, tierScore, composite };
}

// Distribución de referencia por tipo (Monte Carlo) para puntuar 0-100 dentro de su segmento.
const REF = {};
(function buildRef() {
  const saved = rng;
  setRng(mulberry32(12345));
  const buckets = Object.fromEntries(CAR_TYPES.map((t) => [t.id, []]));
  for (let i = 0; i < 30000; i++) {
    const b = rollBuild();
    buckets[b.typeId].push(rawStats(b).composite);
  }
  for (const k in buckets) REF[k] = buckets[k].sort((a, b) => a - b);
  setRng(saved);
})();
function percentile(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo / arr.length;
}

const statCache = new Map();
export function stats(car) {
  const key = [car.typeId, car.engineId, car.intakeId, car.turboId, car.tractionId, car.aeroId, car.perf].join('|');
  if (statCache.has(key)) return statCache.get(key);
  const s = rawStats(car);
  s.rating = Math.max(1, Math.min(100, Math.round(percentile(REF[car.typeId], s.composite) * 100)));
  s.value = s.unitCost * (1.08 + 0.62 * Math.pow(s.rating / 100, 1.4)) * (1 + Math.max(0, s.tierScore - 6) * 0.02);
  s.collector = s.unitCost * (0.25 + 0.035 * s.tierScore) * (car.perf / 100) * (0.6 + s.rating / 100);
  s.launchCost = Math.round(s.unitCost * s.p.type.launchFactor / 1000) * 1000;
  s.overallTier = s.rating >= 95 ? 4 : s.rating >= 80 ? 3 : s.rating >= 50 ? 2 : 1;
  statCache.set(key, s);
  return s;
}

export function ratingLabel(r) {
  if (r >= 97) return 'Leyenda';
  if (r >= 85) return 'Excelente';
  if (r >= 65) return 'Notable';
  if (r >= 40) return 'Correcto';
  if (r >= 20) return 'Flojo';
  return 'Chatarra';
}
export const rarityOf = (tier) => RARITY[tier];

// ---------- Mercado ----------
export function attractiveness(model, prestige) {
  const age = model.age || 0;
  const novelty = Math.max(0.2, Math.pow(0.965, age));
  const priceRatio = model.price / model.value;
  const priceF = Math.min(2.6, Math.exp(-2.6 * (priceRatio - 1)));
  const q = Math.pow((model.rating + 10) / 60, 2);
  return q * priceF * novelty * (1 + prestige / 100);
}

// Estimación de ventas diarias para un precio dado (para el panel de lanzamiento).
export function estimateDaily(state, car, price) {
  const s = stats(car);
  const type = byId.type[car.typeId];
  const me = { rating: s.rating, value: s.value, price, age: 0 };
  const a = attractiveness(me, state.prestige);
  let sum = a;
  for (const m of allActive(state)) if (m.typeId === car.typeId) sum += attractiveness(m, m.owner === 'player' ? state.prestige : state.rivals[m.owner].prestige);
  const total = type.demand * (sum / (sum + 1.5));
  const units = total * (a / sum);
  return { units, profit: units * (price - s.unitCost) };
}

export function allActive(state) {
  const out = [];
  for (const c of state.garage) if (c.status === 'mercado') {
    const s = stats(c);
    out.push({ owner: 'player', ref: c, typeId: c.typeId, rating: s.rating, value: s.value, price: c.price, age: state.day - c.launchedDay, unitCost: s.unitCost, name: c.name });
  }
  for (const rid in state.rivals) for (const m of state.rivals[rid].models) {
    const s = stats(m);
    out.push({ owner: rid, ref: m, typeId: m.typeId, rating: s.rating, value: s.value, price: m.price, age: state.day - m.launchedDay, unitCost: s.unitCost, name: m.name });
  }
  return out;
}

export const FIXED_DAILY = 4000;
export const PER_MODEL_DAILY = 1500;

export function makeRivalCar(state, rid) {
  const b = rollBuild();
  const s = stats(b);
  return { ...b, id: 'rv' + Math.floor(rand() * 1e9), name: modelName(), price: Math.round(s.value * (0.92 + rand() * 0.2)), launchedDay: state.day, unitsSold: 0 };
}

// Simula un día de ventas. Devuelve un informe.
export function simulateDay(state) {
  const report = { day: state.day, lines: [], revenue: 0, cost: 0, profit: 0, units: 0, news: [], fixed: 0 };
  const models = allActive(state);
  for (const type of CAR_TYPES) {
    const seg = models.filter((m) => m.typeId === type.id);
    if (!seg.length) continue;
    const attr = seg.map((m) => attractiveness(m, m.owner === 'player' ? state.prestige : state.rivals[m.owner].prestige));
    const sum = attr.reduce((a, b) => a + b, 0);
    const total = type.demand * (sum / (sum + 1.5)) * (0.85 + rand() * 0.3);
    seg.forEach((m, i) => {
      const exp = total * (attr[i] / sum);
      const units = Math.floor(exp) + (rand() < exp - Math.floor(exp) ? 1 : 0);
      const revenue = units * m.price;
      const cost = units * m.unitCost;
      m.ref.unitsSold = (m.ref.unitsSold || 0) + units;
      m.ref.lastUnits = units;
      if (m.owner === 'player') {
        m.ref.revenue = (m.ref.revenue || 0) + revenue;
        m.ref.profit = (m.ref.profit || 0) + revenue - cost;
        report.lines.push({ name: m.name, typeId: m.typeId, units, revenue, profit: revenue - cost });
        report.revenue += revenue; report.cost += cost; report.units += units;
      } else {
        const r = state.rivals[m.owner];
        r.revenue += revenue; r.cash += revenue - cost;
      }
    });
  }
  const active = state.garage.filter((c) => c.status === 'mercado').length;
  report.fixed = FIXED_DAILY + PER_MODEL_DAILY * active;
  report.profit = report.revenue - report.cost - report.fixed;
  state.cash += report.profit;
  state.totalRevenue += report.revenue;
  state.prestige = Math.max(0, state.prestige * 0.995 + Math.min(1.5, report.units * 0.03));

  // Rivales: retiran modelos viejos y lanzan nuevos
  for (const rid in state.rivals) {
    const r = state.rivals[rid];
    r.models = r.models.filter((m) => state.day - m.launchedDay < 45);
    if (rand() < 0.2 || r.models.length === 0) {
      const car = makeRivalCar(state, rid);
      r.models.push(car);
      r.prestige = Math.max(5, r.prestige + (stats(car).rating - 50) / 10);
      const s = stats(car);
      report.news.push({ rival: r.name, color: r.color, car: car.name, typeId: car.typeId, hp: s.hp, rating: s.rating });
    }
    r.prestige = r.prestige * 0.995 + 0.08;
  }
  state.history.push({ day: state.day, cash: state.cash, profit: report.profit });
  state.day += 1;
  state.spinsToday = 0;
  return report;
}

export function newState(company) {
  const st = {
    version: 1, company: company || 'Ameztoy Motors', day: 1, cash: 400000, prestige: 10,
    totalRevenue: 0, garage: [], spinsToday: 0, history: [], rivals: {}, nextCarNo: 1,
  };
  for (const r of RIVALS) {
    st.rivals[r.id] = { id: r.id, name: r.name, color: r.color, prestige: 10 + rand() * 8, revenue: 0, cash: 400000, models: [] };
    for (let i = 0; i < 2; i++) {
      const c = makeRivalCar(st, r.id);
      c.launchedDay = -randInt(0, 12);
      st.rivals[r.id].models.push(c);
    }
  }
  return st;
}

export const spinCost = (state) => (state.spinsToday === 0 ? 0 : Math.min(2560000, 40000 * Math.pow(2, state.spinsToday - 1)));
