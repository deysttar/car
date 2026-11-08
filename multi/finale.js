// Últimos pasos: control de calidad (arco escáner con láser) y presentación (lona, focos,
// redoble, confeti y plataforma giratoria).
import * as THREE from 'three';
import { tween, wait, ease, mat, box, cyl } from './engine3d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------- Control de calidad ----------
export class Scanner {
  // Arco fijo sobre sus carriles: espera aparcado en el extremo +x de la zona
  constructor(scene, station) {
    this.st = station;
    this.park = station.x + 3.3;
    this.group = new THREE.Group();
    this.group.position.set(this.park, 0, station.z);
    scene.add(this.group);
    const frame = mat('#3a3f46', { metalness: 0.5, roughness: 0.4 });
    const H = 2.7, Z = 1.7;
    for (const s of [-1, 1]) { const p = box(0.18, H, 0.18, frame); p.position.set(0, H / 2, s * Z); this.group.add(p); }
    const top = box(0.22, 0.22, 2 * Z + 0.18, frame); top.position.y = H; this.group.add(top);
    // Lámina de láser y bordes brillantes
    this.laserMat = new THREE.MeshBasicMaterial({ color: '#4dffc3', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2 * Z - 0.2, H - 0.1).rotateY(Math.PI / 2), this.laserMat);
    sheet.position.y = (H - 0.1) / 2;
    this.group.add(sheet);
    const edge = new THREE.MeshBasicMaterial({ color: '#b6ffe6' });
    for (const s of [-1, 1]) { const e = box(0.03, H - 0.1, 0.03, edge); e.position.set(0, (H - 0.1) / 2, s * (Z - 0.12)); this.group.add(e); }
    const eTop = box(0.03, 0.03, 2 * Z - 0.2, edge); eTop.position.y = H - 0.12; this.group.add(eTop);
  }
  reset() { this.group.position.x = this.park; this.laserMat.opacity = 0; }
  // Pasa por encima del coche; onFrac(0..1) para ir marcando la lista
  async sweep(rig, onFrac) {
    const cx = rig.car.position.x;
    const xa = cx + rig.carMax + 0.6, xb = Math.max(this.st.x - 3.4, cx + rig.carMin - 0.6);
    const x0 = this.group.position.x;
    // Se acerca al morro, enciende el láser y barre hasta la zaga
    await tween(0.8, (t) => (this.group.position.x = x0 + (xa - x0) * t), ease.inOutCubic);
    await tween(0.3, (t) => (this.laserMat.opacity = 0.32 * t), ease.linear);
    await tween(4.4, (t) => {
      this.group.position.x = xa + (xb - xa) * t;
      this.laserMat.opacity = 0.3 + Math.sin(t * 60) * 0.08;
      onFrac(t);
    }, ease.inOutCubic);
    await tween(0.3, (t) => (this.laserMat.opacity = 0.32 * (1 - t)), ease.linear);
    // Vuelve a su sitio
    await tween(1.6, (t) => (this.group.position.x = xb + (this.park - xb) * t), ease.inOutCubic);
  }
}

