/* =========================================================
   APEX & PASS — Kamm-Circle 2D Velocity Motorcycle Physics,
   Countersteering, Trail-Braking, Powerslides & Stunt Balance
   ========================================================= */
'use strict';

const COMPOUNDS = {
  soft:   { mu: 1.50, heat: 1.35, peak: 88,  cold: 0.90, label: 'Soft' },
  medium: { mu: 1.40, heat: 1.00, peak: 95,  cold: 0.92, label: 'Medium' },
  hard:   { mu: 1.30, heat: 0.78, peak: 104, cold: 0.94, label: 'Hard' }
};

const DEFAULT_SETUP = {
  compound: 'medium',
  pressureF: 2.3,
  pressureR: 2.3,
  springF: 1.0,
  springR: 1.0,
  damping: 1.0,
  gearing: 1.0,
  tc: 1,
  abs: 1,
  aw: 2
};

class BikePhysics {
  constructor(specId) {
    this.spec = BIKES[specId];
    this.setup = { ...DEFAULT_SETUP };
    this.pos = new THREE.Vector3();
    this.velX = 0;
    this.velZ = 0;
    this.vLong = 0;
    this.vLat = 0;
    this.yaw = 0;
    this.yawRate = 0;
    this.speed = 0;
    this.accel = 0;
    this.lean = 0;
    this.leanVel = 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.steer = 0;
    this.steerVis = 0;
    this.throttle = 0;
    this.frontBrake = 0;
    this.rearBrake = 0;
    this.clutch = 0;
    this.prevClutch = 0;
    this.clutchPopBoost = 0;
    this.engineBrakeTimer = 0;
    this.weightX = 0;
    this.weightY = 0;
    this.gear = 1;
    this.rpm = this.spec.idle;
    this.spin = 0;
    this.drift = 0;
    this.brakeSlide = 0;
    this.frontLock = 0;
    this.slipAngle = 0;
    this.burnout = false;
    this.offroad = false;
    this.surface = 'asphalt';
    this.forkDive = 0;
    this.suspF = 0;
    this.suspR = 0;
    this.airY = 0;
    this.trackIndex = 0;
    this.time = 0;
    this.shiftCooldown = 0;
    this.limiter = false;
    this.overrun = 0;
    this.backfireEvent = 0;
    this.shiftEvent = 0;
    this._popTimer = 0.08;
    this._frontWashTimer = 0;
    this._highsideWarn = 0;
    this.tempF = [75, 75, 75];
    this.tempR = [78, 78, 78];
    this.leanLimit = 0.94;
    this.loadF = 1;
    this.loadR = 1;
    this.crashed = false;
    this.crashType = '';
    this.crashTimer = 0;
    this.crashRoll = 0;
    this.crashRollVel = 0;
    this.crashPitch = 0;
    this.crashPitchVel = 0;
    this.crashYawVel = 0;
    this.crashSlide = new THREE.Vector3();
    this.rearWheelOmega = 0;
    this.frontWheelOmega = 0;
    this.distance = 0;
    this.lapValid = true;
  }

  get mass() { return this.spec.mass + this.spec.riderMass; }

  setSetup(patch) { Object.assign(this.setup, patch); }

  reset(track, index = track.startIndex, lateralOffset = 0) {
    const pose = track.poseAtIndex(index, lateralOffset);
    this.pos.copy(pose.pos);
    this.pos.y = 0.03;
    this.velX = 0;
    this.velZ = 0;
    this.vLong = 0;
    this.vLat = 0;
    this.airY = 0;
    this.forkDive = 0;
    this.suspF = 0;
    this.suspR = 0;
    this.yaw = pose.yaw;
    this.yawRate = 0;
    this.speed = 0;
    this.accel = 0;
    this.lean = 0; this.leanVel = 0;
    this.pitch = 0; this.pitchVel = 0;
    this.steer = 0; this.steerVis = 0;
    this.throttle = 0; this.frontBrake = 0; this.rearBrake = 0; this.clutch = 0;
    this.prevClutch = 0; this.clutchPopBoost = 0; this.engineBrakeTimer = 0;
    this.weightX = 0; this.weightY = 0;
    this.gear = 1; this.rpm = this.spec.idle;
    this.spin = 0; this.drift = 0; this.brakeSlide = 0; this.frontLock = 0; this.slipAngle = 0;
    this.burnout = false; this.offroad = false; this.surface = 'asphalt';
    this.limiter = false; this.overrun = 0; this.backfireEvent = 0; this.shiftEvent = 0;
    this._popTimer = 1.1; this._frontWashTimer = 0; this._highsideWarn = 0;
    this.trackIndex = track.fullNearest(this.pos);
    this.tempF = [75, 75, 75];
    this.tempR = [78, 78, 78];
    this.crashed = false; this.crashType = ''; this.crashTimer = 0;
    this.crashRoll = 0; this.crashRollVel = 0; this.crashPitch = 0; this.crashPitchVel = 0; this.crashYawVel = 0;
    this.crashSlide.set(0, 0, 0);
    this.distance = 0;
    this.shiftCooldown = 0;
    this.time = 0;
  }

