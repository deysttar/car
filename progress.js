// Progresión: mejoras de fábrica, solicitudes de la comunidad de marca y contratos.
import { CAR_TYPES, RARITY } from './data.js';
import { rand, pick, marketRating, factoryLevel, capacity, stats } from './sim.js';

// ---------- Mejoras de fábrica ----------
// Cada mejora es funcional (afecta a números del juego) y se refleja en la nave 3D.
export const FACTORY_UPGRADES = [
  { id: 'u_lines', name: 'Ampliación de líneas', desc: '+1 línea de producción para el chasis que elijas', cost: 160000, max: 7, perType: true },
  { id: 'u_robots', name: 'Robots de montaje', desc: '−12% de coste de producción por nivel', cost: 380000, max: 2 },
  { id: 'u_qc', name: 'Control de calidad', desc: '+0,5 prestigio diario', cost: 300000, max: 1 },
  { id: 'u_rd', name: 'Departamento de I+D', desc: '+1,5 prestigio diario y mejores contratos', cost: 500000, max: 1 },
  { id: 'u_test', name: 'Centro de pruebas', desc: 'Actualizar modelos cuesta un 40% menos', cost: 320000, max: 1 },
  { id: 'u_odds', name: 'Investigación de rareza', desc: 'Sube la probabilidad de sacar piezas de cada rareza (requiere I+D)', max: 10, perTier: true, requires: 'u_rd' },
  { id: 'u_race', name: 'División de competición', desc: 'Desbloquea el contrato de la Copa Apex', cost: 900000, max: 1 },
];
// Coste base de cada nivel de investigación de rareza: cuanto más rara, más cara.
export const ODDS_COST = { 2: 60000, 3: 110000, 4: 190000, 5: 320000, 6: 520000 };
export function upgradeCost(u, level, sub) {
  if (u.perTier) return Math.round(ODDS_COST[sub] * Math.pow(1.3, level));
  return Math.round(u.cost * Math.pow(u.perType ? 1.35 : 1.6, level));
}
// Clave real de guardado: líneas por chasis (u_lines_suv...) y rareza por nivel (u_odds_4...).
export function upgradeKey(u, sub) { return u.perType || u.perTier ? u.id + '_' + sub : u.id; }
export function buyUpgrade(state, id, sub) {
  const u = FACTORY_UPGRADES.find((x) => x.id === id);
  if (!u) return { ok: false, msg: 'Mejora desconocida.' };
  if (u.perType && !CAR_TYPES.some((t) => t.id === sub)) return { ok: false, msg: 'Elige un chasis para ampliar su línea.' };
  if (u.perTier) { sub = +sub; if (!ODDS_COST[sub]) return { ok: false, msg: 'Elige una rareza.' }; }
  if (u.requires && factoryLevel(state, u.requires) < 1) return { ok: false, msg: 'Necesitas el Departamento de I+D para investigar rarezas.' };
  const key = upgradeKey(u, sub);
  const level = factoryLevel(state, key);
  if (level >= u.max) return { ok: false, msg: 'Esta mejora ya está al máximo.' };
  const cost = upgradeCost(u, level, sub);
  const label = u.perType ? `ampliar la línea de ${CAR_TYPES.find((t) => t.id === sub).name}` : u.perTier ? `investigar la rareza ${RARITY[sub].name.toLowerCase()}` : u.name.toLowerCase();
  if (state.cash < cost) return { ok: false, msg: `No tienes fondos suficientes para ${label}.`, cost, cash: state.cash };
  state.cash -= cost;
  state.factory.upgrades[key] = level + 1;
  const msg = u.perType ? `Línea de ${CAR_TYPES.find((t) => t.id === sub).name} ampliada: ${level + 2} líneas.`
    : u.perTier ? `Investigación ${RARITY[sub].name.toLowerCase()}: nivel ${level + 1}/${u.max}.` : `${u.name} completada.`;
  return { ok: true, msg, level: level + 1 };
}

// ---------- Solicitudes de la comunidad ----------
// Petición: tipo de coche + puntuación mínima + plazo. Se cumple lanzando un modelo
// que encaje antes del plazo. Ignorarla tiene penalización moderada y progresiva.
const REQUEST_TIERS = [
  { minRating: 32, days: 28, cash: 45000, followers: 150, text: (t) => `Los clientes piden un ${t} asequible y fiable (puntuación ≥ 32).` },
  { minRating: 50, days: 31, cash: 110000, followers: 450, text: (t) => `Tu público quiere un ${t} de calidad (puntuación ≥ 50).` },
  { minRating: 70, days: 34, cash: 260000, followers: 1300, text: (t) => `Los seguidores exigen un ${t} excepcional (puntuación ≥ 70).` },
];

