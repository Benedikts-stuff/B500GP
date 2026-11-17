/* APEX — motorcycle physics.
   Top-down "sim-cade" single-track model:
     · steering commands a lean angle, the lean has to build (roll lag) and produces the turn
     · one friction circle per tyre: throttle eats rear side-grip (powerslide), brakes eat front side-grip (push)
     · pitch dynamics about the tyre contact patches give wheelies and stoppies from the real force balance
   No rendering in here. */
(function (root) {
  'use strict';
  const AX = root.AX;
  const { clamp, lerp, damp, smoothstep, approach, G, SURF, SURF_DATA } = AX;
  const DEG = Math.PI / 180;

  AX.ASSISTS = {
    easy:  { id: 'easy',  tc: 1.04, wc: 0.02, wcSettle: 0.01, wcHold: 0.42, slide: 0.45, abs: true,  stop: 0.0,  leanLimit: true,  highside: false, steerHelp: 1 },
    sport: { id: 'sport', tc: 1.14, wc: 0.05, wcSettle: 0.03, wcHold: 0.52, slide: 1, abs: true,  stop: 0.09, leanLimit: true,  highside: false, steerHelp: 0.5 },
    pro:   { id: 'pro',   tc: 0,    wc: 0.6,  wcSettle: 0.5,  wcHold: 1.5,    slide: 1, abs: false, stop: -1,   leanLimit: false, highside: true,  steerHelp: 0 }
  };

  class Bike {
    constructor(spec, track, opts) {
      opts = opts || {};
      this.spec = spec; this.track = track;
      this.assist = opts.assist || AX.ASSISTS.sport;
      this.isPlayer = !!opts.isPlayer;
      this.rider = opts.rider || AX.RIDERS[0];
      this.gripScale = opts.gripScale || 1;
      this.powerScale = opts.powerScale || 1;
      let pk = 0; for (let n = 0.3; n <= 1.0; n += 0.01) pk = Math.max(pk, AX.torqueAt(spec, n) * n);
      this.thrustK = spec.power * 1000 / (spec.mass * pk);
      const top = Math.min(spec.dragTop, spec.gears[5] * 0.985);
      const nTop = top / spec.gears[5];
      this.kDrag = (this.thrustK * AX.torqueAt(spec, nTop) / spec.gears[5] - 0.25) / (top * top);
      this.aWheelie0 = G * spec.cgB / spec.cgH;
      this.aStoppie0 = G * (spec.wheelbase - spec.cgB) / spec.cgH;
      this.fx = {};
      this.onLap = null; this.onCrash = null;
      this.reset(0, 0, 0, 0);
    }

    reset(x, z, yaw, idx) {
      this.x = x; this.z = z; this.yaw = yaw; this.vx = 0; this.vz = 0;
      this.lean = 0; this.leanVel = 0; this.pitch = 0; this.pitchVel = 0;
      this.steer = 0; this.throttle = 0; this.brake = 0;
      this.gear = 0; this.rpm = this.spec.idle; this.shiftT = 0; this.shiftDir = 0; this.limiter = false;
      this.speed = 0; this.vf = 0; this.vl = 0; this.omega = 0; this.slipAngle = 0;
      this.aLong = 0; this.aLat = 0; this.spin = 0; this.util = 0;
      this.idx = idx != null && idx >= 0 ? idx : this.track.nearest(x, z, -1);
      this.d = this.track.lateral(this.idx, x, z);
      this.surf = SURF.ROAD;
      this.y = this.track.heightAt(this.idx, this.track.along(this.idx, x, z));
      this.sPrev = this.idx * this.track.ds + this.track.along(this.idx, x, z);
      this.prog = 0; this.lap = 0; this.lapStartT = 0; this.time = 0; this.lastLap = 0; this.bestLap = 0;
      this.crashed = false; this.crashT = 0; this.crashType = ''; this.ghostT = 0;
      this.wheelieT = 0; this.wheelieAir = 0; this.wheelieKey = false; this.aFull = 0; this.latFrac = 0; this.Gr = 15; this.slope = 0; this.hang = 0; this.fb = 0; this.hangIn = 0; this.mark = 0; this.offT = 0; this.thrHist = 0; this.tuckT = 0;
      this.finished = false; this.finishTime = 0;
      this.rd = { x, z, vx: 0, vz: 0, rot: 0, rotV: 0, h: 0, vh: 0 };
      this._clearFx();
    }
    _clearFx() {
      const f = this.fx;
      f.rearSkid = 0; f.frontSkid = 0; f.squeal = 0; f.landing = 0; f.scrape = 0; f.shift = 0;
      f.backfire = 0; f.kerb = 0; f.wallHit = 0; f.crashStart = false; f.respawn = false;
    }

    /* place on the grid, progress measured from the start line */
    placeOnGrid(slot) {
      const g = this.track.gridSlot(slot);
      this.reset(g[0], g[1], g[2], g[3]);
      this.prog = this.track.open ? this.sPrev - this.track.startIdx * this.track.ds : -(this.track.length - this.sPrev);
      this.lap = -1;
    }

    crash(type) {
      if (this.crashed) return;
      this.crashed = true; this.crashT = 0; this.crashType = type;
      const side = this.lean !== 0 ? Math.sign(this.lean) : (Math.random() < 0.5 ? -1 : 1);
      this.crashSide = type === 'highside' ? -side : side;
      const fxv = Math.cos(this.yaw), fzv = Math.sin(this.yaw);
      const rd = this.rd; rd.x = this.x; rd.z = this.z;
      const kick = type === 'highside' ? 4.5 : type === 'loop' ? -3 : 1.2;
      rd.vx = this.vx * 0.98 + (-fzv) * this.crashSide * kick + fxv * (type === 'stoppie' ? 3 : 0);
      rd.vz = this.vz * 0.98 + (fxv) * this.crashSide * kick + fzv * (type === 'stoppie' ? 3 : 0);
      rd.rot = 0; rd.rotV = (4 + this.speed * 0.12) * this.crashSide; rd.h = 0.4;
      rd.vh = type === 'highside' ? 5.5 : type === 'stoppie' ? 4 : 1.2;
      this.crashYawV = clamp(this.omega * 1.6 + this.crashSide * 0.8, -5, 5);
      this.throttle = 0; this.brake = 0; this.spin = 0;
      this.fx.crashStart = true;
      if (this.onCrash) this.onCrash(this, type);
    }

    respawn() {
      const t = this.track;
      this.idx = t.nearest(this.x, this.z, this.idx);
      const lim = t.hw - 2.2;
      const d = clamp(t.lateral(this.idx, this.x, this.z), -lim, lim);
      this.x = t.px[this.idx] + t.nx[this.idx] * d; this.z = t.pz[this.idx] + t.nz[this.idx] * d;
      this.yaw = t.yaw[this.idx]; this.vx = Math.cos(this.yaw) * 3; this.vz = Math.sin(this.yaw) * 3;
      this.lean = 0; this.leanVel = 0; this.pitch = 0; this.pitchVel = 0; this.steer = 0;
      this.gear = 0; this.rpm = this.spec.idle * 2; this.shiftT = 0;
      this.crashed = false; this.ghostT = 2.2; this.offT = 0;
      this.fx.respawn = true;
    }

    step(dt, inp) {
      this._clearFx();
      this.time += dt;
      if (this.ghostT > 0) this.ghostT -= dt;
      if (this.crashed) { this._stepCrash(dt); this._progress(); return; }
      const spec = this.spec, as = this.assist, t = this.track, f = this.fx;

      // ---- inputs
      if (inp.analog) {
        this.steer = damp(this.steer, inp.steer, 18, dt);
        this.throttle = damp(this.throttle, inp.throttle, 22, dt);
        this.brake = damp(this.brake, inp.brake, 26, dt);
      } else {
        const sv = this.speed;
        const up = lerp(3.6, 2.5, smoothstep(20, 65, sv)) * (1 + 0.0 * as.steerHelp);
        const tgt = inp.steer;
        const rate = (tgt === 0 || Math.sign(tgt) !== Math.sign(this.steer)) && this.steer !== 0 ? 5.0 : up;
        this.steer = approach(this.steer, tgt, rate, rate, dt);
        this.throttle = approach(this.throttle, inp.throttle, 5.5, 11, dt);
        this.brake = approach(this.brake, inp.brake, 7.5, 13, dt);
      }

      const fxv = Math.cos(this.yaw), fzv = Math.sin(this.yaw), rx = -fzv, rz = fxv;
      let vf = this.vx * fxv + this.vz * fzv, vl = this.vx * rx + this.vz * rz;

      // ---- where are we
      this.idx = t.nearest(this.x, this.z, this.idx);
      this.d = t.lateral(this.idx, this.x, this.z);
      this.surf = t.surfaceAt(this.idx, this.d);
      const sd = SURF_DATA[this.surf];
      const Gr = spec.mu * G * sd.grip * this.gripScale;
      // ---- rider body weight: hanging off to the inside of a turn means more grip and more lean available,
      //      hanging to the outside costs grip. Weight forward/back moves the centre of mass along the bike.
      this.hang = approach(this.hang, clamp(inp.bodyX || 0, -1, 1), 3.6, 3.6, dt);
      this.fb = approach(this.fb, clamp(inp.bodyY || 0, -1, 1), 4.5, 4.5, dt);
      const turnDir = Math.abs(this.lean) > 0.05 ? Math.sign(this.lean) : Math.sign(this.steer);
      const hi = this.hangIn = clamp(this.hang * turnDir, -1, 1);
      const gripMul = 1 + 0.14 * Math.max(0, hi) - 0.2 * Math.max(0, -hi);
      const GrL = Gr * gripMul;                                      // lateral grip
      const cgB = spec.cgB + 0.11 * this.fb;                        // weight forward (+) / back (-)
      if (this.surf === SURF.GRASS || this.surf === SURF.GRAVEL) this.offT += dt; else this.offT = 0;
      if (this.surf === SURF.KERB) f.kerb = clamp(vf / 25, 0, 1);

      // ---- lean + yaw
      const frontUp = this.pitch > 0.045; const frontLight = smoothstep(0.05, 0.3, this.pitch);
      let lm = (spec.maxLean + 7 * Math.max(0, hi)) * DEG * smoothstep(0.8, 8.5, vf);
      if (as.leanLimit) lm = Math.min(lm, Math.atan(0.985 * GrL / G));
      const leanT = this.steer * lm;
      let wn = spec.leanRate * lerp(1, 0.72, smoothstep(25, 72, vf));
      wn *= 1 - 0.55 * frontLight;
      const zeta = 0.86;
      this.leanVel += (wn * wn * (leanT - this.lean) - 2 * zeta * wn * this.leanVel) * dt;
      this.lean += this.leanVel * dt;
      const omLean = G * Math.tan(this.lean) / Math.max(vf, 6);
      const omLow = this.steer * 2.3 * clamp(vf / 3, 0, 1);
      let omega = lerp(omLow, omLean, smoothstep(2.5, 8.5, vf));
      omega *= 1 - 0.5 * frontLight;
      let ayDem = vf * omega;

      // ---- gearbox + engine
      const gears = spec.gears; const vr = Math.max(vf, 0);
      if (this.shiftT > 0) this.shiftT -= dt;
      let n = vr / gears[this.gear];
      if (this.shiftT <= 0) {
        if (n > 0.972 && this.gear < 5 && this.throttle > 0.15) { this.gear++; this.shiftT = 0.06; this.shiftDir = 1; f.shift = 1; n = vr / gears[this.gear]; }
        else if (this.gear > 0) {
          const nDown = vr / gears[this.gear - 1];
          const thr = this.brake > 0.2 ? 0.88 : (this.throttle > 0.6 ? 0.66 : 0.74);
          if (nDown < thr) { this.gear--; this.shiftT = 0.1; this.shiftDir = -1; f.shift = -1; n = nDown; }
        }
      }
      // slipping clutch from a standstill in first
      let nEff = n;
      if (this.gear === 0) { const slip = (spec.idle / spec.redline) + this.throttle * 0.46; if (nEff < slip) nEff = slip; }
      this.limiter = n >= 1.0 && this.throttle > 0.3;
      let aDem = 0;
      if (this.shiftT <= 0 || this.shiftDir < 0) {
        const tq = this.limiter ? 0 : AX.torqueAt(spec, nEff);
        this.aFull = this.thrustK * this.powerScale * tq / gears[this.gear];
        aDem = this.aFull * this.throttle;
      }
      const engBrake = (1 - this.throttle) * (0.7 + 2.3 * n) * (vf > 1 ? 1 : 0);

      // ---- wheelie control (assist) and traction control
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const bEff = cgB * cp - spec.cgH * sp, hEff = spec.cgH * cp + cgB * sp;
      const aeroHold = (spec.style.winglets ? 0.0011 : 0.0006) * vf * vf;
      const aBal = G * bEff / hEff + aeroHold;
      if (as.wc > 0 && this.throttle > 0) {
        const back = smoothstep(0.3, 0.9, -this.fb);   // weight back = rider asks for the wheelie
        const tp = lerp(lerp(as.wc, as.wcSettle, smoothstep(0.25, 1.3, this.wheelieAir)), as.wcHold, back);
        const lim = aBal + 56 * (tp - this.pitch) - 17 * this.pitchVel;
        if (aDem > lim) aDem = Math.max(0, lim);
      }
      const Kx = 0.98;
      // clutch-up: a deliberate wheelie kick
      // snapping the weight back with the throttle open pops the front up (a clutch-up kick)
      const wantUp = this.fb < -0.55;
      if (wantUp && !this.wheelieKey && this.throttle > 0.4 && this.pitch < 0.12 && vf > 3 && this.aFull > aBal * 0.62 && Math.abs(this.lean) < 0.5) this.pitchVel += 1.9;
      this.wheelieKey = wantUp;
      const latFrac = Math.min(1, Math.abs(ayDem) / GrL);
      this.latFrac = latFrac; this.Gr = GrL;
      if (as.tc > 0) {
        const lim = Gr * Kx * Math.sqrt(Math.max(0, as.tc * as.tc - latFrac * latFrac));
        if (aDem > lim) aDem = lim;
      }
      let aDrive = Math.min(aDem, Gr * Kx);
      const overDrive = aDem - aDrive;

      // ---- brakes
      let aBrk = this.brake * spec.brake;
      const q = Math.max(0, -this.pitch);
      if (as.abs) {
        const cq = Math.cos(q), sq = Math.sin(q);
        const bf = (spec.wheelbase - cgB) * cq - spec.cgH * sq, hf = spec.cgH * cq + (spec.wheelbase - cgB) * sq;
        const lim = G * bf / hf + 56 * (as.stop - q) + 17 * this.pitchVel;
        if (aBrk > lim) aBrk = Math.max(0, lim);
        const circ = GrL * Math.sqrt(Math.max(0.02, 1 - latFrac * latFrac));
        if (aBrk > circ) aBrk = Math.max(circ, Math.min(aBrk, Gr * 0.22));
      }
      let frontLock = false;
      if (aBrk > Gr) { aBrk = Gr * 0.86; frontLock = true; }
      if (vf < 0.4) aBrk = Math.min(aBrk, vf / dt * 0.5);

      // ---- side grip left over
      let capY;
      if (aBrk > 0.4) {
        capY = GrL * Math.sqrt(Math.max(0.03, 1 - (aBrk / Gr) * (aBrk / Gr)));
        if (Math.abs(ayDem) > capY) {             // front pushes wide; a little of it turns into the rear stepping out
          const ratio = capY / Math.abs(ayDem);
          omega *= lerp(1, ratio, 0.72); ayDem = vf * omega;
          f.frontSkid = clamp((1 / ratio - 1) * 2.2, 0, 1);
          if (!as.abs && (frontLock || ratio < 0.72) && Math.abs(this.lean) > 0.42 && vf > 9) { this.tuckT += dt; if (this.tuckT > 0.22) return this.crash('lowside'); }
        } else this.tuckT = 0;
      } else {
        this.tuckT = 0;
        capY = GrL * Math.sqrt(Math.max(0.03, 1 - (aDrive / (Gr * Kx)) * (aDrive / (Gr * Kx))));
      }
      const uRear = Math.hypot(aDrive / (Gr * Kx), ayDem / GrL) + overDrive / (Gr * 0.8);
      this.util = aBrk > 0.4 ? Math.hypot(aBrk / Gr, ayDem / GrL) : uRear;
      const spinT = this.throttle > 0.2 ? clamp((uRear - 1.0) * 2.4, 0, 1) : 0;
      this.spin = damp(this.spin, spinT, spinT > this.spin ? 14 : 6, dt);

      // ---- the rear steps out under power (and a little on the brakes), the chassis' own stability pulls it back
      const turnSign = Math.abs(ayDem) > 0.5 ? Math.sign(ayDem) : 0;
      let stepOut = 2.2 * Math.max(0, Math.min(uRear, 1.9) - 1) * (this.throttle > 0.2 ? 1 : 0);
      if (aBrk > 0.4) stepOut = 0.55 * (aBrk / spec.brake) * latFrac;
      omega += turnSign * stepOut * as.slide * smoothstep(5, 12, vf) - 2.0 * this.slipAngle * smoothstep(3, 8, vf);

      // ---- integrate
      const tau = 0.075;
      const aT = clamp(-vl / tau, -capY, capY);
      const drag = this.kDrag * vf * vf * (1 - 0.07 * Math.max(0, this.fb) * (1 - Math.min(1, Math.abs(this.steer) * 2))) + (vf > 0.3 ? 0.25 + sd.drag + sd.dragV * vf : 0) + Math.abs(aT) * 0.012 * Math.min(1, Math.abs(this.slipAngle) * 6);
      // gravity along the slope (grade along the bike's heading)
      this.slope = t.gr ? t.gr[this.idx] * (fxv * t.tx[this.idx] + fzv * t.tz[this.idx]) : 0;
      const aLong = aDrive - aBrk - engBrake - drag - G * this.slope;
      this.vx += (fxv * aLong + rx * aT) * dt; this.vz += (fzv * aLong + rz * aT) * dt;
      this.yaw += omega * dt; this.omega = omega;
      this.x += this.vx * dt; this.z += this.vz * dt;
      vf = this.vx * fxv + this.vz * fzv; vl = this.vx * rx + this.vz * rz;
      if (vf < 0 && this.throttle < 0.05) { this.vx -= fxv * vf; this.vz -= fzv * vf; vf = 0; }
      this.vf = vf; this.vl = vl; this.speed = Math.hypot(this.vx, this.vz);
      this.aLong = aLong; this.aLat = aT;
      this.slipAngle = vf > 2 ? Math.atan2(-vl, vf) : 0;   // + = sliding with the rear stepping out to the left

      // ---- pitch: wheelie about the rear contact, stoppie about the front
      const J = 0.95; const aNet = aDrive - aBrk - engBrake;
      if (this.pitch > 0 || this.pitchVel > 0 || aNet > aBal) {
        this.pitchVel += ((aNet - aBal) * hEff / J - 0.6 * this.pitchVel) * dt;
        this.pitch += this.pitchVel * dt;
        if (this.pitch <= 0) { f.landing = clamp(-this.pitchVel / 2.2, 0, 1); this.pitch = 0; this.pitchVel = 0; }
      } else if (this.pitch < 0 || -aNet > G * (spec.wheelbase - cgB) / spec.cgH) {
        const cq = Math.cos(q), sq = Math.sin(q);
        const bf = (spec.wheelbase - cgB) * cq - spec.cgH * sq, hf = spec.cgH * cq + (spec.wheelbase - cgB) * sq;
        this.pitchVel -= ((-aNet - G * bf / hf) * hf / J + 0.6 * this.pitchVel) * dt;
        this.pitch += this.pitchVel * dt;
        if (this.pitch >= 0) { f.landing = clamp(this.pitchVel / 3, 0, 0.6); this.pitch = 0; this.pitchVel = 0; }
        if (this.pitch < -0.95) return this.crash('stoppie');
      }
      if (this.pitch > 0.03) { this.wheelieAir += dt; this.wheelieT += dt; } else { this.wheelieAir = 0; this.wheelieT = 0; }
      if (this.pitch > 1.22) return this.crash('loop');

      // ---- rpm for display + sound
      const nShow = Math.max(nEff, spec.idle / spec.redline) * (1 + this.spin * 0.22);
      let rpmT = Math.min(nShow, 1.03) * spec.redline;
      if (this.limiter) rpmT = spec.redline * (0.985 + 0.02 * Math.sin(this.time * 70));
      this.rpm = damp(this.rpm, rpmT, this.shiftT > 0 ? 30 : 22, dt);
      if (this.thrHist > 0.75 && this.throttle < 0.12 && n > 0.62) f.backfire = clamp(n, 0, 1);
      this.thrPrev2 = this.thrHist; this.thrHist = damp(this.thrHist, this.throttle, 9, dt);

      // ---- slide limits
      const sa = Math.abs(this.slipAngle);
      if (vf > 7 && sa > 0.62) return this.crash('lowside');
      if (as.highside && vf > 12 && sa > 0.27 && this.thrPrev2 > 0.55 && this.throttle < 0.12) return this.crash('highside');
      if (!as.leanLimit && vf > 8 && Math.abs(Math.tan(this.lean)) * G > GrL * 1.18 && sa > 0.2) return this.crash('lowside');

      // ---- marks, squeal
      const driveSkid = this.throttle > 0.35 ? clamp((uRear - 0.9) / 0.22, 0, 1) : 0;
      const brakeSkid = aBrk > 0.4 ? clamp(sa * 5, 0, 1) : 0;
      f.rearSkid = this.pitch < -0.02 ? 0 : clamp(Math.max(driveSkid, brakeSkid, sa * 4.5 - 0.15), 0, 1) * (vf > 3 ? 1 : this.spin);
      // rubber laid down: wheelspin, power at the edge of grip, or the rear stepping out
      const markT = this.pitch < -0.02 ? 0 : clamp(Math.max(this.spin * 1.6, this.throttle > 0.25 ? (uRear - 0.84) / 0.16 : 0, (sa - 0.035) * 9, brakeSkid), 0, 1);
      this.mark = damp(this.mark, markT, markT > this.mark ? 30 : 8, dt);
      if (frontUp) f.frontSkid = 0;
      f.squeal = clamp(Math.max(f.rearSkid * 0.8, f.frontSkid, (this.util - 0.95) * 3), 0, 1) * (this.surf <= SURF.KERB || this.surf === SURF.RUNOFF ? 1 : 0);

      // ---- barriers
      const side = this.d < 0 ? 0 : 1, sg = side ? 1 : -1;
      const lim = t.bar[side][this.idx] - 0.6;
      if (Math.abs(this.d) > lim) {
        const nx = t.nx[this.idx] * sg, nz = t.nz[this.idx] * sg;
        const pen = Math.abs(this.d) - lim; this.x -= nx * pen; this.z -= nz * pen;
        const vn = this.vx * nx + this.vz * nz;
        if (vn > 0) {
          const soft = t.barType[side][this.idx] === 1 ? 1.25 : 1;
          if (vn > 5.2 * soft) { f.wallHit = clamp(vn / 12, 0.3, 1); this.vx -= nx * vn * 1.3; this.vz -= nz * vn * 1.3; this.vx *= 0.55; this.vz *= 0.55; return this.crash('wall'); }
          this.vx -= nx * vn * 1.25; this.vz -= nz * vn * 1.25;
          const loss = 1 - clamp(vn / 9, 0.02, 0.4); this.vx *= loss; this.vz *= loss;
          f.wallHit = clamp(vn / 12, 0.05, 1); f.scrape = 1;
          // straighten along the barrier
          const ty = t.yaw[this.idx]; this.yaw += AX.wrapAngle(ty - this.yaw) * 0.25; this.lean *= 0.7;
        }
      }
      this._endOfRoad();
      this.y = t.heightAt(this.idx, t.along(this.idx, this.x, this.z));
      this._progress();
    }
    _endOfRoad() {
      const t = this.track; if (!t.open) return;
      const a = t.along(this.idx, this.x, this.z);
      for (const [i, sg] of [[t.n - 1, 1], [0, -1]]) {
        if (this.idx !== i || a * sg <= 0) continue;
        this.x -= t.tx[i] * a; this.z -= t.tz[i] * a;
        const vt = this.vx * t.tx[i] + this.vz * t.tz[i];
        if (vt * sg > 0) { this.vx -= t.tx[i] * vt * 1.4; this.vz -= t.tz[i] * vt * 1.4; this.fx.wallHit = Math.min(1, Math.abs(vt) / 12); }
      }
    }

    _stepCrash(dt) {
      const t = this.track, f = this.fx;
      this.crashT += dt;
      this.idx = t.nearest(this.x, this.z, this.idx);
      this.d = t.lateral(this.idx, this.x, this.z);
      this.surf = t.surfaceAt(this.idx, this.d);
      const dec = this.surf === SURF.GRAVEL ? 15 : this.surf === SURF.GRASS ? 8 : 7.2;
      let sp = Math.hypot(this.vx, this.vz);
      if (sp > 0.01) { const ns = Math.max(0, sp - dec * dt); this.vx *= ns / sp; this.vz *= ns / sp; sp = ns; }
      this.x += this.vx * dt; this.z += this.vz * dt;
      this.yaw += this.crashYawV * dt * clamp(sp / 8, 0, 1);
      this.lean = damp(this.lean, this.crashSide * 1.42, 12, dt); this.pitch = damp(this.pitch, 0, 8, dt); this.pitchVel = 0;
      this.speed = sp; this.vf = sp; this.vl = 0; this.rpm = damp(this.rpm, this.spec.idle, 3, dt); this.spin = 0; this.slipAngle = 0;
      f.scrape = this.surf <= SURF.KERB ? clamp(sp / 14, 0, 1) : 0;
      const rd = this.rd; const rdec = this.surf === SURF.GRAVEL ? 13 : 6.4;
      let rs = Math.hypot(rd.vx, rd.vz);
      rd.vh -= 18 * dt; rd.h += rd.vh * dt; if (rd.h < 0) { rd.h = 0; rd.vh = rd.vh < -3 ? -rd.vh * 0.3 : 0; }
      if (rs > 0.01 && rd.h <= 0.02) { const ns = Math.max(0, rs - rdec * dt); rd.vx *= ns / rs; rd.vz *= ns / rs; rs = ns; }
      rd.x += rd.vx * dt; rd.z += rd.vz * dt; rd.rot += rd.rotV * dt * clamp(rs / 6, 0, 1.5);
      // both keep inside the barriers
      this._contain(this, 0.6); this._contain(rd, 0.4); this._endOfRoad();
      this.y = t.heightAt(this.idx, t.along(this.idx, this.x, this.z)); rd.y = t.heightAt(t.nearest(rd.x, rd.z, this.idx), 0);
      if ((this.crashT > 1.5 && sp < 1.2 && rs < 1.2) || this.crashT > 4.2) this.respawn();
    }
    _contain(o, r) {
      const t = this.track; const i = t.nearest(o.x, o.z, this.idx); const d = t.lateral(i, o.x, o.z);
      const side = d < 0 ? 0 : 1, sg = side ? 1 : -1, lim = t.bar[side][i] - r;
      if (Math.abs(d) > lim) {
        const nx = t.nx[i] * sg, nz = t.nz[i] * sg, pen = Math.abs(d) - lim;
        o.x -= nx * pen; o.z -= nz * pen; const vn = o.vx * nx + o.vz * nz;
        if (vn > 0) { o.vx -= nx * vn * 1.3; o.vz -= nz * vn * 1.3; o.vx *= 0.6; o.vz *= 0.6; }
      }
    }

    _progress() {
      const t = this.track, L = t.length;
      const sNow = this.idx * t.ds + t.along(this.idx, this.x, this.z);
      let dl = sNow - this.sPrev; if (dl > L / 2) dl -= L; else if (dl < -L / 2) dl += L;
      this.sPrev = sNow;
      this.prog += dl;
      const lapNow = Math.floor(this.prog / L);
      if (lapNow > this.lap) {
        const over = this.prog - lapNow * L; const tCross = this.time - (this.speed > 1 ? over / this.speed : 0);
        if (this.lap < 0) {
          if (this.flying) this.lapStartT = tCross;
          this.lap = lapNow; if (this.onLap) this.onLap(this, 0, 0, tCross);
        } else {
          const lapTime = tCross - this.lapStartT; this.lapStartT = tCross; this.lap = lapNow;
          this.lastLap = lapTime; if (!this.bestLap || lapTime < this.bestLap) this.bestLap = lapTime;
          if (this.onLap) this.onLap(this, lapNow, lapTime, tCross);
        }
      }
    }
    get lapTime() { return this.time - this.lapStartT; }
    get trackPos() { return AX.mod(this.sPrev, this.track.length); }
  }

  /* soft bike-to-bike contact; returns impact speed if they touched */
  AX.collideBikes = function (a, b) {
    if (a.ghostT > 0 || b.ghostT > 0 || a.crashed || b.crashed) return 0;
    const dx = b.x - a.x, dz = b.z - a.z; const R = 1.05; const d2 = dx * dx + dz * dz;
    if (d2 > R * R || d2 < 1e-6) return 0;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = R - d;
    a.x -= nx * pen * 0.5; a.z -= nz * pen * 0.5; b.x += nx * pen * 0.5; b.z += nz * pen * 0.5;
    const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (rv < 0) {
      const j = -rv * 0.62;
      a.vx -= nx * j; a.vz -= nz * j; b.vx += nx * j; b.vz += nz * j;
      const hit = -rv;
      a.leanVel += (nx * -Math.sin(a.yaw) + nz * Math.cos(a.yaw)) * -hit * 0.25;
      b.leanVel += (nx * -Math.sin(b.yaw) + nz * Math.cos(b.yaw)) * hit * 0.25;
      if (hit > 7.5) { (a.speed > b.speed ? a : b).crash('contact'); }
      return hit;
    }
    return 0.01;
  };

  AX.Bike = Bike;
  if (typeof module !== 'undefined' && module.exports) module.exports = AX;
})(typeof globalThis !== 'undefined' ? globalThis : window);
