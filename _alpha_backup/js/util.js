/* =========================================================
   APEX & PASS — utilities, bike specs & Real Sample-Based Motorcycle Audio
   ========================================================= */
'use strict';

const G = 9.81;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const approach = (cur, target, upRate, downRate, dt) => {
  const rate = target > cur ? upRate : downRate;
  const d = target - cur;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
};
const mod = (n, m) => ((n % m) + m) % m;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const signOr = (v, s) => v === 0 ? s : Math.sign(v);

function formatTime(t) {
  if (!isFinite(t) || t <= 0) return '—';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
function formatDelta(d) {
  if (!isFinite(d)) return '—';
  return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3);
}

class RNG {
  constructor(seed = 1337) { this.s = seed >>> 0; }
  next() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function srgb(hex) {
  return new THREE.Color(hex).convertSRGBToLinear();
}

function linearizeGroup(root) {
  const mats = new Set();
  const geos = new Set();
  const c = new THREE.Color();
  root.traverse(o => {
    if (o.material) {
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach(m => {
        if (!m || mats.has(m)) return;
        mats.add(m);
        if (m.color) m.color.convertSRGBToLinear();
        if (m.emissive) m.emissive.convertSRGBToLinear();
      });
    }
    if (o.geometry && !geos.has(o.geometry)) {
      geos.add(o.geometry);
      const attr = o.geometry.getAttribute('color');
      if (attr) {
        const a = attr.array;
        for (let i = 0; i < a.length; i += 3) {
          c.setRGB(a[i], a[i + 1], a[i + 2]).convertSRGBToLinear();
          a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b;
        }
        attr.needsUpdate = true;
      }
    }
    if (o.isInstancedMesh && o.instanceColor) {
      const a = o.instanceColor.array;
      for (let i = 0; i < a.length; i += 3) {
        c.setRGB(a[i], a[i + 1], a[i + 2]).convertSRGBToLinear();
        a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b;
      }
      o.instanceColor.needsUpdate = true;
    }
  });
}

/* =========================================================
   BIKE DATA
   ========================================================= */
const BIKES = {
  v4: {
    id: 'v4',
    name: 'STRADA V4',
    cls: 'HYPER-NAKED',
    sub: '1100 cm³ V4 · 153 kW',
    engineLabel: '1100 V4',
    power: 153, torque: 123, redline: 14000, idle: 1250,
    mass: 199, riderMass: 78,
    wheelbase: 1.48, wheelR: 0.305, rearBias: 0.52, comH: 0.90,
    maxLean: 0.94, gears: [3.15, 2.35, 1.90, 1.60, 1.38, 1.15], final: 4.55,
    color: 0xc8241b, accent: 0x17181a, metal: 0x9aa0a6,
    stats: [94, 82, 68],
    audio: 'v4',
    desc: 'Brachialer V4. Zieht dicke schwarze Striche am Kurvenausgang.'
  },
  i4: {
    id: 'i4',
    name: 'CORSA 600',
    cls: 'SUPERSPORT',
    sub: '600 cm³ Inline-4 · 88 kW',
    engineLabel: '600 I4',
    power: 88, torque: 74, redline: 15500, idle: 1600,
    mass: 190, riderMass: 72,
    wheelbase: 1.37, wheelR: 0.30, rearBias: 0.51, comH: 0.85,
    maxLean: 0.99, gears: [3.35, 2.52, 2.02, 1.68, 1.44, 1.24], final: 5.85,
    color: 0xf2eee4, accent: 0x1d468a, metal: 0x9aa0a6,
    stats: [80, 97, 64],
    audio: 'i4',
    desc: 'Drehzahl-Skalpell. Späteste Bremspunkte, Backing-it-in, 15.500 U/min.'
  },
  boxer: {
    id: 'boxer',
    name: 'NOMAD 1300',
    cls: 'BIG ADVENTURE',
    sub: '1300 cm³ Boxer-Twin · 107 kW',
    engineLabel: '1300 Boxer',
    power: 107, torque: 149, redline: 9000, idle: 1100,
    mass: 237, riderMass: 80,
    wheelbase: 1.51, wheelR: 0.335, rearBias: 0.54, comH: 0.95,
    maxLean: 0.82, gears: [2.70, 1.95, 1.55, 1.30, 1.12, 0.95], final: 4.40,
    color: 0xe8e5dc, accent: 0x22559c, metal: 0xb4b8b0,
    stats: [84, 64, 95],
    audio: 'boxer',
    desc: 'Drehmoment-Dampfhammer. Räubert Curbs mühelos, drückt brutal aus engen Kehren.'
  }
};

/* =========================================================
   AUDIO — Real-Time 4-Stroke Combustion & Exhaust Waveguide DSP
   Characterful V4 / I4 / Boxer growl, intake roar, overrun burble, pops & bangs!
   ========================================================= */
function createMotoDSPState(sampleRate) {
  return {
    sr: sampleRate || 48000,
    phase: 0,
    subPhase: 0,
    limPhase: 0,
    rng: 0x1234567,
    b0: 0, b1: 0, b2: 0,
    // Active cylinder blowdown voices + exhaust bang transients
    voices: new Float32Array(12), // [amp, decay, age, phase...] - simpler ring of 4 active pulses
    pulseAmp: new Float32Array(6),
    pulseDecay: new Float32Array(6),
    pulseFreq: new Float32Array(6),
    pulsePhase: new Float32Array(6),
    nextVoice: 0,
    jitter: new Float32Array([0.002, -0.003, 0.004, -0.002]),
    // Exhaust pipe waveguide (up to 512 samples)
    pipe: new Float32Array(512),
    pipeIdx: 0,
    pipeLp: 0,
    // Output 2-pole SVF lowpass + highpass DC blocker
    lp1: 0, lp2: 0,
    airBp1: 0, airBp2: 0,
    dcX: 0, dcY: 0,
    // Overrun & exhaust pop/bang state
    popEnv: 0,
    bangSubEnv: 0,
    bangSubPhase: 0,
    popLp: 0,
    popLp2: 0,
    bangQueueTimer: 0,
    bangQueueStrength: 0,
    overrunTimer: 0.05,
    sRpm: 1250,
    sThr: 0,
    sOverrun: 0,
    shiftCutEnv: 1.0,
    shiftCutTimer: 0
  };
}

function stepMotoDSP(st, rpm, thr, overrun, limiter, engineType, popOutTrigger) {
  // Fast deterministic PRNG (used ONLY for organic cycle jitter & muffled pop transient, zero continuous noise hiss!)
  st.rng = (Math.imul(st.rng ^ (st.rng >>> 13), 0x5bd1e995) + 0x9e3779b9) | 0;
  const white = ((st.rng >>> 0) / 4294967296) * 2 - 1;
  // Dark warm pink envelope for high-load airbox only
  st.b0 = 0.996 * st.b0 + white * 0.018;
  st.b1 = 0.975 * st.b1 + white * 0.022;
  const darkNoise = (st.b0 + st.b1) * 0.45;

  const sr = st.sr;
  const invSr = 1 / sr;
  st.sRpm += (rpm - st.sRpm) * 0.0035;
  st.sThr += (thr - st.sThr) * 0.004;
  st.sOverrun += (overrun - st.sOverrun) * 0.004;

  const curRpm = Math.max(750, Math.min(17000, st.sRpm));
  const curThr = Math.max(0, Math.min(1, st.sThr));
  const curOver = Math.max(0, Math.min(1, st.sOverrun));
  const revNorm = Math.max(0, Math.min(1.1, (curRpm - 1100) / 13500));

  // Cycle frequency for 4-stroke (720° = 2 crank turns)
  const cycleHz = (curRpm / 60) * 0.5;
  const phaseInc = cycleHz * invSr;
  const prevPhase = st.phase;
  st.phase += phaseInc;
  if (st.phase >= 1) st.phase -= 1;

  // Firing angles in [0..1)
  let firePts, pipeFreq, baseGrowlHz, strokeMs, fireGain;
  if (engineType === 1) {
    // Inline-4 Supersport: smooth 180° firing, higher screaming header
    firePts = [0.0, 0.25, 0.50, 0.75];
    pipeFreq = 290 + revNorm * 165;
    baseGrowlHz = cycleHz * 4.0;
    strokeMs = 0.0075 - revNorm * 0.0040;
    fireGain = 0.34;
  } else if (engineType === 2) {
    // 1300 Boxer Twin: deep alternating thump, cavernous low header
    firePts = [0.0, 0.50];
    pipeFreq = 148 + revNorm * 85;
    baseGrowlHz = cycleHz * 2.0;
    strokeMs = 0.0135 - revNorm * 0.0055;
    fireGain = 0.54;
  } else {
    // 1100 V4 (Twin-Pulse 90°): irregular gnarly Ducati growl!
    firePts = [0.0, 0.128, 0.395, 0.523];
    pipeFreq = 215 + revNorm * 115;
    baseGrowlHz = cycleHz * 2.0; // strong 360° uneven sub-pulse growl!
    strokeMs = 0.0105 - revNorm * 0.0052;
    fireGain = 0.42;
  }

  // Limiter & Quickshift cut
  let igCut = 1.0;
  if (st.shiftCutTimer > 0) {
    st.shiftCutTimer -= invSr;
    igCut = 0.12;
  } else if (limiter > 0.5) {
    st.limPhase += 26 * invSr;
    if (st.limPhase >= 1) st.limPhase -= 1;
    if (st.limPhase > 0.54) igCut = 0.08;
  }

  // Trigger cylinder blowdown pressure impulses
  const jitterAmt = 0.003 + (1 - curThr) * 0.009 * (1 - revNorm * 0.6);
  const pulseLoad = (0.36 + curThr * 0.78 + curOver * 0.25) * igCut;
  for (let k = 0; k < firePts.length; k++) {
    const target = (firePts[k] + st.jitter[k] + 1) % 1;
    const crossed = (st.phase >= prevPhase)
      ? (target >= prevPhase && target < st.phase)
      : (target >= prevPhase || target < st.phase);
    if (crossed) {
      // Refresh organic cycle-to-cycle combustion jitter
      st.jitter[k] = white * jitterAmt;
      const idx = st.nextVoice;
      st.nextVoice = (idx + 1) % 6;
      const ampVar = 0.88 + Math.abs(white) * 0.24;
      st.pulseAmp[idx] = fireGain * pulseLoad * ampVar;
      st.pulseDecay[idx] = Math.exp(-invSr / Math.max(0.0018, strokeMs));
      st.pulsePhase[idx] = 0;
      st.pulseFreq[idx] = (1.0 / Math.max(0.0022, strokeMs * 1.4)) * invSr;
    }
  }

  // Sum warm asymmetric combustion waves
  let comb = 0;
  for (let v = 0; v < 6; v++) {
    const a = st.pulseAmp[v];
    if (a > 0.0005) {
      st.pulsePhase[v] += st.pulseFreq[v];
      const w = Math.sin(Math.min(Math.PI, st.pulsePhase[v] * Math.PI));
      comb += a * (0.65 * w + 0.35);
      st.pulseAmp[v] = a * st.pulseDecay[v];
    }
  }

  // Warm crank-cycle fundamental growl + subtle deep decel burble texture (no hiss)
  st.subPhase += baseGrowlHz * invSr;
  if (st.subPhase >= 1) st.subPhase -= 1;
  const subHarm = Math.sin(st.subPhase * 6.2831853);
  const sub2 = Math.sin(st.subPhase * 12.56637);
  const overrunGrowl = curOver * 0.09 * Math.sin(st.subPhase * 3.14159);
  const subBody = ((subHarm * 0.65 + sub2 * 0.35) * (0.15 + curThr * 0.24) + overrunGrowl) * (1 - revNorm * 0.32) * igCut;

  // Occasional warm muffled exhaust pops/bangs triggered cleanly from physics events
  if (popOutTrigger > 0) {
    const pAmp = Math.min(0.85, popOutTrigger) * 0.56;
    st.popEnv = Math.max(st.popEnv, pAmp);
    st.bangSubEnv = Math.max(st.bangSubEnv, pAmp * 1.15);
    if (popOutTrigger > 0.72 && st.bangQueueTimer <= 0) {
      st.bangQueueTimer = 0.075 + Math.abs(white) * 0.065;
      st.bangQueueStrength = pAmp * 0.45;
    }
  }
  if (st.bangQueueTimer > 0) {
    st.bangQueueTimer -= invSr;
    if (st.bangQueueTimer <= 0) {
      st.popEnv = Math.max(st.popEnv, st.bangQueueStrength);
      st.bangSubEnv = Math.max(st.bangSubEnv, st.bangQueueStrength * 1.1);
    }
  }

  let exhaustBang = 0;
  if (st.popEnv > 0.001 || st.bangSubEnv > 0.001) {
    // Muffled canister thump: low-passed combustion puff + pitch-dropping body resonance (zero bright static!)
    const popFreq = 62 + 115 * st.bangSubEnv;
    st.bangSubPhase += popFreq * invSr;
    if (st.bangSubPhase >= 1) st.bangSubPhase -= 1;
    const canisterThump = Math.sin(st.bangSubPhase * 6.2831853) * st.bangSubEnv * 0.52;
    st.popLp += 0.048 * (white * st.popEnv - st.popLp);
    st.popLp2 += 0.048 * (st.popLp - st.popLp2);
    const gasPuff = st.popLp2 * 1.45;
    exhaustBang = (canisterThump + gasPuff) * 0.58;
    st.popEnv *= Math.exp(-invSr / 0.018);
    st.bangSubEnv *= Math.exp(-invSr / 0.036);
  } else {
    st.popLp *= 0.9;
    st.popLp2 *= 0.9;
  }

  // Feed exhaust header waveguide resonator PURE harmonic combustion (no continuous white noise!)
  const delayLen = Math.max(32, Math.min(480, Math.round(sr / pipeFreq)));
  const readIdx = (st.pipeIdx - delayLen + 512) & 511;
  const pipeOut = st.pipe[readIdx];
  st.pipeLp = st.pipeLp * 0.58 + pipeOut * 0.42;
  const pipeFb = 0.46 + curThr * 0.22;
  const excite = comb + exhaustBang * 0.28;
  st.pipe[st.pipeIdx] = Math.tanh((excite + st.pipeLp * pipeFb) * 0.92);
  st.pipeIdx = (st.pipeIdx + 1) & 511;

  // Warm low-mid airbox resonance strictly under real throttle (>18%) - ZERO idle hiss!
  const thrAir = Math.max(0, curThr - 0.18) / 0.82;
  const airFreq = Math.min(0.16, (260 + revNorm * 420) * invSr * 6.283);
  const airIn = darkNoise * (thrAir * 0.095 * (0.35 + revNorm * 0.65));
  st.airBp1 += airFreq * (airIn - st.airBp1);
  st.airBp2 += airFreq * (st.airBp1 - st.airBp2);
  const airbox = st.airBp2 * 0.55;

  // Combine engine voices + warm exhaust lowpass + subtle saturation
  let raw = (st.pipeLp * 0.65 + comb * 0.54 + subBody + airbox + exhaustBang * 0.36);

  // Dynamic warm exhaust filter (low rumble at idle -> clean snarling rasp under load, never harsh hiss)
  const cutHz = 580 + revNorm * 2600 + curThr * 1500 + st.popEnv * 360;
  const f = Math.min(0.45, cutHz * invSr * 3.14159);
  st.lp1 += f * (raw - st.lp1);
  st.lp2 += f * (st.lp1 - st.lp2);

  // DC blocker
  const out = st.lp2;
  const dcOut = out - st.dcX + 0.996 * st.dcY;
  st.dcX = out;
  st.dcY = dcOut;

  return Math.tanh(dcOut * 0.95) * 0.72;
}

const MOTO_WORKLET_CODE = `
${createMotoDSPState.toString()}
${stepMotoDSP.toString()}
class MotoEngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 1250, minValue: 600, maxValue: 18000, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'overrun', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'limiter', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'engineType', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' }
    ];
  }
  constructor() {
    super();
    this.st = createMotoDSPState(sampleRate);
    this.pendingPop = 0;
    this.port.onmessage = (e) => {
      if (!e.data) return;
      if (e.data.type === 'pop') this.pendingPop = Math.max(this.pendingPop, e.data.strength || 0.7);
      if (e.data.type === 'shift') this.st.shiftCutTimer = 0.065;
    };
  }
  process(inputs, outputs, params) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const rpm = params.rpm[0];
    const thr = params.throttle[0];
    const over = params.overrun[0];
    const lim = params.limiter[0];
    const etype = Math.round(params.engineType[0]);
    for (let i = 0; i < out.length; i++) {
      out[i] = stepMotoDSP(this.st, rpm, thr, over, lim, etype, this.pendingPop);
      this.pendingPop = 0;
    }
    return true;
  }
}
registerProcessor('moto-engine', MotoEngineProcessor);
`;

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bike = null;
    this.muted = false;
    this.volume = 0.28; // Warm, rich, balanced volume — never harsh or loud
    this.ready = false;
    this.workletNode = null;
    this.fallbackSt = null;
    this._fallbackPop = 0;
    this._engineTypeId = 0;
    this._inMenu = true;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;

