// Sound lab page script sfx-lab.html lists every sound effect from
// sfxGroups() and plays them through the same chain as the game (gain, compressor, limiter, master).
import { SFX, SFX_META } from '../sfx.js';
import { sfxGroups, createSfxChain, playSfx, rapidInterval, LEGACY_WEAPONS } from './registry.js';
import { WEAPON_SFX_PREV } from './weapons.js';
import { analyze } from './analyze.js';

const $ = (id) => document.getElementById(id);
const list = $('list'), status = $('status'), vol = $('vol'), pitch = $('pitch'), pvar = $('pvar');
const DESC = {
  laser: 'Level 1 pulse, CRISP AND BRIGHT. A bright fast laser fall (two detuned saws, 2.9 kHz to 520 Hz) with an octave shimmer, a click and an air band. 8 per second.',
  laser2: 'Level 2 twin, GRITTY AND INDUSTRIAL. Two barrels 30 ms apart: a slower laser fall through a bit crusher and a sine fold, gated buzz, ring modulated clang, rattle, sub. 6.8 per second.',
  laser3: 'Level 3 lance, PUNCHY AND BASS HEAVY. A deep laser fall through saturation with its own sub sine falling along the same curve, a low growl and a mid crack. 5.6 per second.',
  enemyLaser: 'Enemy shot (all ordinary shooters). The laser fall again but hostile: starts lower, thin (high passed), harsh (folded square plus a dissonant saw), mono, quieter than the player. Prev = the old enemy shot.',
  turretLaser: 'Turret and heavy enemy shot (bolts of radius 0.95 and up). Slower and heavier: an octave and a half lower fall with a sub. Prev = the old enemy shot.',
  bossCharge: 'Boss charge-up (Orrery, Tidebreaker siege cannon, Regent emitters): a rising stack with accelerating vibrato, shimmering noise and a latch. Prev = the lock-on charge.',
  bossCannon: 'Boss cannon (Tidebreaker siege shell, Regent heavy shots): the big laser, a fall from 3.4 kHz to 55 Hz with a deep sub. Deliberately the loudest laser (peak about 0.6). Prev = the homing volley.',
  bossBeam: 'Boss beam (Orrery sweep, Regent emitters), 1.8 s: opening fall, steady hum with flutter, shimmer. Prev = the homing volley.',
  allyLaser: 'Wingman shot (VEX pitched up): the laser fall, light, thin and quiet, panned to one side. Was silent before.',
  allyBlip: 'PIP the drone: a tiny two note blip. Was silent before.',
  laserCharge: 'Lock-on charge build: rising detuned saws through an opening filter, vibrato whine, accelerating noise pulse, latch tick.',
  lockon: 'Target ping: two crisp FM ticks a fifth apart. Rapid mode steps the pitch like consecutive locks in the game.',
  chargedShot: 'Homing volley launch: crack and thump, seven panned mini zaps, whoosh, saw tail, echo.',
  bomb: 'Pulse bomb: blast, sub boom, wide shockwave sweep, rolling rumble, debris and a cavernous tail.',
  reflect: 'Barrel roll deflect: struck metal ping with a chirp, ricochet zap, comb shimmer and a panned whoosh.',
};

// A/B variants of a recipe: new (current), prev (the recipe before the redesign), v1 (the very first recipe)
// Family names have no Prev recipe of their own; they compare against the sound the game played at that call site before (PREV_ALIAS).
const PREV_ALIAS = { enemyLaser: 'enemyShot', turretLaser: 'enemyShot', bossBeam: 'chargedShot', bossCannon: 'chargedShot', bossCharge: 'laserCharge' };
const aliasRecipe = (n) => {
  const a = PREV_ALIAS[n]; if (!a || !SFX[a]) return null;
  const k = (SFX_META[a]?.gain ?? 1) / 0.75;   // playSfx applies 0.75 to any recipe override, so scale it to the alias's own gain
  return (e) => { const g = e.ac.createGain(); g.gain.value = k; g.connect(e.out); return SFX[a]({ ...e, out: g }); };
};
// fire rates for the family (the registry only knows the player weapons)
const RATES = { enemyLaser: 4, turretLaser: 1.6, bossCharge: 0.7, bossCannon: 0.6, bossBeam: 0.4, allyLaser: 6, allyBlip: 6 };
const rateOf = (name) => (RATES[name] ? 1 / RATES[name] : rapidInterval(name));
const VARIANTS = {
  new: { label: 'New' },
  prev: { label: 'Prev', recipe: (n) => WEAPON_SFX_PREV[n] || aliasRecipe(n) },
  v1: { label: 'v1', recipe: (n) => LEGACY_WEAPONS[n] },
};
const variantsOf = (name) => Object.keys(VARIANTS).filter((k) => k === 'new' || VARIANTS[k].recipe(name));
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

