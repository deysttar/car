// Cabina de pintura: un pórtico con robots recorre el coche de delante atrás. Por donde pasa,
// la imprimación gris se convierte en el color final (uniforme uSweep del shader de chassis.js).
// Después, segunda pasada de barniz (salvo en mate) y lámparas de secado.
import * as THREE from 'three';
import { tween, wait, ease, mat, box, cyl } from './engine3d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const N = 900;
const PARK_X = 3.45; // donde espera el pórtico, al fondo de la cabina

function mistTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export class PaintBooth {
  // station: dónde está la cabina en el taller (el coche se coloca en su centro)
  constructor(scene, station) {
    this.group = new THREE.Group();
    this.group.position.set(station.x, 0, station.z);
    scene.add(this.group);
    this.buildRoom();
    const steel = mat('#c9cdd2', { metalness: 0.6, roughness: 0.3 }), orange = mat('#ff6a1a', { roughness: 0.5 }), dark = mat('#2b2f35');
    // Pórtico: viga superior, dos columnas laterales con carro vertical y boquilla central
    const g = this.gantry = new THREE.Group();
    const beam = box(0.3, 0.3, 4.6, steel); beam.position.y = 3.15; g.add(beam);
    this.carriages = [];
    this.nozzles = [];
    for (const s of [-1, 1]) {
      const post = box(0.14, 3.0, 0.14, steel); post.position.set(0, 1.65, s * 2.15); g.add(post);
      const car = new THREE.Group();
      car.add(box(0.3, 0.22, 0.24, orange));
      const arm = box(0.5, 0.08, 0.08, dark); arm.rotation.y = Math.PI / 2; arm.position.z = -s * 0.32; car.add(arm);
      const gun = cyl(0.05, 0.03, 0.18, 10, steel); gun.rotation.x = Math.PI / 2; gun.position.z = -s * 0.62; car.add(gun);
      car.position.set(0, 1.0, s * 2.15);
      g.add(car);
      this.carriages.push(car);
      this.nozzles.push({ obj: gun, dir: V(0, -0.15, -s).normalize() });
    }
    const top = new THREE.Group();
    top.add(box(0.26, 0.4, 0.26, orange));
    const tgun = cyl(0.05, 0.03, 0.2, 10, steel); tgun.position.y = -0.3; top.add(tgun);
    top.position.y = 2.75;
    g.add(top);
    this.topHead = top;
    this.nozzles.push({ obj: tgun, dir: V(0, -1, 0) });
    g.position.x = PARK_X; // aparcado al fondo de la cabina hasta que pinta
    this.group.add(g);
    // Niebla de pintura
    this.pos = new Float32Array(N * 3).fill(-50);
    this.vel = Array.from({ length: N }, () => V());
    this.life = new Float32Array(N);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mist = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.14, map: mistTexture(), color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }));
    this.mist.frustumCulled = false;
    this.group.add(this.mist);
    this.spraying = false;
    this.t = 0;
  }

  // Recinto fijo de la cabina: paredes esmeriladas, techo con luces y rejilla en el suelo.
  // Los extremos (x) quedan abiertos para entrar y salir conduciendo.
  buildRoom() {
    const frame = mat('#d9dde2', { metalness: 0.4, roughness: 0.4 }), grate = mat('#3a3f46', { metalness: 0.5 });
    const L = 7.4, Z = 2.4, H = 3.4;
    const room = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: '#f4f7fa', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, roughness: 0.3 });
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(L, H), glass); w.position.set(0, H / 2, s * Z); room.add(w);
      for (const y of [0.05, H]) { const r = box(L + 0.1, 0.1, 0.1, frame); r.position.set(0, y, s * Z); room.add(r); }
      for (const x of [-L / 2, 0, L / 2]) { const p = box(0.1, H, 0.1, frame); p.position.set(x, H / 2, s * Z); room.add(p); }
    }
    this.lamps = new THREE.MeshBasicMaterial({ color: '#eef5ff' });
    for (let x = -L / 2 + 0.6; x < L / 2; x += 1.25) {
      const b = box(0.1, 0.1, 2 * Z, frame); b.position.set(x, H + 0.05, 0); room.add(b);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 2 * Z - 0.4), this.lamps); led.position.set(x, H - 0.02, 0); room.add(led);
    }
    const floor = box(L, 0.012, 2 * Z, mat('#4a4f57', { roughness: 0.7 })); floor.position.y = 0.006; room.add(floor);
    for (let i = 0; i < 20; i++) { const g = box(0.03, 0.014, 2 * Z - 0.2, grate); g.position.set(-L / 2 + 0.2 + i * 0.37, 0.008, 0); room.add(g); }
    this.group.add(room);
  }
  // Lámparas de secado: el techo se pone naranja un momento
  async dry(dur = 1.4) {
    await tween(dur, (t) => this.lamps.color.setHSL(0.07, 1, 0.55 + 0.25 * Math.sin(t * Math.PI)), ease.linear);
    this.lamps.color.set('#eef5ff');
  }

  reset() {
    this.spraying = false;
    this.pos.fill(-50);
    this.gantry.position.x = PARK_X;
  }

  update(dt) {
    this.t += dt;
    // Los robots suben y bajan mientras pintan
    for (const [i, c] of this.carriages.entries()) c.position.y = 0.55 + 0.75 * (0.5 + 0.5 * Math.sin(this.t * 4 + i * Math.PI));
    this.topHead.position.z = Math.sin(this.t * 3) * 0.5;
    if (this.spraying) {
      this.group.updateMatrixWorld(true);
      for (const n of this.nozzles) {
        const p = n.obj.getWorldPosition(V());
        for (let k = 0; k < 9; k++) {
          const i = this.next; this.next = (this.next + 1) % N;
          this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
          this.vel[i].copy(n.dir).multiplyScalar(2.6 + Math.random()).add(V((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9));
          this.life[i] = 0.35 + Math.random() * 0.2;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const v = this.vel[i];
      v.multiplyScalar(1 - dt * 2.5);
      this.pos[i * 3] += v.x * dt; this.pos[i * 3 + 1] += (v.y - 0.3) * dt; this.pos[i * 3 + 2] += v.z * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -50;
    }
    this.mist.geometry.attributes.position.needsUpdate = true;
  }

  // Recorre el coche de un extremo a otro; onX recibe la x del pórtico en cada fotograma.
  async pass(x0, x1, dur, onX) {
    this.gantry.position.x = x0;
    await tween(dur, (t) => { this.gantry.position.x = x0 + (x1 - x0) * t; onX && onX(this.gantry.position.x); }, ease.inOutCubic);
  }

  async run(rig, finish, sfx, onPhase) {
    const P = rig.paint;
    // Coordenadas de la cabina = coordenadas del coche (está centrado en ella y mirando a +x)
    const cx = 0;
    const xa = rig.carMax + 0.7, xb = rig.carMin - 0.7;
    // El pórtico avanza desde el fondo hasta el morro
    // Baja el pórtico
    sfx.whoosh();
    await tween(0.8, (t) => (this.gantry.position.x = PARK_X + (xa - PARK_X) * t), ease.inOutCubic);
    sfx.clank();
    // Capa de color
    onPhase && onPhase('color');
    P.uFinish.value = finish.code;
    P.uPRough.value = Math.min(0.92, finish.rough + 0.3);
    P.uPMetal.value = finish.code === 1 || finish.code === 3 ? 0.15 : finish.metal;
    this.mist.material.color.copy(P.uPaint.value);
    this.spraying = true;
    sfx.spray(true);
    await this.pass(xa, xb, 4.2, (x) => (P.uSweep.value = x - cx));
    P.uSweep.value = -1e9;
    this.spraying = false;
    sfx.spray(false);
    // Barniz: el brillo y las escamas aparecen al pasar
    if (finish.id !== 'matte') {
      onPhase && onPhase('clear');
      await wait(0.3);
      this.mist.material.color.set('#e8f2ff');
      this.spraying = true;
      sfx.spray(true);
      const r0 = P.uPRough.value, m0 = P.uPMetal.value;
      await this.pass(xb, xa, 3.0, (x) => {
        const t = (xa === xb) ? 1 : (x - xb) / (xa - xb);
        P.uPRough.value = r0 + (finish.rough - r0) * t;
        P.uPMetal.value = m0 + (finish.metal - m0) * t;
      });
      this.spraying = false;
      sfx.spray(false);
    }
    P.uPRough.value = finish.rough;
    P.uPMetal.value = finish.metal;
    // Sube el pórtico
    { const x0 = this.gantry.position.x; await tween(0.8, (t) => (this.gantry.position.x = x0 + (PARK_X - x0) * t), ease.inOutCubic); }
  }
}
