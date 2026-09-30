// Keyboard, gamepad and optional mouse aim. One update per frame produces a stable snapshot:
//   held flags:   fire, boost, brake
//   pulses (true for exactly one frame): bomb, rollLeft, rollRight, pause, confirm, firePressed, fireReleased
//   axis {x,y}: shaped steering (-1..1, +y is up), rawAxis {x,y}: unshaped target, aim {x,y}: reticle offset (mouse or right stick)
//   pressed(name): held state by key code or action name, justPressed(name) / justReleased(name): edges
//   stamp: performance.now() of the most recent steering key event (down or up), used by telemetry for input latency
// Keyboard steering ramps with separate attack and release times and an optional response curve; the gamepad stick has a
// deadzone, a response curve and light smoothing. All of these are live feel parameters (feel.p.handling.key*, stick*).
// Barrel roll: Q and E. A double tap of left or right also rolls, but only a genuine tap pair: short first press, short
// gap, and no left or right key activity just before it (doubleTap* parameters), so corrective steering never rolls.
import { feel } from './feel.js';

const KEY_ACTIONS = {
  fire: ['Space', 'KeyZ'],
  bomb: ['KeyX'],
  boost: ['ShiftLeft', 'ShiftRight'],
  brake: ['ControlLeft', 'ControlRight', 'KeyC'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter'],
};
const ACTION_NAMES = Object.keys(KEY_ACTIONS);
const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const UP_KEYS = ['KeyW', 'ArrowUp'];
const DOWN_KEYS = ['KeyS', 'ArrowDown'];
const STEER_KEYS = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS]);
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'ControlLeft']);

const TRIGGER_DEADZONE = 0.25;

const down = new Set();
let pendingJust = new Set();
let pendingUp = new Set();
let frameJust = new Set();
let frameUp = new Set();
const pendingRoll = { left: false, right: false };
// double tap state per side
const tap = {
  left: { pressAt: -10, releaseAt: -10, pressLen: 99, quiet: false },
  right: { pressAt: -10, releaseAt: -10, pressLen: 99, quiet: false },
};
let lastHoriz = -10;          // time of the last left or right key press or release
const actionState = {};       // action name -> held this frame
const actionPrev = {};        // held previous frame
const held = {};
const edge = {};
let time = 0;
let padPrev = [];             // previous gamepad button states by index
const kb = { x: 0, y: 0 };    // keyboard ramp state (linear, before the response curve)
const pad = { x: 0, y: 0 };   // smoothed analog state

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hp = () => feel.p.handling || {};

function shapeStick(v, dz, expo) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  const n = Math.min(1, (a - dz) / Math.max(1e-3, 1 - dz));
  return Math.sign(v) * Math.pow(n, expo);
}

// Ramp one keyboard axis toward the digital target: attack when pushing toward a direction, release when centring.
function ramp(cur, target, attack, release, dt) {
  if (target === 0) {
    const k = 1 - Math.exp(-3 * dt / Math.max(0.005, release));
    const v = cur - cur * k;
    return Math.abs(v) < 0.002 ? 0 : v;
  }
  const k = 1 - Math.exp(-3 * dt / Math.max(0.005, attack));
  const v = cur + (target - cur) * k;
  return Math.abs(target - v) < 0.002 ? target : v;
}

function anyDown(keys) { for (let i = 0; i < keys.length; i++) if (down.has(keys[i])) return true; return false; }
function anyIn(set, keys) { for (let i = 0; i < keys.length; i++) if (set.has(keys[i])) return true; return false; }

const isTextTarget = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

function sideOf(code) { return LEFT_KEYS.includes(code) ? 'left' : RIGHT_KEYS.includes(code) ? 'right' : null; }

