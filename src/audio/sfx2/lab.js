// Sound lab page script sfx-lab.html lists every sound effect from
// sfxGroups() and plays them through the same chain as the game (gain, compressor, limiter, master).
import { SFX, SFX_META } from '../sfx.js';
import { sfxGroups, createSfxChain, playSfx, rapidInterval, LEGACY_WEAPONS } from './registry.js';

const $ = (id) => document.getElementById(id);
const list = $('list'), status = $('status'), vol = $('vol'), pitch = $('pitch'), pvar = $('pvar');
const DESC = {
  laser: 'Level 1 pulse. Tight and light: noise click, punchy body, one bright FM zap, crackle band. Fires 8 per second.',
  laser2: 'Level 2 twin. Two panned barrels 30 ms apart, thicker body with saw growl and ring mod, slapback. 6.8 per second.',
  laser3: 'Level 3 hyper. Plasma cannon punch: a tight sub thump, a sharp bright crack and a short metallic ring, dry with no tail. 5.6 per second.',
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
  timers = [];
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
build();
// debug hook for scripted checks
window.__sfxLab = { shot, rapid, stopAll, get ac() { return ac; }, names: () => sfxGroups().flatMap((g) => g.names), SFX };
