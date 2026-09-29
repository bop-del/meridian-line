// Plays a music track (a "variant module") bar by bar with lookahead scheduling. Same duck typing as Sequencer in
// ../music.js (scheduleUntil, fadeIn, fadeOut, dispose, done, endTime, song.loop) so MusicEngine can treat both alike.
//
// A track module exports:
//   export const meta = { id, name, description, bpm, bars, beatsPerBar = 4, barDur?, loop = true, tail = 3 };
//   export function create(ac, out) -> { scheduleBar(t0, barIndex, loopIndex), setIntensity?(x0to1), dispose() }
// scheduleBar must schedule everything for one bar starting at absolute AudioContext time t0. Notes and effect tails may
// ring past the bar. It is called just before the bar starts and must be cheap (no big allocations). A looping track must be
// seamless: the last bar leads into bar 0. create() may build reverbs, delays and buses on `out`. Use only the `ac` it is
// given (it can be an OfflineAudioContext in tests).
//
// meta.loop === false marks a one-shot stinger: `bars` bars are played once, then the player is done and endTime is set
// meta.tail seconds (default 3) after the last bar so the reverb tail rings out. The engine then disposes it.
// setIntensity(x) is forwarded on every scheduling tick (about every 40 ms) with the engine's current intensity 0..1
// (the boss track always gets 1). The track must slew inside, never jump.
export class VariantPlayer {
  constructor(ac, dest, variant, { startTime, getIntensity, name } = {}) {
    this.ac = ac;
    this.meta = variant.meta;
    this.trackName = name || variant.meta?.id || 'track';
    this.getIntensity = getIntensity || (() => 0.5);
    this.song = { name: this.trackName, loop: this.meta.loop !== false };
    this.bus = ac.createGain();
    this.bus.connect(dest);
    this.inst = variant.create(ac, this.bus);
    this.supportsIntensity = typeof this.inst.setIntensity === 'function';
    this.lastIntensity = null;
    this.barDur = this.meta.barDur ?? ((this.meta.beatsPerBar ?? 4) * 60) / this.meta.bpm;
    this.bar = 0; this.loop = 0; this.barsPlayed = 0;
    this.t = startTime ?? ac.currentTime + 0.06;
    this.done = false; this.endTime = Infinity;
    this.pushIntensity();
  }

  pushIntensity() {
    if (!this.supportsIntensity) return;
    let x = this.getIntensity();
    if (!Number.isFinite(x)) x = 0.5;
    x = Math.max(0, Math.min(1, x));
    this.lastIntensity = x;
    try { this.inst.setIntensity(x); } catch (e) { /* a track must never take the engine down */ }
  }

  scheduleUntil(until) {
    if (this.done) return;
    this.pushIntensity();
    while (!this.done && this.t < until) {
      this.inst.scheduleBar(this.t, this.bar, this.loop);
      this.t += this.barDur;
      this.barsPlayed++;
      if (++this.bar >= this.meta.bars) {
        if (this.meta.loop === false) {
          this.done = true;
          this.endTime = this.t + (this.meta.tail ?? 3);
        } else { this.bar = 0; this.loop++; }
      }
    }
  }

  fadeIn(t, dur) {
    this.bus.gain.setValueAtTime(0.0001, t);
    this.bus.gain.exponentialRampToValueAtTime(1, t + Math.max(0.05, dur));
  }

  fadeOut(t, dur) {
    const g = this.bus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value || 1), t);
    g.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, dur));
    this.endTime = Math.min(this.endTime, t + dur + 0.1);
    this.done = true;
  }

  dispose() {
    try { this.inst.dispose?.(); } catch (e) { /* ignore */ }
    try { this.bus.disconnect(); } catch (e) { /* ignore */ }
  }
}
