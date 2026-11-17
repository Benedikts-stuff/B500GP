/* APEX — sound. The engines are synthesised sample by sample in an AudioWorklet:
   every cylinder fires its own exhaust pulse (with slight cycle-to-cycle variation), the pulses ring
   through a pipe resonator, intake roar rides on the throttle, overrun misfires and pops, and the
   rev limiter / quick-shifter really cut ignition. Tyres, kerbs, wind, gravel and crashes are layered on top. */
(function (root) {
  'use strict';
  const AX = root.AX;
  const { clamp, damp } = AX;

  /* This function is stringified into the worklet, so it must stay self-contained. */
  function makeEngineSynthClass() {
    class Voice {
      constructor(sr) {
        this.sr = sr; this.ph = 0; this.rpm = 1500; this.rpmT = 1500; this.thr = 0; this.thrT = 0; this.vol = 0; this.volT = 0; this.pan = 0; this.panT = 0;
        this.fire = [0, 0.25, 0.5, 0.75]; this.amp = [1, 1, 1, 1]; this.rough = 0.05; this.redline = 14000; this.bright = 1; this.body = 1;
        this.dl = new Float32Array(2048); this.di = 0; this.D1 = 150; this.D2 = 93; this.lp1 = 0; this.lp2 = 0; this.lpA = 0; this.lpB = 0; this.hp = 0; this.dc = 0;
        this.seed = 1234567 + Math.floor(Math.random() * 1e6); this.cut = 0; this.pop = 0; this.popE = 0; this.cycle = 0; this.sinceOff = 9; this.popT = 0;
      }
      rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
      config(c) {
        this.fire = c.fire.slice(); this.amp = c.fire.map(() => 1); this.rough = c.rough; this.redline = c.redline; this.bright = c.bright; this.body = c.body;
        this.D1 = Math.max(8, Math.min(2000, Math.round(c.pipe * this.sr))); this.D2 = Math.max(5, Math.round(this.D1 * 0.618));
      }
      sample() {
        const sr = this.sr;
        this.rpm += (this.rpmT - this.rpm) * 0.0028; this.thr += (this.thrT - this.thr) * 0.004;
        const thr = this.thr, rn = this.rpm / this.redline, fire = this.fire, amp = this.amp, n = fire.length;
        this.ph += this.rpm / (120 * sr);
        if (this.ph >= 1) {
          this.ph -= 1; this.cycle++;
          const overrun = thr < 0.07 && rn > 0.32;
          for (let k = 0; k < n; k++) {
            let a = 1 + (this.rnd() - 0.5) * 2 * this.rough;
            if (overrun && this.rnd() < 0.3) a *= 0.3;                    // lean misfires off the throttle
            if (this.cut > 0.5 && ((this.cycle + k) & 1)) a = 0;            // limiter / quick-shifter ignition cut
            amp[k] = a;
          }
          if (overrun && this.sinceOff < 1.1 && this.rnd() < 0.05 + rn * 0.09) this.popE = 0.35 + this.rnd() * 0.45;   // burble
        }
        if (thr < 0.07) this.sinceOff += 1 / sr; else if (thr > 0.5) this.sinceOff = 0;
        let ex = 0, inn = 0; const w = 0.3;
        for (let k = 0; k < n; k++) {
          let p = this.ph - fire[k]; if (p < 0) p += 1;
          if (p < w) { const x = p / w; ex += amp[k] * Math.sin(6.2832 * x) * Math.exp(-4.2 * x); }
          let q = p - 0.5; if (q < 0) q += 1; if (q < 0.25) inn += Math.sin(12.566 * q);
        }
        const nz = this.rnd() * 2 - 1, load = 0.5 + 0.5 * thr;
        let x = ex * load * (1 + nz * 0.16 * thr) * (4 / (n + 2));
        if (this.pop > 0) { this.popE = Math.max(this.popE, this.pop); this.pop = 0; }
        if (this.popE > 0.002) { x += nz * this.popE * 1.5; this.popE *= 0.9972; }
        const dl = this.dl, m = 2047;
        const d1 = dl[(this.di - this.D1) & m], d2 = dl[(this.di - this.D2) & m];
        this.lp1 += (d1 - this.lp1) * 0.42; this.lp2 += (d2 - this.lp2) * 0.6;
        let y = x - 0.54 * this.lp1 - 0.28 * this.lp2;
        dl[this.di] = y; this.di = (this.di + 1) & m;
        y = Math.tanh(y * (1.6 + 1.1 * thr) * this.body);
        y += nz * inn * thr * thr * (0.2 + rn * 0.8) * 0.12;                 // induction roar
        const fc = 1100 + (7000 * Math.pow(thr, 0.8) + rn * 3400) * this.bright;
        const a = 1 - Math.exp(-6.2832 * fc / sr);
        this.lpA += (y - this.lpA) * a; this.lpB += (this.lpA - this.lpB) * a;
        let out = this.lpB;
        this.hp += (nz - this.hp) * 0.35; out += (nz - this.hp) * 0.018 * rn * (0.4 + thr * 0.6);   // valve train / chain
        this.dc += (out - this.dc) * 0.0006; out -= this.dc;
        return out * (0.72 + 0.28 * thr) * (0.7 + 0.3 * rn) * 0.85;
      }
    }
    class EngineSynth {
      constructor(sr, nVoices) { this.sr = sr; this.v = []; for (let i = 0; i < (nVoices || 4); i++) this.v.push(new Voice(sr)); }
      message(m) {
        if (m.t === 'cfg') this.v[m.i].config(m);
        else if (m.t === 'set') {
          for (let i = 0; i < this.v.length && i < m.v.length; i++) { const s = m.v[i], v = this.v[i]; v.rpmT = s[0]; v.thrT = s[1]; v.volT = s[2]; v.panT = s[3]; v.cut = s[4]; if (s[5] > 0) v.pop = s[5]; }
        }
      }
      render(L, R, n) {
        const vs = this.v;
        for (let i = 0; i < n; i++) {
          let l = 0, r = 0;
          for (let k = 0; k < vs.length; k++) {
            const v = vs[k]; v.vol += (v.volT - v.vol) * 0.0015; v.pan += (v.panT - v.pan) * 0.0015;
            if (v.vol < 0.0005 && v.volT < 0.0005) continue;
            const s = v.sample() * v.vol; l += s * (1 - Math.max(0, v.pan)); r += s * (1 + Math.min(0, v.pan));
          }
          L[i] = l; R[i] = r;
        }
      }
    }
    return EngineSynth;
  }
  AX.makeEngineSynthClass = makeEngineSynthClass;

  const WORKLET = 'const EngineSynth = (' + makeEngineSynthClass.toString() + ')();\n' +
    'class ApexEngine extends AudioWorkletProcessor { constructor(){ super(); this.s = new EngineSynth(sampleRate, 4); this.port.onmessage = (e) => this.s.message(e.data); }\n' +
    ' process(i, o){ const out = o[0]; this.s.render(out[0], out[1] || out[0], out[0].length); return true; } }\nregisterProcessor("apex-engine", ApexEngine);';

  class Sound {
    constructor() { this.ctx = null; this.ready = false; this.muted = false; this.volume = 0.8; this.voiceSpec = [null, null, null, null]; this.pending = []; this.popCool = 0; this.duck = 1; }

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return;
      const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
      this.master.connect(comp); comp.connect(ctx.destination);
      // short outdoor reverb
      const len = Math.floor(ctx.sampleRate * 0.9), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 600 ? i / 600 : 1); } }
      this.rev = ctx.createConvolver(); this.rev.buffer = ir; const rg = ctx.createGain(); rg.gain.value = 0.14; this.rev.connect(rg); rg.connect(this.master);
      this.engBus = ctx.createGain(); this.engBus.gain.value = 0.9; this.engBus.connect(this.master); this.engBus.connect(this.rev);
      this.fxBus = ctx.createGain(); this.fxBus.gain.value = 1; this.fxBus.connect(this.master);
      // looping noise source shared by all noise layers
      const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const layer = (type, f, q, dest) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = 0.9 + Math.random() * 0.2; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(dest || this.fxBus); s.start(); return { f: fl, g }; };
      this.wind = layer('bandpass', 700, 0.6); this.squeal = layer('bandpass', 1900, 7); this.squeal2 = layer('bandpass', 2850, 9); this.scrub = layer('lowpass', 520, 0.7);
      this.dirt = layer('bandpass', 900, 0.8); this.scrape = layer('bandpass', 2600, 1.6); this.crowd = layer('bandpass', 800, 0.5);
      // kerb rumble: low noise chopped by the kerb teeth
      this.kerb = layer('lowpass', 210, 1.2); this.kerbChop = ctx.createGain(); this.kerbChop.gain.value = 0; this.kerb.g.disconnect(); this.kerb.g.connect(this.kerbChop); this.kerbChop.connect(this.fxBus); this.kerb.g.gain.value = 1;
      this.kerbOsc = ctx.createOscillator(); this.kerbOsc.type = 'square'; this.kerbOsc.frequency.value = 12; this.kerbDepth = ctx.createGain(); this.kerbDepth.gain.value = 0; this.kerbOsc.connect(this.kerbDepth); this.kerbDepth.connect(this.kerbChop.gain); this.kerbOsc.start();
      const startEngine = (node) => { this.eng = node; node.connect(this.engBus); this.ready = true; this.pending.forEach((m) => this.post(m)); this.pending.length = 0; };
      const fallback = () => {
        const Synth = makeEngineSynthClass(), synth = new Synth(ctx.sampleRate, 4); const sp = ctx.createScriptProcessor(1024, 0, 2);
        sp.onaudioprocess = (e) => synth.render(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1), 1024);
        sp.port = { postMessage: (m) => synth.message(m) }; startEngine(sp);
      };
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        ctx.audioWorklet.addModule(url).then(() => startEngine(new AudioWorkletNode(ctx, 'apex-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }))).catch(fallback);
      } catch (e) { fallback(); }
    }
    post(m) { if (!this.ready) { if (m.t === 'cfg') this.pending.push(m); return; } this.eng.port.postMessage(m); }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v * this.duck, this.ctx.currentTime, 0.05); }
    setMuted(m) { this.muted = m; this.setVolume(this.volume); }
    setDuck(d) { this.duck = d; this.setVolume(this.volume); }
    configVoice(i, spec) {
      if (this.voiceSpec[i] === spec.id) return; this.voiceSpec[i] = spec.id; const e = spec.engine;
      this.post({ t: 'cfg', i, fire: e.fire, rough: e.rough, pipe: e.pipe, bright: e.bright, body: e.body, redline: spec.redline });
    }

    /* s: { player:{rpm,thr,cut,pop,spec}, others:[{rpm,thr,cut,spec,dist,pan,doppler}], speed, vmax, squeal, skid, kerb, surf, scrape, crowd, mute } */
    update(dt, s) {
      if (!this.ctx || !this.ready) return; const t = this.ctx.currentTime, set = (p, v, k) => p.setTargetAtTime(v, t, k || 0.05);
      const v = [];
      if (s.player) { this.configVoice(0, s.player.spec); v.push([s.player.rpm, s.player.thr, s.player.vol == null ? 0.8 : s.player.vol, 0, s.player.cut ? 1 : 0, s.player.pop || 0]); } else v.push([1500, 0, 0, 0, 0, 0]);
      for (let k = 0; k < 3; k++) {
        const o = s.others && s.others[k];
        if (o) { this.configVoice(k + 1, o.spec); const vol = 0.62 / (1 + (o.dist / 11) * (o.dist / 11)); v.push([o.rpm * (o.doppler || 1), o.thr, vol, o.pan || 0, o.cut ? 1 : 0, 0]); }
        else v.push([1500, 0, 0, 0, 0, 0]);
      }
      this.post({ t: 'set', v });
      const sp = clamp((s.speed || 0) / (s.vmax || 70), 0, 1.2);
      set(this.wind.g.gain, sp * sp * 0.2); set(this.wind.f.frequency, 500 + sp * 1300);
      const sq = clamp(s.squeal || 0, 0, 1);
      set(this.squeal.g.gain, sq * sq * 0.085, 0.04); set(this.squeal2.g.gain, sq * sq * 0.04, 0.04); set(this.squeal.f.frequency, 1700 + sq * 500 + sp * 300); set(this.squeal2.f.frequency, 2600 + sq * 700);
      set(this.scrub.g.gain, clamp(s.skid || 0, 0, 1) * 0.3, 0.04);
      const off = s.surf === AX.SURF.GRAVEL ? 1 : s.surf === AX.SURF.GRASS ? 0.55 : 0;
      set(this.dirt.g.gain, off * clamp(sp * 3, 0, 1) * 0.42); set(this.dirt.f.frequency, s.surf === AX.SURF.GRAVEL ? 1500 : 480);
      set(this.scrape.g.gain, clamp(s.scrape || 0, 0, 1) * 0.3, 0.03);
      const kb = clamp(s.kerb || 0, 0, 1); set(this.kerbChop.gain, kb * 0.35, 0.02); set(this.kerbDepth.gain, kb * 0.35, 0.02); this.kerbOsc.frequency.setTargetAtTime(clamp((s.speed || 0) / 2.2, 4, 60), t, 0.03);
      set(this.crowd.g.gain, clamp(s.crowd || 0, 0, 1) * 0.07, 0.4);
    }

    tone(freq, dur, vol, type) {
      if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol || 0.12, t + 0.012); g.gain.setValueAtTime(vol || 0.12, t + dur - 0.04); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    }
    burst(dur, f0, f1, vol, q) {
      if (!this.ctx) return; const c = this.ctx, t = c.currentTime, n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
      const s = c.createBufferSource(); s.buffer = b; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q || 0.8; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      const g = c.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(this.master); g.connect(this.rev); s.start(t);
    }
    thump(f0, f1, dur, vol) {
      if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    }
    crash(k) { k = clamp(k || 0.7, 0.2, 1); this.burst(0.5, 2400, 300, 0.55 * k, 0.6); this.thump(120, 38, 0.32, 0.7 * k); this.burst(0.12, 5200, 2500, 0.3 * k, 1.2); }
    wall(k) { this.thump(150, 50, 0.16, 0.45 * clamp(k, 0.2, 1)); this.burst(0.18, 1800, 500, 0.3 * clamp(k, 0.2, 1), 0.7); }
    shift(up) { this.burst(0.03, up ? 2600 : 1800, 900, 0.07, 1.5); }
    land(k) { this.thump(95, 45, 0.14, 0.4 * k); this.burst(0.07, 1500, 700, 0.12 * k, 1); }
    click() { this.tone(880, 0.05, 0.05, 'triangle'); }
    lightBeep(go) { if (go) { this.tone(880, 0.55, 0.14, 'square'); this.tone(1320, 0.55, 0.05, 'sine'); } else this.tone(440, 0.16, 0.12, 'square'); }
    chime() { this.tone(660, 0.12, 0.08, 'triangle'); setTimeout(() => this.tone(990, 0.2, 0.08, 'triangle'), 110); }
  }
  AX.Sound = Sound;
})(typeof globalThis !== 'undefined' ? globalThis : window);
