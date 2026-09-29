// Procedural music: bar-based lookahead sequencer (legacy songs), style tracks (VariantPlayer), crossfading engine, intensity layering.
import { compileSong, SONG_DEFS } from './songs.js';
import { VariantPlayer } from './title/player.js';
import { STYLES, DEFAULT_STYLE, selectedStyle } from './styles/registry.js';
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

/**
 * Owns the active player and the ones fading out. Every play(name) resolves through the selected style
 * (STYLES[style].tracks[name], played by VariantPlayer). A track the style does not define falls back to the legacy
 * Sequencer song in songs.js; the title always resolves to a style track (the default style's title as last resort).
 */
export class MusicEngine {
  constructor(ac, dest, { styles = STYLES, styleId, legacy = SONG_DEFS, timer = true } = {}) {
    this.ac = ac;
    this.dest = dest;
    this.styles = styles;
    this.legacy = legacy;
    this.styleId = styleId && styles[styleId] ? styleId : selectedStyle(styles, DEFAULT_STYLE in styles ? DEFAULT_STYLE : Object.keys(styles)[0]);
    this.cur = null;
    this.curName = null;
    this.curStyle = null;   // style id the current player was resolved from (null = legacy song)
    this.old = [];
    this.intensity = 0.4;
    this.target = 0.4;
    this.compiled = new Map();
    this.timer = timer ? setInterval(() => this.tick(), TICK_MS) : null;
  }

  song(name) {
    let s = this.compiled.get(name);
    if (!s) { s = compileSong(name, this.legacy[name]); this.compiled.set(name, s); }
    return s;
  }

  /** Where a track comes from: {kind:'style', styleId, module} or {kind:'legacy'} or null when it does not exist. */
  resolve(name, styleId = this.styleId) {
    const m = this.styles[styleId]?.tracks?.[name];
    if (m) return { kind: 'style', styleId, module: m };
    if (name === 'title') {
      // the legacy title song is gone: fall back to the default style, then to any style that has a title
      const alt = [DEFAULT_STYLE, ...Object.keys(this.styles)].find((id) => this.styles[id]?.tracks?.title);
      if (alt) return { kind: 'style', styleId: alt, module: this.styles[alt].tracks.title };
      return null;
    }
    if (this.legacy[name]) return { kind: 'legacy' };
    return null;
  }

  has(name) { return !!this.resolve(name); }

  /** Current effective intensity for a track: the boss track is always full. */
  intensityFor(name) { return name === 'boss' ? 1 : this.intensity; }

  play(name, { fade = 1.4, style, variant } = {}) {
    const sid = (style ?? variant) && this.styles[style ?? variant] ? (style ?? variant) : this.styleId;
    const res = this.resolve(name, sid);
    if (!res) return false;
    const key = res.kind === 'style' ? res.styleId : null;
    const cur = this.cur;
    if (cur && !cur.done && this.curName === name && this.curStyle === key) return true;
    const ac = this.ac;
    const now = ac.currentTime;
    if (cur) { cur.fadeOut(now, fade); this.old.push(cur); }
    let seq;
    if (res.kind === 'style') {
      seq = new VariantPlayer(ac, this.dest, res.module, { startTime: now + 0.08, name, getIntensity: () => this.intensityFor(name) });
    } else {
      seq = new Sequencer(ac, this.dest, this.song(name), { startTime: now + 0.08, getIntensity: () => this.intensity });
      if (seq.song.fixed !== undefined) this.intensity = seq.song.fixed;
    }
    seq.fadeIn(now, this.old.length ? fade : Math.min(fade, 0.6));
    this.cur = seq;
    this.curName = name;
    this.curStyle = key;
    this.tick();
    return true;
  }

  /** Switches the style. A track that is playing restarts in the new style with a crossfade. */
  setStyle(id, { fade = 0.9 } = {}) {
    if (!this.styles[id] || id === this.styleId) return false;
    this.styleId = id;
    if (this.cur && !this.cur.done && this.curName) this.play(this.curName, { fade });
    return true;
  }

  stop(fade = 1.2) {
    if (!this.cur) return;
    this.cur.fadeOut(this.ac.currentTime, fade);
    this.old.push(this.cur);
    this.cur = null; this.curName = null; this.curStyle = null;
  }

  setIntensity(x, immediate = false) {
    this.target = Math.max(0, Math.min(1, x));
    if (immediate) this.intensity = this.target;
  }

  /** {style, track, playing, intensity, loop, source} for tests and the debug hook. */
  status() {
    const cur = this.cur;
    const playing = !!cur && (!cur.done || this.ac.currentTime < cur.endTime);
    return {
      style: this.styleId, track: this.curName, playing, intensity: this.intensity,
      loop: cur ? cur.song.loop !== false : null,
      source: cur ? (cur.meta ? 'style:' + this.curStyle : 'legacy') : null,
    };
  }

  tick() {
    const ac = this.ac;
    const now = ac.currentTime;
    const look = typeof document !== 'undefined' && document.hidden ? 2.6 : 0.5;
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-TICK_MS / 1000 / 2.5));
    if (this.cur && !this.cur.done) this.cur.scheduleUntil(now + look);
    for (const s of this.old) if (!s.done) s.scheduleUntil(now + look);
    // a finished one-shot keeps its tail; a faded song is disposed
    this.old = this.old.filter((s) => {
      if (now > s.endTime + 2.5) { s.dispose(); return false; }
      return true;
    });
    if (this.cur && this.cur.done && !this.cur.song.loop && now > this.cur.endTime + 1) {
      this.cur.dispose(); this.cur = null; this.curName = null; this.curStyle = null;
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    for (const s of [this.cur, ...this.old]) s?.dispose();
    this.cur = null; this.old = [];
  }
}
