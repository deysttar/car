// Construcción del motor (multijugador, fase 1): plano -> pistones -> cilindrada -> admisión -> rendimiento.
// La animación solo reproduce un resultado ya decidido (rollEngineBuild), así en partida online
// el servidor puede repartir la semilla y todos los clientes ven exactamente lo mismo.
import * as THREE from 'three';
import { RARITY, INTAKES, TURBOS, CAR_TYPES } from '../data.js';
import { designName } from '../car3d.js';
import { FAMILIES, rollEngineBuild, rollChassis, rollTraction, rollAero, rollPaint, rollTires, rollQC, QC_ITEMS, colorName, modelNameOf, engineCode, countingCode, perfTier, perfLabel, serialOf, newSeed, carFromSeed } from './build.js';
import { Workshop, clock, tween, wait, ease } from './engine3d.js';
import { buildGarage, LIFT_X, STATIONS } from './garage.js';
import { CarRig, pickupEngine, lowerEngine, refitIntake } from './chassis.js';
import { Drivetrain } from './drivetrain.js';
import { WindTunnel, buildAeroKit, fitAeroKit } from './tunnel.js';
import { PaintBooth } from './paint.js';
import { swapWheels } from './wheels.js';
import { Dyno, powerAt } from './dyno.js';
import { Scanner, Showcase } from './finale.js';
import { ReportDesk } from './report.js';
import { CarShow } from './showroom.js';
import { HostRoom, GuestRoom, cleanCode, MAX_PLAYERS } from './net.js';
import { RaceScene, LAPS } from './race.js';
import { MODES, isV2, carStats, weightParts } from './rules.js';
const CAR_NAME = Object.fromEntries(CAR_TYPES.map((t) => [t.id, t.name]));
// «SUV coupé» ya dice que es un SUV: no se repite el tipo
const fullTypeName = (spec) => { const t = CAR_NAME[spec.typeId] || spec.typeId, d = designName(spec); return d.toLowerCase().startsWith(t.toLowerCase()) ? d : `${t} ${d}`; };

const $ = (id) => document.getElementById(id);
const shop = new Workshop($('scene'));
const garage = buildGarage(shop.scene);
let rig = null;   // coche en el elevador (fase de chasis)
let drive = null; // transmisión (fase de tracción)
let phase = 'chassis'; // qué hace el botón «Siguiente»
let current = null; // resultado del motor que se está montando
if (new URLSearchParams(location.search).has('debug')) window.__debug = { shop, clock, get rig() { return rig; }, race: (r, id) => runRace(r, id), get raceScene() { return raceScene; } };

// ---------- Sonido (WebAudio, sin ficheros) ----------
let actx = null, muted = false;
function ac() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; } }
  return actx;
}
const fast = () => clock.scale > 2;
// Si el navegador no ha activado el audio, no se crean nodos: se acumularían sin sonar.
const live = () => { const c = ac(); return c && !muted && c.state === 'running' ? c : null; };
function tone(freq, dur, type = 'sine', vol = 0.1, slide = 0) {
  const c = live(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + dur + 0.02);
}
function noise(dur, vol = 0.1, freq = 1200, q = 0.8, sweepTo = 0) {
  const c = live(); if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + dur);
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start();
}
const sfx = {
  // Pistola de pintura: siseo continuo mientras pinta
  spray: (on) => {
    if (on && !sprayNode) {
      const c = live(); if (!c) return;
      const buf = c.createBuffer(1, c.sampleRate, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
      const g = c.createGain(); g.gain.value = 0.035;
      src.connect(f).connect(g).connect(c.destination); src.start();
      sprayNode = { src, g };
    } else if (!on && sprayNode) {
      const n = sprayNode; sprayNode = null;
      if (actx) n.g.gain.setTargetAtTime(0.0001, actx.currentTime, 0.08);
      setTimeout(() => n.src.stop(), 400);
    }
  },
  // Pistola neumática: ráfaga de golpes rápidos
  impact: (d) => { if (fast()) return; for (let i = 0; i < d * 30; i++) setTimeout(() => { tone(180 + Math.random() * 40, 0.025, 'square', 0.035); noise(0.02, 0.05, 1800, 2); }, i * 33); },
  printTick: () => { if (fast()) return; noise(0.025, 0.035, 2600, 3); },
  buzz: () => { tone(140, 0.25, 'square', 0.06); tone(147, 0.25, 'square', 0.05); },
  drum: (d) => { if (fast()) return; const n = Math.round(d * 22); for (let i = 0; i < n; i++) setTimeout(() => noise(0.05, 0.05 + (i / n) * 0.12, 220, 1), i * (1000 * d) / n); },
  fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => { tone(f, 0.5, 'triangle', 0.08); tone(f / 2, 0.5, 'sine', 0.05); }, i * 120)); setTimeout(() => noise(0.4, 0.15, 3000, 0.5), 0); },
  lift: (d) => { tone(110, d, 'sawtooth', 0.025, 1.6); noise(d, 0.02, 500, 1); },
  thud: (v = 0.5) => { tone(90, 0.25, 'sine', 0.25 * v, 0.5); noise(0.12, 0.12 * v, 300); },
  clank: () => { if (fast()) return; tone(520 + Math.random() * 120, 0.09, 'triangle', 0.06); noise(0.06, 0.08, 2600, 2); tone(110, 0.12, 'sine', 0.12, 0.6); },
  whoosh: () => noise(0.5, 0.07, 400, 0.6, 2400),
  plotter: (d) => { if (fast()) return; noise(d, 0.025, 3200, 4); },
  stamp: () => { noise(0.1, 0.25, 900, 0.7); tone(70, 0.22, 'sine', 0.3, 0.6); },
  tick: () => { if (fast()) return; tone(1800, 0.025, 'square', 0.025); },
  reveal: (tier) => {
    const base = [0, 520, 620, 740, 880, 1000, 1150][tier] || 880;
    tone(base, 0.16, 'triangle', 0.09);
    if (tier >= 3) setTimeout(() => tone(base * 1.5, 0.2, 'triangle', 0.08), 90);
    if (tier >= 4) setTimeout(() => tone(base * 2, 0.35, 'triangle', 0.07), 200);
  },
};
// Motor arrancando: diente de sierra filtrado que sube de vueltas según el rendimiento.
let rumble = null;
let sprayNode = null;
function startRumble() {
  const c = live(); if (!c) return;
  const o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
  o.type = 'sawtooth'; o2.type = 'square';
  o.frequency.value = 38; o2.frequency.value = 19;
  f.type = 'lowpass'; f.frequency.value = 380;
  g.gain.value = 0.0001;
  o.connect(f); o2.connect(f); f.connect(g).connect(c.destination);
  o.start(); o2.start();
  g.gain.exponentialRampToValueAtTime(0.09, c.currentTime + 0.3);
  rumble = { o, o2, f, g };
}
function setRumble(rpm) {
  if (!rumble || !actx) return;
  const t = actx.currentTime;
  rumble.o.frequency.setTargetAtTime(38 + rpm * 120, t, 0.05);
  rumble.o2.frequency.setTargetAtTime(19 + rpm * 60, t, 0.05);
  rumble.f.frequency.setTargetAtTime(380 + rpm * 1400, t, 0.05);
}
function stopRumble() {
  if (!rumble || !actx) return;
  const r = rumble; rumble = null;
  r.g.gain.setTargetAtTime(0.0001, actx.currentTime, 0.25);
  setTimeout(() => { r.o.stop(); r.o2.stop(); }, 1200);
}
$('muteBtn').addEventListener('click', () => {
  muted = !muted;
  $('muteWave').style.display = muted ? 'none' : '';
  $('muteBtn').setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar sonido');
  if (muted) stopRumble();
});

// ---------- HUD ----------
// Solo se ve un paso: el actual, o el último terminado mientras se espera al siguiente (n = x.5)
function setStep(n) {
  const cur = Math.floor(n);
  if (room && Number.isInteger(n)) room.progress(n);
  for (const li of $('steps').children) {
    const s = +li.dataset.step;
    li.classList.toggle('done', s < n);
    li.classList.toggle('active', s === cur);
  }
}
function caption(kicker, title, sub = '', small = false) {
  $('capTitle').classList.toggle('small', small);
  $('capKicker').textContent = kicker;
  $('capTitle').textContent = title;
  $('capSub').textContent = sub;
}
function punch(el) {
  el.classList.remove('punch');
  void el.offsetWidth;
  el.classList.add('punch');
}
// Todo lo que va tocando se guarda para el informe impreso del final
// La hoja de montaje solo se ve mientras se construye el motor (pasos 1-5)
let report = { serial: '', rows: {} };
function setRow(key, value, tier) {
  report.rows[key] = { value, tier };
  const row = document.querySelector(`.t-row[data-row="${key}"]`);
  if (!row) return;
  row.querySelector('.v').textContent = value;
  const chip = row.querySelector('.chip');
  if (tier) { chip.textContent = RARITY[tier].name; chip.style.setProperty('--c', RARITY[tier].color); chip.hidden = false; } else chip.hidden = true;
  row.classList.add('filled');
  punch(row);
}
function resetTicket(serial) {
  report = { serial, rows: {} };
  $('serial').textContent = serial;
  for (const row of document.querySelectorAll('.t-row')) {
    row.classList.remove('filled', 'punch');
    row.querySelector('.v').textContent = '—';
    row.querySelector('.chip').hidden = true;
  }
  $('ticketFoot').hidden = true;
  showTicket(true);
}
function showTicket(on) {
  $('ticket').hidden = !on;
  shop.offsetRight = on;
  shop.resize();
  document.body.style.setProperty('--ticket-h', on ? `${Math.round($('ticket').getBoundingClientRect().height + 8)}px` : '0px');
}

// Ruleta vertical: desfilan opciones y frena en la que ha tocado.
async function spinReel(label, options, result, fmt) {
  const strip = $('reelStrip');
  $('reelLabel').textContent = label;
  const seq = [];
  for (let r = 0; r < 5; r++) for (const o of [...options].sort(() => Math.random() - 0.5)) seq.push(o);
  seq.push(result, options[0]);
  strip.innerHTML = seq.map((o) => `<div class="reel-item" style="--c:${RARITY[o.tier].color}">${fmt(o)}</div>`).join('');
  $('reel').hidden = false;
  $('reel').classList.remove('landed');
  const itemH = strip.firstElementChild.getBoundingClientRect().height;
  const target = (seq.length - 2) * itemH;
  let last = -1;
  await tween(2.6, (t) => {
    const y = t * target;
    strip.style.transform = `translateY(${-y}px)`;
    const i = Math.floor(y / itemH);
    if (i !== last) { last = i; sfx.tick(); }
  }, ease.outQuart);
  $('reel').classList.add('landed');
  strip.children[seq.length - 2].classList.add('hit');
  sfx.reveal(result.tier);
  await wait(0.7);
}

