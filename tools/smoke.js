const { chromium } = require('/opt/npm-tools/node_modules/playwright'); const path=require('path');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const look of ['on','off']) {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    p.on('pageerror', e => console.log(look,'[pageerror]', e.message));
    p.on('console', m => { if (m.type()==='error') console.log(look,'[console]', m.text()); });
    await p.addInitScript(([l, bk]) => localStorage.setItem('apex3_settings', JSON.stringify({ lang: 'de', quality: 'low', look: l, bike: bk })), [look, process.env.BIKE || 'duetto']);
    await p.goto('file://' + path.resolve(__dirname, '../apex/index.html'), {waitUntil:'commit', timeout:600000});
    await p.waitForFunction(() => window.APEX && window.APEX.state === 'menu' && window.APEX.world, null, {timeout:600000});
    await p.waitForTimeout(8000);
    // a stored best lap for every bike/track, so the ghost path is exercised too
    await p.evaluate(() => { const g = []; for (let i = 0; i < 4000; i++) g.push(i * 0.5, 0, 0, 0, 0, 0); for (let i = 0; i < localStorage.length; i++) void 0; window.__g = JSON.stringify({ t: 99, v: 6, g, sp: [] }); const set = localStorage.setItem.bind(localStorage), get = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { const v = get.call(this, k); return v == null && /rec|best/i.test(k) ? window.__g : v; }; });
    const r = await p.evaluate(() => { try { const G=window.APEX; G._noRender=true; G._ui.startFromMenu(); return 'started'; } catch (e) { return 'ERR ' + e.message; } });
    await p.waitForTimeout(8000);
    const gh = await p.evaluate(() => { const G = window.APEX; let gs = 'n/a'; try { const A = window.AX; A.Models.syncBike(G.ghostVis, { x: G.player.x, z: G.player.z, yaw: 0, lean: 0.3, pitch: 0, y: G.player.y, slope: 0 }, 0.016, 1); gs = 'ok heat ' + G.ghostVis.heat; } catch (e) { gs = 'ERR ' + e.message; } return 'ghostsync ' + gs + ' ghost ' + !!G.ghostVis + ' visible ' + !!(G.ghostVis && G.ghostVis.root.visible) + ' lap ' + G.player.lap + ' bike ' + G.player.spec.id; }); console.log(look, gh);
    const st = await p.evaluate(() => window.APEX.state); console.log(look, r, st); await p.close();
  }
  await b.close();
})();
