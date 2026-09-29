// Procedural music: bar-based lookahead sequencer, crossfading song engine, intensity layering.
import { compileSong, SONG_DEFS } from './songs.js';
import { TITLE_VARIANTS, VariantPlayer, selectedTitleVariant } from './title/registry.js';
import { leadNote, padChord, bassNote, arpNote, stab, kick, snare, hat, crash, tom } from './instruments.js';

const TICK_MS = 40;

/** Plays one compiled song into `out`. Bars are generated just before they start (lookahead scheduling). */
export class Sequencer {
  constructor(ac, out, song, { startTime, getIntensity, log } = {}) {
    this.ac = ac;
    this.song = song;
    this.getIntensity = getIntensity || (() => 0.5);
    this.log = log || null;
    this.bus = ac.createGain();
    this.trim = ac.createGain();
    this.trim.gain.value = song.trim ?? 0.6;
    this.bus.connect(this.trim);
    this.trim.connect(out);
    this.done = false;
    this.secIdx = 0; this.barInSec = 0; this.loops = 0; this.barCount = 0;
    this.barTime = startTime ?? ac.currentTime + 0.06;
    this.endTime = Infinity;

    // dotted-eighth style echo shared by lead, arp and pad (space)
    const d = song.delay;
    this.send = ac.createGain();
    this.send.gain.value = d.wet;
    this.delay = ac.createDelay(2);
    this.delay.delayTime.value = d.time;
    this.fb = ac.createGain(); this.fb.gain.value = d.fb;
    this.dlp = ac.createBiquadFilter(); this.dlp.type = 'lowpass'; this.dlp.frequency.value = 2600;
    this.send.connect(this.delay);
    this.delay.connect(this.dlp); this.dlp.connect(this.fb); this.fb.connect(this.delay);
    this.dlp.connect(this.bus);
  }

  scheduleUntil(until) {
    while (!this.done && this.barTime < until) this.scheduleBar();
  }

