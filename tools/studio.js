// bike studio: node studio.js OUT bikeId [views] ; views: side|front|rear|q1|q2|q3|q4|top|cock  (env NORIDER=1)
const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path = require('path'); const fs = require('fs');
const OUT = process.argv[2] || 'st', BIKE = process.argv[3] || 'strada', VIEWS = (process.argv[4] || 'side,q1,q2,q3,front,top').split(process.argv[4] && process.argv[4].includes(';') || /\|/.test(process.argv[4] || '') ? ';' : ','), Wd = +(process.env.W || 1200), Ht = +(process.env.H || 760);
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: Wd, height: Ht } });
  p.on('pageerror', e => console.log('[pageerror]', e.message)); p.on('console', m => { if (m.type() === 'error') console.log('[c]', m.text().slice(0, 300)); });
  await p.addInitScript((h) => { window.HEAT = h; }, +(process.env.HEAT || 0));
  await p.addInitScript(() => localStorage.setItem('apex3_settings', JSON.stringify({ quality: 'high', mode: 'tt', look: 'on' })));
  await p.goto('file://' + path.resolve(__dirname, '../apex/index.html'), { waitUntil: 'commit', timeout: 600000 });
  await p.waitForFunction(() => window.APEX && window.APEX.state === 'menu' && window.APEX.world, null, { timeout: 600000 });
  await p.evaluate(([id, norider, seq]) => {
    const G = window.APEX, T = window.THREE; G._manual = true; G._noRender = true;
    const r = G._r.renderer; r.setPixelRatio(1); r.setSize(innerWidth, innerHeight, false); G._r.post.setSize(innerWidth, innerHeight, 4); G._r.post.tilt = 0;
    document.querySelectorAll('body > div').forEach((d) => { d.style.visibility = 'hidden'; });
    const sc = new T.Scene(); sc.background = new T.Color(0xe9e6ef).convertSRGBToLinear();
    const P = AX.PassStyle.P; sc.add(new T.HemisphereLight(P.hemiSky, P.hemiGround, 1.0));
    const sun = new T.DirectionalLight(P.sun, 1.5); sun.position.set(-3, 5, 4); sc.add(sun); G._r.renderer.toneMappingExposure = 1.0;
    const fill = new T.DirectionalLight(0xffffff, 0.35); fill.position.set(4, 2, -3); sc.add(fill);
    const fl = new T.Mesh(new T.CircleGeometry(6, 48), new T.MeshStandardMaterial({ color: 0xd9d5df, roughness: 1 })); fl.rotation.x = -Math.PI / 2; sc.add(fl);
    const v = AX.Models.buildBike(AX.BIKES[id], AX.RIDERS[0], { env: G.world.env, batch: false }); AX.PassStyle.tameBike(v.root); sc.add(v.root);
    if (norider) v.rider.group.visible = false;
    if (window.HEAT && v.heat) { const k = window.HEAT, H = v.heat, ge = 0.05 + 0.4 * k * k; H.mF.opacity = Math.sqrt(k) * 0.9; H.mF.color.setRGB(0.55 + 0.45 * k, 0.02 + 0.15 * k * k, 0.004); H.mR.opacity = Math.sqrt(k * 0.5) * 0.9; H.mR.color.setRGB(0.55 + 0.22 * k, 0.02 + 0.04 * k * k, 0.004); H.mE.color.setRGB(ge * 1.1, ge * 0.14, ge * 0.015); v.brakeMat.color.setRGB(3.2, 0.22, 0.12); }
    window.ST = { sc, v };
    // SEQ='[[{"lean":0.7,"speed":30},300],...]': drive the visual rig through states (dt 1/60) before the pictures are taken
    const st = { x: 0, z: 0, yaw: 0, y: 0, slope: 0, lean: 0, pitch: 0, aLong: 0, speed: 0, spin: 0, slipAngle: 0, steer: 0, brake: 0, rearBrake: 0, crashed: false, surf: 0, spec: AX.BIKES[id], rpm: AX.BIKES[id].idle, throttle: 0, fx: {} };
    let t = 0; for (const [d, n] of seq) { Object.assign(st, d); for (let k = 0; k < n; k++) { t += 1 / 60; AX.Models.syncBike(v, st, 1 / 60, t); } }
    window.ST.t = t;
  }, [BIKE, !!process.env.NORIDER, JSON.parse(process.env.SEQ || '[[{},2]]')]);
  for (const view of VIEWS) {
    const url = await p.evaluate((view) => {
      const G = window.APEX, T = window.THREE, { sc } = window.ST, A = innerWidth / innerHeight; let cam;
      const s = 1.28;   // bike scale
      if (view === 'side') { const h = 1.5 * s; cam = new T.OrthographicCamera(-h * A / 2 * 1.2, h * A / 2 * 1.2, h * 0.92, -h * 0.28, 0.1, 50); cam.position.set(0, 0, 10); cam.lookAt(0, 0, 0); cam.position.set(0, 0, 10); }
      else {
        cam = new T.PerspectiveCamera(30, A, 0.1, 100);
        const V = view[1] === '|' ? null : { q1: [3.6, 1.5, 3.2], q2: [-3.4, 1.6, 3.4], q3: [3.4, 1.6, -3.4], q4: [-3.6, 1.4, -3.0], front: [5.2, 0.9, 0], rear: [-5.2, 1.0, 0], top: [0.2, 6, 0.01], cock: [-0.15, 1.95, 0], nose: [2.5, 1.25, 1.35], nosef: [2.9, 1.0, 0.0], rq1: [3.3, 2.0, 2.9], rq2: [-3.3, 2.2, 2.9], rq3: [3.3, 2.0, -2.9], rside: [0, 1.5, 5.6], rrear: [-5.2, 2.1, 0.4], head: [1.9, 2.05, 1.3], headb: [-1.9, 2.3, 1.3], pipe: [-3.2, 1.25, 1.1], disc: [2.3, 0.75, 1.5] }[view];
        if (view[0] === 'c' && view[1] === '|') { const k = window.ST.v.root.scale.x, q = view.split('|').map((e) => e.split(',').map((n) => Number(n) * k)); if (q[3]) q[3][0] /= k; cam.position.set(q[1][0], q[1][1], q[1][2]); /* model coordinates */ cam.fov = q[3] ? q[3][0] : 30; cam.updateProjectionMatrix(); cam.lookAt(q[2][0], q[2][1], q[2][2]); } else {
        cam.position.set(V[0], V[1], V[2]); if (view === 'pipe') { cam.fov = 14; cam.updateProjectionMatrix(); cam.lookAt(-0.98, 0.68, 0.29); } else if (view === 'disc') { cam.fov = 14; cam.updateProjectionMatrix(); cam.lookAt(0.9, 0.42, 0.05); } else if (view[0] === 'r') { cam.lookAt(-0.05, 1.22, 0); } else if (view === 'head' || view === 'headb') { cam.fov = 17; cam.updateProjectionMatrix(); cam.lookAt(0.05, 1.83, 0); } else if (view === 'nose' || view === 'nosef') cam.lookAt(0.88, 0.95, 0); else cam.lookAt(view === 'cock' ? 0.75 : 0, view === 'cock' ? 1.15 : 0.65, 0);
        if (view === 'cock') { cam.fov = 55; cam.updateProjectionMatrix(); } }
      }
      cam.updateMatrixWorld(); sc.updateMatrixWorld();
      G._r.post.render(sc, cam); return G._r.renderer.domElement.toDataURL('image/png');
    }, view);
    fs.writeFileSync(path.resolve(__dirname, OUT + '_' + (view[1] === '|' ? 'c' + VIEWS.indexOf(view) : view) + '.png'), Buffer.from(url.split(',')[1], 'base64')); console.log('view', view);
  }
  await b.close();
})();
