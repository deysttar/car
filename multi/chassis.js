// Fase de chasis: montaje del coche en el elevador, apertura del capó y traslado del motor con la grúa.
// La carrocería de car3d.js es una pieza extruida, así que el hueco del motor se abre con planos de
// corte (clipping) y se tapa con un capó propio que sigue el perfil medido de cada coche.
import * as THREE from 'three';
import { buildCar } from '../car3d.js';
import { tween, wait, ease, grow, mat, box, cyl } from './engine3d.js';
import { BEAM_Y, CART, LIFT_X } from './garage.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const isWheel = (o) => { for (let p = o; p; p = p.parent) if (p.userData.isWheel) return true; return false; };
const isGlass = (o) => o.material && o.material.color && o.material.color.getHexString() === '203546';
const BAY_DEPTH = 0.95;
const HOOD_OPEN = 1.45; // casi vertical, para que la tapa no tape el vano desde la cámara
const FRONT_PANEL = 0.16, COWL = 0.09;

// Materiales del vano (plástico negro, metal, depósitos translúcidos)
const VM = {
  liner: () => mat('#26282c', { roughness: 0.85, side: THREE.DoubleSide }),
  plastic: () => mat('#1b1c1f', { roughness: 0.75 }),
  plastic2: () => mat('#2c2e33', { roughness: 0.6 }),
  bolt: () => mat('#c9ced4', { roughness: 0.3, metalness: 0.8 }),
  hose: () => mat('#141518', { roughness: 0.65 }),
  tank: () => new THREE.MeshStandardMaterial({ color: '#e9e6dc', roughness: 0.35, transparent: true, opacity: 0.85, flatShading: true }),
};

export class CarRig {
  // engineBounds: caja del motor completo (con admisión) sin escalar, para dimensionar el vano.
  constructor(holder, spec, engineBounds) {
    this.holder = holder;
    this.spec = spec;
    this.car = buildCar(spec);
    this.car.updateMatrixWorld(true);
    this.body = [...this.car.children];
    this.measure();
    this.computeArches();
    this.planEngine(engineBounds);
    this.addInternals();
    this.addHood();
    this.addInterior();
    this.applyClipping();
    holder.add(this.car);
  }

  // Busca el capó tirando rayos hacia abajo desde el morro hasta el parabrisas.
  measure() {
    const car = this.car;
    const rc = new THREE.Raycaster();
    const bb = new THREE.Box3().setFromObject(car);
    const hit = (o, d) => { rc.set(o, d); return rc.intersectObject(car, true).find((h) => !isWheel(h.object)) || null; };
    const down = (x, z) => hit(V(x, 6, z), V(0, -1, 0));
    let zS = 0.3, front = null;
    for (const z of [0.3, 0]) {
      for (let x = bb.max.x; x > 0; x -= 0.03) { const h = down(x, z); if (h && h.point.y > 0.3) { front = x; break; } }
      if (front != null) { zS = z; break; }
    }
    if (front == null) front = bb.max.x - 0.2;
    const prof = [];
    let prev = null, hinge = null;
    for (let x = front - 0.02; x > front - 2.0; x -= 0.04) {
      const h = down(x, zS);
      // Los primeros ~25 cm son el morro (parachoques, parrilla, defensa): ahí los huecos y
      // las subidas no cuentan como parabrisas.
      const pastNose = front - x > 0.25;
      if (!h) { if (pastNose) break; continue; }
      if (isGlass(h.object) || (pastNose && prev != null && h.point.y - prev > 0.12)) { hinge = x + 0.04; break; }
      prof.push([x, h.point.y]);
      prev = h.point.y;
    }
    if (hinge == null) hinge = prof.length ? prof[prof.length - 1][0] : front - 0.9;
    hinge = Math.max(hinge, front - 1.85);
    if (front - hinge < 0.7) hinge = front - 0.7;
    const heightAt = (x) => {
      let best = prof[0];
      for (const p of prof) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
      return best ? best[1] : 0.7;
    };
    const x0 = hinge + 0.06, x1 = front - 0.16;
    const inBay = prof.filter(([x]) => x >= x0 && x <= x1).map(([, y]) => y);
    const yCut = (inBay.length ? Math.min(...inBay) : heightAt((x0 + x1) / 2)) - 0.035;
    // Ancho del capó: hasta donde la superficie sigue a la altura del capó. Así no se recortan
    // aletas, pontones ni nada que sobresalga a los lados.
    let edge = 1.4;
    for (const xs of [x0 + 0.1, (x0 + x1) / 2, x1 - 0.1]) {
      const ref = heightAt(xs);
      for (let z = 0.06; z < edge; z += 0.03) {
        const h = down(xs, z);
        if (!h || (z > 0.28 && Math.abs(h.point.y - ref) > 0.07)) { edge = z; break; }
      }
    }
    const hz = Math.max(0.22, edge - 0.09);
    // Bajos de la carrocería: el vano nunca asoma por debajo del coche.
    const under = hit(V((x0 + x1) / 2, -4, 0), V(0, 1, 0));
    const bottom = under ? under.point.y : 0.25;
    const yFloor = Math.min(yCut - 0.15, Math.max(yCut - BAY_DEPTH, bottom + 0.03));
    // Morro corto (furgonetas): el vano sigue por debajo de la cabina, oculto bajo la carrocería.
    const xBack = x0 - Math.min(0.6, Math.max(0, 1.0 - (x1 - x0)));
    this.bay = { front, hinge, x0, x1, xBack, yCut, yFloor, bottom, hz, hingeY: heightAt(hinge), heightAt, prof: prof.filter(([x]) => x >= hinge - 0.01) };
    // Material de carrocería: el que tiene el color del coche (el primer impacto puede ser un embellecedor)
    const want = new THREE.Color(this.spec.color).getHexString();
    car.traverse((o) => { if (!this.bodyMat && o.isMesh && o.material.color && o.material.color.getHexString() === want) this.bodyMat = o.material; });
    this.bodyMat = this.bodyMat || mat(this.spec.color);
    this.carMin = bb.min.x; this.carMax = bb.max.x;
  }

  // Pasos de rueda: la chapa se vacía en media luna alrededor de cada rueda (en el shader) y dentro
  // va un paso de rueda oscuro. Así, al quitar una rueda, se ve el hueco como en un coche real.
  computeArches() {
    const rc = new THREE.Raycaster();
    this.arches = [];
    for (const w of this.body.filter((o) => o.userData.isWheel)) {
      const p = w.position, tire = w.children[0].geometry.parameters;
      const r = tire.radiusTop, wd = tire.height;
      const s = Math.sign(p.z) || 1;
      rc.set(V(p.x, p.y + r * 0.4, s * 5), V(0, 0, -s));
      const hit = rc.intersectObjects(this.body, true).find((h) => !isWheel(h.object));
      const half = hit ? Math.abs(hit.point.z) : 0;
      const zIn = Math.abs(p.z) - wd / 2 - 0.06;
      if (half <= zIn + 0.02) continue; // rueda por fuera de la carrocería (monoplaza)
      this.arches.push({ x: p.x, y: p.y, R: r + 0.05, zIn, half, s });
    }
  }

  // Altura de los bajos de la carrocería en un punto (rayo desde abajo)
  underAt(x, z) {
    const rc = new THREE.Raycaster(V(x, -4, z), V(0, 1, 0));
    const h = rc.intersectObjects(this.body, true).find((i) => !isWheel(i.object));
    return h ? h.point.y : 0.3;
  }

