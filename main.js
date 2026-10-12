import { Showroom } from './car3d.js';
import {
  rollBuild, rollStage, buildFromPicks, rerollCost, stats, parts, byId, ratingLabel, rarityOf, newState, simulateDay, estimateDaily,
  allActive, spinCost, modelName, FIXED_DAILY, PER_MODEL_DAILY, marketRating, capacity, fixedDaily, factoryLevel, checkCommunityRequests,
  playerOdds, tierOdds, ODDS_TIERS, rev7, rivalPrestige,
} from './sim.js';
import { RARITY, ENGINES, INTAKES, TURBOS, TRACTIONS, AEROS, CAR_TYPES, PERF_MIN, PERF_MAX, RIVALS } from './data.js';
import { FACTORY_UPGRADES, upgradeCost, upgradeKey, buyUpgrade, acceptContract, bindContractCar, abandonContract, requestUrgency, ODDS_COST } from './progress.js';
import { saveGame, loadGame, clearSave, exportCode, importCode, lastSaved, serializeBuild, restoreBuild } from './save.js';

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const eur = (v) => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + nf2.format(a / 1e6) + ' M€';
  if (a >= 1e4) return s + nf0.format(a / 1e3) + ' k€';
  return s + nf0.format(a) + ' €';
};
const eurFull = (v) => (v < 0 ? '−' : '') + nf0.format(Math.abs(Math.round(v))) + ' €';
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&' + 'amp;', '<': '&' + 'lt;', '>': '&' + 'gt;', '"': '&' + 'quot;', "'": '&' + '#39;' }[c]));
const rc = (tier) => RARITY[tier].color;
const ratingColor = (r) => (r >= 95 ? RARITY[5].color : r >= 80 ? RARITY[3].color : r >= 50 ? RARITY[2].color : RARITY[1].color);
const TYPE_ICON = {
  turismo: '<svg viewBox="0 0 32 32" fill="none" stroke="#141210" stroke-width="2.4" stroke-linejoin="round"><path d="M3 21h26v-4l-4-1-4-5H11l-4 5-4 1z"/><circle cx="9" cy="22" r="2.6" fill="#141210"/><circle cx="23" cy="22" r="2.6" fill="#141210"/></svg>',
  pickup: '<svg viewBox="0 0 32 32" fill="none" stroke="#141210" stroke-width="2.4" stroke-linejoin="round"><path d="M2 21h28v-5l-3-1-2-5h-8v6H2z"/><circle cx="8" cy="22" r="3" fill="#141210"/><circle cx="24" cy="22" r="3" fill="#141210"/></svg>',
  bolido: '<svg viewBox="0 0 32 32" fill="none" stroke="#141210" stroke-width="2.4" stroke-linejoin="round"><path d="M2 21h28l-2-3-9-3-5 1-8 1-3-3v3z"/><circle cx="9" cy="22" r="2.4" fill="#141210"/><circle cx="24" cy="22" r="2.4" fill="#141210"/></svg>',
};
const ICON_ALIAS = { utilitario: 'turismo', furgoneta: 'pickup', suv: 'pickup', coupe: 'turismo', deportivo: 'bolido' };
const typeIcon = (id) => TYPE_ICON[id] || TYPE_ICON[ICON_ALIAS[id]];
const perfTier = (v) => (v >= 122 ? 4 : v >= 108 ? 3 : v >= 90 ? 2 : 1);

// ---------- Guardado automático ----------
// Guarda tras cada cambio persistente (día, fabricación, lanzamiento, ventas, mejoras...).
// Si el navegador rechaza la escritura, se avisa en lugar de anunciar un guardado falso.
function persist() {
  const res = saveGame(state, ui.build);
  if (!res.ok) toast('No se ha podido guardar la partida (almacenamiento no disponible).');
  return res;
}