export function maybeSpawnRequest(state, report) {
  if (state.requests.filter((r) => r.status === 'open').length >= 3) return;
  if (rand() > 0.3) return;
  const tier = REQUEST_TIERS[Math.min(REQUEST_TIERS.length - 1, Math.floor(rand() * (state.prestige > 40 ? 3 : 2)))];
  const taken = new Set(state.requests.filter((r) => r.status === 'open').map((r) => r.typeId));
  const pool = CAR_TYPES.filter((t) => !taken.has(t.id));
  if (!pool.length) return;
  const type = pick(pool);
  const req = {
    id: 'rq' + state.day + '_' + Math.floor(rand() * 1e6),
    typeId: type.id, minRating: tier.minRating,
    createdDay: state.day, totalDays: tier.days,
    deadlineDay: state.day + tier.days,
    rewardCash: tier.cash, rewardFollowers: tier.followers,
    text: tier.text(type.name.toLowerCase()), status: 'open',
  };
  state.requests.push(req);
  if (report) report.events.push({ type: 'requestNew', requestId: req.id, text: `Nueva solicitud de la comunidad: ${type.name} con puntuación ≥ ${tier.minRating} (${tier.days} días).` });
  return req;
}

// Urgencia de una solicitud según la fracción de plazo restante.
export function requestUrgency(state, r) {
  const total = r.totalDays || 31;
  const left = Math.max(0, r.deadlineDay - state.day);
  const f = left / total;
  const level = f > 0.6 ? 'ok' : f > 0.35 ? 'warn' : f > 0.15 ? 'hot' : 'crit';
  return { left, total, f, level };
}

// Expiración diaria + nueva petición. Penalización moderada y creciente si se acumulan.
export function tickRequests(state, report) {
  for (const r of state.requests) {
    if (r.status !== 'open') continue;
    if (state.day >= r.deadlineDay) {
      r.status = 'expired';
      const missed = state.requests.filter((x) => x.status === 'expired' && state.day - x.deadlineDay < 10).length;
      const loss = Math.round(state.followers * Math.min(0.12, 0.04 + missed * 0.02));
      state.followers = Math.max(0, state.followers - loss);
      state.prestige = Math.max(0, state.prestige - 1);
      report.events.push({ type: 'requestExpired', text: `No respondiste a tiempo: la comunidad se encoge (−${loss} seguidores).` });
    }
  }
  maybeSpawnRequest(state, report);
}

// ¿Cumple este coche alguna petición abierta? (se comprueba al lanzar un modelo)
export function fulfillCheck(state, car) {
  for (const r of state.requests) {
    if (r.status !== 'open') continue;
    if (r.typeId === car.typeId && marketRating(car) >= r.minRating) {
      r.status = 'done';
      r.doneDay = state.day;
      state.cash += r.rewardCash;
      state.followers += r.rewardFollowers;
      state.prestige = Math.min(100, state.prestige + 3);
      return r;
    }
  }
  return null;
}

// ---------- Contratos ----------
// Un contrato asigna un modelo a un pedido: las unidades que venda cuentan como
// entregas. Recompensa fija al completarlo (sin cobrar dos veces las mismas unidades).
const CONTRACT_TEMPLATES = [
  { title: 'Flota corporativa', units: 20, minRating: 35, days: 22, cash: 90000, prestige: 5, followers: 150, penalty: 25000 },
  { title: 'Pedido municipal', units: 15, minRating: 48, days: 20, cash: 140000, prestige: 7, followers: 250, penalty: 35000 },
  { title: 'Serie especial', units: 8, minRating: 62, days: 24, cash: 300000, prestige: 12, followers: 600, penalty: 60000 },
];
const ELITE_CONTRACT = { title: 'Copa Apex (élite)', units: 25, minRating: 72, days: 30, cash: 1200000, prestige: 35, followers: 3000, penalty: 200000, elite: true };

export function maybeSpawnContractOffer(state) {
  if (!state.contractOffers) state.contractOffers = [];
  if (state.activeContract) return;
  if (state.contractOffers.length >= 3) return;
  if (rand() > 0.5) return;
  const tpl = pick(CONTRACT_TEMPLATES);
  const type = pick(CAR_TYPES);
  state.contractOffers.push({
    id: 'ct' + state.day + '_' + Math.floor(rand() * 1e6),
    title: tpl.title, typeId: type.id, minRating: tpl.minRating, units: tpl.units,
    deadlineDays: tpl.days, rewardCash: tpl.cash, rewardPrestige: tpl.prestige,
    rewardFollowers: tpl.followers, penalty: tpl.penalty, delivered: 0, carId: null,
  });
}

// Oferta de élite: requiere división de competición y prestigio alto.
export function maybeSpawnEliteOffer(state) {
  if (state.activeContract || state.contractOffers.some((c) => c.elite)) return;
  if (factoryLevel(state, 'u_race') < 1 || state.prestige < 50) return;
  if (rand() > 0.5) return;
  const type = pick(CAR_TYPES.filter((t) => t.perfW >= 0.7));
  state.contractOffers.push({ id: 'cte' + state.day, ...ELITE_CONTRACT, typeId: type.id, delivered: 0, carId: null });
}