  // Dónde apoya el coche en el elevador: tacos entre las ruedas, bajo los bajos.
  liftPoints() {
    const ws = this.body.filter((o) => o.userData.isWheel);
    const r = (w) => (w.children[0].geometry.parameters ? w.children[0].geometry.parameters.radiusTop : 0.35);
    const fr = ws.filter((w) => w.position.x > 0), rr = ws.filter((w) => w.position.x <= 0);
    let xF = Math.min(1.4, Math.min(...fr.map((w) => w.position.x - r(w))) - 0.22);
    let xR = Math.max(-1.4, Math.max(...rr.map((w) => w.position.x + r(w))) + 0.22);
    if (xF - xR < 0.6) { const m = (xF + xR) / 2; xF = m + 0.3; xR = m - 0.3; }
    const z = 0.55;
    const bottom = Math.max(...[xF, xR].flatMap((x) => [this.underAt(x, z), this.underAt(x, -z)]));
    return { xF, xR, z, bottom };
  }

  // Dónde va el motor y a qué escala: entre las repisas laterales, el panel frontal y la torreta.
  planEngine(fb) {
    const { x0, x1, xBack, yCut, yFloor, hz } = this.bay;
    // Repisas estrechas: el sitio es para el motor
    const ledge = Math.min(0.14, Math.max(0.08, hz * 0.15));
    const ex0 = xBack < x0 - 0.01 ? xBack + 0.05 : x0 + COWL + 0.02;
    const ex1 = x1 - FRONT_PANEL - 0.03;
    const ez = hz - ledge - 0.03;
    // El motor apoya en el suelo del vano: nunca asoma por debajo de los bajos del coche.
    // Nunca se achata: solo se ve con el capó abierto, y si asoma por arriba se oculta al cerrarlo.
    const ey0 = yFloor + 0.02;
    const es = fb.getSize(V());
    const s = Math.min((ex1 - ex0) / es.x, (2 * ez) / es.z);
    const sv = V(s, s, s);
    const L = es.x * s, H = es.y * s, W = es.z * s;
    // Preferimos que el motor quede bajo el hueco visible del capó
    const cx = Math.min(ex1 - L / 2, Math.max(ex0 + L / 2, (x0 + COWL + ex1) / 2));
    // Al bajar entra por el hueco del capó; si su sitio sigue bajo la cabina, luego se desliza atrás.
    const shift = Math.max(0, Math.min(x0 + COWL - (cx - L / 2), ex1 - (cx + L / 2)));
    this.ledge = ledge;
    this.engineSpan = { ex0, ex1 };
    this.place = { s, sv, fb, cx, y0: ey0, L, H, W, top: ey0 + H, shift };
  }