let ac = null, chain = null, analyser = null, meterBuf = null;
let timers = [];
let peakHold = 0, peakAt = 0;
const rows = {};

function ensure() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  analyser = ac.createAnalyser(); analyser.fftSize = 1024;
  meterBuf = new Float32Array(analyser.fftSize);
  connect();
  requestAnimationFrame(meter);
}
function connect() {
  chain = createSfxChain(ac, Number(vol.value));
  chain.master.connect(analyser);
}

function meter(ts) {
  analyser.getFloatTimeDomainData(meterBuf);
  let pk = 0; for (let i = 0; i < meterBuf.length; i++) pk = Math.max(pk, Math.abs(meterBuf[i]));
  if (pk >= peakHold || ts - peakAt > 1500) { peakHold = pk; peakAt = ts; }
  const db = peakHold > 0.00001 ? 20 * Math.log10(peakHold) : -Infinity;
  $('db').textContent = Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-inf dB';
  const m = $('meter'); m.firstElementChild.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
  m.classList.toggle('hot', peakHold > 0.9);
  requestAnimationFrame(meter);
}

function flash(name) {
  const r = rows[name]; if (!r) return;
  r.classList.add('active'); clearTimeout(r._t); r._t = setTimeout(() => r.classList.remove('active'), 220);
}

/**
 * Renders the same shot offline (same recipe, same random seed and pitch, the game's sfx chain) and measures it, so the numbers under a
 * row belong to what was just heard. The shot starts at 0.3 s because the browser compressor attenuates the first ~40 ms of a fresh context.
 */
async function measure(name, variant, seed, pitch) {
  const def = VARIANTS[variant].recipe?.(name);
  const len = name === 'bomb' ? 3.4 : 1.7, sr = 44100;
  const oac = new OfflineAudioContext(2, Math.ceil(len * sr), sr), ch = createSfxChain(oac, Number(vol.value));
  playSfx(oac, ch, name, { t: 0.3, r: rng(seed), pitch, offline: true, recipe: def });
  const buf = await oac.startRendering();
  return analyze(buf.getChannelData(0), buf.getChannelData(1), sr);
}

const stats = {};
function showStats(name) {
  const r = rows[name]; if (!r) return;
  const el = r.querySelector('.num'); if (!el) return;
  el.textContent = variantsOf(name).filter((v) => stats[name]?.[v]).map((v) => {
    const a = stats[name][v], b = a.bands || {};
    return `${VARIANTS[v].label.padEnd(5)} peak ${a.peak.toFixed(2)}  RMS ${a.rmsDb.toFixed(1)} dB  crest ${a.crestDb.toFixed(1)}  A-energy ${a.aExpDb.toFixed(1)}  ` +
      `centroid ${a.centroid.toFixed(0)} Hz  sub/low/mid/high+air ${b.sub.toFixed(0)}/${b.low.toFixed(0)}/${b.mid.toFixed(0)}/${(b.high + b.air).toFixed(0)} %  ` +
      `fall ${a.ridgeTotalOct.toFixed(1)} oct (${a.ridgeRateEarly.toFixed(0)} oct/s early)  ${a.dur40Ms} ms`;
  }).join('\n');
}

/** One shot, like audio.js sfx(): pitch = base pitch times the random variation. */
function shot(name, o = {}) {
  ensure();
  const variant = o.variant || 'new';
  const jitter = 1 + (Math.random() * 2 - 1) * (Number(pvar.value) / 100);
  const pitchV = Number(pitch.value) * jitter * (o.pitchMul ?? 1), seed = (Math.random() * 4294967296) >>> 0;
  const dur = playSfx(ac, chain, name, {
    pitch: pitchV, recipe: VARIANTS[variant].recipe?.(name) || (o.legacy ? LEGACY_WEAPONS[name] : undefined), r: rng(seed), respect: true,
  });
  if (dur != null) {
    flash(name);
    if (!o.quiet) measure(name, variant, seed, pitchV).then((a) => { (stats[name] ||= {})[variant] = a; showStats(name); }).catch(() => {});
  }
  return dur;
}