// ---------- Presentación ----------
function clothGeometry(size) {
  // Caja con muchos segmentos "drapeada": arriba redondeada y cayendo por los lados
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z, 18, 6, 10);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = (2 * x) / size.x, nz = (2 * z) / size.z, ny = (y / size.y) + 0.5;
    const edge = Math.max(Math.abs(nx) ** 4, Math.abs(nz) ** 3);
    y -= size.y * 0.32 * edge * ny;
    const flare = 1 + 0.06 * (1 - ny) + Math.sin(x * 6) * 0.015;
    x *= flare; z *= flare;
    y += Math.sin(x * 5 + z * 4) * 0.025 * ny;
    p.setXYZ(i, x, y + size.y / 2, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export class Showcase {
  constructor(shop) {
    this.shop = shop;
    this.group = new THREE.Group();
    shop.scene.add(this.group);
    this.saved = null;
    this.confetti = null;
    this.spinCar = null;
    this.update = (dt) => {
      if (this.spinCar) this.spinCar.rotation.y += dt * 0.45;
      if (this.confetti) {
        const c = this.confetti;
        for (let i = 0; i < c.n; i++) {
          const v = c.vel[i];
          v.y -= 3.2 * dt; v.multiplyScalar(1 - dt * 0.6);
          c.pos[i * 3] += v.x * dt; c.pos[i * 3 + 1] = Math.max(0.02, c.pos[i * 3 + 1] + v.y * dt); c.pos[i * 3 + 2] += v.z * dt;
        }
        c.points.geometry.attributes.position.needsUpdate = true;
      }
    };
    shop.onFrame.add(this.update);
  }

  reset() {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.confetti = null;
    this.spinCar = null;
    this.restoreLights();
  }

  // Lona que cae sobre el coche
  async cover(rig, sfx, instant = false) {
    const box3 = new THREE.Box3().setFromObject(rig.car);
    const size = box3.getSize(V()).add(V(0.35, 0.3, 0.35)); // holgura para que no asome nada (alerón, baca)
    const center = box3.getCenter(V());
    const cloth = this.cloth = new THREE.Mesh(clothGeometry(size), new THREE.MeshStandardMaterial({ color: '#4e1019', roughness: 0.95, flatShading: true, transparent: true, opacity: 1 }));
    cloth.castShadow = true;
    cloth.position.set(center.x, box3.min.y - 0.02, center.z);
    this.group.add(cloth);
    const yEnd = cloth.position.y;
    if (instant) return; // ya tapado cuando se ve la escena
    sfx.whoosh();
    await tween(0.9, (t) => { cloth.position.y = yEnd + 4 * (1 - t); cloth.scale.set(1, 0.4 + 0.6 * t, 1); }, ease.outBack);
    sfx.thud(0.4);
  }

  dimLights(to = 0.22) {
    const lights = [];
    this.shop.scene.traverse((o) => { if (o.isLight && !this.group.children.includes(o) && !o.userData.showcase) lights.push(o); });
    this.saved = lights.map((l) => [l, l.intensity]);
    return tween(1.0, (t) => { for (const [l, i] of this.saved) l.intensity = i * (1 - (1 - to) * t); }, ease.inOutCubic);
  }
  restoreLights() {
    if (!this.saved) return;
    for (const [l, i] of this.saved) l.intensity = i;
    this.saved = null;
  }

  // Focos con haz visible sobre la plataforma, uno a uno
  async spots(target, sfx) {
    const posList = [V(4.5, 7.5, 4.5), V(-4.5, 7.5, 4.5), V(0, 7.5, -5)];
    for (const p of posList) {
      const sp = new THREE.SpotLight('#fff3e0', 0, 30, 0.32, 0.35, 1.2);
      sp.userData.showcase = true;
      sp.position.copy(p);
      sp.target.position.copy(target);
      this.group.add(sp, sp.target);
      const len = p.distanceTo(target);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(0.32) * len, len, 24, 1, true).translate(0, -len / 2, 0), new THREE.MeshBasicMaterial({ color: '#fff1d6', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.copy(p);
      beam.quaternion.setFromUnitVectors(V(0, -1, 0), target.clone().sub(p).normalize());
      this.group.add(beam);
      sfx.thud(0.6); sfx.clank();
      await tween(0.35, (t) => { sp.intensity = 160 * t; beam.material.opacity = 0.07 * t; }, ease.outCubic);
      await wait(0.25);
    }
  }

  // Se levanta la lona, confeti y el coche empieza a girar
  async reveal(rig, sfx) {
    const cloth = this.cloth;
    const y0 = cloth.position.y;
    sfx.whoosh();
    await tween(1.2, (t) => {
      cloth.position.y = y0 + 6 * t * t;
      cloth.rotation.z = t * 0.6;
      cloth.scale.set(1 + t * 0.3, 1 - t * 0.5, 1 + t * 0.2);
      cloth.material.opacity = 1 - t;
    }, ease.inQuad);
    this.group.remove(cloth);
    // Confeti
    const n = 700, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = [];
    const at = rig.car.getWorldPosition(V());
    const palette = ['#ff6a1a', '#ffb627', '#4fa8ff', '#5fd38d', '#e573ff', '#ffffff'].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      pos.set([at.x + (Math.random() - 0.5) * 1.5, at.y + 2.2 + Math.random(), at.z + (Math.random() - 0.5) * 1.5], i * 3);
      const c = palette[i % palette.length]; col.set([c.r, c.g, c.b], i * 3);
      vel.push(V((Math.random() - 0.5) * 7, 3 + Math.random() * 5, (Math.random() - 0.5) * 7));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true }));
    points.frustumCulled = false;
    this.group.add(points);
    this.confetti = { n, pos, vel, points };
    sfx.fanfare();
  }
}
