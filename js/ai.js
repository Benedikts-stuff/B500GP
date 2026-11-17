/* APEX — AI riders. They ride the same physics as the player, through the same three inputs. */
(function (root) {
  'use strict';
  const AX = root.AX;
  const { clamp, lerp, damp, smoothstep, mod, G } = AX;

  class AIRider {
    constructor(bike, track, pace, seed) {
      this.bike = bike; this.track = track; this.pace = pace;
      this.rng = AX.RNG(seed || 7);
      this.profile = track.speedProfile(bike.spec, pace);
      this.lane = 0; this.laneT = 0;
      this.react = 0.12 + this.rng() * 0.3;     // reaction to the start lights
      this.bias = this.rng.range(-0.5, 0.5);    // personal line preference
      this.mistakeT = 6 + this.rng() * 20; this.lift = 0; this.aggr = this.rng();
      this.inp = { steer: 0, throttle: 0, brake: 0, analog: true, bodyX: 0, bodyY: 0 };
    }

    update(dt, bikes, raceTime) {
      const b = this.bike, t = this.track, N = t.n, inp = this.inp;
      if (b.crashed) { inp.steer = 0; inp.throttle = 0; inp.brake = 0; return inp; }
      if (raceTime < this.react) { inp.steer = 0; inp.throttle = 0; inp.brake = 1; return inp; }
      const v = b.speed, idx = b.idx;

      // ---- traffic: pick a lateral offset from the racing line
      let laneT = this.bias * 0.6, block = 0;
      const myD = b.d;
      for (let k = 0; k < bikes.length; k++) {
        const o = bikes[k]; if (o === b || o.crashed && o.speed < 2 && Math.abs(o.d) > t.hw) continue;
        let ahead = o.sPrev - b.sPrev; const L = t.length; if (ahead > L / 2) ahead -= L; else if (ahead < -L / 2) ahead += L;
        const dl = o.d - myD;
        if (ahead > -2.5 && ahead < 5 + v * 0.55) {
          const closing = v - o.speed;
          if (ahead > 2 && Math.abs(dl) < 2.4 && closing > -1.5) {
            // go for the side with more room
            const sideRoom = o.d > 0 ? -1 : 1;
            const want = o.d + sideRoom * 2.9 - t.ld[idx];
            if (Math.abs(want) > Math.abs(laneT)) laneT = want;
            if (ahead < 4 + closing * 0.9 && Math.abs(dl) < 1.5) block = Math.max(block, clamp((closing + 1) / 6, 0.1, 1));
          } else if (Math.abs(ahead) <= 2.5 && Math.abs(dl) < 2.3) {
            laneT += (dl > 0 ? -1 : 1) * 1.6;        // alongside: give room
          }
        }
      }
      this.lane = damp(this.lane, laneT, 1.6, dt);

      // ---- steering: pure pursuit towards a point on the (offset) line
      const look = 5.5 + v * 0.45;
      const ti = mod(idx + Math.round(look / t.ds), N);
      const lim = t.hw - 1.3;
      const td = clamp(t.ld[ti] + this.lane, -lim, lim);
      const tx = t.px[ti] + t.nx[ti] * td - b.x, tz = t.pz[ti] + t.nz[ti] * td - b.z;
      const fx = Math.cos(b.yaw), fz = Math.sin(b.yaw);
      const lf = tx * fx + tz * fz, ll = -tx * fz + tz * fx;
      const dist2 = lf * lf + ll * ll;
      const kappa = dist2 > 1 ? 2 * ll / dist2 : 0;
      const sd = AX.SURF_DATA[b.surf];
      const Gr = b.spec.mu * G * sd.grip;
      let lm = b.spec.maxLean * Math.PI / 180 * smoothstep(0.8, 8.5, v);
      lm = Math.min(lm, Math.atan(0.985 * Gr / G));
      const leanDes = Math.atan(v * v * kappa / G);
      const sLean = lm > 0.01 ? leanDes / lm : 0;
      const sLow = v > 0.3 ? kappa * v / (2.3 * clamp(v / 3, 0.1, 1)) : 0;
      inp.steer = clamp(lerp(sLow, sLean, smoothstep(2.5, 8.5, v)), -1, 1);
      // hang off into the corner (look ahead so the body is across before the bike leans)
      const kAhead = t.lk[mod(idx + Math.round(v * 0.7 / t.ds), N)];
      const want = Math.abs(inp.steer) > 0.12 ? Math.sign(inp.steer) : (Math.abs(kAhead) > 1 / 160 ? Math.sign(kAhead) : 0);
      inp.bodyX = want * (0.75 + 0.25 * this.aggr);

      // ---- speed
      const lead = 2 + Math.round(v * 0.16);
      let vT = this.profile[mod(idx + lead, N)];
      // penalise being off the line while turning hard
      const offLine = Math.abs(b.d - t.ld[idx] - this.lane);
      vT *= 1 - clamp((offLine - 2.5) * 0.02, 0, 0.12);
      if (b.surf >= 2 && b.surf <= 3) vT = Math.min(vT, 26);
      this.mistakeT -= dt;
      if (this.mistakeT < 0) { this.mistakeT = 8 + this.rng() * 25; this.lift = 0.25 + this.rng() * 0.35; }
      if (this.lift > 0) { this.lift -= dt; vT *= 0.955; }
      const err = vT - v;
      if (err < -0.6) { inp.brake = clamp(-err * 0.3, 0, 1); inp.throttle = 0; }
      else { inp.brake = 0; inp.throttle = clamp(err * 0.6 + 0.25, 0, 1); }
      // roll the throttle on along the edge of the traction circle
      const uT = 1.0 + this.aggr * 0.05;
      const trac = b.Gr * 0.98 * Math.sqrt(Math.max(0, uT * uT - b.latFrac * b.latFrac));
      inp.throttle = Math.min(inp.throttle, trac / Math.max(b.aFull, 1));
      // keep the front wheel down whenever the bike has to turn
      const straight = Math.abs(inp.steer) < 0.1 && Math.abs(t.lk[mod(idx + Math.round(v * 0.9), N)]) < 1 / 400;
      if (!straight) inp.throttle = Math.min(inp.throttle, b.aWheelie0 * 0.97 / Math.max(b.aFull, 1));
      // out of steering lock: stop feeding it
      inp.throttle *= 1 - 0.85 * smoothstep(0.86, 1.0, Math.abs(inp.steer));
      inp.bodyY = inp.brake > 0.3 ? -0.6 : (Math.abs(inp.steer) < 0.1 && inp.throttle > 0.8 ? 1 : 0.5);
      // after the summit finish: roll off and stop
      if (b.finished && t.open) { inp.throttle = 0; inp.brake = b.speed > 2 ? 0.6 : 0.2; inp.bodyY = 0; return inp; }
      if (block > 0) { inp.throttle *= 1 - block; if (block > 0.5) inp.brake = Math.max(inp.brake, (block - 0.5) * 0.8); }
      return inp;
    }
  }
  AX.AIRider = AIRider;
  if (typeof module !== 'undefined' && module.exports) module.exports = AX;
})(typeof globalThis !== 'undefined' ? globalThis : window);