  shiftUp() {
    if (this.shiftCooldown > 0 || this.gear >= 6) return false;
    this.gear++;
    const nextRatio = this.spec.gears[this.gear - 1] / this.spec.gears[this.gear - 2];
    this.rpm = Math.max(this.spec.idle, this.rpm * nextRatio * 1.03);
    this.shiftCooldown = 0.15;
    this.shiftEvent = 1;
    if (this.throttle > 0.65 && this.rpm > this.spec.redline * 0.62) {
      this.backfireEvent = Math.max(this.backfireEvent, 0.55);
    }
    return true;
  }

  shiftDown() {
    if (this.shiftCooldown > 0 || this.gear <= 1) return false;
    const prevRatio = this.spec.gears[this.gear - 2] / this.spec.gears[this.gear - 1];
    this.gear--;
    this.rpm = Math.min(this.spec.redline * 0.96, this.rpm * prevRatio * 0.94);
    this.shiftCooldown = 0.15;
    this.shiftEvent = 1;
    if (this.speed > 7) {
      this.engineBrakeTimer = 0.52;
      this.backfireEvent = Math.max(this.backfireEvent, 0.85);
    }
    return true;
  }

  torqueAt(rpm) {
    const s = this.spec;
    const x = clamp((rpm - s.idle) / (s.redline - s.idle), 0, 1);
    let shape;
    if (s.audio === 'boxer') shape = 0.78 + 0.52 * x - 0.34 * x * x;
    else if (s.audio === 'i4') shape = 0.44 + 1.08 * x - 0.48 * x * x;
    else shape = 0.56 + 0.96 * x - 0.48 * x * x;
    return s.torque * clamp(shape, 0.34, 1.08);
  }

  compoundGrip(temp, pressure = 2.3) {
    const c = COMPOUNDS[this.setup.compound] || COMPOUNDS.medium;
    let f;
    if (temp < c.peak) f = c.cold + (1.06 - c.cold) * clamp((temp - 20) / (c.peak - 20), 0, 1);
    else f = 1.06 - 0.20 * clamp((temp - c.peak) / 55, 0, 1);
    const pDiff = (pressure - 2.30) / 0.50;
    const pressureFactor = 1.0 - 0.045 * pDiff * pDiff;
    return clamp(f * pressureFactor, 0.80, 1.08);
  }

