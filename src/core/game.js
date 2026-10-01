// Game loop and phase state machine.
//   title -> playing <-> paused -> (gameover | levelcomplete -> playing next level | victory)
// API: ctx.game { setPhase, newRun, startLevel, restartLevel, toTitle, pause, resume, hitStop(duration, scale),
// step(dt, render), advance(seconds) }, ctx.timeScale, events `phase {phase, prev}` and `score:add`, listens to `fx:hitstop {duration}`.
// state.levelStart / state.levelStats {levelIndex, hits (the KILLS count), kills, score, time, health, maxHealth, lives, livesLost, escortsAlive, escortsTotal} are filled for the level complete screen.
// URL params for testing: ?autostart=1  ?level=0|1|2  ?god=1  ?difficulty=easy|normal|hard
// Phones: ?touch=1 forces the touch controls on any browser (src/ui/touch.js, only active when device.touch), ?phonediag=1 shows
// the diagnostics overlay and exposes it as ctx.phonediag (modules add lines with ctx.phonediag.add(name, fn)).
import * as THREE from 'three';
import { config } from '../config.js';
import { events } from './events.js';
import { state } from './state.js';
import { input } from './input.js';
import { rail } from './rail.js';
import { collision } from './collision.js';
import { cameraRig } from './cameraRig.js';
import { feel } from './feel.js';
import { impact } from '../fx/impact.js';
import { speedfx } from '../fx/speedfx.js';
import { cinema } from '../fx/cinema.js';
import { player } from '../entities/player.js';
import { projectiles } from '../entities/projectiles.js';
import { render } from '../render/renderer.js';
import { fx } from '../fx/fx.js';
import { audio } from '../audio/audio.js';
import { ui } from '../ui/ui.js';
import { touch } from '../ui/touch.js';
import { world } from '../world/world.js';
import { enemies } from '../enemies/enemies.js';
import { allies } from '../allies/allies.js';

const PHASE_SCREEN = { title: 'title', paused: 'paused', gameover: 'gameover', levelcomplete: 'levelcomplete', victory: 'victory' };
const MUSIC_FOR_PHASE = { title: 'title', gameover: 'gameover', victory: 'victory' };
const ESCORTS = ['vex', 'ferro', 'pip'];

