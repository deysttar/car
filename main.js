import { Showroom } from './car3d.js';
import {
  rollBuild, rollStage, buildFromPicks, rerollCost, stats, parts, byId, ratingLabel, rarityOf, newState, simulateDay, estimateDaily,
  allActive, spinCost, modelName, FIXED_DAILY, PER_MODEL_DAILY,
} from './sim.js';
import { RARITY, ENGINES, INTAKES, TURBOS, TRACTIONS, AEROS, CAR_TYPES, PERF_MIN, PERF_MAX } from './data.js';

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
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rc = (tier) => RARITY[tier].color;
const ratingColor = (r) => (r >= 95 ? RARITY[4].color : r >= 80 ? RARITY[3].color : r >= 50 ? RARITY[2].color : RARITY[1].color);
const TYPE_ICON = {
  turismo: '<svg viewBox="0 0 32 32" fill="none" stroke="#141210" stroke-width="2.4" stroke-linejoin="round"><path d="M3 21h26v-4l-4-1-4-5H11l-4 5-4 1z"/><circle cx="9" cy="22" r="2.6" fill="#141210"/><circle cx="23" cy="22" r="2.6" fill="#141210"/></svg>',
  pickup: '<svg viewBox="0 0 32 32" fill="none" stroke="#141210" stroke-width="2.4" stroke-linejoin="round"><path d="M2 21h28v-5l-3-1-2-5h-8v6H2z"/><circle cx="8" cy="22" r="3" fill="#141210"/><circle cx="24" cy="22" r="3" fill="#141210"/></svg>',
  bolido: '<svg viewBox="0 0 32 32" fill="none" stroke="#141210" stroke-width="2.4" stroke-linejoin="round"><path d="M2 21h28l-2-3-9-3-5 1-8 1-3-3v3z"/><circle cx="9" cy="22" r="2.4" fill="#141210"/><circle cx="24" cy="22" r="2.4" fill="#141210"/></svg>',
};

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
const reveal = (tier) => { const base = [0, 520, 620, 740, 880][tier]; sfx(base, 0.14, 'triangle', 0.09); if (tier >= 3) setTimeout(() => sfx(base * 1.5, 0.2, 'triangle', 0.08), 90); if (tier >= 4) setTimeout(() => sfx(base * 2, 0.35, 'triangle', 0.07), 200); };
const cash = () => { sfx(1320, 0.07, 'square', 0.04); setTimeout(() => sfx(1760, 0.12, 'square', 0.04), 70); };
const thud = () => sfx(160, 0.25, 'sine', 0.2, -100);
const engineRev = () => { sfx(90, 0.6, 'sawtooth', 0.05, 160); };

// ---------- Estado ----------
let state = newState('Ameztoy Motors');
let ui = { tab: 'ruleta', selected: null, spinning: false, lastResult: null, launchPrice: {}, reportOpen: false, build: null };

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
const ICON_ALIAS = { utilitario: 'turismo', furgoneta: 'pickup', suv: 'pickup', coupe: 'turismo', deportivo: 'bolido' };
const typeIcon = (id) => TYPE_ICON[id] || TYPE_ICON[ICON_ALIAS[id]];
const perfTier = (v) => (v >= 122 ? 4 : v >= 108 ? 3 : v >= 90 ? 2 : 1);