// Medidor de rendimiento 0-100
const ARC_LEN = Math.PI * 90;
(function ticks() {
  let html = '';
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI - (i / 10) * Math.PI;
    const r1 = 78, r2 = i % 5 ? 72 : 66;
    html += `<line x1="${110 + Math.cos(a) * r1}" y1="${115 - Math.sin(a) * r1}" x2="${110 + Math.cos(a) * r2}" y2="${115 - Math.sin(a) * r2}" />`;
  }
  $('gaugeTicks').innerHTML = html;
  $('gaugeFill').style.strokeDasharray = `${ARC_LEN} ${ARC_LEN}`;
})();
function setGauge(v) {
  $('gaugeFill').style.strokeDashoffset = ARC_LEN * (1 - v / 100);
  $('gaugeNeedle').setAttribute('transform', `rotate(${-90 + (v / 100) * 180} 110 115)`);
  $('gaugeNum').textContent = Math.round(v);
  const c = RARITY[perfTier(Math.round(v))].color;
  $('gauge').style.setProperty('--c', c);
}

// ---------- Secuencia ----------
const turboName = (t) => (t.count === 0 ? 'Atmosférico' : t.name);
let busy = false;

async function runBuild(seed) {
  if (busy) return;
  busy = true;
  const b = rollEngineBuild(seed, gameMode());
  const fam = FAMILIES[b.family];
  const serial = serialOf(seed);
  if (!room) history.replaceState(null, '', `?seed=${seed}${window.__debug ? '&debug' : ''}`);
  if (raceOn || raceScene.group.visible) stopRace();
  $('results').hidden = true;
  $('raceBtn').hidden = true; $('raceBtn').disabled = false; delete $('raceBtn').dataset.sent;
  $('againBtn').hidden = !!room;
  clock.scale = 1;
  if (drive) { drive.dispose(); drive = null; }
  tunnel.reset(); windStop();
  booth.reset(); dyno.reset(); scanner.reset(); showcase.reset(); hall.reset();
  garage.group.visible = true; $('fade').style.opacity = 0;
  sfx.spray(false);
  extras = {};
  for (const id of ['dynoHud', 'qcHud', 'summary', 'printer']) $(id).hidden = true;
  desk.reset(); reportCam.on = false; shop.controls.minDistance = 4;
  document.body.classList.remove('reporting');
  garage.cart.visible = true;
  $('nextBtn').hidden = false;
  $('tunnelHud').hidden = true;
  if (rig) { rig.dispose(); shop.onFrame.delete(rigUpdate); rig = null; }
  phase = 'chassis';
  garage.reset();
  shop.reset();
  resetTicket(serial);
  current = b;
  $('nextBtn').innerHTML = NEXT_LABEL;
  $('nextBtn').disabled = false;
  $('nextBtn').removeAttribute('title');
  $('final').hidden = true;
  $('gauge').hidden = true;
  $('reel').hidden = true;
  $('skipBtn').hidden = false;
  document.body.classList.add('building');

  // 1 · Plano
  setStep(1);
  caption('Paso 1 · Plano', 'Desplegando el plano…', 'La fábrica decide qué tipo de motor vas a montar.');
  shop.camera.position.set(0, 13, 9.5);
  shop.controls.target.set(0, 0, 0);
  const cam = shop.shot([0.2, 9.4, 6.4], [0, 0, 0.3], 2.2);
  await shop.showBlueprint(b.family, serial, sfx);
  await cam;
  await shop.stampBlueprint(fam.stamp, sfx);
  caption('Paso 1 · Plano', fam.title, fam.desc);
  punch($('capTitle'));
  setRow('family', fam.name);
  sfx.reveal(3);
  await wait(1.3);

  // 2 · Pistones (o rotores / etapas)
  setStep(2);
  const piece = fam.piece === 'pistón' ? 'pistones' : fam.piece === 'rotor' ? 'rotores' : 'etapas de turbina';
  caption('Paso 2 · ' + (fam.piece === 'pistón' ? 'Pistones' : fam.piece === 'rotor' ? 'Rotores' : 'Etapas'), countingCode(b.family, 0).replace(/0$/, '·'), `Caen ${piece}: cuantos más, mayor el motor.`);
  shop.shot([4.6, 4.4, 6.6], [0, 1.2, 0], 1.3);
  await shop.engineIn(b, sfx);
  let landed = 0;
  await shop.dropPieces(b.count, () => {
    landed++;
    $('capTitle').textContent = countingCode(b.family, landed);
    punch($('capTitle'));
  }, sfx);
  const { k, y } = shop.engineFocus();
  const code = engineCode(b.family, b.count);
  caption('Paso 2 · Resultado', code, `${b.engine.name} · ${RARITY[b.engine.tier].name}`);
  punch($('capTitle'));
  setRow('engine', code, b.engine.tier);
  sfx.stamp(); sfx.reveal(b.engine.tier);
  await wait(1.1);

  // 3 · Cilindrada
  setStep(3);
  caption('Paso 3 · Cilindrada', '', `${fam.piece === 'pistón' ? 'Los pistones bombean' : fam.piece === 'rotor' ? 'Los rotores giran' : 'Las etapas giran'} mientras se decide la cilindrada.`);
  shop.shot([5.2 * k, y + 2.6 * k, 5.4 * k], [0, y, 0], 1.2);
  shop.engine.pumping = 1;
  await spinReel('Cilindrada', INTAKES, b.intake, (o) => o.name);
  shop.engine.pumping = 0;
  $('reel').hidden = true;
  caption('Paso 3 · Cilindrada', b.intake.name, `${RARITY[b.intake.tier].name} · se montan las culatas`);
  punch($('capTitle'));
  setRow('intake', b.intake.name, b.intake.tier);
  await shop.engine.addCovers(b.intake, () => sfx.thud(0.5));
  await wait(0.6);

  // 4 · Admisión
  setStep(4);
  caption('Paso 4 · Admisión', '', '¿Atmosférico, turbo o compresor?');
  shop.shot([-4.6 * k, y + 2.4 * k, 6.0 * k], [0, y, 0], 1.2);
  await spinReel('Admisión', TURBOS, b.turbo, turboName);
  $('reel').hidden = true;
  caption('Paso 4 · Admisión', turboName(b.turbo), b.turbo.count === 0 ? 'Sin sobrealimentación: respira por sí mismo.' : b.turbo.supercharger ? 'Compresor volumétrico movido por correa.' : `${b.turbo.count} turbo${b.turbo.count > 1 ? 's' : ''} a los costados del bloque.`);
  punch($('capTitle'));
  setRow('turbo', turboName(b.turbo), b.turbo.tier);
  await shop.engine.addIntake(b.turbo, () => { sfx.thud(0.4); sfx.clank(); });
  await shop.settle();
  await wait(0.5);

  // 5 · Rendimiento
  setStep(5);
  caption('Paso 5 · Rendimiento', 'Arranque', 'De 0 a 100. Cuanto más alto, mejor ha salido el motor.');
  shop.shot([5.6 * k, y + 1.6 * k, 5.0 * k], [0, y, 0], 1.2);
  $('gauge').hidden = false;
  setGauge(0);
  startRumble();
  shop.engine.running = 0.2;
  // Acelerón hasta arriba y la aguja vuelve a caer en el resultado.
  await tween(1.0, (t) => { setGauge(t * 100); shop.engine.running = 0.2 + t * 0.8; setRumble(t); }, ease.inOutCubic);
  await tween(1.4, (t) => {
    const v = 100 + (b.perf - 100) * t;
    setGauge(v);
    shop.engine.running = 0.15 + (v / 100) * 0.85;
    setRumble(v / 100);
  }, ease.outQuart);
  const pt = perfTier(b.perf);
  $('gaugeLabel').textContent = perfLabel(b.perf);
  sfx.reveal(pt);
  setRow('perf', `${b.perf} / 100`, pt);
  report.hpEstimate = b.hp;
  $('hp').textContent = `${b.hp} CV`;
  $('ticketFoot').hidden = false;
  showTicket(true);
  await wait(0.8);
  setRumble(Math.max(0.1, b.perf / 300));
  shop.engine.running = 0.15 + b.perf / 400;

  // Final
  setStep(5.5);
  caption('Motor terminado', `${code} · ${b.intake.name} · ${turboName(b.turbo)}`, `Rendimiento ${b.perf}/100 (${perfLabel(b.perf).toLowerCase()}) · ${b.hp} CV estimados. Arrastra para girarlo.`, true);
  punch($('capTitle'));
  $('skipBtn').hidden = true;
  $('gauge').hidden = true;
  $('final').hidden = false;
  shop.controls.enabled = true;
  shop.controls.autoRotate = true;
  shop.controls.autoRotateSpeed = 1.2;
  clock.scale = 1;
  document.body.classList.remove('building');
  busy = false;
}

// ---------- Fase 2: chasis y montaje ----------
const rigUpdate = () => rig && rig.update();
// En móvil la hoja de montaje ocupa la parte de abajo: el encuadre sube el coche.
const narrow = () => innerWidth <= 760;
const NEXT_LABEL = $('nextBtn').innerHTML;

async function runChassis() {
  if (busy || !current || rig) return;
  busy = true;
  const b = current;
  const ch = rollChassis(b);
  const code = engineCode(b.family, b.count);
  stopRumble();
  shop.engine.running = 0;
  clock.scale = 1;
  $('final').hidden = true;
  $('skipBtn').hidden = false;
  shop.controls.enabled = false;
  shop.controls.autoRotate = false;
  document.body.classList.add('building');

  // 6 · Chasis
  showTicket(false);
  setStep(6);
  // Primero se monta y después se revela qué chasis ha tocado
  caption('Paso 6 · Chasis', '¿Qué saldrá?', 'Se monta el chasis pieza a pieza sobre el elevador…');
  await shop.shot([LIFT_X + 7.0, 4.4, 8.0], [LIFT_X + 1.0, narrow() ? 0.7 : 1.4, 0], 1.6);
  rig = new CarRig(garage.carHolder, ch.car, shop.engine.fullBounds());
  shop.onFrame.add(rigUpdate);
  const dn = designName(ch.car);
  garage.lift.fit(rig.liftPoints()); // brazos y altura a la medida de este coche
  // Mientras se monta el coche, la grúa recoge el motor del banco.
  const picked = pickupEngine(shop, garage, rig, sfx);
  await rig.assemble(sfx);
  caption('Paso 6 · Chasis', ch.type.name, `${dn} · ${RARITY[ch.type.tier].name}`);
  punch($('capTitle'));
  setRow('chassis', `${ch.type.name} · ${dn}`, ch.type.tier);
  sfx.stamp(); sfx.reveal(ch.type.tier);
  await wait(1.4);
  caption('Paso 6 · Chasis', 'Arriba', 'El elevador sube el coche para trabajar en él.');
  sfx.lift(2.4);
  await garage.lift.raise(garage.lift.high, 2.4);
  await picked;

  // 7 · Montaje
  setStep(7);
  caption('Paso 7 · Montaje', 'Capó abierto', 'La grúa trae el motor hasta el vano.');
  const bay = rig.bayWorld();
  await shop.shot([bay.x + 0.85, bay.y + 2.15, bay.z + 0.4], [bay.x + 0.05, bay.y - (narrow() ? 0.45 : 0.05), bay.z], 1.6);
  await rig.openHood(sfx);
  await lowerEngine(shop, garage, rig, sfx);
  caption('Paso 7 · Montaje', code, `${b.intake.name} en su sitio. Se conectan los manguitos.`);
  punch($('capTitle'));
  await rig.connectHoses(sfx, shop.engine.inner);
  caption('Paso 7 · Montaje', turboName(b.turbo), b.turbo.count === 0 ? 'Se montan las trompetas de admisión.' : b.turbo.supercharger ? 'Se monta el compresor.' : `Se monta${b.turbo.count > 1 ? 'n los turbos' : ' el turbo'}.`);
  punch($('capTitle'));
  await refitIntake(shop, sfx);
  rig.clipEngine(shop.engine.root); // la admisión también se recorta al vano
  await wait(0.5);
  await rig.closeHood(sfx, shop.engine.root);

  // Vuelta al taller: el coche queda en el elevador, aún en construcción
  caption('En construcción', `${ch.type.name} ${dn}`, `${code} · ${b.intake.name} · ${turboName(b.turbo)} montado. Falta la tracción y la aerodinámica.`, true);
  await shop.shot([LIFT_X + 5.8, 3.4, 6.6], [LIFT_X, narrow() ? 1.7 : 2.1, 0], 2.4);
  setStep(7.5);
  $('skipBtn').hidden = true;
  $('nextBtn').innerHTML = NEXT_LABEL.replace('chasis', 'tracción');
  phase = 'traction';
  $('final').hidden = false;
  shop.controls.enabled = true;
  shop.controls.autoRotate = true;
  shop.controls.autoRotateSpeed = 0.6;
  clock.scale = 1;
  document.body.classList.remove('building');
  busy = false;
}