export function startGame(mount, uiRoot) {
  const params = new URLSearchParams(location.search);
  const ctx = {
    THREE, config, feel, events, state, input, rail, collision, cameraRig, impact, speedfx, cinema, player, projectiles, render, fx, audio, ui, world, enemies, allies,
    clock: new THREE.Clock(),
    groups: { playerShots: [], enemyShots: [], enemies: [], obstacles: [], pickups: [], allies: [] },
    timeScale: 1,
  };
  window.__ctx = ctx;

  // renderer, scene and camera come first
  render.init(ctx, mount);

  const gameplay = [input, rail, world, enemies, allies, player, projectiles, collision];
  const always = [impact, speedfx, cinema, cameraRig, fx, ui, audio];
  const all = [...gameplay, ...always];
  const names = new Map([[input, 'input'], [rail, 'rail'], [world, 'world'], [enemies, 'enemies'], [allies, 'allies'], [player, 'player'],
    [projectiles, 'projectiles'], [collision, 'collision'], [impact, 'impact'], [speedfx, 'speedfx'], [cinema, 'cinema'], [cameraRig, 'cameraRig'], [fx, 'fx'], [ui, 'ui'], [audio, 'audio'], [render, 'render']]);

  // A throwing module must not take the whole loop down: log a few times per module and carry on.
  const errCount = new Map();
  const safe = (m, fn, ...args) => {
    try { return m[fn]?.(...args); } catch (err) {
      const n = (errCount.get(m) || 0) + 1; errCount.set(m, n);
      if (n <= 3) console.error(`[${names.get(m) || 'module'}.${fn}]`, err);
    }
    return undefined;
  };

  all.forEach((m) => safe(m, 'init', ctx, uiRoot));
  all.forEach((m) => safe(m, 'reset', ctx));
  // touch controls: a layer above the HUD, created only when device.touch is true. Its update runs before input.update each frame.
  ctx.touch = touch;
  safe(touch, 'init', ctx, uiRoot);

  // Feel tools: the tuning panel and the telemetry it reads, loaded on demand and never on the normal path. They start with
  // ?tune=1 (panel plus telemetry) or ?telemetry=1 (telemetry only), or from the pause menu entry FEEL TUNING.
  const dev = [];
  let devLoading = null;
  function loadDev(withPanel) {
    devLoading = devLoading || import('./telemetry.js').then(({ telemetry }) => {
      dev.push(telemetry); ctx.telemetry = telemetry; safe(telemetry, 'init', ctx);
    });
    if (!withPanel) return devLoading;
    return devLoading.then(() => (ctx.tunePanel ? ctx.tunePanel : import('../dev/tunePanel.js').then(({ tunePanel }) => {
      dev.push(tunePanel); ctx.tunePanel = tunePanel; safe(tunePanel, 'init', ctx, uiRoot);
      return tunePanel;
    })));
  }
  if (params.get('nooverlay') === '1') {
    const st = document.createElement('style');
    st.textContent = '.ui-scan{display:none!important} *{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;mix-blend-mode:normal!important}';
    document.head.appendChild(st);
  }
  if (params.get('showcase') === '1') import('../showcase/showcase.js').then(({ showcase }) => { dev.push(showcase); ctx.showcase = showcase; safe(showcase, 'init', ctx); });
  if (params.get('phonediag') === '1') {
    import('../dev/phonediag.js').then(({ phonediag }) => {
      dev.push(phonediag); ctx.phonediag = phonediag; safe(phonediag, 'init', ctx);
      phonediag.add?.('touch', () => touch.describe());
    }).catch((err) => console.warn('[phonediag] could not load', err));
  }
  if (params.get('diag') === '1') import('../dev/diag.js').then(({ diag }) => { dev.push(diag); ctx.diag = diag; safe(diag, 'init', ctx); });
  if (params.get('tune') === '1') loadDev(true);
  else if (params.get('telemetry') === '1') loadDev(false);

  // ------------------------------------------------------------------ phase handling
  let phaseAt = performance.now();
  let hitStopT = 0, hitStopScale = 1, runFlag = false;

  function setPhase(p) {
    const prev = state.phase;
    if (prev === p) return;
    state.phase = p;
    phaseAt = performance.now();
    input.capture = p === 'playing';
    player.controlsEnabled = p === 'playing';
    if (p === 'playing') ui.hideScreens?.();
    else if (PHASE_SCREEN[p]) safe(ui, 'showScreen', PHASE_SCREEN[p]);
    if (p === 'paused') audio.pauseMusic?.(true);
    else if (prev === 'paused') audio.pauseMusic?.(false);
    if (MUSIC_FOR_PHASE[p]) audio.music?.(MUSIC_FOR_PHASE[p]);
    events.emit('phase', { phase: p, prev });
  }

  function clearGroups() {
    const g = ctx.groups;
    for (const k of ['enemies', 'obstacles', 'pickups', 'allies']) {
      for (const e of g[k].slice()) { try { e.destroy?.(ctx); } catch (err) { /* ignore */ } }
      g[k].length = 0;
    }
  }

  // Prepare a level: resets modules, loads the world. Does not change the phase.
  function prepareLevel(index) {
    state.levelIndex = index;
    clearGroups();
    safe(enemies, 'killAll');
    ctx.timeScale = 1; hitStopT = 0;
    // module resets (state fields are managed here, not in modules)
    state.boss = null; state.levelTime = 0; state.comboTimer = 0; state.combo = 0; state.multiplier = 1;
    state.health = state.maxHealth; state.boost = 1; state.boostCooldown = 0;
    state.bombs = Math.max(state.bombs, config.player.bombs);
    state.levelStats = null;
    for (const m of [rail, world, enemies, allies, projectiles, collision, player, impact, speedfx, cinema, cameraRig, fx, ui, audio]) safe(m, 'reset', ctx);
    safe(world, 'loadLevel', index);
    if (!allies.wingmen || allies.wingmen.length === 0) safe(allies, 'spawnWingmen', ESCORTS);
    safe(allies, 'setEnabled', state.phase === 'playing');
    const info = world.levelInfo || {};
    safe(render, 'setLevelLook', info.look || {});
  }

  function startLevel(index) {
    index = Math.max(0, Math.min(config.levels.length - 1, index | 0));
    state.levelStart = { score: state.score, hits: state.hits, kills: state.kills, lives: state.lives };
    prepareLevel(index);
    setPhase('playing');
    input.clearEdges();
    safe(allies, 'setEnabled', true);
    const info = world.levelInfo || {};
    audio.music?.(info.music || config.levels[index]);
    cameraRig.startIntro(ctx);
    events.emit('level:start', { index });
  }

  function newRun(opts = {}) {
    if (opts.difficulty && Object.hasOwn(config.difficulty, opts.difficulty)) state.difficulty = opts.difficulty;
    const diff = state.difficulty;
    const god = state.god;
    state.reset();
    state.difficulty = diff; state.god = god;
    runFlag = true;
    events.emit('game:start', { difficulty: diff });
    startLevel(opts.level ?? 0);
  }

  function restartLevel() {
    const ls = state.levelStart || { score: 0, hits: 0, kills: 0 };
    Object.assign(state, { score: ls.score, hits: ls.hits, kills: ls.kills, lives: config.player.lives, laserLevel: 1, bombs: config.player.bombs,
      health: state.maxHealth });
    startLevel(state.levelIndex);
  }

  // the title screen shows the bright Thalassa Coast behind it unless ?level= asks for another one
  function titleLevel() {
    if (params.has('level')) return Math.max(0, Math.min(config.levels.length - 1, Number(params.get('level')) || 0));
    return Math.max(0, config.levels.indexOf('thalassa'));
  }

  function toTitle() {
    const diff = state.difficulty, god = state.god;
    state.reset(); state.difficulty = diff; state.god = god;
    runFlag = false;
    audio.pauseMusic?.(false);
    state.phase = '';
    prepareLevel(titleLevel());
    setPhase('title');
    safe(allies, 'setEnabled', false);
    audio.music?.('title');
  }

  function pause() { if (state.phase === 'playing') setPhase('paused'); }
  function resume() { if (state.phase === 'paused') { setPhase('playing'); input.clearEdges(); } }

  function hitStop(duration = 0.06, scale = 0.05) {
    if (hitStopT <= 0) { hitStopT = duration; hitStopScale = scale; }
    else { hitStopT = Math.max(hitStopT, duration); hitStopScale = Math.min(hitStopScale, scale); }
  }

  const openTuning = () => loadDev(true).then((panel) => { panel?.toggle?.(true); });
  ctx.game = { openTuning, setPhase, startLevel, newRun, restartLevel, toTitle, pause, resume, hitStop };

  // ------------------------------------------------------------------ UI and gameplay events
  events.on('ui:start', (p) => { if (state.phase === 'title' || state.phase === 'gameover' || state.phase === 'victory') newRun(p && typeof p === 'object' ? p : {}); });
  events.on('ui:resume', () => resume());
  events.on('ui:pause', () => pause());
  events.on('ui:tune', () => { openTuning(); resume(); });
  events.on('ui:restart', () => { if (state.phase === 'victory' || !runFlag) newRun({}); else restartLevel(); });
  events.on('ui:nextLevel', () => {
    if (state.phase !== 'levelcomplete') return;
    if (state.levelIndex + 1 >= config.levels.length) setPhase('victory');
    else startLevel(state.levelIndex + 1);
  });
  events.on('ui:quitToTitle', () => toTitle());
  events.on('ui:difficulty', (d) => { const v = typeof d === 'string' ? d : d?.difficulty; if (Object.hasOwn(config.difficulty, v)) state.difficulty = v; });

  events.on('game:over', () => { if (state.phase === 'playing') setPhase('gameover'); });
  events.on('level:complete', () => {
    if (state.phase !== 'playing') return;
    state.levelStats = {
      levelIndex: state.levelIndex,
      hits: state.hits - state.levelStart.hits,
      kills: state.kills - state.levelStart.kills,
      score: state.score - state.levelStart.score,
      time: state.levelTime,
      // inputs for the letter rank: shield left, lives lost this level, escorts still flying
      health: state.health, maxHealth: state.maxHealth, lives: state.lives,
      livesLost: Math.max(0, (state.levelStart.lives ?? state.lives) - state.lives),
      escortsAlive: (allies.wingmen || []).filter((w) => w.alive).length,
      escortsTotal: (allies.wingmen || []).length,
    };
    if (state.levelIndex + 1 >= config.levels.length) { setPhase('victory'); events.emit('game:victory', {}); }
    else setPhase('levelcomplete');
  });

  // hit stop and slow-mo accents live in src/fx/impact.js

  // focus handling
  const blurPause = () => { touch.releaseAll(); pause(); };
  addEventListener('blur', blurPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { touch.releaseAll(); pause(); } });
  const unlock = () => { audio.unlock?.(); };
  addEventListener('pointerdown', unlock, { passive: true });
  addEventListener('keydown', unlock);

  // ------------------------------------------------------------------ boot
  if (params.get('god') === '1') state.god = true;
  if (params.get('difficulty') && Object.hasOwn(config.difficulty, params.get('difficulty'))) state.difficulty = params.get('difficulty');
  const lvl = Math.max(0, Math.min(config.levels.length - 1, Number(params.get('level')) || 0));   // autostart begins here, level 0 is the first mission
  if (params.get('autostart') === '1') { state.phase = ''; newRun({ level: lvl }); }
  else { state.phase = ''; prepareLevel(titleLevel()); setPhase('title'); audio.music?.('title'); }

  // ------------------------------------------------------------------ frame
  function frame() {
    requestAnimationFrame(frame);
    step(Math.min(ctx.clock.getDelta(), 1 / 20), true);
  }

  // Advance the whole game by one tick. Also used by ctx.game.advance() for deterministic tests.
  function step(raw, doRender) {
    safe(touch, 'update', raw, ctx);
    safe(input, 'update', raw, ctx);

    // global keys
    if (input.pause && performance.now() - phaseAt > 250) {
      if (state.phase === 'playing') pause();
      else if (state.phase === 'paused') resume();
    }

    // hit stop timescale
    if (hitStopT > 0) { hitStopT -= raw; ctx.timeScale = hitStopScale; if (hitStopT <= 0) { hitStopT = 0; hitStopScale = 1; } }
    else ctx.timeScale = Math.min(1, ctx.timeScale + raw * 9);
    const dt = raw * ctx.timeScale;

    const phase = state.phase;
    if (phase === 'playing') {
      state.levelTime += dt;
      for (const m of gameplay) if (m !== input) safe(m, 'update', dt, ctx);
      safe(projectiles, 'lateUpdate', ctx);
      safe(impact, 'update', dt, ctx);
      safe(speedfx, 'update', dt, ctx);
      safe(cinema, 'update', dt, ctx);
      safe(cameraRig, 'update', dt, ctx);
      safe(fx, 'update', dt, ctx);
    } else if (phase === 'title') {
      safe(rail, 'update', dt, ctx);
      safe(world, 'update', dt, ctx);
      safe(player, 'update', dt, ctx);
      safe(impact, 'update', dt, ctx);
      safe(speedfx, 'update', dt, ctx);
      safe(cinema, 'update', dt, ctx);
      safe(cameraRig, 'update', dt, ctx);
      safe(fx, 'update', dt, ctx);
    } else if (phase === 'paused') {
      // world frozen: only UI, audio and render advance
    } else {
      // gameover, levelcomplete, victory: frozen world, orbiting camera, live particles
      safe(impact, 'update', raw, ctx);
      safe(speedfx, 'update', raw, ctx);
      safe(cinema, 'update', raw, ctx);
      safe(cameraRig, 'update', raw, ctx);
      safe(fx, 'update', raw, ctx);
    }
    safe(ui, 'update', raw, ctx);
    safe(audio, 'update', raw, ctx);
    for (const m of dev) safe(m, 'update', raw, ctx);
    if (doRender) safe(render, 'render', raw);
  }
  ctx.game.step = step;
  ctx.game.advance = (seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) step(dt, false); };
  frame();
}