// ---------- Audio procedural ----------
let actx = null, muted = false;
function sfx(freq = 440, dur = 0.08, type = 'square', vol = 0.06, slide = 0) {
  if (muted || !actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
}
const tick = () => sfx(900 + Math.random() * 200, 0.025, 'square', 0.025);
const reveal = (tier) => { const base = [0, 520, 620, 740, 880, 1000, 1150][tier] || 880; sfx(base, 0.14, 'triangle', 0.09); if (tier >= 3) setTimeout(() => sfx(base * 1.5, 0.2, 'triangle', 0.08), 90); if (tier >= 4) setTimeout(() => sfx(base * 2, 0.35, 'triangle', 0.07), 200); };
const cash = () => { sfx(1320, 0.07, 'square', 0.04); setTimeout(() => sfx(1760, 0.12, 'square', 0.04), 70); };
const thud = () => sfx(160, 0.25, 'sine', 0.2, -100);
const engineRev = () => { sfx(90, 0.6, 'sawtooth', 0.05, 160); };
const errSfx = () => sfx(220, 0.18, 'sawtooth', 0.05, -60);

// ---------- Estado ----------
let state = newState('Ameztoy Motors');
let ui = { tab: 'ruleta', selected: null, spinning: false, lastResult: null, launchPrice: {}, reportOpen: false, build: null, garageFilter: 'prototipo', garageSort: 'reciente', spinGen: 0 };

const show = new Showroom($('#scene'));
let debugOn = false;
const dbg = document.createElement('div'); dbg.id = 'debug'; dbg.hidden = true; document.body.appendChild(dbg);

// ---------- Ruleta ----------
const REELS = [
  { key: 'type', label: 'Chasis', list: CAR_TYPES, fmt: (x) => [x.name, 'espacio ' + x.space] },
  { key: 'engine', label: 'Motor', list: ENGINES, fmt: (x) => [x.name, '×' + nf2.format(x.power) + ' · ' + x.space + ' esp'] },
  { key: 'intake', label: 'Cilindrada', list: INTAKES, fmt: (x) => [x.name, '×' + nf2.format(x.mult) + ' · ' + x.space + ' esp'] },
  { key: 'turbo', label: 'Sobrealim.', list: TURBOS, fmt: (x) => [x.name, '×' + nf2.format(x.mult) + ' · ' + x.space + ' esp'] },
  { key: 'traction', label: 'Tracción', list: TRACTIONS, fmt: (x) => [x.name, 'agarre ' + x.grip + ' · acel ' + x.accel] },
  { key: 'aero', label: 'Aerodinámica', list: AEROS, fmt: (x) => [x.name, 'agarre ×' + x.grip] },
  { key: 'perf', label: 'Rendimiento', list: null, fmt: (x) => [String(x), x >= 120 ? 'obra maestra' : x >= 100 ? 'fino' : x >= 80 ? 'normal' : 'flojo'] },
];

function renderRuleta() {
  const pane = $('#pane-ruleta');
  const b = ui.build;
  const cost = spinCost(state);
  const res = ui.lastResult;
  const cur = b ? REELS[Math.min(b.stage, REELS.length - 1)] : null;
  const base = buildBase(b);
  const ct = buildContract(b);
  const sub = ct
    ? `Fabricación por contrato: chasis ${byId.type[ct.typeId].name}, puntuación mínima <b>${ct.minRating}</b>. Cada tirada se paga. Puedes cerrarla y seguir mañana.`
    : !b
    ? (cost === 0 ? 'Tienes un coche gratis hoy. Se monta pieza a pieza: en cada una te quedas con la tirada o la repites pagando.' : 'Ya has montado tu coche gratis hoy. Puedes montar otro pagando o pasar al día siguiente.')
    : base && b.mode === 'evo-perf'
      ? `Investigación de rendimiento: solo se gira el rendimiento y hay que superar el del original (<b>${base.perf}</b>). Si no lo consigues, ciérrala y sigue mañana con las tiradas a precio inicial.`
      : base
        ? `Rediseño completo: chasis fijo (${byId.type[base.typeId].name}). Pieza ${b.stage} de ${REELS.length - 1}: ${cur.label}. En cada pieza te quedas con la original o giras; si giras, solo vale una igual o mejor.`
        : `Pieza ${b.stage + 1} de ${REELS.length}: ${cur.label}.`;
  pane.innerHTML = `
    <h2 class="pane-title">${ct ? `Contrato · ${esc(ct.title)}` : base ? `Nueva versión · ${esc(nextVersionName(base))}` : `Tirada del día ${state.day}`}</h2>
    ${ct ? `<div class="evo-banner contract"><span>Pedido de cliente</span><span>${byId.type[ct.typeId].name} · puntuación ≥ <b>${ct.minRating}</b> · ${ct.units} uds. · vence el día ${ct.deadlineDay}${b.stage > 1 ? ` · puntuación actual estimada: <b>${picksRating({ picks: { ...b.picks, perf: b.picks.perf ?? 100 } })}</b>` : ''}</span></div>` : ''}
    ${base ? `<div class="evo-banner ${b.mode}"><span>${b.mode === 'evo-perf' ? 'Evolución de rendimiento' : 'Rediseño completo'}</span><span>Base: <b>${esc(base.name)}</b> · rendimiento ${base.perf} · puntuación ${marketRating(base)}</span></div>` : ''}
    <p class="pane-sub">${sub}</p>
    <div class="reels" id="reels">
      ${REELS.map((r, i) => `
        <div class="reel-row ${isResearch(b) && i < (b.startStage || 0) ? 'locked' : ''}">
          <span class="reel-label">${r.label}${base && r.key === 'perf' && b.mode === 'evo-perf' ? ` <small class="need">&gt; ${base.perf}</small>` : ''}${isResearch(b) && i < (b.startStage || 0) ? ' <small class="lock">fijo</small>' : ''}</span>
          <div class="reel idle ${cur && cur.key === r.key ? 'current' : ''}" id="reel-${r.key}"><div class="reel-strip"><div class="reel-item">—</div></div></div>
        </div>`).join('')}
    </div>
    <div class="space-meter">
      <div class="space-head"><span>Espacio del chasis</span><span id="spaceTxt" class="num">– / –</span></div>
      <div class="space-bar" id="spaceBar"></div>
    </div>
    <div class="spin-area" id="spinArea"></div>
    <div id="resultBox"></div>`;
  if (b) {
    REELS.forEach((r, i) => { if (b.picks[r.key] !== undefined && (i < b.stage || b.phase === 'decide')) paintReel(r, b.picks[r.key]); });
    paintSpace(b.picks);
  }
  renderControls();
  if (res && !b && !ui.spinning) { paintFinalReels(res); renderResult(res); }
}

function renderControls() {
  const area = $('#spinArea'); if (!area) return;
  const b = ui.build, cost = spinCost(state);
  if (ui.spinning) { area.innerHTML = '<button class="btn btn-primary btn-block spin-btn" disabled>Girando…</button>'; return; }
  if (!b) {
    const noFunds = cost > 0 && state.cash < cost;
    area.innerHTML = `<button class="btn btn-primary btn-block spin-btn" id="spinBtn">${cost === 0 ? 'Montar coche · girar chasis' : 'Coche extra · ' + eur(cost)}</button>
      <div class="spin-note">${cost === 0 ? 'Probabilidades: común 50 · poco común 28 · raro 15 · legendario 7' : 'Los coches extra duplican su precio cada vez. Mañana vuelve a haber uno gratis.'}</div>`;
    $('#spinBtn').onclick = startBuild;
    return;
  }
  const r = REELS[b.stage];
  const base = buildBase(b);
  const research = isResearch(b);
  const closeBtn = research ? `<button class="btn btn-block" id="closeResBtn">${b.mode === 'contract' ? 'Cerrar fabricación · seguir mañana' : 'Cerrar investigación · seguir mañana'}</button>` : '';
  if (b.phase === 'ready' && base && b.mode === 'evo-full') {
    const orig = origPart(base, r.key);
    const spun = b.spun && b.spun[r.key];
    const fits = r.key === 'perf' || origFits(b, r.key, orig);
    area.innerHTML = `${!spun && fits ? `<button class="btn btn-primary btn-block spin-btn" id="keepOrigBtn">Quedarme con la original · ${esc(r0(r.key, orig))}</button>` : ''}
      <button class="btn ${!spun && fits ? '' : 'btn-primary spin-btn'} btn-block" id="spinBtn">Girar ${r.label.toLowerCase()} · ${eur(paidSpinCost(b))}</button>
      ${closeBtn}
      <div class="spin-note">${spun ? `Ya giraste esta pieza: necesitas una igual o mejor que ${esc(r0(r.key, orig))}.` : !fits ? 'La pieza original no cabe con el motor/cilindrada elegidos: tienes que girar.' : `Si giras, ya no podrás volver a la original: tendrás que sacar una igual o mejor que ${esc(r0(r.key, orig))}.`}</div>`;
    const ko = $('#keepOrigBtn'); if (ko) ko.onclick = keepOriginal;
    $('#spinBtn').onclick = paidSpin;
    $('#closeResBtn').onclick = () => closeResearch(false);
    return;
  }
  if (b.phase === 'ready') {
    area.innerHTML = `<button class="btn btn-primary btn-block spin-btn" id="spinBtn">Girar ${r.label.toLowerCase()}${research ? ' · ' + eur(paidSpinCost(b)) : ''}</button>${closeBtn}`;
    $('#spinBtn').onclick = research ? paidSpin : spinStage;
    if (research) $('#closeResBtn').onclick = () => closeResearch(false);
    return;
  }
  const val = b.picks[r.key], rcost = rerollCost(r.key, b.rerolls[r.key] || 0);
  const last = b.stage === REELS.length - 1;
  const blocked = keepBlocked(b);
  area.innerHTML = `<button class="btn btn-primary btn-block spin-btn" id="keepBtn" ${blocked ? 'disabled' : ''}>${blocked ? esc(blocked) : (last ? 'Terminar con ' : 'Quedarme con ') + esc(r.fmt(val)[0])}</button>
    <button class="btn btn-block" id="rerollBtn">Repetir ${r.label.toLowerCase()} · ${eur(rcost)}</button>
    ${closeBtn}
    <div class="spin-note">${base && b.mode === 'evo-perf' ? 'Solo puedes terminar cuando el rendimiento supere al original. Si cierras, mañana las tiradas vuelven a su precio inicial.' : base && b.mode === 'evo-full' ? `Original: ${esc(r0(r.key, origPart(base, r.key)))}. Debes quedarte con una igual o mejor; si no sale, repite o cierra y sigue mañana.` : b.mode === 'contract' ? 'Cada tirada cuesta el doble que la anterior. Al final, el coche debe alcanzar la puntuación del contrato.' : 'Cada repetición de esta pieza cuesta el doble. No se puede volver atrás a piezas ya elegidas.'}</div>`;
  $('#keepBtn').onclick = keepStage;
  $('#rerollBtn').onclick = rerollStage;
  if (research) $('#closeResBtn').onclick = () => closeResearch(false);
}

// ---------- Nuevas versiones (Mk2, Mk3...) ----------
// evo-perf: solo se gira el rendimiento y hay que superar el del original.
// evo-full: chasis fijo; se vuelven a girar motor, cilindrada, sobrealimentación,
// tracción, aerodinámica y rendimiento, pieza a pieza, como al crear un coche.
const VERSION_MODES = {
  'evo-perf': { label: 'Evolución de rendimiento', factor: 0.25, start: 6 },
  'evo-full': { label: 'Rediseño completo', factor: 0.6, start: 1 },
};
function buildBase(b) {
  if (!b || (b.mode !== 'evo-perf' && b.mode !== 'evo-full')) return null;
  return state.garage.find((x) => x.id === b.baseId) || null;
}
// Fabricaciones que se pueden cerrar y retomar otro día: versiones y contratos.
const isResearch = (b) => !!b && (b.mode === 'evo-perf' || b.mode === 'evo-full' || b.mode === 'contract');
function buildContract(b) {
  if (!b || b.mode !== 'contract') return null;
  const c = state.activeContract;
  return c && c.id === b.contractId ? c : null;
}
// En versiones y contratos TODAS las tiradas se pagan (la primera también).
function paidSpinCost(b) { return rerollCost(REELS[b.stage].key, b.rerolls[REELS[b.stage].key] || 0); }
function paidSpin() {
  const b = ui.build;
  if (!b || ui.spinning || b.phase !== 'ready') return;
  const key = REELS[b.stage].key, cost = paidSpinCost(b);
  if (state.cash < cost) { errSfx(); return toast(`No tienes fondos para girar. Coste: ${eurFull(cost)} · caja: ${eurFull(state.cash)}`); }
  state.cash -= cost; b.rerolls[key] = (b.rerolls[key] || 0) + 1;
  cash();
  spinStage();
}
// Puntuación que tendría el coche con las piezas actuales (para contratos).
function picksRating(b) {
  try { return marketRating(buildFromPicks(b.picks)); } catch { return 0; }
}
function familyOf(c) { return c.familyId || c.id; }
function nextVersionName(c) {
  const fam = familyOf(c);
  const gens = state.garage.filter((x) => familyOf(x) === fam).map((x) => x.gen || 1);
  return (c.baseName || c.name) + ' Mk' + (Math.max(1, ...gens) + 1);
}
function versionCost(c, mode) {
  const s = stats(c);
  return Math.round(s.launchCost * VERSION_MODES[mode].factor * (factoryLevel(state, 'u_test') ? 0.6 : 1));
}
// Devuelve un texto si no se puede aceptar la tirada actual (o false si se puede).
function keepBlocked(b) {
  const ct = buildContract(b);
  if (ct && REELS[b.stage].key === 'perf') {
    const rt = picksRating(b);
    return rt >= ct.minRating ? false : `El contrato pide ≥ ${ct.minRating} (tienes ${rt})`;
  }
  const base = buildBase(b);
  if (!base) return false;
  const key = REELS[b.stage].key, val = b.picks[key];
  if (b.mode === 'evo-perf') return key === 'perf' && !(val > base.perf) ? `Hay que superar ${base.perf} (tienes ${val})` : false;
  if (b.mode === 'evo-full' && b.spun && b.spun[key]) {
    const orig = origPart(base, key);
    if (partScore(key, val) >= partScore(key, orig)) return false;
    if (!betterExists(b, key, orig)) return false; // con el espacio que queda no existe nada igual o mejor
    return `Necesitas igual o mejor que ${r0(key, orig)}`;
  }
  return false;
}
// Rediseño completo: cada pieza se compara con la original por su valor principal.
const r0 = (key, v) => REELS.find((r) => r.key === key).fmt(v)[0];
function origPart(base, key) { return key === 'perf' ? base.perf : parts(base)[key]; }
function partScore(key, v) {
  switch (key) {
    case 'engine': return v.power;
    case 'intake': case 'turbo': return v.mult;
    case 'traction': case 'aero': return v.grip + v.accel;
    case 'perf': return v;
    default: return 0;
  }
}
function stageCandidates(b, key) {
  const p = b.picks, sp = p.type.space;
  switch (key) {
    case 'engine': { const mi = Math.min(...INTAKES.map((i) => i.space)); return ENGINES.filter((e) => e.space + mi <= sp); }
    case 'intake': return INTAKES.filter((i) => i.space <= sp - p.engine.space);
    case 'turbo': return TURBOS.filter((t) => t.space <= sp - p.engine.space - p.intake.space);
    case 'traction': return TRACTIONS;
    case 'aero': return AEROS;
    default: return null;
  }
}
// ¿Cabe la pieza original con lo elegido hasta ahora?
function origFits(b, key, orig) {
  const c = stageCandidates(b, key);
  return !c || c.some((x) => x.id === orig.id);
}
function betterExists(b, key, orig) {
  if (key === 'perf') return orig < PERF_MAX;
  const c = stageCandidates(b, key);
  return c.some((x) => partScore(key, x) >= partScore(key, orig));
}
function keepOriginal() {
  const b = ui.build, base = buildBase(b);
  if (!base || b.mode !== 'evo-full' || b.phase !== 'ready' || ui.spinning) return;
  const key = REELS[b.stage].key;
  if (b.spun && b.spun[key]) return toast('Ya has girado esta pieza: ahora necesitas una igual o mejor.');
  const orig = origPart(base, key);
  if (key !== 'perf' && !origFits(b, key, orig)) return toast('La pieza original ya no cabe con lo que has elegido.');
  b.picks[key] = orig;
  paintReel(REELS[b.stage], orig);
  b.stage += 1; b.phase = 'ready';
  persist();
  if (b.stage >= REELS.length) return finishBuild();
  renderRuleta(); renderReminder();
}
function basePicks(c, upto) {
  const p = parts(c);
  const out = {};
  REELS.slice(0, upto).forEach((r) => { out[r.key] = r.key === 'perf' ? c.perf : p[r.key]; });
  return out;
}
function startVersion(c, mode) {
  if (ui.spinning || ui.build) return toast('Termina primero la fabricación en curso.');
  if (c.research) return toast('Este modelo ya tiene una investigación abierta: continúala.');
  const cost = versionCost(c, mode);
  if (state.cash < cost) { errSfx(); return toast(`No tienes fondos para investigar la nueva versión. Coste: ${eurFull(cost)} · caja: ${eurFull(state.cash)}`); }
  state.cash -= cost;
  const start = VERSION_MODES[mode].start;
  ui.build = { mode, baseId: c.id, startStage: start, stage: start, phase: 'ready', picks: basePicks(c, start), rerolls: {} };
  ui.lastResult = null;
  cash();
  toast(`Investigación iniciada: ${nextVersionName(c)} (${eurFull(cost)})`);
  persist();
  setTab('ruleta');
  show.showCar(c, true);
  renderAll();
}
// Cerrar la investigación: se guarda en el coche base y se puede retomar al día siguiente.
function closeResearch(auto) {
  const b = ui.build;
  const host = buildBase(b) || buildContract(b);
  if (!host || ui.spinning) return;
  const saved = serializeBuild({ ...b, phase: 'ready', pending: null });
  delete saved.picks[REELS[b.stage].key];
  host.research = { ...saved, closedDay: state.day };
  ui.build = null;
  show.setBuildGhost(null);
  const where = b.mode === 'contract' ? 'Comunidad' : 'el garaje';
  toast(auto ? `Fabricación cerrada al pasar el día: retómala desde ${where}.` : `Cerrada. Podrás retomarla mañana desde ${where}.`);
  persist();
  if (!auto) renderAll();
}
// host = coche base (versiones) o contrato activo.
function resumeResearch(host) {
  if (!host || !host.research) return;
  if (ui.spinning || ui.build) return toast('Termina primero la fabricación en curso.');
  if (state.day <= host.research.closedDay) return toast('Se puede retomar a partir de mañana.');
  const b = restoreBuild({ ...host.research, phase: 'ready', rerolls: {} });
  if (!b) { host.research = null; persist(); return toast('No se pudo recuperar la fabricación.'); }
  b.phase = 'ready'; b.rerolls = {}; // precios de tirada reiniciados
  host.research = null;
  ui.build = b; ui.lastResult = null;
  persist();
  setTab('ruleta');
  if (b.mode === 'contract') { show.clearCar(); show.setBuildGhost(b.picks.type.id); }
  else show.showCar(host, true);
  renderAll();
}
function startContractBuild(ct) {
  if (ui.spinning || ui.build) return toast('Termina primero la fabricación en curso.');
  ui.build = { mode: 'contract', contractId: ct.id, startStage: 1, stage: 1, phase: 'ready', picks: { type: byId.type[ct.typeId] }, rerolls: {} };
  ui.lastResult = null;
  persist();
  setTab('ruleta');
  show.clearCar(); show.setBuildGhost(ct.typeId);
  renderAll();
}

function itemHTML(r, x) {
  const [a, b] = r.fmt(x);
  return `<div class="reel-item"><span>${esc(a)}</span><span class="meta">${esc(b)}</span></div>`;
}

function paintReel(r, val) {
  const el = $('#reel-' + r.key); if (!el) return;
  const tier = r.key === 'perf' ? perfTier(val) : val.tier;
  el.classList.remove('idle'); el.classList.add('done');
  el.style.setProperty('--rc', rc(tier));
  el.innerHTML = `<div class="reel-strip">${itemHTML(r, val)}</div>`;
}

function paintFinalReels(car) {
  const p = parts(car);
  for (const r of REELS) paintReel(r, r.key === 'perf' ? car.perf : p[r.key]);
  $('#reel-' + REELS.find((r) => r.key === 'type').key)?.classList.remove('current');
  paintSpace(p);
}

function paintSpace(p) {
  const bar = $('#spaceBar'); if (!bar) return;
  const cap = p.type ? p.type.space : 0;
  const segs = [];
  if (p.engine) segs.push(['Motor', p.engine.space, '#ff6a1a']);
  if (p.intake) segs.push(['Cilindrada', p.intake.space, '#ffb627']);
  if (p.turbo) segs.push(['Turbo', p.turbo.space, '#4fa8ff']);
  const used = segs.reduce((s, x) => s + x[1], 0);
  bar.innerHTML = cap ? segs.map(([n, v, c]) => `<span title="${n}: ${v}" style="width:${(v / cap) * 100}%;background:${c}"></span>`).join('') : '';
  $('#spaceTxt').textContent = cap ? `${nf1.format(used)} / ${cap}` : '– / –';
}

function spinReel(r, finalVal, duration) {
  return new Promise((resolve) => {
    const el = $('#reel-' + r.key);
    if (!el) return resolve();
    el.classList.remove('idle', 'done');
    const N = 18 + Math.floor(duration / 90);
    const items = [];
    for (let i = 0; i < N; i++) items.push(r.list ? r.list[Math.floor(Math.random() * r.list.length)] : PERF_MIN + Math.floor(Math.random() * (PERF_MAX - PERF_MIN + 1)));
    items.push(finalVal);
    el.innerHTML = `<div class="reel-strip">${items.map((x) => itemHTML(r, x)).join('')}</div>`;
    const strip = el.firstElementChild;
    const H = 38, dist = (items.length - 1) * H;
    const t0 = performance.now();
    let lastIdx = -1;
    function frame(now) {
      const t = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - t, 3.4);
      const y = e * dist;
      strip.style.transform = `translateY(${-y}px)`;
      const idx = Math.floor(y / H);
      if (idx !== lastIdx) { lastIdx = idx; tick(); }
      if (t < 1) requestAnimationFrame(frame); else resolve();
    }
    requestAnimationFrame(frame);
  });
}