  addInternals() {
    const { x0, x1, xBack, yCut, yFloor, hz, heightAt } = this.bay;
    const car = this.car, ledge = this.ledge;
    const g = this.internals = new THREE.Group();
    const at = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
    // ---- Caja del vano: suelo y paredes de dos caras, sin tapa. Las paredes llegan justo
    // bajo la chapa del capó para que no queden rendijas hacia el interior hueco de la carrocería.
    const liner = VM.liner();
    // El suelo tiene un hueco a la medida del motor: el motor baja más que el suelo y, si no,
    // su mitad de abajo quedaría tapada (parecería cortado). Bajo el hueco va un bolsillo con
    // paredes y una bandeja protectora, como el cubrecárter de un coche real.
    const p = this.place;
    const hx0 = Math.max(xBack + 0.02, p.cx - p.L / 2 - 0.03), hx1 = Math.min(x1 - 0.02, p.cx + p.L / 2 + 0.03);
    const hzz = Math.min(hz - 0.02, p.W / 2 + 0.03);
    const fs = new THREE.Shape();
    fs.moveTo(xBack, -hz); fs.lineTo(x1, -hz); fs.lineTo(x1, hz); fs.lineTo(xBack, hz); fs.lineTo(xBack, -hz);
    const hole = new THREE.Path();
    hole.moveTo(hx0, -hzz); hole.lineTo(hx0, hzz); hole.lineTo(hx1, hzz); hole.lineTo(hx1, -hzz); hole.lineTo(hx0, -hzz);
    fs.holes.push(hole);
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(fs).rotateX(Math.PI / 2), liner);
    at(floor, 0, yFloor, 0).receiveShadow = true;
    const trayY = Math.min(yFloor - 0.004, p.y0 - 0.02);
    if (yFloor - trayY > 0.01) {
      const ph = yFloor - trayY;
      for (const z of [-hzz, hzz]) at(new THREE.Mesh(new THREE.PlaneGeometry(hx1 - hx0, ph), liner), (hx0 + hx1) / 2, trayY + ph / 2, z);
      for (const x of [hx0, hx1]) at(new THREE.Mesh(new THREE.PlaneGeometry(2 * hzz, ph).rotateY(Math.PI / 2), liner), x, trayY + ph / 2, 0);
    }
    at(box(hx1 - hx0, 0.02, 2 * hzz, mat('#1b1c1f', { roughness: 0.6, metalness: 0.3 })), (hx0 + hx1) / 2, trayY - 0.01, 0).receiveShadow = true;
    const topAt = (x) => (x < x0 ? yCut : heightAt(x) - 0.006);
    const wallShape = new THREE.Shape();
    wallShape.moveTo(xBack, yFloor);
    wallShape.lineTo(x1, yFloor);
    for (let x = x1; x >= xBack - 1e-6; x -= 0.04) wallShape.lineTo(x, topAt(x));
    wallShape.lineTo(xBack, topAt(xBack));
    const wallGeo = new THREE.ShapeGeometry(wallShape);
    for (const z of [-hz, hz]) at(new THREE.Mesh(wallGeo, liner), 0, 0, z).receiveShadow = true;
    for (const [x, top] of [[xBack, topAt(xBack)], [x1, topAt(x1)]]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(2 * hz, top - yFloor).rotateY(Math.PI / 2), liner);
      at(w, x, (top + yFloor) / 2, 0);
    }
    // ---- Radiador bajo el panel frontal
    const radH = (yCut - yFloor) * 0.8;
    at(box(0.08, radH, hz * 1.8, mat('#3a3e44', { metalness: 0.4, roughness: 0.5 })), x1 - 0.07, yFloor + radH / 2 + 0.02, 0);
    // ---- Panel frontal (travesaño del radiador) con tornillos y cierre del capó
    const pTop = yCut - 0.012;
    at(box(FRONT_PANEL, 0.05, 2 * hz, VM.plastic()), x1 - FRONT_PANEL / 2, pTop - 0.025, 0);
    at(box(FRONT_PANEL * 0.5, 0.012, 2 * hz - 0.2, VM.plastic2()), x1 - FRONT_PANEL * 0.55, pTop + 0.002, 0);
    const nb = Math.max(4, Math.round(hz * 6));
    for (let i = 0; i < nb; i++) {
      const b = cyl(0.016, 0.016, 0.014, 8, VM.bolt());
      at(b, x1 - FRONT_PANEL * 0.3, pTop + 0.004, -hz + 0.12 + (i * (2 * hz - 0.24)) / (nb - 1));
    }
    at(box(0.05, 0.02, 0.1, VM.bolt()), x1 - FRONT_PANEL * 0.72, pTop + 0.006, 0); // cierre
    // ---- Rejilla del torpedo (junto al parabrisas)
    at(box(COWL, 0.04, 2 * hz, VM.plastic()), x0 + COWL / 2, yCut - 0.032, 0);
    for (let i = 0; i < 9; i++) at(box(COWL * 0.6, 0.006, 0.05, mat('#0d0e10')), x0 + COWL / 2, yCut - 0.011, -hz * 0.6 + (i * hz * 1.2) / 8);
    // ---- Repisas laterales (pasos de rueda) con torretas, depósitos, batería y fusibles
    const lTop = yCut - 0.02;
    const parts = [];
    for (const s of [-1, 1]) {
      const zc = s * (hz - ledge / 2);
      at(box(x1 - FRONT_PANEL - x0 - COWL, 0.04, ledge, VM.plastic()), (x0 + COWL + x1 - FRONT_PANEL) / 2, lTop - 0.02, zc);
      at(box(x1 - FRONT_PANEL - x0 - COWL, 0.18, 0.02, VM.plastic2()), (x0 + COWL + x1 - FRONT_PANEL) / 2, lTop - 0.13, s * (hz - ledge));
      // torreta del amortiguador con tres tornillos
      const tx = x0 + COWL + 0.13, tr = Math.min(0.075, ledge * 0.42);
      at(cyl(tr, tr * 1.15, 0.05, 12, mat('#3c4047', { metalness: 0.5, roughness: 0.4 })), tx, lTop + 0.004, zc);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        at(cyl(0.012, 0.012, 0.012, 6, VM.bolt()), tx + Math.cos(a) * tr * 0.6, lTop + 0.034, zc + Math.sin(a) * tr * 0.6);
      }
      parts.push([tx, zc, tr]);
    }
    this.towers = parts;
    const span = x1 - FRONT_PANEL - (x0 + COWL + 0.25);
    const lw = ledge * 0.78;
    // Lado izquierdo: depósito de refrigerante (tapón amarillo) y caja de fusibles
    const zl = -(hz - ledge / 2), zr = hz - ledge / 2;
    const tankL = Math.min(0.26, span * 0.4);
    at(box(tankL, 0.06, lw, VM.tank()), x1 - FRONT_PANEL - tankL / 2 - 0.03, lTop + 0.005, zl);
    at(cyl(0.035, 0.035, 0.03, 10, mat('#f2c230', { roughness: 0.5 })), x1 - FRONT_PANEL - tankL / 2 - 0.03, lTop + 0.045, zl);
    const fuseL = Math.min(0.2, span * 0.3);
    at(box(fuseL, 0.05, lw, VM.plastic2()), x0 + COWL + 0.25 + fuseL / 2, lTop + 0.0, zl);
    at(box(fuseL * 0.8, 0.006, lw * 0.6, mat('#45484e')), x0 + COWL + 0.25 + fuseL / 2, lTop + 0.026, zl);
    // Lado derecho: depósito del limpiaparabrisas (tapón azul) y batería
    at(box(tankL, 0.055, lw, VM.tank()), x1 - FRONT_PANEL - tankL / 2 - 0.03, lTop + 0.002, zr);
    at(cyl(0.035, 0.035, 0.03, 10, mat('#2f8fd8', { roughness: 0.4 })), x1 - FRONT_PANEL - tankL / 2 - 0.03, lTop + 0.04, zr);
    const batL = Math.min(0.26, span * 0.4);
    const bx = x0 + COWL + 0.25 + batL / 2;
    at(box(batL, 0.06, lw, mat('#202226', { roughness: 0.6 })), bx, lTop + 0.005, zr);
    at(cyl(0.018, 0.018, 0.03, 8, mat('#d6402b')), bx + batL * 0.3, lTop + 0.045, zr - lw * 0.25);
    at(cyl(0.018, 0.018, 0.03, 8, VM.plastic()), bx - batL * 0.3, lTop + 0.045, zr - lw * 0.25);
    this.fillGaps(at, lTop);
    // Pasos de rueda: arco y pared interior oscuros
    const wellM = mat('#16171a', { roughness: 0.9, side: THREE.DoubleSide });
    for (const a of this.arches) {
      const depth = a.half - a.zIn + 0.02;
      const arc = new THREE.Mesh(new THREE.CylinderGeometry(a.R, a.R, depth, 24, 1, true, Math.PI / 2 - 0.2, Math.PI + 0.4).rotateX(Math.PI / 2), wellM);
      at(arc, a.x, a.y, a.s * (a.zIn + depth / 2));
      const wall = new THREE.Mesh(new THREE.CircleGeometry(a.R, 24, -0.2, Math.PI + 0.4), wellM);
      at(wall, a.x, a.y, a.s * a.zIn);
    }
    car.add(g);

    // Bastidor de largueros (lo primero que se apoya en el elevador); llega hasta el vano.
    const frameM = mat('#24272c', { roughness: 0.6, metalness: 0.4 });
    const fx0 = this.carMin + 0.35, fx1 = xBack - 0.02;
    const len = Math.max(0.6, fx1 - fx0), cx = (fx0 + fx1) / 2;
    this.frame = new THREE.Group();
    // Pegado a los bajos de cada carrocería (no todas tienen el suelo a la misma altura)
    const fy = this.underAt(cx, 0.42) - 0.06;
    for (const z of [-0.42, 0.42]) { const r = box(len, 0.12, 0.1, frameM); r.position.set(cx, fy, z); this.frame.add(r); }
    for (let i = 0; i < 5; i++) { const c = box(0.1, 0.1, 0.84, frameM); c.position.set(cx - len / 2 + 0.15 + (i * (len - 0.3)) / 4, fy, 0); this.frame.add(c); }
    car.add(this.frame);
  }

  // Rellena los huecos que deja el motor con piezas de verdad: filtro de aire, servofreno,
  // centralita, mazos de cables y el travesaño que lo sujeta. Cada una se ajusta a su hueco.
  fillGaps(at, lTop) {
    const { x0, yCut, yFloor, hz } = this.bay, p = this.place, ledge = this.ledge;
    const ez = hz - ledge - 0.03;
    const ex0 = p.cx - p.L / 2, ex1 = p.cx + p.L / 2;
    const side = ez - p.W / 2;                        // hueco a cada lado del motor
    const rear = ex0 - (x0 + COWL);                   // hueco entre motor y torpedo
    const hMax = Math.max(0.05, yCut - 0.06 - yFloor);
    const black = VM.plastic(), dark = VM.plastic2(), bolt = VM.bolt();
    if (side > 0.07) {
      const w = Math.min(side - 0.02, 0.32);
      // Filtro de aire (lado izquierdo, delante) con tapa nervada y tubo hacia el motor
      const fl = Math.min(0.38, p.L * 0.55), fh = Math.min(hMax, 0.2);
      const fx = ex1 - fl / 2, fz = -(p.W / 2 + side / 2);
      at(box(fl, fh, w, black), fx, yFloor + fh / 2, fz);
      for (let i = 0; i < 4; i++) at(box(fl * 0.85, 0.012, 0.02, dark), fx, yFloor + fh + 0.006, fz - w * 0.3 + (i * w * 0.6) / 3);
      at(cyl(0.012, 0.012, 0.012, 6, bolt), fx - fl * 0.4, yFloor + fh + 0.01, fz);
      // Servofreno y bomba (lado derecho, detrás)
      const br = Math.min(w * 0.45, 0.12, hMax * 0.45);
      const bx = ex0 + br + 0.04, bz = p.W / 2 + side / 2;
      const boost = cyl(br, br, 0.12, 14, mat('#2a2c31', { metalness: 0.5, roughness: 0.4 }));
      boost.rotation.z = Math.PI / 2;
      at(boost, bx, yFloor + br + 0.03, bz);
      at(box(0.12, 0.05, 0.05, mat('#9aa0a6', { metalness: 0.6 })), bx + 0.12, yFloor + br + 0.03, bz);
      at(cyl(0.03, 0.03, 0.04, 8, mat('#f2c230')), bx + 0.14, yFloor + br + 0.08, bz);
      // Bloque del ABS con sus tubos (izquierda, detrás) y caja de relés (derecha, delante)
      const ah = Math.min(hMax, 0.1), aw = Math.min(w * 0.6, 0.14);
      const ax = ex0 + aw / 2 + 0.05, az = -(p.W / 2 + side / 2);
      at(box(aw, ah, aw, mat('#7b8088', { metalness: 0.6, roughness: 0.35 })), ax, yFloor + ah / 2, az);
      for (let k = 0; k < 3; k++) {
        const pipe = cyl(0.008, 0.008, 0.2, 5, mat('#c9ced4', { metalness: 0.8 }));
        pipe.rotation.z = Math.PI / 2;
        at(pipe, ax + aw / 2 + 0.1, yFloor + ah * 0.7, az - aw * 0.3 + k * aw * 0.3);
      }
      const rl = Math.min(0.2, p.L * 0.3), rh = Math.min(hMax, 0.09);
      at(box(rl, rh, w * 0.8, black), ex1 - rl / 2, yFloor + rh / 2, p.W / 2 + side / 2);
      at(box(rl * 0.8, 0.006, w * 0.5, mat('#d6402b')), ex1 - rl / 2, yFloor + rh + 0.003, p.W / 2 + side / 2);
      // Mazos de cables a lo largo de cada lado
      for (const s of [-1, 1]) {
        const loom = cyl(0.014, 0.014, p.L * 0.9, 6, mat('#111214'));
        loom.rotation.z = Math.PI / 2;
        at(loom, p.cx, yFloor + Math.min(hMax, 0.12), s * (p.W / 2 + 0.03));
      }
    }
    if (rear > 0.08) {
      // Centralita junto al torpedo
      const cl = Math.min(rear - 0.03, 0.18), ch = Math.min(hMax, 0.08);
      at(box(cl, ch, Math.min(0.36, p.W * 0.5), dark), x0 + COWL + rear / 2, yFloor + ch / 2, -p.W * 0.15);
      at(box(cl * 0.6, 0.01, 0.06, mat('#3b7fd8')), x0 + COWL + rear / 2, yFloor + ch + 0.005, -p.W * 0.15);
    }
  }

  addHood() {
    const { x0, x1, yCut, hz, hinge, hingeY, prof, front, heightAt } = this.bay;
    const car = this.car;
    // Capó: sigue el perfil medido, con bisagra junto al parabrisas.
    let pts = [...prof].sort((a, b) => b[0] - a[0]).filter(([x]) => x <= front - 0.04);
    if (pts.length < 2) pts = [[front - 0.04, yCut + 0.035], [hinge, hingeY]]; // perfil plano de respaldo
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0] - hinge, pts[0][1] + 0.008 - hingeY);
    for (const [x, y] of pts) shape.lineTo(x - hinge, y + 0.008 - hingeY);
    for (const [x, y] of [...pts].reverse()) shape.lineTo(x - hinge, y - 0.03 - hingeY);
    const depth = hz * 2 + 0.1;
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.translate(0, 0, -depth / 2);
    const hood = new THREE.Mesh(geo, this.bodyMat);
    hood.castShadow = true;
    this.hoodPivot = new THREE.Group();
    this.hoodPivot.position.set(hinge, hingeY, 0);
    this.hoodPivot.add(hood);
    car.add(this.hoodPivot);
    // Lámpara de taller sobre el vano: se enciende con el capó abierto
    this.lamp = new THREE.PointLight('#fff1d6', 0, 4.5, 1.4);
    this.lamp.position.set((x0 + x1) / 2 + 0.3, yCut + 1.1, 0);
    car.add(this.lamp);
  }

  // Habitáculo: se mide dónde están los cristales y la cintura de la carrocería. Para que los
  // asientos queden a una altura real se abre una franja fina en la chapa (a la altura de la
  // cintura) y se monta un habitáculo hundido: suelo, paneles, salpicadero, consola y asientos.
  addInterior() {
    const car = this.car;
    this.extraPanels = [];
    this.cabinCut = null;
    const rc = new THREE.Raycaster();
    const all = (o, d) => { rc.set(o, d); return rc.intersectObject(car, true).filter((h) => !isWheel(h.object)); };
    const samples = [];
    // Descapotables: car3d pone asientos de cuero encima de la carrocería. Se retiran (con su volante
    // y la placa del suelo) y el habitáculo hundido ocupa el hueco entre el parabrisas y las jorobas.
    const leather = this.body.filter((o) => o.isMesh && o.material.color && o.material.color.getHexString() === '5a3424');
    if (leather.length) {
      const lb = new THREE.Box3(); for (const m of leather) lb.expandByObject(m);
      const glassB = new THREE.Box3(); for (const o of this.body) if (o.isMesh && isGlass(o)) glassB.expandByObject(o);
      const remove = new Set(leather);
      for (const o of this.body) {
        if (!o.isMesh || remove.has(o)) continue;
        const c = o.material.color && o.material.color.getHexString();
        const p = o.position;
        if (c === '1a1b1e' && p.y > 0.7 && p.y < 1.0) remove.add(o);                      // placa del suelo
        if (o.geometry.type === 'CylinderGeometry' && p.y > 0.85 && p.x > lb.max.x && p.x < glassB.max.x) remove.add(o); // volante
      }
      for (const o of remove) { car.remove(o); this.body.splice(this.body.indexOf(o), 1); }
      const cx1 = glassB.isEmpty() ? lb.max.x + 0.6 : glassB.max.x - 0.06, cx0 = lb.min.x - 0.05;
      for (let x = cx1; x > cx0; x -= 0.04) {
        const h = all(V(x, 6, 0.25), V(0, -1, 0)).find((i) => !isGlass(i.object));
        if (h) samples.push([x, h.point.y + 1.2, h.point.y]); // sin techo: mucho espacio por encima
      }
    }
    if (!samples.length) for (const z of [0.25, 0.12]) {
      for (let x = this.bay.hinge + 0.3; x > this.carMin; x -= 0.04) {
        const hs = all(V(x, 6, z), V(0, -1, 0));
        const gi = hs.findIndex((h) => isGlass(h.object));
        if (gi < 0) { if (samples.length) break; continue; }
        const below = hs.slice(gi + 1).find((h) => !isGlass(h.object));
        if (!below) continue;
        samples.push([x, hs[gi].point.y, below.point.y]);
      }
      if (samples.length) break;
    }
    if (samples.length < 8) return; // sin habitáculo cerrado (monoplaza): nada que amueblar
    const gx1 = samples[0][0], gx0 = samples[samples.length - 1][0];
    const near = (x) => { let best = samples[0]; for (const sm of samples) if (Math.abs(sm[0] - x) < Math.abs(best[0] - x)) best = sm; return best; };
    const roofAt = (x) => near(x)[1], beltAt = (x) => near(x)[2];
    const belts = samples.map((sm) => sm[2]);
    const beltMin = Math.min(...belts), beltMax = Math.max(...belts);
    const side = all(V((gx0 + gx1) / 2, beltMin + 0.12, 5), V(0, 0, -1)).find((h) => isGlass(h.object));
    let hw = Math.max(0.25, (side ? side.point.z : 0.6) - 0.06);
    if (!side) { const bs = all(V((gx0 + gx1) / 2, beltMin - 0.06, 5), V(0, 0, -1))[0]; if (bs) hw = Math.max(0.25, bs.point.z - 0.14); }
    const under = all(V((gx0 + gx1) / 2, -4, 0), V(0, 1, 0))[0];
    const bottom = under ? under.point.y : 0.25;
    const yF = Math.max(bottom + 0.03, beltMin - 0.55);
    const depth = beltMin - yF;
    const len = gx1 - gx0;
    // Franja que se recorta en la chapa: solo la cara superior de la cintura bajo el cristal
    this.cabinCut = [V(gx0 + 0.03, beltMin - 0.04, -hw), V(gx1 - 0.03, beltMax + 0.02, hw)];
    this.beltY = beltMin + 0.02;

    const g = this.interior = new THREE.Group();
    const at = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
    const carpet = mat('#1d1e22', { roughness: 0.95, side: THREE.DoubleSide });
    const trimM = mat('#17181b', { roughness: 0.7 }), trim2 = mat('#2a2c31', { roughness: 0.65 });
    const seatM = mat('#25272c', { roughness: 0.85 }), bolster = mat('#33363d', { roughness: 0.8 });
    const accent = mat(this.spec.color, { roughness: 0.6 });

    // ---- Bañera: suelo y paredes que siguen la cintura (sin rendijas hacia la chapa hueca)
    at(new THREE.Mesh(new THREE.PlaneGeometry(len, 2 * hw).rotateX(-Math.PI / 2), carpet), (gx0 + gx1) / 2, yF, 0);
    const ws = new THREE.Shape();
    ws.moveTo(gx0, yF); ws.lineTo(gx1, yF);
    for (let x = gx1; x >= gx0 - 1e-6; x -= 0.04) ws.lineTo(x, beltAt(x) - 0.004);
    const wg = new THREE.ShapeGeometry(ws);
    for (const z of [-hw, hw]) at(new THREE.Mesh(wg, carpet), 0, 0, z);
    for (const x of [gx0, gx1]) {
      const h = beltAt(x) - 0.004 - yF;
      at(new THREE.Mesh(new THREE.PlaneGeometry(2 * hw, h).rotateY(Math.PI / 2), carpet), x, yF + h / 2, 0);
    }
    // Paneles de puerta con reposabrazos
    for (const s of [-1, 1]) {
      at(box(len * 0.75, Math.min(0.16, depth * 0.4), 0.025, trim2), gx1 - 0.15 - len * 0.375, beltMin - 0.08, s * (hw - 0.013));
      at(box(len * 0.3, 0.035, 0.07, bolster), gx1 - 0.75, beltMin - 0.17, s * (hw - 0.04));
    }

    // ---- Salpicadero: bloque con la cara trasera inclinada, pantalla y rejillas
    const dTop = Math.min(beltMin + 0.07, roofAt(gx1 - 0.15) - 0.05);
    const dBot = yF + Math.min(0.22, depth * 0.45);
    const dShape = new THREE.Shape();
    dShape.moveTo(gx1 - 0.01, dBot);
    dShape.lineTo(gx1 - 0.01, dTop);
    dShape.lineTo(gx1 - 0.2, dTop);
    dShape.lineTo(gx1 - 0.32, dTop - 0.09);
    dShape.lineTo(gx1 - 0.3, dBot + 0.04);
    const dDepth = 2 * hw - 0.02;
    const dGeo = new THREE.ExtrudeGeometry(dShape, { depth: dDepth, bevelEnabled: false });
    dGeo.translate(0, 0, -dDepth / 2);
    g.add(new THREE.Mesh(dGeo, trimM));
    const slopeX = gx1 - 0.27, slopeY = dTop - 0.05;
    const screen = at(box(0.012, 0.06, 0.2, mat('#3b7fd8', { emissive: '#2a6fd0', emissiveIntensity: 0.9 })), slopeX, slopeY, hw * 0.05);
    screen.rotation.z = 0.65;
    for (const z of [-hw * 0.75, -hw * 0.25, hw * 0.35, hw * 0.75]) {
      const vent = at(box(0.01, 0.03, 0.08, mat('#0b0c0e')), slopeX + 0.03, slopeY + 0.025, z);
      vent.rotation.z = 0.65;
    }
    at(box(0.12, 0.04, hw * 0.55, trimM), gx1 - 0.25, dTop + 0.015, -hw * 0.48); // visera del cuadro
    at(box(0.006, 0.012, dDepth * 0.8, accent), gx1 - 0.205, dTop - 0.002, 0); // moldura

    // ---- Asientos a altura real: pie, banqueta con laterales, respaldo reclinado y reposacabezas
    const seat = (hx, z, w, bench = false) => {
      const cTop = yF + Math.min(0.26, depth * 0.55);
      const backH = Math.min(bench ? 0.5 : 0.6, roofAt(hx - 0.25) - cTop - (bench ? 0.06 : 0.16));
      if (backH < 0.15) return;
      at(box(0.24, cTop - 0.09 - yF, w * 0.6, trimM), hx, yF + (cTop - 0.09 - yF) / 2, z);
      at(box(0.44, 0.09, w, seatM), hx, cTop - 0.045, z);
      if (!bench) for (const sz of [-1, 1]) at(box(0.4, 0.05, 0.06, bolster), hx, cTop + 0.01, z + sz * (w / 2 - 0.03));
      const lean = 0.22;
      const back = at(box(0.1, backH, w, seatM), hx - 0.24 - Math.sin(lean) * backH / 2, cTop + Math.cos(lean) * backH / 2 - 0.02, z);
      back.rotation.z = lean;
      const stripe = at(box(0.104, backH * 0.7, 0.04, accent), back.position.x, back.position.y, z);
      stripe.rotation.z = lean;
      if (!bench) {
        const hr = at(box(0.08, 0.13, w * 0.55, bolster), hx - 0.24 - Math.sin(lean) * (backH + 0.08), cTop + Math.cos(lean) * (backH + 0.08) - 0.02, z);
        hr.rotation.z = lean;
      }
    };
    const sw = Math.min(0.44, hw * 0.78);
    const hx = Math.max(gx0 + 0.35, gx1 - Math.min(0.85, len * 0.5));
    const dz = hw * 0.5;
    seat(hx, -dz, sw);
    seat(hx, dz, sw);
    // Consola central con palanca
    const consoleTop = yF + Math.min(0.26, depth * 0.55) + 0.02;
    const cl = Math.max(0.1, (gx1 - 0.3) - (hx - 0.15));
    at(box(cl, consoleTop - yF, hw * 0.3, trim2), hx - 0.15 + cl / 2, (consoleTop + yF) / 2, 0);
    at(cyl(0.01, 0.01, 0.09, 5, trimM), hx + 0.12, consoleTop + 0.045, 0);
    at(new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), accent), hx + 0.12, consoleTop + 0.095, 0);
    // Volante mirando al conductor, con radios y columna hasta el salpicadero
    const wc = V(gx1 - 0.42, Math.min(beltMin, dTop - 0.02), -dz);
    const wheelG = new THREE.Group();
    wheelG.add(new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 6, 18), trimM));
    for (const a of [0, Math.PI / 2, Math.PI]) {
      const sp = box(0.1, 0.02, 0.012, trim2);
      sp.position.set(Math.cos(a) * 0.05, -Math.sin(a) * 0.05, 0);
      sp.rotation.z = a;
      wheelG.add(sp);
    }
    const hub = cyl(0.03, 0.03, 0.02, 10, accent);
    hub.rotation.x = Math.PI / 2;
    wheelG.add(hub);
    wheelG.quaternion.setFromUnitVectors(V(0, 0, 1), V(-0.8, 0.6, 0).normalize());
    wheelG.position.copy(wc);
    g.add(wheelG);
    const colEnd = V(gx1 - 0.28, wc.y - 0.07, -dz);
    const col = cyl(0.018, 0.018, wc.distanceTo(colEnd), 6, trimM);
    col.position.copy(wc).lerp(colEnd, 0.5);
    col.quaternion.setFromUnitVectors(V(0, 1, 0), colEnd.clone().sub(wc).normalize());
    g.add(col);
    // Banco trasero si el habitáculo es largo
    const rx = hx - 0.85;
    if (len > 1.5 && rx - 0.35 > gx0) seat(rx, 0, Math.min(2 * hw - 0.12, 1.2), true);

    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    car.add(g);
    this.extraPanels.push(g); // se monta con la carrocería, antes que los cristales
  }

  // Recorte propio (sustituye a los planos de corte de three.js): cada material de la
  // carrocería descarta los fragmentos que caen dentro de cualquiera de dos cajas, el vano del
  // capó y la franja del habitáculo. Lo mismo para las sombras, con un material de profundidad.
  // Los materiales del color de la carrocería llevan además la pintura: el coche sale de la línea
  // en imprimación gris y la cabina de pintura lo va pintando de delante atrás (uSweep).
  applyClipping() {
    const { x0, x1, yCut, hz } = this.bay;
    const off = [V(1e9, 1e9, 1e9), V(-1e9, -1e9, -1e9)];
    const [cMin, cMax] = this.cabinCut || off;
    this.cut = {
      uCarInv: { value: new THREE.Matrix4() },
      uMin: { value: [V(x0, yCut, -hz), cMin] },
      uMax: { value: [V(x1, 50, hz), cMax] },
      // x, y (centro de la rueda), radio del hueco, z desde la que se corta (hacia fuera)
      uWheel: { value: Array.from({ length: 4 }, (_, i) => { const a = this.arches[i]; return a ? new THREE.Vector4(a.x, a.y, a.R, a.zIn) : new THREE.Vector4(0, 0, 0, 0); }) },
    };
    const paintColor = new THREE.Color(this.spec.color);
    this.paint = {
      uSweep: { value: 1e9 },                      // lo que queda delante (x mayor) ya está pintado
      uPrimer: { value: new THREE.Color('#a9acb1') },
      uPaint: { value: paintColor.clone() },
      uPaint2: { value: paintColor.clone() },
      uFinish: { value: 0 },                       // 0 sólido, 1 metalizado, 2 mate, 3 perlado, 4 bicolor
      uBelt: { value: this.beltY ?? this.bay.yCut + 0.15 },
      uPRough: { value: 0.45 },
      uPMetal: { value: 0.15 },
    };
    const inject = (m, { cut = true, paint = false, arches = false } = {}) => {
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.cut);
        if (paint) Object.assign(sh.uniforms, this.paint);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 uCarInv;\nvarying vec3 vCarPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarPos = (uCarInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
        let f = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uMin[2];\nuniform vec3 uMax[2];\nvarying vec3 vCarPos;\nbool inCut(vec3 p) { for (int i = 0; i < 2; i++) { if (all(greaterThan(p, uMin[i])) && all(lessThan(p, uMax[i]))) return true; } return false; }\nuniform vec4 uWheel[4];\nbool inArch(vec3 p) { for (int i = 0; i < 4; i++) { vec4 w = uWheel[i]; if (w.z > 0.0 && length(p.xy - w.xy) < w.z && abs(p.z) > w.w) return true; } return false; }'
            + (paint ? '\nuniform float uSweep; uniform vec3 uPrimer; uniform vec3 uPaint; uniform vec3 uPaint2; uniform int uFinish; uniform float uBelt; uniform float uPRough; uniform float uPMetal;' : ''));
        if (cut) f = f.replace('void main() {', 'void main() {\n  if (inCut(vCarPos)) discard;' + (arches ? '\n  if (inArch(vCarPos)) discard;' : ''));
        if (paint) {
          f = f
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  bool painted = vCarPos.x > uSweep;\n  roughnessFactor = painted ? uPRough : 0.85;')
            .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = painted ? uPMetal : 0.05;')
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  vec3 pc = uPaint;
  if (uFinish == 3) { float fr = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0); pc = mix(uPaint, uPaint2, fr); }
  if (uFinish == 4 && vCarPos.y > uBelt) pc = uPaint2;
  diffuseColor.rgb = painted ? pc : uPrimer;`);
        }
        sh.fragmentShader = f;
      };
      m.customProgramCacheKey = () => `car-${cut ? 'c' : ''}${paint ? 'p' : ''}${arches ? 'a' : ''}`;
      return m;
    };
    this.injectPaint = (m) => inject(m, { cut: false, paint: true });
    const depthMat = inject(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
    const want = paintColor.getHexString();
    const clones = this.clones = new Map();
    for (const part of this.body) part.traverse((o) => {
      if (!o.isMesh || isWheel(o)) return;
      const glass = isGlass(o);
      if (!clones.has(o.material)) {
        const c = o.material.clone();
        // Cristales tintados pero translúcidos: se ve el interior
        if (glass) { c.transparent = true; c.opacity = 0.42; c.depthWrite = false; }
        else { const body = !!(c.color && c.color.getHexString() === want); inject(c, { cut: true, paint: body, arches: body }); }
        clones.set(o.material, c);
      }
      o.material = clones.get(o.material);
      if (!glass) o.customDepthMaterial = depthMat;
    });
    // Capó y joroba: pintura sin recorte
    this.paintMat = this.injectPaint(this.bodyMat.clone());
    clones.set('paint', this.paintMat);
    this.hoodPivot.traverse((o) => { if (o.isMesh && o.material === this.bodyMat) o.material = this.paintMat; });
    this.update();
  }

  update() {
    this.car.updateMatrixWorld(true);
    this.cut.uCarInv.value.copy(this.car.matrixWorld).invert();
    if (this.enginePlanes) this.enginePlanes.forEach((p, i) => p.copy(this.engineLocal[i]).applyMatrix4(this.car.matrixWorld));
  }

  // Lo que del motor quede fuera del vano (por los lados, delante, detrás o por debajo de los bajos)
  // no se dibuja: así nunca atraviesa la carrocería. Por arriba no se recorta (se ve con el capó
  // abierto). Se puede llamar otra vez para incluir piezas nuevas (la admisión al volver).
  clipEngine(root) {
    if (!this.enginePlanes) {
      const { hz, bottom } = this.bay, { ex0, ex1 } = this.engineSpan;
      this.engineLocal = [
        new THREE.Plane(V(-1, 0, 0), ex1 + 0.03), new THREE.Plane(V(1, 0, 0), -(ex0 - 0.03)),
        new THREE.Plane(V(0, 0, -1), hz), new THREE.Plane(V(0, 0, 1), hz),
        new THREE.Plane(V(0, 1, 0), -bottom),
      ];
      this.enginePlanes = this.engineLocal.map((p) => p.clone());
      this.engineMats = new Map();
    }
    // Copia propia de cada material: los de la caché los comparte el resto de la escena
    const swap = (m) => {
      if (!this.engineMats.has(m)) { const c = m.clone(); c.clippingPlanes = this.enginePlanes; this.engineMats.set(m, c); }
      return this.engineMats.get(m);
    };
    root.traverse((o) => {
      if (!o.isMesh || o.userData.engineClip) return;
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      o.userData.engineClip = true;
    });
    this.update();
  }

  // Centro del vano en coordenadas del mundo (para la cámara).
  bayWorld() { return this.car.localToWorld(V((this.bay.x0 + this.bay.x1) / 2, this.bay.yCut, 0)); }

  // Montaje: bastidor -> ruedas -> carrocería de abajo arriba -> capó.
  async assemble(sfx) {
    const wheels = this.body.filter((c) => c.userData.isWheel);
    // El habitáculo va con el bastidor: así el hueco de la chapa nunca queda vacío
    const panels = this.body.filter((c) => !c.userData.isWheel);
    const all = [this.frame, this.internals, ...this.extraPanels, ...wheels, ...panels, this.hoodPivot];
    for (const o of all) o.visible = false;
    const homes = new Map(all.map((o) => [o, o.position.clone()]));
    const bases = new Map(all.map((o) => [o, o.scale.clone()]));
    const fall = async (o, h = 3.4, dur = 0.42) => {
      const home = homes.get(o), base = bases.get(o);
      grow(o, base, 0);
      o.visible = true;
      await tween(dur, (t) => { o.position.set(home.x, home.y + h * (1 - t), home.z); grow(o, base, t * 4); }, ease.inQuad);
      o.scale.copy(base);
      await tween(0.12, (t) => o.position.set(home.x, home.y + Math.sin(t * Math.PI) * 0.04, home.z), ease.linear);
    };
    await Promise.all([fall(this.frame, 4, 0.55), fall(this.internals, 4.4, 0.6), ...this.extraPanels.map((p, i) => wait(0.15 + i * 0.1).then(() => fall(p, 4.2, 0.6)))]);
    sfx.thud(0.7);
    await wait(0.15);
    // Ruedas desde los lados, rodando
    await Promise.all(wheels.map(async (w, i) => {
      await wait(i * 0.12);
      const home = homes.get(w);
      const s = Math.sign(home.z) || 1;
      const r0 = w.rotation.z, base = bases.get(w);
      grow(w, base, 0);
      w.visible = true;
      await tween(0.5, (t) => { w.position.set(home.x, home.y, home.z + s * 3 * (1 - t)); grow(w, base, t * 2); w.rotation.z = r0 + (1 - t) * 8 * s; }, ease.outCubic);
      w.rotation.z = r0;
      w.scale.copy(base);
      sfx.clank();
    }));
    // Carrocería: de las piezas más bajas a las más altas
    const yOf = (o) => new THREE.Box3().setFromObject(o).getCenter(V()).y;
    panels.sort((a, b) => yOf(a) - yOf(b));
    const gap = Math.min(0.07, 2.4 / Math.max(1, panels.length));
    await Promise.all(panels.map(async (p, i) => {
      await wait(i * gap);
      await fall(p, 3 + (i % 3) * 0.3);
      if (i % 4 === 0) sfx.clank();
    }));
    sfx.thud(0.4);
    await fall(this.hoodPivot, 2.6, 0.5);
    sfx.thud(0.5);
  }

  async openHood(sfx) {
    sfx.whoosh();
    await tween(1.1, (t) => { this.hoodPivot.rotation.z = t * HOOD_OPEN; this.lamp.intensity = t * 6; }, ease.inOutCubic);
    sfx.clank();
  }
  // Al cerrar, el motor se oculta: si asoma por encima del capó, justo cuando la tapa llega a él
  // (desde arriba ya no se ve y no atraviesa la chapa); si no, al acabar. Solo vuelve en los rayos X.
  async closeHood(sfx, engine) {
    const { hinge, hingeY, heightAt } = this.bay;
    let eb = null;
    if (engine) {
      this.car.updateMatrixWorld(true);
      eb = new THREE.Box3().setFromObject(engine).applyMatrix4(this.car.matrixWorld.clone().invert());
    }
    const xs = eb ? Array.from({ length: 7 }, (_, i) => eb.min.x + ((eb.max.x - eb.min.x) * i) / 6) : [];
    const hoodY = (a) => Math.min(...xs.map((x) => hingeY + (x - hinge) * Math.sin(a) + (heightAt(x) - 0.03 - hingeY) * Math.cos(a)));
    await tween(0.9, (t) => {
      const a = HOOD_OPEN * (1 - t);
      this.hoodPivot.rotation.z = a;
      this.lamp.intensity = (1 - t) * 6;
      if (eb && engine.visible && hoodY(a) < eb.max.y + 0.02) engine.visible = false;
    }, ease.inQuad);
    // Con el capó cerrado el motor ya no se ve: se oculta siempre (vuelve en los rayos X)
    if (engine) engine.visible = false;
    sfx.thud(0.7);
  }

  // Con el motor ya dentro: tomas de aire del frontal al motor y manguito del radiador, que se
  // "tienden". Se mide el bloque real ya montado (no el tamaño previsto) para que lleguen a su cara
  // delantera, por el hueco entre el radiador y el motor.
  async connectHoses(sfx, engineBlock) {
    const { x1, yCut, yFloor, hz } = this.bay;
    this.car.updateMatrixWorld(true);
    const inv = this.car.matrixWorld.clone().invert();
    const eb = new THREE.Box3().setFromObject(engineBlock).applyMatrix4(inv);
    const eh = eb.max.y - eb.min.y, ew = eb.max.z - eb.min.z;
    const fx = eb.max.x - 0.02;
    const sx = Math.max(fx + 0.1, x1 - FRONT_PANEL - 0.03);
    const route = (a, b) => {
      const mid = a.clone().lerp(b, 0.5); mid.y += 0.05;
      return [a, V(mid.x, mid.y, (a.z + b.z) / 2), b];
    };
    const paths = [];
    for (const s of [-1, 1]) {
      const zEnd = s * Math.min(0.3, ew * 0.28), zStart = s * Math.min(0.32, hz * 0.45);
      const yEnd = Math.min(yCut - 0.06, eb.min.y + eh * 0.72);
      paths.push(route(V(sx, Math.min(yCut - 0.07, yEnd + 0.05), zStart), V(fx, yEnd, zEnd)));
    }
    const yLow = Math.max(yFloor + 0.08, eb.min.y + eh * 0.3);
    paths.push(route(V(sx, Math.max(yFloor + 0.1, yLow - 0.06), -Math.min(0.22, hz * 0.4)), V(fx, yLow, 0)));
    const hoseM = VM.hose();
    const tubes = paths.map((pts, i) => {
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, i < 2 ? 0.04 : 0.025, 8, false);
      const m = new THREE.Mesh(geo, hoseM);
      m.castShadow = true;
      geo.setDrawRange(0, 0);
      this.internals.add(m);
      return m;
    });
    await tween(0.8, (t) => { for (const m of tubes) m.geometry.setDrawRange(0, Math.floor(m.geometry.index.count * t / 6) * 6); }, ease.outCubic);
    for (const m of tubes) m.geometry.setDrawRange(0, Infinity);
    sfx.clank();
  }

  // Barra de torretas en X, como en los coches de verdad. Solo si el motor queda por debajo.
  async addBrace(sfx) {
    const { yCut, x1 } = this.bay;
    if (this.place.top > yCut - 0.07) return;
    const y = yCut - 0.035;
    const [[tx, zl], [, zr]] = this.towers;
    const g = new THREE.Group();
    const bar = (a, b, r = 0.022) => {
      const len = a.distanceTo(b);
      const m = cyl(r, r, len, 8, VM.plastic());
      m.position.copy(a).lerp(b, 0.5);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
      g.add(m);
    };
    const L = V(tx, y, zl), R = V(tx, y, zr), C = V(x1 - FRONT_PANEL - 0.02, y, 0);
    bar(L, R, 0.026);
    bar(L, C); bar(R, C);
    for (const q of [L, R, C]) { const pl = cyl(0.04, 0.04, 0.02, 10, VM.plastic2()); pl.position.copy(q); g.add(pl); }
    g.position.y = 1.2;
    g.scale.setScalar(0.001);
    this.internals.add(g);
    await tween(0.55, (t) => { g.position.y = 1.2 * (1 - t); grow(g, V(1, 1, 1), t * 3); }, ease.inQuad);
    g.scale.setScalar(1);
    sfx.clank(); sfx.thud(0.3);
  }

  dispose() {
    if (this.car.parent) this.car.parent.remove(this.car); // puede estar en el elevador o en el túnel
    this.car.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

// ---------- Traslado del motor ----------
const TRAVEL_Y = 7.3;

// Engancha el motor del banco, deja la admisión en el carro y lo sube hasta el carril.
export async function pickupEngine(shop, garage, rig, sfx) {
  const e = shop.engine;
  const crane = garage.crane;
  const root = e.root;
  const { s, sv, fb, cx, y0: floorY, shift } = rig.place;
  e.running = 0;
  e.pumping = 0;
  e.inner.position.y = 0; e.inner.position.z = 0;
  for (const p of e.exhaustParts) p.visible = false;
  crane.setX(root.position.x);
  const topY = () => root.position.y + fb.max.y * root.scale.y + 0.06;
  const h0 = crane.hookY();
  await tween(1.0, (t) => crane.setHook(h0 + (topY() - h0) * t), ease.inOutCubic);
  sfx.clank();
  // La admisión se desmonta y espera en el carro de piezas
  const slots = e.intakeItems.length;
  shop.scene.updateMatrixWorld(true);
  const parked = Promise.all(e.intakeItems.map(async (obj, i) => {
    shop.scene.attach(obj);
    const p0 = obj.position.clone(), s0 = obj.scale.x;
    const p1 = CART.clone().add(V(-0.55 + (slots > 1 ? (i * 1.1) / (slots - 1) : 0.55), 1.05 + 0.25 * s, 0));
    await tween(1.0, (t) => {
      obj.position.lerpVectors(p0, p1, t);
      obj.position.y += Math.sin(t * Math.PI) * 1.6;
      obj.scale.setScalar(s0 + (s - s0) * t);
    }, ease.inOutCubic);
    sfx.clank();
  }));
  // Subida (y el motor se ajusta al tamaño del coche)
  const yStart = root.position.y;
  await tween(1.6, (t) => {
    root.scale.set(1 + (sv.x - 1) * t, 1 + (sv.y - 1) * t, 1 + (sv.z - 1) * t);
    root.position.y = yStart + (TRAVEL_Y - yStart) * t;
    crane.setHook(topY());
  }, ease.inOutCubic);
  await parked;
  // Viaje por el carril hasta encima de su sitio (adelantado `shift` si luego va bajo la cabina)
  rig.car.updateMatrixWorld(true);
  const target = rig.car.localToWorld(V(cx + shift, floorY, 0));
  const xa = root.position.x, xb = target.x - (fb.min.x + fb.max.x) / 2 * sv.x;
  const za = root.position.z, zb = target.z - (fb.min.z + fb.max.z) / 2 * sv.z;
  sfx.whoosh();
  await tween(2.2, (t) => {
    root.position.x = xa + (xb - xa) * t;
    root.position.z = za + (zb - za) * t;
    crane.setX(root.position.x);
  }, ease.inOutCubic);
}

// Baja el motor al vano (con el capó ya abierto) y lo deja anclado al coche.
export async function lowerEngine(shop, garage, rig, sfx) {
  const e = shop.engine, root = e.root, crane = garage.crane;
  const { sv, fb, y0: floorY, shift } = rig.place;
  rig.car.updateMatrixWorld(true);
  const yEnd = rig.car.localToWorld(V(0, floorY, 0)).y - fb.min.y * sv.y;
  const yStart = root.position.y;
  const topY = () => root.position.y + fb.max.y * sv.y + 0.06;
  rig.clipEngine(root); // al entrar en el vano, lo que sobresalga por los lados no se ve
  await tween(2.0, (t) => { root.position.y = yStart + (yEnd - yStart) * t; crane.setHook(topY()); }, ease.inOutCubic);
  sfx.thud(0.8);
  if (shift > 0.01) {
    const xs = root.position.x, tx = crane.trolley.position.x;
    await tween(0.6, (t) => { root.position.x = xs - shift * t; crane.setX(tx - shift * t); }, ease.inOutCubic);
    sfx.clank();
  }
  rig.car.attach(root);
  const h0 = crane.hookY();
  tween(1.2, (t) => crane.setHook(h0 + (6.8 - h0) * t), ease.inOutCubic).then(() => {
    const x0 = crane.trolley.position.x;
    return tween(1.6, (t) => crane.setX(x0 + (0 - x0) * t), ease.inOutCubic);
  });
}

// La admisión vuelve del carro y se monta en su sitio sobre el motor.
export async function refitIntake(shop, sfx) {
  const e = shop.engine;
  await Promise.all(e.intakeItems.map(async (obj, i) => {
    await wait(i * 0.25);
    e.root.attach(obj);
    const p0 = obj.position.clone(), p1 = obj.userData.home;
    const r0 = obj.rotation.clone(), r1 = obj.userData.rot;
    const s0 = obj.scale.clone(), one = V(1, 1, 1);
    await tween(1.1, (t) => {
      obj.position.lerpVectors(p0, p1, t);
      obj.position.y += Math.sin(t * Math.PI) * 2.5;
      obj.rotation.set(r0.x + (r1.x - r0.x) * t, r0.y + (r1.y - r0.y) * t, r0.z + (r1.z - r0.z) * t);
      obj.scale.lerpVectors(s0, one, t);
    }, ease.inOutCubic);
    sfx.thud(0.4); sfx.clank();
  }));
}

export { LIFT_X, BEAM_Y };