function renderRuleta() {
  const pane = $('#pane-ruleta');
  const b = ui.build;
  const cost = spinCost(state);
  const res = ui.lastResult;
  const cur = b ? REELS[Math.min(b.stage, REELS.length - 1)] : null;
  const sub = !b
    ? (cost === 0 ? 'Tienes un coche gratis hoy. Se monta pieza a pieza: en cada una te quedas con la tirada o la repites pagando.' : 'Ya has montado tu coche gratis hoy. Puedes montar otro pagando o pasar al día siguiente.')
    : `Pieza ${b.stage + 1} de ${REELS.length}: ${cur.label}.`;
  pane.innerHTML = `
    <h2 class="pane-title">Tirada del día ${state.day}</h2>
    <p class="pane-sub">${sub}</p>
    <div class="reels" id="reels">
      ${REELS.map((r) => `
        <div class="reel-row">
          <span class="reel-label">${r.label}</span>
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
    area.innerHTML = `<button class="btn btn-primary btn-block spin-btn" id="spinBtn" ${cost > 0 && state.cash < cost ? 'disabled' : ''}>${cost === 0 ? 'Montar coche · girar chasis' : 'Coche extra · ' + eur(cost)}</button>
      <div class="spin-note">${cost === 0 ? 'Probabilidades: común 50 · poco común 28 · raro 15 · legendario 7' : 'Los coches extra duplican su precio cada vez. Mañana vuelve a haber uno gratis.'}</div>`;
    $('#spinBtn').onclick = startBuild;
    return;
  }
  const r = REELS[b.stage];
  if (b.phase === 'ready') {
    area.innerHTML = `<button class="btn btn-primary btn-block spin-btn" id="spinBtn">Girar ${r.label.toLowerCase()}</button>`;
    $('#spinBtn').onclick = spinStage;
    return;
  }
  const val = b.picks[r.key], rcost = rerollCost(r.key, b.rerolls[r.key] || 0);
  const last = b.stage === REELS.length - 1;
  area.innerHTML = `<button class="btn btn-primary btn-block spin-btn" id="keepBtn">${last ? 'Terminar con ' : 'Quedarme con '}${esc(r.fmt(val)[0])}</button>
    <button class="btn btn-block" id="rerollBtn" ${state.cash < rcost ? 'disabled' : ''}>Repetir ${r.label.toLowerCase()} · ${eur(rcost)}</button>
    <div class="spin-note">Cada repetición de esta pieza cuesta el doble. No se puede volver atrás a piezas ya elegidas.</div>`;
  $('#keepBtn').onclick = keepStage;
  $('#rerollBtn').onclick = rerollStage;
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
  if (cost > 0 && state.cash < cost) return toast('No tienes caja suficiente para un coche extra.');
  state.cash -= cost;
  state.spinsToday += 1;
  ui.build = { stage: 0, phase: 'ready', picks: {}, rerolls: {} };
  ui.lastResult = null;
  $('#carCard').hidden = true;
  renderTop();
  spinStage();
}

// Tira solo la pieza actual (o la repite).
async function spinStage() {
  const b = ui.build;
  if (!b || ui.spinning) return;
  const r = REELS[b.stage];
  delete b.picks[r.key];
  const val = rollStage(r.key, b.picks);
  ui.spinning = true; b.phase = 'spinning';
  if (r.key === 'type') show.setBuildGhost(null);
  renderRuleta(); renderTop();
  $('#carCard').hidden = true;
  show.setSpinning(true);
  engineRev();
  await spinReel(r, val, window.__fastSpin ? 30 : 800);
  b.picks[r.key] = val; b.phase = 'decide';
  ui.spinning = false;
  show.setSpinning(false);
  if (r.key === 'type') show.setBuildGhost(val.id);
  reveal(r.key === 'perf' ? perfTier(val) : val.tier);
  renderRuleta();
}

function keepStage() {
  const b = ui.build;
  if (!b || b.phase !== 'decide' || ui.spinning) return;
  b.stage += 1; b.phase = 'ready';
  if (b.stage >= REELS.length) return finishBuild();
  renderRuleta();
}

function rerollStage() {
  const b = ui.build;
  if (!b || b.phase !== 'decide' || ui.spinning) return;
  const key = REELS[b.stage].key, cost = rerollCost(key, b.rerolls[key] || 0);
  if (state.cash < cost) return toast('No tienes caja suficiente para repetir esta pieza.');
  state.cash -= cost; b.rerolls[key] = (b.rerolls[key] || 0) + 1;
  cash();
  spinStage();
}

function finishBuild() {
  const b = ui.build;
  const car = { ...buildFromPicks(b.picks), id: 'c' + state.nextCarNo++, name: modelName(), status: 'prototipo', createdDay: state.day, unitsSold: 0, revenue: 0, profit: 0 };
  state.garage.unshift(car);
  ui.build = null; ui.lastResult = car; ui.selected = car.id;
  show.setBuildGhost(null); show.setSpinning(false);
  show.showCar(car, true);
  setTimeout(thud, 260);
  renderAll();
  const s = stats(car);
  if (s.overallTier >= 4) toast('¡Leyenda! Has montado un coche de puntuación ' + s.rating);
}