// Empieza un coche nuevo (el primero del día es gratis) y tira el chasis.
function startBuild() {
  if (ui.spinning || ui.build) return;
  const cost = spinCost(state);
  if (cost > 0 && state.cash < cost) {
    errSfx();
    return toast(`No tienes fondos para un coche extra. Coste: ${eurFull(cost)} · caja: ${eurFull(state.cash)}`);
  }
  state.cash -= cost;
  state.spinsToday += 1;
  ui.build = { mode: 'new', stage: 0, phase: 'ready', picks: {}, rerolls: {} };
  ui.lastResult = null;
  $('#carCard').hidden = true;
  persist();
  renderTop();
  spinStage();
}

// Tira solo la pieza actual (o la repite). La tirada se guarda ANTES de animarla:
// si el jugador recarga a mitad de animación, no se vuelve a cobrar ni a sortear.
async function spinStage() {
  const b = ui.build;
  if (!b || ui.spinning) return;
  const r = REELS[b.stage];
  delete b.picks[r.key];
  if (b.mode === 'evo-full') { b.spun = b.spun || {}; b.spun[r.key] = true; }
  const val = rollStage(r.key, b.picks, playerOdds(state));
  b.pending = { key: r.key, val: r.key === 'perf' ? val : val.id };
  const gen = ++ui.spinGen;
  persist(); // resultado y cobro viajan juntos en el guardado
  ui.spinning = true; b.phase = 'spinning';
  if (r.key === 'type') show.setBuildGhost(null);
  renderRuleta(); renderTop(); renderReminder();
  $('#carCard').hidden = true;
  show.setSpinning(true);
  engineRev();
  await spinReel(r, val, window.__fastSpin ? 30 : 800);
  if (gen !== ui.spinGen || ui.build !== b) return; // la partida se recargó o reinició durante la animación
  b.picks[r.key] = val; b.phase = 'decide'; b.pending = null;
  ui.spinning = false;
  show.setSpinning(false);
  if (r.key === 'type') show.setBuildGhost(val.id);
  reveal(r.key === 'perf' ? perfTier(val) : val.tier);
  persist();
  renderRuleta(); renderReminder();
}

function keepStage() {
  const b = ui.build;
  if (!b || b.phase !== 'decide' || ui.spinning) return;
  const why = keepBlocked(b); if (why) { errSfx(); return toast(why); }
  b.stage += 1; b.phase = 'ready';
  persist();
  if (b.stage >= REELS.length) return finishBuild();
  renderRuleta();
}

function rerollStage() {
  const b = ui.build;
  if (!b || b.phase !== 'decide' || ui.spinning) return;
  const key = REELS[b.stage].key, cost = rerollCost(key, b.rerolls[key] || 0);
  if (state.cash < cost) {
    errSfx();
    return toast(`No tienes fondos para repetir esta pieza. Coste: ${eurFull(cost)} · caja: ${eurFull(state.cash)}`);
  }
  state.cash -= cost; b.rerolls[key] = (b.rerolls[key] || 0) + 1;
  cash();
  persist();
  spinStage();
}

function finishBuild() {
  const b = ui.build;
  const base = buildBase(b);
  const car = { ...buildFromPicks(b.picks), id: 'c' + state.nextCarNo++, name: modelName(), status: 'prototipo', createdDay: state.day, unitsSold: 0, revenue: 0, profit: 0, updates: 0, contractId: null };
  if (base) {
    car.name = nextVersionName(base);
    car.baseName = base.baseName || base.name;
    car.familyId = familyOf(base);
    car.gen = Math.max(1, ...state.garage.filter((x) => familyOf(x) === car.familyId).map((x) => x.gen || 1)) + 1;
    car.parentId = base.id;
    car.color = base.color; if (base.seed !== undefined) car.seed = base.seed;
  }
  const ct = buildContract(b);
  state.garage.unshift(car);
  if (ct) { const res = bindContractCar(state, car); setTimeout(() => toast(res.msg), 400); }
  ui.build = null; ui.lastResult = car; ui.selected = car.id;
  show.setBuildGhost(null); show.setSpinning(false);
  show.showCar(car, true);
  setTimeout(thud, 260);
  persist();
  renderAll();
  const s = stats(car);
  if (s.overallTier >= 4) toast('¡Leyenda! Has montado un coche de puntuación ' + s.rating);
}

function renderResult(car) {
  const s = stats(car), p = s.p;
  const box = $('#resultBox'); if (!box) return;
  const capped = s.rawHp > s.cap;
  box.innerHTML = `
    <div class="result">
      <div class="result-head">
        <div>
          <div class="result-name">${esc(state.company.split(' ')[0])} ${esc(car.name)}</div>
          <div class="ci-sub">${p.type.name} · ${p.engine.name} ${p.intake.name} · ${p.turbo.name}</div>
        </div>
        ${ratingBadge(s.rating)}
      </div>
      <div class="formula">
        Fuerza <b>${nf2.format(p.engine.power)}</b> × cilindrada <b>${nf2.format(p.intake.mult)}</b> × turbo <b>${nf2.format(p.turbo.mult)}</b> = <b>${nf2.format(s.mult)}</b><br>
        <b>${nf2.format(s.mult)}</b> × rendimiento <b>${car.perf}</b> = <b>${nf0.format(s.rawHp)} CV</b> brutos<br>
        ${capped
          ? `Tope del chasis <b>${s.cap} CV</b>: la potencia extra solo cuenta al 35% → <b class="hp">${nf0.format(s.hp)} CV</b>`
          : `<b class="hp">${nf0.format(s.hp)} CV</b> (dentro del tope del chasis, ${s.cap} CV)`}
      </div>
      ${versionCompareHTML(car)}
      ${reqMatchHTML(car)}
      <div class="actions"><div class="row">
        <button class="btn" id="goGarage">Ver en el garaje</button>
      </div></div>
    </div>`;
  $('#goGarage').onclick = () => openCar(car.id);
}

function versionCompareHTML(car) {
  if (!car.parentId) return '';
  const base = state.garage.find((x) => x.id === car.parentId); if (!base) return '';
  const a = stats(base), b = stats(car);
  const row = (l, x, y, unit = '', better = y > x) => `<div class="cmp-row"><span>${l}</span><span>${x}${unit} → <b class="${y === x ? '' : better ? 'pos' : 'neg'}">${y}${unit}</b></span></div>`;
  return `<div class="cmp"><div class="cmp-title">Frente a ${esc(base.name)}</div>
    ${row('Rendimiento', base.perf, car.perf)}
    ${row('Potencia', nf0.format(a.hp), nf0.format(b.hp), ' CV', b.hp > a.hp)}
    ${row('Puntuación', marketRating(base), marketRating(car))}
    ${row('Fiabilidad', a.reliability, b.reliability)}
    <div class="ci-sub" style="margin-top:6px">Ahora lánzalo desde el garaje (pagando desarrollo) o véndelo como prototipo.</div></div>`;
}

function ratingBadge(r) {
  const c = ratingColor(r);
  return `<div class="rating" style="color:${c}"><b>${r}</b><small>${ratingLabel(r)}</small></div>`;
}

// ---------- Garaje ----------
const GARAGE_TABS = [
  { key: 'prototipo', label: 'Prototipos', empty: 'No tienes prototipos. Gira la ruleta para montar uno.' },
  { key: 'mercado', label: 'En venta', empty: 'No tienes coches en venta. Lanza un prototipo al mercado desde la pestaña Prototipos.' },
  { key: 'pausa', label: 'Pausados', empty: 'Los modelos que pauses dejarán de venderse y liberan línea de producción.' },
  { key: 'retirado', label: 'Retirados', empty: 'Aquí aparecerán los coches que retires del mercado.' },
];
const GARAGE_SORTS = {
  reciente: ['Más recientes', () => 0],
  potencia: ['Más potentes', (a, b) => stats(b).hp - stats(a).hp],
  puntuacion: ['Mejor puntuación', (a, b) => marketRating(b) - marketRating(a)],
  ventas: ['Más vendidos', (a, b) => (b.unitsSold || 0) - (a.unitsSold || 0)],
  beneficio: ['Más beneficio', (a, b) => (b.profit || 0) - (a.profit || 0)],
};
const STATUS_LABEL = { prototipo: 'Prototipo', mercado: 'En venta', retirado: 'Retirado', vendido: 'Vendido', pausa: 'Pausado' };

// Navegación por identificador: abrir un coche concreto desde donde sea, cambiando
// a la pestaña del garaje que le corresponde (no cae al primer coche "En venta").
function openCar(id) {
  const c = state.garage.find((x) => x.id === id);
  if (!c) return;
  ui.selected = id; ui.expanded = id;
  if (GARAGE_TABS.some((t) => t.key === c.status)) ui.garageFilter = c.status;
  if (ui.tab !== 'garaje') setTab('garaje'); else renderAll();
  show.showCar(c, true); show._shown = c.id;
  renderCarCard();
}

