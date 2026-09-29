// Sound lab page script (owned by the weapons sound agent). sfx-lab.html lists every sound effect from
// sfxGroups() and plays them through the same chain as the game (gain, compressor, limiter, master).
import { SFX, SFX_META } from '../sfx.js';
import { sfxGroups, createSfxChain, playSfx, rapidInterval, LEGACY_WEAPONS } from './registry.js';
import { LASER3_CANDIDATES, laser3Current } from './weapons.js';

const $ = (id) => document.getElementById(id);
const list = $('list'), status = $('status'), vol = $('vol'), pitch = $('pitch'), pvar = $('pvar');
const DESC = {
  laser: 'Level 1 pulse. Tight and light: noise click, punchy body, one bright FM zap, crackle band. Fires 8 per second.',
  laser2: 'Level 2 twin. Two panned barrels 30 ms apart, thicker body with saw growl and ring mod, slapback. 6.8 per second.',
  laser3: 'Level 3 hyper. Sub thump, distorted detuned saws, FM zap, ring mod clang, crackle tail and two echoes. 5.6 per second.',
  laserCharge: 'Lock-on charge build: rising detuned saws through an opening filter, vibrato whine, accelerating noise pulse, latch tick.',
  lockon: 'Target ping: two crisp FM ticks a fifth apart. Rapid mode steps the pitch like consecutive locks in the game.',
  chargedShot: 'Homing volley launch: crack and thump, seven panned mini zaps, whoosh, saw tail, echo.',
  bomb: 'Smart bomb: blast, sub boom, wide shockwave sweep, rolling rumble, debris and a cavernous tail.',
  reflect: 'Barrel roll deflect: struck metal ping with a chirp, ricochet zap, comb shimmer and a panned whoosh.',
};

let ac = null, chain = null, analyser = null, meterBuf = null;
let timers = [];
let peakHold = 0, peakAt = 0;
const rows = {};
const L3_RATE = 5.6;                                       // the level 3 laser fires 5.6 times per second in the game
const L3_NAMES = new Set(LASER3_CANDIDATES.map((c) => c.name));
// the current laser3, played by recipe so it stays the reference even when ?l3= or meridian-l3 is set. 0.96 = 0.72 / 0.75
// (playSfx uses a fixed 0.75 voice gain for recipe overrides, the laser3 meta gain is 0.72)
const L3_CURRENT = (e) => laser3Current({ ...e, v: e.v * 0.96 });
let mixOn = false;

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

/** One shot, like audio.js sfx(): pitch = base pitch times the random variation. */
function shot(name, o = {}) {
  ensure();
  const jitter = 1 + (Math.random() * 2 - 1) * (Number(pvar.value) / 100);
  const dur = playSfx(ac, chain, name, {
    pitch: Number(pitch.value) * jitter * (o.pitchMul ?? 1), recipe: o.recipe || (o.legacy ? LEGACY_WEAPONS[name] : undefined), respect: true,
  });
  if (dur != null) flash(name);
  return dur;
}

function stopAll() {
  for (const t of timers) clearTimeout(t);
  timers = []; mixOn = false; $('mix').classList.remove('on');
  if (chain) { try { chain.master.disconnect(); } catch (e) { /* gone */ } connect(); }   // cut every voice still ringing
  status.textContent = 'Stopped.';
}

function rapid(name, legacy) {
  ensure();
  const iv = rapidInterval(name), n = 8;
  let streak = 0;
  status.textContent = `${legacy ? 'Old ' : ''}${name} x${n} at ${(1 / iv).toFixed(1)} per second.`;
  for (let i = 0; i < n; i++) {
    timers.push(setTimeout(() => {
      // lock-on steps up two semitones per consecutive lock, like audio.js does
      const pitchMul = name === 'lockon' ? Math.pow(2, (Math.min(streak++, 7) * 2) / 12) : 1;
      shot(name, { legacy, pitchMul });
    }, i * iv * 1000));
  }
}