// Si algo falla en el montaje, no dejamos la partida bloqueada.
// ---------- Fase 3: tracción ----------
const TRACTION_DESC = {
  TT: 'La fuerza va a las ruedas traseras: empuja desde atrás y es la más divertida al acelerar.',
  TD: 'La fuerza va a las ruedas delanteras: tira del coche, estable y eficiente.',
  AWD: 'La fuerza se reparte a las cuatro ruedas: máximo agarre en cualquier suelo.',
};
const STEP_TEXT = {
  gearbox: 'Sale la caja de cambios del motor…',
  rear: 'El árbol de transmisión lleva la fuerza hacia atrás…',
  front: 'La fuerza baja hacia el eje delantero…',
};
// Cámara que sigue la cabeza del hilo de energía
let followOff = null;
const followCam = (dt) => {
  if (!drive || !drive.head || !followOff) return;
  const k = 1 - Math.exp(-dt * 3.5);
  shop.controls.target.lerp(drive.head, k);
  shop.camera.position.copy(shop.controls.target).add(followOff);
};
shop.onFrame.add(followCam);

async function runTraction() {
  if (busy || !rig || drive) return;
  busy = true;
  const b = current;
  const tr = rollTraction(b);
  clock.scale = 1;
  $('final').hidden = true;
  $('skipBtn').hidden = false;
  shop.controls.enabled = false;
  shop.controls.autoRotate = false;
  document.body.classList.add('building');

  setStep(8);
  // Primero la animación: la tracción se descubre siguiendo el hilo y se anuncia al final
  caption('Paso 8 · Tracción', '¿Adónde irá?', '¿Delantera, trasera o a las cuatro ruedas?');
  await shop.shot([LIFT_X + 6.2, 3.8, 6.8], [LIFT_X + 0.6, narrow() ? 1.0 : 1.6, 0], 1.4);

  // Rayos X: la carrocería se vuelve transparente y la cámara se acerca a la caja de cambios
  drive = new Drivetrain(shop, rig, tr, garage.liftGroup);
  const start = rig.car.localToWorld(drive.layout().G.clone());
  await Promise.all([
    drive.xray(true),
    shop.shot([start.x + 1.9, start.y + 2.2, start.z + 3.0], [start.x, start.y, start.z], 1.4),
  ]);
  followOff = shop.camera.position.clone().sub(shop.controls.target);
  await drive.build(sfx, (step) => { $('capSub').textContent = STEP_TEXT[step] || ''; });
  followOff = null;
  caption('Paso 8 · Tracción', tr.name, TRACTION_DESC[tr.id]);
  punch($('capTitle'));
  setRow('traction', tr.name, tr.tier);
  sfx.stamp(); sfx.reveal(tr.tier);
  // Vista de todo el coche con la energía fluyendo
  await shop.shot([LIFT_X + 5.6, 4.6, 6.2], [LIFT_X, narrow() ? 1.2 : 1.7, 0], 1.8);
  await wait(1.2);
  await drive.settle();
  await drive.xray(false, 1.0);

  setStep(8.5);
  caption('En construcción', tr.name, `Motor, chasis y tracción listos. Ahora, ruedas y frenos.`, true);
  $('skipBtn').hidden = true;
  $('nextBtn').innerHTML = NEXT_LABEL.replace('chasis', 'ruedas');
  $('final').hidden = false;
  shop.controls.enabled = true;
  shop.controls.autoRotate = true;
  shop.controls.autoRotateSpeed = 0.6;
  clock.scale = 1;
  document.body.classList.remove('building');
  phase = 'wheels';
  busy = false;
}

// ---------- Fase 4: aerodinámica (túnel de viento) ----------
const tunnel = new WindTunnel(shop.scene, STATIONS.tunnel);
shop.onFrame.add((dt) => tunnel.update(dt));
// Viento: ruido filtrado en bucle que sube con el ventilador
let windSnd = null;
function windStart() {
  const c = live(); if (!c || windSnd) return;
  const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 200;
  const g = c.createGain(); g.gain.value = 0.0001;
  src.connect(f).connect(g).connect(c.destination);
  src.start();
  windSnd = { src, f, g };
}
function windSet(v) {
  if (!windSnd || !actx) return;
  const t = actx.currentTime;
  windSnd.f.frequency.setTargetAtTime(200 + v * 2400, t, 0.1);
  windSnd.g.gain.setTargetAtTime(0.0001 + v * 0.1, t, 0.1);
}
function windStop() {
  if (!windSnd || !actx) return;
  const w = windSnd; windSnd = null;
  w.g.gain.setTargetAtTime(0.0001, actx.currentTime, 0.3);
  setTimeout(() => w.src.stop(), 1500);
}
// Coeficiente de resistencia base de cada carrocería y lo que añade el kit
const CX = { utilitario: 0.34, furgoneta: 0.38, turismo: 0.3, suv: 0.36, pickup: 0.42, coupe: 0.3, deportivo: 0.28, bolido: 0.25 };
const AERO_DESC = {
  a25: 'Poca resistencia: más velocidad punta, a cambio de menos agarre en curva.',
  a50: 'Equilibrio entre velocidad punta y agarre en curva.',
  a75: 'Mucha carga: se pega al asfalto en las curvas, aunque frena la punta.',
};
function setTunnelHud(wind, cx, down, frac) {
  $('thWind').textContent = `${Math.round(wind)} km/h`;
  $('thCx').textContent = cx == null ? '—' : cx.toFixed(2);
  $('thDown').textContent = down == null ? '—' : `${Math.round(down)} kg`;
  $('thBar').style.width = `${Math.round(frac * 100)}%`;
}

async function runAero() {
  if (busy || !rig || !drive) return;
  beginPhase();
  const b = current;
  const ae = rollAero(b);
  const typeId = rig.spec.typeId;
  const T = STATIONS.tunnel;
  rig.spec.tractionId = drive.traction.id;
  rig.spec.aeroId = ae.id;

  setStep(10);
  caption('Paso 10 · Aerodinámica', '¿Cuánta carga?', 'El coche baja del elevador y va al túnel de viento…');
  await shop.shot([LIFT_X + 6.5, 3.8, 9.0], [LIFT_X + 4.5, 0.8, 0], 1.4);
  // 1 · Baja el elevador hasta que las ruedas tocan el suelo y el coche se suelta
  const { bottom } = rig.liftPoints();
  sfx.lift(1.8);
  await garage.lift.raise(bottom - 0.02, 1.8);
  sfx.thud(0.5);
  shop.scene.attach(rig.car);
  garage.lift.raise(0.06, 0.6);
  shop.blueprint.group.visible = false;
  shop.halo.material.opacity = 0;
  // 2 · Sale del elevador, rodea la zona central y entra por la puerta del túnel
  const car = rig.car;
  tunnel.openDoor(sfx);
  await drivePath(PATH.toTunnel);
  tunnel.closeDoor(sfx);
  // 3 · La plataforma giratoria lo pone de cara al ventilador
  caption('Paso 10 · Aerodinámica', '¿Cuánta carga?', 'La plataforma gira el coche de cara al ventilador…');
  shop.shot(S(T, [-4.6, 3.6, 7.8]), S(T, [0, 0.8, 0]), 1.6);
  sfx.lift(2.0);
  await tunnel.rotateTo(car, 0);
  car.rotation.y = 0;
  sfx.thud(0.4);
  tunnel.computeLines(car);
  // 4 · Primera medición sin kit: vista de perfil
  caption('Paso 10 · Aerodinámica', '¿Cuánta carga?', 'Arranca el ventilador: el humo dibuja cómo pasa el aire sobre la carrocería.');
  await shop.shot(S(T, [0.3, 1.7, 8.6]), S(T, [-0.2, 1.0, 0]), 1.6);
  $('tunnelHud').hidden = false;
  windStart();
  const cx0 = CX[typeId] || 0.32, down0 = 15;
  tunnel.smoke(2.6);
  await tween(2.4, (t) => { tunnel.wind = t; windSet(t); setTunnelHud(t * 200, t > 0.6 ? cx0 : null, t > 0.6 ? down0 * t : null, t * 0.15); }, ease.inOutCubic);
  await wait(1.6);
  // 5 · Kit aerodinámico según la carga (aún sin decir cuál)
  caption('Paso 10 · Aerodinámica', '¿Cuánta carga?', 'Se monta el kit aerodinámico…');
  const kit = buildAeroKit(rig, ae.level, rig.spec.color);
  // La cámara mira a la zaga, a la altura del alerón (en un SUV va en el techo)
  const wingW = kit.wing.getWorldPosition(new THREE.Vector3());
  await shop.shot([wingW.x - 3.0, wingW.y + 1.2, T.z + 4.2], [wingW.x + 0.9, wingW.y - 0.35, T.z], 1.4);
  await fitAeroKit(kit, sfx);
  tunnel.computeLines(car);
  tunnel.smoke(1.4);
  const sporty = ['coupe', 'deportivo', 'bolido'].includes(typeId);
  const cx1 = cx0 + ae.level * 0.1, down1 = down0 + ae.level * (sporty ? 560 : 320);
  await shop.shot(S(T, [0.3, 1.7, 8.6]), S(T, [-0.2, 1.0, 0]), 1.4);
  await tween(1.6, (t) => setTunnelHud(200, cx0 + (cx1 - cx0) * t, down0 + (down1 - down0) * t, 0.15 + 0.85 * ae.level * t / 0.75), ease.outCubic);
  await wait(1.0);
  // 6 · Resultado
  caption('Paso 10 · Aerodinámica', `Carga ${ae.name.split(' ')[0].toLowerCase()}`, AERO_DESC[ae.id]);
  punch($('capTitle'));
  setRow('aero', ae.name, ae.tier);
  sfx.stamp(); sfx.reveal(ae.tier);
  await wait(1.6);
  await tween(1.5, (t) => { tunnel.wind = 1 - t; windSet(1 - t); setTunnelHud(200 * (1 - t), cx1, down1 * (1 - t), (0.15 + 0.85 * ae.level / 0.75) * (1 - t)); }, ease.inOutCubic);
  windStop();
  $('tunnelHud').hidden = true;

  await shop.shot(S(T, [4.2, 2.6, 7.8]), S(T, [0, 0.9, 0]), 1.2);
  endPhase('paint', 'pintura', 10);
}