function renderGaraje() {
  const pane = $('#pane-garaje');
  const live = state.garage.filter((c) => c.status !== 'vendido');
  const cap = capacity(state);
  // Si el coche seleccionado vive en otra pestaña, cambiar de pestaña en vez de
  // sustituirlo silenciosamente por el primero de la lista.
  if (ui.selected) {
    const selCar = live.find((c) => c.id === ui.selected);
    if (selCar && GARAGE_TABS.some((t) => t.key === selCar.status) && selCar.status !== ui.garageFilter) {
      ui.garageFilter = selCar.status;
    }
  }
  const count = (k) => live.filter((c) => c.status === k).length;
  const tab = GARAGE_TABS.find((t) => t.key === ui.garageFilter) || GARAGE_TABS[0];
  // "ventas" y "beneficio" solo tienen sentido con coches que ya han salido al mercado
  const sorts = Object.entries(GARAGE_SORTS).filter(([k]) => tab.key !== 'prototipo' || (k !== 'ventas' && k !== 'beneficio'));
  if (!sorts.some(([k]) => k === ui.garageSort)) ui.garageSort = 'reciente';
  const cars = live.filter((c) => c.status === tab.key).sort(GARAGE_SORTS[ui.garageSort][1]);
  const sel = cars.find((c) => c.id === ui.selected) || cars[0];
  ui.selected = sel ? sel.id : null;
  pane.innerHTML = `<h2 class="pane-title">Garaje</h2>
    <div class="cap-meter">
      <div class="space-head"><span>Líneas de producción por chasis</span><span class="num">${cap.used}/${cap.slots}</span></div>
      <div class="cap-grid">${cap.perType.map((t) => `<div class="cap-cell ${t.free <= 0 ? 'full' : t.used ? 'busy' : ''}" title="${t.name}: ${t.used}/${t.slots}">
        <span class="cap-name">${t.name}</span><span class="cap-num">${t.used}/${t.slots}</span></div>`).join('')}</div>
      <div class="ci-sub">Cada línea permite vender un modelo de ese chasis a la vez. Amplía cada chasis por separado en Empresa.</div>
    </div>
    <div class="chips" role="tablist">${GARAGE_TABS.map((t) => `<button class="chip ${t.key === tab.key ? 'active' : ''}" data-f="${t.key}">${t.label} <span class="count">${count(t.key)}</span></button>`).join('')}</div>
    <div class="sort-row"><span>Ordenar</span><select id="garageSort">${sorts.map(([k, v]) => `<option value="${k}" ${k === ui.garageSort ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
    ${cars.length ? `<div class="car-list">${cars.map((c) => carItem(c, sel && c.id === sel.id, ui.expanded === c.id) + (ui.expanded === c.id ? '<div id="detail" class="detail-inline"></div>' : '')).join('')}</div>`
      : `<div class="empty"><b>${tab.label}: vacío</b>${tab.empty}</div>${tab.key === 'prototipo' ? '<div class="actions"><button class="btn btn-primary" id="toSpin">Ir a la ruleta</button></div>' : ''}`}`;
  pane.querySelectorAll('.chip').forEach((b) => (b.onclick = () => {
    ui.garageFilter = b.dataset.f; ui.selected = null; renderGaraje();
    const c = state.garage.find((x) => x.id === ui.selected);
    if (c) show.showCar(c, true); else show.clearCar();
    renderCarCard();
  }));
  $('#garageSort').onchange = (e) => { ui.garageSort = e.target.value; renderGaraje(); };
  const ts = $('#toSpin'); if (ts) ts.onclick = () => setTab('ruleta');
  pane.querySelectorAll('.car-item').forEach((b) => (b.onclick = () => {
    const id = b.dataset.id;
    if (ui.expanded === id) { ui.expanded = null; renderGaraje(); return; } // segundo clic: plegar
    ui.expanded = id; ui.selected = id; selectCar(id);
    requestAnimationFrame(() => { const d = $('#detail'); const it = pane.querySelector(`.car-item[data-id="${id}"]`); (it || d)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }));
  const exp = cars.find((c) => c.id === ui.expanded);
  if (exp) renderDetail(exp);
}

function carItem(c, selected, expanded) {
  const s = stats(c);
  const label = STATUS_LABEL[c.status] || c.status;
  const age = c.status === 'mercado' ? state.day - c.launchedDay : 0;
  const flags = [];
  if (c.status === 'mercado' && age > 30) flags.push('envejecido');
  if (c.contractId) flags.push('contrato');
  return `<button class="car-item ${selected ? 'sel' : ''} ${expanded ? 'open' : ''}" data-id="${c.id}" aria-expanded="${!!expanded}">
    <span class="swatch" style="background:${c.color}">${typeIcon(parts(c).type.id)}</span>
    <span><div class="ci-name">${esc(c.name)}</div><div class="ci-sub">${parts(c).type.name} · día ${c.createdDay}${flags.length ? ' · <span style="color:var(--r4)">' + flags.join(' · ') + '</span>' : ''}</div></span>
    <span class="ci-right"><div class="ci-hp" style="color:${ratingColor(s.rating)}">${nf0.format(s.hp)} CV</div><span class="status ${c.status}">${label}</span></span>
    <span class="ci-chev" aria-hidden="true">▾</span>
  </button>`;
}

function partRow(label, part, extra = '') {
  return `<div class="part"><span>${label}</span><span style="color:${rc(part.tier)}">${esc(part.name)}${extra}</span></div>`;
}

// Motivos comerciales: por qué un coche vende bien o mal, con los factores que
// de verdad usa la simulación (precio, puntuación, fiabilidad, edad, demanda).
function marketReasons(c) {
  const s = stats(c);
  const out = [];
  const priceRatio = c.price / s.value;
  if (priceRatio < 0.92) out.push(['pos', 'Precio competitivo frente a modelos similares.']);
  else if (priceRatio > 1.15) out.push(['neg', 'Precio por encima del valor percibido del modelo.']);
  const act = allActive(state).filter((m) => m.typeId === c.typeId && m.owner !== 'player');
  if (act.length) {
    const avg = act.reduce((a, m) => a + m.rating, 0) / act.length;
    const mr = marketRating(c);
    if (mr > avg + 8) out.push(['pos', 'Puntuación superior a la media del segmento.']);
    else if (mr < avg - 8) out.push(['neg', 'Las prestaciones quedan por detrás de la media del segmento.']);
  }
  if (s.reliability >= 85) out.push(['pos', 'Excelente fiabilidad, muy valorada por los compradores.']);
  else if (s.reliability < 60) out.push(['neg', 'Fiabilidad justa: los compradores lo penalizan.']);
  if (s.consumption <= 6) out.push(['pos', 'Bajo consumo: barato de mantener.']);
  else if (s.consumption >= 18) out.push(['neg', 'Consumo alto para su categoría.']);
  const age = state.day - (c.launchedDay ?? state.day);
  if (age > 30) out.push(['neg', `Diseño anticuado (${age} días en el mercado): considera actualizarlo.`]);
  const type = byId.type[c.typeId];
  if (type.demand >= 12) out.push(['pos', 'Alta demanda en este segmento.']);
  if (type.demand <= 1.5) out.push(['neg', 'Segmento de nicho: pocas ventas potenciales.']);
  if (s.rawHp > type.hpCap * 1.25) out.push(['neg', 'Sobredimensionado para el chasis: pagas potencia que este segmento no valora.']);
  if ((state.followers || 0) > 800) out.push(['pos', 'Tu comunidad de seguidores empuja este modelo.']);
  return out.slice(0, 5);
}

function noveltyOf(c) {
  const type = byId.type[c.typeId];
  const age = Math.max(0, state.day - (c.launchedDay ?? state.day));
  return Math.max(0.15, Math.pow(type.decay, age));
}

function renderDetail(c) {
  const s = stats(c), p = s.p;
  const el = $('#detail'); if (!el) return;
  const cap = capacity(state, c.typeId);
  const minP = Math.round(s.unitCost * 0.9), maxP = Math.round(s.value * 1.8);
  let price = ui.launchPrice[c.id] ?? c.price ?? Math.round(s.value);
  price = Math.min(maxP, Math.max(minP, price));
  const est = estimateDaily(state, c, price);
  const isContractCar = !!c.contractId;
  const activeContract = state.activeContract && state.activeContract.carId === c.id ? state.activeContract : null;
  const statusBlock = c.status === 'prototipo' ? `
      <h3 class="sec">Sacar al mercado</h3>
      <div class="slider-row">
        <label><span>Precio de venta</span><b id="priceVal">${eurFull(price)}</b></label>
        <input type="range" id="priceRange" min="${minP}" max="${maxP}" step="${Math.max(100, Math.round(s.value / 200 / 100) * 100)}" value="${price}" />
        <div class="ci-sub" style="margin-top:4px">Coste por unidad ${eurFull(s.unitCost)} · precio recomendado ${eurFull(s.value)}</div>
      </div>
      <div class="estimate">
        <div class="stat"><div class="stat-l">Ventas estimadas</div><div class="stat-v" id="estU">${nf1.format(est.units)} <small>/día</small></div></div>
        <div class="stat"><div class="stat-l">Beneficio estimado</div><div class="stat-v ${est.profit - PER_MODEL_DAILY >= 0 ? 'pos' : 'neg'}" id="estP">${eur(est.profit - PER_MODEL_DAILY)} <small>/día</small></div></div>
      </div>
      <div class="actions">
        <button class="btn btn-primary btn-block" id="launchBtn">${c.contractId && state.activeContract && state.activeContract.id === c.contractId ? 'Lanzar para el contrato · desarrollo pagado' : 'Lanzar · desarrollo ' + eur(s.launchCost)}</button>
        <button class="btn btn-block" id="sellBtn">Vender prototipo a coleccionista · ${eur(s.collector)}</button>
        <div class="spin-note" id="fundErr" style="color:var(--bad)"></div>
      </div>` : c.status === 'mercado' ? `
      <h3 class="sec">En el mercado desde el día ${c.launchedDay}</h3>
      <div class="estimate">
        <div class="stat"><div class="stat-l">Unidades vendidas</div><div class="stat-v">${nf0.format(c.unitsSold || 0)}</div></div>
        <div class="stat"><div class="stat-l">Beneficio bruto</div><div class="stat-v ${(c.profit || 0) >= 0 ? 'pos' : 'neg'}">${eur(c.profit || 0)}</div></div>
        <div class="stat"><div class="stat-l">Actualidad</div><div class="stat-v ${noveltyOf(c) < 0.5 ? 'neg' : ''}">${Math.round(noveltyOf(c) * 100)}<small>%</small></div></div>
        <div class="stat"><div class="stat-l">Ventas ayer</div><div class="stat-v">${c.lastUnits ?? '–'}</div></div>
      </div>
      ${marketReasons(c).length ? `<div class="reasons">${marketReasons(c).map(([k, t]) => `<div class="reason ${k}">${k === 'pos' ? '▲' : '▼'} ${esc(t)}</div>`).join('')}</div>` : ''}
      <div class="slider-row">
        <label><span>Ajustar precio</span><b id="priceVal">${eurFull(price)}</b></label>
        <input type="range" id="priceRange" min="${minP}" max="${maxP}" step="${Math.max(100, Math.round(s.value / 200 / 100) * 100)}" value="${price}" />
      </div>
      <div class="estimate">
        <div class="stat"><div class="stat-l">Ventas estimadas</div><div class="stat-v" id="estU">${nf1.format(est.units)} <small>/día</small></div></div>
        <div class="stat"><div class="stat-l">Beneficio estimado</div><div class="stat-v" id="estP">${eur(est.profit - PER_MODEL_DAILY)} <small>/día</small></div></div>
      </div>
      ${activeContract ? `<div class="reasons"><div class="reason pos">Asignado al contrato ${esc(activeContract.title)}: ${activeContract.delivered}/${activeContract.units} uds. entregadas.</div></div>` : ''}
      <div class="actions"><div class="row">
        <button class="btn" id="applyPrice">Aplicar precio</button>
      </div></div>
      <div class="actions"><div class="row">
        <button class="btn" id="pauseBtn" ${isContractCar ? 'disabled' : ''}>Pausar</button>
        <button class="btn btn-danger" id="retireBtn" ${isContractCar ? 'disabled' : ''}>Retirar</button>
      </div></div>
      ${isContractCar ? '<div class="spin-note">Este modelo está asignado a un contrato: abandona el contrato antes de pausarlo o retirarlo.</div>' : ''}
      ${versionBlockHTML(c)}` : c.status === 'pausa' ? `
      <h3 class="sec">Pausado</h3>
      <p class="ci-sub">Vendió ${nf0.format(c.unitsSold || 0)} unidades con ${eur(c.profit || 0)} de beneficio bruto. No ocupa línea de producción.</p>
      <div class="actions"><div class="row">
        <button class="btn btn-primary" id="resumeBtn">Reactivar</button>
        <button class="btn btn-danger" id="retireBtn">Retirar</button>
      </div></div>
      ${versionBlockHTML(c)}` : `
      <h3 class="sec">Retirado</h3>
      <p class="ci-sub">Vendió ${nf0.format(c.unitsSold || 0)} unidades con ${eur(c.profit || 0)} de beneficio bruto.</p>
      <div class="actions">
        <button class="btn btn-block" id="relaunchBtn">Volver a lanzar (pagando desarrollo)</button>
      </div>
      ${versionBlockHTML(c)}`;

  el.innerHTML = `<div class="detail">
    <div class="result-head">
      <div><div class="result-name">${esc(c.name)}</div><div class="ci-sub">${p.type.name} · montado el día ${c.createdDay}${(c.updates || 0) ? ` · ${c.updates} actualización${c.updates > 1 ? 'es' : ''}` : ''}</div></div>
      ${ratingBadge(s.rating)}
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="stat-l">Potencia</div><div class="stat-v">${nf0.format(s.hp)} <small>CV</small></div></div>
      <div class="stat"><div class="stat-l">0–100 km/h</div><div class="stat-v">${nf1.format(s.t0100)} <small>s</small></div></div>
      <div class="stat"><div class="stat-l">Velocidad punta</div><div class="stat-v">${nf0.format(s.vmax)} <small>km/h</small></div></div>
      <div class="stat"><div class="stat-l">Fiabilidad</div><div class="stat-v" style="color:${s.reliability >= 80 ? 'var(--good)' : s.reliability < 60 ? 'var(--bad)' : 'var(--text)'}">${s.reliability}<small>/100</small></div></div>
      <div class="stat"><div class="stat-l">Consumo</div><div class="stat-v">${s.consumption} <small>L/100</small></div></div>
      <div class="stat"><div class="stat-l">Agarre</div><div class="stat-v">${nf2.format(s.grip)}</div></div>
    </div>
    <div class="parts">
      ${partRow('Motor', p.engine, ' · ×' + nf2.format(p.engine.power))}
      ${partRow('Cilindrada', p.intake, ' · ×' + nf2.format(p.intake.mult))}
      ${partRow('Sobrealimentación', p.turbo, ' · ×' + nf2.format(p.turbo.mult))}
      ${partRow('Tracción', p.traction)}
      ${partRow('Aerodinámica', p.aero)}
      <div class="part"><span>Rendimiento de fábrica</span><span style="color:${rc(perfTier(c.perf))}">${c.perf} / ${PERF_MAX}</span></div>
      <div class="part"><span>Espacio usado</span><span>${nf1.format(s.space)} / ${p.type.space}</span></div>
    </div>
    ${statusBlock}
  </div>`;

  const range = $('#priceRange');
  if (range) range.oninput = () => {
    const v = +range.value; ui.launchPrice[c.id] = v;
    $('#priceVal').textContent = eurFull(v);
    const e = estimateDaily(state, c, v);
    $('#estU').innerHTML = `${nf1.format(e.units)} <small>/día</small>`;
    const ep = $('#estP'); ep.innerHTML = `${eur(e.profit - PER_MODEL_DAILY)} <small>/día</small>`;
    ep.className = 'stat-v ' + (e.profit - PER_MODEL_DAILY >= 0 ? 'pos' : 'neg');
  };
  const lb = $('#launchBtn');
  if (lb) lb.onclick = () => launch(c, +$('#priceRange').value);
  const sb = $('#sellBtn');
  if (sb) sb.onclick = () => sellPrototype(c);
  const ap = $('#applyPrice');
  if (ap) ap.onclick = () => { c.price = +$('#priceRange').value; toast('Nuevo precio: ' + eurFull(c.price)); persist(); renderAll(); };
  el.querySelectorAll('[data-ver]').forEach((x) => (x.onclick = () => startVersion(c, x.dataset.ver)));
  const rres = $('#resumeResBtn'); if (rres) rres.onclick = () => resumeResearch(c);
  const pb = $('#pauseBtn');
  if (pb && !isContractCar) pb.onclick = () => {
    c.status = 'pausa'; ui.garageFilter = 'pausa';
    toast(`${c.name} en pausa: libera línea de producción y deja de venderse.`);
    persist(); renderAll();
  };
  const rb = $('#retireBtn');
  if (rb && !isContractCar) rb.onclick = () => { c.status = 'retirado'; ui.garageFilter = 'retirado'; toast(c.name + ' retirado del mercado'); persist(); renderAll(); };
  const rsb = $('#resumeBtn');
  if (rsb) rsb.onclick = () => {
    if (capacity(state, c.typeId).free <= 0) { errSfx(); return toast(`La línea de ${p.type.name} está ocupada (${cap.used}/${cap.slots}). Pausa o retira otro ${p.type.name} o amplía la fábrica.`); }
    c.status = 'mercado';
    toast(c.name + ' vuelve a la venta.');
    ui.garageFilter = 'mercado';
    persist(); renderAll();
  };
  const rlb = $('#relaunchBtn');
  if (rlb) rlb.onclick = () => { c.status = 'prototipo'; toast(c.name + ' listo para lanzarse de nuevo.'); ui.garageFilter = 'prototipo'; persist(); renderAll(); };
}

// Coste de actualizar (restyling): una fracción del desarrollo, crece con cada versión.
function versionBlockHTML(c) {
  const next = nextVersionName(c);
  if (c.research) {
    const ready = state.day > c.research.closedDay;
    return `<h3 class="sec">Nueva versión · ${esc(next)}</h3>
      <div class="evo-banner ${c.research.mode}"><span>${VERSION_MODES[c.research.mode].label} en curso</span><span>${ready ? 'Lista para continuar: las tiradas vuelven a su precio inicial.' : 'Podrás continuar mañana.'}</span></div>
      <div class="actions"><button class="btn btn-primary btn-block" id="resumeResBtn" ${ready ? '' : 'disabled'}>${ready ? 'Continuar investigación' : 'Disponible mañana'}</button></div>`;
  }
  return `<h3 class="sec">Nueva versión · ${esc(next)}</h3>
    <div class="ver-grid">
      <button class="ver-card" data-ver="evo-perf">
        <b>Evolución de rendimiento</b>
        <span>Mismas piezas. Solo se gira el rendimiento y debe superar ${c.perf}.</span>
        <em>${eur(versionCost(c, 'evo-perf'))}</em>
      </button>
      <button class="ver-card full" data-ver="evo-full">
        <b>Rediseño completo</b>
        <span>Mismo chasis. Nuevo motor, cilindrada, sobrealimentación, tracción, aero y rendimiento.</span>
        <em>${eur(versionCost(c, 'evo-full'))}</em>
      </button>
    </div>
    <div class="spin-note">La versión nueva sale como prototipo: después tendrás que lanzarla (desarrollo) o venderla.</div>`;
}

function updateCost(c) {
  const s = stats(c);
  return Math.round(s.launchCost * 0.4 * (1 + (c.updates || 0)) * (factoryLevel(state, 'u_test') ? 0.6 : 1));
}

function updateModel(c) {
  if ((c.updates || 0) >= 3) return toast('Este modelo ya tiene el máximo de actualizaciones (3).');
  const cost = updateCost(c);
  if (state.cash < cost) {
    errSfx();
    return toast(`No tienes fondos para actualizar este modelo. Coste: ${eurFull(cost)} · caja: ${eurFull(state.cash)}`);
  }
  state.cash -= cost;
  c.updates = (c.updates || 0) + 1;
  c.launchedDay = state.day; // recupera novedad
  state.prestige = Math.min(100, state.prestige + 1);
  cash();
  toast(`${c.name} actualizado (versión ${c.updates + 1}): vuelve a ser novedad.`);
  persist(); renderAll();
}

function launch(c, price) {
  const s = stats(c);
  const cap = capacity(state, c.typeId);
  if (cap.free <= 0) {
    errSfx();
    const err = $('#fundErr');
    if (err) err.textContent = `La línea de ${s.p.type.name} está ocupada (${cap.used}/${cap.slots}): pausa o retira el otro ${s.p.type.name} en venta, o amplía la fábrica.`;
    return;
  }
  const forContract = c.contractId && state.activeContract && state.activeContract.id === c.contractId;
  const devCost = forContract ? 0 : s.launchCost;
  if (state.cash < devCost) {
    errSfx();
    const err = $('#fundErr');
    if (err) err.textContent = `No tienes fondos suficientes para desarrollar este modelo. Coste: ${eurFull(s.launchCost)} · caja: ${eurFull(state.cash)}.`;
    return;
  }
  state.cash -= devCost;
  c.status = 'mercado'; c.price = price; c.launchedDay = state.day; ui.garageFilter = 'mercado';
  state.prestige = Math.max(0, state.prestige + (marketRating(c) - 50) / 8);
  cash();
  // Un lanzamiento muy bueno genera expectación (más aún si es una nueva versión).
  const hype = Math.max(0, Math.round((marketRating(c) - 55) * 6 * (c.parentId ? 1.4 : 1)));
  state.followers = (state.followers || 0) + hype;
  toast(`${c.name} sale al mercado a ${eurFull(price)}${hype ? ` · +${nf0.format(hype)} seguidores` : ''}`);
  const req = checkCommunityRequests(state, c);
  if (req) {
    setTimeout(() => toast(`Solicitud de la comunidad cumplida: +${nf0.format(req.rewardFollowers)} seguidores y ${eur(req.rewardCash)}`), 600);
    sfx(880, 0.25, 'triangle', 0.08);
  }
  persist();
  renderAll();
}
function sellPrototype(c) {
  const s = stats(c);
  state.cash += s.collector;
  c.status = 'vendido';
  cash();
  toast(`Vendido a un coleccionista por ${eurFull(s.collector)}`);
  const next = state.garage.find((x) => x.status === c.status && x.id !== c.id) || state.garage.find((x) => x.status !== 'vendido');
  ui.selected = next ? next.id : null;
  if (next) show.showCar(next); else { show.clearCar(); }
  persist();
  renderAll();
}

function selectCar(id) {
  const c = state.garage.find((x) => x.id === id);
  ui.selected = id;
  if (c) show.showCar(c, true);
  setTimeout(thud, 260);
  renderAll();
}

// ---------- Mercado ----------
function renderMercado() {
  const pane = $('#pane-mercado');
  const act = allActive(state);
  // Ranking por ingresos de los últimos 7 días (las marcas rivales ya llevan años en el mercado).
  const brands = [{ id: 'player', name: state.company, color: '#ff6a1a', revenue: rev7(state.revHist), followers: state.followers || 0, tag: 'Tu empresa', models: allActive(state).filter((x) => x.owner === 'player').length },
    ...Object.values(state.rivals).map((r) => ({ id: r.id, name: r.name, color: r.color, revenue: rev7(r.revHist), followers: r.followers || 0, tag: (RIVALS.find((x) => x.id === r.id) || {}).tag || '', models: r.models.length }))].sort((a, b) => b.revenue - a.revenue);
  const maxRev = Math.max(1, ...brands.map((b) => b.revenue));
  const colorOf = (o) => (o === 'player' ? '#ff6a1a' : state.rivals[o].color);
  const brandOf = (o) => (o === 'player' ? state.company : state.rivals[o].name);
  const myPos = brands.findIndex((b) => b.id === 'player') + 1;
  // Posición por segmento: marcas ordenadas por ventas de ayer (desempate: mejor puntuación).
  const segInfo = CAR_TYPES.map((t) => {
    const seg = act.filter((m) => m.typeId === t.id);
    const byBrand = {};
    for (const m of seg) {
      const b = byBrand[m.owner] || (byBrand[m.owner] = { owner: m.owner, units: 0, best: 0, models: 0 });
      b.units += m.ref.lastUnits || 0; b.best = Math.max(b.best, m.rating); b.models++;
    }
    const ranking = Object.values(byBrand).sort((a, b) => b.units - a.units || b.best - a.best);
    const pos = ranking.findIndex((x) => x.owner === 'player') + 1;
    return { t, seg, ranking, pos, leader: ranking[0] };
  });
  const open = ui.marketOpen;
  pane.innerHTML = `<h2 class="pane-title">Mercado</h2>
    <p class="pane-sub">Toca un segmento para ver sus modelos. La posición se calcula por ventas del último día.</p>
    <h3 class="sec">Ranking de marcas (ingresos 7 días) · vas ${myPos}º de ${brands.length}</h3>
    <div class="rank">${brands.map((b, i) => `<div class="rank-row ${b.id === 'player' ? 'mine' : ''}">
      <span class="rank-pos">${i + 1}</span>
      <span><span class="dot" style="background:${b.color}"></span><b>${esc(b.name)}</b> <small class="seg-meta">${esc(b.tag)} · ${nf0.format(Math.round(b.followers))} seguidores · ${b.models} modelo${b.models === 1 ? '' : 's'}</small><div class="bar"><span style="width:${(b.revenue / maxRev) * 100}%;background:${b.color}"></span></div></span>
      <span class="num"><b>${eur(b.revenue)}</b></span></div>`).join('')}</div>
    <h3 class="sec">Segmentos</h3>
    <div class="seg-grid">${segInfo.map(({ t, seg, ranking, pos, leader }) => {
      const isOpen = open === t.id;
      const posTxt = pos ? `${pos}º de ${ranking.length}` : 'Sin presencia';
      const cls = pos === 1 ? 'lead' : pos ? 'in' : 'out';
      return `<div class="seg-card ${cls} ${isOpen ? 'open' : ''}">
        <button class="seg-head" data-seg="${t.id}" aria-expanded="${isOpen}">
          <span class="seg-ic">${typeIcon(t.id)}</span>
          <span class="seg-txt"><b>${t.name}</b><small>${seg.length} modelo${seg.length === 1 ? '' : 's'} · ${ranking.length} marca${ranking.length === 1 ? '' : 's'}</small></span>
          <span class="seg-pos"><small>Tu posición</small><b>${posTxt}</b></span>
          <span class="ci-chev" aria-hidden="true">▾</span>
        </button>
        ${isOpen ? `<div class="seg-body">
          <div class="seg-meta" style="margin-bottom:8px">Demanda base ≈ ${nf1.format(t.demand)} compradores/día · precios ${t.priceRange}${leader ? ` · líder: <b style="color:${colorOf(leader.owner)}">${esc(brandOf(leader.owner))}</b>` : ''}</div>
          ${seg.length ? `<table class="mk"><thead><tr><th>Modelo</th><th class="r">Punt.</th><th class="r">CV</th><th class="r">Precio</th><th class="r">Ayer</th></tr></thead><tbody>
          ${seg.sort((a, b) => (b.ref.lastUnits || 0) - (a.ref.lastUnits || 0) || b.rating - a.rating).map((m) => `<tr class="${m.owner === 'player' ? 'mine' : ''}"><td><span class="dot" style="background:${colorOf(m.owner)}"></span>${esc(m.name)}<div class="ci-sub" style="font-size:12px">${esc(brandOf(m.owner))} · ${m.age} días</div></td>
            <td class="r" style="color:${ratingColor(m.rating)}"><b>${m.rating}</b></td><td class="r">${nf0.format(stats(m.ref).hp)}</td><td class="r">${eur(m.price)}</td><td class="r">${m.ref.lastUnits ?? '–'}</td></tr>`).join('')}
          </tbody></table>` : '<div class="empty">Nadie vende en este segmento todavía. Oportunidad.</div>'}
        </div>` : ''}
      </div>`;
    }).join('')}</div>`;
  pane.querySelectorAll('[data-seg]').forEach((b) => (b.onclick = () => {
    ui.marketOpen = ui.marketOpen === b.dataset.seg ? null : b.dataset.seg;
    renderMercado();
    if (ui.marketOpen) requestAnimationFrame(() => pane.querySelector(`.seg-card.open`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }));
}

// ---------- Comunidad: solicitudes y contratos ----------
function renderComunidad() {
  const pane = $('#pane-comunidad');
  const openReqs = state.requests.filter((r) => r.status === 'open');
  const c = state.activeContract;
  const offers = state.contractOffers || [];
  const typeOf = (id) => byId.type[id] ? byId.type[id].name : id;
  pane.innerHTML = `<h2 class="pane-title">Comunidad</h2>
    <p class="pane-sub">Tus seguidores piden coches concretos y las empresas encargan flotas. Cumplir suma seguidores, prestigio y dinero; ignorarlo tiene coste moderado.</p>
    <div class="stat-grid">
      <div class="stat"><div class="stat-l">Seguidores</div><div class="stat-v">${nf0.format(state.followers || 0)}</div></div>
      <div class="stat"><div class="stat-l">Prestigio</div><div class="stat-v">${nf0.format(state.prestige)}</div></div>
    </div>
    <h3 class="sec">Solicitudes de la comunidad</h3>
    ${openReqs.length ? openReqs.map((r) => { const u = requestUrgency(state, r); return `
      <div class="req-card urg-${u.level}">
        <div class="req-top"><span class="req-type">${typeIcon(r.typeId)}<b>${esc(typeOf(r.typeId))}</b></span><span class="req-days">${u.left} día${u.left === 1 ? '' : 's'}</span></div>
        <div class="req-spec">Puntuación mínima <b>${r.minRating}</b></div>
        <div class="ci-sub">${esc(r.text)}</div>
        <div class="req-bar"><span style="width:${Math.round(u.f * 100)}%"></span></div>
        <div class="seg-meta">Vence el día ${r.deadlineDay} · recompensa: ${eur(r.rewardCash)} y +${nf0.format(r.rewardFollowers)} seguidores</div>
      </div>`; }).join('') : '<div class="empty">Sin solicitudes abiertas. Lanza modelos que encajen con lo que pide tu público.</div>'}
    <h3 class="sec">Contratos</h3>
    ${c ? `
      <div class="req-card">
        <b>${esc(c.title)}</b>
        <div class="seg-meta">${typeOf(c.typeId)} · puntuación ≥ ${c.minRating} · vence el día ${c.deadlineDay}</div>
        <div class="bar" style="margin:8px 0"><span style="width:${Math.min(100, (c.delivered / c.units) * 100)}%;background:var(--good)"></span></div>
        <div class="seg-meta">${c.carId ? `${c.delivered}/${c.units} unidades entregadas · modelo: ${esc((state.garage.find((x) => x.id === c.carId) || {}).name || '—')}${(state.garage.find((x) => x.id === c.carId) || {}).status === 'prototipo' ? ' (prototipo: lánzalo gratis desde el garaje cuando tengas línea libre)' : ''}` : ui.build && ui.build.mode === 'contract' ? 'Fabricando el coche en la ruleta…' : c.research ? `Fabricación en pausa en la pieza ${REELS[c.research.stage] ? REELS[c.research.stage].label.toLowerCase() : ''}${state.day <= c.research.closedDay ? ' · podrás seguir mañana' : ''}` : 'Todavía no has fabricado el coche.'}</div>
        <div class="actions"><div class="row">
          ${!c.carId && !(ui.build && ui.build.mode === 'contract') ? (c.research ? `<button class="btn btn-primary" id="ctBuildBtn" ${state.day <= c.research.closedDay ? 'disabled' : ''}>Continuar fabricación</button>` : '<button class="btn btn-primary" id="ctBuildBtn">Fabricar en la ruleta</button>') : ''}
          ${!c.carId && ui.build && ui.build.mode === 'contract' ? '<button class="btn btn-primary" id="ctGoBtn">Ir a la ruleta</button>' : ''}
          <button class="btn" id="abandonBtn">Abandonar contrato</button>
        </div></div>
      </div>` : offers.length ? offers.map((o) => `
      <div class="req-card">
        <b>${esc(o.title)}${o.elite ? ' <span style="color:var(--r4)">ÉLITE</span>' : ''}</b>
        <div class="seg-meta">${typeOf(o.typeId)} · ${o.units} uds. · puntuación ≥ ${o.minRating} · plazo ${o.deadlineDays} días</div>
        <div class="seg-meta">Recompensa: ${eur(o.rewardCash)} · +${o.rewardPrestige} prestigio · +${nf0.format(o.rewardFollowers)} seguidores · penalización por fallo: ${eur(o.penalty)}</div>
        <div class="ci-sub">Al aceptar se abre la ruleta con el chasis fijo: tendrás que fabricar el coche cumpliendo la puntuación. Puedes cerrarlo y seguir otro día. El plazo cuenta desde que aceptas.</div>
        <div class="actions"><button class="btn btn-primary" data-assign="${o.id}" ${ui.build ? 'disabled title="Termina la fabricación en curso"' : ''}>Aceptar y fabricar</button></div>
      </div>`).join('') : '<div class="empty">No hay contratos disponibles ahora mismo. Crece en prestigio y mejora la fábrica para atraer mejores ofertas.</div>'}`;
  const ab = $('#abandonBtn');
  if (ab) ab.onclick = () => {
    openModal(`<h2 class="modal-title">¿Abandonar contrato?</h2><p class="modal-sub">Perderás 4 puntos de prestigio. Si ya fabricaste el coche, seguirá siendo tuyo; si estaba a medias, se pierde lo gastado.</p>
      <div class="actions"><div class="row"><button class="btn" id="mCancel">Cancelar</button><button class="btn btn-danger" id="mOk">Abandonar</button></div></div>`, () => {
      $('#mCancel').onclick = closeModal;
      $('#mOk').onclick = () => {
        if (ui.build && ui.build.mode === 'contract') { ui.build = null; show.setBuildGhost(null); }
        abandonContract(state); toast('Contrato abandonado.'); persist(); closeModal(); renderAll();
      };
    });
  };
  const cb = $('#ctBuildBtn');
  if (cb) cb.onclick = () => (c.research ? resumeResearch(c) : startContractBuild(c));
  const cg = $('#ctGoBtn'); if (cg) cg.onclick = () => setTab('ruleta');
  pane.querySelectorAll('[data-assign]').forEach((b) => (b.onclick = () => {
    const res = acceptContract(state, b.dataset.assign);
    toast(res.msg);
    if (res.ok) startContractBuild(state.activeContract);
  }));
}

// ---------- Empresa ----------
function sparkline() {
  const h = state.history.slice(-60);
  if (h.length < 2) return '<div class="empty">La gráfica de caja aparece tras un par de días.</div>';
  const vals = h.map((x) => x.cash);
  const min = Math.min(...vals, 0), max = Math.max(...vals);
  const W = 400, H = 80;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - 6 - ((v - min) / (max - min || 1)) * (H - 12)}`).join(' ');
  const zero = H - 6 - ((0 - min) / (max - min || 1)) * (H - 12);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${zero}" y2="${zero}" stroke="rgba(255,255,255,0.15)" stroke-dasharray="4 4"/><polyline points="${pts}" fill="none" stroke="#ff6a1a" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function tableHTML(head, rows) {
  return `<table class="mk"><thead><tr>${head.map((h, i) => `<th class="${i ? 'r' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'r' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function lastSavedText() {
  const t = lastSaved();
  if (!t) return 'aún no hay guardado automático';
  return new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function renderEmpresa() {
  const pane = $('#pane-empresa');
  const cap = capacity(state);
  const sold = state.garage.reduce((s, c) => s + (c.unitsSold || 0), 0);
  const best = state.garage.slice().sort((a, b) => stats(b).hp - stats(a).hp)[0];
  const upgradesHTML = FACTORY_UPGRADES.map((u) => {
    if (u.perTier) {
      // Investigación de rareza: 10 niveles por rareza; la común se ajusta sola.
      const has = factoryLevel(state, u.requires) >= 1;
      const open = !!ui.oddsOpen;
      const odds = tierOdds(state);
      const total = ODDS_TIERS.reduce((a, t) => a + factoryLevel(state, upgradeKey(u, t)), 0);
      return `<div class="upg-group ${open ? 'open' : ''}">
        <button class="upg-row upg-toggle" id="oddsToggle" aria-expanded="${open}">
          <div><b>${u.name}</b> <span class="seg-meta">${total}/${u.max * ODDS_TIERS.length}</span><div class="ci-sub">${has ? 'Cada rareza se investiga por separado (10 niveles). Afecta a motor, cilindrada y sobrealimentación.' : 'Necesitas el Departamento de I+D para desbloquearla.'}${state.settings && state.settings.classicOdds ? ' <b>Ahora usas el sistema clásico de probabilidades (Ajustes): no tiene efecto.</b>' : ''}</div></div>
          <span class="upg-chev" aria-hidden="true">▾</span>
        </button>
        ${open ? `<div class="upg-sub">
          <div class="upg-subrow"><span class="swatch sm" style="background:${RARITY[1].color}"></span><div class="upg-subinfo"><b>${RARITY[1].name}</b><div class="ci-sub">${nf2.format(odds[1])}% · baja sola al investigar las demás</div></div><span></span></div>
          ${ODDS_TIERS.map((t) => {
            const lv = factoryLevel(state, upgradeKey(u, t));
            const maxed = lv >= u.max;
            return `<div class="upg-subrow">
              <span class="swatch sm" style="background:${RARITY[t].color}"></span>
              <div class="upg-subinfo"><b style="color:${RARITY[t].color}">${RARITY[t].name}</b><div class="ci-sub">${nf2.format(odds[t])}% (de ${nf2.format(RARITY[t].odds)}% a ${nf2.format(RARITY[t].max)}%) · nivel ${lv}/${u.max}</div>
                <div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div></div>
              <button class="btn" data-upg="${u.id}" data-type="${t}" ${maxed || !has ? 'disabled' : ''}>${maxed ? 'Máx.' : eur(upgradeCost(u, lv, t))}</button>
            </div>`;
          }).join('')}</div>` : ''}
      </div>`;
    }
    if (u.perType) {
      // Ampliación de líneas: una mejora independiente por chasis, desplegable.
      const total = CAR_TYPES.reduce((a, t) => a + factoryLevel(state, upgradeKey(u, t.id)), 0);
      const open = !!ui.linesOpen;
      return `<div class="upg-group ${open ? 'open' : ''}">
        <button class="upg-row upg-toggle" id="linesToggle" aria-expanded="${open}">
          <div><b>${u.name}</b> <span class="seg-meta">${total}/${u.max * CAR_TYPES.length} ampliaciones</span><div class="ci-sub">Cada chasis se amplía por separado (hasta ${u.max} veces): +1 línea para vender otro modelo de ese tipo a la vez.</div></div>
          <span class="upg-chev" aria-hidden="true">▾</span>
        </button>
        ${open ? `<div class="upg-sub">${CAR_TYPES.map((t) => {
          const lv = factoryLevel(state, upgradeKey(u, t.id));
          const c = capacity(state, t.id);
          const maxed = lv >= u.max;
          return `<div class="upg-subrow">
            <span class="swatch sm">${typeIcon(t.id)}</span>
            <div class="upg-subinfo"><b>${t.name}</b><div class="ci-sub">${c.slots} línea${c.slots > 1 ? 's' : ''} · ${c.used} en uso · nivel ${lv}/${u.max}</div>
              <div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div></div>
            <button class="btn" data-upg="${u.id}" data-type="${t.id}" ${maxed ? 'disabled' : ''}>${maxed ? 'Máx.' : eur(upgradeCost(u, lv))}</button>
          </div>`;
        }).join('')}</div>` : ''}
      </div>`;
    }
    const lvl = factoryLevel(state, u.id);
    const maxed = lvl >= u.max;
    const cost = upgradeCost(u, lvl);
    return `<div class="upg-row">
      <div><b>${u.name}</b> <span class="seg-meta">nivel ${lvl}/${u.max}</span><div class="ci-sub">${u.desc}</div></div>
      <button class="btn" data-upg="${u.id}" ${maxed ? 'disabled' : ''}>${maxed ? 'Máx.' : eur(cost)}</button>
    </div>`;
  }).join('');
  pane.innerHTML = `<h2 class="pane-title">Empresa</h2>
    <p class="pane-sub">Gastos fijos: ${eur(fixedDaily(state))}/día (mejores instalaciones = más mantenimiento).</p>
    <label class="field"><span>Nombre de la compañía</span><input id="rename" maxlength="28" value="${esc(state.company)}" /></label>
    <div class="stat-grid">
      <div class="stat"><div class="stat-l">Coches montados</div><div class="stat-v">${state.garage.length}</div></div>
      <div class="stat"><div class="stat-l">Unidades vendidas</div><div class="stat-v">${nf0.format(sold)}</div></div>
      <div class="stat"><div class="stat-l">Ingresos totales</div><div class="stat-v">${eur(state.totalRevenue)}</div></div>
      <div class="stat"><div class="stat-l">Más potente</div><div class="stat-v">${best ? nf0.format(stats(best).hp) + ' <small>CV</small>' : '–'}</div></div>
    </div>
    <h3 class="sec">Evolución de la caja</h3>
    ${sparkline()}
    <h3 class="sec">Fábrica · líneas ${cap.used}/${cap.slots}</h3>
    ${upgradesHTML}
    <p class="ci-sub" style="margin-top:14px">Guardar partida, reglas y probabilidades están en Ajustes (icono de engranaje, arriba).</p>`;
  $('#rename').onchange = (e) => { state.company = e.target.value.trim() || state.company; renderTop(); persist(); };
  const lt = $('#linesToggle'); if (lt) lt.onclick = () => { ui.linesOpen = !ui.linesOpen; renderEmpresa(); };
  const ot = $('#oddsToggle'); if (ot) ot.onclick = () => { ui.oddsOpen = !ui.oddsOpen; renderEmpresa(); };
  pane.querySelectorAll('[data-upg]').forEach((b) => (b.onclick = () => {
    const res = buyUpgrade(state, b.dataset.upg, b.dataset.type);
    toast(res.msg + (res.cost ? ` (coste ${eurFull(res.cost)}, caja ${eurFull(res.cash)})` : ''));
    if (res.ok) { show.setFactoryVisuals(state.factory); persist(); }
    renderAll();
  }));
}

// ---------- Ajustes (guardar, reglas, probabilidades) ----------
function oddsTableHTML() {
  const o = tierOdds(state);
  const classic = state.settings && state.settings.classicOdds;
  return tableHTML(['Rareza', 'Inicial', 'Ahora', 'Máx. I+D'], [1, 2, 3, 4, 5, 6].map((t) => [`<span style="color:${rc(t)}">${RARITY[t].name}</span>`, nf2.format(RARITY[t].odds) + '%', classic ? '—' : nf2.format(o[t]) + '%', nf2.format(RARITY[t].max) + '%']));
}
function openSettings() {
  const classic = !!(state.settings && state.settings.classicOdds);
  openModal(`<h2 class="modal-title">Ajustes</h2>
    <h3 class="sec">Sonido</h3>
    <div class="upg-row"><div><b>Efectos de sonido</b><div class="ci-sub">${muted ? 'Desactivados' : 'Activados'}</div></div><button class="btn" id="setMute">${muted ? 'Activar' : 'Silenciar'}</button></div>
    <h3 class="sec">Probabilidades</h3>
    <div class="upg-row"><div><b>Sistema clásico de probabilidades</b><div class="ci-sub">${classic ? 'Activo: cada pieza tiene su propio peso fijo, como en la primera versión. La investigación de rareza no tiene efecto.' : 'Desactivado: primero se sortea la rareza (tabla de abajo) y luego una pieza de esa rareza que quepa en el chasis.'}</div></div>
      <button class="btn ${classic ? 'btn-primary' : ''}" id="setOdds">${classic ? 'Usar el nuevo' : 'Usar el clásico'}</button></div>
    ${oddsTableHTML()}
    <h3 class="sec">Guardar partida</h3>
    <p class="ci-sub" style="margin:0 0 8px">La partida se guarda sola al cerrar cada día y tras cada decisión. Último guardado: ${lastSavedText()}. Usa el código como copia de respaldo para cambiar de navegador.</p>
    <div class="actions" style="margin-top:0"><div class="row">
      <button class="btn" id="saveBtn">Generar código</button>
      <button class="btn" id="loadBtn">Cargar código</button>
    </div></div>
    <label class="field" style="margin-top:8px"><textarea id="saveBox" placeholder="Aquí aparece o se pega el código de partida"></textarea></label>
    <h3 class="sec">Reglas</h3>
    <div class="rules">
      <p><code>CV = fuerza motor × mult. cilindrada × mult. turbo × rendimiento</code>, con tope por chasis: la potencia que excede el tope solo cuenta al 35%.</p>
      <p><code>Índice de aceleración = (tracción × turbo × aero) × CV / 100</code>.</p>
      <p><code>Puntuación</code>: posición del coche entre todos los posibles de su mismo chasis, valorando prestaciones (potencia, aceleración, agarre) y economía (fiabilidad, consumo, coste) según lo que cada segmento aprecia.</p>
      <p>Motor + cilindrada + turbo deben caber en el espacio del chasis: ${CAR_TYPES.map((t) => t.name + ' ' + t.space).join(', ')}.</p>
      <p>Un coche común, barato y fiable puede ser un superventas en su segmento: la rareza da prestigio y potencia, no ventas automáticas.</p>
    </div>
    <details class="tbl"><summary>Motores (${ENGINES.length})</summary>${tableHTML(['Motor', 'Fuerza', 'Esp.', 'Precio', 'Rareza'], ENGINES.map((e) => [e.name, nf2.format(e.power), e.space, '×' + nf2.format(e.price), `<span style="color:${rc(e.tier)}">${RARITY[e.tier].name}</span>`]))}</details>
    <details class="tbl"><summary>Cilindradas (${INTAKES.length})</summary>${tableHTML(['Cil.', 'Mult.', 'Esp.', 'Precio', 'Rareza'], INTAKES.map((e) => [e.name, '×' + nf2.format(e.mult), e.space, '×' + nf2.format(e.price), `<span style="color:${rc(e.tier)}">${RARITY[e.tier].name}</span>`]))}</details>
    <details class="tbl"><summary>Sobrealimentación (${TURBOS.length})</summary>${tableHTML(['Tipo', 'Mult.', 'Acel.', 'Esp.', 'Rareza'], TURBOS.map((e) => [e.name, '×' + nf2.format(e.mult), '×' + nf2.format(e.accel), e.space, `<span style="color:${rc(e.tier)}">${RARITY[e.tier].name}</span>`]))}</details>
    <div class="actions"><div class="row"><button class="btn btn-ghost btn-danger" id="resetBtn">Empezar partida nueva</button><button class="btn btn-primary" id="mCancel">Cerrar</button></div></div>`, () => {
    $('#mCancel').onclick = closeModal;
    $('#setMute').onclick = () => { $('#muteBtn').click(); openSettings(); };
    $('#setOdds').onclick = () => {
      state.settings = { ...(state.settings || {}), classicOdds: !classic };
      persist(); toast(!classic ? 'Sistema clásico de probabilidades activado' : 'Nuevo sistema de probabilidades activado');
      openSettings(); renderAll();
    };
  $('#saveBtn').onclick = () => {
    const code = exportCode(state, ui.build);
    const box = $('#saveBox'); box.value = code; box.select();
    try { navigator.clipboard && navigator.clipboard.writeText(code).then(() => toast('Código copiado'), () => toast('Código generado: cópialo de la caja')); } catch { toast('Código generado: cópialo de la caja'); }
  };
  $('#loadBtn').onclick = () => {
    const res = importCode($('#saveBox').value);
    if (!res.ok) return toast(res.error || 'El código no es válido');
    adoptLoaded(res);
    toast('Partida cargada · día ' + state.day);
  };
  $('#resetBtn').onclick = () => openModal(`<h2 class="modal-title">¿Partida nueva?</h2><p class="modal-sub">Perderás la partida actual y su guardado automático (exporta antes el código si quieres conservarla).</p>
    <div class="actions"><div class="row"><button class="btn" id="mCancel">Cancelar</button><button class="btn btn-primary" id="mOk">Empezar de cero</button></div></div>`, () => {
    $('#mCancel').onclick = closeModal;
    $('#mOk').onclick = () => { resetGame(); closeModal(); setTab('ruleta'); };
  });
  });
}
$('#settingsBtn').onclick = openSettings;

function resetGame() {
  state = newState(state.company);
  ui.selected = null; ui.lastResult = null; ui.build = null; ui.spinGen++;
  show.setBuildGhost(null); show.clearCar(); show.setFactoryVisuals(state.factory);
  clearSave(); persist();
  renderAll();
}

// Adopta una partida cargada (de localStorage o de código) sin duplicar transacciones.
function adoptLoaded(res) {
  state = res.state;
  ui.build = res.build || null;
  ui.selected = null; ui.lastResult = null; ui.spinGen++;
  ui.tab = 'ruleta'; ui.garageFilter = 'prototipo';
  show.setBuildGhost(null);
  const first = state.garage.find((c) => c.status !== 'vendido');
  if (first) show.showCar(first, true); else show.clearCar();
  show.setFactoryVisuals(state.factory);
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'ruleta'));
  document.querySelectorAll('.tabpane').forEach((p) => (p.hidden = p.id !== 'pane-ruleta'));
  renderAll();
  checkBankruptcy();
}

