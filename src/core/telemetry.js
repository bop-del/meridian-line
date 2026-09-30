// Telemetry harness. Loaded only with ?tune=1 or ?telemetry=1 (dynamic import from game.js), never on the normal path.
//
// window.__telemetry = { start(), stop(), report(), live, ... }
//   start()    begins a recording (clears the previous one). ?telemetry=1 starts one automatically.
//   stop()     ends it. report() can be called while running or after stop.
//   report()   plain JSON: frame time (avg, p50, p95, p99, worst), camera lag, input latency, rail speed, fov, shake.
//   live       rolling numbers for the tune panel: fps, msAvg, msP95, camLag, speed, fov, shake (always updated).
//
// Frame time is the wall-clock gap between two dev updates, so it covers the whole frame including render. When the game is
// stepped by ctx.game.advance() (bots) there is no render and the gaps are tiny, so read frame time only from real runs.
//
// Camera lag is the distance between the ideal chase position and the actual camera position (shake removed). The ideal pose
// comes from ctx.cameraRig when it exposes one (`ideal`, `idealPos` or `idealPose()`), otherwise it is computed from the rail,
// the player offset and config.camera.
//
// Input latency is the time from input.stamp (the last steering key event, set by the input module) to the first frame in
// which player.localVelocity changed. It is reported in milliseconds (up to the end of the simulation step) and in frames.
// Presses that start from rest are the headline number. When input.stamp is missing the section says supported: false.

const CAP = 72000;            // frames kept per recording (20 minutes at 60 fps)
const WIN = 180;              // rolling window for the live readout
const LAT_TIMEOUT_MS = 700, LAT_TIMEOUT_FRAMES = 90;
const V_EPS = 1e-3;

const round = (v, d = 3) => (Number.isFinite(v) ? +v.toFixed(d) : null);

function pct(sorted, n, q) {
  if (!n) return 0;
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
}

function stats(arr, n) {
  if (!n) return { n: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const s = Float32Array.prototype.slice.call(arr, 0, n).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s[i];
  return { n, avg: round(sum / n), p50: round(pct(s, n, 0.5)), p95: round(pct(s, n, 0.95)), p99: round(pct(s, n, 0.99)), max: round(s[n - 1]) };
}

function latSummary(list) {
  if (!list.length) return { samples: 0 };
  const ms = list.map((l) => l.ms).sort((a, b) => a - b);
  const fr = list.map((l) => l.frames).sort((a, b) => a - b);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    samples: list.length,
    avgMs: round(avg(ms), 2), p50Ms: round(ms[Math.floor((ms.length - 1) / 2)], 2), maxMs: round(ms[ms.length - 1], 2),
    avgFrames: round(avg(fr), 2), maxFrames: fr[fr.length - 1],
  };
}