  scheduleBar() {
    const { song, ac } = this;
    const sec = song.sections[this.secIdx];
    const b = this.barInSec;
    const t0 = this.barTime;
    const sd = song.stepDur;
    const I = song.fixed ?? this.getIntensity();
    const L = song.layers;
    const out = this.bus;
    const vox = sec.voicings[b];
    const chord = sec.chords[b];
    const rootMidi = 36 + chord.root;
    if (this.log) this.log.push({ bar: this.barCount, t: t0, section: this.secIdx, chord: chord.name, intensity: +I.toFixed(2) });

    // section start accent
    if (b === 0 && I >= L.crash) crash(ac, out, t0, this.barCount === 0 ? 0.8 : 0.9);

    // pad
    if (I >= L.pad) padChord(ac, out, this.send, t0, song.barDur + 0.05, vox, song.padStyle, song.name === 'gameover' ? 1.1 : 1);

    // bass
    if (I >= L.bass && sec.bassPat) {
      const pat = sec.bassPat;
      for (let s = 0; s < 16; s++) {
        const ch = pat[s];
        if (!ch || ch === '.') continue;
        let next = s + 1;
        while (next < 16 && pat[next] === '.') next++;
        const len = (next - s) * sd * 0.92;
        const m = rootMidi + (ch === 'o' ? 12 : ch === 'f' ? 7 : 0);
        const accent = s % 4 === 0 ? 1 : 0.8;
        bassNote(ac, out, t0 + s * sd, len, m, accent, song.name === 'foundry' ? 'square' : 'saw');
      }
    }

    // drums (with a snare fill on the last bar of each 4 bar group)
    const kit = sec.kit;
    const fill = b % 4 === 3 && I >= L.snare && kit.snare;
    if (I >= L.kick && kit.kick) for (let s = 0; s < 16; s++) if (kit.kick[s] === 'x' && !(fill && s >= 12)) kick(ac, out, t0 + s * sd, s % 4 === 0 ? 1 : 0.85);
    if (I >= L.snare && kit.snare) {
      for (let s = 0; s < 16; s++) if (kit.snare[s] === 'x' && !(fill && s >= 12)) snare(ac, out, t0 + s * sd, 1);
      if (fill) for (let s = 12; s < 16; s++) snare(ac, out, t0 + s * sd, 0.55 + (s - 12) * 0.15);
      if (fill && song.name === 'title') { tom(ac, out, t0 + 10 * sd, 150, 0.8); tom(ac, out, t0 + 11 * sd, 110, 0.8); }
    }
    if (I >= L.hat && kit.hat) {
      for (let s = 0; s < 16; s++) {
        const c = kit.hat[s];
        if (c === 'x' || c === 'o') hat(ac, out, t0 + s * sd, c === 'o', s % 4 === 0 ? 1 : 0.7);
        else if (I >= 0.7 && s % 2 === 1 && song.name !== 'foundry' && song.name !== 'title') hat(ac, out, t0 + s * sd, false, 0.3);
      }
    }

    // arpeggio
    if (I >= L.arp && sec.arpPat) {
      const tones = vox.concat(vox.map((n) => n + 12));
      for (let s = 0; s < 16; s++) {
        const ch = sec.arpPat[s];
        if (!ch || ch === '.') continue;
        const idx = parseInt(ch, 10);
        arpNote(ac, out, this.send, t0 + s * sd, tones[idx % tones.length] + 12, s % 4 === 0 ? 1 : 0.75, sd * 1.6);
      }
    }

    // brass stabs
    if (I >= L.stab && sec.stabPat) {
      for (let s = 0; s < 16; s++) if (sec.stabPat[s] === 'x') stab(ac, out, t0 + s * sd, sd * 1.8, vox, s === 0 ? 1 : 0.85);
    }

    // lead melody (+ optional bell sparkle doubling at high intensity)
    if (I >= L.lead) {
      for (const n of sec.leadByBar[b]) {
        const dur = n.dur * sd * (n.dur >= 6 ? 0.98 : 0.9);
        leadNote(ac, out, this.send, t0 + n.step * sd, dur, n.midi, n.step % 4 === 0 ? 1 : 0.88, song.leadStyle);
        if (I >= L.sparkle && song.leadStyle !== 'strings') leadNote(ac, out, this.send, t0 + n.step * sd, dur, n.midi + 12, 0.7, 'bell');
      }
    }

    // advance
    this.barTime += song.barDur;
    this.barCount++;
    this.barInSec++;
    if (this.barInSec >= sec.bars) {
      this.barInSec = 0;
      this.secIdx++;
      if (this.secIdx >= song.sections.length) {
        if (song.loop) { this.secIdx = 0; this.loops++; } else { this.done = true; this.endTime = this.barTime + 1.5; }
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
    for (const n of [this.bus, this.trim, this.send, this.delay, this.fb, this.dlp]) { try { n.disconnect(); } catch (e) { /* ignore */ } }
  }
}

/** Owns the active sequencer and the ones fading out. */
export class MusicEngine {
  constructor(ac, dest) {
    this.ac = ac;
    this.dest = dest;
    this.cur = null;
    this.curName = null;
    this.old = [];
    this.intensity = 0.4;
    this.target = 0.4;
    this.compiled = new Map();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  song(name) {
    let s = this.compiled.get(name);
    if (!s) { s = compileSong(name); this.compiled.set(name, s); }
    return s;
  }

  has(name) { return !!SONG_DEFS[name] || name === 'title'; }


  play(name, { fade = 1.4, variant } = {}) {
    // title music variants (src/audio/title): opts.variant overrides, 'orig' forces the original sequencer song
    const vid = name === 'title' ? (variant ?? selectedTitleVariant()) : null;
    const custom = vid ? TITLE_VARIANTS[vid] : null;
    if (!custom && !SONG_DEFS[name]) return false;
    if (custom && this.curName === name && this.cur && !this.cur.done && this.cur.meta?.id === vid) return true;
    if (!custom && this.curName === name && this.cur && !this.cur.done && !this.cur.meta) return true;
    if (this.curName === name && this.cur && this.cur.song.loop === false) { /* finished fanfare: allow restart */ }
    const ac = this.ac;
    const now = ac.currentTime;
    if (this.cur) { this.cur.fadeOut(now, fade); this.old.push(this.cur); }
    const song = custom ? null : this.song(name);
    const seq = custom
      ? new VariantPlayer(ac, this.dest, custom, { startTime: now + 0.08 })
      : new Sequencer(ac, this.dest, song, { startTime: now + 0.08, getIntensity: () => this.intensity });
    seq.fadeIn(now, this.old.length ? fade : Math.min(fade, 0.6));
    this.cur = seq;
    this.curName = name;
    if (song?.fixed !== undefined) this.intensity = song.fixed;
    this.tick();
    return true;
  }

  stop(fade = 1.2) {
    if (!this.cur) return;
    this.cur.fadeOut(this.ac.currentTime, fade);
    this.old.push(this.cur);
    this.cur = null; this.curName = null;
  }

  setIntensity(x) { this.target = Math.max(0, Math.min(1, x)); }

  tick() {
    const ac = this.ac;
    const now = ac.currentTime;
    const look = typeof document !== 'undefined' && document.hidden ? 2.6 : 0.5;
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-TICK_MS / 1000 / 2.5));
    if (this.cur && !this.cur.done) this.cur.scheduleUntil(now + look);
    for (const s of this.old) if (!s.done) s.scheduleUntil(now + look);
    // a finished one-shot song keeps its tail; a faded song is disposed
    this.old = this.old.filter((s) => {
      if (now > s.endTime + 2.5) { s.dispose(); return false; }
      return true;
    });
    if (this.cur && this.cur.done && !this.cur.song.loop && now > this.cur.endTime + 3) {
      this.cur.dispose(); this.cur = null; this.curName = null;
    }
  }

  dispose() {
    clearInterval(this.timer);
    for (const s of [this.cur, ...this.old]) s?.dispose();
    this.cur = null; this.old = [];
  }
}
