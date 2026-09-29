// Music lab page: music-lab.html (next to the game's index.html). Audition every track of every style.
import { MusicEngine } from '../music.js';
import { clampBiquads } from '../audio.js';
import { compileSong, SONG_DEFS } from '../songs.js';
import { STYLES, TRACK_NAMES, DEFAULT_STYLE, selectedStyle, saveStyle, styleList } from '../styles/registry.js';

const $ = (id) => document.getElementById(id);
const list = $('list'), status = $('status'), vol = $('vol'), sel = $('style'), int = $('int'), intval = $('intval'), intnote = $('intnote');
let ac = null, master = null, engine = null;
let playing = null;           // { style, track }
let styleId = selectedStyle();
if (!STYLES[styleId]) styleId = DEFAULT_STYLE;
let usedStyle = styleId;
let manualIntensity = Number(int.value);

function ensure() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  clampBiquads(ac);
  master = ac.createGain(); master.gain.value = Number(vol.value);
  const comp = ac.createDynamicsCompressor();
  master.connect(comp); comp.connect(ac.destination);
  engine = new MusicEngine(ac, master, { styleId });
  engine.setIntensity(manualIntensity, true);
}

function info(track) {
  const m = STYLES[styleId]?.tracks?.[track];
  if (m) {
    const meta = m.meta, beats = meta.beatsPerBar ?? 4;
    const barDur = meta.barDur ?? (beats * 60) / meta.bpm;
    const loop = meta.loop !== false;
    return { available: true, name: meta.name || track, desc: meta.description || '', bpm: meta.bpm, bars: meta.bars, loop, secs: Math.round(meta.bars * barDur) };
  }
  if (track === 'title') return { available: false, name: 'missing title', desc: 'This style has no title track, the game uses the default style title.', bpm: '?', bars: '?', loop: true, secs: 0, missing: true };
  const def = SONG_DEFS[track];
  if (!def) return { available: false, name: 'nothing', desc: 'No track and no legacy song.', bpm: '?', bars: '?', loop: true, secs: 0, missing: true };
  let bars = 0, loop = true;
  try { const s = compileSong(track); bars = s.sections.reduce((n, x) => n + x.bars, 0); loop = s.loop !== false; } catch (e) { /* ignore */ }
  return { available: false, name: `legacy: ${def.name || track}`, desc: 'Falls back to the old sequencer song.', bpm: def.bpm, bars, loop, secs: Math.round((bars * 240) / def.bpm) };
}

function render() {
  list.innerHTML = '';
  for (const track of TRACK_NAMES) {
    const i = info(track);
    const active = playing && playing.style === styleId && playing.track === track;
    const row = document.createElement('div'); row.className = 'row' + (active ? ' active' : ''); row.dataset.track = track;
    const badge = i.available ? '<span class="badge ok">available</span>' : `<span class="badge legacy">${i.missing ? 'missing' : 'falls back to legacy'}</span>`;
    const kind = i.loop ? '<span class="badge">loop</span>' : '<span class="badge">one-shot</span>';
    row.innerHTML = `<div class="txt"><b>${track.toUpperCase()}: ${i.name}${badge}${kind}</b>` +
      `<small>${i.bpm} BPM, ${i.bars} bars${i.secs ? `, about ${i.secs} s` : ''}. ${i.desc}</small><small class="live" data-live></small></div>`;
    const play = document.createElement('button'); play.className = 'pri'; play.textContent = active ? 'Restart' : 'Play';
    play.disabled = !!i.missing && track !== 'title';
    play.onclick = () => playTrack(track);
    const stop = document.createElement('button'); stop.textContent = 'Stop'; stop.disabled = !active;
    stop.onclick = () => stopAll();
    row.append(play, stop); list.append(row);
  }
  updateIntensityUi();
}

function playTrack(track) {
  ensure(); ac.resume();
  engine.stop(0.05);
  engine.styleId = styleId;
  setTimeout(() => {
    engine.setIntensity(manualIntensity, true);
    const ok = engine.play(track, { fade: 0.4, style: styleId });
    playing = ok ? { style: styleId, track } : null;
    status.textContent = ok ? `Playing ${track} (${styleId.toUpperCase()})` : `Cannot play ${track}`;
    render();
  }, 60);
}

function stopAll() {
  engine?.stop(0.6); playing = null; status.textContent = 'Stopped'; render();
}

function updateIntensityUi() {
  const cur = engine?.cur;
  const can = !!cur && !cur.done && (cur.supportsIntensity || !cur.meta) && playing?.track !== 'boss';
  int.disabled = !can;
  intnote.textContent = !cur || cur.done ? '' : playing?.track === 'boss' ? 'the boss track always runs at full intensity'
    : cur.meta && !cur.supportsIntensity ? 'this track has no setIntensity' : cur.meta ? 'forwarded to setIntensity' : 'legacy layers follow intensity';
}

sel.innerHTML = styleList().map((s) => `<option value="${s.id}">${s.id.toUpperCase()}: ${s.name}</option>`).join('');
sel.value = styleId;
sel.onchange = () => { styleId = sel.value; if (playing) { playTrack(playing.track); } else render(); refreshUse(); };
function refreshUse() { $('use').textContent = usedStyle === styleId ? 'Used in the game (this style)' : 'Use this style in the game'; }
$('use').onclick = () => { saveStyle(styleId); usedStyle = styleId; status.textContent = `Game will use style ${styleId.toUpperCase()}: ${STYLES[styleId].name}`; refreshUse(); };
$('stop').onclick = stopAll;
vol.addEventListener('input', () => { if (master) master.gain.value = Number(vol.value); });
int.addEventListener('input', () => { manualIntensity = Number(int.value); intval.textContent = manualIntensity.toFixed(2); engine?.setIntensity(manualIntensity, true); });

setInterval(() => {
  const cur = engine?.cur;
  const el = list.querySelector('.row.active [data-live]');
  if (!el) return;
  if (!cur) { el.textContent = ''; return; }
  const secs = ac.currentTime.toFixed(0);
  if (cur.meta) {
    const done = cur.done && cur.song.loop === false;
    el.textContent = done ? `finished after ${cur.barsPlayed} bars (tail ringing)` : `bar ${cur.bar + 1}/${cur.meta.bars}, loop ${cur.loop + 1}, intensity out ${cur.lastIntensity == null ? 'n/a' : cur.lastIntensity.toFixed(2)}, t=${secs}s`;
  } else el.textContent = `legacy sequencer, bars ${cur.barCount}, intensity ${engine.intensity.toFixed(2)}`;
  updateIntensityUi();
}, 250);

refreshUse();
render();