/** Level 3 laser rows: n shots of one candidate (or the current sound) at 5.6 per second, starting after delay seconds. */
function l3Burst(id, n, delay = 0) {
  const c = LASER3_CANDIDATES.find((x) => x.id === id);
  for (let i = 0; i < n; i++) {
    timers.push(setTimeout(() => (c ? shot(c.name) : shot('laser3', { recipe: L3_CURRENT })), (delay + i / L3_RATE) * 1000));
  }
}
const L3_LABEL = { current: 'CURRENT laser3' };
for (const c of LASER3_CANDIDATES) L3_LABEL[c.id] = `${c.id.toUpperCase()}: ${c.title}`;

/** A/B loop: current, a, b, c, d one after the other, 3 seconds of rapid fire each, repeating until Stop. */
function rapidMix() {
  ensure();
  if (mixOn) { stopAll(); return; }
  mixOn = true; $('mix').classList.add('on');
  const order = ['current', ...LASER3_CANDIDATES.map((c) => c.id)], SEG = 3, GAP = 0.4;
  const cycle = () => {
    if (!mixOn) return;
    order.forEach((id, k) => {
      const t0 = k * (SEG + GAP);
      timers.push(setTimeout(() => { status.textContent = `Rapid mix ${k + 1}/${order.length}: ${L3_LABEL[id]} (loops until Stop)`; }, t0 * 1000));
      l3Burst(id, Math.floor(SEG * L3_RATE) + 1, t0);
    });
    timers.push(setTimeout(cycle, order.length * (SEG + GAP) * 1000));
  };
  cycle();
}

function currentGame() { try { return localStorage.getItem('meridian-l3') || ''; } catch (e) { return ''; } }
function buildL3() {
  const box = $('l3'); box.innerHTML = '';
  const h = document.createElement('h2'); h.textContent = 'Laser level 3 candidates'; box.append(h);
  const intro = document.createElement('p'); intro.className = 'sub';
  intro.textContent = 'Four directions for the hyper laser, all with less bass than the current one and a shorter tail. Each row has Play (one shot) and Rapid x8 (5.6 per second, the real fire rate). "Rapid mix" loops current, A, B, C, D with 3 seconds of rapid fire each. In the game: open it with ?l3=a (or b, c, d), or press "Use in game" below (sets localStorage meridian-l3 for this browser).';
  box.append(intro);
  const mk = (id, title, desc) => {
    const row = document.createElement('div'); row.className = 'row'; rows[`l3:${id}`] = row;
    const c = LASER3_CANDIDATES.find((x) => x.id === id);
    row.innerHTML = `<div class="txt"><b>${title}<span class="badge ${c ? 'ok' : 'legacy'}">${c ? 'candidate' : 'reference'}</span></b><small>${desc}</small></div>`;
    const play = document.createElement('button'); play.className = 'pri'; play.textContent = 'Play';
    play.onclick = () => { l3Burst(id, 1); flashL3(id); status.textContent = L3_LABEL[id]; };
    const rap = document.createElement('button'); rap.textContent = 'Rapid x8';
    rap.onclick = () => { ensure(); l3Burst(id, 8); flashL3(id, 8 / L3_RATE * 1000); status.textContent = `${L3_LABEL[id]} x8 at ${L3_RATE} per second.`; };
    const use = document.createElement('button'); use.textContent = 'Use in game'; use.title = 'Sets localStorage meridian-l3 (the game reads it at every shot)';
    use.dataset.l3 = id === 'current' ? '' : id;
    use.onclick = () => { try { if (id === 'current') localStorage.removeItem('meridian-l3'); else localStorage.setItem('meridian-l3', id); } catch (e) { /* storage blocked */ } markUse(); status.textContent = id === 'current' ? 'Game uses the current laser3 (unless the URL has ?l3=).' : `Game uses candidate ${id.toUpperCase()} (unless the URL has ?l3=).`; };
    row.append(play, rap, use);
    box.append(row);
  };
  mk('current', 'Play current', 'The current level 3 laser for comparison: sub thump, distorted detuned saws, FM zap, ring mod clang, crackle tail and two echoes. Heavy but muddy, about 70 percent of its energy below 200 Hz.');
  for (const c of LASER3_CANDIDATES) mk(c.id, `${c.id.toUpperCase()}: ${c.title}`, c.desc);
  const bar = document.createElement('div'); bar.className = 'tools';
  const mix = document.createElement('button'); mix.id = 'mix'; mix.className = 'pri'; mix.textContent = 'Rapid mix (current, A, B, C, D)'; mix.onclick = rapidMix;
  const hint = document.createElement('span'); hint.className = 'sub'; hint.style.margin = '0'; hint.textContent = 'Loops until Stop all. Press again to stop.';
  bar.append(mix, hint); box.append(bar);
  markUse();
}
function markUse() { const cur = currentGame(); for (const b of document.querySelectorAll('button[data-l3]')) { const on = b.dataset.l3 === cur; b.classList.toggle('sel', on); b.textContent = on ? 'In game now' : 'Use in game'; } }
function flashL3(id, ms = 260) { const r = rows[`l3:${id}`]; if (!r) return; r.classList.add('active'); clearTimeout(r._t); r._t = setTimeout(() => r.classList.remove('active'), ms); }