function checkBankruptcy() {
  if (state.cash < -250000) {
    openModal(`<h2 class="modal-title">Quiebra</h2><p class="modal-sub">${esc(state.company)} ha acumulado demasiada deuda. Llegaste al día ${state.day}.</p>
      <div class="actions"><button class="btn btn-primary btn-block" id="mOk">Fundar una nueva compañía</button></div>`, () => {
      $('#mOk').onclick = () => { resetGame(); closeModal(); setTab('ruleta'); };
    });
  }
}

// ---------- Día siguiente ----------
function nextDay() {
  if (ui.spinning) return toast('Espera a que termine la ruleta.');
  if (ui.build && isResearch(ui.build)) closeResearch(true);
  if (ui.build) return toast('Termina o descarta la fabricación en curso antes de avanzar el día.');
  if (ui.reportOpen) return toast('Cierra el informe del día antes de avanzar.');
  const report = simulateDay(state);
  cash();
  const lines = report.lines.sort((a, b) => b.profit - a.profit);
  openModal(`<h2 class="modal-title">Cierre del día ${report.day}</h2>
    <p class="modal-sub">${report.units} unidades vendidas · ingresos ${eur(report.revenue)}</p>
    <div class="big-profit ${report.profit >= 0 ? 'pos' : 'neg'}">${report.profit >= 0 ? '+' : ''}${eurFull(report.profit)}</div>
    ${lines.length ? tableHTML(['Modelo', 'Uds.', 'Beneficio'], lines.map((l) => [esc(l.name), l.units, `<span class="${l.profit >= 0 ? 'pos' : 'neg'}">${eur(l.profit)}</span>`])) : '<div class="empty">No tienes coches a la venta. Lanza un prototipo desde el garaje.</div>'}
    <div class="ci-sub" style="margin-top:8px">Gastos fijos: ${eurFull(report.fixed)}${report.fans ? ` · seguidores +${nf0.format(report.fans)}` : ''}</div>
    ${(report.events || []).length ? `<h3 class="sec">Comunidad y contratos</h3><div class="news">${report.events.map((e) => `<div class="news-item">${esc(e.text)}</div>`).join('')}</div>` : ''}
    ${report.news.length ? `<h3 class="sec">Noticias del sector</h3><div class="news">${report.news.map((n) => `<div class="news-item"><span class="dot" style="background:${n.color}"></span><b>${esc(n.rival)}</b> ${n.version ? 'presenta la nueva versión' : 'lanza el'} ${esc(n.car)} (${byId.type[n.typeId].name}) con ${nf0.format(n.hp)} CV · puntuación <b style="color:${ratingColor(n.rating)}">${n.rating}</b></div>`).join('')}</div>` : ''}
    <div class="actions"><button class="btn btn-primary btn-block" id="mOk">Ver cómo va el mercado →</button></div>`, () => {
    $('#mOk').onclick = () => openMarketReport(report);
  });
  persist(); // guardado automático al cerrar el día
  if (state.cash < -250000) {
    setTimeout(() => checkBankruptcy(), 50);
  }
  renderAll();
}