// ---------- Fases finales: cada prueba en su zona del taller ----------
const booth = new PaintBooth(shop.scene, STATIONS.paint);
shop.onFrame.add((dt) => booth.update(dt));
const dyno = new Dyno(shop, STATIONS.dyno);
const scanner = new Scanner(shop.scene, STATIONS.qc);
const showcase = new Showcase(shop);
const hall = new CarShow(shop);
const desk = new ReportDesk(shop.scene, STATIONS.desk);
let extras = {}; // lo que va tocando en las fases finales (acabado, ruedas, calidad)
const S = (st, p) => [st.x + p[0], p[1], st.z + p[2]]; // punto relativo a una zona

function beginPhase() {
  busy = true;
  clock.scale = 1;
  $('final').hidden = true;
  $('skipBtn').hidden = false;
  shop.controls.enabled = false;
  shop.controls.autoRotate = false;
  document.body.classList.add('building');
}
// Deja el coche a la vista y el botón listo para la siguiente fase
function endPhase(next, label, step) {
  setStep(step + 0.5);
  $('skipBtn').hidden = true;
  $('nextBtn').innerHTML = NEXT_LABEL.replace('chasis', label);
  $('nextBtn').hidden = false;
  $('nextBtn').disabled = false;
  $('final').hidden = false;
  shop.controls.enabled = true;
  shop.controls.autoRotate = true;
  shop.controls.autoRotateSpeed = 0.6;
  clock.scale = 1;
  document.body.classList.remove('building');
  phase = next;
  busy = false;
}
// Fundido a negro (sigue el reloj del juego, así «Saltar» también lo acelera)
function fade(to, dur) {
  const el = $('fade'), from = +el.style.opacity || 0;
  return tween(dur, (t) => (el.style.opacity = from + (to - from) * t), ease.inOutCubic);
}
const isLightHex = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150; };

// Caminos por los pasillos del taller (sin atravesar nada). El primer punto es donde está el coche.
const PATH = {
  // Del elevador: sale hacia delante, rodea la zona central y entra recto por la puerta del túnel
  toTunnel: [[LIFT_X + 3.3, 0], [-5.9, 0.8], [-5.0, 2.4], [-5.9, 3.7], [-8.2, 3.9], [-12, 3.8], [-15.6, 3.8], [-18.0, 4.6], [STATIONS.tunnel.x, 6.4], [STATIONS.tunnel.x, 8.6], [STATIONS.tunnel.x, STATIONS.tunnel.z]],
  // Del túnel (mirando a la puerta) a la cabina de pintura, entrando por su lado abierto
  toPaint: [[STATIONS.tunnel.x, 9.0], [STATIONS.tunnel.x, 7.0], [-18.2, 5.2], [-16, 4.4], [-13, 4.4], [-10.4, 5.4], [-9.2, 7.6], [-8.6, 10.2], [-7.2, 11.4], [-5.2, STATIONS.paint.z], [STATIONS.paint.x, STATIONS.paint.z]],
  // De calidad: cruza el arco y sale del taller por el lado abierto (hacia el salón)
  toShow: [[21.5, 11.6], [23.4, 13.6], [24, 17], [24, 23], [24, 30]],
};

// El coche conduce siguiendo una curva suave: mira hacia donde va, gira el volante en las curvas,
// las ruedas ruedan según la distancia, sube y baja rampas (ground) y la cámara lo sigue.
async function drivePath(points, { yaw = null, ground = null, speed = 4.2, onU = null } = {}) {
  const car = rig.car;
  const pts = [[car.position.x, car.position.z], ...points].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  if (len < 0.05) return;
  const wheels = rig.body.filter((o) => o.userData.isWheel);
  const fronts = wheels.filter((w) => w.position.x > 0);
  for (const w of wheels) if (w.userData.yaw0 == null) w.userData.yaw0 = w.rotation.y;
  const r = wheels[0].children[0].geometry.parameters.radiusTop || 0.35;
  const xF = Math.max(...wheels.map((w) => w.position.x)), xR = Math.min(...wheels.map((w) => w.position.x));
  const wb = Math.max(1, xF - xR);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const heading = (u) => { const t = curve.getTangentAt(Math.min(1, Math.max(0, u))); return Math.atan2(-t.z, t.x); };
  // Altura del coche: la de cada eje sobre el suelo (rampas) y el cabeceo entre los dos
  const BASE_Y = 0.006;
  const level = (x, z, h) => {
    if (!ground) return { y: BASE_Y, pitch: 0 };
    const fx = Math.cos(h), fz = -Math.sin(h);
    const yF = ground(x + fx * xF, z + fz * xF), yR = ground(x + fx * xR, z + fz * xR);
    return { y: BASE_Y + yR + (yF - yR) * (-xR / wb), pitch: Math.atan2(yF - yR, wb) };
  };
  const yaw0 = car.rotation.y;
  const off0 = car.position.y - level(car.position.x, car.position.z, yaw0).y; // p. ej. al bajar del elevador
  // Cámara que sigue al coche desde atrás y un poco de lado (siempre del lado del espectador)
  const k = narrow() ? 1.45 : 1;
  const follow = (dt) => {
    const h = car.rotation.y, f = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
    const off = f.clone().multiplyScalar(-0.8).add(new THREE.Vector3(0, 0, 0.6)).normalize().multiplyScalar(7.2 * k);
    const goalP = car.position.clone().add(off).setY(3.4 * k);
    const goalT = car.position.clone().addScaledVector(f, 1.4).setY(0.8);
    const a = 1 - Math.exp(-dt * 2.4);
    shop.camera.position.lerp(goalP, a);
    shop.controls.target.lerp(goalT, a);
  };
  shop.onFrame.add(follow);
  startRumble(); setRumble(0.2);
  let prev = 0, steer = 0;
  await tween(1.2 + len / speed, (u) => {
    const sNow = u * len;
    const p = curve.getPointAt(u);
    let h = heading(u);
    if (u < 0.1) h = yaw0 + wrap(h - yaw0) * (u / 0.1);
    if (yaw != null && u > 0.88) h += wrap(yaw - h) * ((u - 0.88) / 0.12);
    car.position.x = p.x; car.position.z = p.z;
    car.rotation.y = h;
    const lv = level(p.x, p.z, h);
    car.position.y = lv.y + off0 * (1 - Math.min(1, sNow / 1.2));
    car.rotation.z = lv.pitch;
    // Volante: ángulo según la curvatura del camino y la batalla
    const du = Math.min(0.2, 0.5 / len);
    const kap = wrap(heading(u + du) - heading(u)) / (du * len);
    steer += (Math.max(-0.55, Math.min(0.55, Math.atan(wb * kap))) - steer) * 0.2;
    for (const w of fronts) w.rotation.y = w.userData.yaw0 + steer;
    const d = sNow - prev; prev = sNow;
    for (const w of wheels) w.rotation.z += (w.position.z < 0 ? 1 : -1) * d / r;
    if (onU) onU(u);
  }, ease.inOutSine);
  for (const w of fronts) w.rotation.y = w.userData.yaw0;
  if (yaw != null) car.rotation.y = yaw;
  stopRumble();
  shop.onFrame.delete(follow);
}

// 10 · Pintura (cabina de pintura)
async function runPaint() {
  if (busy || !rig) return;
  beginPhase();
  const st = STATIONS.paint;
  const fin = extras.finish = rollPaint(current);
  const hex = rig.spec.color, cname = colorName(hex);
  setStep(11);
  caption('Paso 11 · Pintura', '¿De qué color?', 'El coche sale del túnel y va a la cabina de pintura…');
  const T = STATIONS.tunnel;
  shop.shot(S(T, [-4.6, 3.6, 7.8]), S(T, [0, 0.8, 0]), 1.2);
  sfx.lift(1.8);
  await tunnel.rotateTo(rig.car, Math.PI / 2, 1.8);
  rig.car.rotation.y = Math.PI / 2;
  tunnel.openDoor(sfx);
  await wait(0.7);
  await drivePath(PATH.toPaint, { yaw: 0 });
  tunnel.closeDoor(sfx);
  await shop.shot(S(st, [4.6, 3.0, 7.0]), S(st, [0, 0.9, 0]), 1.0);
  const P = rig.paint, base = new THREE.Color(hex);
  P.uPaint.value.copy(base);
  if (fin.id === 'pearl') P.uPaint2.value.copy(base).offsetHSL(0.12, 0.05, 0.14);
  else if (fin.id === 'duo') P.uPaint2.value.set(isLightHex(hex) ? '#2b2d33' : '#efece4');
  else P.uPaint2.value.copy(base);
  await booth.run(rig, fin, sfx, (ph) => { $('capSub').textContent = ph === 'color' ? 'Los robots aplican la capa de color de delante atrás…' : 'Segunda pasada: barniz…'; });
  $('capSub').textContent = 'Lámparas de secado…';
  await booth.dry(1.4);
  caption('Paso 11 · Pintura', `${cname} ${fin.name.toLowerCase()}`, fin.desc);
  punch($('capTitle'));
  setRow('paint', `${cname} · ${fin.name}`, fin.tier);
  sfx.stamp(); sfx.reveal(fin.tier);
  await shop.shot(S(st, [5.0, 2.2, 5.8]), S(st, [0, 0.9, 0]), 1.6);
  endPhase('dyno', 'banco de potencia', 11);
}

// 9 · Ruedas y frenos: el coche sigue arriba en el elevador
async function runWheels() {
  if (busy || !rig) return;
  beginPhase();
  const tire = extras.tires = rollTires(current);
  setStep(9);
  caption('Paso 9 · Ruedas y frenos', '¿Qué ruedas?', 'Con el coche en el elevador, fuera las ruedas de serie…');
  const car = rig.car;
  const hub = car.getWorldPosition(new THREE.Vector3());
  await shop.shot([LIFT_X + 4.6, hub.y + 1.2, 6.2], [LIFT_X, hub.y + 0.2, 0], 1.2);
  $('capSub').textContent = 'Se montan discos, pinzas y ruedas nuevas…';
  await swapWheels(rig, tire, sfx, (home, s) => {
    const w = car.localToWorld(home.clone());
    shop.shot([w.x + 1.2, w.y + 0.6, w.z + s * 2.4], [w.x, w.y, w.z], 0.5);
  }, { onLift: true });
  caption('Paso 9 · Ruedas y frenos', `Neumáticos ${tire.name.toLowerCase()}`, `${tire.brakes}. ${tire.desc}${tire.bonus ? ` Agarre +${tire.bonus}.` : ''}`);
  punch($('capTitle'));
  setRow('tires', tire.name, tire.tier);
  sfx.stamp(); sfx.reveal(tire.tier);
  await shop.shot([LIFT_X + 5.6, hub.y + 1.8, 6.8], [LIFT_X, hub.y, 0], 1.6);
  endPhase('aero', 'aerodinámica', 9);
}

