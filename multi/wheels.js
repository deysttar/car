// Ruedas y frenos: el coche se levanta sobre gatos y, rueda a rueda, la pistola neumática
// quita la rueda de serie, aparecen el disco y la pinza (que brilla al rojo) y entra la nueva.
import * as THREE from 'three';
import { tween, wait, ease, grow, mat, box, cyl } from './engine3d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Rueda con el mismo formato que car3d.js (eje en z, cara exterior hacia +z)
export function makeWheel(r, w, tire) {
  const g = new THREE.Group();
  const rubber = mat('#16171a', { roughness: 0.92 });
  const t = cyl(r, r, w, 22, rubber); t.rotation.x = Math.PI / 2; g.add(t);
  // Banda del flanco: amarilla en semislick, gris en deportivo
  if (tire.id !== 'street') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.86, 0.012, 6, 32), mat(tire.id === 'semi' ? '#ffb627' : '#8a9097', { roughness: 0.6 }));
    band.position.z = w / 2 + 0.004; g.add(band);
  }
  const rimM = mat(tire.rim, { metalness: 0.7, roughness: 0.3 });
  const rim = cyl(r * 0.66, r * 0.66, w + 0.02, 20, rimM); rim.rotation.x = Math.PI / 2; g.add(rim);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(r * 0.66, 0.018, 6, 30), mat('#d8dde2', { metalness: 0.8, roughness: 0.25 }));
  lip.position.z = w / 2 + 0.012; g.add(lip);
  // Radios: deja ver el disco y la pinza por detrás
  const dish = cyl(r * 0.6, r * 0.6, 0.01, 20, mat('#0d0e10')); dish.rotation.x = Math.PI / 2; dish.position.z = w / 2 - 0.03; g.add(dish);
  for (let i = 0; i < tire.spokes; i++) {
    const s = box(r * 0.09, r * 1.2, 0.03, rimM);
    s.rotation.z = (i / tire.spokes) * Math.PI * 2;
    s.position.z = w / 2 + 0.006;
    if (tire.spokes > 6) s.scale.x = 0.6;
    g.add(s);
  }
  const cap = cyl(r * 0.14, r * 0.14, 0.04, 12, mat(tire.caliper, { metalness: 0.5, roughness: 0.35 })); cap.rotation.x = Math.PI / 2; cap.position.z = w / 2 + 0.02; g.add(cap);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.isWheel = true;
  return g;
}

// Disco y pinza: van fijos en el coche (no giran con la rueda)
function makeBrake(r, w, tire) {
  const g = new THREE.Group();
  const discM = new THREE.MeshStandardMaterial({ color: tire.id === 'semi' ? '#2a2c30' : '#8d939b', metalness: 0.7, roughness: 0.35, flatShading: true, emissive: '#ff4a12', emissiveIntensity: 0 });
  const disc = cyl(r * 0.52, r * 0.52, 0.04, 22, discM); disc.rotation.x = Math.PI / 2; g.add(disc);
  for (let i = 0; i < 12; i++) { const h = cyl(0.008, 0.008, 0.05, 5, mat('#2a2c30')); const a = (i / 12) * Math.PI * 2; h.rotation.x = Math.PI / 2; h.position.set(Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38, 0); g.add(h); }
  const hat = cyl(r * 0.2, r * 0.2, 0.06, 12, mat('#5c626b', { metalness: 0.6 })); hat.rotation.x = Math.PI / 2; g.add(hat);
  const cal = box(r * 0.32, r * 0.42, 0.09, mat(tire.caliper, { roughness: 0.45, metalness: 0.2 }));
  cal.position.set(-r * 0.32, r * 0.3, 0.01); cal.rotation.z = 0.6; g.add(cal);
  g.userData.disc = discM;
  g.position.z = w / 2 - 0.1; // por dentro de la llanta
  return g;
}

// Pistola neumática
function makeWrench() {
  const g = new THREE.Group();
  g.add(box(0.12, 0.16, 0.22, mat('#d6402b', { roughness: 0.5 })));
  const handle = box(0.06, 0.18, 0.08, mat('#1d1f23')); handle.position.set(0, -0.15, -0.04); g.add(handle);
  const socket = cyl(0.03, 0.03, 0.14, 8, mat('#9aa0a6', { metalness: 0.7 })); socket.rotation.x = Math.PI / 2; socket.position.z = -0.17; g.add(socket);
  g.userData.socket = socket;
  return g;
}