  update(dt, input, track) {
    const spec = this.spec;
    this.time += dt;
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    this.engineBrakeTimer = Math.max(0, this.engineBrakeTimer - dt);
    this.clutchPopBoost = Math.max(0, this.clutchPopBoost - dt * 2.4);

    if (this.crashed) { this._updateCrash(dt, track); return; }

    this.prevClutch = this.clutch;

    // Instant throttle cut when braking (except standing burnout < 2.4 m/s)
    const isStandingBurnout = (input.frontBrake > 0.40 && input.throttle > 0.40 && this.speed < 2.4);
    const effectiveThrottleInput = (!isStandingBurnout && input.frontBrake > 0.08) ? 0 : input.throttle;

    // Smooth, progressive keyboard & manual-lean shaping (low center sensitivity, crisp countersteer/return)
    const agiScale = spec.id === 'i4' ? 1.12 : spec.id === 'v4' ? 1.04 : 0.90;
    this.throttle = approach(this.throttle, effectiveThrottleInput, 11.0, 19.0, dt);
    this.frontBrake = approach(this.frontBrake, input.frontBrake, 14.5, 22.0, dt);
    this.rearBrake = approach(this.rearBrake, input.rearBrake, 14.0, 20.0, dt);
    this.clutch = approach(this.clutch, input.clutch, 14.0, 20.0, dt);

    const steerSameDir = Math.abs(input.steer) > 0.05 && Math.sign(input.steer) === signOr(this.steer, Math.sign(input.steer));
    const steerRise = steerSameDir
      ? (2.9 + 2.3 * Math.min(1, Math.abs(this.steer) * 1.45)) * agiScale
      : 6.4 * agiScale;
    this.steer = approach(this.steer, input.steer, steerRise, 6.4 * agiScale, dt);

    const wxRise = 2.8 + 1.8 * Math.min(1, Math.abs(this.weightX));
    const wyRise = 2.6 + 1.8 * Math.min(1, Math.abs(this.weightY));
    this.weightX = approach(this.weightX, input.weightX, wxRise, 5.2, dt);
    this.weightY = approach(this.weightY, input.weightY, wyRise, 4.8, dt);

    if (this.prevClutch > 0.45 && input.clutch < 0.20 && this.rpm > spec.redline * 0.48 && this.throttle > 0.42) {
      this.clutchPopBoost = 0.72;
    }

    // Decompose current world velocity into bike frame
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    this.vLong = this.velX * fwdX + this.velZ * fwdZ;
    this.vLat = this.velX * rightX + this.velZ * rightZ;
    if (this.vLong < 0.25 && this.frontBrake > 0.3 && Math.abs(this.vLong) < 0.35) {
      this.vLong = 0;
    }

    // ---------------- Surface detection ----------------
    const preIdx = track.nearestIndex(this.pos, this.trackIndex);
    this.trackIndex = preIdx;
    const preSample = track.samples[preIdx];
    const latOffset = track.lateralAt(this.pos, preIdx);
    const absLat = Math.abs(latOffset);
    const hw = track.halfWidth;
    if (absLat <= hw - 0.10) this.surface = 'asphalt';
    else if (absLat <= hw + 0.92) this.surface = 'curb';
    else if (absLat <= hw + 1.80) this.surface = 'apron';
    else this.surface = 'grass';
    this.offroad = this.surface === 'grass';

    // ---------------- Engine / Drivetrain / Shifting ----------------
    const ratio = spec.gears[this.gear - 1] * spec.final * this.setup.gearing * 0.96;
    const wheelOmega = Math.max(0, this.vLong) / spec.wheelR;
    const spinOmega = this.spin * 18.0 + (this.burnout ? 44 : 0);
    const gearedRpm = (wheelOmega + spinOmega * 0.35) * ratio * 60 / (Math.PI * 2);

    let clutchEng = 1 - this.clutch * 0.96;
    const launchFloorRpm = (this.throttle > 0.25 && this.vLong < 12.0 && this.clutch < 0.4)
      ? spec.idle + this.throttle * (spec.redline - spec.idle) * 0.48 * clamp(1 - this.vLong / 12.0, 0, 1)
      : 0;
    if (this.vLong < 4.5 && this.throttle > 0.08 && this.clutch < 0.5) {
      clutchEng *= clamp(0.55 + this.vLong / 8.0, 0.55, 1.0);
    }
    const freeRpm = spec.idle + this.throttle * (spec.redline - spec.idle) * 0.98;
    let rpmTarget = Math.max(spec.idle, launchFloorRpm, gearedRpm * clutchEng + (1 - clutchEng) * freeRpm);
    if (this.clutch > 0.72 || this.burnout) rpmTarget = Math.max(rpmTarget, freeRpm);
    this.rpm += (rpmTarget - this.rpm) * Math.min(1, dt * (this.clutch > 0.45 || this.burnout ? 13 : 26));

    // Soft ignition rev limiter bounce + subtle fuel-cut sputter
    this.limiter = false;
    if (this.rpm >= spec.redline * 0.992) {
      this.limiter = true;
      const bounce = (Math.sin(this.time * 52) * 0.5 + 0.5);
      this.rpm = spec.redline * (0.978 + bounce * 0.022);
      if (this._popTimer <= 0 && this.throttle > 0.65) {
        if (Math.random() < 0.35) this.backfireEvent = Math.max(this.backfireEvent, 0.32);
        this._popTimer = 0.24 + Math.random() * 0.22;
      }
    }

    let torque = this.torqueAt(this.rpm) * this.throttle;
    if (this.limiter && !this.burnout) torque *= 0.22;
    let drive = (torque * ratio / spec.wheelR) * clutchEng * 0.76 * (1 + this.clutchPopBoost * 0.48);

    // Smart automatic shifting
    if (this.shiftCooldown <= 0 && !this.burnout && this.clutch < 0.30) {
      if (this.rpm > spec.redline * 0.935 && this.gear < 6 && this.throttle > 0.25) {
        this.shiftUp();
      } else if (this.gear > 1 && this.vLong > 2.2) {
        const downRatio = spec.gears[this.gear - 2] / spec.gears[this.gear - 1];
        const projectedRpm = this.rpm * downRatio;
        if (this.rpm < spec.redline * 0.43 && projectedRpm < spec.redline * 0.85) {
          this.gear--;
          this.rpm = Math.min(spec.redline * 0.95, projectedRpm * 0.95);
          this.shiftCooldown = 0.16;
          this.shiftEvent = 1;
          if (this.frontBrake > 0.25 && this.vLong > 9) {
            this.engineBrakeTimer = 0.42;
            if (Math.random() < 0.32) {
              this.backfireEvent = Math.max(this.backfireEvent, 0.46 + Math.random() * 0.22);
            }
          }
        }
      }
    }

    // Deceleration overrun burble & occasional realistic exhaust pops/bangs (only sometimes!)
    const rpmFrac = clamp((this.rpm - spec.idle) / (spec.redline - spec.idle), 0, 1);
    const isOverrun = (this.throttle < 0.10 && rpmFrac > 0.42 && this.vLong > 8.0 && !this.burnout);
    this.overrun = damp(this.overrun, isOverrun ? clamp(rpmFrac * 1.10, 0, 1) : 0, 10, dt);
    this._popTimer -= dt;
    if (isOverrun && this._popTimer <= 0) {
      this._popTimer = 1.25 + Math.random() * 2.25;
      if (Math.random() < 0.40) {
        const strength = clamp(0.28 + rpmFrac * 0.34 + (this.engineBrakeTimer > 0 ? 0.12 : 0), 0.28, 0.72);
        this.backfireEvent = Math.max(this.backfireEvent, strength);
      }
    }

    // ---------------- Tires, Surface & Dynamic Weight Transfer ----------------
    const c = COMPOUNDS[this.setup.compound] || COMPOUNDS.medium;
    const avgF = (this.tempF[0] + this.tempF[1] + this.tempF[2]) / 3;
    const avgR = (this.tempR[0] + this.tempR[1] + this.tempR[2]) / 3;
    const surfMu = this.surface === 'asphalt' ? 1.0 : this.surface === 'curb' ? 0.94 : this.surface === 'apron' ? 0.80 : 0.56;
    const muF = c.mu * this.compoundGrip(avgF, this.setup.pressureF) * surfMu;
    const muR = c.mu * this.compoundGrip(avgR, this.setup.pressureR) * surfMu;

    const mass = this.mass;
    const L = spec.wheelbase;
    const staticF = mass * G * (1 - spec.rearBias);
    const staticR = mass * G * spec.rearBias;
    const dynTransfer = clamp(mass * this.accel * (spec.comH * 0.92) / L + mass * G * this.weightY * 0.085, -staticR * 0.86, staticF * 0.92);
    const Nf = Math.max(85, staticF - dynTransfer);
    const Nr = Math.max(85, staticR + dynTransfer);
    this.loadF = Nf / (mass * G);
    this.loadR = Nr / (mass * G);

    // Kamm's Circle capacity at rear contact patch + Manual Hang-Off skill bonus
    const leanRatio = clamp(Math.abs(Math.sin(this.lean)) / 0.84, 0, 1);
    const hangAlign = Math.abs(this.lean) > 0.14 ? clamp(this.weightX * Math.sign(this.lean), -1, 1) : 0;
    const latUsageR = leanRatio * clamp(0.78 - hangAlign * 0.09, 0.66, 0.86);
    const kammLongR = Math.sqrt(Math.max(0.18, 1 - latUsageR * latUsageR));
    const maxLongR = muR * Nr * kammLongR;

    // Anti-Wheelie throttle modulation (AW 1..3 modulates above threshold pitch unless manually leaning back)
    let awGain = 1.0;
    if (this.pitch > 0.12 && this.setup.aw > 0 && this.weightY >= -0.25) {
      const pitchMax = this.setup.aw === 3 ? 0.16 : this.setup.aw === 2 ? 0.44 : 0.62;
      if (this.pitch > pitchMax * 0.72) {
        awGain = clamp(1 - (this.pitch - pitchMax * 0.72) / Math.max(0.08, pitchMax * 0.40), 0.22, 1.0);
      }
    }
    drive *= awGain;

    // Traction Control & Burnout / Wheelspin
    this.burnout = false;
    if (isStandingBurnout) {
      this.burnout = true;
      this.spin = clamp(this.spin + dt * 5.0, 0, 2.0);
      drive = 0;
    } else {
      const tcAllow = this.setup.tc === 0 ? 0.96 : this.setup.tc === 1 ? 1.14 : this.setup.tc === 2 ? 1.05 : 0.95;
      const limitDrive = maxLongR * tcAllow;
      if (drive > limitDrive && (Math.abs(this.lean) > 0.25 || this.setup.tc === 0)) {
        if (this.setup.tc >= 2) {
          drive = damp(drive, limitDrive, 18, dt);
          this.spin = Math.max(0, this.spin - dt * 5.0);
        } else {
          const baseSlip = this.setup.tc === 0 ? maxLongR * 0.90 : maxLongR * 1.05;
          const excess = Math.max(0.05, (drive - baseSlip) / Math.max(1, maxLongR));
          this.spin = clamp(this.spin + excess * dt * (this.setup.tc === 0 ? 5.2 : 4.2), 0, this.setup.tc === 0 ? 1.65 : 1.05);
          drive = maxLongR * (Math.abs(this.lean) > 0.25 ? 0.98 : (1 + Math.min(0.16, this.spin * 0.10)));
        }
      } else {
        this.spin = Math.max(0, this.spin - dt * 6.5);
      }
    }

    // ---------------- Brakes, ABS & Suspension ----------------
    // Strong front brake (~23.5 m/s^2 max) + rear brake + engine braking
    let brakeScaleF = 1.0;
    const maxBrakeF = muF * Nf * 1.85; // calibrated for compact diorama scale
    if (this.setup.abs > 0 && Math.abs(this.lean) > 0.48 && this.frontBrake > 0.5) {
      const leanPenalty = clamp((Math.abs(this.lean) - 0.48) / 0.42, 0, 1);
      brakeScaleF = 1 - leanPenalty * (this.setup.abs >= 2 ? 0.34 : 0.20);
    }
    const frontBrakeForce = this.frontBrake * 23.5 * mass * surfMu * brakeScaleF;
    const rearBrakeForce = this.rearBrake * 8.8 * mass * surfMu;

    if (this.setup.abs === 0 && this.frontBrake > 0.88 && Math.abs(this.lean) > 0.68 && this.vLong > 9) {
      this.frontLock = clamp(this.frontLock + dt * 3.5, 0, 0.7);
      this._frontWashTimer += dt;
      if (this._frontWashTimer > 0.52) {
        this._crash('lowsider');
        return;
      }
    } else {
      this.frontLock = Math.max(0, this.frontLock - dt * 5.0);
      this._frontWashTimer = Math.max(0, this._frontWashTimer - dt * 2.0);
    }

    const curbBump = (this.surface === 'curb' && this.vLong > 5)
      ? Math.sin(this.distance * 5.8) * (0.014 / this.setup.springF) : 0;
    const springComp = 1.0 / (0.4 + 0.6 * this.setup.springF);
    const dampLambda = 14.0 * this.setup.damping;
    this.forkDive = damp(this.forkDive, clamp((this.frontBrake * 0.068 - this.throttle * 0.022) * springComp + curbBump, -0.025, 0.085), dampLambda, dt);
    this.suspF = this.forkDive;
    this.suspR = damp(this.suspR, clamp((this.throttle * 0.045 - this.frontBrake * 0.025) / (0.4 + 0.6 * this.setup.springR) - curbBump * 0.7, -0.03, 0.06), dampLambda, dt);

    // ---------------- Longitudinal Acceleration ----------------
    const aeroDrag = 0.5 * 1.2 * 0.52 * this.vLong * Math.abs(this.vLong) / mass;
    const rollingRes = 0.20 + (this.offroad ? 4.8 + this.vLong * 0.34 : this.surface === 'apron' ? 0.9 : 0);
    const engBrake = (1 - this.throttle) * (this.rpm / spec.redline) * (2.5 + (this.engineBrakeTimer > 0 ? 1.8 : 0));
    const clampedFBrake = Math.min(frontBrakeForce / mass, maxBrakeF / mass * 1.15);
    const aLong = (drive / mass) - clampedFBrake - (rearBrakeForce / mass) - engBrake - aeroDrag - rollingRes;
    this.accel = aLong;

    this.vLong = Math.max(0, this.vLong + aLong * dt);
    if (this.burnout) { this.vLong = 0; this.vLat = 0; }

    // ---------------- Smooth, Progressive Leaning & Lowside Drop ----------------
    const speedFactor = clamp(this.vLong / 3.8, 0, 1);
    const gripFactor = clamp(surfMu * 1.02, 0.62, 1.02);
    const trailBite = clamp(this.frontBrake * 0.16 * (1 - Math.abs(this.lean) * 0.5), 0, 0.14);
    const maxLeanAngle = spec.maxLean * gripFactor;
    this.leanLimit = maxLeanAngle;

    // Progressive non-linear steering curve + manual hang-off / slide lean coupling
    const sAbs = Math.abs(this.steer);
    const curvedSteer = Math.sign(this.steer) * (0.34 * sAbs + 0.66 * Math.pow(sAbs, 1.48));
    const curSlipPre = this.vLong > 3.5 ? Math.atan2(this.vLat, this.vLong) : 0;
    const preLeanSign = signOr(this.lean, 0);
    const oversteerAnglePre = Math.max(0, -curSlipPre * preLeanSign);
    const slideLeanDrop = preLeanSign * clamp((oversteerAnglePre - 0.16) * 0.55, 0, 0.36);
    const hangBonusLean = hangAlign > 0 ? hangAlign * 0.045 : hangAlign * 0.035;
    const leanTarget = clamp(curvedSteer * (maxLeanAngle + hangBonusLean) * speedFactor + slideLeanDrop, -maxLeanAngle * 1.28, maxLeanAngle * 1.28);

    // Silky-smooth critically damped roll dynamics (zero keyboard twitchiness)
    const omegaN = 6.2 * agiScale * (1 + trailBite * 0.7 + Math.max(0, hangAlign) * 0.06);
    const zeta = 0.96;
    const rollAcc = (leanTarget - this.lean) * (omegaN * omegaN) - 2 * zeta * omegaN * this.leanVel;
    this.leanVel = clamp(this.leanVel + rollAcc * dt, -3.0, 3.0);
    this.lean = clamp(this.lean + this.leanVel * dt, -1.24, 1.24);

    // ---------------- 2D Lateral Physics & Continuous Runaway Rear-Slide Rotation ----------------
    // Active rider Hang-Off inside the corner tightens turning arc (+9.5%)!
    const turnGain = 2.06 * (1 + trailBite + hangAlign * 0.095);
    const desiredYawRate = -(G * Math.tan(clamp(this.lean, -1.0, 1.0)) / Math.max(this.vLong, 4.2)) * turnGain;

    const absLean = Math.abs(this.lean);
    const leanSign = signOr(this.lean, 0);
    const slipDir = leanSign !== 0 ? leanSign : signOr(this.steer, 0);

    // Compute triggers that break rear lateral traction while leaned over
    const rearBrakeSlide = (this.rearBrake * 0.88 + (this.engineBrakeTimer > 0 && this.frontBrake > 0.35 ? 0.45 : 0)) * (0.25 + absLean * 1.05);
    const powerOverDrive = (this.throttle > 0.72 && absLean > 0.52 && this.vLong > 7 && this.setup.tc <= 1)
      ? clamp((this.throttle - 0.68) * (absLean - 0.48) * (this.setup.tc === 0 ? 3.2 : 1.75) + this.spin * 0.55, 0, 1.45)
      : 0;
    const offroadSlide = (this.offroad && absLean > 0.25 && this.vLong > 7) ? (0.45 + absLean * 0.85) : 0;
    const slideDrive = clamp(rearBrakeSlide + powerOverDrive + offroadSlide, 0, 1.65);

    // Countersteer by rider (opposite to lean direction) arrests runaway rear spinout!
    const counterSteer = leanSign !== 0 ? clamp(-this.steer * leanSign, 0, 1) : 0;
    const tcAssist = this.setup.tc >= 2 ? (this.setup.tc === 3 ? 0.9 : 0.55) : 0;

    // Continuous yaw rotation torque when rear slides in lean (angle keeps changing until recovered or crash!)
    const oversteerAngle = leanSign !== 0 ? Math.max(0, -curSlipPre * leanSign) : Math.abs(curSlipPre);
    let slideYawAdd = 0;
    if (this.vLong > 5.0 && slipDir !== 0 && slideDrive > 0.22) {
      const runawayFactor = 1.0 + Math.max(0, oversteerAngle - 0.18) * 1.6;
      const dampOut = counterSteer * 1.35 + (rearBrakeSlide < 0.2 ? tcAssist * 0.85 : 0);
      const netSlideTorque = Math.max(0, slideDrive * runawayFactor - dampOut);
      // Negative yaw changes rotate clockwise for right lean (+leanSign) so bike turns further sideways!
      slideYawAdd = -slipDir * netSlideTorque * 0.76;
    }

    // Track previous forward velocity before updating yaw so momentum swings naturally into vLat!
    const preVelX = fwdX * this.vLong + rightX * this.vLat;
    const preVelZ = fwdZ * this.vLong + rightZ * this.vLat;

    this.yawRate = damp(this.yawRate, desiredYawRate + slideYawAdd, 13, dt);
    this.yaw += this.yawRate * dt;

    // Project pre-rotation world momentum onto new bike axes (natural yaw->slip coupling!)
    const nFwdX = -Math.sin(this.yaw);
    const nFwdZ = -Math.cos(this.yaw);
    const nRightX = Math.cos(this.yaw);
    const nRightZ = -Math.sin(this.yaw);
    const projLong = preVelX * nFwdX + preVelZ * nFwdZ;
    let projLat = preVelX * nRightX + preVelZ * nRightZ;

    // During active rear slide, rear lateral restoring grip collapses so bike angle keeps drifting sideways!
    // When rider releases rear brake / countersteers / eases gas, rear lateral grip pulls bike smoothly straight.
    const gripRecoveryRate = clamp((8.5 - slideDrive * 6.8 + counterSteer * 7.5 + (rearBrakeSlide < 0.15 ? tcAssist * 6.0 : 0)) * surfMu, 0.45, 13.5);
    projLat *= Math.exp(-gripRecoveryRate * dt);

    // Subtle lateral scrub deceleration proportional to slip angle during deep slides
    const slideScrub = Math.abs(projLat) * (0.25 + slideDrive * 0.25) * dt;
    this.vLong = Math.max(0, projLong - slideScrub);
    this.vLat = projLat;

    const slipFade = smoothstep(2.0, 5.5, Math.hypot(this.vLong, this.vLat));
    const curSlip = slipFade > 0.01 ? Math.atan2(this.vLat, Math.max(0.5, this.vLong)) * slipFade : 0;
    this.slipAngle = curSlip;

    // Expose telemetry slide magnitudes cleanly for FX, audio, HUD & networking
    const curOversteer = Math.abs(curSlip);
    const brakeSlideT = (this.vLong > 6 && absLean > 0.18 && rearBrakeSlide > 0.20)
      ? clamp(curOversteer * 1.45 + rearBrakeSlide * 0.20, 0, 1.1) : 0;
    this.brakeSlide = damp(this.brakeSlide, brakeSlideT, 12, dt);
    const exitDriftT = clamp(curOversteer * 1.45 + this.spin * 0.20, 0, 1.1);
    this.drift = damp(this.drift, Math.max(exitDriftT, this.brakeSlide), 12, dt);

    // Lowsider crash when continuous slide rotates past ~56 deg (0.98 rad) OR lean drops past scrape limit (~67 deg)
    if (this.vLong > 6.5 && (curOversteer > 0.98 || absLean > 1.16)) {
      this._crash('lowsider');
      return;
    }

    // Highsider crash if TC=0 and rider snaps off throttle violently from a huge >38 deg slide at high speed
    if (this.setup.tc === 0 && curOversteer > 0.66 && this.vLong > 20 && this.throttle < 0.05 && this.rearBrake < 0.1) {
      this._highsideWarn += dt;
      if (this._highsideWarn > 0.22) {
        this._crash('highsider');
        return;
      }
    } else {
      this._highsideWarn = Math.max(0, this._highsideWarn - dt * 3.5);
    }

    // Authentic Countersteer + Drift Opposite-Lock handlebar angle (`steerVis`)
    const rollPulse = clamp((this.lean - leanTarget) * 0.42, -0.18, 0.18);
    const lowSpeedSteer = this.steer * 0.36 * (1 - clamp(this.vLong / 48, 0, 0.75));
    const driftCounter = curSlip * 0.88; // negative curSlip on right drift turns front wheel LEFT along travel vector
    this.steerVis = damp(this.steerVis, clamp(lowSpeedSteer + rollPulse + driftCounter, -0.58, 0.58), 18, dt);

    // ---------------- Authentic Pitch Torque: Manual Arrow Lean Wheelie, Stoppie & Power-Wheelie ----------------
    const driveAccel = Math.max(0, drive / mass);
    const staticPitchThresh = G * (1 - spec.rearBias) * (L / spec.comH);
    const riderPull = this.weightY < -0.20 ? (-this.weightY * 5.6) : 0;
    const clutchImpulse = this.clutchPopBoost * 5.5;
    const effectiveWheelieRatio = (driveAccel + riderPull + clutchImpulse) / Math.max(1, staticPitchThresh);

    const canStuntLean = Math.abs(this.lean) < 0.42;
    const manualLeanBack = clamp((-this.weightY - 0.18) / 0.82, 0, 1);
    const isManualWheelie = (manualLeanBack > 0.05 || this.clutchPopBoost > 0.1) && this.throttle > 0.35 && this.vLong > 1.8 && canStuntLean;
    const isPowerWheelie = (this.weightY <= 0.18) && (effectiveWheelieRatio > 1.04 || (this.throttle > 0.88 && this.gear <= 2)) && this.vLong > 2.2 && this.vLong < 30 && Math.abs(this.lean) < 0.30 && this.setup.aw <= 2;
    const isStoppie = (this.weightY > 0.20 || (this.setup.abs === 0 && this.weightY > -0.1)) && this.frontBrake > 0.45 && this.vLong > 2.8 && Math.abs(this.lean) < 0.32;

    let pitchAcc = 0;
    if (isManualWheelie) {
      const awCapW = this.setup.aw === 0 ? 0.82 : this.setup.aw === 1 ? 0.74 : 0.64;
      const pullAmt = Math.max(manualLeanBack, clamp(this.clutchPopBoost, 0, 1));
      const targetW = 0.26 + (awCapW - 0.26) * pullAmt;
      pitchAcc = (targetW - this.pitch) * 10.8 - this.pitchVel * 4.0 - this.rearBrake * 10.5;
    } else if (isPowerWheelie) {
      const bikePunch = spec.id === 'v4' ? 1.18 : spec.id === 'boxer' ? 1.02 : 0.94;
      const awCap = this.setup.aw === 0 ? 0.50 : this.setup.aw === 1 ? 0.40 : 0.30;
      const powerTarget = clamp((this.gear === 1 ? 0.34 : 0.22) * bikePunch, 0.12, awCap);
      pitchAcc = (powerTarget - this.pitch) * 6.5 - this.pitchVel * 4.2 - this.rearBrake * 8.0;
    } else if (isStoppie) {
      const fwdLeanAmt = this.weightY > 0.20 ? clamp((this.weightY - 0.15) / 0.85, 0.55, 1.0) : 0.48;
      const targetS = -0.37 * clamp(this.frontBrake, 0.45, 1.0) * fwdLeanAmt;
      pitchAcc = (targetS - this.pitch) * 12.2 - this.pitchVel * 3.8;
    } else {
      // Smooth gravity return + hydraulic fork damping (leaning forward pulls front wheel back down quicker!)
      const noseDownAssist = this.pitch > 0 && this.weightY > 0.15 ? (this.weightY * 6.5) : 0;
      pitchAcc = -this.pitch * 12.5 - this.pitchVel * 6.2 - (this.pitch > 0 ? 1.6 + noseDownAssist : 0);
    }

    this.pitchVel = (this.pitchVel + pitchAcc * dt) * Math.max(0, 1 - 3.0 * dt);
    this.pitch = clamp(this.pitch + this.pitchVel * dt, -0.38, 0.86);
    if ((this.pitch === 0.86 && this.pitchVel > 0) || (this.pitch === -0.38 && this.pitchVel < 0)) {
      this.pitchVel = 0;
    }
    if (this.setup.aw === 0 && this.pitch > 0.85 && this.throttle > 0.95 && isManualWheelie && this.vLong > 6) {
      // Rare loop-out only at extreme vertical + max throttle + AW OFF
      // Kept generous so wheelies feel awesome!
    }

    // ---------------- World Velocity Integration ----------------
    this.velX = nFwdX * this.vLong + nRightX * this.vLat;
    this.velZ = nFwdZ * this.vLong + nRightZ * this.vLat;
    this.speed = Math.hypot(this.velX, this.velZ);

    this.pos.x += this.velX * dt;
    this.pos.z += this.velZ * dt;
    this.pos.y = 0.03;

    // Barrier collision with gentle glancing recovery & heavy impact crash
    const idx = track.nearestIndex(this.pos, this.trackIndex);
    this.trackIndex = idx;
    const s = track.samples[idx];
    const lateral = track.lateralAt(this.pos, idx);
    const barrierDist = hw + 2.05;
    if (Math.abs(lateral) > barrierDist) {
      const sign = Math.sign(lateral);
      this.pos.x = s.p.x + s.r.x * sign * barrierDist;
      this.pos.z = s.p.z + s.r.z * sign * barrierDist;
      const trackYaw = Math.atan2(-s.t.x, -s.t.z);
      let angleDiff = trackYaw - this.yaw;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      if (Math.abs(angleDiff) > 0.85 && this.speed > 26) {
        this._crash('barrier');
        return;
      } else {
        this.yaw += angleDiff * 0.45;
        this.vLong *= 0.84;
        this.vLat *= 0.35;
        this.lean *= 0.45;
        this.velX = -Math.sin(this.yaw) * this.vLong;
        this.velZ = -Math.cos(this.yaw) * this.vLong;
      }
    }

    // ---------------- Multi-Zone Tire Thermodynamics ----------------
    const pHeatF = 1 + clamp((2.3 - this.setup.pressureF) * 0.4, -0.15, 0.25);
    const pHeatR = 1 + clamp((2.3 - this.setup.pressureR) * 0.4, -0.15, 0.25);
    const spd = this.speed;
    const amb = 40;
    const baseF = (this.frontBrake * spd * 0.032 + Math.abs(this.lean) * 3.2 + 0.4) * c.heat * pHeatF;
    const baseR = (this.spin * 12 + this.drift * 22 + this.brakeSlide * 16 + (this.burnout ? 26 : 0) + 0.5) * c.heat * pHeatR;
    const heatF = Math.min(11, baseF);
    const heatR = Math.min(15, baseR);
    const bias = clamp(this.lean / 0.85, -1, 1);
    const coolRate = 0.004 + spd * 0.0005;

    const fz = [heatF * (1 - 0.38 * bias), heatF * (1 + this.frontBrake * 0.25), heatF * (1 + 0.38 * bias)];
    const rz = [heatR * (1 - 0.42 * bias), heatR * (1 + this.spin * 0.45), heatR * (1 + 0.42 * bias)];
    for (let i = 0; i < 3; i++) {
      this.tempF[i] = clamp(this.tempF[i] + (fz[i] - (this.tempF[i] - amb) * coolRate) * dt, 30, 145);
      this.tempR[i] = clamp(this.tempR[i] + (rz[i] - (this.tempR[i] - amb) * coolRate) * dt, 30, 155);
    }

    this.rearWheelOmega = (this.vLong / spec.wheelR) * (1 + this.spin * 2.2) + (this.burnout ? 38 : 0);
    this.frontWheelOmega = (this.vLong / spec.wheelR) * (1 - this.frontLock * 0.85);
    this.distance += spd * dt;
  }

  _crash(type) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashType = type;
    this.crashTimer = 0;
    this.crashRollVel = signOr(this.lean, 1) * 2.8;
    this.crashPitchVel = 1.4;
    this.crashYawVel = (Math.random() - 0.5) * 2.2;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.crashSlide.copy(fwd).multiplyScalar(this.speed * 0.55);
    this.crashSlide.y = 1.8;
  }

  _updateCrash(dt, track) {
    this.crashTimer += dt;
    this.speed *= Math.max(0, 1 - dt * 2.2);
    this.pos.x += -Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += -Math.cos(this.yaw) * this.speed * dt;
    this.pos.y = 0.03;
    this.crashRoll += this.crashRollVel * dt;
    this.crashRollVel *= 1 - dt * 1.4;
    this.crashPitch += this.crashPitchVel * dt;
    this.crashPitchVel *= 1 - dt * 1.6;
    this.yaw += this.crashYawVel * dt;
    this.crashYawVel *= 1 - dt * 2.0;
    this.trackIndex = track.nearestIndex(this.pos, this.trackIndex);
  }

  get speedKmh() { return this.speed * 4.5; }
}
