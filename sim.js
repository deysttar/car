// Lógica del juego: generación de coches, estadísticas y simulación de mercado.
import {
  RARITY, ENGINES, INTAKES, TURBOS, TRACTIONS, AEROS, CAR_TYPES, PERF_MIN, PERF_MAX,
  BODY_COLORS, MODEL_NAMES, RIVALS,
} from './data.js';
import { tickRequests, tickContracts, fulfillCheck } from './progress.js';

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

// ---------- Probabilidades por rareza ----------
// Sistema nuevo: primero se sortea la RAREZA (según RARITY[t].odds, mejorables con I+D)
// y luego una pieza al azar de esa rareza entre las que caben. Sistema clásico: peso
// fijo por pieza (como en la versión original del juego).
export const ODDS_TIERS = [2, 3, 4, 5, 6]; // rarezas con investigación propia (la común se ajusta sola)
export const ODDS_LEVELS = 10;
export function tierOdds(state, withResearch = true) {
  const out = {};
  let rest = 100;
  for (const t of ODDS_TIERS) {
    const lv = withResearch && state && state.factory && state.factory.upgrades ? (state.factory.upgrades['u_odds_' + t] || 0) : 0;
    const r = RARITY[t];
    out[t] = r.odds + (r.max - r.odds) * Math.min(ODDS_LEVELS, lv) / ODDS_LEVELS;
    rest -= out[t];
  }
  out[1] = Math.max(0, rest);
  return out;
}
// Configuración de tirada del jugador / de los rivales.
export function playerOdds(state) { return state && state.settings && state.settings.classicOdds ? 'classic' : tierOdds(state, true); }
export function rivalOdds(state) { return state && state.settings && state.settings.classicOdds ? 'classic' : tierOdds(state, false); }
export function pickPart(list, odds) {
  if (!odds || odds === 'classic') return weightedPick(list);
  const tiers = [...new Set(list.map((x) => x.tier))];
  const total = tiers.reduce((a, t) => a + (odds[t] || 0), 0);
  let r = rand() * total, tier = tiers[tiers.length - 1];
  for (const t of tiers) { r -= odds[t] || 0; if (r <= 0) { tier = t; break; } }
  const pool = list.filter((x) => x.tier === tier);
  return pool[Math.floor(rand() * pool.length)];
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
export function rollStage(key, p = {}, odds = null) {
  switch (key) {
    case 'type': return weightedPick(CAR_TYPES);
    case 'engine': {
      const minIntake = Math.min(...INTAKES.map((i) => i.space));
      return pickPart(ENGINES.filter((e) => e.space + minIntake <= p.type.space), odds);
    }
    case 'intake': return pickPart(INTAKES.filter((i) => i.space <= p.type.space - p.engine.space), odds);
    case 'turbo': return pickPart(TURBOS.filter((t) => t.space <= p.type.space - p.engine.space - p.intake.space), odds);
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
export function rollBuild(odds = null) {
  const p = {};
  for (const k of STAGES) p[k] = rollStage(k, p, odds);
  return buildFromPicks(p);
}
// Repetir una pieza: el coste se duplica con cada repetición de esa misma pieza.
export const REROLL_BASE = { type: 30000, engine: 30000, intake: 20000, turbo: 20000, traction: 10000, aero: 10000, perf: 25000 };
export const rerollCost = (key, n) => REROLL_BASE[key] * Math.pow(2, n);

export function modelName() {
  return pick(MODEL_NAMES) + ' ' + pick(['', 'GT', 'S', 'R', 'RS', 'Sport', 'X', 'Turbo', 'Evo', 'Plus', '']).trim();
}

// ---------- Estadísticas ----------
export function parts(car) {
  return {
    type: byId.type[car.typeId], engine: byId.engine[car.engineId], intake: byId.intake[car.intakeId],
    turbo: byId.turbo[car.turboId], traction: byId.traction[car.tractionId], aero: byId.aero[car.aeroId],
  };
}

// Fiabilidad: las piezas comunes y simples son más fiables (rareza != calidad).
function reliabilityOf(p) {
  let r = 100;
  r -= 9 * (p.turbo.count || 0);                       // cada turbo/compresor añade complejidad
  r -= Math.max(0, (p.engine.cyl || 4) - 8) * 1.5;    // motores con muchísimos cilindros
  r -= Math.max(0, p.intake.mult - 1.35) * 14;         // cilindradas enormes
  if (p.engine.tier === 1) r += 5;                     // motor común, sobrio y fiable
  return Math.max(40, Math.min(100, Math.round(r)));
}

export function rawStats(car) {
  const p = parts(car);
  const mult = p.engine.power * p.intake.mult * p.turbo.mult;
  // Tope de potencia por chasis: la potencia que excede el tope solo cuenta al 35%.
  const cap = p.type.hpCap;
  const rawHp = mult * car.perf;
  const hp = Math.round(rawHp > cap ? cap + (rawHp - cap) * 0.35 : rawHp);
  const accelMult = p.traction.accel * p.turbo.accel * p.aero.accel;
  const accelIndex = (accelMult * hp) / 100; // (Aceleración × HP) / 100
  const grip = p.traction.grip * p.aero.grip * p.type.gripMult;
  const ratio = p.type.weightKg / (hp * accelMult);
  const t0100 = Math.min(25, Math.max(4 * Math.pow(ratio, 0.6), 1.6 + 3 / grip));
  const vmax = Math.min(520, (60 + 9.5 * Math.sqrt(hp)) * p.type.vmaxMult * (1.12 - p.aero.level * 0.25));
  const space = p.engine.space + p.intake.space + p.turbo.space;
  const unitCost = p.type.baseCost * p.engine.price * p.intake.price * p.turbo.price * (0.9 + (car.perf - 60) / 350);
  const reliability = reliabilityOf(p);
  const tierScore = p.engine.tier + p.intake.tier + p.turbo.tier + p.traction.tier + p.aero.tier;
  const consumption = Math.round(3 + mult * 1.35); // L/100km aproximados
  // Valoración por segmento: prestaciones (potencia/aceleración/agarre) contra economía
  // (fiabilidad, consumo, coste). El peso lo marca cada chasis: un utilitario se valora
  // sobre todo por ser barato y fiable; un bólido, por sus prestaciones.
  const perfScore = 0.5 * Math.log(hp) + 0.22 * Math.log(Math.max(1, accelIndex)) + 0.18 * Math.log(Math.max(1, grip));
  const econScore = 0.5 * Math.log(reliability) - 0.3 * Math.log(consumption) - 0.2 * Math.log(unitCost);
  const composite = p.type.perfW * perfScore + (1 - p.type.perfW) * econScore;
  return { p, mult, rawHp, cap, hp, accelMult, accelIndex, grip, t0100, vmax, space, unitCost, reliability, consumption, tierScore, composite };
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
  // El valor premia la puntuación dentro del segmento y la fiabilidad, no solo la rareza.
  s.value = s.unitCost * (1.08 + 0.62 * Math.pow(s.rating / 100, 1.4)) * (1 + Math.max(0, s.tierScore - 6) * 0.02) * (0.92 + 0.16 * (s.reliability / 100));
  s.collector = s.unitCost * (0.25 + 0.035 * s.tierScore) * (car.perf / 100) * (0.6 + s.rating / 100);
  s.launchCost = Math.round(s.unitCost * s.p.type.launchFactor / 1000) * 1000;
  s.overallTier = s.rating >= 95 ? 4 : s.rating >= 80 ? 3 : s.rating >= 50 ? 2 : 1;
  statCache.set(key, s);
  return s;
}

// Puntuación "de mercado": las actualizaciones (restyling) suman hasta +6 puntos.
export function marketRating(car) {
  return Math.min(100, stats(car).rating + Math.min(3, car.updates || 0) * 2);
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

// ---------- Fábrica y capacidad ----------
export function factoryLevel(state, id) {
  return (state.factory && state.factory.upgrades && state.factory.upgrades[id]) || 0;
}
export function totalUpgrades(state) {
  return Object.values((state.factory && state.factory.upgrades) || {}).reduce((a, b) => a + b, 0);
}
// Huecos de producción: modelos en venta simultáneos. Base 2, +1 por ampliación de líneas.
// Capacidad de producción: 1 línea por cada tipo de chasis de serie; cada nivel de
// "Ampliación de líneas" añade +1 línea a TODOS los chasis.
// capacity(state, typeId) → huecos de ese chasis; capacity(state) → totales + desglose.
export function lineLevel(state, typeId) { return factoryLevel(state, 'u_lines_' + typeId); }
export function capacity(state, typeId) {
  const per = (id) => 1 + lineLevel(state, id);
  const onSale = state.garage.filter((c) => c.status === 'mercado');
  if (typeId) {
    const used = onSale.filter((c) => c.typeId === typeId).length;
    return { slots: per(typeId), used, free: per(typeId) - used, typeId };
  }
  const perType = CAR_TYPES.map((t) => {
    const used = onSale.filter((c) => c.typeId === t.id).length;
    const slots = per(t.id);
    return { typeId: t.id, name: t.name, slots, used, free: slots - used };
  });
  const slots = perType.reduce((a, t) => a + t.slots, 0), used = onSale.length;
  return { slots, used, free: slots - used, perType };
}
// Coste unitario efectivo con robots de montaje (−12% acumulativo por nivel).
export function prodCostFactor(state) {
  return Math.pow(0.88, factoryLevel(state, 'u_robots'));
}
// Prestigio efectivo del jugador: la comunidad de seguidores empuja la demanda.
export const fanBoost = (followers) => Math.min(25, 6 * Math.log10(1 + (followers || 0) / 100));
export function playerPrestige(state) {
  return state.prestige + fanBoost(state.followers);
}
export function rivalPrestige(r) { return r.prestige + fanBoost(r.followers); }
// Ingresos de los últimos 7 días (ranking de marcas).
export const rev7 = (hist) => (hist || []).reduce((a, b) => a + b, 0);

// ---------- Mercado ----------
export function attractiveness(model, prestige) {
  const age = model.age || 0;
  const type = byId.type[model.typeId];
  const novelty = Math.max(0.15, Math.pow(type.decay || 0.965, age));
  const priceRatio = model.price / model.value;
  const priceF = Math.min(2.6, Math.exp(-2.6 * (priceRatio - 1)));
  const q = Math.pow((model.rating + 10) / 60, 2);
  return q * priceF * novelty * (1 + prestige / 100);
}

// Estimación de ventas diarias para un precio dado (para el panel de lanzamiento).
export function estimateDaily(state, car, price) {
  const s = stats(car);
  const type = byId.type[car.typeId];
  const isActive = car.status === 'mercado';
  const me = { rating: marketRating(car), value: s.value, price, age: isActive && car.launchedDay != null ? Math.max(0, state.day - car.launchedDay) : 0, typeId: car.typeId };
  const a = attractiveness(me, playerPrestige(state));
  let sum = a;
  for (const m of allActive(state)) {
    if (m.ref === car || m.ref.id === car.id) continue; // no compites contigo mismo dos veces
    if (m.typeId === car.typeId) sum += attractiveness(m, m.owner === 'player' ? playerPrestige(state) : state.rivals[m.owner].prestige);
  }
  const total = type.demand * (sum / (sum + 1.5));
  const units = total * (a / sum);
  const cost = s.unitCost * prodCostFactor(state);
  return { units, profit: units * (price - cost) };
}

export function allActive(state) {
  const out = [];
  for (const c of state.garage) if (c.status === 'mercado') {
    const s = stats(c);
    out.push({ owner: 'player', ref: c, typeId: c.typeId, rating: marketRating(c), value: s.value, price: c.price, age: state.day - c.launchedDay, unitCost: s.unitCost, name: c.name });
  }
  for (const rid in state.rivals) for (const m of state.rivals[rid].models) {
    const s = stats(m);
    out.push({ owner: rid, ref: m, typeId: m.typeId, rating: s.rating, value: s.value, price: m.price, age: state.day - m.launchedDay, unitCost: s.unitCost, name: m.name });
  }
  return out;
}

export const FIXED_DAILY = 4000;
export const PER_MODEL_DAILY = 1500;
// Cada mejora de fábrica también sube el gasto fijo (mantenimiento de las nuevas instalaciones).
export function fixedDaily(state) {
  const ups = Object.entries((state.factory && state.factory.upgrades) || {});
  const maint = ups.reduce((a, [k, v]) => a + v * (k.startsWith('u_lines_') ? 350 : k.startsWith('u_odds_') ? 200 : 700), 0);
  return FIXED_DAILY + PER_MODEL_DAILY * state.garage.filter((c) => c.status === 'mercado').length + maint;
}

export function rollBuildType(typeId, odds = null) {
  const p = { type: byId.type[typeId] };
  for (const k of STAGES) if (k !== 'type') p[k] = rollStage(k, p, odds);
  return buildFromPicks(p);
}
// Las marcas grandes prueban varios diseños y lanzan el mejor (quality = nº de intentos).
export function makeRivalCar(state, rid, typeId) {
  const prof = RIVALS.find((x) => x.id === rid) || { quality: 1 };
  const odds = rivalOdds(state);
  const tId = typeId || pick(CAR_TYPES).id;
  let b = null;
  for (let i = 0; i < (prof.quality || 1); i++) {
    const c = rollBuildType(tId, odds);
    if (!b || stats(c).rating > stats(b).rating) b = c;
  }
  const s = stats(b);
  return { ...b, id: 'rv' + Math.floor(rand() * 1e9), name: modelName(), price: Math.round(s.value * (0.92 + rand() * 0.2)), launchedDay: state.day, unitsSold: 0 };
}

// Simula un día de ventas. Devuelve un informe.
export function simulateDay(state) {
  const report = { day: state.day, lines: [], revenue: 0, cost: 0, profit: 0, units: 0, news: [], fixed: 0, events: [] };
  const models = allActive(state);
  const costF = prodCostFactor(state);
  for (const type of CAR_TYPES) {
    const seg = models.filter((m) => m.typeId === type.id);
    if (!seg.length) continue;
    const attr = seg.map((m) => attractiveness(m, m.owner === 'player' ? playerPrestige(state) : rivalPrestige(state.rivals[m.owner])));
    const sum = attr.reduce((a, b) => a + b, 0);
    const total = type.demand * (sum / (sum + 1.5)) * (0.85 + rand() * 0.3);
    seg.forEach((m, i) => {
      const exp = total * (attr[i] / sum);
      const units = Math.floor(exp) + (rand() < exp - Math.floor(exp) ? 1 : 0);
      const revenue = units * m.price;
      const cost = units * m.unitCost * (m.owner === 'player' ? costF : 1);
      m.ref.unitsSold = (m.ref.unitsSold || 0) + units;
      m.ref.prevUnits = m.ref.lastUnits ?? null;
      m.ref.lastUnits = units;
      if (m.owner === 'player') {
        m.ref.revenue = (m.ref.revenue || 0) + revenue;
        m.ref.profit = (m.ref.profit || 0) + revenue - cost;
        report.lines.push({ name: m.name, typeId: m.typeId, units, revenue, profit: revenue - cost, carId: m.ref.id, rating: m.rating });
        report.revenue += revenue; report.cost += cost; report.units += units;
      } else {
        const r = state.rivals[m.owner];
        r.revenue += revenue; r.cash += revenue - cost;
        r._today = (r._today || 0) + revenue;
        // Su comunidad también crece con las ventas de buenos coches.
        const q = Math.max(0, m.rating - 35) / 20;
        r.followers = (r.followers || 0) + units * (0.5 + q * q * 2);
      }
    });
  }
  report.fixed = fixedDaily(state);
  report.profit = report.revenue - report.cost - report.fixed;
  state.cash += report.profit;
  state.totalRevenue += report.revenue;
  state.prestige = Math.max(0, state.prestige * 0.995 + Math.min(1.5, report.units * 0.03)
    + factoryLevel(state, 'u_rd') * 1.5 + factoryLevel(state, 'u_qc') * 0.5);
  // La comunidad crece con las ventas: un buen coche que vende mucho atrae muchos fans;
  // un coche mediocre apenas suma. Los superventas generan un aviso y un extra.
  let fans = 0;
  for (const l of report.lines) {
    const q = Math.max(0, l.rating - 35) / 20; // 0 con puntuación 35, 2,5 con 85
    fans += l.units * (0.8 + q * q * 3);
    const type = byId.type[l.typeId];
    const car = state.garage.find((c) => c.id === l.carId);
    const hitAt = Math.max(3, type.demand * 0.4);
    if (car && l.units >= hitAt && l.rating >= 55 && state.day - (car.lastHitDay ?? -99) >= 7) {
      const bonus = Math.round(40 + l.units * q * 12);
      fans += bonus; car.lastHitDay = state.day;
      report.events.push({ type: 'hit', text: `¡El ${l.name} es un éxito de ventas! La afición se dispara (+${bonus} seguidores extra).` });
    }
  }
  report.fans = Math.round(fans);
  state.followers = Math.max(0, Math.round((state.followers || 0) + fans));

  // Solicitudes de la comunidad y contratos: expiración, progreso y nuevas ofertas.
  tickRequests(state, report);
  tickContracts(state, report);

  // Rivales: retiran modelos viejos, cubren los segmentos con menos competencia,
  // atacan donde el jugador domina y sacan nuevas versiones de sus éxitos.
  const playerUnitsByType = {};
  for (const l of report.lines) playerUnitsByType[l.typeId] = (playerUnitsByType[l.typeId] || 0) + l.units;
  for (const rid in state.rivals) {
    const r = state.rivals[rid];
    r.models = r.models.filter((m) => state.day - m.launchedDay < 70);
    const prof = RIVALS.find((x) => x.id === rid) || {};
    const target = prof.models || 6;
    // Si la gama es demasiado grande, retiran el modelo que peor vende.
    while (r.models.length > target + 1) {
      const worst = r.models.slice().sort((a, b) => (a.lastUnits || 0) - (b.lastUnits || 0) || a.launchedDay - b.launchedDay)[0];
      r.models = r.models.filter((m) => m !== worst);
    }
    let launches = 0;
    const chance = r.models.length >= target ? 0.14 : 0.3 + 0.12 * (target - r.models.length);
    while (launches < 2 && (r.models.length === 0 || rand() < (launches ? chance * 0.35 : chance))) {
      launches++;
      // Nueva versión (Mk2, Mk3...) de un modelo propio que ya lleva tiempo y ha vendido.
      const veteran = r.models.filter((m) => state.day - m.launchedDay > 18 && (m.unitsSold || 0) > 20).sort((a, b) => b.unitsSold - a.unitsSold)[0];
      if (veteran && rand() < 0.3) {
        const gen = (veteran.gen || 1) + 1;
        const nv = { ...veteran, id: 'rv' + Math.floor(rand() * 1e9), perf: Math.min(PERF_MAX, veteran.perf + 4 + Math.floor(rand() * 12)), gen,
          name: (veteran.baseName || veteran.name) + ' Mk' + gen, baseName: veteran.baseName || veteran.name, launchedDay: state.day, unitsSold: 0, lastUnits: 0 };
        nv.price = Math.round(stats(nv).value * (0.95 + rand() * 0.15));
        r.models = r.models.filter((m) => m !== veteran);
        r.models.push(nv);
        const s2 = stats(nv);
        report.news.push({ rival: r.name, color: r.color, car: nv.name, typeId: nv.typeId, hp: s2.hp, rating: s2.rating, version: true });
        continue;
      }
      // Segmento objetivo: el menos cubierto por esta marca, con peso extra donde el jugador vende mucho.
      const scored = CAR_TYPES.map((t) => {
        const mine = r.models.filter((m) => m.typeId === t.id).length;
        const allRivals = Object.values(state.rivals).reduce((a, x) => a + x.models.filter((m) => m.typeId === t.id).length, 0);
        const focus = prof.focus && prof.focus.length ? (prof.focus.includes(t.id) ? 2.5 : -1.5) : 0;
        return { id: t.id, score: -mine * 2 - allRivals * 0.6 + (playerUnitsByType[t.id] || 0) * 0.25 + t.demand * 0.05 + focus + rand() * 1.5 };
      }).sort((a, b) => b.score - a.score);
      const car = makeRivalCar(state, rid, rand() < 0.75 ? scored[0].id : null);
      r.models.push(car);
      r.prestige = Math.max(5, Math.min(90, r.prestige + (stats(car).rating - 50) / 25));
      const s = stats(car);
      report.news.push({ rival: r.name, color: r.color, car: car.name, typeId: car.typeId, hp: s.hp, rating: s.rating });
    }
    // El prestigio tiende a su nivel de marca (las grandes no se hunden de un día para otro).
    r.prestige = r.prestige + ((prof.prestige || 20) - r.prestige) * 0.01;
  }
  // Historial de ingresos de 7 días para el ranking de marcas.
  state.revHist = [...(state.revHist || []), report.revenue].slice(-7);
  for (const rid in state.rivals) {
    const r = state.rivals[rid];
    r.revHist = [...(r.revHist || []), r._today || 0].slice(-7);
    r._today = 0;
    r.followers = Math.round((r.followers || 0) * 0.9995);
  }
  state.history.push({ day: state.day, cash: state.cash, profit: report.profit });
  state.day += 1;
  state.spinsToday = 0;
  return report;
}

// Comprueba si un lanzamiento cumple una solicitud de la comunidad abierta.
export function checkCommunityRequests(state, car) {
  return fulfillCheck(state, car);
}

export function newState(company) {
  const st = {
    version: 2, company: company || 'Ameztoy Motors', day: 1, cash: 400000, prestige: 10,
    totalRevenue: 0, garage: [], spinsToday: 0, history: [], rivals: {}, nextCarNo: 1,
    followers: 120, factory: { upgrades: {} }, requests: [], contractOffers: [], activeContract: null,
    settings: { classicOdds: false }, revHist: [],
  };
  seedRivals(st);
  return st;
}

// Reparte modelos iniciales para que todos los segmentos tengan competencia desde el día 1.
// También sirve para partidas antiguas: añade marcas rivales nuevas que no existían.
export function seedRivals(st) {
  for (const r of RIVALS) {
    if (!st.rivals[r.id]) {
      st.rivals[r.id] = { id: r.id, name: r.name, color: r.color, prestige: r.prestige, followers: r.followers, revenue: 0, cash: r.cash, models: [],
        revHist: Array.from({ length: 7 }, () => Math.round(r.revenue7 / 7 * (0.85 + rand() * 0.3))) };
    }
    const rv = st.rivals[r.id];
    if (typeof rv.followers !== 'number') rv.followers = r.followers; // partidas antiguas
    if (!Array.isArray(rv.revHist)) rv.revHist = [];
  }
  for (const r of RIVALS) {
    const rv = st.rivals[r.id];
    const pool = r.focus && r.focus.length ? r.focus : CAR_TYPES.map((t) => t.id);
    let k = Math.floor(rand() * pool.length);
    while (rv.models.length < Math.min(r.models, 4 + Math.floor(r.models / 2))) {
      const c = makeRivalCar(st, r.id, rand() < 0.7 ? pool[k++ % pool.length] : pick(CAR_TYPES).id);
      c.launchedDay = (st.day || 1) - randInt(0, 40);
      c.unitsSold = randInt(20, 400);
      rv.models.push(c);
    }
  }
}

export const spinCost = (state) => (state.spinsToday === 0 ? 0 : Math.min(2560000, 40000 * Math.pow(2, state.spinsToday - 1)));
