// Plays a title music variant bar by bar with lookahead scheduling. Same duck typing as Sequencer in ../music.js
// (scheduleUntil, fadeIn, fadeOut, dispose, done, endTime, song.loop) so MusicEngine can treat both alike.
//
// A variant module exports:
//   export const meta = { id, name, description, bpm, bars, beatsPerBar = 4, barDur? };  // bars = loop length in bars
//   export function create(ac, out) -> { scheduleBar(t0, barIndex, loopIndex), dispose() }
// scheduleBar must schedule everything for one bar starting at absolute AudioContext time t0. Notes and effect tails may
// ring past the bar. It is called just before the bar starts and must be cheap (no big allocations). The loop must be
// seamless: the last bar leads into bar 0. create() may build reverbs, delays and buses on `out`. Use only the `ac` it is
// given (it can be an OfflineAudioContext in tests).
export class VariantPlayer {
  constructor(ac, dest, variant, { startTime } = {}) {
    this.ac = ac;
    this.meta = variant.meta;
    this.song = { name: 'title', loop: true };
    this.bus = ac.createGain();
    this.bus.connect(dest);
    this.inst = variant.create(ac, this.bus);
    this.barDur = this.meta.barDur ?? ((this.meta.beatsPerBar ?? 4) * 60) / this.meta.bpm;
    this.bar = 0; this.loop = 0;
    this.t = startTime ?? ac.currentTime + 0.06;
    this.done = false; this.endTime = Infinity;
  }

  scheduleUntil(until) {
    while (!this.done && this.t < until) {
      this.inst.scheduleBar(this.t, this.bar, this.loop);
      this.t += this.barDur;
      if (++this.bar >= this.meta.bars) { this.bar = 0; this.loop++; }
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
