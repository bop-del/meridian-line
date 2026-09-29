// Keyboard, gamepad and optional mouse aim. One update per frame produces a stable snapshot:
//   held flags:   fire, boost, brake
//   pulses (true for exactly one frame): bomb, rollLeft, rollRight, pause, confirm, firePressed, fireReleased
//   axis {x,y}: smoothed steering (-1..1, +y is up), aim {x,y}: reticle offset (mouse or right stick)
//   pressed(name): held state by key code or action name, justPressed(name) / justReleased(name): edges
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
const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const UP_KEYS = ['KeyW', 'ArrowUp'];
const DOWN_KEYS = ['KeyS', 'ArrowDown'];
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'ControlLeft']);

const DOUBLE_TAP = 0.26;
const STICK_DEADZONE = 0.16;
const TRIGGER_DEADZONE = 0.25;

const down = new Set();
let pendingJust = new Set();
let pendingUp = new Set();
let frameJust = new Set();
let frameUp = new Set();
let pendingRoll = { left: false, right: false };
const lastTap = { left: -10, right: -10 };
const actionState = {};      // action name -> held this frame
const actionPrev = {};       // held previous frame
let time = 0;
let padPrev = {};            // previous gamepad button states by index

function shapeStick(v) {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  const n = (a - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  return Math.sign(v) * Math.pow(n, 1.25);
}

function anyDown(keys) { for (const k of keys) if (down.has(k)) return true; return false; }

const isTextTarget = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export const input = {
  axis: { x: 0, y: 0 },
  rawAxis: { x: 0, y: 0 },
  aim: { x: 0, y: 0 },
  mouse: { x: 0, y: 0, active: false, down: false },
  mouseAim: false,
  capture: false,          // game.js sets true while playing: blocks page scroll and browser defaults for game keys
  usingGamepad: false,
  invertY: false,
  fire: false, bomb: false, boost: false, brake: false,
  rollLeft: false, rollRight: false, pause: false, confirm: false,
  firePressed: false, fireReleased: false,

  init() {
    if (this._inited) return;
    this._inited = true;
    addEventListener('keydown', (e) => {
      if (isTextTarget(e.target)) return;
      if (this.capture && (GAME_KEYS.has(e.code) || (e.ctrlKey && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)))) e.preventDefault();
      if (e.repeat) return;
      if (!down.has(e.code)) pendingJust.add(e.code);
      down.add(e.code);
      // double tap detection for barrel roll
      if (LEFT_KEYS.includes(e.code)) {
        if (time - lastTap.left < DOUBLE_TAP) { pendingRoll.left = true; lastTap.left = -10; } else lastTap.left = time;
      } else if (RIGHT_KEYS.includes(e.code)) {
        if (time - lastTap.right < DOUBLE_TAP) { pendingRoll.right = true; lastTap.right = -10; } else lastTap.right = time;
      }
      if (e.code === 'KeyM') this.mouseAim = !this.mouseAim;
    });
    addEventListener('keyup', (e) => {
      if (down.delete(e.code)) pendingUp.add(e.code);
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
    down.clear();
    this.fire = this.boost = this.brake = false;
  },

  reset() {
    this.axis.x = this.axis.y = 0;
    this.aim.x = this.aim.y = 0;
    pendingJust = new Set(); pendingUp = new Set(); frameJust = new Set(); frameUp = new Set();
    pendingRoll.left = pendingRoll.right = false;
  },

  // Edge queries operate on the snapshot taken at the start of the frame.
  pressed(name) { return down.has(name) || !!actionState[name]; },
  justPressed(name) { return frameJust.has(name) || (!!actionState[name] && !actionPrev[name]); },
  justReleased(name) { return frameUp.has(name) || (!actionState[name] && !!actionPrev[name]); },
  // Drop any queued edges (used when a UI overlay consumed a key).
  clearEdges() { pendingJust = new Set(); frameJust = new Set(); pendingRoll.left = pendingRoll.right = false; this.pause = this.confirm = this.bomb = false; },

  update(dt) {
    time += dt;
    frameJust = pendingJust; pendingJust = new Set();
    frameUp = pendingUp; pendingUp = new Set();

    // keyboard held actions
    const held = {};
    const edge = {};
    for (const [name, keys] of Object.entries(KEY_ACTIONS)) {
      held[name] = anyDown(keys);
      edge[name] = keys.some((k) => frameJust.has(k));
    }
    if (this.mouseAim) { held.fire = held.fire || down.has('Mouse0'); if (frameJust.has('Mouse0')) edge.fire = true; if (frameJust.has('Mouse2')) edge.bomb = true; }
    let ax = (anyDown(RIGHT_KEYS) ? 1 : 0) - (anyDown(LEFT_KEYS) ? 1 : 0);
    let ay = (anyDown(UP_KEYS) ? 1 : 0) - (anyDown(DOWN_KEYS) ? 1 : 0);
    let rollL = edge.rollLeft || pendingRoll.left;
    let rollR = edge.rollRight || pendingRoll.right;
    pendingRoll.left = pendingRoll.right = false;
    let pauseEdge = edge.pause;
    let confirmEdge = edge.confirm;
    let bombEdge = edge.bomb;
    let brakeHeld = held.brake, boostHeld = held.boost, fireHeld = held.fire;
    let aimX = 0, aimY = 0;

    // gamepad (first connected)
    let pad = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) { pad = p; break; }
    } catch (e) { pad = null; }
    if (pad) {
      const b = (i) => !!pad.buttons[i]?.pressed;
      const bv = (i) => pad.buttons[i]?.value ?? 0;
      const padEdge = (i) => b(i) && !padPrev[i];
      const sx = shapeStick(pad.axes[0] || 0);
      const sy = shapeStick(-(pad.axes[1] || 0));
      let dx = sx, dy = sy;
      if (b(14)) dx -= 1; if (b(15)) dx += 1; if (b(12)) dy += 1; if (b(13)) dy -= 1;
      if (Math.abs(dx) > Math.abs(ax)) ax = Math.max(-1, Math.min(1, dx));
      if (Math.abs(dy) > Math.abs(ay)) ay = Math.max(-1, Math.min(1, dy));
      const usedPad = Math.abs(sx) > 0 || Math.abs(sy) > 0 || pad.buttons.some((x) => x.pressed);
      if (usedPad) this.usingGamepad = true;
      fireHeld = fireHeld || b(0) || b(2);
      if (padEdge(1) || padEdge(3)) bombEdge = true;
      boostHeld = boostHeld || bv(7) > TRIGGER_DEADZONE;
      brakeHeld = brakeHeld || bv(6) > TRIGGER_DEADZONE;
      if (padEdge(4)) rollL = true;
      if (padEdge(5)) rollR = true;
      if (padEdge(9)) pauseEdge = true;
      if (padEdge(0) || padEdge(9)) confirmEdge = true;
      aimX = shapeStick(pad.axes[2] || 0);
      aimY = shapeStick(-(pad.axes[3] || 0));
      padPrev = {};
      for (let i = 0; i < pad.buttons.length; i++) padPrev[i] = !!pad.buttons[i].pressed;
    } else {
      padPrev = {};
    }

    if (this.mouseAim && this.mouse.active) { aimX = this.mouse.x; aimY = this.mouse.y; }
    if (this.invertY) ay = -ay;

    // smoothing: quick ramp for keyboard (digital), less for analog which is already smooth
    this.rawAxis.x = ax; this.rawAxis.y = ay;
    const k = 1 - Math.exp(-(pad && (Math.abs(ax) < 1 || Math.abs(ay) < 1) ? 30 : 16) * dt);
    this.axis.x += (ax - this.axis.x) * k;
    this.axis.y += (ay - this.axis.y) * k;
    if (Math.abs(this.axis.x) < 0.001) this.axis.x = 0;
    if (Math.abs(this.axis.y) < 0.001) this.axis.y = 0;
    const ka = 1 - Math.exp(-14 * dt);
    this.aim.x += (aimX - this.aim.x) * ka;
    this.aim.y += (aimY - this.aim.y) * ka;

    // publish actions
    Object.assign(actionPrev, actionState);
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
    actionPrev.bomb = false;
  },
};
