/* APEX — sound. The engines are synthesised sample by sample in an AudioWorklet:
   every cylinder fires its own exhaust pulse (with slight cycle-to-cycle variation), the pulses ring
   through a pipe resonator, intake roar rides on the throttle, overrun misfires and pops, and the
   rev limiter / quick-shifter really cut ignition. Tyres, kerbs, wind, gravel and crashes are layered on top.
   Three engine voices: Voice (the original, crank-angle pulses), Thumper (single cylinder) and Multi (two to four
   cylinders on the Thumper model). core.js picks one per bike. */
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
    /* Band-pass biquad with unity gain at its centre frequency (used by the single below). */
    class BP {
      constructor() { this.b = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
      set(f, q, sr) { const w = 6.2832 * Math.min(f, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al; this.b = al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0; }
      run(x) { const y = this.b * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
    }

    /* Single-cylinder four-stroke ("thumper"), used by bikes with engine.kind === 'single'. All other bikes keep the Voice above.
       One bang every 720 degrees, so every exhaust pulse is heard on its own. Each pulse has a fixed length in time (it does not
       stretch with the revs: the same bang, only closer together), travels through a header + silencer waveguide and leaves at the
       tailpipe. Airbox, valve train, primary gears, overrun pops and the ignition cut are separate layers on top.
       Crank phase runs 0..1 over the 720 degrees; 0 is the exhaust valve opening, the spark sits at 0.80. */
    class Thumper {
      constructor(sr) {
        this.sr = sr; this.dt = 1 / sr; this.kind = 'single';
        this.rpm = 1900; this.rpmT = 1900; this.thr = 0; this.thrT = 0; this.vol = 0; this.volT = 0; this.pan = 0; this.panT = 0; this.cut = 0; this.pop = 0;
        this.seed = 7654321 + Math.floor(Math.random() * 1e6);
        this.ph = 0.4; this.stage = 1; this.cycle = 0; this.sinceOff = 9; this.unburnt = 0; this.wv = 0; this.heat = 0.2; this.ld = 0.15; this.rv = 0.94;
        this.A = 0; this.Am = 0.08; this.nA = 0; this.nF = 0.15; this.tEx = 1; this.irise = 5000; this.idec = 1000; this.crk = 0;
        this.popT = -1; this.popA = 0; this.popE = 0; this.tkE = 0; this.knE = 0; this.g1 = 0; this.g2 = 0;
        const N = 1024; this.m = N - 1; this.wi = 0; this.aF = new Float32Array(N); this.aB = new Float32Array(N); this.bF = new Float32Array(N); this.bB = new Float32Array(N);
        this.vLP = 0; this.mLP = 0; this.oLP = 0; this.dcE = 0; this.sLP = 0; this.dc = 0; this.lpO = 0; this.hpM = 0;
        this.boomF = new BP(); this.midF = new BP(); this.f1 = new BP(); this.f2 = new BP(); this.raspF = new BP(); this.boxF = new BP(); this.runF = new BP(); this.thF = new BP(); this.tkF = new BP(); this.knF = new BP();
        this.config({});
      }
      rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
      config(c) {
        const sr = this.sr, t = c.tune || {}, g = (k, d) => (t[k] == null ? d : t[k]), k1 = (f) => 1 - Math.exp(-6.2832 * f / sr);
        this.redline = c.redline || 11500; this.idle = c.idle || 1900; this.rough = c.rough == null ? 0.14 : c.rough;
        this.dA = Math.min(480, g('header', 0.00128) * sr); this.dB = Math.min(480, g('silencer', 0.00105) * sr);   // one-way travel times [s]
        this.rj = -g('step', 0.34); this.ro = g('tail', 0.85); this.pack = g('pack', 0.4);                          // area step into the silencer, tailpipe reflection, packing
        this.tau = g('pulse', 0.001); this.crack = g('crack', 0.6); this.jit = g('jitter', 0.00011);                // blow-down length, how hard the pressure front gets under load, pulse-to-pulse timing scatter
        this.boom = g('boom', 0.7); this.bark = g('bark', 1.4); this.rasp = g('rasp', 0.45); this.flat = g('low', 0.35);   // low thump, mid-range bark, tailpipe hiss, how much sub-450 Hz stays
        this.intake = g('intake', 0.7); this.mech = g('mech', 0.7); this.whine = g('whine', 0.012); this.pops = g('pops', 1); this.lump = g('lump', 1);
        this.drive = g('drive', 1.9); this.exh = g('exhaust', 1); this.gain = g('gain', 0.8);
        const fv = sr / (this.dA + this.dB);   // the pipe is weakest at fv/2 and fv, between its own resonances: the thump and a mid fill sit there
        this.boomF.set(g('boomHz', fv * 0.5), 1.3, sr); this.midF.set(fv, 2.5, sr); this.fill = g('fill', 1.6); this.f1.set(g('barkHz', 720), 1.8 * g('barkQ', 1), sr); this.f2.set(g('barkHz', 720) * 1.75, 2.2 * g('barkQ', 1), sr); this.raspF.set(1700, 0.6, sr); this.boxF.set(g('boxHz', 165), 2.2, sr); this.runF.set(g('runnerHz', 560), 2.6, sr); this.thF.set(1500, 0.9, sr);
        this.tkF.set(3300, 3.5, sr); this.knF.set(1250, 2.5, sr);
        this.kR = 1 - Math.exp(-1 / (0.0074 * sr)); this.kT = 1 - Math.exp(-1 / (0.0052 * sr)); this.kL = 1 - Math.exp(-1 / (0.02 * sr)); this.kH = 1 - Math.exp(-1 / (1.3 * sr));
        this.kV = k1(5200); this.kM = k1(1500); this.kO = k1(900); this.kS = k1(g('tiltHz', 450)); this.kDC = k1(22); this.kOut = k1(g('top', 6000));
        this.kPop = Math.exp(-1 / (0.0017 * sr)); this.kTk = Math.exp(-1 / (0.0011 * sr)); this.kKn = Math.exp(-1 / (0.0026 * sr));
        this.kG1 = 29 / (60 * sr); this.kG2 = 16.5 / (60 * sr);   // primary gear mesh (29 teeth on the crank) and cam chain
      }
      /* spark: decide what this cycle burns. Closed throttle at speed leaves too little charge to fire, the mixture goes into the pipe instead. */
      ignite(fill, rn) {
        let im = 1 - (this.rpm - this.idle) / (this.idle * 0.7); im = this.thr > 0.1 || im < 0 ? 0 : im > 1 ? 1 : im;
        this.wv = this.wv * 0.75 + (this.rnd() - 0.5) * 0.06 * this.lump * im;                                    // idle hunts a little
        let A = 0;
        if (this.cut > 0.5 && (this.cycle & 1) === 0) this.unburnt = Math.min(2, this.unburnt + 0.4 + fill);      // limiter / quick-shifter kills the spark
        else if (fill >= 0.12 || this.rnd() * 0.035 < fill - 0.085) {
          A = (0.3 + 0.7 * Math.pow(fill, 0.8)) * (1 + (this.rnd() - 0.5) * 2 * this.rough * (1.5 - fill));
          if (im > 0.5 && this.rnd() < 0.07 * this.lump) A *= 0.55;                                               // the odd weak beat at idle
          if (this.unburnt > 0.3) A *= 1 + 0.3 * Math.min(1, this.unburnt);                                       // first bang after a cut is a fat one
          this.unburnt = 0;
        } else this.unburnt = Math.min(2, this.unburnt + 0.15 + fill);
        this.nA = A; this.nF = fill;
        this.knE += A * (0.2 + 0.8 * fill);                                                                       // combustion knock and piston slap through the cases
      }
      /* exhaust valve opens: launch the pulse; on the overrun unburnt mixture may light up in the pipe */
      evo(frac, rn) {
        const A = this.nA, f = this.nF;
        this.tEx = frac * this.dt - this.rnd() * this.jit;
        this.A = A; this.idec = 1 / (this.tau * (1.25 - 0.45 * f)); this.irise = 1 / (0.00042 - 0.00032 * Math.min(1, f * 1.2)); this.crk = A * f * f * this.crack * 1.6;   // the harder the bang, the steeper its front
        this.Am = 0.07 + 0.05 * rn + A * 0.16;
        if (A === 0 && this.unburnt > 0.3 && this.popT < 0 && this.popE < 0.05) {
          const hot = Math.exp(-this.sinceOff / 0.7), b = (rn - 0.2) / 0.22, band = b < 0 ? 0 : b > 1 ? 1 : b, r = this.rnd();
          if (r < (0.012 + 0.07 * hot) * band * this.pops) { this.popA = 0.7 + this.rnd() * 0.7; this.popT = this.rnd() * 0.004; this.unburnt = 0; }            // bang
          else if (r < (0.1 + 0.22 * hot) * band * this.pops) { this.popA = 0.1 + this.rnd() * 0.28; this.popT = this.rnd() * 0.004; this.unburnt *= 0.3; }   // burble
        }
        if (this.pop > 0) { this.popA = Math.max(this.popA, this.pop * 1.2); this.popT = 0; this.pop = 0; }
      }
      sample() {
        const dt = this.dt, sr = this.sr;
        this.rpm += (this.rpmT - this.rpm) * this.kR; this.thr += (this.thrT - this.thr) * this.kT;
        const thr = this.thr < 0 ? 0 : this.thr > 1 ? 1 : this.thr, rpm = this.rpm < 300 ? 300 : this.rpm, rn = rpm / this.redline;
        if (thr < 0.06) this.sinceOff += dt; else if (thr > 0.4) this.sinceOff = 0;
        // cylinder filling: a small throttle opening fills the cylinder at low revs but not at high revs; idle air is a fixed flow
        const t15 = thr * Math.sqrt(thr), fT = t15 / (t15 + 0.28 * rn * (1 - t15) + 1e-4), fI = Math.min(0.2, 0.13 * this.idle / rpm), fill = fT > fI ? fT : fI;
        this.ld += (fill - this.ld) * this.kL; this.heat += (fill - this.heat) * this.kH;
        const ld = this.ld, nz = this.rnd() * 2 - 1, nz2 = this.rnd() * 2 - 1;

        // ---- crank
        const dph = rpm * (1 + this.wv) / (120 * sr);
        let ph = this.ph + dph;
        if (this.stage === 0 && ph >= 0.3) { this.stage = 1; this.tkE += 0.5 + this.rnd() * 0.5; }               // exhaust valve seats
        else if (this.stage === 1 && ph >= 0.56) { this.stage = 2; this.tkE += 0.6 + this.rnd() * 0.6; }         // intake valve seats
        else if (this.stage === 2 && ph >= 0.8) { this.stage = 3; this.ignite(fill, rn); }
        if (ph >= 1) { ph -= 1; this.stage = 0; this.cycle++; this.evo(ph / dph, rn); }
        this.ph = ph;

        // ---- exhaust: blow-down pulse (fixed in time) + the piston pushing the rest out (fixed in crank angle) + afterfire
        let u = 0; const te = this.tEx;
        if (te > 0) {
          const x = te * this.idec; if (x < 14) u = this.A * (1 - Math.exp(-te * this.irise)) * Math.exp(-x) * 1.25;
          const x2 = te * 7500; if (x2 < 12) u += this.crk * (1 - Math.exp(-te * 40000)) * Math.exp(-x2);                    // shock front: only a hard bang has one
        }
        this.tEx = te + dt;
        if (ph > 0.02 && ph < 0.3) { const s = Math.sin(11.22 * (ph - 0.02)); u += this.Am * s * s; }
        u *= 1 + nz * 0.8 * this.rasp * ld;
        if (this.popT >= 0) { this.popT -= dt; if (this.popT < 0) this.popE = this.popA; }
        if (this.popE > 0.003) { u += this.popE * (0.6 + 0.9 * nz2); this.popE *= this.kPop; }

        // ---- header + silencer as two waveguide sections (hot gas under load shortens the travel times)
        const m = this.m, wi = this.wi, hs = 1.07 - 0.12 * this.heat, dA = this.dA * hs, dB = this.dB * hs, iA = dA | 0, fA = dA - iA, iB = dB | 0, fB = dB - iB;
        const aF = this.aF, aB = this.aB, bF = this.bF, bB = this.bB;
        const aFo = aF[(wi - iA) & m] * (1 - fA) + aF[(wi - iA - 1) & m] * fA, aBo = aB[(wi - iA) & m] * (1 - fA) + aB[(wi - iA - 1) & m] * fA;
        const bFo = bF[(wi - iB) & m] * (1 - fB) + bF[(wi - iB - 1) & m] * fB, bBo = bB[(wi - iB) & m] * (1 - fB) + bB[(wi - iB - 1) & m] * fB;
        this.rv += ((ph < 0.32 ? 0.6 : 0.94) - this.rv) * 0.02;                                                   // an open valve leaks back into the cylinder
        this.vLP += (aBo - this.vLP) * this.kV;
        const r = this.rj; let inB = (1 + r) * aFo - r * bBo;
        this.mLP += (inB - this.mLP) * this.kM; inB = (inB + (this.mLP - inB) * this.pack) * 0.94;                // packing soaks up the top end
        this.oLP += (bFo - this.oLP) * this.kO;
        const back = -this.ro * this.oLP;
        aF[wi] = u + this.rv * this.vLP; aB[wi] = r * aFo + (1 - r) * bBo; bF[wi] = inB; bB[wi] = back; this.wi = (wi + 1) & m;

        // ---- tailpipe: radiated pressure leans towards the rate of change of the flow; jet hiss rides on the flow
        const q = bFo - back;
        this.dcE += (q - this.dcE) * this.kDC; const qh = q - this.dcE;
        this.sLP += (qh - this.sLP) * this.kS;
        let ex = qh - this.sLP * (1 - this.flat) + this.boomF.run(qh) * this.boom + this.midF.run(qh) * this.fill + (this.f1.run(qh) + this.f2.run(qh) * 1.2) * this.bark;
        ex += this.raspF.run(nz) * (q > 0 ? q : -0.3 * q) * this.rasp * (0.5 + 1.5 * ld);
        ex = (Math.tanh(ex * this.drive + 0.12) - 0.1194) * this.exh;

        // ---- intake: the piston gulps once per cycle through runner and airbox; the open throttle lets the roar out
        let inn = 0;
        if (ph > 0.27 && ph < 0.53) { const iq = Math.sin(12.083 * (ph - 0.27)); inn = iq * (nz2 * thr * (0.3 + 0.7 * rn) * 0.8 - 0.25 - 0.75 * ld); }
        inn = (this.boxF.run(inn) + this.runF.run(inn) * 1.3 + this.thF.run(inn) * 0.9) * this.intake * (0.3 + 0.7 * thr);

        // ---- mechanics: valve ticks, knock, gear whine, clatter
        let me = this.tkF.run(nz * this.tkE) * 0.5 + this.knF.run(nz2 * this.knE) * 0.6; this.tkE *= this.kTk; this.knE *= this.kKn;
        this.g1 += rpm * this.kG1; if (this.g1 >= 1) this.g1 -= 1; this.g2 += rpm * this.kG2; if (this.g2 >= 1) this.g2 -= 1;
        const wh = (Math.sin(6.2832 * this.g1) * (0.65 + 0.35 * Math.sin(12.566 * ph + 1)) + 0.5 * Math.sin(6.2832 * this.g2)) * this.whine * rn * (0.35 + 0.65 * ld);
        this.hpM += (nz - this.hpM) * 0.3; me += (nz - this.hpM) * 0.1 * rn;

        let out = ex + inn + me * this.mech + wh;
        this.dc += (out - this.dc) * this.kDC; out -= this.dc;
        this.lpO += (out - this.lpO) * this.kOut;
        return this.lpO * this.gain;
      }
    }

    /* Two to four cylinders on the same model as the single (engine.kind === 'multi'): every cylinder fires its own fixed-length
       pulse into a shared header + silencer, so firing order and uneven intervals are heard as they are. Cylinders can differ a
       little in level (tune.cg) and header length (tune.hd, seconds), which is what makes a V engine sound like two banks.
       The quick-shifter kills the spark completely for a clean gap; at the redline the limiter drops every other cylinder. */
    class Multi extends Thumper {
      constructor(sr) { super(sr); this.kind = 'multi'; }
      config(c) {
        super.config(c);
        const t = c.tune || {}, fire = c.fire && c.fire.length ? c.fire : [0, 0.5], n = fire.length, sr = this.sr, F = () => new Float64Array(n);
        if (this.n !== n) { this.n = n; this.pp = F(); this.st = new Uint8Array(n); this.te = F().fill(1); this.e1 = F(); this.e2 = F(); this.e3 = F(); this.e4 = F(); this.m1 = F(); this.m2 = F(); this.cA = F(); this.cC = F(); this.cM = F().fill(0.05); this.cN = F(); this.cF = F().fill(0.15); }
        this.fire = fire.slice(); this.cg = fire.map((_, k) => (t.cg && t.cg[k] != null ? t.cg[k] : 1)); this.hd = fire.map((_, k) => (t.hd && t.hd[k] != null ? t.hd[k] : 0));
        this.rv = t.valve == null ? 0.8 : t.valve; this.norm = t.norm == null ? 1.7 / (n + 0.7) : t.norm; this.rise = t.rise == null ? 1 : t.rise;
        this.m3 = Math.exp(-7500 / sr); this.sq = 1 / Math.sqrt(n); if (this.im == null) this.im = 0;
        this.kG1 = (t.gearN == null ? 29 : t.gearN) / (60 * sr);
        this.vn = t.vnoise == null ? 0.8 * this.rasp : t.vnoise; this.inz = t.inoise == null ? 0.8 : t.inoise; this.mh = t.hiss == null ? 0.1 : t.hiss;   // noise on the valve flow, in the intake, from the mechanics
        if (t.tickQ != null) this.tkF.set(3300, t.tickQ, sr);
        this.popN = t.popNoise == null ? 0.9 : t.popNoise; this.lim = !!t.ceil;
        // tune.lf: per-cylinder amount of an extra slow, round pulse. Real cylinders differ in their low orders (header lengths, wave tuning),
        // not in the sharp edge of the bang, so the uneven beat lives below ~600 Hz and the top stays clean.
        this.lf = fire.map((_, k) => (t.lf && t.lf[k] != null ? t.lf[k] : 0)); this.hasLf = this.lf.some((v) => v !== 0); this.lfLoad = !!t.lfLoad;   // lfLoad: like cgLoad, the difference only shows under load
        if (this.hasLf && (!this.e5 || this.e5.length !== n)) { this.e5 = F(); this.e6 = F(); this.cL = F(); }
        const lfD = 1 / (t.lfTau == null ? 0.0012 : t.lfTau), lfR = 1 / (t.lfRise == null ? 0.0006 : t.lfRise); this.l5 = lfD; this.l6 = lfD + lfR; this.w5 = 1; this.w6 = 1;
        // tune.lfBand: [fromHz, toHz] makes that extra pulse a band-limited one (no net flow): the cylinders then differ mostly inside that band
        if (t.lfBand) { this.l5 = 6.2832 * t.lfBand[0]; this.l6 = 6.2832 * t.lfBand[1]; this.w5 = this.l5 / (this.l6 - this.l5); this.w6 = this.l6 / (this.l6 - this.l5); }
        this.m5 = Math.exp(-this.l5 / sr); this.m6 = Math.exp(-this.l6 / sr);
        // tune.cliff: [HzLowRevs, HzHighRevs, Q] a resonant low-pass that follows the edgeRev ramp: little above ~1.5 kHz at mid revs, wide open near the redline
        this.cliff = t.cliff || null; if (this.k0 == null) { this.k0 = 1; this.k1 = 0; this.k2 = 0; this.ka1 = 0; this.ka2 = 0; this.kx1 = 0; this.kx2 = 0; this.ky1 = 0; this.ky2 = 0; }
        // tune.eq: [[Hz, dB, Q], ...] peaking bands after the soft clip: the fixed colour of pipe, bodywork and listening position
        this.eq = (t.eq || []).map(([f, db, q]) => { const A = Math.pow(10, db / 40), w = 6.2832 * Math.min(f, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al / A; return { b0: (1 + al * A) / a0, b1: -2 * Math.cos(w) / a0, b2: (1 - al * A) / a0, a2: (1 - al / A) / a0, x1: 0, x2: 0, y1: 0, y2: 0 }; });
        // tune.cgRev / tune.edgeRev: [from, to, floor] as fractions of the redline. Cylinder differences and top-end bite grow from `floor`
        // at `from` to full at `to`: a four gets rougher and sharper the harder it revs.
        // tune.midDip: [Hz, dB, Q] a peaking band that is fully applied below the edgeRev range and fades out towards its top:
        // mellow in the mid revs, wide open near the redline
        this.dip = t.midDip || null; if (this.dp == null) this.dp = { b0: 1, b1: 0, b2: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
        this.cgRev = t.cgRev || null; this.edgeRev = t.edgeRev || null; this.rw = 1; this.ew = 1; this.riseRev = t.riseRev == null ? 0 : t.riseRev;   // riseRev: how much rounder the pulse front is below the edgeRev range
        // tune.bang: every afterfire also gets a dry crack that skips the off-throttle muffling: a sharp broadband snap with a short tail.
        // tune.bangBig / bangSmall scale how often a real bang or a small burble happens (on top of tune.pops).
        this.cutPop = t.cutPop == null ? 1 : t.cutPop; this.limPop = t.limPop == null ? this.cutPop : t.limPop;   // share of the afterfire chance that applies while the spark is cut for a shift / at the limiter
        this.bang = t.bang == null ? 0 : t.bang; this.bigP = t.bangBig == null ? 1 : t.bangBig; this.smallP = t.bangSmall == null ? 1 : t.bangSmall;
        this.kB1 = Math.exp(-1 / ((t.bangMs == null ? 2.2 : t.bangMs) * 0.001 * sr)); this.kB2 = Math.exp(-1 / (0.016 * sr)); if (this.b1 == null) { this.b1 = 0; this.b2 = 0; this.bhp = 0; this.blp = 0; }
        this.bTone = t.bangTone == null ? 1 : t.bangTone; this.kBl = 1 - Math.exp(-6.2832 * (t.bangHz == null ? 900 : t.bangHz) / sr);   // bangTone 1 = bright snap, 0 = dull thud below bangHz
        if (t.popMs != null) this.kPop = Math.exp(-1 / (t.popMs * 0.001 * sr)); this.popBig = t.popBig == null ? 1 : t.popBig;   // popMs: length of the pressure step into the pipe (longer = deeper); popBig: its size for a real bang
        this.dull = t.dullHz == null ? 0 : t.dullHz; this.topHz = t.top == null ? 6000 : t.top; if (this.d1 == null) { this.d1 = 0; this.d2 = 0; }   // muffled off the throttle, opening up with load
        if (t.raspHz != null) this.raspF.set(t.raspHz, 0.6, sr); this.thW = t.throat == null ? 0.9 : t.throat;
        this.soft = t.soft == null ? 0 : t.soft; this.softRev = t.softRev == null ? 0 : t.softRev; this.motor = t.motor == null ? 0 : t.motor; this.cgLoad = !!t.cgLoad;   // longer, rounder pulses at light load (a hum at idle); cylinder differences only under load
        this.lope = t.lope == null ? 0 : t.lope; this.kLope = (t.lopeHz == null ? 1.5 : t.lopeHz) / sr; if (this.lph == null) { this.lph = 0; this.wl = 0; }   // idle that rises and falls in a steady rhythm (hot cam)
        this.aa = !!t.aa; this.c4 = t.crackRise == null ? 47500 : 7500 + t.crackRise; this.m4 = Math.exp(-this.c4 / sr); if (this.x1 == null) { this.x1 = 0; this.F1 = 0; this.o1 = 0; this.G1 = 0; }
        this.edge = t.edge == null ? 0 : t.edge; this.kE = 1 - Math.exp(-6.2832 * (t.edgeHz == null ? 1800 : t.edgeHz) / sr); if (this.eLP == null) this.eLP = 0;   // lifts the upper harmonics of the pulses themselves: bite without hiss
      }
      ignite(k, fill, rn) {
        if (k === 0) { const ramp = (r) => { const x = (rn - r[0]) / (r[1] - r[0]); return r[2] + (1 - r[2]) * (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x)); }; if (this.cgRev) this.rw = ramp(this.cgRev); if (this.edgeRev) this.ew = ramp(this.edgeRev);
          if (this.dip) { const d = this.dip, A = Math.pow(10, d[1] * (1 - this.ew) / 40), w = 6.2832 * Math.min(d[0], this.sr * 0.45) / this.sr, al = Math.sin(w) / (2 * d[2]), a0 = 1 + al / A, q = this.dp; q.b0 = (1 + al * A) / a0; q.b1 = -2 * Math.cos(w) / a0; q.b2 = (1 - al * A) / a0; q.a2 = (1 - al / A) / a0; }
          if (this.cliff) { const c = this.cliff, fc = c[0] * Math.pow(c[1] / c[0], this.ew), w = 6.2832 * Math.min(fc, this.sr * 0.45) / this.sr, cs = Math.cos(w), al = Math.sin(w) / (2 * c[2]), a0 = 1 + al; this.k0 = (1 - cs) / 2 / a0; this.k1 = (1 - cs) / a0; this.k2 = this.k0; this.ka1 = -2 * cs / a0; this.ka2 = (1 - al) / a0; } }
        if (k === 0) { let im = 1 - (this.rpm - this.idle) / (this.idle * 0.7); im = this.thr > 0.1 || im < 0 ? 0 : im > 1 ? 1 : im; this.im = im; this.wv = this.wv * 0.75 + (this.rnd() - 0.5) * 0.06 * this.lump * im; }
        if (this.lope > 0) { this.wl = this.lope * this.im * Math.sin(6.2832 * this.lph); }
        let A = 0; const lim = this.rpmT >= this.redline * 0.985;
        if (this.cut > 0.5 && (!lim || ((this.cycle + k) & 1) === 0)) this.unburnt = Math.min(2, this.unburnt + (0.4 + fill) * this.sq);
        else if (fill >= 0.12 || this.rnd() * 0.035 < fill - 0.085) {
          A = (0.3 + 0.7 * Math.pow(fill, 0.8)) * (1 + (this.rnd() - 0.5) * 2 * this.rough * (1.5 - fill)) * (this.cgLoad ? 1 - (1 - this.cg[k]) * Math.min(1, fill * 1.3) * this.rw : this.cg[k]);
          if (this.lope > 0) A *= 1 + 4 * this.wl;
          if (this.im > 0.5 && this.rnd() < 0.07 * this.lump) A *= 0.55;
          if (this.unburnt > 0.3) A *= 1 + 0.3 * Math.min(1, this.unburnt);
          this.unburnt = 0;
        } else this.unburnt = Math.min(2, this.unburnt + (0.15 + fill) * this.sq);
        this.cN[k] = A; this.cF[k] = fill;
        this.knE += A * (0.2 + 0.8 * fill) * this.sq;
      }
      evo(k, frac, rn) {
        const A0 = this.cN[k], f = this.cF[k], sr = this.sr, te = frac * this.dt - this.rnd() * this.jit - this.hd[k];
        const A = A0 === 0 && this.motor > 0 ? this.motor * (0.4 + 0.6 * rn) : A0;   // tune.motor: an unfired cylinder still blows its compressed air out (engine-braking howl)
        let sw = 1; if (this.softRev > 0) { sw = 1 - (rn - this.idle / this.redline) / this.softRev; sw = sw < 0 ? 0 : sw > 1 ? 1 : sw; }   // tune.softRev: the long idle pulses shorten again over this rev span
        const g = 1 - f, sf = 1 + this.soft * g * g * g * sw, idec = 1 / (this.tau * (1.25 - 0.45 * f) * sf), irise = 1 / ((0.00042 - 0.00032 * Math.min(1, f * 1.2)) * this.rise * sf * (1 + this.riseRev * (1 - this.ew)));
        if (this.hasLf) this.cL[k] = A * this.lf[k] * this.norm * this.rw * (this.lfLoad ? Math.min(1, f * 1.3) : 1);
        this.cA[k] = A * 1.25 * this.norm; this.cC[k] = A * f * f * this.crack * 1.6 * this.norm * this.ew; this.cM[k] = (0.07 + 0.05 * rn + A * 0.16) * this.norm;
        this.m1[k] = Math.exp(-idec / sr); this.m2[k] = Math.exp(-(idec + irise) / sr);
        this.te[k] = te; if (te >= 0) this.fireUp(k, te, idec, irise);   // a later start (scatter, longer header) is picked up in sample()
        if (A0 === 0 && this.unburnt > 0.3 && this.popT < 0 && this.popE < 0.05) {
          const hot = Math.exp(-this.sinceOff / 0.7), b = (rn - 0.2) / 0.22, band = (b < 0 ? 0 : b > 1 ? 1 : b) * this.pops * this.sq * (this.cut > 0.5 ? (this.rpmT >= this.redline * 0.985 ? this.limPop : this.cutPop) : 1), r = this.rnd();
          if (r < (0.012 + 0.07 * hot) * band * this.bigP) { this.popA = (0.7 + this.rnd() * 0.7) * this.popBig; this.popT = this.rnd() * 0.004; this.unburnt = 0; }
          else if (r < ((0.012 + 0.07 * hot) * this.bigP + (0.088 + 0.15 * hot) * this.smallP) * band) { this.popA = 0.1 + this.rnd() * 0.28; this.popT = this.rnd() * 0.004; this.unburnt *= 0.3; }
        }
        if (this.pop > 0) { this.popA = Math.max(this.popA, this.pop * 1.2); this.popT = 0; this.pop = 0; }
      }
      fireUp(k, te, idec, irise) { if (this.hasLf) { this.e5[k] = Math.exp(-te * this.l5); this.e6[k] = Math.exp(-te * this.l6); } this.e1[k] = Math.exp(-te * idec); this.e2[k] = Math.exp(-te * (idec + irise)); this.e3[k] = Math.exp(-te * 7500); this.e4[k] = Math.exp(-te * this.c4); }
      sample() {
        const dt = this.dt, sr = this.sr, n = this.n;
        this.rpm += (this.rpmT - this.rpm) * this.kR; this.thr += (this.thrT - this.thr) * this.kT;
        const thr = this.thr < 0 ? 0 : this.thr > 1 ? 1 : this.thr, rpm = this.rpm < 300 ? 300 : this.rpm, rn = rpm / this.redline;
        if (thr < 0.06) this.sinceOff += dt; else if (thr > 0.4) this.sinceOff = 0;
        const t15 = thr * Math.sqrt(thr), fT = t15 / (t15 + 0.28 * rn * (1 - t15) + 1e-4), fI = Math.min(0.2, 0.13 * this.idle / rpm), fill = fT > fI ? fT : fI;
        this.ld += (fill - this.ld) * this.kL; this.heat += (fill - this.heat) * this.kH;
        const ld = this.ld, nz = this.rnd() * 2 - 1, nz2 = this.rnd() * 2 - 1;

        // ---- crank: every cylinder runs the same cycle, shifted by its place in the firing order
        this.lph += this.kLope; if (this.lph >= 1) this.lph -= 1;
        const aa = this.aa, lfOn = this.hasLf && aa, dph = rpm * (1 + this.wv + this.wl) / (120 * sr), fire = this.fire, pp = this.pp, stg = this.st, tes = this.te, e1 = this.e1, e2 = this.e2, e3 = this.e3, e4 = this.e4;
        let ph = this.ph + dph; if (ph >= 1) { ph -= 1; this.cycle++; } this.ph = ph;
        let u = 0, iq = 0;
        for (let k = 0; k < n; k++) {
          let p = ph - fire[k]; if (p < 0) p += 1;
          const st = stg[k];
          if (aa) {   // bring the running pulse to this sample before a new one may start, so every pulse begins exactly on its curve
            if (tes[k] >= 0) { e1[k] *= this.m1[k]; e2[k] *= this.m2[k]; e3[k] *= this.m3; e4[k] *= this.m4; if (lfOn) { this.e5[k] *= this.m5; this.e6[k] *= this.m6; } }
            else { const te = tes[k] + dt; tes[k] = te; if (te >= 0) this.fireUp(k, te, -Math.log(this.m1[k]) * sr, -Math.log(this.m2[k] / this.m1[k]) * sr); }
          }
          if (p < pp[k]) { stg[k] = 0; this.evo(k, p / dph, rn); }
          else if (st === 0 && p >= 0.3) { stg[k] = 1; this.tkE += (0.5 + this.rnd() * 0.5) * this.sq; }
          else if (st === 1 && p >= 0.56) { stg[k] = 2; this.tkE += (0.6 + this.rnd() * 0.6) * this.sq; }
          else if (st === 2 && p >= 0.8) { stg[k] = 3; this.ignite(k, fill, rn); }
          pp[k] = p;
          if (!aa) {
            if (tes[k] < 0) { const te = tes[k] + dt; tes[k] = te; if (te >= 0) this.fireUp(k, te, -Math.log(this.m1[k]) * sr, -Math.log(this.m2[k] / this.m1[k]) * sr); }
            else { e1[k] *= this.m1[k]; e2[k] *= this.m2[k]; e3[k] *= this.m3; e4[k] *= this.m4; }
          }
          if (tes[k] >= 0) { u += this.cA[k] * (e1[k] - e2[k]) + this.cC[k] * (e3[k] - e4[k]); if (lfOn) u += this.cL[k] * (this.w5 * this.e5[k] - this.w6 * this.e6[k]); }
          if (p > 0.02 && p < 0.3) { const x = (p - 0.02) * 3.5714, s = 4 * x * (1 - x); u += this.cM[k] * s * s; }
          if (p > 0.27 && p < 0.53) { const x = (p - 0.27) * 3.8462; iq += 4 * x * (1 - x); }
        }
        u *= 1 + nz * this.vn * ld;
        if (this.popT >= 0) { this.popT -= dt; if (this.popT < 0) { this.popE = this.popA; if (this.bang > 0) { const a = this.popA * this.bang; this.b1 += a; this.b2 += a * 0.22; } } }
        if (this.popE > 0.003) { u += this.popE * (0.6 + this.popN * nz2); this.popE *= this.kPop; }

        // ---- from here on the same path as the single: waveguide, tailpipe, intake, mechanics
        const m = this.m, wi = this.wi, hs = 1.07 - 0.12 * this.heat, dA = this.dA * hs, dB = this.dB * hs, iA = dA | 0, fA = dA - iA, iB = dB | 0, fB = dB - iB;
        const aF = this.aF, aB = this.aB, bF = this.bF, bB = this.bB;
        const aFo = aF[(wi - iA) & m] * (1 - fA) + aF[(wi - iA - 1) & m] * fA, aBo = aB[(wi - iA) & m] * (1 - fA) + aB[(wi - iA - 1) & m] * fA;
        const bFo = bF[(wi - iB) & m] * (1 - fB) + bF[(wi - iB - 1) & m] * fB, bBo = bB[(wi - iB) & m] * (1 - fB) + bB[(wi - iB - 1) & m] * fB;
        this.vLP += (aBo - this.vLP) * this.kV;
        const r = this.rj; let inB = (1 + r) * aFo - r * bBo;
        this.mLP += (inB - this.mLP) * this.kM; inB = (inB + (this.mLP - inB) * this.pack) * 0.94;
        this.oLP += (bFo - this.oLP) * this.kO;
        const back = -this.ro * this.oLP;
        aF[wi] = u + this.rv * this.vLP; aB[wi] = r * aFo + (1 - r) * bBo; bF[wi] = inB; bB[wi] = back; this.wi = (wi + 1) & m;

        const q = bFo - back;
        this.dcE += (q - this.dcE) * this.kDC; const qh = q - this.dcE;
        this.sLP += (qh - this.sLP) * this.kS;
        let ex = qh - this.sLP * (1 - this.flat) + this.boomF.run(qh) * this.boom + this.midF.run(qh) * this.fill + (this.f1.run(qh) + this.f2.run(qh) * 1.2) * this.bark;
        ex += this.raspF.run(nz) * (q > 0 ? q : -0.3 * q) * this.rasp * (0.5 + 1.5 * ld);
        if (this.aa) {   // the same soft clip, averaged between two samples: its overtones no longer fold back as false tones
          const x = ex * this.drive + 0.12, ax = x < 0 ? -x : x, F = ax + Math.log(1 + Math.exp(-2 * ax)), d = x - this.x1;
          ex = ((d > 1e-5 || d < -1e-5 ? (F - this.F1) / d : Math.tanh(0.5 * (x + this.x1))) - 0.1194) * this.exh; this.x1 = x; this.F1 = F;
        } else ex = (Math.tanh(ex * this.drive + 0.12) - 0.1194) * this.exh;
        this.eLP += (ex - this.eLP) * this.kE; ex += (ex - this.eLP) * this.edge * this.ew;

        let inn = iq * this.norm * (nz2 * thr * (0.3 + 0.7 * rn) * this.inz - 0.25 - 0.75 * ld);
        inn = (this.boxF.run(inn) + this.runF.run(inn) * 1.3 + this.thF.run(inn) * this.thW) * this.intake * (0.3 + 0.7 * thr);

        let me = this.tkF.run(nz * this.tkE) * 0.5 + this.knF.run(nz2 * this.knE) * 0.6; this.tkE *= this.kTk; this.knE *= this.kKn;
        this.g1 += rpm * this.kG1; if (this.g1 >= 1) this.g1 -= 1; this.g2 += rpm * this.kG2; if (this.g2 >= 1) this.g2 -= 1;
        const wh = (Math.sin(6.2832 * this.g1) * (0.65 + 0.35 * Math.sin(12.566 * ph + 1)) + 0.5 * Math.sin(6.2832 * this.g2)) * this.whine * rn * (0.35 + 0.65 * ld);
        this.hpM += (nz - this.hpM) * 0.3; me += (nz - this.hpM) * this.mh * rn;

        let out = ex + inn + me * this.mech + wh;
        this.dc += (out - this.dc) * this.kDC; out -= this.dc;
        if (this.cliff) { const v = this.k0 * out + this.k1 * this.kx1 + this.k2 * this.kx2 - this.ka1 * this.ky1 - this.ka2 * this.ky2; this.kx2 = this.kx1; this.kx1 = out; this.ky2 = this.ky1; this.ky1 = v; out = v; }
        if (this.dull > 0) { const x = 6.2832 * (this.dull + (this.topHz - this.dull) * Math.min(1, 0.85 * ld * Math.sqrt(ld) + 0.15 * rn)) / sr, a = x / (1 + x); this.d1 += (out - this.d1) * a; this.d2 += (this.d1 - this.d2) * a; out = this.d2; }
        if (this.b2 > 0.0005) { this.bhp += (nz2 - this.bhp) * 0.25; this.blp += (nz2 - this.blp) * this.kBl; out += (this.b1 + this.b2) * (this.bTone * (0.45 * nz2 + 0.9 * (nz2 - this.bhp)) + (1 - this.bTone) * 3 * this.blp); this.b1 *= this.kB1; this.b2 *= this.kB2; }
        this.lpO += (out - this.lpO) * this.kOut;
        let y0 = this.lpO; const eq = this.eq;
        for (let b = 0; b < eq.length; b++) { const q = eq[b], v = q.b0 * y0 + q.b1 * q.x1 + q.b2 * q.x2 - q.b1 * q.y1 - q.a2 * q.y2; q.x2 = q.x1; q.x1 = y0; q.y2 = q.y1; q.y1 = v; y0 = v; }
        if (this.dip) { const q = this.dp, v = q.b0 * y0 + q.b1 * q.x1 + q.b2 * q.x2 - q.b1 * q.y1 - q.a2 * q.y2; q.x2 = q.x1; q.x1 = y0; q.y2 = q.y1; q.y1 = v; y0 = v; }
        const o = y0 * this.gain, a = o < 0 ? -o : o;   // tune.ceil: soft ceiling for pops and the sharpest edges
        if (!this.lim) return o;
        if (!this.aa) { if (a <= 0.7) return o; const y = 0.7 + 0.25 * Math.tanh((a - 0.7) * 4); return o < 0 ? -y : y; }
        let G; if (a <= 0.7) G = 0.5 * a * a; else { const v = 4 * (a - 0.7); G = 0.245 + 0.7 * (a - 0.7) + 0.0625 * (v + Math.log(1 + Math.exp(-2 * v)) - 0.6931472); }
        const d = o - this.o1, mid = 0.5 * (o + this.o1), am = mid < 0 ? -mid : mid;
        const y = d > 1e-5 || d < -1e-5 ? (G - this.G1) / d : am <= 0.7 ? mid : (mid < 0 ? -1 : 1) * (0.7 + 0.25 * Math.tanh((am - 0.7) * 4));
        this.o1 = o; this.G1 = G; return y;
      }
    }

    class EngineSynth {
      constructor(sr, nVoices) { this.sr = sr; this.v = []; for (let i = 0; i < (nVoices || 4); i++) this.v.push(new Voice(sr)); }
      message(m) {
        if (m.t === 'cfg') {
          const kind = m.kind || '', old = this.v[m.i];
          if (kind !== (old.kind || '')) { const v = this.v[m.i] = kind === 'single' ? new Thumper(this.sr) : kind === 'multi' ? new Multi(this.sr) : new Voice(this.sr); v.vol = old.vol; v.volT = old.volT; v.pan = old.pan; v.panT = old.panT; v.rpm = v.rpmT = old.rpmT; }
          this.v[m.i].config(m);
        }
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
    constructor() { this.ctx = null; this.ready = false; this.muted = false; this.classic = false; this.volume = 0.8; this.voiceSpec = [null, null, null, null]; this.pending = []; this.popCool = 0; this.duck = 1; }

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
      // tyre roar on asphalt, a soft mountain wind bed, and an echo send for rock walls / retaining walls
      this.roll = layer('lowpass', 260, 0.9); this.amb = layer('lowpass', 420, 0.5); this.amb2 = layer('bandpass', 1400, 0.4);
      this.crowd2 = layer('bandpass', 1900, 0.9); this.water = layer('bandpass', 1100, 0.35); this.water2 = layer('lowpass', 380, 0.6);
      this.echo = ctx.createDelay(0.5); this.echo.delayTime.value = 0.075; this.echoFb = ctx.createGain(); this.echoFb.gain.value = 0.28; this.echoWet = ctx.createGain(); this.echoWet.gain.value = 0;
      const echoLp = ctx.createBiquadFilter(); echoLp.type = 'lowpass'; echoLp.frequency.value = 2400;
      this.engBus.connect(this.echo); this.echo.connect(echoLp); echoLp.connect(this.echoFb); this.echoFb.connect(this.echo); echoLp.connect(this.echoWet); this.echoWet.connect(this.master);
      this.birdT = 2 + Math.random() * 3; this.bellT = 6 + Math.random() * 8; this.cheerT = 0;
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
      const key = spec.id + (this.classic ? '|classic' : ''); if (this.voiceSpec[i] === key) return; this.voiceSpec[i] = key;
      const e = spec.engine, m = e.multi && !this.classic ? e.multi : null;   // this.classic = true plays every bike with its original voice
      this.post({ t: 'cfg', i, fire: m ? m.fire : e.fire, rough: m ? m.rough : e.rough, pipe: e.pipe, bright: e.bright, body: e.body, redline: spec.redline, kind: m ? 'multi' : e.kind, tune: m ? m.tune : e.tune, idle: spec.idle });
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
      const cr = clamp(s.crowd || 0, 0, 1);
      set(this.crowd.g.gain, cr * 0.07 + cr * sp * 0.08, 0.4); set(this.crowd2.g.gain, cr * cr * sp * 0.05, 0.3);
      // rolling tyres, mountain air, echo off nearby walls
      set(this.roll.g.gain, clamp(sp * 1.4, 0, 1) * 0.11 * (s.surf ? 0.4 : 1)); set(this.roll.f.frequency, 160 + sp * 380);
      const wv = clamp(s.water || 0, 0, 1); set(this.water.g.gain, wv * wv * 0.09, 0.3); set(this.water2.g.gain, wv * wv * 0.07, 0.3); set(this.water.f.frequency, 900 + 300 * Math.sin(t * 2.3) * Math.sin(t * 0.7), 0.1);
      const env = s.ambient == null ? 0 : s.ambient; set(this.amb.g.gain, env * (0.035 + 0.02 * Math.sin(t * 0.37) * Math.sin(t * 0.13)), 0.8); set(this.amb2.g.gain, env * 0.008 * (1 + Math.sin(t * 0.21)), 0.8);
      set(this.echoWet.gain, clamp(s.wall || 0, 0, 1) * 0.42, 0.12); set(this.echo.delayTime, 0.045 + (1 - clamp(s.wall || 0, 0, 1)) * 0.06, 0.2);
      // occasional birds (in the forest) and cowbells (on the meadows), quiet so the engine stays in front
      if (env > 0) {
        this.birdT -= dt; this.bellT -= dt;
        if (this.birdT < 0) { this.birdT = 1.5 + Math.random() * 5; if ((s.forest || 0) > Math.random()) this.bird(env); }
        if (this.bellT < 0) { this.bellT = 4 + Math.random() * 9; if ((s.meadow || 0) > Math.random()) this.cowbell(env); }
      }
      // cheer when the player flashes past a crowd
      this.cheerT -= dt; if (cr > 0.45 && sp > 0.35 && this.cheerT < 0) { this.cheerT = 2.5 + Math.random() * 2; this.burst(1.4, 1300, 2200, 0.05 * cr, 0.7); this.burst(1.1, 900, 1600, 0.04 * cr, 0.9); }
    }
    bird(k) {
      if (!this.ctx) return; const t0 = this.ctx.currentTime, n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1800, pan = this.ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(this.fxBus); pan.connect(this.rev);
      for (let i = 0; i < n; i++) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(), ts = t0 + i * (0.09 + Math.random() * 0.05), d = 0.05 + Math.random() * 0.05;
        o.type = 'sine'; o.frequency.setValueAtTime(base * (1 + Math.random() * 0.15), ts); o.frequency.exponentialRampToValueAtTime(base * (0.75 + Math.random() * 0.5), ts + d);
        g.gain.setValueAtTime(0, ts); g.gain.linearRampToValueAtTime(0.012 * k, ts + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, ts + d);
        o.connect(g); g.connect(pan); o.start(ts); o.stop(ts + d + 0.02);
      }
    }
    cowbell(k) {
      if (!this.ctx) return; const t0 = this.ctx.currentTime, pan = this.ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.4 - 0.7; pan.connect(this.fxBus); pan.connect(this.rev);
      const hits = 1 + Math.floor(Math.random() * 3), f = 520 + Math.random() * 180;
      for (let h = 0; h < hits; h++) {
        const ts = t0 + h * (0.35 + Math.random() * 0.3);
        for (const [mul, amp] of [[1, 1], [2.4, 0.55], [3.9, 0.3], [5.3, 0.15]]) {      // inharmonic partials of a bell
          const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'sine'; o.frequency.value = f * mul;
          g.gain.setValueAtTime(0, ts); g.gain.linearRampToValueAtTime(0.009 * amp * k, ts + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.9 / mul + 0.25);
          o.connect(g); g.connect(pan); o.start(ts); o.stop(ts + 1.3);
        }
      }
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