// 12 · Banco de potencia (foso de rodillos)
function dynoGrid(redline, maxHp) {
  const X = (rpm) => 30 + (rpm / redline) * 240, Y = (v) => 125 - (v / maxHp) * 112;
  let g = '';
  for (let r = 1000; r < redline; r += 1000) g += `<line x1="${X(r)}" y1="10" x2="${X(r)}" y2="125"/>` + (r % 2000 === 0 ? `<text x="${X(r) - 8}" y="138">${r / 1000}k</text>` : '');
  for (let k = 1; k <= 4; k++) { const v = (maxHp * k) / 4; g += `<line x1="30" y1="${Y(v)}" x2="270" y2="${Y(v)}"/><text x="2" y="${Y(v) + 3}">${Math.round(v)}</text>`; }
  $('dynoGrid').innerHTML = g;
  return { X, Y };
}
async function runDyno() {
  if (busy || !rig || !drive) return;
  beginPhase();
  const st = STATIONS.dyno;
  const b = current;
  const stt = carStats(rig.spec);
  const hp = stt.hp;
  const peak = b.family === 'rotary' ? 8500 : b.family === 'turbine' ? 11000 : Math.min(7600, 5200 + b.count * 140);
  const redline = peak + (b.family === 'turbine' ? 1500 : 800);
  setStep(12);
  caption('Paso 12 · Banco de potencia', '¿Cuánta potencia?', 'El coche va al banco de rodillos…');
  await drivePath([[dyno.stopX(rig), st.z]], { yaw: 0, ground: (x, z) => dyno.heightAt(x, z) });
  await shop.shot(S(st, [4.8, 2.2, 6.6]), S(st, [-0.3, 0.6, 0]), 1.0);
  $('capSub').textContent = 'El carro de rodillos se ajusta a la batalla y se ata el coche…';
  await dyno.setup(rig, drive.traction.id, sfx);
  const maxTq = Math.max(...Array.from({ length: 40 }, (_, i) => { const r = 900 + ((redline - 900) * (i + 1)) / 40; return (powerAt(hp, r, peak) * 7023) / r; }));
  const { X, Y } = dynoGrid(redline, hp * 1.12);
  const YT = (nm) => 125 - (nm / (maxTq * 1.12)) * 112;
  $('dynoHp').setAttribute('d', ''); $('dynoTq').setAttribute('d', '');
  $('dynoPeak').setAttribute('cx', -10);
  $('dynoHud').hidden = false;
  for (const n of ['3', '2', '1']) { $('capTitle').textContent = n; punch($('capTitle')); sfx.tick(); tone(660, 0.12, 'square', 0.04); await wait(0.6); }
  caption('Paso 12 · Banco de potencia', '¡A fondo!', 'El motor sube de vueltas hasta el corte…');
  startRumble();
  shop.shot(S(st, [-5.0, 1.5, 4.6]), S(st, [0, 0.7, 0]), 1.6);
  let dHp = '', dTq = '', best = { cv: 0, rpm: 0 };
  await dyno.pull(hp, peak, redline, { rpm: (k) => setRumble(k) }, (rpm, cv, nm) => {
    dHp += `${dHp ? 'L' : 'M'}${X(rpm).toFixed(1)} ${Y(cv).toFixed(1)}`;
    dTq += `${dTq ? 'L' : 'M'}${X(rpm).toFixed(1)} ${YT(nm).toFixed(1)}`;
    $('dynoHp').setAttribute('d', dHp); $('dynoTq').setAttribute('d', dTq);
    $('dynoRpm').textContent = Math.round(rpm);
    $('dynoCv').textContent = `${Math.round(cv)} CV`;
    $('dynoNm').textContent = `${Math.round(nm)} Nm`;
    if (cv > best.cv) best = { cv, rpm };
  });
  stopRumble();
  $('dynoPeak').setAttribute('cx', X(best.rpm)); $('dynoPeak').setAttribute('cy', Y(best.cv));
  caption('Paso 12 · Banco de potencia', `${hp} CV`, `Potencia máxima a ${Math.round(best.rpm / 100) * 100} rpm · par máximo ${Math.round(maxTq)} Nm.`);
  punch($('capTitle'));
  report.dyno = { hp, rpm: Math.round(best.rpm / 100) * 100, nm: Math.round(maxTq) };
  sfx.stamp(); sfx.reveal(Math.min(6, stt.overallTier + 1));
  await wait(1.6);
  $('dynoHud').hidden = true;
  await dyno.teardown(rig);
  await shop.shot(S(st, [4.8, 2.2, 5.8]), S(st, [0, 0.8, 0]), 1.2);
  endPhase('qc', 'control de calidad', 12);
}

// 13 · Control de calidad (arco escáner)
async function runQC() {
  if (busy || !rig) return;
  beginPhase();
  const st = STATIONS.qc;
  const v2 = isV2(rig.spec);
  const qc = extras.qc = v2 ? { defect: -1, penalty: 0 } : rollQC(current);
  setStep(13);
  caption('Paso 13 · Control de calidad', '¿Pasa la inspección?', 'El coche va a la zona de calidad…');
  await drivePath([[st.x, st.z]], { yaw: 0, ground: (x, z) => dyno.heightAt(x, z) });
  await shop.shot(S(st, [4.0, 3.0, 6.8]), S(st, [0, 1.0, 0]), 1.0);
  $('capSub').textContent = 'El escáner revisa el coche de punta a punta…';
  $('qcList').innerHTML = QC_ITEMS.map((n) => `<li><span>${n}</span><b>…</b></li>`).join('');
  $('qcHud').hidden = false;
  const items = [...$('qcList').children];
  let marked = 0;
  await scanner.sweep(rig, (f) => {
    while (marked < items.length && f > (marked + 1) / (items.length + 1)) {
      const li = items[marked];
      if (marked === qc.defect) { li.classList.add('bad'); li.querySelector('b').textContent = '⚠ leve'; sfx.buzz(); }
      else { li.classList.add('ok'); li.querySelector('b').textContent = '✓'; tone(1320, 0.08, 'triangle', 0.05); }
      marked++;
    }
  });
  if (v2) {
    // La fiabilidad sale ahora: puede ser un cochazo con un motor que no aguante la carrera
    const rel = rig.spec.reliability;
    const li = document.createElement('li');
    li.innerHTML = '<span>Fiabilidad</span><b class="num">0 %</b>';
    $('qcList').appendChild(li);
    $('capSub').textContent = 'Prueba de resistencia: ¿cuánto aguantará el motor?';
    await tween(2.0, (t) => { li.querySelector('b').textContent = `${Math.round(rel * t)} %`; }, ease.outCubic);
    li.classList.add(rel >= 45 ? 'ok' : 'bad');
    const label = rel >= 85 ? 'A prueba de bombas' : rel >= 65 ? 'Muy fiable' : rel >= 45 ? 'Normal' : rel >= 25 ? 'Delicado' : 'Bomba de relojería';
    const risk = rel >= 65 ? 'Casi seguro que aguanta la carrera.' : rel >= 45 ? 'Lo normal es que termine la carrera.' : rel >= 25 ? 'Hay bastantes papeletas de que reviente en carrera.' : 'Lo raro será que llegue a la meta.';
    caption('Paso 13 · Control de calidad', `Fiabilidad ${rel} %`, `${label}. ${risk}`);
    punch($('capTitle'));
    setRow('qc', `Fiabilidad ${rel} %`, perfTier(rel));
    sfx.stamp(); sfx.reveal(perfTier(rel));
    await wait(1.8);
    $('qcHud').hidden = true;
    endPhase('present', 'presentación', 13);
    return;
  }
  const ok = qc.defect < 0;
  caption('Paso 13 · Control de calidad', ok ? 'Aprobado' : 'Aprobado con un defecto leve', ok ? 'Todo en orden: ni un solo defecto.' : `${QC_ITEMS[qc.defect]}: un pequeño fallo de montaje (−${qc.penalty} puntos).`);
  punch($('capTitle'));
  setRow('qc', ok ? 'Perfecto' : 'Defecto leve', ok ? 3 : 1);
  sfx.stamp(); sfx.reveal(ok ? 4 : 1);
  await wait(1.8);
  $('qcHud').hidden = true;
  endPhase('present', 'presentación', 13);
}

// 14 · Presentación (plataforma central)
async function runPresent() {
  if (busy || !rig) return;
  beginPhase();
  const b = current, spec = rig.spec;
  setStep(14);
  caption('Paso 14 · Presentación', 'Gran final', 'El coche sale del taller rumbo al salón del automóvil…');
  // Sale del taller y, a mitad de camino, fundido a negro: cambio de escena
  let fading = null;
  await drivePath(PATH.toShow, { onU: (u) => { if (u > 0.45 && !fading) fading = fade(1, 1.1); } });
  await fading;
  // En negro: el coche ya está en la peana del salón, tapado con la lona y con la sala a oscuras
  garage.group.visible = false;
  hall.enter();
  hall.place(rig);
  showcase.dimLights(0.25);
  await hall.house(0.35, 0.01);
  await showcase.cover(rig, sfx, true);
  const C = hall.center();
  shop.camera.position.set(C.x + 4.6, 3.4, C.z + 11.8);
  shop.controls.target.copy(C);
  caption('Paso 14 · Presentación', 'Salón del automóvil', 'Presentación mundial del nuevo modelo…');
  await wait(0.3);
  shop.shot([C.x + 3.5, 2.6, C.z + 8.6], [C.x, 0.9, C.z], 3.0);
  await fade(0, 1.2);
  $('capSub').textContent = 'Se apagan las luces de la sala…';
  await hall.house(0.12, 1.0);
  await hall.spots(sfx);
  caption('Paso 14 · Presentación', '¿Preparados?', 'Redoble de tambor…');
  await shop.shot([C.x + 2.7, 1.9, C.z + 6.8], [C.x, 0.9, C.z], 1.0);
  sfx.drum(2.2);
  await wait(2.2);
  await showcase.reveal(rig, sfx);
  hall.spinning = true;
  hall.house(0.85, 1.6);
  // Ficha final
  const st = carStats(spec);
  const rating = Math.max(1, Math.min(100, st.rating + (extras.tires?.bonus || 0) - (extras.qc?.penalty || 0)));
  const model = modelNameOf(b);
  const typeId = spec.typeId;
  const fin = extras.finish;
  caption('¡Coche terminado!', `Ruleta ${model}`, `${fullTypeName(spec)} · ${engineCode(b.family, b.count)} ${b.intake.name} ${turboName(b.turbo)} · ${drive.traction.name} · ${colorName(spec.color)}${fin ? ` ${fin.name.toLowerCase()}` : ''}`, true);
  punch($('capTitle'));
  $('summary').innerHTML = [
    ['big', 'Puntuación', `${rating}/100`],
    ['', 'Potencia', `${st.hp} CV`],
    ['', '0-100 km/h', `${st.t0100.toFixed(1)} s`],
    ['', 'Punta', `${Math.round(st.vmax)} km/h`],
    ['', 'Fiabilidad', `${st.reliability}%`],
    isV2(spec) ? ['', 'Peso', `${st.weightKg.toLocaleString('es-ES')} kg`] : ['', 'Consumo', `${st.consumption} L/100`],
  ].map(([c, l, v]) => `<div class="${c}"><span>${l}</span><b class="num">${v}</b></div>`).join('');
  $('summary').hidden = false;
  report.final = { rating, model, st, typeName: fullTypeName(spec) };
  hall.setScreen(`RULETA ${model.toUpperCase()}`, fullTypeName(spec).toUpperCase());
  await shop.shot([C.x + 3.1, 2.0, C.z + 7.6], [C.x, 0.8, C.z], 1.6);
  endPhase('report', 'informe', 14);
  shop.controls.autoRotate = false; // gira el coche, no la cámara
}

