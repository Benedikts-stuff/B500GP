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

  /* tc: traction-control slip ceiling (0 = off) · wcBase / wcBack: wheelie height the assist allows with neutral / weight-back body
     (null = no wheelie control) · catchSa / catchK: slide angle where the assist steps in and how hard the chassis pulls straight
     · abs / rearAbs: front / rear anti-lock · stop: allowed stoppie angle (-1 = none) · slipper: engine braking reaching the rear tyre
     · thrUp / thrDn: keyboard throttle roll-on / roll-off rates */
  AX.ASSISTS = {
    easy:  { id: 'easy',  tc: 1.02, wcBase: 0.0,  wcBack: 0.14, catchSa: 0.18, catchK: 2.5, slide: 0.45, abs: true,  rearAbs: true,  stop: 0.02, leanLimit: true,  highside: false, slipper: 0.35, kick: false, thrUp: 5.5, thrDn: 11, steerHelp: 1 },
    sport: { id: 'sport', tc: 0,    wcBase: null, wcBack: 0,    catchSa: 9,    catchK: 0,   slide: 1,    abs: false, rearAbs: false, stop: -1,   leanLimit: false, highside: true,  slipper: 1,    kick: true,  thrUp: 3.2, thrDn: 5,  steerHelp: 0 },
    // Off: everything Sport has (no aids), plus a few degrees more lean, a little more side grip at the edge and more
    // room before a slide or an over-lean throws you off - faster in skilled hands, but the limit is yours to find
    pro:   { id: 'pro',   tc: 0,    wcBase: null, wcBack: 0,    catchSa: 9,    catchK: 0,   slide: 1.15, abs: false, rearAbs: false, stop: -1,   leanLimit: false, highside: true,  slipper: 1,    kick: true,  thrUp: 3.2, thrDn: 5,  steerHelp: 0, leanX: 5, gripL: 1.05, crashX: 1.15, trailX: 1.3 },
    // the AI rides with tidy, conservative assists
    ai:    { id: 'ai',    tc: 1.14, wcBase: 0.05, wcBack: 0.52, catchSa: 0.3,  catchK: 1.4, slide: 1,    abs: true,  rearAbs: true,  stop: 0.09, leanLimit: true,  highside: false, slipper: 0.5,  kick: false, thrUp: 5.5, thrDn: 11, steerHelp: 0.5 }
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
      this.steer = 0; this.throttle = 0; this.brake = 0; this.rearBrake = 0; this.rearLock = 0; this.trail = 0;
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

    // keyboard lean assist: holding a key asks for "turn this way"; the bike leans as far as the road ahead needs
    // (plus a little), and holding on longer adds more on top. Against the bend, or on a straight, it eases in.
    _leanAssist(tgt, v, holdT) {
      const t = this.track, ds = t.ds;
      // pure pursuit: the curvature that carries the bike from where it is, the way it points, onto the road ahead
      // (keeping roughly its line across the road) - this also corrects when the bike is running wide
      const L = clamp(v * 0.75, 9, 42), it = t.wr(this.idx + Math.round(L / ds));
      const dT = this.d * 0.6, tx = t.px[it] + t.nx[it] * dT, tz = t.pz[it] + t.nz[it] * dT;
      const dx = tx - this.x, dz = tz - this.z, dist = Math.max(4, Math.hypot(dx, dz));
      const al = AX.wrapAngle(Math.atan2(dz, dx) - this.yaw);
      let k = 2 * Math.sin(al) / dist;
      // and the tightest bit of road coming up, so the lean is there in time for the bend
      const a = Math.round(Math.max(2, v * 0.15) / ds), b = Math.round(clamp(v * 0.5, 6, 30) / ds);
      for (let j = a; j < b; j += 2) {
        const i0 = t.wr(this.idx + j), i1 = t.wr(this.idx + j + 4);
        const kr = AX.wrapAngle(t.yaw[i1] - t.yaw[i0]) / (4 * ds);
        if (Math.sign(kr) === Math.sign(k) && Math.abs(kr) > Math.abs(k)) k = lerp(k, kr, 0.6);
      }
      const lm = (this.spec.maxLean + (this.assist.leanX || 0)) * DEG;
      const need = Math.atan(v * v * k / G) / lm;              // steer fraction that makes that turn
      const extra = 0.75 * Math.max(0, holdT - 0.45);
      const slideCut = this.slideHold ? 1 - 0.35 * smoothstep(0.1, 0.35, Math.abs(this.slipAngle)) : 1;
      if (Math.sign(need) === Math.sign(tgt) && Math.abs(need) > 0.06) return slideCut * Math.sign(tgt) * Math.min(1, Math.abs(need) * 1.1 + 0.06 + extra);
      return slideCut * Math.sign(tgt) * Math.min(1, 0.35 + 0.9 * holdT);
    }

    step(dt, inp) {
      this._clearFx();
      this.time += dt;
      if (this.ghostT > 0) this.ghostT -= dt;
      if (this.crashed) { this._stepCrash(dt); this._progress(); return; }
      const spec = this.spec, as = this.assist, t = this.track, f = this.fx;

      // ---- inputs
      const stA = inp.steerAnalog || inp.analog;
      if (stA) this.steer = damp(this.steer, inp.steer, 18, dt);
      if (inp.analog) {
        this.throttle = damp(this.throttle, inp.throttle, 22, dt);
        this.brake = damp(this.brake, inp.brake, 26, dt);
      } else {
        if (!stA) {
          // keys: the bars come in at a steady rate; let go and they ease back - slower at speed, so tapping the key
          // holds a medium lean instead of flicking between full lean and upright. The other key pulls back quickly.
          const sv = this.speed, tgt = inp.steer;
          const up = lerp(3.6, 2.4, smoothstep(20, 65, sv));
          const rel = lerp(5.0, 2.2, smoothstep(12, 45, sv));
          // how long the key has been held in this direction
          this.kbHoldT = tgt !== 0 && Math.sign(tgt) === Math.sign(this.kbDir || 0) ? (this.kbHoldT || 0) + dt : 0; this.kbDir = tgt;
          let aim = tgt;
          if (inp.leanAssist && tgt !== 0) aim = this._leanAssist(tgt, Math.max(0, this.vx * Math.cos(this.yaw) + this.vz * Math.sin(this.yaw)), this.kbHoldT);
          const rate = this.steer !== 0 && tgt !== 0 && Math.sign(tgt) !== Math.sign(this.steer) ? 6.0 : tgt === 0 ? rel : up;
          this.steer = approach(this.steer, aim, rate, rate, dt);
        }
        // keys are on/off: roll the throttle on and off at a rate that suits the assist level
        this.throttle = approach(this.throttle, inp.throttle, as.thrUp || 5.5, as.thrDn || 11, dt);
        this.brake = approach(this.brake, inp.brake, as.stop < 0 ? 4.5 : 7.5, 13, dt);
      }
      this.rearBrake = approach(this.rearBrake, clamp(inp.rearBrake || 0, 0, 1), 6, 12, dt);

      const fxv = Math.cos(this.yaw), fzv = Math.sin(this.yaw), rx = -fzv, rz = fxv;
      let vf = this.vx * fxv + this.vz * fzv, vl = this.vx * rx + this.vz * rz;

      // ---- where are we
      this.idx = t.nearest(this.x, this.z, this.idx);
      this.d = t.lateral(this.idx, this.x, this.z);
      this.surf = t.surfaceAt(this.idx, this.d);
      const sd = SURF_DATA[this.surf];
      const Gr = spec.mu * G * sd.grip * this.gripScale;
      // ---- rider body weight: hanging off to the inside gives grip and lean, to the outside costs grip.
      //      Weight forward/back moves the centre of mass along the bike (wheelies, stoppies, rear brake bite).
      let hangT = clamp(inp.bodyX || 0, -1, 1), auto = false;
      // keyboard / mouse: with no body key held the rider hangs off into the corner by himself as the bike leans
      if (inp.autoHang && Math.abs(hangT) < 0.01 ) { auto = true; hangT = Math.sign(this.lean) * smoothstep(0.22, 0.6, Math.abs(this.lean) / (this.spec.maxLean * DEG)); }
      this.hang = approach(this.hang, hangT, auto ? 3.5 : 5, auto ? 3.5 : 5, dt);
      this.fb = approach(this.fb, clamp(inp.bodyY || 0, -1, 1), 6, 6, dt);
      const turnDir = Math.abs(this.lean) > 0.05 ? Math.sign(this.lean) : Math.sign(this.steer);
      const hi = this.hangIn = clamp(this.hang * turnDir, -1, 1);
      const gripMul = 1 + 0.2 * Math.max(0, hi) - 0.25 * Math.max(0, -hi);
      const GrL = Gr * gripMul * (as.gripL || 1);                                      // lateral grip
      const cgB = spec.cgB + 0.16 * this.fb;                        // distance rear axle -> centre of mass
      const back = Math.max(0, -this.fb), fwd = Math.max(0, this.fb);
      if (this.surf === SURF.GRASS || this.surf === SURF.GRAVEL) this.offT += dt; else this.offT = 0;
      if (this.surf === SURF.KERB) f.kerb = clamp(vf / 25, 0, 1);

      // ---- trail braking: a light-to-medium front brake while leaned loads the front tyre, the bike turns in quicker and tighter
      const bf0 = Math.min(1.2, this.brake * spec.brake / Gr), leanFrac = Math.abs(this.lean) / (spec.maxLean * DEG);
      const trail = this.trail = smoothstep(0.05, 0.2, bf0) * (1 - smoothstep(0.55, 0.95, bf0)) * smoothstep(0.08, 0.45, leanFrac) * smoothstep(6, 14, vf);

      // ---- lean + yaw
      const frontUp = this.pitch > 0.045; const frontLight = smoothstep(0.05, 0.3, this.pitch);
      let lm = (spec.maxLean + (as.leanX || 0) + 9 * Math.max(0, hi)) * DEG * smoothstep(0.8, 8.5, vf);
      if (as.leanLimit) lm = Math.min(lm, Math.atan(0.985 * GrL / G));
      // grabbing a handful of front brake mid-corner stands the bike up
      const leanT = this.steer * lm * (1 - 0.3 * smoothstep(0.65, 1.0, bf0) * (1 - trail));
      let wn = spec.leanRate * lerp(1, 0.72, smoothstep(25, 72, vf));
      wn *= (1 - 0.55 * frontLight) * (1 + 0.45 * trail * (as.trailX || 1));
      const zeta = 0.86;
      this.leanVel += (wn * wn * (leanT - this.lean) - 2 * zeta * wn * this.leanVel) * dt;
      this.lean += this.leanVel * dt;
      const omLean = G * Math.tan(this.lean) / Math.max(vf, 6);
      const omLow = this.steer * 2.3 * clamp(vf / 3, 0, 1);
      let omega = lerp(omLow, omLean, smoothstep(2.5, 8.5, vf));
      omega *= (1 - 0.5 * frontLight) * (1 + 0.18 * trail * (as.trailX || 1));
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
      let nEff = n;
      if (this.gear === 0) { const slip = (spec.idle / spec.redline) + this.throttle * 0.46; if (nEff < slip) nEff = slip; }
      this.limiter = n >= 1.0 && this.throttle > 0.3;
      let aDem = 0;
      if (this.shiftT <= 0 || this.shiftDir < 0) {
        const tq = this.limiter ? 0 : AX.torqueAt(spec, nEff);
        this.aFull = this.thrustK * this.powerScale * tq / gears[this.gear];
        aDem = this.aFull * this.throttle;
      }
      // engine braking acts through the chain on the rear tyre; a slipper clutch (assists) takes the edge off
      const engBrake = (1 - this.throttle) * (0.7 + 2.3 * n) * (vf > 1 ? 1 : 0) * (as.slipper == null ? 1 : as.slipper);

      // ---- wheelie: balance acceleration about the rear contact; the assist holds the height the rider asks for
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      // leaned over, the bike carries gravity plus the cornering force (g / cos lean in its own plane), so it takes
      // more drive to lift the front; hanging off drops the centre of mass in the bike's plane, which helps keep it down too
      const leanA = Math.abs(this.lean), cgHl = spec.cgH * (1 - 0.07 * Math.abs(this.hang) * smoothstep(0.1, 0.45, leanA));
      const bEff = cgB * cp - cgHl * sp, hEff = cgHl * cp + cgB * sp;
      const aeroHold = (spec.style.winglets ? 0.0011 : 0.0006) * vf * vf;
      const gPlane = Math.min(G * 2.2, Math.hypot(G, ayDem));
      const aBal = gPlane * bEff / hEff + aeroHold;
      const aDemRaw = aDem;               // what the engine delivers before wheelie control / instinct trim it
      if (as.wcBase != null && this.throttle > 0) {
        const tp = lerp(as.wcBase, as.wcBack, smoothstep(0.2, 0.9, back)) * (1 - smoothstep(0.15, 0.8, fwd));
        const lim = aBal + 56 * (tp - this.pitch) - 17 * this.pitchVel;
        if (aDem > lim) aDem = Math.max(0, lim);
      }
      // no assist, keys only: a rider instinctively rolls off before the bike loops (weight back lets it go higher)
      const kbInstinct = as.wcBase == null && !inp.analog, hiW = back > 0.5;
      if (kbInstinct) aDem *= 1 - smoothstep(hiW ? 0.55 : 0.28, hiW ? 0.85 : 0.52, this.pitch);
      const dab = kbInstinct ? 8 * smoothstep(hiW ? 0.75 : 0.48, hiW ? 1.0 : 0.72, this.pitch) : 0;   // a dab of rear brake
      const Kx = 0.98;
      // snapping the weight back with the throttle open pops the front up (clutch-up kick)
      const wantUp = this.fb < -0.55;
      if (as.kick && wantUp && !this.wheelieKey && this.throttle > 0.4 && this.pitch < 0.12 && vf > 3 && this.aFull > aBal * 0.62 && Math.abs(this.lean) < 0.5) this.pitchVel += 1.9;
      this.wheelieKey = wantUp;
      const latFrac = Math.min(1, Math.abs(ayDem) / GrL);
      this.latFrac = latFrac; this.Gr = GrL;
      if (as.tc > 0) {
        const lim = Gr * Kx * Math.sqrt(Math.max(0, as.tc * as.tc - latFrac * latFrac));
        if (aDem > lim) aDem = lim;
      }
      // slide control: past the assist's angle the power is taken away
      const sa0 = Math.abs(this.slipAngle);
      const cX = as.crashX || 1, kbPro = as.stop < 0 && !inp.analog, catchSa = kbPro ? 0.46 : as.catchSa, catchK = kbPro ? 0.7 : as.catchK;
      // the wheelie control and the rider's instinct only shape the wheelie height: up to 85 % of the drive still goes into the road
      let aDemP = aDem;
      if (as.tc > 0) { const limT = Gr * Kx * Math.sqrt(Math.max(0, as.tc * as.tc - latFrac * latFrac)); const keep = 0.85 * (1 - 0.15 * frontLight); aDem = Math.max(aDem, Math.min(aDemRaw * keep, limT)); } else aDem = Math.max(aDem, aDemRaw * 0.85 * (1 - 0.15 * frontLight));
      if (sa0 > catchSa) { const k = Math.max(0.15, 1 - (sa0 - catchSa) * 6); aDem *= k; aDemP *= k; }
      const rearUp = this.pitch < -0.02;
      // with the front in the air the whole bike sits on the rear tyre: more drive grip before it spins
      const KxR = Kx * (1 + 0.3 * frontLight);
      let aDrive = rearUp ? 0 : Math.min(aDem, Gr * KxR);
      const overDrive = rearUp ? 0 : aDem - aDrive;

      // ---- front brake (S)
      const q = Math.max(0, -this.pitch);
      // no ABS, keys only: the rider eases the lever as the rear lifts - unless the weight is thrown forward, then it goes over
      let aBrkF = this.brake * spec.brake * (as.stop < 0 && !inp.analog ? 1 - smoothstep(fwd > 0.5 ? 0.45 : 0.14, fwd > 0.5 ? 0.85 : 0.34, q) : 1);
      if (as.abs) {
        const cq = Math.cos(q), sq = Math.sin(q);
        const bf = (spec.wheelbase - cgB) * cq - spec.cgH * sq, hf = spec.cgH * cq + (spec.wheelbase - cgB) * sq;
        if (as.stop >= 0) { const qT = as.stop * (1 - smoothstep(0.1, 0.35, Math.abs(this.lean))) - 0.012; const lim = G * bf / hf + 56 * (qT - q) + 17 * this.pitchVel; if (aBrkF > lim) aBrkF = Math.max(0, lim); }
        const circ = GrL * Math.sqrt(Math.max(0.02, 1 - latFrac * latFrac)) * (1 + 0.1 * trail);
        if (aBrkF > circ) aBrkF = Math.max(circ, Math.min(aBrkF, Gr * 0.22));
      }
      let frontLock = false;
      if (aBrkF > Gr * 1.04) { aBrkF = Gr * 0.86; frontLock = true; }

      // ---- rear brake (Space) + engine braking, limited by the load left on the rear tyre
      const decel0 = Math.max(0, aBrkF);
      const rearLoad = clamp(1 - cgB / spec.wheelbase - decel0 * spec.cgH / (G * spec.wheelbase), 0.08, 1);
      const capRear = rearUp ? 0 : Gr * 1.9 * rearLoad * Math.sqrt(Math.max(0.05, 1 - latFrac * latFrac));
      let rearDem = rearUp ? 0 : this.rearBrake * G * 0.6 + engBrake;
      if (as.rearAbs && rearDem > capRear) rearDem = capRear;
      const lockT = capRear > 0 ? clamp((rearDem - capRear) / (Gr * 0.25), 0, 1) : 0;
      this.rearLock = damp(this.rearLock, lockT, lockT > this.rearLock ? 20 : 7, dt);
      const aRear = rearDem > capRear ? capRear * 0.82 : rearDem;
      let aBrk = aBrkF + aRear;
      if (vf < 0.4) { aBrkF = Math.min(aBrkF, vf / dt * 0.5); aBrk = Math.min(aBrk, vf / dt * 0.5); }

      // ---- side grip left over
      let capY;
      if (aBrkF > 0.4) {
        capY = GrL * Math.sqrt(Math.max(0.03, 1 - (aBrkF / Gr) * (aBrkF / Gr))) * (1 + 0.1 * trail);
        if (Math.abs(ayDem) > capY) {             // front pushes wide
          const ratio = capY / Math.abs(ayDem);
          omega *= lerp(1, ratio, 0.72); ayDem = vf * omega;
          f.frontSkid = clamp((1 / ratio - 1) * 2.2, 0, 1);
          if (!as.abs && (frontLock || ratio < (kbPro ? 0.62 : 0.72)) && Math.abs(this.lean) > (inp.leanAssist ? 0.55 : 0.42) * cX && vf > 9) { this.tuckT += dt; if (this.tuckT > (inp.leanAssist ? 0.75 : kbPro ? 0.4 : 0.22) * cX) return this.crash('lowside'); }
        } else this.tuckT = 0;
      } else {
        this.tuckT = 0;
        // drive only loads the rear tyre: the front keeps its full side grip, so a bike sliding on the throttle still turns
        capY = GrL * (0.45 + 0.55 * Math.sqrt(Math.max(0.03, 1 - (aDrive / (Gr * Kx)) * (aDrive / (Gr * Kx)))));
        // leaned past what the front tyre holds: it washes wide instead of swinging the bike round faster than it can travel
        const capF = GrL * 1.04;
        if (Math.abs(ayDem) > capF) { const ratio = capF / Math.abs(ayDem); omega *= lerp(1, ratio, 0.6); ayDem = vf * omega; f.frontSkid = Math.max(f.frontSkid || 0, clamp((1 / ratio - 1) * 2.2, 0, 1)); }
      }
      if (frontLock) f.frontSkid = 1;
      let uRear = Math.hypot(aDrive / (Gr * KxR), ayDem / GrL) + overDrive / (Gr * 0.8);
      uRear = Math.max(uRear, this.rearLock > 0.05 ? 1 + this.rearLock * 0.6 : 0);
      this.util = aBrkF > 0.4 ? Math.hypot(aBrkF / Gr, ayDem / GrL) : uRear;
      const spinT = this.throttle > 0.2 && !rearUp ? clamp((uRear - 1.0) * 2.4, 0, 1) : 0;
      this.spin = damp(this.spin, spinT, spinT > this.spin ? 14 : 6, dt);

      // ---- the rear steps out: under power past the grip limit, on the brakes with a light rear (weight forward, backing it in),
      //      or with a locked rear. The chassis' own stability (and the assist) pull it back straight.
      const turnSign = Math.abs(ayDem) > 0.5 ? Math.sign(ayDem) : (Math.abs(this.steer) > 0.05 ? Math.sign(this.steer) : 0);
      let stepOut = 2.2 * Math.max(0, Math.min(uRear, 1.9) - 1) * (this.throttle > 0.2 ? 1 : 0);
      if (aBrk > 0.4) {
        const soB = (0.55 * (as.brakeSlide || 1) * (aBrkF / spec.brake) * latFrac * (1 + 0.35 * fwd) * (1 - 0.85 * back) + this.rearLock * (1.2 + 1.6 * latFrac)) * (rearUp ? 0 : 1);
        stepOut += soB;
        // a light, braking rear has little side grip left: it lets go and the bike backs in
        capY *= 1 - clamp(soB * 0.2, 0, 0.25);   // the sliding rear still drags sideways and the front still bites
      }
      const restore = 2.0 + catchK + 0.8 * back * (aBrk > 0.4 ? 1 : 0);
      // while something keeps the rear stepping out, the chassis' stability holds the slide angle in check. Once that
      // stops (throttle rolled off, brake released) the slide closes up mostly by the tyres swinging the direction of
      // travel round to where the bike points: the rotation gained in the slide is kept and the bike comes out tighter.
      const yawShare = lerp(0.4, 1, smoothstep(0.05, 0.4, stepOut * as.slide));
      omega += turnSign * stepOut * as.slide * smoothstep(5, 12, vf) - restore * this.slipAngle * smoothstep(3, 8, vf) * yawShare;
      // keyboard steer assist on the brakes: the rider holds a backing-in slide at around 15-20 degrees -
      // it neither dies straight away nor keeps swinging round until it throws him off
      const holdS = inp.leanAssist && vf > 8 && (this.brake > 0.3 || this.rearBrake > 0.3) && this.throttle < 0.3;
      this.slideHold = holdS;
      if (holdS && Math.abs(this.slipAngle) > 0.07) { const s0 = Math.abs(this.slipAngle); omega += Math.sign(this.slipAngle) * (0.3 - s0) * (s0 < 0.3 ? 1.6 : 7); }
      if (as.saMax && Math.abs(this.slipAngle) > as.saMax * 0.8) omega -= Math.sign(this.slipAngle) * (Math.abs(this.slipAngle) - as.saMax * 0.8) * 22;

      // ---- integrate
      const tau = 0.075;
      const aT = clamp(-vl / tau, -capY, capY);
      // sitting up (weight back) catches the wind: an air brake under braking, a small penalty otherwise; tucked in (forward) on a straight cuts drag
      const tuckK = 1 - 0.1 * fwd * (1 - Math.min(1, Math.abs(this.steer) * 2));
      const sitK = 1 + back * (this.brake > 0.1 ? 0.7 : 0.18);
      const drag = this.kDrag * vf * vf * tuckK * sitK + (vf > 0.3 ? 0.25 + sd.drag + sd.dragV * vf : 0) + Math.abs(aT) * 0.012 * Math.min(1, Math.abs(this.slipAngle) * 6);
      this.slope = t.gr ? t.gr[this.idx] * (fxv * t.tx[this.idx] + fzv * t.tz[this.idx]) : 0;
      const aLong = aDrive - aBrk - drag - G * this.slope;
      this.vx += (fxv * aLong + rx * aT) * dt; this.vz += (fzv * aLong + rz * aT) * dt;
      this.yaw += omega * dt; this.omega = omega;
      this.x += this.vx * dt; this.z += this.vz * dt;
      vf = this.vx * fxv + this.vz * fzv; vl = this.vx * rx + this.vz * rz;
      if (vf < 0 && this.throttle < 0.05) { this.vx -= fxv * vf; this.vz -= fzv * vf; vf = 0; }
      this.vf = vf; this.vl = vl; this.speed = Math.hypot(this.vx, this.vz);
      this.aLong = aLong; this.aLat = aT;
      this.slipAngle = vf > 2 ? Math.atan2(-vl, vf) : 0;

      // ---- pitch: wheelie about the rear contact, stoppie about the front. One state at a time, so a stoppie
      //      that rebounds lands on the rear wheel instead of snapping back, and a stoppie past the tipping point goes over.
      const J = 0.95; const aNet = (rearUp ? 0 : Math.min(aDemP, Gr * KxR)) - aBrk - (this.pitch > 0 ? dab : 0);
      const qB = (pq) => { const cq = Math.cos(pq), sq = Math.sin(pq); const bf = (spec.wheelbase - cgB) * cq - spec.cgH * sq, hf = spec.cgH * cq + (spec.wheelbase - cgB) * sq; return [bf, hf]; };
      if (this.pitch > 0 || (this.pitch === 0 && (aNet > aBal || this.pitchVel > 0))) {
        this.pitchVel += ((aNet - aBal) * hEff / J - 0.6 * this.pitchVel) * dt;
        this.pitch += this.pitchVel * dt;
        if (this.pitch <= 0) { f.landing = clamp(-this.pitchVel / 2.2, 0, 1); if (vf > 14) this.headShake = Math.max(this.headShake || 0, f.landing * 0.9 * smoothstep(14, 40, vf)); this.pitch = 0; this.pitchVel = 0; }
      } else {
        const [bf, hf] = qB(q), aStop = G * bf / hf;
        if (this.pitch < 0 || -aNet > aStop) {
          // nose-down torque from the braking, restoring torque from gravity (it reverses past the tipping point)
          this.pitchVel -= ((-aNet - aStop) * hf / J + 0.6 * this.pitchVel) * dt;
          this.pitch += this.pitchVel * dt;
          if (this.pitch >= 0) { f.landing = clamp(this.pitchVel / 3, 0, 0.6); this.pitch = 0; this.pitchVel = 0; }
          if (this.pitch < -1.0) return this.crash('stoppie');
        }
      }
      if (this.headShake) this.headShake = Math.max(0, this.headShake - dt * 1.4);
      if (this.pitch > 0.03) { this.wheelieAir += dt; this.wheelieT += dt; } else { this.wheelieAir = 0; this.wheelieT = 0; }
      if (this.pitch > 1.22) return this.crash('loop');

      // ---- rpm for display + sound
      const nShow = Math.max(nEff, spec.idle / spec.redline) * (1 + this.spin * 0.22) * (rearUp ? 1.15 : 1);
      let rpmT = Math.min(nShow, 1.03) * spec.redline;
      if (this.limiter) rpmT = spec.redline * (0.985 + 0.02 * Math.sin(this.time * 70));
      this.rpm = damp(this.rpm, rpmT, this.shiftT > 0 ? 30 : 22, dt);
      if (this.thrHist > 0.75 && this.throttle < 0.12 && n > 0.62) f.backfire = clamp(n, 0, 1);
      this.thrPrev2 = this.thrHist; this.thrHist = damp(this.thrHist, this.throttle, 9, dt);

      // ---- slide limits
      const sa = Math.abs(this.slipAngle);
      if (vf > 7 && sa > (this.slideHold ? 0.9 : kbPro ? 0.74 : 0.62) * cX) return this.crash('lowside');
      // highside: a big slide and the throttle snapped shut, the rear finds grip all at once
      if (as.highside && vf > 14 && sa > (kbPro ? 0.38 : 0.3) * cX && Math.abs(this.lean) > 0.35 && this.thrPrev2 > 0.6 && this.throttle < 0.1) return this.crash('highside');
      if (!as.leanLimit && vf > 8 && Math.abs(Math.tan(this.lean)) * G > GrL * (this.slideHold ? 1.45 : kbPro ? 1.3 : 1.18) * (1 + (cX - 1) * 0.6) && sa > (this.slideHold ? 0.4 : kbPro ? 0.28 : 0.2) * cX) return this.crash('lowside');

      // ---- marks, squeal: only real wheelspin, a sliding rear or a locked tyre leave rubber
      const brakeSkid = aBrk > 0.4 ? clamp((sa - 0.05) * 6, 0, 1) : 0;
      f.rearSkid = rearUp ? 0 : clamp(Math.max(this.spin, brakeSkid, this.rearLock, sa * 4.5 - 0.2), 0, 1) * (vf > 3 ? 1 : this.spin);
      const markT = rearUp ? 0 : clamp(Math.max(this.spin * 1.3, (sa - 0.07) * 7, this.rearLock * 1.3, brakeSkid), 0, 1);
      this.mark = damp(this.mark, markT, markT > this.mark ? 30 : 8, dt);
      if (frontUp) f.frontSkid = 0;
      f.squeal = clamp(Math.max(f.rearSkid * 0.8, f.frontSkid, (this.util - 0.97) * 3), 0, 1) * (this.surf <= SURF.KERB || this.surf === SURF.RUNOFF ? 1 : 0);

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
