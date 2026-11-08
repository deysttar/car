// Utilidades de prueba (solo para depurar desde el navegador con ?debug)
window.__res = { errs: [], log: [] };
addEventListener('error', (e) => __res.errs.push(e.message));
addEventListener('unhandledrejection', (e) => __res.errs.push(String((e.reason && e.reason.stack) || e.reason)));

window.__step = async (until, budgetMs = 40000) => {
  const btn = document.getElementById('nextBtn'); const d = __debug; const s = d.shop;
  const t0 = performance.now();
  while (performance.now() - t0 < budgetMs) {
    d.clock.scale = 1;
    for (let k = 0; k < 10; k++) { s.frame(1 / 20, true); for (let m = 0; m < 6; m++) await Promise.resolve(); }
    await new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });
    if (until()) { s.frame(0); return 'hit'; }
    if (!btn.hidden && !btn.disabled && !document.body.classList.contains('building')) { __res.log.push(document.getElementById('capTitle').textContent); btn.click(); }
  }
  s.frame(0); return 'timeout';
};

window.__full = async () => {
  document.getElementById('startBtn').click();
  const r = await __step(() => document.body.classList.contains('reporting') && document.getElementById('nextBtn').hidden && !document.getElementById('final').hidden, 44000);
  return JSON.stringify({ r, log: __res.log, errs: __res.errs });
};

window.__toAero = async () => {
  document.getElementById('startBtn').click();
  return __step(() => document.getElementById('nextBtn').textContent.includes('aerodin') && !document.getElementById('nextBtn').hidden);
};

window.__kits = async () => {
  const T = await import('/multi/tunnel.js'); const THREE = await import('three');
  const d = __debug, s = d.shop, rig = d.rig, car = rig.car;
  s.controls.autoRotate = false; s.controls.enableDamping = false; s.controls.maxDistance = 100;
  const cw = s.renderer.domElement.width, ch = s.renderer.domElement.height;
  const out = document.createElement('canvas'); out.width = 1200; out.height = 800; const c2 = out.getContext('2d');
  c2.fillStyle = '#000'; c2.fillRect(0, 0, 1200, 800);
  car.updateMatrixWorld(true);
  const p = car.getWorldPosition(new THREE.Vector3());
  const views = [[p.x - 6.0, p.y + 1.9, p.z + 4.6], [p.x + 6.0, p.y + 1.3, p.z + 4.8]];
  const lv = [0.25, 0.5, 0.75];
  const th = Math.min(400, (400 * ch) / cw);
  for (let i = 0; i < 3; i++) {
    const kit = T.buildAeroKit(rig, lv[i], rig.spec.color);
    for (const o of kit.hide) o.visible = false;
    for (let v = 0; v < 2; v++) {
      s.camera.position.set(...views[v]); s.controls.target.copy(p).add(new THREE.Vector3(0, 0.5, 0)); s.camera.lookAt(s.controls.target);
      s.renderer.render(s.scene, s.camera);
      c2.drawImage(s.renderer.domElement, 0, 0, cw, ch, i * 400, v * 400, 400, th);
    }
    car.remove(kit.group); for (const o of kit.hide) o.visible = true;
  }
  c2.fillStyle = '#fff'; c2.font = '24px sans-serif';
  ['baja', 'media', 'alta'].forEach((t, i) => c2.fillText(`${t} · ${rig.spec.typeId}`, i * 400 + 10, 30));
  let img = document.getElementById('__kitimg');
  if (!img) { img = document.createElement('img'); img.id = '__kitimg'; img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;z-index:99;background:#000'; document.body.appendChild(img); }
  img.src = out.toDataURL(); img.hidden = false;
  return rig.spec.typeId;
};