// 15 · Informe: la cámara va a la mesa del fondo, se pone cenital y la hoja sale de la impresora.
// Después se puede bajar por la hoja con la rueda o arrastrando (sin barra de desplazamiento).
const reportCam = { on: false, goal: new THREE.Vector3(), off: new THREE.Vector3(), min: 0, max: 0 };
shop.onFrame.add((dt) => {
  if (!reportCam.on) return;
  const k = 1 - Math.exp(-dt * 6);
  shop.controls.target.lerp(reportCam.goal, k);
  shop.camera.position.copy(shop.controls.target).add(reportCam.off);
});
const scrollReport = (dx) => {
  if (!reportCam.on || phase !== 'done') return;
  reportCam.goal.x = Math.min(reportCam.max, Math.max(reportCam.min, reportCam.goal.x + dx));
};
$('scene').addEventListener('wheel', (e) => { if (reportCam.on) { e.preventDefault(); scrollReport(e.deltaY * 0.0009 * reportCam.off.y); } }, { passive: false });
let dragY = null;
$('scene').addEventListener('pointerdown', (e) => { if (reportCam.on) dragY = e.clientY; });
window.addEventListener('pointerup', () => (dragY = null));
window.addEventListener('pointermove', (e) => { if (dragY == null || !reportCam.on) return; scrollReport((dragY - e.clientY) * 0.0016 * reportCam.off.y); dragY = e.clientY; });

function reportData() {
  const r = report.rows, f = report.final, d = report.dyno;
  const today = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const row = (label, key) => { const it = r[key]; return it ? [label, it.value, it.tier ? RARITY[it.tier].name : '', it.tier ? RARITY[it.tier].color : ''] : null; };
  const clean = (rows) => rows.filter(Boolean);
  return {
    serial: report.serial, date: today, model: `Ruleta ${f.model}`, type: f.typeName, score: f.rating,
    ok: !extras.qc || extras.qc.defect < 0,
    sections: [
      { title: 'Motor', rows: clean([row('Tipo', 'family'), row('Configuración', 'engine'), row('Cilindrada', 'intake'), row('Admisión', 'turbo'), row('Rendimiento', 'perf'), d && ['Banco de potencia', `${d.hp} CV a ${d.rpm} rpm`], d && ['Par máximo', `${d.nm} Nm`]]) },
      { title: 'Chasis y montaje', rows: clean([row('Chasis', 'chassis'), row('Tracción', 'traction'), row('Aerodinámica', 'aero'), row('Pintura', 'paint'), row('Ruedas y frenos', 'tires')]) },
      { title: 'Prestaciones', rows: [['0-100 km/h', `${f.st.t0100.toFixed(1)} s`], ['Velocidad punta', `${Math.round(f.st.vmax)} km/h`], ...(f.st.weightKg ? [['Peso', `${f.st.weightKg.toLocaleString('es-ES')} kg`], ['Potencia por tonelada', `${Math.round(f.st.pw)} CV/t`]] : []), ['Fiabilidad', `${f.st.reliability} %`], ['Consumo', `${f.st.consumption} L/100 km`]] },
      { title: 'Control de calidad', rows: clean([row('Resultado', 'qc')]) },
    ],
  };
}

async function runReport() {
  if (busy || !report.final) return;
  beginPhase();
  setStep(15);
  caption('Paso 15 · Informe', 'Imprimiendo…', '');
  document.body.classList.add('reporting');
  await fade(1, 0.8);
  hall.spinning = false;
  hall.leave();
  garage.group.visible = true;
  showcase.restoreLights();
  shop.controls.minDistance = 0.1; // los controles de órbita no dejarían acercarse tanto
  // Cenital y a una distancia a la que la hoja cabe de ancho en pantalla
  const slot = desk.slotWorld(), laneZ = desk.laneZ(), topY = desk.topY();
  const aspect = shop.camera.aspect || 1.6;
  const h = Math.max(1.15, (aspect < 1 ? 0.5 : 0.82) / (0.65 * aspect)); // la hoja ocupa ~55 % del ancho (casi todo en vertical)
  reportCam.off.set(0.16 * h, h, 0); // ligeramente desde +x: la parte de arriba de la hoja queda arriba en pantalla
  const start = new THREE.Vector3(slot.x - 0.25, topY, laneZ);
  // Viaje hasta la mesa: primero un plano de la mesa y luego baja hasta quedar cenital
  shop.camera.position.set(STATIONS.desk.x + 2.5, 4.2, STATIONS.desk.z + 6.5);
  shop.controls.target.set(STATIONS.desk.x, topY, STATIONS.desk.z);
  fade(0, 0.9);
  await shop.shot([STATIONS.desk.x + 0.4, 2.6, STATIONS.desk.z + 2.6], [STATIONS.desk.x, topY, STATIONS.desk.z], 2.0);
  const p0 = shop.camera.position.clone(), t0 = shop.controls.target.clone();
  const p1 = start.clone().add(reportCam.off);
  await tween(1.6, (t) => { shop.camera.position.lerpVectors(p0, p1, t); shop.controls.target.lerpVectors(t0, start, t); }, ease.inOutCubic);
  reportCam.goal.copy(start);
  reportCam.on = true;
  // Impresión: la cámara sigue el borde de la hoja que va saliendo
  await desk.print(reportData(), sfx, (l) => { reportCam.goal.x = Math.min(slot.x - 0.25, slot.x - l + 0.3 * h); });
  await desk.stamp(!extras.qc || extras.qc.defect < 0, sfx);
  sfx.fanfare();
  [reportCam.min, reportCam.max] = desk.paperRange();
  reportCam.goal.x = reportCam.min;
  $('skipBtn').hidden = true;
  $('nextBtn').hidden = true;
  $('raceBtn').hidden = false;
  $('final').hidden = false;
  clock.scale = 1;
  document.body.classList.remove('building');
  phase = 'done';
  busy = false;
}

const PHASES = { chassis: () => runChassis(), traction: () => runTraction(), aero: () => runAero(), paint: () => runPaint(), wheels: () => runWheels(), dyno: () => runDyno(), qc: () => runQC(), present: () => runPresent(), report: () => runReport() };

$('nextBtn').addEventListener('click', () => (PHASES[phase] || PHASES.chassis)().catch((err) => {
  console.error(err);
  busy = false;
  clock.scale = 1;
  document.body.classList.remove('building');
  $('reel').hidden = true;
  $('skipBtn').hidden = true;
  caption('Error en el montaje', 'Algo ha fallado', 'No se pudo montar este coche. Prueba a construir otro motor.', true);
  $('nextBtn').disabled = true;
  $('final').hidden = false;
}));

// ---------- Partida multijugador: sala, construcción de cada uno y carrera ----------
let room = null;        // HostRoom (anfitrión), GuestRoom (invitado) o null (solo)
let raceOn = false;     // hay una carrera en pantalla
const raceScene = new RaceScene(shop);
const BOT_NAMES = ['Turbo Tina', 'Pistón Pepe', 'Rueda Rita', 'Bujía Bruno', 'Cárter Carla', 'Embrague Edu'];
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } } };
const playerName = () => ($('nameInput').value.trim() || 'Piloto').slice(0, 16);
$('nameInput').value = store.get('rm-name') || '';
// Modo de juego: lo elige quien juega solo o quien crea la sala; los invitados juegan al de la sala
let pickedMode = MODES[store.get('rm-mode')] ? store.get('rm-mode') : 'classic';
function gameMode() { return room ? room.mode || 'classic' : pickedMode; }
function showMode() {
  for (const b of document.querySelectorAll('#modePick button')) b.setAttribute('aria-pressed', b.dataset.mode === pickedMode ? 'true' : 'false');
  $('modeDesc').textContent = MODES[pickedMode].desc;
}
for (const b of document.querySelectorAll('#modePick button')) b.addEventListener('click', () => { pickedMode = b.dataset.mode; store.set('rm-mode', pickedMode); showMode(); });
showMode();
const linkCode = cleanCode(new URLSearchParams(location.search).get('sala'));
if (linkCode) { $('codeInput').value = linkCode; $('introMsg').textContent = `Te han invitado a la sala ${linkCode}: escribe tu nombre y pulsa «Unirse».`; }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtTime = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
const stateText = (p) => (p.state === 'ready' ? (p.bot ? 'Bot · listo' : 'Listo') : p.state === 'building' ? `Paso ${p.step || 1}/15` : 'En la sala');
const introError = (msg) => { $('introMsg').textContent = msg; $('introMsg').classList.add('error'); };

// El coche terminado tal y como corre (lo que se manda al anfitrión)
function myCarEntry() {
  return {
    spec: { ...rig.spec }, model: report.final.model, typeName: report.final.typeName, rating: report.final.rating,
    tires: extras.tires ? { id: extras.tires.id, bonus: extras.tires.bonus } : null,
    qc: extras.qc ? { penalty: extras.qc.penalty } : null,
  };
}
function botEntry() {
  const c = carFromSeed(newSeed(), gameMode());
  return { spec: c.spec, model: c.model, typeName: fullTypeName(c.spec), rating: carStats(c.spec).rating, tires: { id: c.tires.id, bonus: c.tires.bonus }, qc: { penalty: c.qc.penalty } };
}

function renderPlayers(players) {
  if (!room) return; // avisos que llegan después de salir de la sala
  $('playersList').innerHTML = players.map((p) => `<li><i class="dot ${p.state}"></i><b>${esc(p.name)}${p.id === room.myId ? ' (tú)' : ''}${p.id === 'host' ? ' · anfitrión' : ''}</b><span>${stateText(p)}</span></li>`).join('');
  $('rpList').innerHTML = players.map((p) => `<li><i class="dot ${p.state}"></i><b>${esc(p.name)}</b><span>${stateText(p)}</span></li>`).join('');
  // El invitado no sabe el modo hasta que llega el primer mensaje de la sala
  $('roomMode').textContent = room.mode ? `Modo ${MODES[room.mode].name}` : '';
  $('roomMode').title = room.mode ? MODES[room.mode].desc : '';
  if (room.isHost) {
    $('roundBtn').disabled = players.length < 2;
    $('addBotBtn').disabled = players.length >= MAX_PLAYERS;
    $('lobbyMsg').textContent = players.length < 2 ? 'Comparte el código o el enlace. Puedes añadir bots para completar la parrilla.' : `${players.length} pilotos en la sala.`;
    maybeStartRace(players);
  } else {
    $('lobbyMsg').textContent = 'Esperando a que el anfitrión empiece la partida…';
  }
  const readyN = players.filter((p) => p.state === 'ready').length;
  $('chipCount').textContent = `${readyN}/${players.length}`;
  $('rpCount').textContent = `${readyN}/${players.length} listos`;
  const waiting = players.filter((p) => p.state !== 'ready').length;
  $('rpMsg').textContent = $('raceBtn').dataset.sent ? (waiting ? `Esperando a ${waiting} piloto${waiting > 1 ? 's' : ''}…` : '¡Todos listos! Empieza la carrera…') : '';
}