    // Warm mastering chain: low-end chest growl, smoothed top-end, tight peak control
    const bodyEQ = ctx.createBiquadFilter();
    bodyEQ.type = 'lowshelf';
    bodyEQ.frequency.value = 115;
    bodyEQ.gain.value = 3.5;

    const tameEQ = ctx.createBiquadFilter();
    tameEQ.type = 'lowpass';
    tameEQ.frequency.value = 4600;
    tameEQ.Q.value = 0.65;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 4.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.16;

    bodyEQ.connect(tameEQ);
    tameEQ.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.92;
    this.engineGain.connect(bodyEQ);

    // Subtle stereo room/exhaust delay ambience (~12% wet)
    const ambDelay = ctx.createDelay(0.1);
    ambDelay.delayTime.value = 0.022;
    const ambGain = ctx.createGain();
    ambGain.gain.value = 0.12;
    this.engineGain.connect(ambDelay);
    ambDelay.connect(ambGain);
    ambGain.connect(bodyEQ);

    // Textured noise buffer for tire scrub & speed wind
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) {
      const white = Math.random() * 2 - 1;
      last = 0.92 * last + 0.08 * white;
      nd[i] = last * 3.0;
    }
    this.noiseBuffer = nb;

    // Tire scrub / asphalt slide friction
    this.squealSrc = ctx.createBufferSource();
    this.squealSrc.buffer = nb;
    this.squealSrc.loop = true;
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 680;
    this.squealFilter.Q.value = 2.6;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squealSrc.connect(this.squealFilter);
    this.squealFilter.connect(this.squealGain);
    this.squealGain.connect(this.master);
    this.squealSrc.start();

    // Subtle high-speed wind turbulence
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = nb;
    this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.9;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.windSrc.start();

    this.ready = true;
    if (this.bike) this.setBike(this.bike);
    this._rampMaster();

    // Load Sample-Accurate AudioWorklet via UTF-8 safe data URL (works 100% on file:// and http://!)
    if (ctx.audioWorklet) {
      try {
        const encoded = unescape(encodeURIComponent(MOTO_WORKLET_CODE));
        const dataUrl = 'data:application/javascript;base64,' + btoa(encoded);
        ctx.audioWorklet.addModule(dataUrl).then(() => {
          const node = new AudioWorkletNode(ctx, 'moto-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
          node.connect(this.engineGain);
          this.workletNode = node;
          if (this.bike) this.setBike(this.bike);
        }).catch(() => this._initFallbackProcessor());
      } catch (e) {
        this._initFallbackProcessor();
      }
    } else {
      this._initFallbackProcessor();
    }
  }

  _initFallbackProcessor() {
    if (!this.ctx || this.workletNode || this.scriptNode) return;
    const sp = this.ctx.createScriptProcessor(512, 0, 1);
    this.fallbackSt = createMotoDSPState(this.ctx.sampleRate);
    this._fbParams = { rpm: 1250, throttle: 0, overrun: 0, limiter: 0 };
    sp.onaudioprocess = (ev) => {
      const out = ev.outputBuffer.getChannelData(0);
      const fp = this._fbParams;
      for (let i = 0; i < out.length; i++) {
        out[i] = stepMotoDSP(this.fallbackSt, fp.rpm, fp.throttle, fp.overrun, fp.limiter, this._engineTypeId, this._fallbackPop);
        this._fallbackPop = 0;
      }
    };
    sp.connect(this.engineGain);
    this.scriptNode = sp;
  }

  _rampMaster() {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    const target = this.muted ? 0 : this.volume * (this._inMenu ? 0.35 : 1.0);
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(target, t, 0.14);
  }

  setMuted(m) {
    this.muted = m;
    this._rampMaster();
  }

  setMenuQuiet(inMenu) {
    if (this._inMenu === inMenu) return;
    this._inMenu = inMenu;
    this._rampMaster();
  }

  setBike(spec) {
    this.bike = spec;
    this._engineTypeId = spec.audio === 'i4' ? 1 : spec.audio === 'boxer' ? 2 : 0;
    if (this.workletNode && this.ctx) {
      this.workletNode.parameters.get('engineType').setValueAtTime(this._engineTypeId, this.ctx.currentTime);
    }
  }

  shift() {
    if (this.workletNode) this.workletNode.port.postMessage({ type: 'shift' });
    else if (this.fallbackSt) this.fallbackSt.shiftCutTimer = 0.065;
  }

  backfirePop(intensity = 0.7) {
    if (!this.ready) return;
    const str = clamp(intensity, 0.25, 1.0);
    if (this.workletNode) this.workletNode.port.postMessage({ type: 'pop', strength: str });
    else this._fallbackPop = Math.max(this._fallbackPop, str);
  }

  beep(freq = 520, dur = 0.12, vol = 0.07) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }

  crash() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.75);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); src.stop(ctx.currentTime + 1.0);
  }

  update(s) {
    if (!this.ready || !this.bike) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const rpm = s.rpm || this.bike.idle;
    const thr = clamp(s.throttle || 0, 0, 1);
    const over = clamp(s.overrun || 0, 0, 1);
    const lim = s.limiter ? 1 : 0;

    if (this.workletNode) {
      const p = this.workletNode.parameters;
      p.get('rpm').setTargetAtTime(rpm, now, 0.02);
      p.get('throttle').setTargetAtTime(thr, now, 0.025);
      p.get('overrun').setTargetAtTime(over, now, 0.03);
      p.get('limiter').setTargetAtTime(lim, now, 0.01);
      p.get('engineType').setValueAtTime(this._engineTypeId, now);
    } else if (this._fbParams) {
      this._fbParams.rpm = rpm;
      this._fbParams.throttle = thr;
      this._fbParams.overrun = over;
      this._fbParams.limiter = lim;
    }

    const slip = clamp(s.slip || 0, 0, 1);
    const scrubAmt = slip > 0.22 ? (slip - 0.22) * 0.08 * clamp((s.speed || 0) / 10, 0.15, 1) : 0;
    this.squealGain.gain.setTargetAtTime(scrubAmt, now, 0.04);
    this.squealFilter.frequency.setTargetAtTime(560 + slip * 360, now, 0.05);

    const windAmt = clamp(((s.speed || 0) - 26) / 36, 0, 1) * 0.012;
    this.windGain.gain.setTargetAtTime(windAmt, now, 0.08);
    this.windFilter.frequency.setTargetAtTime(240 + windAmt * 6000, now, 0.08);
  }
}