export const telemetry = {
  ctx: null,
  recording: false,
  live: { fps: 0, msAvg: 0, msP95: 0, camLag: 0, speed: 0, fov: 0, shake: 0, recording: false },

  init(ctx) {
    this.ctx = ctx;
    window.__telemetry = this;
    const T = ctx.THREE;
    this._ideal = new T.Vector3();
    this._act = new T.Vector3();
    this._frameMs = new Float32Array(CAP);
    this._lag = new Float32Array(CAP);
    this._win = new Float32Array(WIN);
    this._winSorted = new Float32Array(WIN);
    this._winN = 0; this._winI = 0; this._winAt = 0;
    this._last = 0;
    this._pv = { x: 0, y: 0 };
    this._seenStamp = null;
    this._pend = null;
    this._clear();
    if (new URLSearchParams(location.search).get('telemetry') === '1') this.start();
  },

  reset() { this._pend = null; this._last = 0; },

  _clear() {
    this._n = 0; this._nLag = 0; this._truncated = false;
    this._t0 = performance.now(); this._t1 = this._t0;
    this._rs = { min: Infinity, max: -Infinity, sum: 0, n: 0 };
    this._fv = { min: Infinity, max: -Infinity, sum: 0, n: 0 };
    this._shPeak = 0; this._shRoll = 0; this._shSq = 0;
    this._latRest = []; this._latOther = []; this._latMiss = 0; this._latSeen = false;
    this._hitches = 0; this._stalls = 0; this._lagMax = 0;
  },

  start() { this._clear(); this.recording = true; this.live.recording = true; return true; },
  stop() { if (this.recording) this._t1 = performance.now(); this.recording = false; this.live.recording = false; return true; },

  // ideal chase camera position into this._ideal (see the header comment)
  _idealPose(ctx) {
    const rig = ctx.cameraRig, out = this._ideal;
    const v = rig?.ideal ?? rig?.idealPos ?? (typeof rig?.idealPose === 'function' ? rig.idealPose(ctx) : null);
    const p = v?.pos ?? v?.position ?? v;
    if (p && Number.isFinite(p.x)) return out.set(p.x, p.y, p.z);
    const cc = ctx.config.camera, pl = ctx.player, rp = ctx.rail.position;
    const boost = pl.boostAmount || 0, brake = pl.brakeAmount || 0;
    return out.set(
      rp.x + pl.localOffset.x * cc.followX,
      rp.y + pl.localOffset.y * cc.followY + cc.height,
      rp.z + cc.distance + boost * (cc.boostPull || 0) + brake * (cc.brakePull || 0));
  },

  update(raw, ctx = this.ctx) {
    if (!ctx) return;
    const now = performance.now();
    const gap = this._last ? now - this._last : 0;
    this._last = now;
    const state = ctx.state, pl = ctx.player, rig = ctx.cameraRig, cam = ctx.camera;
    const playing = state.phase === 'playing';
    const live = this.live;

    // ---- frame time (a gap over one second is a pause or a hidden tab, counted as a stall and not as a frame)
    if (gap > 0) {
      if (gap > 1000) this._stalls++;
      else {
        this._win[this._winI] = gap; this._winI = (this._winI + 1) % WIN; if (this._winN < WIN) this._winN++;
        if (this.recording) {
          if (this._n < CAP) this._frameMs[this._n++] = gap; else this._truncated = true;
          if (gap > 25) this._hitches++;
        }
      }
    }
    if (now - this._winAt > 250 && this._winN) {
      this._winAt = now;
      this._winSorted.set(this._win);
      const s = this._winSorted.subarray(0, this._winN).sort();
      let sum = 0;
      for (let i = 0; i < this._winN; i++) sum += s[i];
      live.msAvg = sum / this._winN; live.fps = 1000 / live.msAvg; live.msP95 = pct(s, this._winN, 0.95);
    }

    // ---- camera lag (chase mode only)
    let lag = 0;
    if (rig?.mode === 'chase' && playing) {
      this._idealPose(ctx);
      const act = this._act;
      if (rig.cpos && Number.isFinite(rig.cpos.x)) act.copy(rig.cpos);
      else { act.copy(cam.position); if (ctx.impact?.offset) act.sub(ctx.impact.offset); }
      lag = act.distanceTo(this._ideal);
      if (this.recording) { if (this._nLag < CAP) this._lag[this._nLag++] = lag; if (lag > this._lagMax) this._lagMax = lag; }
    }
    live.camLag = lag;

    // ---- rail speed, fov, shake
    const rs = ctx.rail?.speed ?? 0, fv = cam?.fov ?? 0;
    const imp = ctx.impact;
    const sh = imp ? Math.hypot(imp.offset.x, imp.offset.y, imp.offset.z) : 0;
    live.speed = rs; live.fov = fv; live.shake = sh;
    if (this.recording) {
      const a = this._rs; if (rs < a.min) a.min = rs; if (rs > a.max) a.max = rs; a.sum += rs; a.n++;
      const b = this._fv; if (fv < b.min) b.min = fv; if (fv > b.max) b.max = fv; b.sum += fv; b.n++;
      if (sh > this._shPeak) this._shPeak = sh;
      const r = Math.abs(imp?.roll || 0); if (r > this._shRoll) this._shRoll = r;
      this._shSq += sh * sh;
    }

    // ---- input latency
    const lv = pl.localVelocity, pv = this._pv;
    const stamp = ctx.input?.stamp;
    if (typeof stamp === 'number') {
      this._latSeen = true;
      if (stamp !== this._seenStamp) {
        this._seenStamp = stamp;
        if (!this._pend && playing) this._pend = { t: stamp, f: 0, rest: pv.x * pv.x + pv.y * pv.y < 0.25 };
      }
      if (this._pend) {
        const p = this._pend;
        if (Math.abs(lv.x - pv.x) + Math.abs(lv.y - pv.y) > V_EPS) {
          if (this.recording) (p.rest ? this._latRest : this._latOther).push({ ms: Math.max(0, now - p.t), frames: p.f });
          this._pend = null;
        } else if (++p.f > LAT_TIMEOUT_FRAMES || now - p.t > LAT_TIMEOUT_MS) {
          if (this.recording) this._latMiss++;
          this._pend = null;
        }
      }
    }
    pv.x = lv.x; pv.y = lv.y;
  },

  report() {
    const end = this.recording ? performance.now() : this._t1;
    const n = this._n;
    const fm = stats(this._frameMs, n);
    let over60 = 0, over30 = 0;
    for (let i = 0; i < n; i++) { const v = this._frameMs[i]; if (v > 18.5) over60++; if (v > 33.4) over30++; }
    const lag = stats(this._lag, this._nLag);
    const rs = this._rs, fv = this._fv;
    return {
      recording: this.recording,
      seconds: round((end - this._t0) / 1000, 2),
      frames: n,
      truncated: this._truncated,
      frameMs: { avg: fm.avg, p50: fm.p50, p95: fm.p95, p99: fm.p99, worst: fm.max, fpsAvg: fm.avg ? round(1000 / fm.avg, 1) : 0, framesOver18ms: over60, framesOver33ms: over30, hitches25ms: this._hitches, stalls: this._stalls },
      camLag: { samples: lag.n, avg: lag.avg, p95: lag.p95, max: round(this._lagMax), unit: 'world units' },
      inputLatency: this._latSeen
        ? { supported: true, fromRest: latSummary(this._latRest), other: latSummary(this._latOther), missed: this._latMiss }
        : { supported: false, note: 'input.stamp not present' },
      railSpeed: rs.n ? { min: round(rs.min, 2), avg: round(rs.sum / rs.n, 2), max: round(rs.max, 2) } : null,
      fov: fv.n ? { min: round(fv.min, 2), avg: round(fv.sum / fv.n, 2), max: round(fv.max, 2) } : null,
      shake: { peakOffset: round(this._shPeak), rmsOffset: rs.n ? round(Math.sqrt(this._shSq / rs.n)) : 0, peakRollDeg: round(this._shRoll * 57.29578, 2) },
      live: { fps: round(this.live.fps, 1), msP95: round(this.live.msP95, 2) },
    };
  },
};