// Segunda pantalla del cierre: cómo van tus coches en cada segmento.
function openMarketReport(report) {
  const act = allActive(state);
  const brandOf = (o) => (o === 'player' ? state.company : state.rivals[o].name);
  const colorOf = (o) => (o === 'player' ? '#ff6a1a' : state.rivals[o].color);
  const mineSegs = [], otherSegs = [];
  for (const t of CAR_TYPES) {
    const seg = act.filter((x) => x.typeId === t.id).sort((a, b) => (b.ref.lastUnits || 0) - (a.ref.lastUnits || 0) || b.rating - a.rating);
    const total = seg.reduce((a, x) => a + (x.ref.lastUnits || 0), 0);
    const mine = seg.filter((x) => x.owner === 'player');
    const info = { t, seg, total, mine, leader: seg[0] };
    (mine.length ? mineSegs : otherSegs).push(info);
  }
  const share = (u, tot) => (tot ? Math.round((u / tot) * 100) : 0);
  const trend = (x) => {
    const p = x.ref.prevUnits, u = x.ref.lastUnits || 0;
    if (p === null || p === undefined) return '<span class="seg-meta">nuevo</span>';
    const d = u - p;
    return d > 0 ? `<span class="pos">▲ ${d}</span>` : d < 0 ? `<span class="neg">▼ ${-d}</span>` : '<span class="seg-meta">=</span>';
  };
  const segCard = ({ t, seg, total, mine, leader }) => {
    const myUnits = mine.reduce((a, x) => a + (x.ref.lastUnits || 0), 0);
    const pos = seg.findIndex((x) => x.owner === 'player') + 1;
    const top = seg.slice(0, 4);
    return `<div class="mr-card">
      <div class="mr-head"><span class="req-type">${typeIcon(t.id)}<b>${t.name}</b></span><span class="mr-pos ${pos === 1 ? 'pos' : ''}">${pos}º de ${seg.length} · ${share(myUnits, total)}% cuota</span></div>
      <div class="bar" style="margin:6px 0"><span style="width:${share(myUnits, total)}%;background:#ff6a1a"></span></div>
      ${mine.map((x) => `<div class="mr-row mine"><span>${esc(x.name)} <small class="seg-meta">puntuación ${x.rating} · ${eur(x.price)}</small></span><span><b>${x.ref.lastUnits || 0}</b> uds. ${trend(x)}</span></div>`).join('')}
      <div class="mr-sub">Top del segmento: ${top.map((x, i) => `<span><span class="dot" style="background:${colorOf(x.owner)}"></span>${i + 1}. ${esc(x.name)} (${esc(brandOf(x.owner))}) · ${x.ref.lastUnits || 0}</span>`).join('')}</div>
      ${leader && leader.owner !== 'player' ? `<div class="ci-sub">Líder: ${esc(leader.name)} de ${esc(brandOf(leader.owner))} con ${leader.ref.lastUnits || 0} uds. a ${eur(leader.price)} (puntuación ${leader.rating}).</div>` : ''}
    </div>`;
  };
  openModal(`<h2 class="modal-title">Cómo va el mercado · día ${report.day}</h2>
    <p class="modal-sub">Ventas del día por segmento. ▲▼ = cambio respecto al día anterior.</p>
    ${mineSegs.length ? `<div class="mr-list">${mineSegs.map(segCard).join('')}</div>` : '<div class="empty">Todavía no tienes coches a la venta: aquí verás cómo compiten en cada segmento.</div>'}
    ${otherSegs.length ? `<h3 class="sec">Segmentos sin presencia</h3><div class="news">${otherSegs.map(({ t, total, leader }) => `<div class="news-item"><b>${t.name}</b> · ${total} uds./día${leader ? ` · líder ${esc(leader.name)} (${esc(brandOf(leader.owner))}, puntuación ${leader.rating})` : ' · nadie vende aquí'}</div>`).join('')}</div>` : ''}
    <div class="actions"><button class="btn btn-primary btn-block" id="mOk">Empezar el día ${state.day}</button></div>`, () => {
    $('#mOk').onclick = () => { closeModal(); ui.lastResult = null; setTab('ruleta'); notifyNewRequests(report); };
  });
}

