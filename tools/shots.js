// APEX picture tool: one browser session, many pictures of the real game (the AI rides the pass).
// Used for the before/after pictures and the jitter sequences of GRAFIK_PLAN.md. Needs Playwright and Chrome, like psgame.js.
//   node tools/shots.js OUTDIR '<json spec>' [GAMEDIR]
// spec: { set: { quality, sky, bike, look }, dpr: 1, size: [1280, 720], menu: true, nostore: false, noai: false,
//         shots: [{ n: 500, cam: 'chase'|'pov'|'chest'|'tv', name: 'chase_500', eval: 'js' }],     n = physics steps (120 per second)
//         seq:   [{ n: 1340, cam: 'chase', frames: 30, name: 'wall' }],                             consecutive frames
//         init: 'js run once after the session started', final: 'js whose value is printed at the end' }
// Example (the six fixed pictures):
//   node tools/shots.js screenshots/grafik/nachher '{"menu":true,"shots":[{"n":500},{"n":1400},{"n":1500,"cam":"pov","name":"pov_1400"},{"n":2600},{"n":2700,"cam":"tv","name":"tv_2600"},{"n":4200}]}'
const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path = require('path'); const fs = require('fs');
const OUT = process.argv[2] || 'shots', SPEC = JSON.parse(process.argv[3] || '{}'), GAME = process.argv[4] || path.resolve(__dirname, '..');
fs.mkdirSync(OUT, { recursive: true });
const save = (name, url) => fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
(async () => {
  const [W, Hh] = SPEC.size || [1280, 720];
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--disable-sync', '--disable-default-apps'] });
  const p = await b.newPage({ viewport: { width: W, height: Hh }, deviceScaleFactor: SPEC.dpr || 1 });
  let errs = 0;
  p.on('pageerror', e => { errs++; console.log('[pageerror]', e.message.slice(0, 500)); });
  p.on('console', m => { const t = m.text(); if (/GPU stall|ScriptProcessor|AudioContext/.test(t)) return; if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('cap:')) { if (m.type() === 'error') errs++; console.log('[' + m.type() + ']', t.slice(0, 700)); } });
  const set = Object.assign({ lang: 'de', quality: 'high', bike: 'duetto', cam: 'chase', assist: 'sport', mode: SPEC.mode || 'tt', look: 'on', track: SPEC.track || 'pass' }, SPEC.set || {});
  if (SPEC.nostore) await p.addInitScript(() => localStorage.removeItem('apex3_settings')); else await p.addInitScript((s) => localStorage.setItem('apex3_settings', JSON.stringify(s)), set);
  const t0 = Date.now();
  await p.goto('file://' + path.resolve(GAME, 'index.html'), { waitUntil: 'commit', timeout: 600000 });
  await p.waitForFunction(() => window.APEX && window.APEX.state === 'menu' && window.APEX.world, null, { timeout: 600000 });
  console.log('loaded', ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(await p.evaluate(() => ({ q: APEX._settings.quality, pr: APEX._r.renderer.getPixelRatio(), w: APEX._r.post.w, h: APEX._r.post.h, sky: APEX._settings.sky }))));
  if (SPEC.menu) {
    const u = await p.evaluate(() => { const G = window.APEX; G._manual = true; let t = performance.now(); for (let q = 0; q < 3; q++) { t += 16.7; G._r.frame(t); } return G._r.renderer.domElement.toDataURL('image/png'); });
    save('menu', u); console.log('shot menu');
  }
  if ((SPEC.shots && SPEC.shots.length) || (SPEC.seq && SPEC.seq.length)) {
    await p.evaluate(() => { const G = window.APEX; G._manual = true; G._noRender = true; G._ui.startFromMenu(); });
    await p.waitForFunction(() => window.APEX.state === 'countdown' || window.APEX.state === 'race', null, { timeout: 300000 });
    await p.evaluate((noai) => { const G = window.APEX; if (!noai) { G.ai[0] = new AX.AIRider(G.player, G.track, 0.97, 5); G.ai[0].react = 0; G.player.assist = AX.ASSISTS.ai; } G.lightsT = G.goT - 0.02; window.__t = performance.now(); window.__done = 0; }, !!SPEC.noai);
    if (SPEC.init) await p.evaluate((js) => { (0, eval)(js); }, SPEC.init);
    const jobs = [].concat((SPEC.shots || []).map((s) => Object.assign({ kind: 'shot' }, s)), (SPEC.seq || []).map((s) => Object.assign({ kind: 'seq' }, s))).sort((a, c) => a.n - c.n);
    for (const j of jobs) {
      const url = await p.evaluate(([n, cam, js, warm]) => {
        const G = window.APEX; if (n > window.__done) { G._step(n - window.__done); window.__done = n; }
        if (cam) G._settings.cam = cam; if (js) (0, eval)(js);
        G.bannerT = 0.01; G._noRender = true; G.camInit = false;
        for (let q = 0; q < warm; q++) { window.__t += 16.7; if (q === warm - 1) G._noRender = false; G._r.frame(window.__t); window.__done += 2; } G._noRender = true;
        return G._r.renderer.domElement.toDataURL('image/png');
      }, [j.n, j.cam || 'chase', j.eval || '', j.warm || 30]);
      const name = j.name || ((j.cam || 'chase') + '_' + j.n);
      if (j.kind === 'shot') { save(name, url); }
      else {
        save(name + '_00', url);
        for (let f = 1; f < (j.frames || 30); f++) {
          const u = await p.evaluate(() => { const G = window.APEX; window.__t += 16.7; G._noRender = false; G._r.frame(window.__t); G._noRender = true; window.__done += 2; return G._r.renderer.domElement.toDataURL('image/png'); });
          save(name + '_' + String(f).padStart(2, '0'), u);
        }
      }
      const st = await p.evaluate(() => { const G = window.APEX, i = G._r.renderer.info; return { idx: G.player.idx, kmh: Math.round(G.player.speed * 3.6), crashed: G.player.crashed, calls: i.render.calls, tris: i.render.triangles, state: G.state }; });
      console.log(j.kind, name, JSON.stringify(st));
    }
  }
  if (SPEC.final) console.log('final', JSON.stringify(await p.evaluate((js) => (0, eval)(js), SPEC.final)));
  console.log('errors', errs, 'total', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  await b.close();
})();