function renderResult(car) {
  const s = stats(car), p = s.p;
  const box = $('#resultBox'); if (!box) return;
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
        <b>${nf2.format(s.mult)}</b> × rendimiento <b>${car.perf}</b> = <b class="hp">${nf0.format(s.hp)} CV</b><br>
        Aceleración (${p.traction.accel} × ${nf2.format(p.turbo.accel)} × ${nf2.format(p.aero.accel)}) × CV / 100 = <b>${nf1.format(s.accelIndex)}</b>
      </div>
      <div class="actions"><div class="row">
        <button class="btn" id="goGarage">Ver en el garaje</button>
      </div></div>
    </div>`;
  $('#goGarage').onclick = () => setTab('garaje');
}

function ratingBadge(r) {
  const c = ratingColor(r);
  return `<div class="rating" style="color:${c}"><b>${r}</b><small>${ratingLabel(r)}</small></div>`;
}

// ---------- Garaje ----------
function renderGaraje() {
  const pane = $('#pane-garaje');
  const cars = state.garage.filter((c) => c.status !== 'vendido');
  if (!cars.length) {
    pane.innerHTML = `<h2 class="pane-title">Garaje</h2><p class="pane-sub">Aquí aparecen los prototipos que monta la ruleta.</p>
      <div class="empty"><b>Todavía no hay coches</b>Gira la ruleta para montar tu primer prototipo.</div>
      <div class="actions"><button class="btn btn-primary" id="toSpin">Ir a la ruleta</button></div>`;
    $('#toSpin').onclick = () => setTab('ruleta');
    return;
  }
  const sel = state.garage.find((c) => c.id === ui.selected) || cars[0];
  ui.selected = sel.id;
  pane.innerHTML = `<h2 class="pane-title">Garaje</h2>
    <p class="pane-sub">${cars.filter((c) => c.status === 'prototipo').length} prototipos · ${cars.filter((c) => c.status === 'mercado').length} en venta</p>
    <div class="car-list">${cars.map((c) => carItem(c, c.id === sel.id)).join('')}</div>
    <div id="detail"></div>`;
  pane.querySelectorAll('.car-item').forEach((b) => (b.onclick = () => { ui.selected = b.dataset.id; selectCar(b.dataset.id); }));
  renderDetail(sel);
}

function carItem(c, selected) {
  const s = stats(c), p = s.p;
  const label = { prototipo: 'Prototipo', mercado: 'En venta', retirado: 'Retirado', vendido: 'Vendido' }[c.status];
  return `<button class="car-item ${selected ? 'sel' : ''}" data-id="${c.id}">
    <span class="swatch" style="background:${c.color}">${typeIcon(p.type.id)}</span>
    <span><div class="ci-name">${esc(c.name)}</div><div class="ci-sub">${p.type.name} · ${p.engine.name} · día ${c.createdDay}</div></span>
    <span class="ci-right"><div class="ci-hp" style="color:${ratingColor(s.rating)}">${nf0.format(s.hp)} CV</div><span class="status ${c.status}">${label}</span></span>
  </button>`;
}

function partRow(label, part, extra = '') {
  return `<div class="part"><span>${label}</span><span style="color:${rc(part.tier)}">${esc(part.name)}${extra}</span></div>`;
}

function renderDetail(c) {
  const s = stats(c), p = s.p;
  const el = $('#detail'); if (!el) return;
  const minP = Math.round(s.unitCost * 0.9), maxP = Math.round(s.value * 1.8);
  let price = ui.launchPrice[c.id] ?? c.price ?? Math.round(s.value);
  price = Math.min(maxP, Math.max(minP, price));
  const est = estimateDaily(state, c, price);
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
        <button class="btn btn-primary btn-block" id="launchBtn" ${state.cash < s.launchCost ? 'disabled' : ''}>Lanzar · desarrollo ${eur(s.launchCost)}</button>
        <button class="btn btn-block" id="sellBtn">Vender prototipo a coleccionista · ${eur(s.collector)}</button>
        ${state.cash < s.launchCost ? '<div class="spin-note">No tienes caja para el desarrollo. Vende otros prototipos o espera ventas.</div>' : ''}
      </div>` : c.status === 'mercado' ? `
      <h3 class="sec">En el mercado desde el día ${c.launchedDay}</h3>
      <div class="estimate">
        <div class="stat"><div class="stat-l">Unidades vendidas</div><div class="stat-v">${nf0.format(c.unitsSold || 0)}</div></div>
        <div class="stat"><div class="stat-l">Beneficio bruto</div><div class="stat-v ${(c.profit || 0) >= 0 ? 'pos' : 'neg'}">${eur(c.profit || 0)}</div></div>
      </div>
      <div class="slider-row">
        <label><span>Ajustar precio</span><b id="priceVal">${eurFull(price)}</b></label>
        <input type="range" id="priceRange" min="${minP}" max="${maxP}" step="${Math.max(100, Math.round(s.value / 200 / 100) * 100)}" value="${price}" />
      </div>
      <div class="estimate">
        <div class="stat"><div class="stat-l">Ventas estimadas</div><div class="stat-v" id="estU">${nf1.format(est.units)} <small>/día</small></div></div>
        <div class="stat"><div class="stat-l">Beneficio estimado</div><div class="stat-v" id="estP">${eur(est.profit - PER_MODEL_DAILY)} <small>/día</small></div></div>
      </div>
      <div class="actions"><div class="row">
        <button class="btn" id="applyPrice">Aplicar precio</button>
        <button class="btn btn-danger" id="retireBtn">Retirar del mercado</button>
      </div></div>` : `
      <h3 class="sec">Retirado</h3>
      <p class="ci-sub">Vendió ${nf0.format(c.unitsSold || 0)} unidades con ${eur(c.profit || 0)} de beneficio bruto.</p>`;

  el.innerHTML = `<div class="detail">
    <div class="result-head">
      <div><div class="result-name">${esc(c.name)}</div><div class="ci-sub">${p.type.name} · montado el día ${c.createdDay}</div></div>
      ${ratingBadge(s.rating)}
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="stat-l">Potencia</div><div class="stat-v">${nf0.format(s.hp)} <small>CV</small></div></div>
      <div class="stat"><div class="stat-l">0–100 km/h</div><div class="stat-v">${nf1.format(s.t0100)} <small>s</small></div></div>
      <div class="stat"><div class="stat-l">Velocidad punta</div><div class="stat-v">${nf0.format(s.vmax)} <small>km/h</small></div></div>
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
  if (ap) ap.onclick = () => { c.price = +$('#priceRange').value; toast('Nuevo precio: ' + eurFull(c.price)); renderAll(); };
  const rb = $('#retireBtn');
  if (rb) rb.onclick = () => { c.status = 'retirado'; toast(c.name + ' retirado del mercado'); renderAll(); };
}

function launch(c, price) {
  const s = stats(c);
  if (state.cash < s.launchCost) return toast('No tienes caja suficiente.');
  state.cash -= s.launchCost;
  c.status = 'mercado'; c.price = price; c.launchedDay = state.day;
  state.prestige = Math.max(0, state.prestige + (s.rating - 50) / 8);
  cash();
  toast(`${c.name} sale al mercado a ${eurFull(price)}`);
  renderAll();
}
function sellPrototype(c) {
  const s = stats(c);
  state.cash += s.collector;
  c.status = 'vendido';
  cash();
  toast(`Vendido a un coleccionista por ${eurFull(s.collector)}`);
  const next = state.garage.find((x) => x.status !== 'vendido');
  ui.selected = next ? next.id : null;
  if (next) show.showCar(next); else { show.clearCar(); }
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
  const brands = [{ id: 'player', name: state.company, color: '#ff6a1a', revenue: state.totalRevenue }, ...Object.values(state.rivals).map((r) => ({ id: r.id, name: r.name, color: r.color, revenue: r.revenue }))].sort((a, b) => b.revenue - a.revenue);
  const maxRev = Math.max(1, ...brands.map((b) => b.revenue));
  const colorOf = (o) => (o === 'player' ? '#ff6a1a' : state.rivals[o].color);
  const brandOf = (o) => (o === 'player' ? state.company : state.rivals[o].name);
  pane.innerHTML = `<h2 class="pane-title">Mercado</h2>
    <p class="pane-sub">Cada segmento reparte sus compradores entre los modelos según puntuación, precio, novedad y prestigio de marca.</p>
    <h3 class="sec">Ranking de marcas · ingresos totales</h3>
    <div class="rank">${brands.map((b, i) => `<div class="rank-row ${b.id === 'player' ? 'mine' : ''}">
      <span class="rank-pos">${i + 1}</span>
      <span><span class="dot" style="background:${b.color}"></span><b>${esc(b.name)}</b><div class="bar"><span style="width:${(b.revenue / maxRev) * 100}%;background:${b.color}"></span></div></span>
      <span class="num"><b>${eur(b.revenue)}</b></span></div>`).join('')}</div>
    ${CAR_TYPES.map((t) => {
      const seg = act.filter((m) => m.typeId === t.id).sort((a, b) => b.rating - a.rating);
      return `<div class="seg"><h3 class="sec">${t.name}</h3>
        <div class="seg-meta" style="margin-bottom:6px">Demanda base ≈ ${nf1.format(t.demand)} compradores/día · precios ${t.priceRange}</div>
        ${seg.length ? `<table class="mk"><thead><tr><th>Modelo</th><th class="r">Punt.</th><th class="r">CV</th><th class="r">Precio</th><th class="r">Ayer</th></tr></thead><tbody>
        ${seg.map((m) => `<tr class="${m.owner === 'player' ? 'mine' : ''}"><td><span class="dot" style="background:${colorOf(m.owner)}"></span>${esc(m.name)}<div class="ci-sub" style="font-size:12px">${esc(brandOf(m.owner))} · ${m.age} días</div></td>
          <td class="r" style="color:${ratingColor(m.rating)}"><b>${m.rating}</b></td><td class="r">${nf0.format(stats(m.ref).hp)}</td><td class="r">${eur(m.price)}</td><td class="r">${m.ref.lastUnits ?? '–'}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Nadie vende en este segmento todavía. Oportunidad.</div>'}
      </div>`;
    }).join('')}`;
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

function renderEmpresa() {
  const pane = $('#pane-empresa');
  const sold = state.garage.reduce((s, c) => s + (c.unitsSold || 0), 0);
  const best = state.garage.slice().sort((a, b) => stats(b).hp - stats(a).hp)[0];
  pane.innerHTML = `<h2 class="pane-title">Empresa</h2>
    <p class="pane-sub">Gastos fijos: ${eur(FIXED_DAILY)}/día + ${eur(PER_MODEL_DAILY)} por modelo en venta.</p>
    <label class="field"><span>Nombre de la compañía</span><input id="rename" maxlength="28" value="${esc(state.company)}" /></label>
    <div class="stat-grid">
      <div class="stat"><div class="stat-l">Coches montados</div><div class="stat-v">${state.garage.length}</div></div>
      <div class="stat"><div class="stat-l">Unidades vendidas</div><div class="stat-v">${nf0.format(sold)}</div></div>
      <div class="stat"><div class="stat-l">Ingresos totales</div><div class="stat-v">${eur(state.totalRevenue)}</div></div>
      <div class="stat"><div class="stat-l">Más potente</div><div class="stat-v">${best ? nf0.format(stats(best).hp) + ' <small>CV</small>' : '–'}</div></div>
    </div>
    <h3 class="sec">Evolución de la caja</h3>
    ${sparkline()}
    <h3 class="sec">Guardar partida</h3>
    <p class="ci-sub" style="margin:0 0 8px">El juego no guarda solo. Copia este código para continuar otro día y pégalo en "Cargar".</p>
    <div class="actions" style="margin-top:0"><div class="row">
      <button class="btn" id="saveBtn">Generar código</button>
      <button class="btn" id="loadBtn">Cargar código</button>
    </div></div>
    <label class="field" style="margin-top:8px"><textarea id="saveBox" placeholder="Aquí aparece o se pega el código de partida"></textarea></label>
    <h3 class="sec">Reglas (de tu Excel)</h3>
    <div class="rules">
      <p><code>CV = fuerza motor × mult. cilindrada × mult. turbo × rendimiento</code>. El rendimiento sale entre ${PERF_MIN} y ${PERF_MAX}.</p>
      <p><code>Índice de aceleración = (tracción × turbo × aero) × CV / 100</code>.</p>
      <p><code>Agarre = tracción × aero × agarre/peso del chasis</code>.</p>
      <p>Motor + cilindrada + turbo deben caber en el espacio del chasis: ${CAR_TYPES.map((t) => t.name + ' ' + t.space).join(', ')}. La puntuación (1–100) compara el coche con todos los posibles de su mismo chasis.</p>
    </div>
    <details class="tbl"><summary>Motores (${ENGINES.length})</summary>${tableHTML(['Motor', 'Fuerza', 'Esp.', 'Precio', 'Rareza'], ENGINES.map((e) => [e.name, nf2.format(e.power), e.space, '×' + nf2.format(e.price), `<span style="color:${rc(e.tier)}">${RARITY[e.tier].name}</span>`]))}</details>
    <details class="tbl"><summary>Cilindradas (${INTAKES.length})</summary>${tableHTML(['Cil.', 'Mult.', 'Esp.', 'Precio', 'Rareza'], INTAKES.map((e) => [e.name, '×' + nf2.format(e.mult), e.space, '×' + nf2.format(e.price), `<span style="color:${rc(e.tier)}">${RARITY[e.tier].name}</span>`]))}</details>
    <details class="tbl"><summary>Sobrealimentación (${TURBOS.length})</summary>${tableHTML(['Tipo', 'Mult.', 'Acel.', 'Esp.', 'Rareza'], TURBOS.map((e) => [e.name, '×' + nf2.format(e.mult), '×' + nf2.format(e.accel), e.space, `<span style="color:${rc(e.tier)}">${RARITY[e.tier].name}</span>`]))}</details>
    <div class="actions"><button class="btn btn-ghost btn-danger" id="resetBtn">Empezar partida nueva</button></div>`;
  $('#rename').onchange = (e) => { state.company = e.target.value.trim() || state.company; renderTop(); };
  $('#saveBtn').onclick = () => {
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    const box = $('#saveBox'); box.value = code; box.select();
    try { navigator.clipboard && navigator.clipboard.writeText(code).then(() => toast('Código copiado'), () => toast('Código generado: cópialo de la caja')); } catch { toast('Código generado: cópialo de la caja'); }
  };
  $('#loadBtn').onclick = () => {
    try {
      const obj = JSON.parse(decodeURIComponent(escape(atob($('#saveBox').value.trim()))));
      if (!obj || !obj.garage || !obj.rivals) throw new Error('bad');
      state = obj; ui.selected = null; ui.lastResult = null; ui.build = null; show.setBuildGhost(null);
      const first = state.garage.find((c) => c.status !== 'vendido');
      if (first) show.showCar(first, true); else show.clearCar();
      toast('Partida cargada · día ' + state.day);
      renderAll();
    } catch { toast('El código no es válido'); }
  };
  $('#resetBtn').onclick = () => openModal(`<h2 class="modal-title">¿Partida nueva?</h2><p class="modal-sub">Perderás la partida actual si no has guardado el código.</p>
    <div class="actions"><div class="row"><button class="btn" id="mCancel">Cancelar</button><button class="btn btn-primary" id="mOk">Empezar de cero</button></div></div>`, () => {
    $('#mCancel').onclick = closeModal;
    $('#mOk').onclick = () => { state = newState(state.company); ui.selected = null; ui.lastResult = null; ui.build = null; show.setBuildGhost(null); show.clearCar(); closeModal(); setTab('ruleta'); };
  });
}

// ---------- Día siguiente ----------
function nextDay() {
  if (ui.spinning) return;
  const report = simulateDay(state);
  cash();
  const lines = report.lines.sort((a, b) => b.profit - a.profit);
  openModal(`<h2 class="modal-title">Cierre del día ${report.day}</h2>
    <p class="modal-sub">${report.units} unidades vendidas · ingresos ${eur(report.revenue)}</p>
    <div class="big-profit ${report.profit >= 0 ? 'pos' : 'neg'}">${report.profit >= 0 ? '+' : ''}${eurFull(report.profit)}</div>
    ${lines.length ? tableHTML(['Modelo', 'Uds.', 'Beneficio'], lines.map((l) => [esc(l.name), l.units, `<span class="${l.profit >= 0 ? 'pos' : 'neg'}">${eur(l.profit)}</span>`])) : '<div class="empty">No tienes coches a la venta. Lanza un prototipo desde el garaje.</div>'}
    <div class="ci-sub" style="margin-top:8px">Gastos fijos: ${eurFull(report.fixed)}</div>
    ${report.news.length ? `<h3 class="sec">Noticias del sector</h3><div class="news">${report.news.map((n) => `<div class="news-item"><span class="dot" style="background:${n.color}"></span><b>${esc(n.rival)}</b> lanza el ${esc(n.car)} (${byId.type[n.typeId].name}) con ${nf0.format(n.hp)} CV · puntuación <b style="color:${ratingColor(n.rating)}">${n.rating}</b></div>`).join('')}</div>` : ''}
    <div class="actions"><button class="btn btn-primary btn-block" id="mOk">Empezar el día ${state.day}</button></div>`, () => {
    $('#mOk').onclick = () => { closeModal(); ui.lastResult = null; setTab('ruleta'); };
  });
  if (state.cash < -250000) {
    setTimeout(() => openModal(`<h2 class="modal-title">Quiebra</h2><p class="modal-sub">${esc(state.company)} ha acumulado demasiada deuda. Llegaste al día ${state.day}.</p>
      <div class="actions"><button class="btn btn-primary btn-block" id="mOk">Fundar una nueva compañía</button></div>`, () => {
      $('#mOk').onclick = () => { state = newState(state.company); ui.selected = null; ui.lastResult = null; ui.build = null; show.setBuildGhost(null); show.clearCar(); closeModal(); setTab('ruleta'); };
    }), 50);
  }
  renderAll();
}

// ---------- Render general ----------
function renderTop() {
  $('#companyName').textContent = state.company;
  $('#kDay').textContent = state.day;
  const kc = $('#kCash'); kc.textContent = eur(state.cash); kc.classList.toggle('neg', state.cash < 0);
  $('#kPrestige').textContent = nf0.format(state.prestige);
  $('#kActive').textContent = state.garage.filter((c) => c.status === 'mercado').length;
  $('#garageCount').textContent = state.garage.filter((c) => c.status === 'prototipo').length;
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
  if (ui.tab === 'empresa') renderEmpresa();
  renderCarCard();
}

function setTab(t) {
  if (ui.spinning && t !== 'ruleta') return toast('Espera a que termine la ruleta');
  ui.tab = t;
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
$('#startBtn').onclick = () => {
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch {}
  const name = $('#companyInput').value.trim();
  state = newState(name || 'Ameztoy Motors');
  $('#intro').hidden = true;
  show.clearCar();
  renderAll();
  sfx(440, 0.1, 'triangle', 0.08); setTimeout(() => sfx(660, 0.16, 'triangle', 0.08), 90);
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
renderAll();
// coche de muestra en la pantalla de inicio
{ const demo = { ...rollBuild(), typeId: 'bolido', engineId: 'e13', intakeId: 'i12', turboId: 't2', tractionId: 'AWD', aeroId: 'a75', perf: 112, color: '#d6402b' }; show.showCar(demo); show._shown = null; }
requestAnimationFrame(loop);

// Ganchos de prueba
window.advanceTime = (ms) => { const n = Math.max(1, Math.round(ms / 16.67)); for (let i = 0; i < n; i++) show.update(1 / 60); show.render(); };
window.render_game_to_text = () => JSON.stringify({
  day: state.day, cash: Math.round(state.cash), prestige: +state.prestige.toFixed(1), tab: ui.tab, spinning: ui.spinning,
  spinCost: spinCost(state), selected: ui.selected,
  garage: state.garage.slice(0, 8).map((c) => { const s = stats(c); return { id: c.id, name: c.name, type: c.typeId, status: c.status, hp: s.hp, rating: s.rating, price: c.price }; }),
  shownCar: show._shown || null,
});
window.__game = { get state() { return state; }, ui, show };