function metaText(name) {
  const m = SFX_META[name];
  return m ? `gap ${Math.round(m.gap * 1000)} ms, max ${m.max} voices, prio ${m.prio}${m.group ? `, group ${m.group}` : ''}, gain ${m.gain ?? 1}` : 'default limits';
}

function build() {
  list.innerHTML = '';
  for (const g of sfxGroups()) {
    const h = document.createElement('h2'); h.textContent = `${g.label} (${g.names.filter((n) => !L3_NAMES.has(n)).length})`; list.append(h);
    if (!g.names.length) { const p = document.createElement('p'); p.className = 'sub'; p.textContent = 'Nothing delivered yet.'; list.append(p); continue; }
    for (const name of g.names) {
      if (L3_NAMES.has(name)) continue;                       // shown in the level 3 candidates section
      const isNew = g.id !== 'other';
      const row = document.createElement('div'); row.className = 'row'; rows[name] = row;
      row.innerHTML = `<div class="txt"><b>${name}<span class="badge ${isNew ? 'ok' : 'legacy'}">${isNew ? 'new' : 'legacy'}</span></b>` +
        `<small>${DESC[name] || (isNew ? '' : 'Old recipe, not redesigned yet.')}</small><small>${metaText(name)}</small></div>`;
      const play = document.createElement('button'); play.className = 'pri'; play.textContent = 'Play'; play.onclick = () => { shot(name); status.textContent = ''; };
      const rap = document.createElement('button'); rap.textContent = 'Rapid x8'; rap.onclick = () => rapid(name, false);
      row.append(play, rap);
      if (LEGACY_WEAPONS[name] && isNew) {
        const old = document.createElement('button'); old.textContent = 'Old'; old.title = 'The previous recipe'; old.onclick = () => { shot(name, { legacy: true }); status.textContent = `Old ${name}.`; };
        const oldRap = document.createElement('button'); oldRap.textContent = 'Old x8'; oldRap.onclick = () => rapid(name, true);
        row.append(old, oldRap);
      }
      list.append(row);
    }
  }
}

vol.oninput = () => { $('volval').textContent = Number(vol.value).toFixed(2); if (chain) chain.master.gain.setTargetAtTime(Number(vol.value), ac.currentTime, 0.02); };
pitch.oninput = () => { $('pitchval').textContent = Number(pitch.value).toFixed(2); };
pvar.oninput = () => { $('pvarval').textContent = `${pvar.value}%`; };
$('stop').onclick = stopAll;
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopAll(); });
build(); buildL3();
// debug hook for scripted checks
window.__sfxLab = { shot, rapid, stopAll, l3Burst, rapidMix, get ac() { return ac; }, names: () => sfxGroups().flatMap((g) => g.names), SFX };
