// Music lab page for auditioning the title theme variants: music-lab.html (next to the game's index.html).
import { MusicEngine } from '../music.js';
import { TITLE_VARIANTS, DEFAULT_TITLE_VARIANT } from './registry.js';

const list = document.getElementById('list');
const status = document.getElementById('status');
const vol = document.getElementById('vol');
let ac = null, master = null, engine = null, playing = null;

function ensure() {
  if (ac) return;
  ac = new AudioContext();
  master = ac.createGain(); master.gain.value = Number(vol.value);
  const comp = ac.createDynamicsCompressor();
  master.connect(comp); comp.connect(ac.destination);
  engine = new MusicEngine(ac, master);
}
vol.addEventListener('input', () => { if (master) master.gain.value = Number(vol.value); });

const entries = [
  ...Object.entries(TITLE_VARIANTS).map(([id, v]) => ({ id, name: `${id.toUpperCase()}: ${v.meta.name}`, description: `${v.meta.description} (${v.meta.bpm} BPM)` }))];

let chosen = null; try { chosen = localStorage.getItem('meridian-title-variant') || DEFAULT_TITLE_VARIANT; } catch (e) { chosen = DEFAULT_TITLE_VARIANT; }

function render() {
  list.innerHTML = '';
  for (const e of entries) {
    const row = document.createElement('div'); row.className = 'row' + (playing === e.id ? ' active' : '');
    row.innerHTML = `<div class="txt"><b>${e.name}${chosen === e.id ? ' (used in game)' : ''}</b><small>${e.description}</small></div>`;
    const play = document.createElement('button'); play.className = 'pri'; play.textContent = playing === e.id ? 'Restart' : 'Play';
    play.onclick = () => { ensure(); ac.resume(); engine.stop(0.05); setTimeout(() => { engine.play('title', { fade: 0.4, variant: e.id }); }, 60); playing = e.id; status.textContent = `Playing ${e.name}`; render(); };
    const use = document.createElement('button'); use.textContent = 'Use in game';
    use.onclick = () => { try { localStorage.setItem('meridian-title-variant', e.id); } catch (err) { /* ignore */ } chosen = e.id; status.textContent = `Game will use: ${e.name}`; render(); };
    row.append(play, use); list.append(row);
  }
}
document.getElementById('stop').onclick = () => { engine?.stop(0.6); playing = null; status.textContent = 'Stopped'; render(); };
render();