// ---------- Render general ----------
function renderTop() {
  $('#companyName').textContent = state.company;
  $('#kDay').textContent = state.day;
  const kc = $('#kCash'); kc.textContent = eur(state.cash); kc.classList.toggle('neg', state.cash < 0);
  $('#kPrestige').textContent = nf0.format(state.prestige);
  $('#kFollowers').textContent = nf0.format(state.followers || 0);
  const cap = capacity(state);
  const ka = $('#kActive'); ka.textContent = `${cap.used}/${cap.slots}`; ka.classList.toggle('neg', cap.free <= 0);
  $('#garageCount').textContent = state.garage.filter((c) => c.status === 'prototipo').length;
  $('#commCount').textContent = state.requests.filter((r) => r.status === 'open').length;
}

function renderCarCard() {
  const card = $('#carCard');
  const c = state.garage.find((x) => x.id === ui.selected);
  if (!c || ui.spinning || c.status === 'vendido') { card.hidden = true; return; }
  const s = stats(c), p = s.p;
  card.hidden = false;
  card.innerHTML = `<div class="cc-top"><div><div class="cc-name">${esc(c.name)}</div><div class="cc-sub">${p.type.name} · ${p.engine.name} ${p.intake.name} · ${p.turbo.name}</div></div>${ratingBadge(s.rating)}</div>
    <div class="cc-stats">
      <div class="stat"><div class="stat-l">Potencia</div><div class="stat-v">${nf0.format(s.hp)}<small> CV</small></div></div>
      <div class="stat"><div class="stat-l">0–100</div><div class="stat-v">${nf1.format(s.t0100)}<small> s</small></div></div>
      <div class="stat"><div class="stat-l">Punta</div><div class="stat-v">${nf0.format(s.vmax)}<small> km/h</small></div></div>
    </div>
    <div class="cc-hint">Arrastra para girar la cámara · rueda para acercar</div>`;
}