// A left or right key went down (first key of that side). Decide on a double tap roll.
function onSidePress(side) {
  const h = hp();
  const s = tap[side];
  const other = side === 'left' ? RIGHT_KEYS : LEFT_KEYS;
  if ((h.doubleTap ?? 1) >= 0.5 && s.quiet && !anyDown(other)
    && s.pressLen <= (h.doubleTapPress ?? 0.11) && time - s.releaseAt <= (h.doubleTapWindow ?? 0.16) + 1e-6) {
    pendingRoll[side] = true;
    s.quiet = false; s.pressLen = 99;
  } else {
    s.quiet = time - lastHoriz >= (h.doubleTapQuiet ?? 0.3);
  }
  s.pressAt = time;
  lastHoriz = time;
}

function onSideRelease(side) {
  const s = tap[side];
  s.releaseAt = time;
  s.pressLen = time - s.pressAt;
  lastHoriz = time;
}

export const input = {
  axis: { x: 0, y: 0 },
  rawAxis: { x: 0, y: 0 },
  aim: { x: 0, y: 0 },
  mouse: { x: 0, y: 0, active: false, down: false },
  mouseAim: false,
  capture: false,          // game.js sets true while playing: blocks page scroll and browser defaults for game keys
  usingGamepad: false,
  invertY: false,
  autopilot: null,          // showcase mode and tests: see the end of update()
  fire: false, bomb: false, boost: false, brake: false,
  rollLeft: false, rollRight: false, pause: false, confirm: false,
  firePressed: false, fireReleased: false,
  // performance.now() of the most recent steering key event (down or up); telemetry measures input latency from it
  stamp: 0,

  init() {
    if (this._inited) return;
    this._inited = true;
    addEventListener('keydown', (e) => {
      if (isTextTarget(e.target)) return;
      if (this.capture && (GAME_KEYS.has(e.code) || (e.ctrlKey && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)))) e.preventDefault();
      if (e.repeat || down.has(e.code)) return;
      const side = sideOf(e.code);
      if (side && !anyDown(side === 'left' ? LEFT_KEYS : RIGHT_KEYS)) onSidePress(side);
      if (STEER_KEYS.has(e.code)) this.stamp = performance.now();
      pendingJust.add(e.code);
      down.add(e.code);
      if (e.code === 'KeyM' && this.capture) this.mouseAim = !this.mouseAim;   // in flight only, M cycles the music style on the title
    });
    addEventListener('keyup', (e) => {
      if (!down.delete(e.code)) return;
      pendingUp.add(e.code);
      const side = sideOf(e.code);
      if (side && !anyDown(side === 'left' ? LEFT_KEYS : RIGHT_KEYS)) onSideRelease(side);
      if (STEER_KEYS.has(e.code)) this.stamp = performance.now();
    });
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = -((e.clientY / innerHeight) * 2 - 1);
      this.mouse.active = true;
    });
    addEventListener('mousedown', (e) => {
      if (!this.mouseAim || !this.capture) return;
      if (e.button === 0) { down.add('Mouse0'); pendingJust.add('Mouse0'); }
      if (e.button === 2) { down.add('Mouse2'); pendingJust.add('Mouse2'); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0 && down.delete('Mouse0')) pendingUp.add('Mouse0');
      if (e.button === 2 && down.delete('Mouse2')) pendingUp.add('Mouse2');
    });
    addEventListener('contextmenu', (e) => { if (this.capture && this.mouseAim) e.preventDefault(); });
  },

  releaseAll() {
    for (const k of down) pendingUp.add(k);
    const hadSteer = [...down].some((k) => STEER_KEYS.has(k));
    down.clear();
    if (hadSteer) this.stamp = performance.now();
    tap.left.quiet = tap.right.quiet = false;
    this.fire = this.boost = this.brake = false;
  },

  reset() {
    this.axis.x = this.axis.y = 0;
    this.rawAxis.x = this.rawAxis.y = 0;
    this.aim.x = this.aim.y = 0;
    kb.x = kb.y = pad.x = pad.y = 0;
    pendingJust.clear(); pendingUp.clear(); frameJust.clear(); frameUp.clear();
    pendingRoll.left = pendingRoll.right = false;
    tap.left.quiet = tap.right.quiet = false;
  },

  // Edge queries operate on the snapshot taken at the start of the frame.
  pressed(name) { return down.has(name) || !!actionState[name]; },
  justPressed(name) { return frameJust.has(name) || (!!actionState[name] && !actionPrev[name]); },
  justReleased(name) { return frameUp.has(name) || (!actionState[name] && !!actionPrev[name]); },
  // Drop any queued edges (used when a UI overlay consumed a key).
  clearEdges() { pendingJust.clear(); frameJust.clear(); pendingRoll.left = pendingRoll.right = false; this.pause = this.confirm = this.bomb = false; },

  update(dt) {
    const h = hp();
    time += dt;
    // swap the edge buffers without allocating
    let t = frameJust; frameJust = pendingJust; pendingJust = t; pendingJust.clear();
    t = frameUp; frameUp = pendingUp; pendingUp = t; pendingUp.clear();

    // keyboard held actions
    for (let i = 0; i < ACTION_NAMES.length; i++) {
      const name = ACTION_NAMES[i], keys = KEY_ACTIONS[name];
      held[name] = anyDown(keys);
      edge[name] = anyIn(frameJust, keys);
    }
    if (this.mouseAim) { held.fire = held.fire || down.has('Mouse0'); if (frameJust.has('Mouse0')) edge.fire = true; if (frameJust.has('Mouse2')) edge.bomb = true; }
    let kx = (anyDown(RIGHT_KEYS) ? 1 : 0) - (anyDown(LEFT_KEYS) ? 1 : 0);
    let ky = (anyDown(UP_KEYS) ? 1 : 0) - (anyDown(DOWN_KEYS) ? 1 : 0);
    let rollL = edge.rollLeft || pendingRoll.left;
    let rollR = edge.rollRight || pendingRoll.right;
    pendingRoll.left = pendingRoll.right = false;
    let pauseEdge = edge.pause;
    let confirmEdge = edge.confirm;
    let bombEdge = edge.bomb;
    let brakeHeld = held.brake, boostHeld = held.boost, fireHeld = held.fire;
    let aimX = 0, aimY = 0;
    let px = 0, py = 0;

    // gamepad (first connected)
    let gp = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) { gp = p; break; }
    } catch (e) { gp = null; }
    if (gp) {
      const b = (i) => !!gp.buttons[i]?.pressed;
      const bv = (i) => gp.buttons[i]?.value ?? 0;
      const padEdge = (i) => b(i) && !padPrev[i];
      const dz = h.stickDeadzone ?? 0.16, ex = h.stickExpo ?? 1.35;
      const sx = shapeStick(gp.axes[0] || 0, dz, ex);
      const sy = shapeStick(-(gp.axes[1] || 0), dz, ex);
      px = sx; py = sy;
      if (b(14)) px -= 1; if (b(15)) px += 1; if (b(12)) py += 1; if (b(13)) py -= 1;
      px = clamp(px, -1, 1); py = clamp(py, -1, 1);
      let anyBtn = false;
      for (let i = 0; i < gp.buttons.length; i++) if (gp.buttons[i].pressed) { anyBtn = true; break; }
      if (Math.abs(sx) > 0 || Math.abs(sy) > 0 || anyBtn) this.usingGamepad = true;
      fireHeld = fireHeld || b(0) || b(2);
      if (padEdge(1) || padEdge(3)) bombEdge = true;
      boostHeld = boostHeld || bv(7) > TRIGGER_DEADZONE;
      brakeHeld = brakeHeld || bv(6) > TRIGGER_DEADZONE;
      if (padEdge(4)) rollL = true;
      if (padEdge(5)) rollR = true;
      if (padEdge(9)) pauseEdge = true;
      if (padEdge(0) || padEdge(9)) confirmEdge = true;
      aimX = shapeStick(gp.axes[2] || 0, dz, ex);
      aimY = shapeStick(-(gp.axes[3] || 0), dz, ex);
      padPrev.length = gp.buttons.length;
      for (let i = 0; i < gp.buttons.length; i++) padPrev[i] = !!gp.buttons[i].pressed;
    } else if (padPrev.length) {
      padPrev.length = 0;
    }

    if (this.mouseAim && this.mouse.active) { aimX = this.mouse.x; aimY = this.mouse.y; }
    if (this.invertY) { ky = -ky; py = -py; }

    // keyboard: attack and release ramps, then the response curve
    const att = h.keyAttack ?? 0.08, rel = h.keyRelease ?? 0.06, kex = h.keyExpo ?? 1.15;
    kb.x = ramp(kb.x, kx, att, rel, dt);
    kb.y = ramp(kb.y, ky, att, rel, dt);
    const kbx = Math.sign(kb.x) * Math.pow(Math.abs(kb.x), kex);
    const kby = Math.sign(kb.y) * Math.pow(Math.abs(kb.y), kex);
    // analog: light smoothing (0 is raw)
    const ss = h.stickSmooth ?? 0.03;
    const ka = ss > 0.001 ? 1 - Math.exp(-3 * dt / ss) : 1;
    pad.x += (px - pad.x) * ka; pad.y += (py - pad.y) * ka;
    if (Math.abs(pad.x) < 0.001) pad.x = 0;
    if (Math.abs(pad.y) < 0.001) pad.y = 0;
    // the stronger source wins per axis
    this.rawAxis.x = Math.abs(px) > Math.abs(kx) ? px : kx;
    this.rawAxis.y = Math.abs(py) > Math.abs(ky) ? py : ky;
    this.axis.x = Math.abs(pad.x) > Math.abs(kbx) ? pad.x : kbx;
    this.axis.y = Math.abs(pad.y) > Math.abs(kby) ? pad.y : kby;
    const kam = 1 - Math.exp(-14 * dt);
    this.aim.x += (aimX - this.aim.x) * kam;
    this.aim.y += (aimY - this.aim.y) * kam;

    // publish actions
    actionPrev.fire = actionState.fire; actionPrev.boost = actionState.boost; actionPrev.brake = actionState.brake;
    actionState.fire = fireHeld; actionState.boost = boostHeld; actionState.brake = brakeHeld;
    this.firePressed = fireHeld && !actionPrev.fire;
    this.fireReleased = !fireHeld && !!actionPrev.fire;
    this.fire = fireHeld; this.boost = boostHeld; this.brake = brakeHeld;
    this.bomb = bombEdge; this.rollLeft = rollL; this.rollRight = rollR;
    this.pause = pauseEdge; this.confirm = confirmEdge;
    actionState.bomb = bombEdge; actionState.rollLeft = rollL; actionState.rollRight = rollR;
    actionState.pause = pauseEdge; actionState.confirm = confirmEdge;
    // pulse actions are edges by nature, do not double-report through justPressed
    actionPrev.bomb = actionPrev.rollLeft = actionPrev.rollRight = actionPrev.pause = actionPrev.confirm = false;

    // autopilot (showcase mode and tests): fields set on input.autopilot replace what the player would have pressed this frame.
    //   axis {x, y} steering, aim {x, y} reticle, fire, boost, brake (held), bomb, rollLeft, rollRight (pulses, true for one frame)
    const ap = this.autopilot;
    if (ap) {
      if (ap.axis) { this.axis.x = ap.axis.x; this.axis.y = ap.axis.y; this.rawAxis.x = ap.axis.x; this.rawAxis.y = ap.axis.y; }
      if (ap.aim) { this.aim.x = ap.aim.x; this.aim.y = ap.aim.y; }
      if (ap.fire !== undefined) { const was = this.fire; this.fire = !!ap.fire; actionState.fire = this.fire; this.firePressed = this.fire && !was; this.fireReleased = !this.fire && was; }
      if (ap.boost !== undefined) { this.boost = !!ap.boost; actionState.boost = this.boost; }
      if (ap.brake !== undefined) { this.brake = !!ap.brake; actionState.brake = this.brake; }
      if (ap.bomb) { this.bomb = true; actionState.bomb = true; ap.bomb = false; }
      if (ap.rollLeft) { this.rollLeft = true; actionState.rollLeft = true; ap.rollLeft = false; }
      if (ap.rollRight) { this.rollRight = true; actionState.rollRight = true; ap.rollRight = false; }
    }
  },
};
