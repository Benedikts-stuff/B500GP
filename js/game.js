/* APEX — game: session flow, input, camera, HUD, menus. */
(function () {
  'use strict';
  const AX = window.AX, THREE = window.THREE;
  const { clamp, lerp, damp, smoothstep, mod, SURF } = AX;
  const $ = (id) => document.getElementById(id);
  const H = 1 / 120;                              // physics step

  /* ------------------------------------------------------------------ text */
  const STR = {
    de: { lap: 'RUNDE', best: 'BEST', last: 'LETZTE', modeRace: 'RENNEN', modeTT: 'ZEITFAHREN', laps: 'RUNDEN', opponents: 'GEGNER', difficulty: 'KI-STÄRKE', d0: 'LEICHT', d1: 'MITTEL', d2: 'SCHWER', d3: 'PROFI',
      assists: 'FAHRHILFEN', a0: 'VOLL', a1: 'SPORT', a2: 'AUS', camera: 'KAMERA', c0: 'VERFOLGER', c1: 'FAHRERSICHT', c2: 'VON OBEN', quality: 'GRAFIK', q0: 'NIEDRIG', q1: 'MITTEL', q2: 'HOCH', volume: 'LAUTSTÄRKE', kbAssist: 'LENKHILFE', on: 'AN', off: 'AUS', noteKbA: 'Tastatur: A/D halten legt das Motorrad so weit in die Kurve, wie die Straße vor dir verlangt. Länger halten = mehr Schräglage.', noteKbOff: 'Tastatur: A/D halten legt das Motorrad voll um, Antippen hält eine mittlere Schräglage.',
      start: 'START', chooseBike: 'MOTORRAD', chooseTrack: 'STRECKE', paused: 'PAUSE', resume: 'WEITER', restart: 'NEUSTART', toMenu: 'HAUPTMENÜ', again: 'NOCHMAL',
      noteEasy: 'Traktions-, Wheelie- und Kurven-ABS greifen früh ein. Zum Reinkommen.', noteSport: 'Keine Hilfen: Highsider, Überschlag und wegrutschendes Vorderrad gibt es. Hinterradbremse und Slides gehören dir.', notePro: 'Wie Sport, nur mit mehr Spielraum: ein paar Grad mehr Schräglage, etwas mehr Grip am Limit, Slides kommen leichter und werfen dich später ab, Trail-Braking zieht stärker. Schneller als Sport, wenn du es kannst.',
      speed: 'TEMPO', accel: 'SCHUB', agility: 'HANDLING', brake: 'BREMSE', record: 'REKORD', go: 'LOS!', finish: 'ZIEL', result: 'ERGEBNIS', ttResult: 'ZEITFAHREN', place: 'PLATZ', fastest: 'SCHNELLSTE RUNDE', newBest: 'NEUE BESTZEIT', lastLap: 'LETZTE RUNDE',
      wheelie: 'WHEELIE', crash_lowside: 'LOWSIDER', crash_highside: 'HIGHSIDER', crash_wall: 'EINSCHLAG', crash_loop: 'ÜBERSCHLAG', crash_stoppie: 'STOPPIE-ABFLUG', crash_contact: 'KOLLISION', you: 'DU', lapsDone: 'Runden', bestLap: 'Beste Runde', loading: 'STRECKE WIRD GEBAUT',
      keys: '<kbd>A</kbd><kbd>D</kbd> Lenken · <kbd>W</kbd> Gas · <kbd>S</kbd> Vorderradbremse · <kbd>Leertaste</kbd> Hinterradbremse<br><kbd>←</kbd><kbd>→</kbd> Körper zur Kurveninnenseite (mehr Grip, mehr Schräglage) · <kbd>↑</kbd> Gewicht nach vorn (besser beschleunigen, weniger Wheelie, Windschatten) · <kbd>↓</kbd> Gewicht nach hinten / aufrichten (besser bremsen, kein Stoppie, Wheelie mit Gas)<br>Leicht bremsen in Schräglage (Trail-Braking) lenkt schärfer ein · Hinterradbremse oder Gewicht nach vorn beim Bremsen stellt das Heck quer<br><kbd>Shift</kbd> halten: sanft Gas geben und bremsen · ohne Körper-Taste hängt sich der Fahrer selbst in die Kurve<br><kbd>C</kbd> Kamera · <kbd>R</kbd> Zurücksetzen · <kbd>Esc</kbd> Pause · <kbd>M</kbd> Ton<br>Gamepad: linker Stick lenken · rechter Stick Körper · RT Gas · LT Vorderradbremse · LB Hinterradbremse',
      cam_chase: 'VERFOLGER', cam_pov: 'FAHRERSICHT', cam_tv: 'TOP-DOWN', cam_follow: 'MITDREHEND', toSummit: 'BIS ZUM GIPFEL', alt: 'HÖHE', hillclimb: 'Bergrennen', summit: 'GIPFEL',
      hint: [['W', 'GAS'], ['S', 'BREMSE'], ['Leertaste', 'HINTERRAD'], ['A D', 'LENKEN'], ['← → ↑ ↓', 'KÖRPER'], ['C', 'KAMERA']],
      settings: 'EINSTELLUNGEN', lookL: 'GRAFIKSTIL', lookOn: 'ABENDSTIMMUNG', lookOff: 'KLASSISCH', lookNoteOn: 'Der neue Look: tiefe Abendsonne, Dunst, echtes Gras, Lärchen und Tannen. Braucht eine starke Grafikkarte.', lookNoteOff: 'Der bisherige Look mit Zuschauern und Deko.', controls: 'STEUERUNG', back: 'ZURÜCK', mainHead: 'HAUPTMENÜ', subTT: 'Allein gegen die Uhr', subRace: 'Gegen die KI zum Gipfel',
      noteTT: 'Du gegen die Uhr, vom Dorf bis auf den Pass. Deine Bestfahrt fährt als Ghost mit, Zwischenzeiten zeigen dir, wo du Zeit gewinnst oder verlierst.',
      noteRace: 'Massenstart auf der Passstraße gegen KI-Fahrer. Wer zuerst oben ist, gewinnt.', noteSettings: 'Grafik, Lenkhilfe, Lautstärke und Sprache.', noteControls: 'Alle Tasten und ein paar Fahrtipps.',
      nav: [['↑ ↓', 'WÄHLEN'], ['← →', 'ÄNDERN'], ['Enter', 'OK'], ['Esc', 'ZURÜCK']], noteStart: 'Los geht’s.',
      camNote: { chase: 'Hinter dem Motorrad, schwenkt sanft mit.', pov: 'Cockpit-Sicht über dem Tank, ruhig geführt.', tv: 'Hoch von oben, wie eine Übersichtskarte.' },
      qNote: { low: 'Für ältere Rechner und Laptops.', medium: 'Ausgewogen, mit weichem Licht.', high: 'Alles an, inklusive Umgebungsverschattung. Für starke Grafikkarten.' },
      volNote: 'Gesamtlautstärke. M schaltet im Spiel stumm.', langNote: 'Sprache der Menüs.', oppNote: 'Anzahl der KI-Fahrer.', diffNote: 'Wie schnell die KI fährt.',
      length: 'LÄNGE', hairpins: 'KEHREN', climb: 'HÖHE', yourBest: 'DEINE BESTZEIT', sector: 'SEKTOR', gold: 'GOLD', silver: 'SILBER', bronze: 'BRONZE', toBest: 'ZUR BESTZEIT', firstRun: 'ERSTE ZEIT',
      ctlRide: 'FAHREN', ctlBody: 'KÖRPER', ctlMore: 'SONSTIGES',
      ctl: [['W', 'Gas'], ['S', 'Vorderradbremse'], ['Leertaste', 'Hinterradbremse'], ['A D', 'Lenken'], ['Shift', 'gehalten: sanft Gas und Bremse']],
      ctlB: [['← →', 'Hanging-off zur Seite: mehr Grip, mehr Schräglage'], ['↑', 'Gewicht vorne: Wheelie unterdrücken, Windschatten'], ['↓', 'Gewicht hinten: stabiler bremsen, Wheelie mit Gas']],
      ctlM: [['C', 'Kamera'], ['R', 'zurück auf die Straße'], ['Esc', 'Pause'], ['M', 'Ton aus'], ['F', 'FPS'], ['Mausrad', 'Kamera-Abstand']],
      ctlTip: 'Leicht weiterbremsen beim Einlenken zieht das Motorrad enger in die Kurve. Hart bremsen und kurz lenken, dazu die Hinterradbremse, stellt das Heck quer. Ohne Körper-Taste hängt sich der Fahrer selbst in die Kurve.' },
    en: { lap: 'LAP', best: 'BEST', last: 'LAST', modeRace: 'RACE', modeTT: 'TIME TRIAL', laps: 'LAPS', opponents: 'OPPONENTS', difficulty: 'AI LEVEL', d0: 'EASY', d1: 'MEDIUM', d2: 'HARD', d3: 'EXPERT',
      assists: 'ASSISTS', a0: 'FULL', a1: 'SPORT', a2: 'OFF', camera: 'CAMERA', c0: 'CHASE', c1: 'HELMET', c2: 'TOP-DOWN', quality: 'GRAPHICS', q0: 'LOW', q1: 'MEDIUM', q2: 'HIGH', volume: 'VOLUME', kbAssist: 'STEER ASSIST', on: 'ON', off: 'OFF', noteKbA: 'Keyboard: holding A/D leans the bike as far as the road ahead needs. Hold longer for more lean.', noteKbOff: 'Keyboard: holding A/D leans the bike all the way, tapping holds a medium lean.',
      start: 'START', chooseBike: 'BIKE', chooseTrack: 'CIRCUIT', paused: 'PAUSED', resume: 'RESUME', restart: 'RESTART', toMenu: 'MAIN MENU', again: 'AGAIN',
      noteEasy: 'Traction, wheelie and cornering ABS step in early. Good for learning.', noteSport: 'No assists: highsides, loop-outs and front-end tucks included. The rear brake and the slides are all yours.', notePro: 'Like Sport with more room: a few degrees more lean, a little more grip at the limit, slides come easier and throw you off later, trail braking bites harder. Faster than Sport if you can ride it.',
      speed: 'SPEED', accel: 'DRIVE', agility: 'HANDLING', brake: 'BRAKES', record: 'RECORD', go: 'GO!', finish: 'FINISH', result: 'RESULT', ttResult: 'TIME TRIAL', place: 'PLACE', fastest: 'FASTEST LAP', newBest: 'NEW BEST LAP', lastLap: 'FINAL LAP',
      wheelie: 'WHEELIE', crash_lowside: 'LOWSIDE', crash_highside: 'HIGHSIDE', crash_wall: 'IMPACT', crash_loop: 'LOOPED IT', crash_stoppie: 'OVER THE BARS', crash_contact: 'CONTACT', you: 'YOU', lapsDone: 'laps', bestLap: 'Best lap', loading: 'BUILDING CIRCUIT',
      keys: '<kbd>A</kbd><kbd>D</kbd> steer · <kbd>W</kbd> throttle · <kbd>S</kbd> front brake · <kbd>Space</kbd> rear brake<br><kbd>←</kbd><kbd>→</kbd> hang off to the inside (more grip, more lean) · <kbd>↑</kbd> weight forward (better drive, fewer wheelies, tucks in) · <kbd>↓</kbd> weight back / sit up (better braking, no stoppie, wheelie with throttle)<br>Light braking while leaned (trail braking) turns in sharper · rear brake or weight forward under braking backs the rear in<br>Hold <kbd>Shift</kbd> for gentle throttle and brakes · with no body key held the rider hangs off into the corner by himself<br><kbd>C</kbd> camera · <kbd>R</kbd> reset · <kbd>Esc</kbd> pause · <kbd>M</kbd> mute<br>Gamepad: left stick steer · right stick body · RT throttle · LT front brake · LB rear brake',
      cam_chase: 'CHASE', cam_pov: 'HELMET CAM', cam_tv: 'TOP-DOWN', cam_follow: 'ROTATING', toSummit: 'TO SUMMIT', alt: 'ALTITUDE', hillclimb: 'Hill climb', summit: 'SUMMIT',
      hint: [['W', 'THROTTLE'], ['S', 'BRAKE'], ['Space', 'REAR'], ['A D', 'STEER'], ['← → ↑ ↓', 'BODY'], ['C', 'CAMERA']],
      settings: 'SETTINGS', lookL: 'ART STYLE', lookOn: 'GOLDEN HOUR', lookOff: 'CLASSIC', lookNoteOn: 'The new look: low evening sun, haze, real grass, larches and firs. Needs a strong graphics card.', lookNoteOff: 'The previous look with spectators and dressing.', controls: 'CONTROLS', back: 'BACK', mainHead: 'MAIN MENU', subTT: 'Alone against the clock', subRace: 'Race the AI to the summit',
      noteTT: 'You against the clock, from the village to the top of the pass. Your best run rides along as a ghost, split times show where you gain or lose.',
      noteRace: 'Mass start on the pass road against AI riders. First to the top wins.', noteSettings: 'Graphics, steer assist, volume and language.', noteControls: 'Every key and a few riding tips.',
      nav: [['↑ ↓', 'SELECT'], ['← →', 'CHANGE'], ['Enter', 'OK'], ['Esc', 'BACK']], noteStart: 'Let’s go.',
      camNote: { chase: 'Behind the bike, swings round gently.', pov: 'Cockpit view over the tank, steady.', tv: 'High overhead, like a map.' },
      qNote: { low: 'For older computers and laptops.', medium: 'Balanced, with soft light.', high: 'Everything on, including ambient occlusion. For strong graphics cards.' },
      volNote: 'Master volume. M mutes in game.', langNote: 'Menu language.', oppNote: 'Number of AI riders.', diffNote: 'How fast the AI rides.',
      length: 'LENGTH', hairpins: 'HAIRPINS', climb: 'CLIMB', yourBest: 'YOUR BEST', sector: 'SECTOR', gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE', toBest: 'TO YOUR BEST', firstRun: 'FIRST TIME',
      ctlRide: 'RIDING', ctlBody: 'BODY', ctlMore: 'MORE',
      ctl: [['W', 'Throttle'], ['S', 'Front brake'], ['Space', 'Rear brake'], ['A D', 'Steer'], ['Shift', 'held: gentle throttle and brakes']],
      ctlB: [['← →', 'Hang off to the side: more grip, more lean'], ['↑', 'Weight forward: keep the front down, tuck in'], ['↓', 'Weight back: steadier braking, wheelie on the gas']],
      ctlM: [['C', 'Camera'], ['R', 'Back onto the road'], ['Esc', 'Pause'], ['M', 'Mute'], ['F', 'FPS'], ['Wheel', 'Camera distance']],
      ctlTip: 'A little brake while turning in pulls the bike tighter. Brake hard, flick the bars and add rear brake to back it in. With no body key held the rider hangs off by himself.' }
  };
  let T = STR.de;

  /* ------------------------------------------------------------------ settings */
  const KEY = 'apex3_settings';
  const S = Object.assign({ lang: (navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en', bike: 'strada', track: 'pass', mode: 'tt', laps: 3, opp: 5, diff: 1, assist: 'pro', cam: 'chase', quality: 'medium', vol: 0.8, kbAssist: 'on', look: 'on' },
    (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })());
  S.track = 'pass';                               // the circuits are out of the menu for now
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode */ } };
  const recKey = (track, bike) => 'apex2_best_' + track + '_' + bike + (track === 'pass' ? '_v2' : '');   // v2: the pass was re-routed, old records and ghosts no longer fit
  const loadRec = (track, bike) => { try { return JSON.parse(localStorage.getItem(recKey(track, bike))); } catch (e) { return null; } };
  const DIFF = [{ base: 0.855, spread: 0.035 }, { base: 0.9, spread: 0.035 }, { base: 0.94, spread: 0.032 }, { base: 0.975, spread: 0.028 }];

  /* ------------------------------------------------------------------ renderer */
  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });   // anti-aliasing happens in the post target
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const camera = new THREE.PerspectiveCamera(27, 1, 0.3, 9000);
  const post = new AX.PostFX(renderer);
  const sound = new AX.Sound(); sound.volume = S.vol;

  const G = {
    state: 'menu', track: null, world: null, bikes: [], vis: [], ai: [], player: null, skid: null, smoke: null, sparks: null,
    acc: 0, time: 0, raceTime: 0, lightsT: 0, lightsN: 0, goT: 0, order: [], finishCount: 0, winnerDone: false,
    zoom: 1, camYaw: 0, camLook: new THREE.Vector3(), camPos: new THREE.Vector3(), camInit: false, shake: 0,
    ghost: null, ghostVis: null, rs: [], lastDown: -1e9, downs: 0, dyn: 1, pr: 1, fpsT: 0, fpsN: 0, fps: 60, slowT: 0, fastT: 0, rec: null, recT: 0, best: null, fastest: 0, wheelieDist: 0, towerT: 0, menuAng: 0, hintT: 0, bannerT: 0, revRpm: 1500, quality: null
  };
  window.APEX = G;   // handy for debugging in the console

  function resize() {
    // render scale: Retina screens at full 2x would quadruple the pixels; the dynamic factor drops further if frames run long
    const w = window.innerWidth, h = window.innerHeight; const cap = S.quality === 'high' ? 1.5 : S.quality === 'medium' ? 1.0 : 0.8;
    const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, cap) * G.dyn); renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix(); G.pr = pr;
    post.aoOn = S.quality === 'high' && !AX.LOOK; post.aoFar = 140;
    post.enabled = true; post.setSize(Math.round(w * pr), Math.round(h * pr), S.quality === 'low' ? 0 : pr <= 1.1 ? 4 : 2);
  }
  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------------ input */
  const keys = {}; let padPrev = {};
  const inp = { steer: 0, throttle: 0, brake: 0, rearBrake: 0, wheelie: false, analog: false, steerAnalog: false, autoHang: true, bodyX: 0, bodyY: 0 };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); return; }
    keys[e.code] = true; sound.init();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (G.state === 'menu' || G.state === 'paused' || G.state === 'results') { if (navKey(e.code)) { e.preventDefault(); return; } }
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyC' && G.state !== 'menu') cycleCam();
    if (e.code === 'KeyF') { $('fps').classList.toggle('hidden'); }
    if (e.code === 'KeyM') { sound.setMuted(!sound.muted); toast(sound.muted ? '🔇' : '🔊'); }
    if (e.code === 'KeyR' && G.player && (G.state === 'race' || G.state === 'finished')) { if (!G.player.crashed) { G.player.respawn(); } }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (G.state === 'race' || G.state === 'countdown') togglePause(); });
  window.addEventListener('pointerdown', () => sound.init());
  window.addEventListener('wheel', (e) => { if (G.state !== 'menu') G.zoom = clamp(G.zoom * (e.deltaY > 0 ? 1.08 : 0.925), 0.6, 1.7); }, { passive: true });
  function readInput() {
    let st = 0, th = 0, br = 0, rb = 0, wh = false, analog = false, bx = 0, by = 0;
    if (keys.KeyA) st -= 1; if (keys.KeyD) st += 1;                       // steer
    if (keys.KeyW) th = 1; if (keys.KeyS) br = 1;                         // throttle / front brake
    if (keys.ShiftLeft || keys.ShiftRight) { th *= 0.45; br *= 0.5; }    // Shift: gentle - part throttle, trail braking
    if (keys.Space) rb = 1;                                                // rear brake
    if (keys.ArrowLeft) bx -= 1; if (keys.ArrowRight) bx += 1;            // rider hangs off left / right
    if (keys.ArrowUp) by += 1; if (keys.ArrowDown) by -= 1;   // weight forward / back
    let padBody = false;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue; const b = (i) => (p.buttons[i] ? p.buttons[i].value : 0), pr = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const dz = (v) => (Math.abs(v) < 0.1 ? 0 : (v - Math.sign(v) * 0.1) / 0.9); const ax = dz(p.axes[0] || 0);
      const gs = ax + (pr(15) ? 1 : 0) - (pr(14) ? 1 : 0), gt = Math.max(b(7), pr(0) && !p.buttons[7] ? 1 : 0), gb = b(6);
      if (Math.abs(gs) > 0.02 || gt > 0.02 || gb > 0.02) { analog = true; st = clamp(Math.sign(gs) * Math.pow(Math.abs(gs), 1.5), -1, 1); th = Math.max(th, gt); br = Math.max(br, gb); sound.init(); }
      rb = Math.max(rb, b(4), b(5) * 0); const rx = dz(p.axes[2] || 0), ry = dz(p.axes[3] || 0); padBody = true; if (Math.abs(rx) > 0.02) bx = rx; if (Math.abs(ry) > 0.02) by = -ry;
      const edge = (i) => pr(i) && !padPrev[i]; if (edge(9)) { if (G.state === 'menu') startFromMenu(); else if (G.state === 'results') restart(); else togglePause(); } if (edge(3)) cycleCam(); if (edge(1) && G.player && !G.player.crashed && G.state === 'race') G.player.respawn();
      padPrev = {}; for (let i = 0; i < p.buttons.length; i++) padPrev[i] = pr(i); break;
    }
    inp.steer = st; inp.throttle = th; inp.brake = br; inp.rearBrake = rb; inp.wheelie = wh; inp.analog = analog; inp.steerAnalog = analog; inp.leanAssist = !analog && S.kbAssist === 'on'; inp.autoHang = !padBody; inp.bodyX = bx; inp.bodyY = by; return inp;
  }

  /* ------------------------------------------------------------------ building a session */
  function buildWorld(trackId) {
    if (G.world && G.track.id === trackId && G.quality === S.quality && G.look === S.look) return;
    clearBikes(); if (G.world) G.world.dispose();
    AX.LOOK = S.look === 'on' && trackId === 'pass';
    G.track = new AX.Track(trackId); G.world = new AX.World(renderer, G.track, { quality: S.quality }); G.quality = S.quality; G.look = S.look;
    if (AX.LOOK && AX.Look) { G.lookInfo = AX.Look.applyWorld(G.world, renderer, post); console.log('look', JSON.stringify(G.lookInfo)); }
    else { renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMappingExposure = 1.0; }
    G.skid = new AX.SkidMarks(G.world.scene, 9000); G.smoke = new AX.Particles(G.world.scene, 1600, false); G.sparks = new AX.Particles(G.world.scene, 500, true);
    buildMinimap(); G.camInit = false; resize();
  }
  function clearBikes() {
    for (const v of G.vis) AX.Models.disposeBike(v); if (G.ghostVis) { AX.Models.disposeBike(G.ghostVis); G.ghostVis = null; }
    G.bikes = []; G.vis = []; G.ai = []; G.rs = []; G.player = null;
  }
  function addBike(spec, rider, opts) {
    const b = new AX.Bike(spec, G.track, opts); const v = AX.Models.buildBike(spec, rider, { env: G.world.env }); G.world.scene.add(v.root); if (G.world.look) AX.Look.tameBike(v.root);
    b.rider = rider; G.bikes.push(b); G.vis.push(v); return b;
  }
  function setupSession() {
    buildWorld(S.track); clearBikes(); G.skid.clear(); G.smoke.clear(); G.sparks.clear();
    const spec = AX.BIKES[S.bike], t = G.track; const race = S.mode === 'race';
    const n = race ? S.opp + 1 : 1; const d = DIFF[S.diff]; const rng = AX.RNG((Date.now() & 0xffff) + 7);
    const slotP = race ? Math.min(n - 1, Math.floor(n * 0.6)) : 0;
    const riders = AX.RIDERS.slice(1); for (let i = riders.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const q = riders[i]; riders[i] = riders[j]; riders[j] = q; }
    const me = Object.assign({}, AX.RIDERS[0], { name: T.you });
    const p = addBike(spec, me, { assist: AX.ASSISTS[S.assist], isPlayer: true }); G.player = p; p.placeOnGrid(slotP); p.flying = !race && !G.track.open; G.ai.push(null);
    let slot = 0;
    for (let k = 0; k < n - 1; k++) {
      if (slot === slotP) slot++;
      const pace = d.base + d.spread * (1 - 2 * (slot / Math.max(1, n - 1))) + rng.range(-0.006, 0.006);
      const b = addBike(spec, riders[k % riders.length], { assist: AX.ASSISTS.ai }); b.placeOnGrid(slot); G.ai.push(new AX.AIRider(b, t, pace, 100 + k * 31 + (Date.now() & 255))); slot++;
    }
    for (const b of G.bikes) {
      b.onLap = onLap; b.onCrash = (bk, type) => { if (bk === G.player) { banner(T['crash_' + type] || type, '', 1.5); sound.crash(clamp(bk.speed / 40, 0.4, 1)); G.shake = 0.35; } else if (distToPlayer(bk) < 60) sound.crash(0.35); burst(bk); };
    }
    G.time = 0; G.raceTime = 0; G.acc = 0; G.finishCount = 0; G.winnerDone = false; G.fastest = 0; G.wheelieDist = 0; G.recT = 0; G.rec = []; G.order = G.bikes.map((_, i) => i);
    // time trial ghost
    G.best = loadRec(S.track, S.bike); G.ghost = null;
    if (!race && G.best && G.best.g) { G.ghost = G.best; G.ghostVis = AX.Models.ghostify(AX.Models.buildBike(spec, me, { env: null, batch: false }), 0x7fd0ff); G.world.scene.add(G.ghostVis.root); G.ghostVis.root.visible = false; }
    for (let i = 0; i < G.bikes.length; i++) AX.Models.syncBike(G.vis[i], G.bikes[i], 0.016, 0);
    sound.configVoice(0, spec);
  }
  function distToPlayer(b) { return Math.hypot(b.x - G.player.x, b.z - G.player.z); }

  /* ------------------------------------------------------------------ race events */
  function onLap(b, lap, lapTime, tCross) {
    const race = S.mode === 'race';
    if (lapTime > 0) {
      if (!G.fastest || lapTime < G.fastest) { G.fastest = lapTime; G.fastestBike = b; if (race && b === G.player && lap > 1) toast(T.fastest + ' ' + AX.formatTime(lapTime), 'purple'); }
      if (b === G.player) {
        const old = G.best && G.best.t;
        if (!old || lapTime < old) {
          G.best = { t: lapTime, v: 6, g: G.rec.map((v) => Math.round(v * 100) / 100), sp: G.splits.slice() };
          try { localStorage.setItem(recKey(S.track, S.bike), JSON.stringify(G.best)); } catch (e) { /* quota */ }
          if (!race) { toast(T.newBest + ' ' + AX.formatTime(lapTime), 'purple'); sound.chime(); G.ghost = G.best; if (!G.ghostVis) { G.ghostVis = AX.Models.ghostify(AX.Models.buildBike(b.spec, b.rider, { env: null, batch: false }), 0x7fd0ff); G.world.scene.add(G.ghostVis.root); } }
        }
      }
    }
    if (b === G.player) { G.rec = []; G.splits = []; G.recT = 0; }
    if (race) {
      if (lap >= S.laps || (G.winnerDone && lap > 0)) {
        if (!b.finished) { b.finished = true; b.finishTime = tCross; b.finishPos = ++G.finishCount; G.winnerDone = true; if (b === G.player) finishRace(); }
      } else if (b === G.player && lap === S.laps - 1) { toast(T.lastLap); sound.chime(); }
    }
  }
  function onSummit(tf) {
    G.lastFinish = tf;
    if (!G.fastest || tf < G.fastest) { G.fastest = tf; G.fastestBike = G.player; }
    const old = G.best && G.best.t;
    if (!old || tf < old) {
      G.best = { t: tf, v: 6, g: G.rec.map((v) => Math.round(v * 100) / 100), sp: (G.splits || []).slice() };
      try { localStorage.setItem(recKey(S.track, S.bike), JSON.stringify(G.best)); } catch (e) { /* quota */ }
      setTimeout(() => toast(T.newBest + ' ' + AX.formatTime(tf), 'purple'), 900);
    }
    finishRace();
  }
  function finishRace() {
    G.state = 'finished'; banner(T.finish, 'green', 2.2); sound.chime();
    G.ai[0] = new AX.AIRider(G.player, G.track, 0.82, 5); G.ai[0].react = 0; G.player.assist = AX.ASSISTS.easy;
    if (G.track.open) G.ghost = G.best;
    setTimeout(() => { if (G.state === 'finished') showResults(); }, 2600);
  }
  function standings() {
    G.order.sort((a, b) => { const A = G.bikes[a], B = G.bikes[b]; if (A.finished || B.finished) { if (A.finished && B.finished) return A.finishPos - B.finishPos; return A.finished ? -1 : 1; } return B.prog - A.prog; });
    return G.order;
  }

  /* ------------------------------------------------------------------ simulation */
  const aiIdle = { steer: 0, throttle: 0, brake: 1, analog: true };
  function stepSim() {
    const p = G.player, t = G.track; G.time += H;
    if (G.state === 'countdown') {
      G.lightsT += H; const n = clamp(Math.floor(G.lightsT - 0.6), 0, 5);
      if (n !== G.lightsN) { G.lightsN = n; G.world.setStartLights(n); setLights(n); if (n > 0) sound.lightBeep(false); }
      if (G.lightsT > G.goT) { G.state = 'race'; G.world.setStartLights(0); setLights(-1); sound.lightBeep(true); banner(T.go, 'green', 0.9); setTimeout(() => $('lights').classList.add('hidden'), 900); }
      G.revRpm = damp(G.revRpm, p.spec.idle + inp.throttle * p.spec.redline * 0.72, inp.throttle > 0.1 ? 9 : 5, H); p.rpm = G.revRpm; p.throttle = inp.throttle;
      for (let i = 1; i < G.bikes.length; i++) { const b = G.bikes[i]; const blip = Math.sin(G.time * (2.1 + i * 0.37) + i * 2.4) > 0.55 ? 1 : 0; b.throttle = blip; b.rpm = damp(b.rpm, b.spec.idle + blip * b.spec.redline * 0.6, blip ? 8 : 4, H); }
      return;
    }
    G.raceTime += H;
    for (const b of G.bikes) { b._px = b.x; b._pz = b.z; b._py = b.y; b._pyaw = b.yaw; b._plean = b.lean; b._ppitch = b.pitch; }
    for (let i = 0; i < G.bikes.length; i++) {
      const b = G.bikes[i]; const ai = G.ai[i];
      const input = ai ? ai.update(H, G.bikes, G.raceTime) : inp;
      b.step(H, input);
      const f = b.fx, me = b === p, near = me || distToPlayer(b) < 70;
      // tyre marks: rear always, front under hard trail braking
      const sc = G.vis[i].scale, hx = G.vis[i].hx * sc, cx = Math.cos(b.yaw), sz = Math.sin(b.yaw), offroad = b.surf === SURF.GRASS || b.surf === SURF.GRAVEL;
      const lo = -Math.sin(b.lean) * 0.11 * sc;   // contact patch moves onto the tyre's shoulder with lean
      G.skid.mark(i * 2, b.x - cx * hx - sz * lo, b.z - sz * hx + cx * lo, 0.075 * sc * (0.8 + b.mark * 0.45), b.crashed || offroad || b.mark < 0.08 ? 0 : 0.35 + 0.6 * b.mark, (b.y || 0) + 0.031);
      G.skid.mark(i * 2 + 1, b.x + cx * hx - sz * lo, b.z + sz * hx + cx * lo, 0.06 * sc, b.crashed || offroad ? 0 : f.frontSkid * 0.55, (b.y || 0) + 0.031);
      if (me) {
        if (f.shift) sound.shift(f.shift > 0);
        if (f.landing > 0.15) sound.land(f.landing);
        if (f.wallHit && !f.crashStart) sound.wall(f.wallHit);
        if (b.pitch > 0.06) G.wheelieDist += b.speed * H; else { if (G.wheelieDist > 25) toast(T.wheelie + ' ' + Math.round(G.wheelieDist) + ' m'); G.wheelieDist = 0; }
        // record the lap for the ghost and the live delta
        if ((b.lap >= 0 || G.track.open) && !b.crashed && !b.finished) {
          G.recT += H; if (G.recT >= 1 / 30) { G.recT -= 1 / 30; G.rec.push(b.x, b.z, b.yaw, b.lean, b.pitch, Math.round((b.y || 0) * 100) / 100); }
          const k = Math.floor(b.trackPos / 10); if (!G.splits) G.splits = []; if (G.splits[k] == null) G.splits[k] = Math.round(b.lapTime * 1000) / 1000;
        }
      } else if (near && f.wallHit && !f.crashStart) { /* quiet */ }
      if (near) emit(b, G.vis[i], f);
    }
    if (G.track.open) for (const b of G.bikes) {
      if (!b.finished && b.sPrev >= G.track.finishS) {
        const over = b.sPrev - G.track.finishS, tf = b.time - (b.speed > 1 ? over / b.speed : 0);
        b.finished = true; b.finishTime = tf; b.finishPos = ++G.finishCount; b.lastLap = tf; b.bestLap = tf; G.winnerDone = true;
        if (b === G.player) onSummit(tf);
      }
    }
    for (let i = 0; i < G.bikes.length; i++) for (let j = i + 1; j < G.bikes.length; j++) {
      const hit = AX.collideBikes(G.bikes[i], G.bikes[j]); if (hit > 1 && (i === 0 || j === 0)) sound.wall(clamp(hit / 8, 0.2, 0.8));
    }
  }

  /* ------------------------------------------------------------------ particles */
  const _v = new THREE.Vector3(), _kv = new THREE.Vector3();
  function emit(b, vis, f) {
    const ys = b.y || 0;
    const sm = G.smoke, sc = vis.scale, cx = Math.cos(b.yaw), sz = Math.sin(b.yaw), rx = b.x - cx * vis.hx * sc, rz = b.z - sz * vis.hx * sc, r = Math.random;
    if (b.crashed) {
      if (b.speed > 3) {
        if (b.surf <= SURF.KERB && r() < 0.6) G.sparks.spawn(b.x + (r() - 0.5), 0.1 + ys, b.z + (r() - 0.5), -b.vx * 0.3 + (r() - 0.5) * 6, 1 + r() * 3, -b.vz * 0.3 + (r() - 0.5) * 6, 0.25 + r() * 0.3, 0.12, 1, 0.75, 0.3, 1, 0, 1, 12);
        if (b.surf >= SURF.GRASS && r() < 0.5) { const g = b.surf === SURF.GRAVEL; sm.spawn(b.x, 0.3 + ys, b.z, (r() - 0.5) * 3, 1.5 + r() * 2, (r() - 0.5) * 3, 0.9, 0.9, g ? 0.72 : 0.36, g ? 0.64 : 0.42, g ? 0.46 : 0.22, 0.55, 2.4, 1.5, 0); }
      }
      return;
    }
    // footpeg feeler touching down at full lean: a few sparks from the inside
    if (Math.abs(b.lean) > 1.0 && b.speed > 8 && b.surf <= SURF.KERB && r() < (Math.abs(b.lean) - 1.0) * 6) {
      const sgn = -Math.sign(b.lean), px = b.x - cx * 0.2 * sc + sz * sgn * 0.42 * sc, pz = b.z - sz * 0.2 * sc - cx * sgn * 0.42 * sc;
      G.sparks.spawn(px, 0.06 + ys, pz, -b.vx * 0.25 + (r() - 0.5) * 3, 0.6 + r() * 1.6, -b.vz * 0.25 + (r() - 0.5) * 3, 0.18 + r() * 0.15, 0.08, 1, 0.8, 0.35, 1, 0, 1, 10);
    }
    if ((b.surf === SURF.GRASS || b.surf === SURF.GRAVEL) && b.speed > 5 && r() < 0.7) {
      const g = b.surf === SURF.GRAVEL;
      sm.spawn(rx, 0.2 + ys, rz, b.vx * 0.3 + (r() - 0.5) * 3, 0.8 + r() * 1.8, b.vz * 0.3 + (r() - 0.5) * 3, 0.8 + r() * 0.6, 0.6, g ? 0.74 : 0.42, g ? 0.66 : 0.5, g ? 0.48 : 0.26, g ? 0.5 : 0.32, 2.6, 1.4, 0);
      if (r() < 0.5) sm.spawn(rx, 0.15 + ys, rz, b.vx * 0.5 + (r() - 0.5) * 5, 2 + r() * 3, b.vz * 0.5 + (r() - 0.5) * 5, 0.5, 0.11, g ? 0.6 : 0.3, g ? 0.54 : 0.44, g ? 0.4 : 0.18, 0.95, 0, 0.6, 14);
    }
    if (f.scrape && r() < 0.7) G.sparks.spawn(b.x, 0.5 + ys, b.z, -b.vx * 0.2 + (r() - 0.5) * 5, 1 + r() * 2, -b.vz * 0.2 + (r() - 0.5) * 5, 0.22, 0.1, 1, 0.8, 0.35, 1, 0, 1, 10);
    if (f.backfire > 0 && r() < 0.05) { vis.exhaustPos(_v); G.sparks.spawn(_v.x, _v.y, _v.z, -cx * 3, 0.3, -sz * 3, 0.09, 0.4, 1, 0.6, 0.2, 0.9, 1.5, 4, 0); if (b === G.player) G.pop = 0.55; }
  }
  function burst(b) {
    const ys = b.y || 0;
    const r = Math.random, g = b.surf === SURF.GRAVEL;
    for (let k = 0; k < 14; k++) G.smoke.spawn(b.x, 0.3 + ys, b.z, b.vx * 0.3 + (r() - 0.5) * 7, 1 + r() * 3, b.vz * 0.3 + (r() - 0.5) * 7, 0.9 + r() * 0.5, 0.7, g ? 0.74 : 0.8, g ? 0.66 : 0.8, g ? 0.5 : 0.8, 0.35, 3, 1.6, 0);
    if (b.surf <= SURF.KERB) for (let k = 0; k < 22; k++) G.sparks.spawn(b.x, 0.3 + ys, b.z, b.vx * 0.5 + (r() - 0.5) * 12, 1 + r() * 5, b.vz * 0.5 + (r() - 0.5) * 12, 0.3 + r() * 0.4, 0.13, 1, 0.78, 0.3, 1, 0, 0.8, 12);
  }

  /* ------------------------------------------------------------------ camera */
  const _look = new THREE.Vector3(), _pos = new THREE.Vector3();
  function cycleCam() { const o = ['chase', 'pov', 'tv', 'follow']; S.cam = o[(o.indexOf(S.cam) + 1) % 3]; save(); toast(T['cam_' + S.cam]); }
  /* helmet camera: sits in the rider's head, rolls with the bike but less (riders keep their eyes level) */
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _hp = new THREE.Vector3();
  let povOn = false;
  function setPov(on) {
    if (on === povOn) return; povOn = on; const v = G.vis[0]; if (!v) return;
    const rig = v.rider; if (on && !rig.pov) G.povReset = true; rig.pov = on; rig.torso.visible = !on; rig.helmet.visible = !on;
    if (on && !v.dash) makeDash(v); if (v.dash) v.dash.visible = on;
    camera.near = on ? 0.05 : 0.3; camera.updateProjectionMatrix();
  }
  /* digital dash on the top yoke: gear, speed, rev bar with shift lights (only in the helmet cam) */
  function makeDash(v) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const tx = new THREE.CanvasTexture(c); tx.encoding = THREE.sRGBEncoding;
    const naked = v.spec.style.fairing === 'naked';
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.085), new THREE.MeshBasicMaterial({ map: tx, toneMapped: false }));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.105, 0.03), new THREE.MeshBasicMaterial({ color: 0x0b0c0e }));
    const g = new THREE.Group(); g.add(frame); m.position.z = 0.016; g.add(m);
    g.position.set(naked ? 0.52 : 0.45, naked ? 1.06 : 1.035, 0); g.scale.setScalar(0.8); g.rotation.set(0, -Math.PI / 2, 0); g.rotateX(-0.55);
    v.susG.add(g); v.dash = g; v.dashCtx = c.getContext('2d'); v.dashTex = tx; v.dashT = 0;
  }
  function drawDash(v, p, dt) {
    if (!v.dash) return; v.dashT -= dt; if (v.dashT > 0) return; v.dashT = 1 / 20;
    const g = v.dashCtx, W = 256, H = 128, n = clamp((p.rpm - p.spec.idle) / (p.spec.redline - p.spec.idle), 0, 1);
    g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 20; k++) { const on = k / 20 < n; g.fillStyle = on ? (k > 16 ? '#ff3b30' : k > 12 ? '#ffb000' : '#4cd964') : '#1a1d22'; g.fillRect(10 + k * 11.8, 10, 9, 18); }
    if (n > 0.93 && (G.time * 12 | 0) % 2) { g.fillStyle = '#3aa0ff'; g.fillRect(10, 10, 236, 18); }
    g.fillStyle = '#f2f4f6'; g.font = '700 64px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(String(Math.round(p.speed * 3.6)), 12, 104);
    g.font = '600 14px "Helvetica Neue", Arial, sans-serif'; g.fillStyle = '#8a929c'; g.fillText('KM/H', 14, 122); g.fillText('GEAR', 196, 122);
    g.font = '700 70px "Helvetica Neue", Arial, sans-serif'; g.fillStyle = '#ffffff'; g.textAlign = 'right'; g.fillText(p.speed < 0.5 && p.throttle < 0.05 ? 'N' : String(p.gear + 1), 244, 106);
    if (p.spin > 0.2 || p.rearLock > 0.2) { g.fillStyle = '#ffb000'; g.font = '700 14px Arial'; g.textAlign = 'left'; g.fillText('TC', 130, 122); }
    v.dashTex.needsUpdate = true;
  }
  function povCamera(p, dt) {
    const v = G.vis[0], rig = v.rider; v.root.updateMatrixWorld(true);
    // arcade cockpit cam: the eye is a fixed point over the bike's centre line, not the rider's head - hanging off,
    // tucking, head shake and slides don't move it, so the bike stays near the bottom centre of the screen. The horizon
    // tilts a bit over half as far as the bike; heading, pitch and roll are all eased so nothing snaps.
    const nk = rig.naked;
    if (!G.povB || G.povReset) {
      const hp = rig.helmet.position; G.povB = { x: Math.min(hp.x - 0.1, nk ? 0.0 : 0.1), y: hp.y + (nk ? -0.05 : 0.03) };
      G.povYaw = p.yaw; G.povRoll = 0; G.povPitch = 0; G.povSlope = Math.atan(p.slope || 0); G.povLook = 0; G.povReset = false;
    }
    const py = p.y || 0;
    // heading: between where the bike points and where it is going, eased - a slide swings the bike, not the view
    const yT = p.yaw - (p.slipAngle || 0) * 0.4;
    if (Math.abs(AX.wrapAngle(yT - G.povYaw)) > 1.2) G.povYaw = yT;     // respawned or spun: no long swing round
    G.povYaw += AX.wrapAngle(yT - G.povYaw) * (1 - Math.exp(-8 * dt));
    G.povRoll = damp(G.povRoll, p.lean * 0.6, 4, dt);            // the horizon tilts a bit over half as far as the bike, eased
    G.povPitch = damp(G.povPitch, Math.max(-0.2, p.pitch) * 0.3, 3, dt);
    G.povSlope = damp(G.povSlope, Math.atan(p.slope || 0), 2, dt);
    G.povLook = damp(G.povLook, clamp(p.lean * 0.15, -0.2, 0.2), 1.5, dt);
    _hp.set(G.povB.x, G.povB.y, 0); v.susG.localToWorld(_hp);        // the eye rides on the bike's centre line
    _e.set(0, -G.povYaw, G.povSlope + G.povPitch - (nk ? 0.31 : 0.18), 'YZX'); _q.setFromEuler(_e);
    _q2.setFromAxisAngle(V3Y, -Math.PI / 2 - G.povLook); _q.multiply(_q2);
    _q2.setFromAxisAngle(V3Z, -G.povRoll); _q.multiply(_q2);
    if (p.surf === AX.SURF.KERB) _hp.y += Math.sin(G.time * 53) * 0.001;      // just a whisper of the kerbs
    drawDash(v, p, dt);
    camera.position.copy(_hp); camera.quaternion.copy(_q);
    const fov = 74 + clamp(p.speed / 68, 0, 1) * 6; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 2, dt); camera.updateProjectionMatrix(); }
    G.camLook.set(p.x, py, p.z); G.camPos.copy(camera.position); post.tilt = 0;
  }
  const V3Y = new THREE.Vector3(0, 1, 0), V3Z = new THREE.Vector3(0, 0, 1), _hd = new THREE.Vector3();
  function updateCamera(dt) {
    if (!G.player) return; const p = G.rs[0] || G.player;
    const sf = clamp(p.speed / 68, 0, 1), fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
    const mode = G.state === 'menu' ? 'menu' : S.cam; let fov = 27; const py = p.y || 0, t = G.track;
    setPov(mode === 'pov' && !p.crashed);
    if (mode === 'menu') {
      G.menuAng += dt * 0.16; const a = G.menuAng + p.yaw + 2.4, R = 8.2;
      _look.set(p.x + fx * 0.3, py + 0.85, p.z + fz * 0.3); _pos.set(p.x + Math.cos(a) * R, py + 2.3 + Math.sin(G.menuAng * 0.7) * 0.5, p.z + Math.sin(a) * R); fov = 30;
    } else if (mode === 'pov' && !p.crashed) {
      return povCamera(p, dt);
    } else if (mode === 'chase' || mode === 'pov') {
      G.camYaw += AX.wrapAngle(Math.atan2(p.vz, p.vx) * (p.speed > 4 ? 1 : 0) + (p.speed > 4 ? 0 : p.yaw) - G.camYaw) * (1 - Math.exp(-4.2 * dt));
      const cx = Math.cos(G.camYaw), cz = Math.sin(G.camYaw), d = (6.2 + sf * 1.4) * G.zoom;
      const ia = t.wr(p.idx + Math.round((9 + p.speed * 0.5) / t.ds)), ya = t.heightAt(ia, 0);
      _pos.set(p.x - cx * d, py + (2.15 + sf * 0.35) * G.zoom, p.z - cz * d);
      const ground = G.world.heightAt ? G.world.heightAt(_pos.x, _pos.z) : 0; if (_pos.y < ground + 1.4) _pos.y = ground + 1.4;
      _look.set(p.x + cx * 9, lerp(py, ya, 0.5) + 1.05, p.z + cz * 9); fov = 60 + sf * 12;
    } else {
      const lead = Math.min(0.42 + sf * 0.2, 14 / Math.max(1, p.speed)); const tx = p.x + p.vx * lead, tz = p.z + p.vz * lead;
      const h = lerp(54, 74, smoothstep(0, 1, sf)) * G.zoom;
      if (mode === 'follow') {
        G.camYaw += AX.wrapAngle((p.speed > 3 ? Math.atan2(p.vz, p.vx) : p.yaw) - G.camYaw) * (1 - Math.exp(-2.6 * dt));
        const cx = Math.cos(G.camYaw), cz = Math.sin(G.camYaw); _look.set(tx + cx * h * 0.16, py, tz + cz * h * 0.16); _pos.set(_look.x - cx * h * 0.6, py + h, _look.z - cz * h * 0.6);
      } else { _look.set(tx, py, tz - h * 0.03); _pos.set(_look.x, py + h, _look.z + h * 0.62); G.camYaw = p.yaw; }
    }
    const k = G.camInit ? 1 - Math.exp(-(mode === 'chase' || mode === 'pov' ? 14 : mode === 'menu' ? 3 : 6.5) * dt) : 1; G.camInit = true;
    G.camLook.lerp(_look, k); G.camPos.lerp(_pos, k);
    camera.position.copy(G.camPos);
    if (G.shake > 0.01) { camera.position.x += (Math.random() - 0.5) * G.shake * 0.9; camera.position.y += (Math.random() - 0.5) * G.shake * 0.5; camera.position.z += (Math.random() - 0.5) * G.shake * 0.9; G.shake *= Math.exp(-7 * dt); }
    camera.up.set(0, 1, 0); camera.lookAt(G.camLook);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 6, dt); camera.updateProjectionMatrix(); }
    post.tilt = mode === 'chase' ? (AX.LOOK ? 0.5 : 0) : mode === 'pov' ? 0 : mode === 'menu' ? 0.7 : 1; post.focusY = mode === 'menu' ? 0.45 : 0.5;
  }

  /* ------------------------------------------------------------------ HUD */
  const hud = { pos: $('hPos'), posOf: $('hPosOf'), posBox: $('hPosBox'), rem: $('hRem'), time: $('hTime'), delta: $('hDelta'), best: $('hBest'), gear: $('hGear'), speed: $('hSpeed'), rev: $('hRev'), thr: $('hThr'), brk: $('hBrk'), tower: $('tower'), body: $('hBodyDot'), bodyBox: $('hBody') };
  let toastTimer = 0;
  function toast(text, cls) { const e = $('toast'); e.textContent = text; e.className = 'show ' + (cls || ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { e.className = ''; }, 2300); }
  function banner(text, cls, sec) { const e = $('banner'); e.textContent = text; e.className = cls || ''; G.bannerT = sec || 1.4; }
  function setLights(n) { const l = $('lights'); l.classList.remove('hidden'); l.classList.toggle('go', n < 0); const el = l.children; for (let k = 0; k < 5; k++) el[k].classList.toggle('on', k < n); }
  // split times: the climb is cut into four sectors; at each line the time so far and the gap to the best run show up
  function updateSplits(p, started) {
    const t = G.track; if (!t.open || !started || p.finished || G.s0 == null) return;
    const f = (p.sPrev - G.s0) / Math.max(1, t.finishS - G.s0), sec = Math.floor(f * 4);
    if (sec > (G.secDone || 0) && sec < 4) {
      G.secDone = sec; let d = '';
      if (G.best && G.best.sp) { const ref = G.best.sp[Math.floor(p.trackPos / 10)]; if (ref != null) { const x = p.lapTime - ref; d = '<div class="d ' + (x >= 0 ? 'up' : 'down') + '">' + (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2) + '</div>'; } }
      const el = $('split'); el.innerHTML = '<div class="k">' + T.sector + ' ' + sec + '</div><div class="t">' + AX.formatTime(p.lapTime) + '</div>' + d; el.classList.add('show');
      clearTimeout(G.splitTimer); G.splitTimer = setTimeout(() => el.classList.remove('show'), 3200);
    }
  }
  function updateHUD(dt) {
    const p = G.player; if (!p) return; const race = S.mode === 'race';
    { const sb = $('steerBar').firstChild; const s = clamp(p.steer || 0, -1, 1); if (Math.abs(s - (G.sbS || 0)) > 0.004) { G.sbS = s; sb.style.transform = 'translateX(' + (s * 104).toFixed(1) + 'px)'; } }
    hud.speed.textContent = Math.round(p.speed * 3.6); hud.gear.textContent = p.crashed ? '–' : p.gear + 1;
    const rn = clamp(p.rpm / p.spec.redline, 0, 1); hud.rev.style.width = (rn * 100).toFixed(1) + '%'; hud.rev.classList.toggle('lim', rn > 0.955);
    hud.body.style.transform = 'translate(' + (p.hang * 14).toFixed(1) + 'px,' + (-p.fb * 14).toFixed(1) + 'px)'; hud.bodyBox.classList.toggle('good', p.hangIn > 0.4); hud.thr.style.setProperty('--v', (p.throttle * 100).toFixed(0) + '%'); hud.brk.style.setProperty('--v', (p.brake * 100).toFixed(0) + '%');
    const started = p.lap >= 0 && G.state !== 'countdown';
    hud.time.textContent = AX.formatTime(started ? (race ? p.lapTime : p.lapTime) : 0);
    hud.best.textContent = (race ? p.bestLap : (G.best && G.best.t)) ? AX.formatTime(race ? p.bestLap : G.best.t) : '–';
    updateSplits(p, started);
    // live delta against the stored best lap
    let dl = '';
    if (started && G.best && G.best.sp && !p.finished) { const k = Math.floor(p.trackPos / 10), ref = G.best.sp[k]; if (ref != null && p.lapTime > 1) { const d = p.lapTime - ref; dl = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2); hud.delta.className = 'delta ' + (d >= 0 ? 'up' : 'down'); } }
    hud.delta.textContent = dl;
    G.towerT -= dt;
    if (G.towerT <= 0) {
      G.towerT = 0.25; const ord = standings();
      const t = G.track;
      if (t.open) { const rem = Math.max(0, t.finishS - p.sPrev); hud.rem.innerHTML = T.toSummit + '<b>' + (rem >= 1000 ? (rem / 1000).toFixed(2) + ' km' : Math.round(rem) + ' m') + '</b>'; }
      else hud.rem.innerHTML = T.lap + '<b>' + clamp(p.lap + 1, 1, S.laps) + ' / ' + S.laps + '</b>';
      hud.posBox.classList.toggle('hidden', !race);
      if (race) {
        const me = ord.indexOf(0); hud.pos.textContent = me + 1; hud.posOf.textContent = '/' + G.bikes.length;
        const lead = G.bikes[ord[0]]; let html = '';
        for (let r = 0; r < ord.length; r++) {
          const b = G.bikes[ord[r]]; let gap = '';
          if (r > 0) { const dp = lead.prog - b.prog; gap = b.finished && lead.finished ? '+' + (b.finishTime - lead.finishTime).toFixed(1) : dp > G.track.length ? '+' + Math.floor(dp / G.track.length) + ' L' : '+' + (dp / Math.max(18, b.speed, lead.speed * 0.7)).toFixed(1); }
          html += '<div class="r' + (ord[r] === 0 ? ' me' : '') + (b.crashed ? ' out' : '') + '"><span class="p">' + (r + 1) + '</span><span class="c" style="background:' + b.rider.c1 + '"></span><span class="n">' + b.rider.name + '</span><span class="g">' + gap + '</span></div>';
        }
        hud.tower.innerHTML = html;
      } else hud.tower.innerHTML = '';
    }
    if (G.bannerT > 0) { G.bannerT -= dt; if (G.bannerT <= 0) $('banner').classList.add('hidden'); }
    if (G.hintT > 0) { G.hintT -= dt; if (G.hintT <= 0) $('hint').style.opacity = 0; }
    drawMinimap();
  }

  /* ------------------------------------------------------------------ minimap */
  let mapBase = null, mapT = null;
  function trackPath(ctx, t, size, pad, lw, color) {
    const b = t.bounds, sc = Math.min((size - pad * 2) / (b.maxX - b.minX), (size - pad * 2) / (b.maxZ - b.minZ));
    const ox = (size - (b.maxX - b.minX) * sc) / 2 - b.minX * sc, oz = (size - (b.maxZ - b.minZ) * sc) / 2 - b.minZ * sc;
    ctx.beginPath(); for (let i = 0; i < t.n; i += 3) { const x = t.px[i] * sc + ox, y = t.pz[i] * sc + oz; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } if (!t.open) ctx.closePath();
    ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); return { sc, ox, oz };
  }
  function buildMinimap() {
    mapBase = document.createElement('canvas'); mapBase.width = mapBase.height = 220; const c = mapBase.getContext('2d');
    trackPath(c, G.track, 220, 22, 8, 'rgba(0,0,0,0.28)'); mapT = trackPath(c, G.track, 220, 22, 2.5, 'rgba(243,239,230,0.9)');
    const t = G.track; for (const [i, col] of t.open ? [[t.startIdx, '#8fd6a2'], [t.finishIdx, '#e9a23b']] : [[0, '#e9a23b']]) { c.fillStyle = col; c.save(); c.translate(t.px[i] * mapT.sc + mapT.ox, t.pz[i] * mapT.sc + mapT.oz); c.rotate(t.yaw[i]); c.fillRect(-1.5, -7, 3, 14); c.restore(); }
  }
  function drawMinimap() {
    const cv = $('minimap'), c = cv.getContext('2d'); c.clearRect(0, 0, 220, 220); c.drawImage(mapBase, 0, 0);
    for (let i = G.bikes.length - 1; i >= 0; i--) {
      const b = G.bikes[i], x = b.x * mapT.sc + mapT.ox, y = b.z * mapT.sc + mapT.oz;
      c.beginPath(); c.arc(x, y, i === 0 ? 5.5 : 3.6, 0, 7); c.fillStyle = i === 0 ? '#e9a23b' : b.rider.c1; c.fill(); c.lineWidth = 1.5; c.strokeStyle = 'rgba(0,0,0,0.45)'; c.stroke();
    }
  }

  /* ------------------------------------------------------------------ state changes */
  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  function loading(on, then) { $('loadText').textContent = T.loading; show('loading', on); if (then) requestAnimationFrame(() => setTimeout(then, 30)); }
  function startFromMenu() { sound.init(); sound.click(); loading(true, () => { beginSession(); loading(false); }); }
  function beginSession() {
    setupSession(); show('menu', false); show('results', false); show('pause', false); show('hud', true); document.body.classList.add('playing'); $('banner').classList.add('hidden');
    $('hint').innerHTML = keyList(T.hint); $('hint').style.opacity = 1; G.hintT = 9; G.camInit = false; G.zoom = 1; G.towerT = 0; sound.setDuck(1);
    if (S.mode === 'race' || G.track.open) { G.state = 'countdown'; G.lightsT = 0; G.lightsN = 0; G.goT = 5.6 + 0.5 + Math.random() * 1.3; G.revRpm = G.player.spec.idle; G.world.setStartLights(0); setLights(0); }
    else { G.state = 'race'; show('lights', false); G.world.setStartLights(0); G.player.vx = Math.cos(G.player.yaw) * 8; G.player.vz = Math.sin(G.player.yaw) * 8; }
    G.splits = []; G.rec = []; G.s0 = G.player.sPrev; G.secDone = 0; G.prevBestT = G.best && G.best.t; G.lastFinish = 0; $('split').classList.remove('show');
  }
  function restart() { sound.click(); beginSession(); }
  function kicker() { return (S.mode === 'race' ? T.modeRace : T.modeTT) + ' · ' + (G.track ? G.track.name : '') + ' · ' + AX.BIKES[S.bike].name; }
  function togglePause() {
    if (G.state === 'race' || G.state === 'countdown') {
      G.prevState = G.state; G.state = 'paused'; show('pause', true); sound.setDuck(0.15); $('pauseSub').textContent = kicker();
      LISTS.p.items = [{ label: T.resume, run: togglePause }, { label: T.restart, run: restart }, { label: T.toMenu, run: toMenu }]; LISTS.p.sel = 0; renderList(LISTS.p);
    } else if (G.state === 'paused') { G.state = G.prevState; show('pause', false); sound.setDuck(1); last = performance.now(); }
  }
  function toMenu() {
    G.state = 'menu'; show('pause', false); show('results', false); show('hud', false); show('menu', true); document.body.classList.remove('playing');
    sound.setDuck(0.5); MS.scr = 'main'; LISTS.m.sel = S.mode === 'race' ? 1 : 0; menuPreview(); renderMenu();
  }
  function menuPreview() {
    buildWorld(S.track); clearBikes(); G.skid.clear(); G.smoke.clear(); G.sparks.clear();
    const p = addBike(AX.BIKES[S.bike], AX.RIDERS[0], { isPlayer: true }); p.placeOnGrid(0); G.player = p; G.ai.push(null); G.order = [0]; G.camInit = false;
    AX.Models.syncBike(G.vis[0], p, 0.016, 0); G.world.setStartLights(0);
  }

  // medal times per bike, set from what a quick, clean AI run manages on the pass
  const PAR = { corsa: 73.0, strada: 73.3, duetto: 76.5 };
  function medalTimes(bike) { const p = PAR[bike] || 75; return [['g', T.gold, p + 1.5], ['s', T.silver, p + 6], ['b', T.bronze, p + 14]]; }

  function showResults() {
    const race = S.mode === 'race'; const ord = standings(); const me = ord.indexOf(0);
    $('resSub').textContent = kicker();
    const dl = $('resDelta'); dl.className = 'res-delta'; dl.textContent = ''; $('resMedals').innerHTML = ''; $('resTable').innerHTML = '';
    if (!race) {
      const tf = G.lastFinish, prev = G.prevBestT;
      $('resTitle').textContent = tf ? AX.formatTime(tf) : '–';
      if (tf) {
        if (!prev) { dl.textContent = T.firstRun; dl.classList.add('new'); }
        else if (tf < prev) { dl.textContent = T.newBest + '  −' + (prev - tf).toFixed(3); dl.classList.add('new'); }
        else { dl.textContent = '+' + (tf - prev).toFixed(3) + '  ' + T.toBest; dl.classList.add('up'); }
        $('resMedals').innerHTML = medalTimes(S.bike).map(([c, n, mt]) => '<div class="medal ' + c + (tf <= mt ? ' got' : '') + '"><div class="disc"></div><div class="n">' + n + '</div><div class="t">' + AX.formatTime(mt) + '</div></div>').join('');
      }
    } else {
      $('resTitle').textContent = (me + 1) + '. ' + T.place;
      const lead = G.bikes[ord[0]]; let html = '';
      ord.forEach((bi, r) => {
        const b = G.bikes[bi]; let tm;
        if (r === 0) tm = b.finished ? AX.formatTime(b.finishTime) : '–'; else if (b.finished && lead.finished) tm = '+' + (b.finishTime - lead.finishTime).toFixed(3); else { const dp = lead.prog - b.prog; tm = '+' + (dp / Math.max(20, b.speed)).toFixed(1); }
        html += '<tr class="' + (bi === 0 ? 'me' : '') + '"><td>' + (r + 1) + '</td><td><span class="chip" style="background:' + b.rider.c1 + '"></span>' + b.rider.name + '</td><td class="t">' + tm + '</td></tr>';
      });
      $('resTable').innerHTML = html;
    }
    LISTS.r.items = [{ label: T.again, run: restart }, { label: T.toMenu, run: toMenu }]; LISTS.r.sel = 0; renderList(LISTS.r);
    G.state = 'results'; show('results', true); show('lights', false); show('hud', false); sound.setDuck(0.45);
  }

  /* ------------------------------------------------------------------ menu UI: screens are short lists, driven by keys or mouse */
  const MS = { scr: 'main' };
  const LISTS = { m: { el: 'mList', items: [], sel: 0 }, p: { el: 'pList', items: [], sel: 0 }, r: { el: 'rList', items: [], sel: 0 } };
  const keyList = (arr) => arr.map(([k, l]) => '<span>' + k.split(' ').map((x) => '<kbd>' + x + '</kbd>').join('') + ' ' + l + '</span>').join('');
  function activeList() { return G.state === 'menu' ? LISTS.m : G.state === 'paused' ? LISTS.p : LISTS.r; }
  function curOpt(it) { return it.opts.find((o) => String(o[0]) === String(S[it.k])) || it.opts[0]; }
  function renderList(L) {
    const el = $(L.el); el.innerHTML = '';
    L.items.forEach((it, i) => {
      const b = document.createElement('div'); b.className = 'm-item' + (it.cls ? ' ' + it.cls : '') + (it.opts ? ' opt' : '') + (i === L.sel ? ' sel' : '');
      if (it.opts) b.innerHTML = '<span class="lab">' + it.label + '</span><span class="val"><i data-d="-1">‹</i><span>' + curOpt(it)[1] + '</span><i data-d="1">›</i></span>';
      else b.innerHTML = '<span class="lab">' + it.label + '</span>' + (it.sub ? '<span class="sub">' + it.sub + '</span>' : '');
      b.onmouseenter = () => { if (L.sel !== i) { L.sel = i; markSel(L); } };
      b.onclick = (e) => { sound.init(); L.sel = i; const d = e.target.dataset && e.target.dataset.d; if (it.opts) changeOpt(it, d ? +d : 1); else activate(it); };
      el.appendChild(b);
    });
    if (L === LISTS.m) updateNote();
  }
  function markSel(L) { Array.from($(L.el).children).forEach((c, i) => c.classList.toggle('sel', i === L.sel)); if (L === LISTS.m) updateNote(); }
  function updateNote() { const it = LISTS.m.items[LISTS.m.sel]; const n = it && it.note; $('mNote').textContent = typeof n === 'function' ? n() : (n || ''); }
  function changeOpt(it, d) {
    const i = it.opts.indexOf(curOpt(it)), o = it.opts[(i + d + it.opts.length) % it.opts.length];
    S[it.k] = o[0]; save(); sound.click(); if (it.after) it.after(); renderMenu();
  }
  function activate(it) { sound.click(); it.run(); }
  function navKey(code) {
    const L = activeList(), n = L.items.length; if (!n) return false;
    const horiz = L === LISTS.r, it = L.items[L.sel];
    const up = code === 'ArrowUp' || code === 'KeyW' || (horiz && (code === 'ArrowLeft' || code === 'KeyA'));
    const down = code === 'ArrowDown' || code === 'KeyS' || (horiz && (code === 'ArrowRight' || code === 'KeyD'));
    if (up || down) { L.sel = (L.sel + (up ? -1 : 1) + n) % n; markSel(L); sound.click(); return true; }
    if (!horiz && it.opts && (code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowRight' || code === 'KeyD')) { changeOpt(it, code === 'ArrowLeft' || code === 'KeyA' ? -1 : 1); return true; }
    if (code === 'Enter' || code === 'Space') { if (it.opts) changeOpt(it, 1); else activate(it); return true; }
    if (code === 'Escape' || code === 'Backspace') {
      if (G.state === 'menu') { if (MS.scr !== 'main') { sound.click(); goScr('main'); return true; } return false; }
      if (G.state === 'paused') { togglePause(); return true; }
      if (G.state === 'results') { toMenu(); return true; }
    }
    return false;
  }
  function goScr(s) {
    const from = MS.scr; MS.scr = s;
    LISTS.m.sel = s === 'main' ? Math.max(0, ['setup', '', 'settings', 'controls'].indexOf(from === 'setup' ? (S.mode === 'race' ? '' : 'setup') : from)) : 0;
    if (s === 'main' && from === 'setup' && S.mode === 'race') LISTS.m.sel = 1;
    renderMenu();
  }
  function menuItems() {
    const back = { label: T.back, cls: 'small', run: () => goScr('main') };
    if (MS.scr === 'main') return [
      { label: T.modeTT, sub: T.subTT, note: T.noteTT, run: () => { S.mode = 'tt'; save(); goScr('setup'); } },
      { label: T.modeRace, sub: T.subRace, note: T.noteRace, run: () => { S.mode = 'race'; save(); goScr('setup'); } },
      { label: T.settings, cls: 'small', note: T.noteSettings, run: () => goScr('settings') },
      { label: T.controls, cls: 'small', note: T.noteControls, run: () => goScr('controls') }];
    if (MS.scr === 'setup') {
      const it = [
        { k: 'bike', label: T.chooseBike, opts: AX.BIKE_ORDER.map((id) => [id, AX.BIKES[id].name]), note: () => AX.BIKES[S.bike].blurb[S.lang], after: menuPreview },
        { k: 'assist', label: T.assists, opts: [['easy', T.a0], ['sport', T.a1], ['pro', T.a2]], note: () => T[{ easy: 'noteEasy', sport: 'noteSport', pro: 'notePro' }[S.assist]] },
        { k: 'cam', label: T.camera, opts: [['chase', T.c0], ['pov', T.c1], ['tv', T.c2]], note: () => T.camNote[S.cam] }];
      if (S.mode === 'race') it.push({ k: 'opp', label: T.opponents, opts: [[3, '3'], [5, '5'], [7, '7'], [9, '9']], note: T.oppNote }, { k: 'diff', label: T.difficulty, opts: [[0, T.d0], [1, T.d1], [2, T.d2], [3, T.d3]], note: T.diffNote });
      it.push({ label: T.start, cls: 'act-go', note: T.noteStart, run: startFromMenu }, back);
      return it;
    }
    if (MS.scr === 'settings') return [
      { k: 'quality', label: T.quality, opts: [['low', T.q0], ['medium', T.q1], ['high', T.q2]], note: () => T.qNote[S.quality], after: () => loading(true, () => { resize(); menuPreview(); loading(false); }) },
      { k: 'look', label: T.lookL, opts: [['on', T.lookOn], ['off', T.lookOff]], note: () => (S.look === 'on' ? T.lookNoteOn : T.lookNoteOff), after: () => loading(true, () => { menuPreview(); loading(false); }) },
      { k: 'kbAssist', label: T.kbAssist, opts: [['on', T.on], ['off', T.off]], note: () => (S.kbAssist === 'on' ? T.noteKbA : T.noteKbOff) },
      { k: 'vol', label: T.volume, opts: Array.from({ length: 11 }, (_, i) => [i / 10, i * 10 + ' %']), note: T.volNote, after: () => { sound.init(); sound.setVolume(S.vol); } },
      { k: 'lang', label: S.lang === 'de' ? 'SPRACHE' : 'LANGUAGE', opts: [['de', 'DEUTSCH'], ['en', 'ENGLISH']], note: T.langNote },
      back];
    return [back];
  }
  function applyLang() {
    T = STR[S.lang] || STR.de; document.documentElement.lang = S.lang;
    document.querySelectorAll('[data-i18n]').forEach((e) => { const k = e.dataset.i18n; if (typeof T[k] === 'string') e.textContent = T[k]; });
  }
  function renderMenu() {
    applyLang(); const L = LISTS.m;
    L.items = menuItems(); L.sel = clamp(L.sel, 0, L.items.length - 1);
    $('mHead').textContent = { main: T.mainHead, setup: S.mode === 'race' ? T.modeRace : T.modeTT, settings: T.settings, controls: T.controls }[MS.scr];
    renderList(L); $('mKeys').innerHTML = keyList(T.nav); renderSide();
  }
  function renderSide() {
    const scr = MS.scr, bi = $('bikeInfo'), ti = $('trackInfo'), ctl = $('mControls');
    show('mSide', scr === 'main' || scr === 'setup'); show('mControls', scr === 'controls');
    if (scr === 'controls') {
      const grp = (h, rows) => '<div class="grp"><h4>' + h + '</h4><div class="rows">' + rows.map(([k, d]) => '<div class="r"><span class="ks">' + k.split(' ').map((x) => '<kbd>' + x + '</kbd>').join('') + '</span><span class="d">' + d + '</span></div>').join('') + '</div></div>';
      ctl.innerHTML = grp(T.ctlRide, T.ctl) + grp(T.ctlBody, T.ctlB).replace('class="grp"', 'class="grp one"') + grp(T.ctlMore, T.ctlM) + '<div class="grp"><div class="rows"><div class="tip">' + T.ctlTip + '</div></div></div>';
      return;
    }
    if (scr === 'setup') {
      const s = AX.BIKES[S.bike], st = s.stats;
      bi.innerHTML = '<div class="k">' + T.chooseBike + '</div><h3>' + s.name + '</h3><p>' + s.cls + ' · ' + s.engineLabel + ' · ' + s.power + ' kW</p><div class="stats">' +
        [['speed', st.speed], ['accel', st.accel], ['agility', st.agility], ['brake', st.brake]].map((q) => '<span>' + T[q[0]] + '</span><b style="--v:' + Math.round(q[1] * 100) + '%"></b>').join('') + '</div>';
    } else bi.innerHTML = '';
    const d = AX.TRACKS[S.track], tr = thumbTrack(S.track), rec = loadRec(S.track, S.bike), rt = rec && rec.t;
    const climb = tr.open ? Math.round(tr.py[tr.finishIdx] - tr.py[tr.startIdx]) : 0, len = tr.open ? (tr.finishS - (tr.startS || 0)) : tr.length;
    ti.innerHTML = '<div class="k">' + T.chooseTrack + '</div><h3>' + d.name + '</h3><p>' + d.sub[S.lang] + '</p>' +
      '<div class="tmap"><canvas width="192" height="192"></canvas><div class="facts"><span>' + T.length + '</span><b>' + (len / 1000).toFixed(1) + ' km</b><span>' + T.hairpins + '</span><b>10</b><span>' + T.climb + '</span><b>+' + climb + ' m</b></div></div>' +
      '<div class="rec"><span class="k">' + T.yourBest + '</span><span class="t">' + (rt ? AX.formatTime(rt) : '–') + '</span></div>' +
      '<div class="medal-row">' + medalTimes(S.bike).map(([c, , mt]) => '<span class="' + c + (rt && rt <= mt ? ' got' : '') + '">' + AX.formatTime(mt) + '</span>').join('') + '</div>';
    const c = ti.querySelector('canvas').getContext('2d'); trackPath(c, tr, 192, 14, 7, 'rgba(0,0,0,0.25)'); trackPath(c, tr, 192, 14, 2.5, 'rgba(243,239,230,0.92)');
  }
  const thumbs = {}; function thumbTrack(id) { return thumbs[id] || (thumbs[id] = (G.track && G.track.id === id) ? G.track : new AX.Track(id)); }
  function initUI() { S.vol = Math.round(S.vol * 10) / 10; }

  /* ------------------------------------------------------------------ main loop */
  let last = performance.now();
  function frame(now) {
    if (!G._manual) requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000, dt = Math.min(0.05, rawDt); last = now; if (!G.world) return;
    measure(rawDt);
    readInput();
    const running = G.state === 'race' || G.state === 'countdown' || G.state === 'finished' || G.state === 'results';
    if (running) { G.acc += dt; let n = 0; while (G.acc >= H && n++ < 8) { stepSim(); G.acc -= H; } if (n >= 8) G.acc = 0; } else G.time += G.state === 'menu' ? dt : 0;
    const p = G.player;
    // draw every bike between its last two physics states, so motion is smooth at any refresh rate
    const a = running ? clamp(G.acc / H, 0, 1) : 1;
    for (let i = 0; i < G.bikes.length; i++) {
      const b = G.bikes[i], r = G.rs[i] || (G.rs[i] = {}); Object.assign(r, b);
      if (b._px !== undefined && !b.crashed && Math.hypot(b.x - b._px, b.z - b._pz) < 3) {
        r.x = lerp(b._px, b.x, a); r.z = lerp(b._pz, b.z, a); r.yaw = b._pyaw + AX.wrapAngle(b.yaw - b._pyaw) * a;
        r.lean = lerp(b._plean, b.lean, a); r.pitch = lerp(b._ppitch, b.pitch, a); r.y = lerp(b._py || 0, b.y || 0, a);
      }
      AX.Models.syncBike(G.vis[i], r, dt, G.time);
      // knee sliders and elbows that touch the asphalt draw a hair-thin line
      const rig = G.vis[i].rider, near = b === p || distToPlayer(b) < 70;
      for (let s = 0; s < 2; s++) {
        const kd = near && !b.crashed && rig.kneeDown[s], ed = near && !b.crashed && rig.elbowDown[s];
        if (kd) { rig.parts.legs[s].kn.getWorldPosition(_kv); G.skid.mark(5000 + i * 4 + s, _kv.x, _kv.z, 0.022, 0.5, (b.y || 0) + 0.033); } else G.skid.mark(5000 + i * 4 + s, 0, 0, 0, 0);
        if (ed) { rig.parts.arms[s].el.getWorldPosition(_kv); G.skid.mark(5002 + i * 4 + s, _kv.x, _kv.z, 0.02, 0.45, (b.y || 0) + 0.033); } else G.skid.mark(5002 + i * 4 + s, 0, 0, 0, 0);
        const fd = near && !b.crashed && rig.footDown[s];
        if (fd) { rig.parts.legs[s].foot.getWorldPosition(_kv); G.skid.mark(6000 + i * 2 + s, _kv.x, _kv.z, 0.03, 0.5, (b.y || 0) + 0.033); } else G.skid.mark(6000 + i * 2 + s, 0, 0, 0, 0);
        if (b === p) { G.kneeOn = (G.kneeOn || 0) * 0.9 + (kd ? 0.1 : 0) + (ed ? 0.1 : 0) + (fd ? 0.08 : 0); }
      }
    }
    // ghost playback
    if (G.ghostVis) {
      const g = G.ghost && G.ghost.g; const vis = G.ghostVis; let on = false;
      if (g && p.lap >= 0 && G.state !== 'menu') { const f = p.lapTime * 30, i0 = Math.floor(f); const S6 = G.ghost.v === 6 ? 6 : 5; if (i0 * S6 + 2 * S6 - 1 < g.length) { const a = i0 * S6, k = f - i0; on = true; GH.x = lerp(g[a], g[a + S6], k); GH.z = lerp(g[a + 1], g[a + S6 + 1], k); GH.yaw = g[a + 2] + AX.wrapAngle(g[a + S6 + 2] - g[a + 2]) * k; GH.lean = lerp(g[a + 3], g[a + S6 + 3], k); GH.pitch = lerp(g[a + 4], g[a + S6 + 4], k); GH.y = S6 === 6 ? lerp(g[a + 5], g[a + 11], k) : 0; GH.slope = 0; AX.Models.syncBike(vis, GH, dt, G.time); } }
      vis.root.visible = on && Math.hypot(GH.x - p.x, GH.z - p.z) > 2.5; vis.rider.group.visible = vis.root.visible;
    }
    if (G.state !== 'paused') {
      const sc = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
      G.smoke.update(dt, sc); G.sparks.update(dt, sc);
    }
    G.skid.flush(); updateCamera(dt); G.world.update(G.camLook, G.time); if (G.world.look) AX.Look.update(G.world, camera.position);
    if (G.state !== 'menu') updateHUD(dt);
    updateAudio(dt);
    G.world.scene.updateMatrixWorld(); AX.RiderBatch.flush(G.world.scene);
    if (!G._noRender) post.render(G.world.scene, camera);
  }
  /* frame-rate meter + dynamic resolution */
  function measure(rawDt) {
    if (rawDt > 0.25) return;           // tab switch / loading hitch
    G.fpsT += rawDt; G.fpsN++;
    if (G.fpsT < 1) return;
    G.fps = G.fpsN / G.fpsT; G.fpsT = 0; G.fpsN = 0;
    const racing = G.state === 'race' || G.state === 'countdown';
    if (racing && G.fps < 52) { G.slowT++; G.fastT = 0; } else if (G.fps > 58) { G.fastT++; G.slowT = 0; } else { G.slowT = 0; G.fastT = 0; }
    const now = performance.now();
    if (G.slowT >= 3 && G.dyn > 0.55) { G.dyn = Math.max(0.55, G.dyn - 0.12); G.slowT = 0; G.lastDown = now; G.downs++; resize(); }
    else if (G.fastT >= 10 && G.dyn < 1 && G.downs < 3 && now - G.lastDown > 45000) { G.dyn = Math.min(1, G.dyn + 0.06); G.fastT = 0; resize(); }
    const el = $('fps'); if (el && !el.classList.contains('hidden')) {
      el.textContent = Math.round(G.fps) + ' FPS · ' + Math.round(renderer.domElement.width) + '×' + Math.round(renderer.domElement.height) + (G.dyn < 1 ? ' (auto ' + Math.round(G.dyn * 100) + '%)' : '');
      el.className = G.fps < 45 ? 'bad' : G.fps < 57 ? 'mid' : '';
    }
  }
  const GH = { x: 0, z: 0, yaw: 0, lean: 0, pitch: 0, speed: 40, aLong: 0, spin: 0, slipAngle: 0, steer: 0, brake: 0, surf: 0, crashed: false, rd: {} };
  const others = [];
  function updateAudio(dt) {
    const p = G.player; if (!p || !sound.ready) return;
    if (G.state === 'menu' || G.state === 'paused') { sound.update(dt, { player: { rpm: p.spec.idle, thr: 0, spec: p.spec, vol: G.state === 'menu' ? 0.35 : 0 }, others: [], speed: 0 }); return; }
    others.length = 0; const rx = camera.matrixWorld.elements[0], rz = camera.matrixWorld.elements[2];
    for (let i = 1; i < G.bikes.length; i++) { const b = G.bikes[i], dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz); if (d < 90) others.push({ rpm: b.rpm, thr: b.crashed ? 0 : b.throttle, cut: b.limiter || b.shiftT > 0, spec: b.spec, dist: d, pan: clamp((dx * rx + dz * rz) / 30, -0.85, 0.85), doppler: 1 + clamp(((p.vx - b.vx) * dx + (p.vz - b.vz) * dz) / (d + 0.5) / 343, -0.12, 0.12) }); }
    others.sort((a, b) => a.dist - b.dist); others.length = Math.min(others.length, 3);
    const f = p.fx, t = G.track; const nearPit = p.idx > t.pitFrom || p.idx < t.pitTo ? 1 : 0.25;
    sound.update(dt, { player: { rpm: p.rpm, thr: p.crashed ? 0 : p.throttle, cut: p.limiter || (p.shiftT > 0 && p.shiftDir > 0), pop: G.pop || 0, spec: p.spec, vol: 0.8 }, others, speed: p.speed, vmax: p.spec.dragTop,
      squeal: p.crashed ? 0 : f.squeal, skid: p.crashed ? 0 : Math.max(f.rearSkid, f.frontSkid), kerb: p.crashed ? 0 : f.kerb, surf: p.surf, scrape: f.scrape ? clamp(p.speed / 15, 0.2, 1) : clamp((G.kneeOn || 0) * 0.35, 0, 0.35), crowd: t.open ? passCrowd(p) : nearPit, ...(t.open ? passEnv(p) : {}) });
    G.pop = 0;
  }

  /* pass ambience: crowd near the spectators, echo next to walls, birds in the forest, cowbells on the meadows */
  function passCrowd(p) {
    const W = G.world, pts = W && W.crowdPts; if (!pts || !pts.length) return 0; let best = 1e9;
    for (let k = 0; k < pts.length; k += 2) { const dx = pts[k] - p.x, dz = pts[k + 1] - p.z, d = dx * dx + dz * dz; if (d < best) best = d; }
    return AX.clamp(1 - Math.sqrt(best) / 45, 0, 1);
  }
  function passEnv(p) {
    const t = G.track, i = p.idx, lat = t.lateral(i, p.x, p.z); let wall = 0;
    for (const s of [0, 1]) if (t.barType[s][i] === 2) { const d = t.bar[s][i] - (s ? lat : -lat); wall = Math.max(wall, AX.clamp(1 - d / 6, 0, 1) * AX.clamp(t.wallH[s][i] / 2, 0.4, 1)); }
    const yMax = t.py[t.finishIdx] || 0, alt = AX.clamp((p.y - t.py[0]) / Math.max(1, yMax - t.py[0]), 0, 1);
    const water = t.stream ? AX.clamp(1 - (t.streamDist(p.x, p.z) - 4) / 55, 0, 1) : 0;
    return { wall, water, ambient: 1, forest: 0.7 * (1 - alt), meadow: 0.25 + 0.6 * alt };
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    initUI(); applyLang(); resize(); $('loadText').textContent = T.loading; show('loading', true);
    setTimeout(async () => {
      try { await AX.Assets.loadAll((f) => { $('loadText').textContent = T.loading + ' ' + Math.round(f * 100) + '%'; }); } catch (e) { console.warn('assets', e); }
      toMenu(); show('loading', false); requestAnimationFrame(frame);
    }, 40);
  }
  G._step = (n) => { for (let i = 0; i < n; i++) stepSim(); }; G._settings = S; G._ui = { showResults, togglePause, startFromMenu }; G._r = { renderer, post, camera, frame: (t) => frame(t), resetClock: () => { last = performance.now(); } };
  boot();
})();