function renderAll() {
  renderTop();
  if (ui.tab === 'ruleta' && !ui.spinning) renderRuleta();
  if (ui.tab === 'garaje') renderGaraje();
  if (ui.tab === 'mercado') renderMercado();
  if (ui.tab === 'comunidad') renderComunidad();
  if (ui.tab === 'empresa') renderEmpresa();
  renderCarCard();
  renderReminder();
}

function setTab(t) {
  if (ui.spinning && t !== 'ruleta') return toast('Espera a que termine la ruleta');
  ui.tab = t;
  $('#panel').dataset.tab = t;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.tabpane').forEach((p) => (p.hidden = p.id !== 'pane-' + t));
  renderAll();
  const c = state.garage.find((x) => x.id === ui.selected);
  if (t === 'garaje' && c && (!show.car || show._shown !== c.id)) { show.showCar(c, true); show._shown = c.id; }
}

function openModal(html, bind) {
  $('#modalCard').innerHTML = html; $('#modal').hidden = false; ui.reportOpen = true; bind && bind();
}
function closeModal() { $('#modal').hidden = true; ui.reportOpen = false; }

// ---------- Solicitudes: recordatorio y notificaciones ----------
function openRequests() { return (state.requests || []).filter((r) => r.status === 'open'); }
const URG_TXT = { ok: 'Tiempo de sobra', warn: 'Se acerca el plazo', hot: 'Poco tiempo', crit: '¡Casi sin tiempo!' };

// Caja fija a la izquierda mientras montas un coche: qué pide la comunidad.
function renderReminder() {
  const box = $('#reqReminder'); if (!box) return;
  const reqs = openRequests();
  if (!ui.build || !reqs.length) { box.hidden = true; return; }
  const chosen = ui.build.picks && ui.build.picks.type ? ui.build.picks.type.id : null;
  box.hidden = false;
  box.innerHTML = `<div class="rr-head"><span class="rr-dot"></span>La comunidad pide</div>
    ${reqs.map((r) => {
      const u = requestUrgency(state, r);
      const t = byId.type[r.typeId];
      const match = chosen && chosen === r.typeId;
      const off = chosen && chosen !== r.typeId;
      return `<div class="rr-item urg-${u.level} ${match ? 'match' : ''} ${off ? 'off' : ''}">
        <div class="rr-row"><span class="rr-ic">${typeIcon(r.typeId)}</span><b>${t.name}</b><span class="rr-days">${u.left} d</span></div>
        <div class="rr-spec">Puntuación ≥ <b>${r.minRating}</b></div>
        <div class="rr-rew">${eur(r.rewardCash)} · +${nf0.format(r.rewardFollowers)} seguidores</div>
        ${match ? '<div class="rr-flag">Este chasis encaja con la solicitud</div>' : ''}
      </div>`;
    }).join('')}`;
}

// Tras terminar un coche: ¿cumple alguna solicitud si lo lanzas?
function reqMatchHTML(car) {
  const reqs = openRequests().filter((r) => r.typeId === car.typeId);
  if (!reqs.length) return '';
  const mr = marketRating(car);
  return reqs.map((r) => mr >= r.minRating
    ? `<div class="reason pos" style="margin-top:10px">▲ Cumple la solicitud de la comunidad (${byId.type[r.typeId].name}, puntuación ≥ ${r.minRating}). Lánzalo al mercado para cobrar la recompensa.</div>`
    : `<div class="reason neg" style="margin-top:10px">▼ Es el chasis que pide la comunidad, pero le falta puntuación (${mr} de ${r.minRating}).</div>`).join('');
}

// Notificación destacada al llegar solicitudes nuevas.
function notify(title, body, level = 'ok', onClick) {
  const wrap = $('#notifs'); if (!wrap) return;
  const n = document.createElement('div');
  n.className = 'notif urg-' + level;
  n.innerHTML = `<div class="notif-title">${esc(title)}</div><div class="notif-body">${body}</div><div class="notif-hint">Toca para verla en Comunidad</div>`;
  n.onclick = () => { n.remove(); onClick && onClick(); };
  wrap.appendChild(n);
  sfx(660, 0.12, 'triangle', 0.08); setTimeout(() => sfx(990, 0.18, 'triangle', 0.07), 110);
  setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 400); }, 7000);
}
function notifyNewRequests(report) {
  const news = (report.events || []).filter((e) => e.type === 'requestNew');
  news.forEach((e, i) => {
    const r = state.requests.find((x) => x.id === e.requestId); if (!r) return;
    const t = byId.type[r.typeId];
    setTimeout(() => notify('Nueva solicitud de la comunidad',
      `${typeIcon(r.typeId)}<span><b>${t.name}</b> · puntuación ≥ <b>${r.minRating}</b><br>Plazo ${r.totalDays} días · ${eur(r.rewardCash)} y +${nf0.format(r.rewardFollowers)} seguidores</span>`,
      'ok', () => setTab('comunidad')), 300 + i * 400);
  });
}

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// Seguimiento del coche mostrado (para no reconstruirlo sin necesidad)
const _showCar = show.showCar.bind(show);
show.showCar = (car, anim) => { show._shown = car && car.id; _showCar(car, anim); };

// ---------- Eventos ----------

document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
$('#nextDayBtn').onclick = nextDay;
$('#muteBtn').onclick = () => { muted = !muted; $('#muteWave').style.opacity = muted ? 0.15 : 1; };

const modal = $('#modalCard');

// Partida guardada: ofrecer continuar antes que nada (no sobrescribir sin querer).
const savedGame = loadGame();
if (savedGame && savedGame.ok) {
  const btn = $('#continueBtn');
  btn.hidden = false;
  btn.textContent = `Continuar partida guardada · día ${savedGame.state.day}`;
  btn.onclick = () => {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch {}
    $('#intro').hidden = true;
    adoptLoaded(savedGame);
  };
}

$('#startBtn').onclick = () => {
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch {}
  const name = $('#companyInput').value.trim();
  const begin = () => {
    state = newState(name || 'Ameztoy Motors');
    ui.selected = null; ui.lastResult = null; ui.build = null; ui.spinGen++;
    $('#intro').hidden = true;
    show.clearCar();
    show.setFactoryVisuals(state.factory);
    persist();
    renderAll();
    sfx(440, 0.1, 'triangle', 0.08); setTimeout(() => sfx(660, 0.16, 'triangle', 0.08), 90);
  };
  if (savedGame && savedGame.ok) {
    openModal(`<h2 class="modal-title">¿Empezar de cero?</h2><p class="modal-sub">Tienes una partida guardada (día ${savedGame.state.day}). Al abrir una fábrica nueva la sobrescribirás.</p>
      <div class="actions"><div class="row"><button class="btn" id="mCancel">Cancelar</button><button class="btn btn-primary" id="mOk">Empezar de cero</button></div></div>`, () => {
      $('#mCancel').onclick = closeModal;
      $('#mOk').onclick = () => { closeModal(); begin(); };
    });
  } else begin();
};
$('#companyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#startBtn').click(); });
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '`') { debugOn = !debugOn; dbg.hidden = !debugOn; }
  if (e.key === ' ' && ui.tab === 'ruleta' && $('#intro').hidden && !ui.reportOpen) { e.preventDefault(); $('#spinBtn') && !$('#spinBtn').disabled && $('#spinBtn').click(); }
});

// Encuadre: desplaza la cámara para que el coche quede centrado en el hueco libre
function updateFraming() {
  const wide = window.innerWidth > 820;
  if (wide) {
    const panelW = $('#panel').offsetWidth + 24;
    show.setFocusOffset(panelW / 2);
  } else {
    show.camera.clearViewOffset(); show.camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', () => { show.resize(); updateFraming(); });

// ---------- Bucle ----------
let last = performance.now(), frames = 0, fpsT = last, fps = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  show.update(dt); show.render();
  frames++;
  if (debugOn && now - fpsT > 500) {
    fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now;
    const i = show.renderer.info;
    dbg.textContent = `FPS ${fps.toFixed(0)} · draw ${i.render.calls} · tri ${i.render.triangles} · geo ${i.memory.geometries}`;
  }
  requestAnimationFrame(loop);
}
show.resize(); updateFraming();
show.setFactoryVisuals(state.factory);
renderAll();
// coche de muestra en la pantalla de inicio
{ const demo = { ...rollBuild(), typeId: 'bolido', engineId: 'e13', intakeId: 'i12', turboId: 't2', tractionId: 'AWD', aeroId: 'a75', perf: 112, color: '#d6402b' }; show.showCar(demo); show._shown = null; }
requestAnimationFrame(loop);

// Ganchos de prueba
window.advanceTime = (ms) => { const n = Math.max(1, Math.round(ms / 16.67)); for (let i = 0; i < n; i++) show.update(1 / 60); show.render(); };
window.render_game_to_text = () => JSON.stringify({
  day: state.day, cash: Math.round(state.cash), prestige: +state.prestige.toFixed(1), followers: state.followers || 0,
  tab: ui.tab, spinning: ui.spinning, spinCost: spinCost(state), selected: ui.selected,
  capacity: capacity(state),
  garage: state.garage.slice(0, 8).map((c) => { const s = stats(c); return { id: c.id, name: c.name, type: c.typeId, status: c.status, hp: s.hp, rating: s.rating, price: c.price }; }),
  shownCar: show._shown || null,
});
window.__game = { get state() { return state; }, ui, show };
