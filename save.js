// Guardado automático: localStorage + código de respaldo exportable/importable.
// El estado se reemplaza atómicamente al cargar: nunca se vuelven a simular ventas.
import { byId, seedRivals } from './sim.js';
import { CAR_TYPES, RIVALS } from './data.js';

export const SAVE_KEY = 'ruletaMotors.save.v2';
export const SAVE_VERSION = 2;

// ---------- Serialización ----------
export function serializeBuild(build) {
  if (!build) return null;
  const picks = {};
  for (const k in build.picks || {}) {
    const v = build.picks[k];
    picks[k] = v && v.id ? v.id : v; // piezas -> id, perf -> número
  }
  return {
    stage: build.stage, phase: build.phase === 'spinning' ? 'decide' : build.phase,
    picks, rerolls: build.rerolls || {},
    pending: build.pending || null, // tirada ya cobrada y sorteada, pendiente de decidir
    mode: build.mode || 'new', baseId: build.baseId || null, startStage: build.startStage || 0,
    spun: build.spun || {},
    contractId: build.contractId || null,
  };
}

export function exportCode(state, build) {
  const payload = { v: SAVE_VERSION, savedAt: Date.now(), state, build: serializeBuild(build) };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

export function saveGame(state, build) {
  try {
    const payload = { v: SAVE_VERSION, savedAt: Date.now(), state, build: serializeBuild(build) };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return { ok: true, savedAt: payload.savedAt };
  } catch (e) {
    return { ok: false, error: e };
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignorar */ }
}

export function lastSaved() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p.savedAt || null;
  } catch (e) { return null; }
}

// ---------- Validación y migración ----------
function validPartId(map, id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(map, id);
}

function validateState(st) {
  if (!st || typeof st !== 'object') return 'formato';
  if (typeof st.company !== 'string' || !st.company) return 'compañía';
  if (!Array.isArray(st.garage)) return 'garaje';
  if (!st.rivals || typeof st.rivals !== 'object') return 'rivales';
  if (!Number.isFinite(st.day) || st.day < 1) return 'día';
  if (!Number.isFinite(st.cash)) return 'caja';
  for (const c of st.garage) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') return 'coche';
    if (!validPartId(byId.type, c.typeId)) return 'chasis de un coche';
    if (!validPartId(byId.engine, c.engineId) || !validPartId(byId.intake, c.intakeId)
      || !validPartId(byId.turbo, c.turboId) || !validPartId(byId.traction, c.tractionId)
      || !validPartId(byId.aero, c.aeroId)) return 'piezas de un coche';
  }
  return null;
}

// Migra una partida de la versión 1 (códigos antiguos): añade los campos nuevos
// con valores por defecto sin tocar rivales, saldos ni coches existentes.
function migrate(st) {
  st.version = SAVE_VERSION;
  if (typeof st.followers !== 'number' || !Number.isFinite(st.followers)) st.followers = 120;
  if (!st.factory || typeof st.factory !== 'object') st.factory = { upgrades: {} };
  if (!st.factory.upgrades || typeof st.factory.upgrades !== 'object') st.factory.upgrades = {};
  // Migración: la antigua ampliación global de líneas pasa a cada chasis.
  if (st.factory.upgrades.u_lines) {
    const lv = st.factory.upgrades.u_lines;
    for (const t of CAR_TYPES) { const k = 'u_lines_' + t.id; st.factory.upgrades[k] = Math.max(st.factory.upgrades[k] || 0, lv); }
    delete st.factory.upgrades.u_lines;
  }
  if (!Array.isArray(st.requests)) st.requests = [];
  if (!Array.isArray(st.contractOffers)) st.contractOffers = [];
  if (st.activeContract !== null && typeof st.activeContract !== 'object') st.activeContract = null;
  for (const c of st.garage) {
    if (typeof c.updates !== 'number') c.updates = 0;
    if (c.status === 'vendido' || c.status === 'retirado' || c.status === 'prototipo' || c.status === 'mercado' || c.status === 'pausa') { /* ok */ }
    else c.status = 'prototipo';
    if (typeof c.contractId !== 'string') c.contractId = null;
  }
  // Marcas rivales nuevas (más competencia): se añaden a partidas antiguas.
  if (st.rivals && typeof st.rivals === 'object') seedRivals(st); // añade rivales, seguidores e historial que falten
  if (!st.settings || typeof st.settings !== 'object') st.settings = { classicOdds: false };
  if (!Array.isArray(st.revHist)) st.revHist = [];
  // Partidas v1 sin cupo suficiente: se conservan los modelos activos; el cupo
  // solo limita lanzamientos nuevos hasta liberar capacidad.
  return st;
}

export function restoreBuild(b) {
  if (!b || typeof b !== 'object' || !b.picks) return null;
  const picks = {};
  for (const k in b.picks) {
    const v = b.picks[k];
    if (k === 'type') picks.type = byId.type[v];
    else if (k === 'engine') picks.engine = byId.engine[v];
    else if (k === 'intake') picks.intake = byId.intake[v];
    else if (k === 'turbo') picks.turbo = byId.turbo[v];
    else if (k === 'traction') picks.traction = byId.traction[v];
    else if (k === 'aero') picks.aero = byId.aero[v];
    else if (k === 'perf') picks.perf = v;
  }
  // Si falta alguna pieza anterior a la actual, la tirada queda corrupta: descartarla
  // es más seguro que dejar el jugador atascado (el dinero de las repeticiones ya
  // estaba gastado en la partida guardada).
  const need = ['type', 'engine', 'intake', 'turbo', 'traction', 'aero', 'perf'];
  const stage = Math.min(Math.max(0, b.stage | 0), need.length);
  const ok = need.slice(0, b.pending ? stage : stage).every((k) => picks[k] !== undefined && picks[k] !== null);
  if (!ok) return null;
  const out = { stage, phase: b.phase === 'ready' ? 'ready' : 'decide', picks, rerolls: b.rerolls || {} };
  if (b.mode && b.mode !== 'new') { out.mode = b.mode; out.baseId = b.baseId; out.startStage = b.startStage | 0; out.spun = (b.spun && typeof b.spun === 'object') ? b.spun : {}; if (b.contractId) out.contractId = b.contractId; }
  if (b.pending && picks[b.pending.key] === undefined) {
    // Tirada cobrada y sorteada cuyo resultado aún no se había mostrado: recuperarla.
    const p = b.pending;
    const val = p.key === 'type' ? byId.type[p.val] : p.key === 'engine' ? byId.engine[p.val]
      : p.key === 'intake' ? byId.intake[p.val] : p.key === 'turbo' ? byId.turbo[p.val]
      : p.key === 'traction' ? byId.traction[p.val] : p.key === 'aero' ? byId.aero[p.val] : p.val;
    if (val) { picks[p.key] = val; out.phase = 'decide'; }
  }
  return out;
}

function adopt(payload) {
  const st = migrate(payload.state);
  const bad = validateState(st);
  if (bad) return { ok: false, error: `Partida inválida (${bad}).` };
  return { ok: true, state: st, build: restoreBuild(payload.build), savedAt: payload.savedAt || null };
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const res = adopt(payload);
    if (!res.ok) return res;
    return res;
  } catch (e) {
    return { ok: false, error: 'Guardado ilegible.' };
  }
}

// Importar un código de respaldo (v1 o v2). No toca la partida actual si falla.
export function importCode(code) {
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (!payload || !payload.state) throw new Error('bad');
    return adopt(payload);
  } catch (e) {
    return { ok: false, error: 'El código no es válido.' };
  }
}
