/* APEX — track: spline circuits, surfaces, barriers, racing line, speed profile.
   No rendering code in here (shared by game, AI and headless tests). */
(function (root) {
  'use strict';
  const AX = root.AX;
  const { clamp, mod, SURF } = AX;

  /* Circuits are original layouts. Coordinates in metres, x = east, z = south,
     driven clockwise. pts[0] is the start/finish line, on the main straight. */
  AX.TRACKS = {
    kiefern: {
      id: 'kiefern', name: 'KIEFERNRING', sub: { de: 'Flüssiger Waldkurs', en: 'Flowing forest circuit' },
      width: 13, theme: 'forest', seed: 11,
      pts: [
        [-40, -190], [90, -190], [215, -186], [296, -150], [318, -78], [282, -18],
        [292, 52], [330, 112], [300, 182], [218, 206], [142, 172], [112, 100],
        [60, 48], [-12, 62], [-44, 128], [-112, 178], [-204, 180], [-268, 124],
        [-262, 44], [-208, -4], [-218, -62], [-288, -96], [-300, -160], [-230, -192], [-140, -190]
      ]
    },
    hafen: {
      id: 'hafen', name: 'HAFENKURS', sub: { de: 'Technisch mit Haarnadeln', en: 'Technical with hairpins' },
      width: 12.5, theme: 'coast', seed: 23,
      pts: [
        [-60, -150], [60, -150], [180, -150], [262, -138], [300, -86], [276, -30],
        [206, -22], [150, -52], [92, -44], [70, 14], [112, 62], [196, 64],
        [262, 96], [276, 158], [226, 198], [150, 176], [84, 148], [20, 170],
        [-52, 200], [-128, 180], [-150, 112], [-104, 64], [-60, 20], [-96, -34],
        [-170, -30], [-232, 14], [-290, -10], [-300, -84], [-262, -140], [-170, -150]
      ]
    },
    alpen: {
      id: 'alpen', name: 'ALPENSPEEDWAY', sub: { de: 'Schnell und weit', en: 'Fast and wide open' },
      width: 14, theme: 'alpine', seed: 37,
      pts: [
        [-80, -210], [80, -210], [240, -206], [352, -172], [398, -86], [372, 6],
        [300, 62], [264, 142], [196, 204], [92, 214], [20, 166], [-20, 84],
        [-92, 40], [-180, 66], [-232, 144], [-320, 176], [-398, 124], [-404, 24],
        [-346, -50], [-362, -138], [-300, -200], [-200, -212]
      ]
    }
  };
  function turtle(x, z, h, segs) {
    const P = [[x, z]], step = 4;
    for (const s of segs) {
      if (s[0] === 'S') { const n = Math.max(1, Math.round(s[1] / step)); for (let k = 0; k < n; k++) { x += Math.cos(h) * s[1] / n; z += Math.sin(h) * s[1] / n; P.push([x, z]); } }
      else { const ang = s[1] * Math.PI / 180, R = s[2], n = Math.max(2, Math.round(Math.abs(ang) * R / step)); for (let k = 0; k < n; k++) { h += ang / n; x += Math.cos(h) * Math.abs(ang) * R / n; z += Math.sin(h) * Math.abs(ang) * R / n; P.push([x, z]); } }
    }
    return P;
  }
  AX.TRACKS.pass = {
    id: 'pass', name: 'SCHWARZHORNPASS', sub: { de: 'Bergrennen · 10 Kehren', en: 'Hill climb · 10 hairpins' },
    width: 7.2, theme: 'pass', seed: 51, open: true, baseH: 0,
    // grade (rise per metre) by distance from the bottom
    grade: [[420, 0.045], [1700, 0.085], [2150, 0.065], [99999, 0.02]],
    build: () => turtle(0, 0, -Math.PI / 2, [
      // lower part: flowing S-bends through the forest, never a long view ahead
      ['S', 70], ['T', 40, 70], ['S', 15], ['T', -55, 55], ['S', 35], ['T', 70, 48], ['S', 25], ['T', -60, 60], ['S', 20], ['T', 45, 80], ['S', 45], ['T', 50, 42],
      ['S', 120], ['T', -180, 16], ['S', 60], ['T', 9, 140], ['S', 40], ['T', -9, 140], ['S', 60],
      ['T', 180, 15], ['S', 140], ['T', -180, 17], ['S', 55], ['T', -8, 150], ['S', 30], ['T', 8, 150], ['S', 60],
      ['T', 180, 14], ['S', 160], ['T', -180, 16], ['S', 100],
      ['T', 60, 55], ['S', 90], ['T', -80, 45], ['S', 60], ['T', 40, 70], ['S', 120], ['S', 160]
    ])
  };
  AX.TRACK_ORDER = ['pass', 'kiefern', 'hafen', 'alpen'];

  let OPEN = false;   // set while an open (A-to-B) road is being built
  const wr = (i, n) => (OPEN ? (i < 0 ? 0 : i >= n ? n - 1 : i) : mod(i, n));

  function catmull(p0, p1, p2, p3, t, out) {
    // centripetal Catmull-Rom (Barry–Goldman)
    const a = 0.5;
    const d01 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), a) || 1e-4;
    const d12 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), a) || 1e-4;
    const d23 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), a) || 1e-4;
    const t0 = 0, t1 = d01, t2 = t1 + d12, t3 = t2 + d23;
    const tt = t1 + (t2 - t1) * t;
    for (let k = 0; k < 2; k++) {
      const A1 = (t1 - tt) / (t1 - t0) * p0[k] + (tt - t0) / (t1 - t0) * p1[k];
      const A2 = (t2 - tt) / (t2 - t1) * p1[k] + (tt - t1) / (t2 - t1) * p2[k];
      const A3 = (t3 - tt) / (t3 - t2) * p2[k] + (tt - t2) / (t3 - t2) * p3[k];
      const B1 = (t2 - tt) / (t2 - t0) * A1 + (tt - t0) / (t2 - t0) * A2;
      const B2 = (t3 - tt) / (t3 - t1) * A2 + (tt - t1) / (t3 - t1) * A3;
      out[k] = (t2 - tt) / (t2 - t1) * B1 + (tt - t1) / (t2 - t1) * B2;
    }
    return out;
  }

  function curv3(ax, az, bx, bz, cx, cz) {
    const x1 = bx - ax, z1 = bz - az, x2 = cx - bx, z2 = cz - bz, x3 = cx - ax, z3 = cz - az;
    const den = Math.hypot(x1, z1) * Math.hypot(x2, z2) * Math.hypot(x3, z3);
    return den < 1e-9 ? 0 : 2 * (x1 * z2 - z1 * x2) / den;   // + = right-hand turn (clockwise on screen)
  }

  function h2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vn(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
  function vnoise2(x, y) { return vn(x, y) * 0.55 + vn(x * 2.03 + 11, y * 2.03 + 5) * 0.3 + vn(x * 4.1 + 3, y * 4.1 + 17) * 0.15; }
  function ridge(x, y) { let s = 0, a = 0.6, f = 1; for (let o = 0; o < 4; o++) { s += a * (1 - Math.abs(vn(x * f + o * 13, y * f + o * 7) * 2 - 1)) ** 2; a *= 0.5; f *= 2.1; } return s; }
  function lerpN(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  function smoothLoop(arr, win, passes) {
    const n = arr.length; let a = arr, b = new Float32Array(n);
    for (let p = 0; p < (passes || 1); p++) {
      let sum = 0;
      for (let k = -win; k <= win; k++) sum += a[wr(k, n)];
      for (let i = 0; i < n; i++) {
        b[i] = sum / (2 * win + 1);
        sum += a[wr(i + win + 1, n)] - a[wr(i - win, n)];
      }
      const t = a; a = b; b = (t === arr ? new Float32Array(n) : t);
    }
    return a;
  }
  function minLoop(arr, win) {
    const n = arr.length, out = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = Infinity; for (let k = -win; k <= win; k++) { const v = arr[wr(i + k, n)]; if (v < m) m = v; } out[i] = m; }
    return out;
  }
  function maxLoop(arr, win) {
    const n = arr.length, out = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = -Infinity; for (let k = -win; k <= win; k++) { const v = arr[wr(i + k, n)]; if (v > m) m = v; } out[i] = m; }
    return out;
  }

  class Track {
    wr(i) { return this.open ? clamp(i, 0, this.n - 1) : mod(i, this.n); }
    constructor(id) {
      const def = AX.TRACKS[id] || AX.TRACKS.kiefern;
      if (def.build && !def.pts) def.pts = def.build();
      this.def = def; this.id = def.id; this.name = def.name; this.open = !!def.open;
      this.hw = def.width / 2;
      this.kerbW = this.open ? 0.8 : 1.35;
      OPEN = this.open;
      try {
        this._sample();
        if (this.open) { this._heights(); this._terrainSetup(); }
        this._zones();
        this._racingLine();
        this._corners();
      } finally { OPEN = false; }
      this.startIdx = this.open ? 70 : 0;
      this.finishIdx = this.open ? this.n - 150 : 0; this.finishS = this.finishIdx * this.ds;
    }

    _sample() {
      const P = this.def.pts, n = P.length;
      const dense = []; const tmp = [0, 0];
      for (let i = 0; i < (OPEN ? n - 1 : n); i++) {
        const p0 = P[wr(i - 1, n)], p1 = P[i], p2 = P[wr(i + 1, n)], p3 = P[wr(i + 2, n)];
        const seg = Math.max(8, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 1.5));
        for (let k = 0; k < seg; k++) { catmull(p0, p1, p2, p3, k / seg, tmp); dense.push(tmp[0], tmp[1]); }
      }
      if (OPEN) dense.push(P[n - 1][0], P[n - 1][1]);
      const m = dense.length / 2; const cum = new Float64Array(m + 1);
      for (let i = 0; i < (OPEN ? m - 1 : m); i++) {
        const j = OPEN ? i + 1 : (i + 1) % m;
        cum[i + 1] = cum[i] + Math.hypot(dense[j * 2] - dense[i * 2], dense[j * 2 + 1] - dense[i * 2 + 1]);
      }
      const L = OPEN ? cum[m - 1] : cum[m]; const N = Math.round(L); const ds = L / N;
      this.length = L; this.n = N; this.ds = ds;
      let px = new Float32Array(N), pz = new Float32Array(N);
      let seg = 0;
      for (let i = 0; i < N; i++) {
        const s = i * ds;
        while (seg < m - 2 && cum[seg + 1] < s) seg++;
        const t = (s - cum[seg]) / (cum[seg + 1] - cum[seg] || 1); const j = OPEN ? Math.min(seg + 1, m - 1) : (seg + 1) % m;
        px[i] = dense[seg * 2] + (dense[j * 2] - dense[seg * 2]) * t;
        pz[i] = dense[seg * 2 + 1] + (dense[j * 2 + 1] - dense[seg * 2 + 1]) * t;
      }
      px = smoothLoop(px, 3, 2); pz = smoothLoop(pz, 3, 2);
      this.px = px; this.pz = pz;
      const tx = new Float32Array(N), tz = new Float32Array(N), k = new Float32Array(N), yaw = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = wr(i - 1, N), b = wr(i + 1, N);
        let dx = px[b] - px[a], dz = pz[b] - pz[a]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        tx[i] = dx; tz[i] = dz; yaw[i] = Math.atan2(dz, dx);
        const a3 = wr(i - 3, N), b3 = wr(i + 3, N);
        k[i] = curv3(px[a3], pz[a3], px[i], pz[i], px[b3], pz[b3]);
      }
      this.tx = tx; this.tz = tz; this.yaw = yaw;
      this.k = smoothLoop(k, 4, 2);
      // right normal = (-tz, tx)
      this.nx = new Float32Array(N); this.nz = new Float32Array(N);
      for (let i = 0; i < N; i++) { this.nx[i] = -tz[i]; this.nz[i] = tx[i]; }
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (let i = 0; i < N; i++) { minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]); minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]); }
      this.bounds = { minX, maxX, minZ, maxZ };
      // spatial grid of centre-line samples
      const cell = this.cell = 24;
      this.gx0 = minX - 80; this.gz0 = minZ - 80;
      this.gw = Math.ceil((maxX - minX + 160) / cell); this.gh = Math.ceil((maxZ - minZ + 160) / cell);
      this.grid = new Array(this.gw * this.gh);
      for (let i = 0; i < N; i += 2) {
        const c = this._cell(px[i], pz[i]); (this.grid[c] || (this.grid[c] = [])).push(i);
      }
    }
    _cell(x, z) {
      const cx = clamp(Math.floor((x - this.gx0) / this.cell), 0, this.gw - 1);
      const cz = clamp(Math.floor((z - this.gz0) / this.cell), 0, this.gh - 1);
      return cz * this.gw + cx;
    }
    /* distance to nearest centre-line sample that is far away *along* the lap from index i */
    _otherDist(x, z, i, gap) {
      const N = this.n; let best = 1e9;
      const cx = clamp(Math.floor((x - this.gx0) / this.cell), 0, this.gw - 1);
      const cz = clamp(Math.floor((z - this.gz0) / this.cell), 0, this.gh - 1);
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const gx = cx + a, gz = cz + b; if (gx < 0 || gz < 0 || gx >= this.gw || gz >= this.gh) continue;
        const list = this.grid[gz * this.gw + gx]; if (!list) continue;
        for (let q = 0; q < list.length; q++) {
          const j = list[q]; let dj = Math.abs(j - i); dj = Math.min(dj, N - dj); if (dj < gap) continue;
          const d = Math.hypot(this.px[j] - x, this.pz[j] - z); if (d < best) best = d;
        }
      }
      return best;
    }

    _zonesOpen() {
      const N = this.n, w = this.hw;
      this.kerb = [new Uint8Array(N), new Uint8Array(N)];
      this.bar = [new Float32Array(N), new Float32Array(N)];
      this.g0 = [new Float32Array(N), new Float32Array(N)]; this.g1 = [new Float32Array(N), new Float32Array(N)];
      this.barType = [new Uint8Array(N), new Uint8Array(N)];
      this.cut = [new Float32Array(N), new Float32Array(N)]; this.wallH = [new Float32Array(N), new Float32Array(N)];
      for (let s = 0; s < 2; s++) {
        const sg = s ? 1 : -1, raw = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const off = w + 6; const x = this.px[i] + this.nx[i] * sg * off, z = this.pz[i] + this.nz[i] * sg * off;
          raw[i] = this.terrainH(x, z) - this.py[i];
        }
        const c = smoothLoop(raw, 6, 2);
        for (let i = 0; i < N; i++) {
          this.cut[s][i] = c[i];
          this.barType[s][i] = c[i] > 0.35 ? 2 : 0;
          this.bar[s][i] = w + (c[i] > 0.35 ? 1.25 : 1.05);
        }
        this._despeckle(this.barType[s], 14);
        const wh = new Float32Array(N); for (let i = 0; i < N; i++) wh[i] = this.barType[s][i] === 2 ? clamp(0.7 + c[i] * 0.9, 0.9, 3.4) : 0;
        const whs = smoothLoop(wh, 5, 2); for (let i = 0; i < N; i++) this.wallH[s][i] = this.barType[s][i] === 2 ? Math.max(0.8, whs[i]) : 0;
      }
      this.pitFrom = N; this.pitTo = 0;
    }

    /* ---------- elevation: grade follows the road (flatter in hairpins), heights integrate it */
    _heights() {
      const N = this.n, ds = this.ds, K = this.k, prof = this.def.grade;
      const g = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const s = i * ds; let base = prof[prof.length - 1][1];
        for (let q = 0; q < prof.length; q++) if (s < prof[q][0]) { base = prof[q][1]; break; }
        const hp = smoothstep(1 / 60, 1 / 18, Math.abs(K[i]));
        g[i] = base * (1 - hp) + 0.045 * hp;
      }
      const gs = smoothLoop(g, 20, 3);
      const py = new Float32Array(N); py[0] = this.def.baseH || 0;
      for (let i = 1; i < N; i++) py[i] = py[i - 1] + gs[i] * ds;
      this.py = py; this.gr = gs;
    }
    heightAt(i, along) { if (!this.py) return 0; i = this.wr(i); const j = Math.min(i + 1, this.n - 1), k = Math.max(i - 1, 0), t = clamp((along || 0) / this.ds, -1, 1); return t >= 0 ? this.py[i] + (this.py[j] - this.py[i]) * t : this.py[i] + (this.py[i] - this.py[k]) * t; }

    /* ---------- terrain around the road: best-fit plane + inverse-distance blend of the road heights + noise */
    _terrainSetup() {
      const N = this.n; let sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
      for (let i = 0; i < N; i++) { const x = this.px[i], z = this.pz[i], h = this.py[i]; sx += x; sz += z; sh += h; sxx += x * x; szz += z * z; sxz += x * z; sxh += x * h; szh += z * h; }
      const mx = sx / N, mz = sz / N, mh = sh / N;
      const cxx = sxx / N - mx * mx, czz = szz / N - mz * mz, cxz = sxz / N - mx * mz, cxh = sxh / N - mx * mh, czh = szh / N - mz * mh;
      const det = cxx * czz - cxz * cxz || 1; const a = (cxh * czz - czh * cxz) / det, b = (czh * cxx - cxh * cxz) / det;
      this.plane = { a, b, c: mh - a * mx - b * mz };
      let lo = 1e9, hi = -1e9; for (let i = 0; i < N; i++) { const v = a * this.px[i] + b * this.pz[i]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      this._pLo = lo - 20; this._pHi = hi + 20;
      this.res = new Float32Array(N); for (let i = 0; i < N; i++) this.res[i] = this.py[i] - this.planeH(this.px[i], this.pz[i]);
      const cell = this.tcell = 25; this.tg = new Map();
      for (let i = 0; i < N; i += 3) { const k = Math.floor(this.px[i] / cell) + ',' + Math.floor(this.pz[i] / cell); (this.tg.get(k) || this.tg.set(k, []).get(k)).push(i); }
    }
    planeH(x, z) {   // follows the road's slope near the road, flattens out further away so the distant valley stays readable
      const p = this.plane, v = p.a * x + p.b * z, lo = this._pLo, hi = this._pHi;
      if (v < lo) return p.c + lo - 60 * (1 - Math.exp((v - lo) / 60));
      if (v > hi) return p.c + hi + 110 * (1 - Math.exp(-(v - hi) / 110));
      return p.c + v;
    }
    /* terrain height at any (x, z); the distance to the road is left in this.lastRoadD */
    terrainH(x, z) {
      const R = 55, cell = this.tcell, cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      let ws = 0, rs = 0, dmin = 1e9, hNear = 0;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const list = this.tg.get((cx + a) + ',' + (cz + b)); if (!list) continue;
        for (let q = 0; q < list.length; q++) {
          const i = list[q], dx = this.px[i] - x, dz = this.pz[i] - z, d2 = dx * dx + dz * dz; if (d2 > R * R) continue;
          const d = Math.sqrt(d2); if (d < dmin) { dmin = d; hNear = this.py[i]; }
          const f = 1 - d / R, w = f * f / (d2 + 6); ws += w; rs += w * this.res[i];
        }
      }
      const base = this.planeH(x, z); this.lastRoadD = dmin;
      let h = base + (ws > 0 ? rs / ws * clamp(ws * 400, 0, 1) : 0);
      const amp = smoothstep(this.hw + 2, 45, dmin);
      h += (vnoise2(x * 0.022, z * 0.022) - 0.5) * 12 * amp + (vnoise2(x * 0.09 + 7, z * 0.09 + 3) - 0.5) * 1.6 * amp;
      const far = smoothstep(60, 500, dmin); h += (ridge(x * 0.003, z * 0.003) * 70 - 20) * far;
      if (dmin < this.hw + 1.2) h = hNear - 0.12;
      else if (dmin < this.hw + 4) h = lerpN(hNear - 0.12, h, smoothstep(this.hw + 1.2, this.hw + 4, dmin));
      return h;
    }

    _zones() {
      if (this.open) return this._zonesOpen();
      const N = this.n, w = this.hw, kw = this.kerbW, K = this.k;
      const ka = new Float32Array(N); for (let i = 0; i < N; i++) ka[i] = Math.abs(K[i]);
      const kmax30 = maxLoop(ka, 30);
      // side arrays: index 0 = left (d<0), 1 = right (d>0)
      this.kerb = [new Uint8Array(N), new Uint8Array(N)];
      this.bar = [new Float32Array(N), new Float32Array(N)];
      this.g0 = [new Float32Array(N), new Float32Array(N)];
      this.g1 = [new Float32Array(N), new Float32Array(N)];
      this.barType = [new Uint8Array(N), new Uint8Array(N)]; // 0 armco, 1 tyres, 2 wall
      const want = [new Float32Array(N), new Float32Array(N)];
      const outsideness = [new Float32Array(N), new Float32Array(N)];
      for (let i = 0; i < N; i++) {
        // look at the corner around this sample (exit weighted: corners throw you outwards later)
        let kc = 0;
        for (let o = -46; o <= 22; o += 4) { const v = K[wr(i + o, N)]; if (Math.abs(v) > Math.abs(kc)) kc = v; }
        const sev = clamp((Math.abs(kc) - 1 / 170) / (1 / 38 - 1 / 170), 0, 1);
        const outSide = kc > 0 ? 0 : 1;           // right turn -> outside is left
        outsideness[outSide][i] = sev; outsideness[1 - outSide][i] = 0;
        want[outSide][i] = w + 7.5 + sev * 20;
        want[1 - outSide][i] = w + 6.5;
        // inside kerb through the corner, outside kerb on entry + exit
        const inSide = K[i] > 0 ? 1 : 0;
        if (ka[i] > 1 / 95) this.kerb[inSide][i] = 1;
        if (sev > 0.32 && ka[i] < 1 / 55 && ka[i] > 1 / 400) this.kerb[outSide][i] = 1;
      }
      // main straight: pit wall on the right, grandstand wall on the left
      this.pitFrom = N - 150; this.pitTo = 170;
      for (let i = 0; i < N; i++) {
        const onStraight = (i > this.pitFrom || i < this.pitTo) && kmax30[i] < 1 / 400;
        if (onStraight) { want[1][i] = Math.min(want[1][i], w + 4.2); want[0][i] = Math.min(want[0][i], w + 5.5); }
      }
      for (let s = 0; s < 2; s++) {
        let b = smoothLoop(want[s], 14, 2);
        // do not fold over on the inside of tight corners
        for (let i = 0; i < N; i++) {
          const inside = (s === 1) === (K[i] > 0);
          if (inside && kmax30[i] > 1e-4) b[i] = Math.min(b[i], Math.max(w + 2.2, 1 / kmax30[i] - 2.5));
        }
        // keep clear of other parts of the lap
        const cl = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          let off = b[i]; const sg = s === 0 ? -1 : 1;
          for (let it = 0; it < 40; it++) {
            const x = this.px[i] + this.nx[i] * off * sg, z = this.pz[i] + this.nz[i] * off * sg;
            const od = this._otherDist(x, z, i, 90);
            if (od >= Math.max(off - 0.4, w + 3.2) || off <= w + 1.8) break;
            off -= 0.75;
          }
          cl[i] = Math.max(off, w + 1.8);
        }
        const sm = smoothLoop(minLoop(cl, 5), 8, 2);
        for (let i = 0; i < N; i++) this.bar[s][i] = Math.min(sm[i], cl[i] + 0.6);
        // gravel traps where there is room on the outside of a corner
        const os = smoothLoop(outsideness[s], 10, 1);
        for (let i = 0; i < N; i++) {
          const room = this.bar[s][i] - (w + kw + 2.4);
          if (os[i] > 0.22 && room > 6.5) { this.g0[s][i] = w + kw + 2.4; this.g1[s][i] = this.bar[s][i] - 1.2; this.barType[s][i] = 1; }
          else { this.g0[s][i] = 0; this.g1[s][i] = 0; this.barType[s][i] = 0; }
          const onStraight = (i > this.pitFrom || i < this.pitTo) && kmax30[i] < 1 / 400;
          if (onStraight) this.barType[s][i] = 2;
        }
        // tidy: remove tiny kerb / gravel fragments
        this._despeckle(this.kerb[s], 10);
        this._despeckle(this.barType[s], 16);
      }
    }
    _despeckle(arr, minRun) {
      const N = arr.length; let i = 0; let guard = 0;
      while (i < N && guard++ < N * 2) {
        const v = arr[i]; let j = i; while (j < N && arr[j] === v) j++;
        if (v !== 0 && j - i < minRun && j < N) { for (let q = i; q < j; q++) arr[q] = 0; }
        i = j;
      }
    }

    surfaceAt(i, d) {
      const s = d < 0 ? 0 : 1, a = Math.abs(d), w = this.hw;
      if (a <= w) return SURF.ROAD;
      if (a <= w + this.kerbW) return this.kerb[s][i] ? SURF.KERB : SURF.GRASS;
      const g0 = this.g0[s][i];
      if (g0 > 0 && a >= g0 && a <= this.g1[s][i]) return SURF.GRAVEL;
      return SURF.GRASS;
    }

    /* ---------- racing line (K1999-style curvature relaxation) ---------- */
    _racingLine() {
      const N = this.n, px = this.px, pz = this.pz, nx = this.nx, nz = this.nz;
      const margin = 1.5, lo = -(this.hw - margin), hi = this.hw - margin;
      const d = new Float32Array(N);
      const X = (i) => px[i] + nx[i] * d[i], Z = (i) => pz[i] + nz[i] * d[i];
      const adjust = (i, p, q, target) => {
        const ax = X(p), az = Z(p), bx = X(q), bz = Z(q);
        const ex = bx - ax, ez = bz - az;
        const den = nx[i] * ez - nz[i] * ex;
        let t0 = Math.abs(den) < 1e-6 ? d[i] : ((ax - px[i]) * ez - (az - pz[i]) * ex) / den;
        t0 = clamp(t0, lo, hi);
        const dl = 0.2;
        const kk = curv3(ax, az, px[i] + nx[i] * (t0 + dl), pz[i] + nz[i] * (t0 + dl), bx, bz);
        const k0 = curv3(ax, az, px[i] + nx[i] * t0, pz[i] + nz[i] * t0, bx, bz);
        const dk = (kk - k0) / dl;
        let t = t0;
        if (Math.abs(dk) > 1e-9) t = t0 + (target - k0) / dk;
        d[i] = clamp(t, lo, hi);
      };
      for (let step = 64; step >= 1; step = step >> 1) {
        const iters = Math.round(60 * Math.sqrt(step));
        for (let it = 0; it < iters; it++) {
          for (let i = 0; i < N - (N % step ? step : 0); i += step) {
            const p = wr(i - step, N), q = wr(i + step, N), pp = wr(i - 2 * step, N), qq = wr(i + 2 * step, N);
            const r0 = curv3(X(pp), Z(pp), X(p), Z(p), X(i), Z(i));
            const r1 = curv3(X(i), Z(i), X(q), Z(q), X(qq), Z(qq));
            const lp = Math.hypot(X(i) - X(p), Z(i) - Z(p)), ln = Math.hypot(X(i) - X(q), Z(i) - Z(q));
            adjust(i, p, q, (ln * r0 + lp * r1) / (lp + ln || 1));
          }
        }
        if (step > 1) { // interpolate to half step
          const h = step >> 1;
          for (let i = 0; i < N; i += step) {
            const q = wr(i + step, N), mid = wr(i + h, N);
            if (mid % step !== 0) d[mid] = clamp((d[i] + d[q]) / 2, lo, hi);
          }
        }
      }
      if (OPEN) for (let i = 0; i < N; i++) { const e = Math.min(i, N - 1 - i); if (e < 80) d[i] *= e / 80; }
      this.ld = smoothLoop(d, 3, 2);
      this.lx = new Float32Array(N); this.lz = new Float32Array(N); this.lk = new Float32Array(N);
      for (let i = 0; i < N; i++) { this.lx[i] = px[i] + nx[i] * this.ld[i]; this.lz[i] = pz[i] + nz[i] * this.ld[i]; }
      const lk = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = wr(i - 4, N), b = wr(i + 4, N);
        lk[i] = curv3(this.lx[a], this.lz[a], this.lx[i], this.lz[i], this.lx[b], this.lz[b]);
      }
      this.lk = smoothLoop(lk, 3, 2);
    }

    /* target speed along the racing line for a given bike; returns Float32Array[N] in m/s */
    speedProfile(spec, pace) {
      const N = this.n, g = AX.G, ds = this.ds;
      pace = pace || 1;
      const aLat = Math.min(spec.mu * g, g * Math.tan(spec.maxLean * Math.PI / 180)) * 0.90 * pace * pace;
      const aBrk = Math.min(spec.brake, g * (spec.wheelbase - spec.cgB) / spec.cgH) * 0.86 * pace;
      const vTop = spec.dragTop * 0.995;
      const v = new Float32Array(N);
      for (let i = 0; i < N; i++) v[i] = Math.min(vTop, Math.sqrt(aLat / Math.max(1e-5, Math.abs(this.lk[i]))));
      for (let pass = 0; pass < 2; pass++) {
        for (let i = N - 1; i >= 0; i--) {
          const j = wr(i + 1, N), vn = v[j];
          const lat = vn * vn * Math.abs(this.lk[i]) / aLat;
          const ab = aBrk * Math.sqrt(Math.max(0.06, 1 - lat * lat)) + 0.00018 * vn * vn;
          const lim = Math.sqrt(vn * vn + 2 * ab * ds);
          if (v[i] > lim) v[i] = lim;
        }
      }
      return v;
    }

    _corners() {
      const N = this.n, K = this.k; const out = []; let i = 0;
      // start scanning from a straight bit
      let off = 0; while (off < N && Math.abs(K[off]) > 1 / 200) off++;
      const thr = 1 / 130;
      while (i < N) {
        const a = (i + off) % N;
        if (Math.abs(K[a]) > thr) {
          const dir = Math.sign(K[a]); let j = i, peak = 0, apex = a;
          while (j < N && Math.abs(K[(j + off) % N]) > thr * 0.7 && Math.sign(K[(j + off) % N]) === dir) {
            const b = (j + off) % N; if (Math.abs(K[b]) > peak) { peak = Math.abs(K[b]); apex = b; } j++;
          }
          if (j - i > 14) out.push({ from: a, to: (j + off) % N, apex, dir, radius: 1 / peak, len: j - i });
          i = j;
        } else i++;
      }
      out.sort((a, b) => a.apex - b.apex);
      this.corners = out;
    }

    pos(i, d, out) { out = out || [0, 0]; i = this.wr(i); out[0] = this.px[i] + this.nx[i] * d; out[1] = this.pz[i] + this.nz[i] * d; return out; }

    /* nearest centre-line sample, searched locally around `hint` (pass -1 for a global search) */
    nearest(x, z, hint) {
      const N = this.n, px = this.px, pz = this.pz;
      let best = -1, bd = 1e18;
      if (hint >= 0) {
        for (let o = -28; o <= 44; o++) {
          const i = this.wr(hint + o); const dx = px[i] - x, dz = pz[i] - z, dd = dx * dx + dz * dz;
          if (dd < bd) { bd = dd; best = i; }
        }
        if (bd < 55 * 55) return best;
      }
      for (let i = 0; i < N; i += 4) { const dx = px[i] - x, dz = pz[i] - z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = i; } }
      const c = best;
      for (let o = -4; o <= 4; o++) { const i = this.wr(c + o); const dx = px[i] - x, dz = pz[i] - z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = i; } }
      return best;
    }
    lateral(i, x, z) { return (x - this.px[i]) * this.nx[i] + (z - this.pz[i]) * this.nz[i]; }
    along(i, x, z) { return (x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i]; }

    /* grid slot n (0 = pole): [x, z, yaw] */
    gridSlot(n) {
      const back = 9 + n * 5.2; const i = this.wr(this.startIdx + Math.round(-back / this.ds));
      const d = (n % 2 === 0 ? -1 : 1) * 2.7;
      return [this.px[i] + this.nx[i] * d, this.pz[i] + this.nz[i] * d, this.yaw[i], i];
    }
  }

  AX.Track = Track;
  AX.trackUtil = { smoothLoop, minLoop, maxLoop, curv3, vnoise2, ridge };
  if (typeof module !== 'undefined' && module.exports) module.exports = AX;
})(typeof globalThis !== 'undefined' ? globalThis : window);