// Progreso diario: entregas, plazos y nuevas ofertas.
export function tickContracts(state, report) {
  const c = state.activeContract;
  if (c) {
    // Las ventas de hoy del modelo asignado cuentan como entregas del contrato.
    const line = (report.lines || []).find((l) => l.carId === c.carId);
    if (line) c.delivered += line.units;
    if (c.delivered >= c.units) {
      state.cash += c.rewardCash;
      state.prestige = Math.min(100, state.prestige + c.rewardPrestige);
      state.followers += c.rewardFollowers;
      const car = state.garage.find((x) => x.id === c.carId);
      if (car) car.contractId = null;
      state.activeContract = null;
      report.events.push({ type: 'contractDone', text: `Contrato completado: ${c.title}. Cobras ${c.rewardCash} € y ganas ${c.rewardFollowers} seguidores.` });
    } else if (state.day >= c.deadlineDay) {
      state.cash -= c.penalty;
      state.prestige = Math.max(0, state.prestige - 6);
      const car = state.garage.find((x) => x.id === c.carId);
      if (car) car.contractId = null;
      state.activeContract = null;
      report.events.push({ type: 'contractFailed', text: `Contrato fallido: ${c.title}. Penalización de ${c.penalty} €.` });
    }
  }
  maybeSpawnContractOffer(state);
  maybeSpawnEliteOffer(state);
}

// Aceptar un contrato: el coche se FABRICA en la ruleta (chasis fijo) cumpliendo la
// puntuación mínima. El plazo empieza a contar al aceptar.
export function acceptContract(state, contractId) {
  if (state.activeContract) return { ok: false, msg: 'Ya tienes un contrato en curso.' };
  const c = state.contractOffers.find((x) => x.id === contractId);
  if (!c) return { ok: false, msg: 'Ese contrato ya no está disponible.' };
  c.deadlineDay = state.day + c.deadlineDays;
  c.carId = null; c.delivered = 0;
  state.contractOffers = state.contractOffers.filter((x) => x.id !== c.id);
  state.activeContract = c;
  return { ok: true, msg: `Contrato aceptado: ${c.title}. Fabrica el coche en la ruleta.` };
}
// Vincular el coche fabricado para el contrato. Se lanza sin coste de desarrollo si hay
// línea libre; si no, queda como prototipo del contrato (lanzamiento gratis desde el garaje).
export function bindContractCar(state, car) {
  const c = state.activeContract;
  if (!c) return { ok: false, msg: 'No hay contrato activo.' };
  c.carId = car.id; c.research = null;
  car.contractId = c.id;
  if (capacity(state, car.typeId).free > 0) {
    car.status = 'mercado';
    car.launchedDay = state.day;
    car.price = Math.round(stats(car).value);
    return { ok: true, launched: true, msg: `${car.name} sale al mercado para el contrato ${c.title} (desarrollo pagado por el cliente).` };
  }
  return { ok: true, launched: false, msg: `${car.name} listo, pero la línea de ${CAR_TYPES.find((t) => t.id === car.typeId).name} está ocupada: libérala y lánzalo gratis desde el garaje.` };
}

// Asignar un modelo a un contrato. Devuelve {ok, msg}. El prototipo se lanza sin coste
// de desarrollo (lo cubre el contrato) pero ocupa un hueco de producción.
export function assignContract(state, contractId, carId) {
  const c = state.contractOffers.find((x) => x.id === contractId);
  if (!c) return { ok: false, msg: 'Ese contrato ya no está disponible.' };
  const car = state.garage.find((x) => x.id === carId);
  if (!car) return { ok: false, msg: 'Coche no encontrado.' };
  if (car.typeId !== c.typeId) return { ok: false, msg: 'Ese modelo no es del tipo que pide el contrato.' };
  if (marketRating(car) < c.minRating) return { ok: false, msg: `El modelo no alcanza la puntuación mínima (${c.minRating}).` };
  if (car.status !== 'prototipo' && car.status !== 'mercado') return { ok: false, msg: 'Solo puedes asignar prototipos o modelos en venta.' };
  if (car.status === 'prototipo') {
    if (capacity(state, car.typeId).free <= 0) return { ok: false, msg: 'No tienes línea libre para este chasis: retira o pausa un modelo del mismo tipo, o amplía la fábrica.' };
    car.status = 'mercado';
    car.launchedDay = state.day;
    car.price = Math.round(stats(car).value); // el contrato cubre el desarrollo: precio recomendado
  }
  car.contractId = c.id;
  c.deadlineDay = state.day + c.deadlineDays;
  state.contractOffers = state.contractOffers.filter((x) => x.id !== c.id);
  state.activeContract = c;
  return { ok: true, msg: `${c.title}: ${car.name} asignado.` };
}

export function abandonContract(state) {
  const c = state.activeContract;
  if (!c) return;
  const car = state.garage.find((x) => x.id === c.carId);
  if (car) car.contractId = null;
  state.prestige = Math.max(0, state.prestige - 4);
  state.activeContract = null;
}
