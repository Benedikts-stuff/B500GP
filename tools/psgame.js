// real game: start a time trial, let the AI ride, grab chase/pov frames at a few step counts
const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path = require('path'); const fs = require('fs');
const OUT = process.argv[2] || 'pg', STEPS = (process.argv[3] || '1500').split(',').map(Number), CAM = process.env.CAM || 'chase';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => console.log('[pageerror]', e.message));
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' || t.startsWith('style')) console.log('[c]', t.slice(0, 400)); });
  await p.addInitScript((d) => { window.DBG = d; }, +(process.env.DBG || 0));
  await p.addInitScript(([cam, bk]) => localStorage.setItem('apex3_settings', JSON.stringify({ lang: 'de', quality: 'high', bike: bk, cam, assist: 'sport', mode: 'tt', look: 'on' })), [CAM, process.env.BIKE || 'strada']);
  await p.goto('file://' + path.resolve(__dirname, '../apex/index.html'), { waitUntil: 'commit', timeout: 600000 });
  await p.waitForFunction(() => window.APEX && window.APEX.state === 'menu' && window.APEX.world, null, { timeout: 600000 });
  await p.evaluate(() => { const G = window.APEX; G._manual = true; G._noRender = true; G._ui.startFromMenu(); });
  await p.waitForFunction(() => window.APEX.state === 'countdown' || window.APEX.state === 'race', null, { timeout: 300000 });
  await p.evaluate(() => { const G = window.APEX; G.ai[0] = new AX.AIRider(G.player, G.track, 0.97, 5); G.ai[0].react = 0; G.player.assist = AX.ASSISTS.ai; G.lightsT = G.goT - 0.02; document.querySelectorAll('body > div').forEach((d) => { if (d.id !== 'vignette' && d.id !== 'hud') d.style.visibility = 'hidden'; }); });
  let done = 0;
  for (const n of STEPS) {
    const url = await p.evaluate((k) => {
      const G = window.APEX; G._step(k); if (window.DBG === 1) { G.vis[0].root.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.envMap = null; m.needsUpdate = true; }); }); const rb = AX.RiderBatch.mat; if (rb) { rb.envMap = null; rb.needsUpdate = true; } } G.bannerT = 0.01; G._noRender = true; G.camInit = false;
      let t = performance.now(); for (let q = 0; q < 40; q++) { t += 16.7; if (q === 39) G._noRender = false; G._r.frame(t); } G._noRender = true;
      const u = G._r.post.mFinal.uniforms; window.__hz = { A: u.uHzA.value, hz: u.uHz.value.toArray().map((x) => +x.toFixed(3)), R: u.uHzR.value.toArray().map((x) => +x.toFixed(4)) };
      if (window.DBG === 2) { const on = G._r.renderer.domElement.toDataURL('image/png'); u.uHzA.value = 0; G._r.post.render(G.world.scene, G._r.camera); window.__off = G._r.renderer.domElement.toDataURL('image/png'); return on; }      // DBG=2: also keep the same frame without heat haze
      return G._r.renderer.domElement.toDataURL('image/png');
    }, n - done); done = n; console.log('haze', JSON.stringify(await p.evaluate(() => window.__hz)));
    fs.writeFileSync(path.resolve(__dirname, OUT + '_' + CAM + '_' + n + '.png'), Buffer.from(url.split(',')[1], 'base64')); console.log('shot', n);
    if (process.env.DBG === '2') { const off = await p.evaluate(() => window.__off); fs.writeFileSync(path.resolve(__dirname, OUT + '_' + CAM + '_' + n + '_off.png'), Buffer.from(off.split(',')[1], 'base64')); }
  }
  const st = await p.evaluate(() => { const G = window.APEX; return { idx: G.player.idx, crashed: G.player.crashed, speed: G.player.speed, state: G.state }; }); console.log(JSON.stringify(st));
  await b.close();
})();