// En el móvil la lista de la sala se abre y se cierra desde la barra superior
function setRoomOpen(open) {
  $('roomPanel').classList.toggle('open', open);
  $('roomChip').setAttribute('aria-expanded', open ? 'true' : 'false');
}
$('roomChip').addEventListener('click', () => setRoomOpen(!$('roomPanel').classList.contains('open')));
function showLobby() {
  $('intro').hidden = true;
  $('roomChip').hidden = true; setRoomOpen(false);
  $('results').hidden = true;
  $('roomPanel').hidden = true;
  $('lobby').hidden = false;
  $('roomCode').textContent = room.code;
  $('rpCode').textContent = room.code;
  const link = `${location.origin}${location.pathname}?sala=${room.code}`;
  $('roomLink').value = link;
  history.replaceState(null, '', `?sala=${room.code}${window.__debug ? '&debug' : ''}`);
  $('hostActions').hidden = !room.isHost;
  renderPlayers(room.players);
}
function leaveRoom(msg) {
  $('roomChip').hidden = true; setRoomOpen(false);
  if (room) { room.handlers = {}; room.close(); }
  room = null;
  document.body.classList.remove('in-room');
  $('lobby').hidden = true; $('roomPanel').hidden = true; $('results').hidden = true;
  stopRace();
  $('intro').hidden = false;
  history.replaceState(null, '', location.pathname + (window.__debug ? '?debug' : ''));
  if (msg) introError(msg); else { $('introMsg').classList.remove('error'); }
}
function wireRoom() {
  document.body.classList.add('in-room');
  room.on('players', renderPlayers);
  room.on('start', (seed) => startMyBuild(seed));
  room.on('race', (r) => runRace(r));
  room.on('race-msg', onRaceMsg);
  room.on('rstate', onRemoteRows);
  room.on('rres', (rows) => { if (raceOn) showResults(rows); });
  room.on('lobbyBack', () => { stopRace(); showLobby(); });
  room.on('closed', (why) => leaveRoom(why));
}

$('hostBtn').addEventListener('click', async () => {
  store.set('rm-name', $('nameInput').value.trim());
  $('hostBtn').disabled = true;
  $('introMsg').classList.remove('error'); $('introMsg').textContent = 'Creando la sala…';
  try {
    room = new HostRoom(playerName(), pickedMode);
    await room.create();
    wireRoom();
    showLobby();
  } catch (err) { console.error(err); room = null; introError(err.message || 'No se pudo crear la sala.'); }
  $('hostBtn').disabled = false;
});
$('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = cleanCode($('codeInput').value);
  if (code.length !== 4) { introError('El código de la sala tiene 4 caracteres.'); return; }
  store.set('rm-name', $('nameInput').value.trim());
  $('introMsg').classList.remove('error'); $('introMsg').textContent = `Entrando en la sala ${code}…`;
  try {
    room = new GuestRoom(playerName());
    wireRoom();
    await room.join(code);
    showLobby();
  } catch (err) { console.error(err); if (room) room.close(); room = null; document.body.classList.remove('in-room'); introError(err.message || 'No se pudo entrar en la sala.'); }
});
$('codeInput').addEventListener('input', () => { $('codeInput').value = cleanCode($('codeInput').value); });
$('copyLink').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('roomLink').value); $('copyLink').textContent = '¡Copiado!'; } catch { $('roomLink').select(); }
  setTimeout(() => ($('copyLink').textContent = 'Copiar enlace'), 1600);
});
$('addBotBtn').addEventListener('click', () => {
  const used = new Set(room.players.map((p) => p.name));
  room.addBot(BOT_NAMES.find((n) => !used.has(n)) || 'Bot', botEntry());
});
$('leaveBtn').addEventListener('click', () => leaveRoom());
$('roundBtn').addEventListener('click', () => startRound());

function startRound() {
  // Los bots estrenan coche en cada ronda
  for (const p of room.players) if (p.bot) p.car = botEntry();
  const seed = room.startRound(() => newSeed());
  startMyBuild(seed);
}
function startMyBuild(seed) {
  stopRace();
  $('lobby').hidden = true; $('results').hidden = true; $('intro').hidden = true;
  $('roomPanel').hidden = false; $('roomChip').hidden = false;
  delete $('raceBtn').dataset.sent;
  ac();
  if (actx && actx.state === 'suspended') actx.resume();
  runBuild(seed);
}

// ---------- Carrera en directo ----------
// Cada navegador simula su coche (el anfitrión, además, los bots) y manda su posición 10 veces por
// segundo; el anfitrión reparte las de todos y, al final, reúne las llegadas y da la clasificación.
const BOT_SKILLS = [0.82, 0.55, 0.4, 0.7, 0.48];
let race = null;
let netTimer = null, resultsTimer = null, raceTimer = null, resultsShown = false;
const finishes = new Map();   // id -> { time, dnf, best, s }
const lastRows = new Map();   // posiciones de los invitados (para reenviarlas)
const reported = new Set();

// Al terminar el informe: listo para correr (en solo, contra tres bots)
$('raceBtn').addEventListener('click', () => {
  if (!rig || !report.final) return;
  if (!room) {
    const entries = [{ id: 'me', name: playerName(), ...myCarEntry() }];
    const bots = {};
    BOT_NAMES.slice(0, 3).forEach((name, i) => { entries.push({ id: 'bot' + i, name, ...botEntry() }); bots['bot' + i] = BOT_SKILLS[i]; });
    runRace({ seed: newSeed(), entries, bots }, 'me');
    return;
  }
  $('raceBtn').dataset.sent = '1';
  $('raceBtn').disabled = true;
  room.ready(myCarEntry());
  renderPlayers(room.players);
});

// El anfitrión lanza la carrera cuando todos tienen su coche
function maybeStartRace(players) {
  if (!room.locked || raceOn || raceTimer) return;
  if (!players.length || players.some((p) => p.state !== 'ready' || !p.car)) return;
  raceTimer = setTimeout(() => {
    raceTimer = null;
    const ready = room.players.filter((p) => p.car);
    const entries = ready.map((p) => ({ id: p.id, name: p.name, ...p.car }));
    const bots = {};
    ready.filter((p) => p.bot).forEach((p, i) => (bots[p.id] = BOT_SKILLS[i % BOT_SKILLS.length]));
    const r = { seed: newSeed(), entries, bots };
    room.startRace(r);
    runRace(r);
  }, 1500);
}

async function runRace(r, myId = room ? room.myId : 'me') {
  if (raceOn) return;
  raceOn = true; race = r; resultsShown = false;
  finishes.clear(); lastRows.clear(); reported.clear(); prevFlags.clear();
  busy = true;
  $('roomPanel').hidden = true; $('roomChip').hidden = true; setRoomOpen(false);
  $('final').hidden = true; $('lobby').hidden = true; $('results').hidden = true;
  $('raceBtn').disabled = false;
  await fade(1, 0.9);
  // Fuera del taller (y del salón, si se venía de allí)
  reportCam.on = false;
  document.body.classList.remove('reporting', 'building');
  document.body.classList.add('racing');
  hall.leave(); showcase.restoreLights(); stopRumble();
  garage.group.visible = false;
  shop.controls.enabled = false; shop.controls.autoRotate = false; shop.controls.minDistance = 0.1; shop.controls.maxDistance = 2000;
  raceScene.enter();
  const simulate = [myId, ...(!room || room.isHost ? Object.keys(r.bots || {}) : [])];
  raceScene.setup(r, myId, simulate);
  // Plano de la parrilla desde delante y de lado
  const me = raceScene.me;
  const p = me.root.getWorldPosition(new THREE.Vector3());
  shop.camera.position.copy(p).add(new THREE.Vector3(14, 4, 10));
  shop.controls.target.copy(p).add(new THREE.Vector3(0, 1, 0));
  drawMapBase();
  $('raceHud').hidden = false; $('speedFx').hidden = false;
  await fade(0, 0.9);
  toast('Pulsa FRENAR o NITRO al apagarse las luces', 2400);
  startRumble(); setRumble(0.12);
  if (room) netTimer = setInterval(sendNet, 100);
  await wait(1.6);
  await raceScene.countdown(sfx, wait);
  toast('¡YA!', 800);
  sfx.whoosh();
}

function sendNet() {
  if (!room || !raceOn) return;
  const rows = raceScene.snapshot();
  if (room.isHost) {
    for (const row of lastRows.values()) rows.push(row);
    room.broadcast({ t: 'rstate', rows });
  } else room.send({ t: 'rs', rows });
}
function onRaceMsg(id, m) {
  if (!raceOn) return;
  if (m.t === 'rs') for (const row of m.rows) { if (row[0] !== id) continue; lastRows.set(id, row); raceScene.remote(...row); }
  if (m.t === 'rfin') { finishes.set(id, m.f); checkResults(); }
}
function onRemoteRows(rows) { if (raceOn) for (const row of rows) if (row[0] !== raceScene.myId) raceScene.remote(...row); }

// Llegadas: el anfitrión (o yo, en solo) junta las de todos; si alguien tarda, 30 s de margen
function reportFinish(c) {
  const r = c.racer;
  const rec = { time: r.finishT, dnf: r.state === 'out', best: r.laps.length ? Math.min(...r.laps) : null, s: r.s };
  reported.add(c.id);
  if (!room || room.isHost) { finishes.set(c.id, rec); checkResults(); }
  else { finishes.set(c.id, rec); room.send({ t: 'rfin', f: rec }); }
}
function checkResults() {
  if (resultsShown || (room && !room.isHost)) return;
  const total = race.entries.length;
  if (finishes.size >= total) { finalizeRace(); return; }
  if (!resultsTimer && [...finishes.values()].some((f) => !f.dnf)) resultsTimer = setTimeout(finalizeRace, 30000);
}
function finalizeRace() {
  if (resultsShown) return;
  clearTimeout(resultsTimer); resultsTimer = null;
  const rows = race.entries.map((e) => {
    const f = finishes.get(e.id);
    const c = raceScene.cars.find((x) => x.id === e.id);
    return f ? { id: e.id, ...f } : { id: e.id, time: null, dnf: false, unfinished: true, best: null, s: c ? c.s : 0 };
  });
  const rank = (x) => (x.time != null ? 0 : x.unfinished ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || (a.time != null ? a.time - b.time : b.s - a.s));
  if (room) room.broadcast({ t: 'rres', res: rows });
  showResults(rows);
}

