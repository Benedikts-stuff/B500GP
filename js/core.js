/* APEX — core: namespace, math helpers, bike + rider data.
   Classic script (works from file://). Also loadable in Node for headless tests. */
(function (root) {
  'use strict';
  const AX = root.AX = root.AX || {};

  AX.G = 9.81;
  AX.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  AX.lerp = (a, b, t) => a + (b - a) * t;
  AX.damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  AX.smoothstep = (a, b, x) => { const t = AX.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  AX.mod = (n, m) => ((n % m) + m) % m;
  AX.wrapAngle = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
  AX.approach = (cur, target, rateUp, rateDown, dt) => {
    if (cur < target) return Math.min(target, cur + rateUp * dt);
    return Math.max(target, cur - rateDown * dt);
  };

  AX.RNG = function (seed) {
    let s = (seed >>> 0) || 1;
    const f = function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (a, b) => a + (b - a) * f();
    f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.sign = () => (f() < 0.5 ? -1 : 1);
    return f;
  };

  AX.formatTime = (t) => {
    if (!isFinite(t) || t == null) return '–:––.–––';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  };
  AX.formatGap = (t) => (t >= 0 ? '+' : '−') + Math.abs(t).toFixed(Math.abs(t) >= 10 ? 1 : 3);

  /* ------------------------------------------------------------------ bikes
     mass incl. rider [kg], power [kW], redline [rpm]
     gears: speed [m/s] reached at redline in each gear
     cgB: CoM distance ahead of rear contact, cgH: CoM height  -> wheelie threshold = g*cgB/cgH
     leanRate: natural frequency of roll response [rad/s]
     engine: firing layout for the sound synth. The top-level values drive the original voice; `multi` (if present) switches the
     bike to the per-cylinder voice in audio.js with its own firing order and tuning. Delete a bike's `multi` block to get its
     original sound back.                                                   */
  AX.BIKES = {
    corsa: {
      id: 'corsa', name: 'CORSA 600', cls: 'Supersport', engineLabel: '599 cm³ · R4',
      blurb: { de: 'Leicht, drehfreudig, messerscharf am Kurveneingang.', en: 'Light, rev-happy and razor sharp on turn-in.' },
      mass: 248, power: 96, redline: 15600, idle: 1350,
      gears: [26.5, 35.5, 43.5, 51, 58, 66],
      torqueShape: [[0, 0.42], [0.2, 0.5], [0.4, 0.66], [0.55, 0.8], [0.7, 0.93], [0.82, 1.0], [0.92, 0.97], [1.0, 0.86]],
      wheelbase: 1.38, cgB: 0.66, cgH: 0.58, mu: 1.60, maxLean: 58, leanRate: 9.6, brake: 13.4, dragTop: 68,
      stats: { speed: 0.68, accel: 0.66, agility: 0.98, brake: 0.92 },
      engine: { cyl: 4, fire: [0, 0.25, 0.5, 0.75], rough: 0.05, pipe: 0.0026, bright: 1.25, body: 0.8,
        // inline four, tuned against a recording of a 600 supersport: an even hum at idle, muffled off the throttle, brighter and rougher
        // the harder it revs, an engine-braking howl, and a few deep bangs on the overrun and at the shift
        multi: { fire: [0, 0.25, 0.5, 0.75], rough: 0.02,
          tune: { cg: [1, 0.97, 0.99, 0.96], hd: [0, 0, 0, 0], pulse: 0.0007, header: 0.00075, silencer: 0.0009, boom: 2.4, bark: 0.75, barkHz: 900, crack: 0.6, rasp: 0.02, low: 0.7, intake: 1.5, boxHz: 300, runnerHz: 950, mech: 0.05, whine: 0.003, pops: 0.4, lump: 0, jitter: 0.000005, tail: 0.3, valve: 0.3, tiltHz: 180, gain: 1.3, drive: 1.6, fill: 0.2, step: 0.15, vnoise: 0.01, inoise: 0.03, hiss: 0.004, pack: 0.25, aa: 1, crackRise: 20000, top: 12000, boomHz: 220, barkQ: 0.8, edge: 0.9, tickQ: 1.5, popNoise: 0.2, ceil: 1, soft: 13, cgLoad: 1, dullHz: 1700, throat: 0.4, raspHz: 500, lf: [0.85, -0.5, 0.2, -0.6], lfBand: [350, 800], cgRev: [0.5, 0.82, 0.45], edgeRev: [0.5, 0.85, 0.1], midDip: [1900, -7, 0.9], edgeHz: 2200, motor: 0.3, softRev: 0.25, bang: 0.25, bangBig: 0.6, bangSmall: 0.25, limPop: 0.4, bangTone: 0.25, bangHz: 700, popMs: 4, popBig: 1.5, lfLoad: 1 } } },
      style: { fairing: 'full', tail: 'slim', exhaust: 'under', bars: 'clipon', winglets: false, scale: 0.97 },
      livery: ['#1d52d6', '#f3f4f6', '#0c1428']
    },
    strada: {
      id: 'strada', name: 'STRADA V4', cls: 'Superbike', engineLabel: '1103 cm³ · V4',
      blurb: { de: 'Brachiale Leistung. Das Vorderrad will ständig in die Luft.', en: 'Brutal power. The front wheel keeps reaching for the sky.' },
      mass: 276, power: 158, redline: 14200, idle: 1400,
      gears: [29, 39, 48, 56.5, 65, 75],
      torqueShape: [[0, 0.5], [0.2, 0.62], [0.4, 0.8], [0.55, 0.93], [0.7, 1.0], [0.82, 0.99], [0.92, 0.94], [1.0, 0.84]],
      wheelbase: 1.45, cgB: 0.68, cgH: 0.60, mu: 1.64, maxLean: 57, leanRate: 8.4, brake: 13.0, dragTop: 77,
      stats: { speed: 0.98, accel: 0.98, agility: 0.74, brake: 0.86 },
      gearTq: [0.72, 0.82, 0.93],   // torque map trims 1st-3rd: the 200-section rear can put it down
      engine: { cyl: 4, fire: [0, 0.125, 0.5, 0.625], rough: 0.09, pipe: 0.0034, bright: 1.0, body: 1.15,
        // 90° V4 with the twin-pulse firing order (0-90-290-380°), two banks with slightly different headers
        multi: { fire: [0, 0.125, 0.4028, 0.5278], rough: 0.09,
          tune: { cg: [1, 0.9, 1, 0.9], hd: [0, 0.00025, 0, 0.00025], pulse: 0.0006, header: 0.00095, silencer: 0.0008, boom: 1.6, bark: 1.3, barkHz: 900, crack: 1, rasp: 0.6, low: 0.5, intake: 0.9, boxHz: 260, runnerHz: 700, mech: 0.8, pops: 1.2, lump: 0.8, jitter: 0.00006, fill: 1, tiltHz: 300, tail: 0.6, valve: 0.6, step: 0.2, gain: 0.8 } } },
      style: { fairing: 'full', tail: 'tall', exhaust: 'side', bars: 'clipon', winglets: true, scale: 1.0 }
    },
    duetto: {
      id: 'duetto', name: 'DUETTO 900', cls: 'Naked Twin', engineLabel: '890 cm³ · V2',
      blurb: { de: 'Drehmoment aus dem Keller, breiter Lenker, Wheelie-Maschine.', en: 'Torque from idle, wide bars, a wheelie machine.' },
      mass: 262, power: 92, redline: 10400, idle: 1250,
      gears: [24.5, 33, 41, 48.5, 55.5, 62],
      torqueShape: [[0, 0.66], [0.2, 0.82], [0.38, 0.97], [0.5, 1.0], [0.65, 0.98], [0.8, 0.92], [0.92, 0.84], [1.0, 0.72]],
      wheelbase: 1.42, cgB: 0.62, cgH: 0.62, mu: 1.52, maxLean: 54, leanRate: 9.0, brake: 12.4, dragTop: 63,
      stats: { speed: 0.6, accel: 0.74, agility: 0.86, brake: 0.8 },
      engine: { cyl: 2, fire: [0, 0.375], rough: 0.12, pipe: 0.0046, bright: 0.72, body: 1.5,
        // 90° V-twin: uneven beat, dark and rough, lumpy idle
        multi: { fire: [0, 0.375], rough: 0.12,
          tune: { cg: [1, 0.88], hd: [0, 0.0004], pulse: 0.0009, header: 0.00135, silencer: 0.0011, boom: 1.4, bark: 1.3, barkHz: 620, crack: 1.3, rasp: 0.1, low: 0.55, intake: 1, boxHz: 210, runnerHz: 480, mech: 0.35, pops: 1.3, lump: 1.4, jitter: 0.00003, tail: 0.6, valve: 0.65, fill: 2.2, step: 0.2, gain: 0.62, vnoise: 0.04, inoise: 0.18, hiss: 0.02, top: 9500, pack: 0.25, tickQ: 1.5, edge: 2, popNoise: 0.4, ceil: 1 } } },
      style: { fairing: 'naked', tail: 'slim', exhaust: 'side', bars: 'wide', winglets: false, scale: 1.0 }
    }
  };
  AX.BIKE_ORDER = ['corsa', 'strada', 'duetto'];

  /* Engine sounds that no bike uses yet. A bike picks one up with `engine: AX.ENGINES.single450`.
     single450: 450 cm³ supermoto single, tuned for redline 11500 and idle 1900. kind 'single' selects the single-cylinder
     voice in audio.js; `tune` overrides its defaults (soundlab.html has a slider for each key and prints the values). */
  AX.ENGINES = {
    single450: { cyl: 1, kind: 'single', fire: [0], rough: 0.14, pipe: 0.004, bright: 1, body: 1, tune: {} }
  };

  AX.torqueAt = (spec, n) => {
    const c = spec.torqueShape;
    if (n <= 0) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (n <= c[i][0]) {
        const t = (n - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
        return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
      }
    }
    return Math.max(0, c[c.length - 1][1] - (n - 1) * 6);
  };

  /* Field of riders. All names, teams and sponsors are invented. */
  AX.RIDERS = [
    { name: 'DU',          num: 1,  c1: '#e8372c', c2: '#f3f3f0', c3: '#141518', helmet: '#f4f4f1', suit: '#17181b' },      // black leathers, white panels
    { name: 'M. Halvorsen', num: 27, c1: '#1f6fe0', c2: '#ffd23c', c3: '#0e1a33', helmet: '#ffd23c', suit: '#1f6fe0' },
    { name: 'R. Okafor',    num: 44, c1: '#19b36b', c2: '#0c0d0e', c3: '#f2f2ee', helmet: '#19b36b', suit: '#17191c' },
    { name: 'L. Ferrand',   num: 9,  c1: '#f4a21a', c2: '#17191c', c3: '#ffffff', helmet: '#17191c', suit: '#f4a21a' },
    { name: 'T. Sakamoto',  num: 73, c1: '#f2f2ee', c2: '#d6243a', c3: '#1a2a6b', helmet: '#d6243a', suit: '#f2f2ee' },
    { name: 'J. Brandl',    num: 12, c1: '#7b3fe0', c2: '#e9e2ff', c3: '#15101f', helmet: '#e9e2ff', suit: '#7b3fe0' },
    { name: 'A. Moretti',   num: 58, c1: '#11b9c9', c2: '#ff5a3c', c3: '#0b2226', helmet: '#ff5a3c', suit: '#11b9c9' },
    { name: 'K. Lindqvist', num: 33, c1: '#22252b', c2: '#c7f03a', c3: '#ffffff', helmet: '#c7f03a', suit: '#22252b' },
    { name: 'S. Navarro',   num: 5,  c1: '#ff5fa2', c2: '#ffffff', c3: '#2a1020', helmet: '#ffffff', suit: '#ff5fa2' },
    { name: 'P. Dvořák',    num: 88, c1: '#b8862b', c2: '#111111', c3: '#f6ecd0', helmet: '#111111', suit: '#b8862b' }
  ];

  AX.SURF = { ROAD: 0, KERB: 1, GRASS: 2, GRAVEL: 3, RUNOFF: 4 };
  AX.SURF_DATA = [
    { name: 'road',   grip: 1.00, drag: 0.0, dragV: 0.0 },
    { name: 'kerb',   grip: 0.92, drag: 0.15, dragV: 0.0 },
    { name: 'grass',  grip: 0.56, drag: 1.3, dragV: 0.045 },
    { name: 'gravel', grip: 0.50, drag: 4.2, dragV: 0.17 },
    { name: 'runoff', grip: 0.94, drag: 0.1, dragV: 0.0 }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = AX;
})(typeof globalThis !== 'undefined' ? globalThis : window);