function stopAll() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  if (chain) { try { chain.master.disconnect(); } catch (e) { /* gone */ } connect(); }   // cut every voice still ringing
  status.textContent = 'Stopped.';
}

/** A train at the game's fire rate: n shots (default 8), or `seconds` of continuous fire (the Hold buttons). */
function rapid(name, variant = 'new', seconds = 0) {
  ensure();
  const iv = rateOf(name), n = seconds ? Math.ceil(seconds / iv) : 8;
  let streak = 0;
  status.textContent = `${VARIANTS[variant].label} ${name} x${n} at ${(1 / iv).toFixed(1)} per second.`;
  for (let i = 0; i < n; i++) {
    timers.push(setTimeout(() => {
      // lock-on steps up two semitones per consecutive lock, like audio.js does
      const pitchMul = name === 'lockon' ? Math.pow(2, (Math.min(streak++, 7) * 2) / 12) : 1;
      shot(name, { variant, pitchMul, quiet: i > 0 && i < n - 1 });
    }, i * iv * 1000));
  }
}

/** Blind style comparison: v1, prev, new, each played 3 times at the game's rate with a pause between, so the ear can judge rhythm. */
function compare(name) {
  ensure();
  const iv = rateOf(name), order = ['v1', 'prev', 'new'].filter((v) => variantsOf(name).includes(v));
  status.textContent = `Compare ${name}: ${order.map((v) => VARIANTS[v].label).join(', then ')} (3 shots each).`;
  order.forEach((v, gi) => {
    for (let i = 0; i < 3; i++) timers.push(setTimeout(() => shot(name, { variant: v, quiet: i < 2 }), (gi * (3 * iv + 0.7) + i * iv) * 1000));
  });
}

/** The whole weapon family in a row, so the shooters can be judged against each other (player levels, enemies, allies, boss). */
const FAMILY = [['laser', 0.9], ['laser2', 0.9], ['laser3', 0.9], ['enemyLaser', 0.9], ['turretLaser', 1.0], ['allyLaser', 0.5], ['allyLaser', 0.5], ['allyBlip', 0.9],
  ['bossCharge', 1.5], ['bossCannon', 1.8], ['bossBeam', 2.2]];
function family() {
  ensure();
  let at = 0;
  const names = FAMILY.map(([n]) => n).filter((n, i, a) => a.indexOf(n) === i);
  status.textContent = `Family: ${names.join(', ')}.`;
  for (const [name, gap] of FAMILY) {
    const t0 = at;
    timers.push(setTimeout(() => shot(name, { quiet: true }), t0 * 1000));
    at += gap;
  }
}

// Measured profile of our laser recipes, measured live with an offline render. Columns: label, ms, peak, RMS dB, A-energy dB, centroid Hz,
// sub %, low %, mid %, high+air %, fall in octaves, early fall rate in oct/s, attack ms.
async function profileTable() {
  const el = $('profile'); if (!el) return;
  const OURS = ['laser', 'laser2', 'laser3', 'enemyLaser', 'turretLaser', 'allyLaser', 'bossCannon', 'bossBeam'];
  const line = (label, c) => `<tr><td>${label}</td>${c.map((x) => `<td>${x}</td>`).join('')}</tr>`;
  let html = '<table><tr><th></th><th>ms</th><th>peak</th><th>RMS dB</th><th>A-energy</th><th>centroid Hz</th><th>sub %</th><th>low %</th><th>mid %</th><th>high+air %</th><th>fall oct</th><th>oct/s early</th></tr>';
  for (const n of OURS) {
    try {
      const a = await measure(n, 'new', 12345, 1), b = a.bands;
      html += line(`<b>${n}</b> (ours)`, [a.dur40Ms, a.peak.toFixed(2), a.rmsDb.toFixed(1), a.aExpDb.toFixed(1), a.centroid.toFixed(0), b.sub.toFixed(0), b.low.toFixed(0), b.mid.toFixed(0), (b.high + b.air).toFixed(0), a.ridgeTotalOct.toFixed(1), a.ridgeRateEarly.toFixed(0)]);
    } catch (e) { /* offline rendering unavailable */ }
  }
  el.innerHTML = html + '</table>';
}