let toastTimer = null;
function toast(text, ms = 1800) {
  $('raceToast').textContent = text; $('raceToast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('raceToast').hidden = true), ms);
}
// Avisos de mi coche (frenadas, trompos…): aparecen sobre los botones
let fbTimer = null;
function feedback(text, kind) {
  const el = $('raceFb');
  el.textContent = text; el.className = `race-feedback show ${kind}`;
  clearTimeout(fbTimer);
  fbTimer = setTimeout(() => (el.className = 'race-feedback'), 1300);
  if (kind === 'bad') { sfx.thud(0.6); noise(0.35, 0.12, 2200, 1.5); }
  if (kind === 'good') tone(1180, 0.12, 'triangle', 0.07);
}

// Minimapa
let mapInfo = null;
function drawMapBase() {
  mapInfo = RaceScene.outline();
  const cv = $('rhMap'), c = cv.getContext('2d'), pad = 10;
  const sc = Math.min((cv.width - 2 * pad) / mapInfo.w, (cv.height - 2 * pad) / mapInfo.h);
  mapInfo.tf = (x, z) => [pad + x * sc + (cv.width - 2 * pad - mapInfo.w * sc) / 2, pad + z * sc + (cv.height - 2 * pad - mapInfo.h * sc) / 2];
  const off = document.createElement('canvas'); off.width = cv.width; off.height = cv.height;
  const o = off.getContext('2d');
  o.strokeStyle = 'rgba(255,248,238,0.85)'; o.lineWidth = 4; o.lineJoin = 'round';
  o.beginPath();
  mapInfo.pts.forEach(([x, z], i) => { const [a, b] = mapInfo.tf(x, z); if (i) o.lineTo(a, b); else o.moveTo(a, b); });
  o.closePath(); o.stroke();
  mapInfo.base = off;
  void c;
}
function drawMap() {
  if (!mapInfo) return;
  const cv = $('rhMap'), c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  c.drawImage(mapInfo.base, 0, 0);
  for (const car of raceScene.cars) {
    const [x, z] = mapInfo.map(car.s), [a, b] = mapInfo.tf(x, z);
    const me = car === raceScene.me;
    c.fillStyle = car.entry.spec.color; c.strokeStyle = me ? '#fff' : 'rgba(0,0,0,0.6)'; c.lineWidth = me ? 2.5 : 1;
    c.beginPath(); c.arc(a, b, me ? 5.5 : 4, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}

// Líneas de velocidad en los bordes de la pantalla
const fx = { lines: Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), sp: 0.6 + Math.random() })) };
function drawSpeedFx(dt, amount, nitro) {
  const cv = $('speedFx'), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const c = cv.getContext('2d');
  c.clearRect(0, 0, w, h);
  if (amount <= 0.01) return;
  const cx = w / 2, cy = h * 0.46, R = Math.hypot(w, h) / 2;
  c.lineCap = 'round';
  for (const l of fx.lines) {
    l.r += dt * l.sp * (1.2 + amount * 2.5);
    if (l.r > 1) { l.r = 0.35 + Math.random() * 0.2; l.a = Math.random() * Math.PI * 2; }
    const r0 = R * l.r, r1 = R * Math.min(1.2, l.r + 0.08 + amount * 0.18);
    c.strokeStyle = nitro ? `rgba(140,210,255,${0.55 * amount})` : `rgba(255,255,255,${0.4 * amount})`;
    c.lineWidth = 1.5 + amount * 2;
    c.beginPath(); c.moveTo(cx + Math.cos(l.a) * r0, cy + Math.sin(l.a) * r0); c.lineTo(cx + Math.cos(l.a) * r1, cy + Math.sin(l.a) * r1); c.stroke();
  }
}

// HUD de cada fotograma
const prevFlags = new Map();
let lastHudT = performance.now(), lastNitroSnd = false;
function updateRaceHud() {
  const rs = raceScene, me = rs.me;
  if (!me) return;
  const now = performance.now(), dt = Math.min(0.1, (now - lastHudT) / 1000); lastHudT = now;
  const order = rs.standings(), L = rs.L, total = order.length;
  const pos = order.indexOf(me) + 1;
  $('rhPos').textContent = pos; $('rhPosOf').textContent = `/${total}`;
  const lap = Math.min(LAPS, Math.max(1, Math.floor(Math.max(0, me.s) / L) + 1));
  $('rhLap').textContent = me.flags & 16 ? 'Meta' : `${lap}/${LAPS}`;
  const leader = order[0];
  $('rhList').innerHTML = order.map((c, i) => {
    const gap = c.flags & 8 ? 'Fuera' : c.flags & 16 ? 'Meta' : i === 0 ? 'Líder' : `+${Math.max(0, (leader.s - c.s) / Math.max(12, c.v)).toFixed(1)} s`;
    const cls = [c === me ? 'me' : '', i >= 3 && c !== me ? 'extra' : ''].join(' ');
    return `<li class="${cls}"><span class="pos">${i + 1}</span><i class="dot" style="background:${c.entry.spec.color}"></i><b>${esc(c.entry.name)}</b><span class="gap">${gap}</span></li>`;
  }).join('');
  const kmh = Math.round(Math.max(0, me.v) * 3.6);
  $('rhSpeed').textContent = kmh;
  const r = me.racer;
  $('rhNitro').style.width = `${Math.round((r.nitro || 0) * 100)}%`;
  $('nitroBtn').classList.toggle('on', !!r.nitroOn);
  $('nitroBtn').classList.toggle('empty', (r.nitro || 0) < 0.05);
  $('rhDraft').hidden = !r.drafting;
  // Ayuda de frenada
  const hint = rs.running ? r.brakeHint() : null;
  const box = $('rhBrake');
  if (!hint || hint.done) box.hidden = true;
  else if (hint.flat) { box.hidden = false; box.className = 'rh-brake flat'; $('rbText').textContent = 'Curva a fondo'; }
  else {
    box.hidden = false;
    const span = 160, x = (d) => Math.min(1, Math.max(0, (120 - d) / span));
    $('rbMark').style.left = `${x(hint.d) * 100}%`;
    $('rbWin').style.left = `${x(hint.tol) * 100}%`;
    $('rbWin').style.width = `${(x(-hint.tol) - x(hint.tol)) * 100}%`;
    const st = hint.d > hint.tol ? 'wait' : hint.d >= -hint.tol ? 'now' : 'late';
    box.className = `rh-brake ${st}`;
    $('rbText').textContent = st === 'wait' ? `Curva a ${Math.round(hint.dist)} m` : st === 'now' ? '¡FRENA!' : '¡TARDE!';
  }
  // Avisos de mi coche y de los demás
  while (r.feedback.length) { const f = r.feedback.shift(); feedback(f.text, f.kind); }
  for (const c of rs.cars) {
    const was = prevFlags.get(c.id) || 0, f = c.flags;
    if (c !== me) {
      if ((f & 8) && !(was & 8)) toast(`¡A ${c.entry.name} le revienta el motor!`, 2200);
      else if ((f & 4) && !(was & 4)) toast(`${c.entry.name} hace un trompo`, 1400);
    }
    if ((f & 16) && !(was & 16) && rs.running) {
      const p = order.indexOf(c) + 1;
      if (c === me) toast(p === 1 ? '¡Has ganado!' : `¡Meta! Llegas ${p}.º`, 2600);
      else if (p === 1) toast(`¡${c.entry.name} gana la carrera!`, 2200);
    }
    prevFlags.set(c.id, f);
    if (c.local && (c.flags & 24) && !reported.has(c.id)) reportFinish(c);
  }
  // Sonido del motor: sube de vueltas y cambia de marcha
  if (rs.running) {
    const gear = 16, k = ((me.v % gear) / gear) * 0.75 + Math.min(0.25, me.v / 300);
    setRumble(me.flags & 8 ? 0.02 : 0.1 + k);
    if ((me.flags & 1) && !lastNitroSnd) sfx.whoosh();
    lastNitroSnd = !!(me.flags & 1);
  }
  drawSpeedFx(dt, Math.min(1, Math.max(0, (me.v - 22) / 40)) + (me.flags & 1 ? 0.35 : 0), me.flags & 1);
  drawMap();
}
shop.onFrame.add(() => { if (raceOn) updateRaceHud(); });

// Controles: teclado y botones (táctiles)
const raceKeys = { brake: ['Space', 'ArrowDown', 'KeyS'], nitro: ['ShiftLeft', 'ShiftRight', 'ArrowUp', 'KeyW', 'KeyN'] };
window.addEventListener('keydown', (e) => {
  if (!raceOn || e.repeat) return;
  if (raceKeys.brake.includes(e.code)) { e.preventDefault(); raceScene.brake(); }
  if (raceKeys.nitro.includes(e.code)) { e.preventDefault(); raceScene.nitro(true); }
});
window.addEventListener('keyup', (e) => { if (raceOn && raceKeys.nitro.includes(e.code)) raceScene.nitro(false); });
$('brakeBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); raceScene.brake(); });
$('nitroBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); $('nitroBtn').setPointerCapture(e.pointerId); raceScene.nitro(true); });
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) $('nitroBtn').addEventListener(ev, () => raceScene.nitro(false));

function stopRace() {
  if (raceTimer) { clearTimeout(raceTimer); raceTimer = null; }
  clearInterval(netTimer); netTimer = null;
  clearTimeout(resultsTimer); resultsTimer = null;
  raceOn = false;
  raceScene.leave();
  $('raceHud').hidden = true; $('raceToast').hidden = true; $('speedFx').hidden = true;
  document.body.classList.remove('racing');
  garage.group.visible = true;
  shop.controls.maxDistance = 24;
  stopRumble();
}

function showResults(rows) {
  if (resultsShown) return;
  resultsShown = true;
  const rs = raceScene;
  const winner = rows.find((x) => x.time != null);
  const meIdx = rows.findIndex((x) => x.id === rs.myId), meRow = rows[meIdx];
  $('resTitle').textContent = meRow && meRow.dnf ? 'Motor roto: abandono' : meRow && meRow.time == null ? 'No llegaste a la meta' : meIdx === 0 ? '¡Has ganado!' : `Has quedado ${meIdx + 1}.º`;
  $('resBody').innerHTML = rows.map((x, i) => {
    const e = race.entries.find((q) => q.id === x.id) || { name: '?', model: '', typeName: '' };
    const t = x.dnf ? 'Abandono' : x.time == null ? 'Sin terminar' : x === winner ? fmtTime(x.time) : `+${(x.time - winner.time).toFixed(2)} s`;
    return `<tr class="${x.id === rs.myId ? 'me' : ''}"><td>${i + 1}</td><td><b>${esc(e.name)}</b></td><td>Ruleta ${esc(e.model)}<small>${esc(e.typeName)}</small></td><td class="t">${t}</td><td class="t">${x.best ? fmtTime(x.best) : '—'}</td></tr>`;
  }).join('');
  const host = !room || room.isHost;
  $('newRoundBtn').hidden = !host;
  $('toLobbyBtn').hidden = !room || !room.isHost;
  $('newRoundBtn').textContent = room ? 'Otra ronda' : 'Construir otro coche';
  $('resMsg').textContent = host ? '' : 'Esperando a que el anfitrión decida la siguiente ronda…';
  clearInterval(netTimer); netTimer = null;
  setTimeout(() => { $('results').hidden = false; }, 1200);
  busy = false;
}
$('newRoundBtn').addEventListener('click', () => {
  $('results').hidden = true;
  if (room) startRound();
  else { stopRace(); runBuild(newSeed()); }
});
$('toLobbyBtn').addEventListener('click', () => { stopRace(); room.backToLobby(); showLobby(); });

$('skipBtn').addEventListener('click', () => { clock.scale = 8; stopRumble(); });
$('againBtn').addEventListener('click', () => { stopRumble(); runBuild(newSeed()); });
$('startBtn').addEventListener('click', async () => {
  ac();
  if (actx && actx.state === 'suspended') actx.resume();
  $('intro').hidden = true;
  await document.fonts.ready;
  const q = new URLSearchParams(location.search).get('seed');
  runBuild(q && /^\d+$/.test(q) ? +q : newSeed());
});