// onWheel(posición local, lado) se llama antes de cada rueda (para mover la cámara)
// Con { onLift: true } el coche ya está en el elevador: no hacen falta gatos.
export async function swapWheels(rig, tire, sfx, onWheel, { onLift = false } = {}) {
  const car = rig.car;
  const olds = rig.body.filter((o) => o.userData.isWheel);
  // Gatos: el coche sube un poco para quitar las ruedas
  const jacks = [];
  const y0 = car.position.y, lift = 0.16;
  for (const w of onLift ? [] : olds) {
    // Del suelo (ya levantado) a los bajos del coche
    const bottom = rig.underAt(w.position.x * 0.62, Math.sign(w.position.z) * 0.55);
    const jh = bottom + lift + 0.01;
    const j = box(0.12, jh, 0.12, mat('#f2c230', { roughness: 0.6 }));
    j.position.set(w.position.x * 0.62, bottom - jh / 2, Math.sign(w.position.z) * 0.55);
    j.scale.setScalar(0.001);
    car.add(j);
    jacks.push(j);
  }
  if (jacks.length) await Promise.all(jacks.map((j) => tween(0.3, (t) => j.scale.setScalar(Math.max(0.001, t)), ease.outBack)));
  if (!onLift) {
    sfx.lift(0.6);
    await tween(0.6, (t) => (car.position.y = y0 + lift * t), ease.inOutCubic);
  }
  const wrench = makeWrench();
  car.add(wrench);
  wrench.visible = false;
  const fresh = [];
  for (const old of olds) {
    const s = Math.sign(old.position.z) || 1;
    const r = old.children[0].geometry.parameters.radiusTop, w = old.children[0].geometry.parameters.height;
    const home = old.position.clone(), rot = old.rotation.clone();
    onWheel && onWheel(home, s);
    // Pistola: afloja y la rueda de serie sale
    wrench.visible = true;
    wrench.position.set(home.x, home.y, home.z + s * (w / 2 + 0.3));
    wrench.rotation.y = s > 0 ? 0 : Math.PI;
    sfx.impact(0.45);
    await tween(0.45, (t) => (wrench.userData.socket.rotation.z = t * 40), ease.linear);
    wrench.visible = false;
    await tween(0.35, (t) => { old.position.z = home.z + s * 0.8 * t; old.scale.setScalar(Math.max(0.001, 1 - t)); }, ease.inQuad);
    old.parent.remove(old);
    // Disco y pinza
    const br = makeBrake(r, w, tire);
    const bh = new THREE.Group(); bh.position.copy(home); bh.rotation.copy(rot); bh.add(br);
    bh.scale.setScalar(0.001);
    car.add(bh);
    await tween(0.3, (t) => grow(bh, V(1, 1, 1), t), ease.outBack);
    sfx.clank();
    tween(0.9, (t) => (br.userData.disc.emissiveIntensity = Math.sin(t * Math.PI) * 1.4), ease.linear);
    // Rueda nueva: entra girando
    const nw = makeWheel(r, w, tire);
    nw.rotation.copy(rot);
    car.add(nw);
    await tween(0.45, (t) => { nw.position.set(home.x, home.y, home.z + s * 0.9 * (1 - t)); nw.rotation.z = rot.z + (1 - t) * 6 * s; grow(nw, V(1, 1, 1), t * 2); }, ease.outCubic);
    nw.rotation.z = rot.z;
    nw.scale.setScalar(1);
    wrench.visible = true;
    sfx.impact(0.35);
    await tween(0.35, (t) => (wrench.userData.socket.rotation.z = -t * 30), ease.linear);
    wrench.visible = false;
    rig.body[rig.body.indexOf(old)] = nw;
    fresh.push(nw);
  }
  car.remove(wrench);
  // Baja el coche y se retiran los gatos
  if (!onLift) {
    await tween(0.6, (t) => (car.position.y = y0 + lift * (1 - t)), ease.inOutCubic);
    sfx.thud(0.5);
  }
  await Promise.all(jacks.map((j) => tween(0.25, (t) => j.scale.setScalar(Math.max(0.001, 1 - t)), ease.inQuad).then(() => car.remove(j))));
  return fresh;
}