function metaText(name) {
  const m = SFX_META[name];
  return m ? `gap ${Math.round(m.gap * 1000)} ms, max ${m.max} voices, prio ${m.prio}${m.group ? `, group ${m.group}` : ''}, gain ${m.gain ?? 1}` : 'default limits';
}

function build() {
  list.innerHTML = '';
  for (const g of sfxGroups()) {
    const h = document.createElement('h2'); h.textContent = `${g.label} (${g.names.length})`; list.append(h);
    if (!g.names.length) { const p = document.createElement('p'); p.className = 'sub'; p.textContent = 'No sounds in this group.'; list.append(p); continue; }
    for (const name of g.names) {
      const isNew = g.id !== 'other';
      const row = document.createElement('div'); row.className = 'row'; rows[name] = row;
      row.innerHTML = `<div class="txt"><b>${name}<span class="badge ${isNew ? 'ok' : 'legacy'}">${isNew ? 'new' : 'legacy'}</span></b>` +
        `<small>${DESC[name] || (isNew ? '' : 'Old recipe, not redesigned yet.')}</small><small>${metaText(name)}</small></div>`;
      const btn = (label, fn, cls, title) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; if (title) b.title = title; b.onclick = fn; return b; };
      const cell = document.createElement('div'); cell.className = 'btns';
      cell.append(btn('Play', () => { shot(name); status.textContent = ''; }, 'pri'), btn('Rapid x8', () => rapid(name)));
      if (isNew && (WEAPON_SFX_PREV[name] || LEGACY_WEAPONS[name] || PREV_ALIAS[name])) {
        if (WEAPON_SFX_PREV[name] || PREV_ALIAS[name]) cell.append(btn('Hold 4 s', () => rapid(name, 'new', 4), '', 'Continuous fire at the game rate for 4 seconds'));
        for (const v of variantsOf(name).filter((x) => x !== 'new')) {
          const title = v === 'prev' ? (PREV_ALIAS[name] ? 'What the game played at this call site before the laser family' : 'The earlier player laser (before the falling sweep)') : 'The very first recipe';
          cell.append(btn(VARIANTS[v].label, () => { shot(name, { variant: v }); status.textContent = `${VARIANTS[v].label} ${name}.`; }, '', title), btn(`${VARIANTS[v].label} x8`, () => rapid(name, v)));
          if (v === 'prev') cell.append(btn('Prev hold', () => rapid(name, 'prev', 4)));
        }
        if (WEAPON_SFX_PREV[name] || PREV_ALIAS[name]) cell.append(btn('Compare', () => compare(name), 'pri', 'v1, prev and new, three shots each'));
      }
      row.append(cell);
      const num = document.createElement('pre'); num.className = 'num'; row.querySelector('.txt').append(num);
      list.append(row);
    }
  }
}

vol.oninput = () => { $('volval').textContent = Number(vol.value).toFixed(2); if (chain) chain.master.gain.setTargetAtTime(Number(vol.value), ac.currentTime, 0.02); };
pitch.oninput = () => { $('pitchval').textContent = Number(pitch.value).toFixed(2); };
pvar.oninput = () => { $('pvarval').textContent = `${pvar.value}%`; };
$('stop').onclick = stopAll;
$('family').onclick = family;
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopAll(); });
// notes for the listening rounds, kept in the browser and copyable
const notes = $('notes');
try { notes.value = localStorage.getItem('sfxLabNotes') || ''; } catch (e) { /* storage blocked */ }
notes.oninput = () => { try { localStorage.setItem('sfxLabNotes', notes.value); } catch (e) { /* storage blocked */ } };
$('notesAdd').onclick = () => {
  const line = `[pitch ${Number(pitch.value).toFixed(2)}, vol ${Number(vol.value).toFixed(2)}] `;
  notes.value += (notes.value && !notes.value.endsWith('\n') ? '\n' : '') + line; notes.focus(); notes.oninput();
};
$('notesCopy').onclick = () => { navigator.clipboard?.writeText(notes.value).then(() => { status.textContent = 'Notes copied.'; }, () => { notes.select(); }); };
build();
profileTable();
// debug hook for scripted checks
window.__sfxLab = { shot, rapid, compare, family, measure, stats, stopAll, get ac() { return ac; }, names: () => sfxGroups().flatMap((g) => g.names), SFX };
