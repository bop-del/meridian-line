// Rotate prompt for touch devices held upright. The game is landscape only on phones, so in portrait a full-screen notice
// (inline styles only, same teal on near black as the start-up notices in main.js) covers everything and swallows touches.
//   initRotate(uiRoot)   call once after startGame(); does nothing unless device.touch
// While the prompt is up the game is paused through the normal path (ctx.game.pause) and stays paused behind it. When landscape
// returns the prompt goes away and, if this module paused a running game, it is resumed (ctx.game.resume). If the page starts in
// portrait the game is paused as soon as the first run starts. Orientation is read from the viewport (taller than wide), the
// same test as device.portrait, rechecked after resize, orientationchange and a short delay because iOS reports stale sizes
// for a moment after a rotation.
import { device } from '../core/device.js';
import { installHint } from './installHint.js';

const FONT = "'Avenir Next','Futura','Century Gothic','Helvetica Neue','Segoe UI',Arial,sans-serif";
const TEAL = '#46e6d2';

export function initRotate(uiRoot) {
  if (!device.touch || !uiRoot) return null;
  const game = () => window.__ctx?.game;
  const state = () => window.__ctx?.state;

  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.setAttribute('aria-label', 'Rotate your device to landscape');
  box.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483000', 'display:none', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:clamp(14px,3vh,28px)', 'box-sizing:border-box', 'text-align:center', 'background:#02060c', 'color:#dff6f2', `font-family:${FONT}`,
    'padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left))',
    'pointer-events:auto', 'touch-action:none', '-webkit-user-select:none', 'user-select:none', '-webkit-touch-callout:none',
  ].join(';') + ';';

  const icon = document.createElement('div');
  icon.style.cssText = 'width:min(34vw,140px);height:min(34vw,140px);display:flex;align-items:center;justify-content:center;';
  icon.innerHTML = `<svg viewBox="0 0 64 64" width="100%" height="100%" fill="none" stroke="${TEAL}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="21" y="6" width="22" height="42" rx="4.5"/><path d="M29 10.5h6"/><circle cx="32" cy="43" r="1.6" fill="${TEAL}" stroke="none"/>
    <path d="M14 56a26 26 0 0 0 36 0" opacity=".7"/><path d="M47.5 49.5 51 56l-7 1.5" opacity=".7"/></svg>`;
  const phone = icon.firstElementChild;
  phone.style.cssText = 'transform-origin:50% 40%;';

  const title = document.createElement('div');
  title.style.cssText = `font-size:clamp(17px,5.4vw,26px);font-weight:300;letter-spacing:0.3em;margin-right:-0.3em;color:${TEAL};text-transform:uppercase;`;
  title.textContent = device.phone ? 'ROTATE YOUR PHONE' : 'ROTATE YOUR DEVICE';

  const text = document.createElement('div');
  text.style.cssText = 'max-width:19em;font-size:clamp(12px,3.6vw,15px);line-height:1.6;letter-spacing:0.08em;opacity:.78;font-weight:400;';
  text.textContent = 'MERIDIAN LINE is flown sideways. Turn it to landscape and the game carries on where you left it.';
  box.append(icon, title, text);
  const hint = installHint();   // iPhone and iPad in a browser tab only
  if (hint) box.appendChild(hint);

  // a slow turn from upright to sideways, with a pause at both ends (skipped when the user asks for less motion)
  let anim = null;
  function startAnim() {
    if (anim || !phone.animate) return;
    let reduce = false;
    try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }
    if (reduce) return;
    anim = phone.animate([
      { transform: 'rotate(0deg)', offset: 0 }, { transform: 'rotate(0deg)', offset: 0.22 },
      { transform: 'rotate(-90deg)', offset: 0.62 }, { transform: 'rotate(-90deg)', offset: 1 },
    ], { duration: 3400, iterations: Infinity, easing: 'ease-in-out' });
  }
  function stopAnim() { if (anim) { anim.cancel(); anim = null; } }

  // swallow every gesture while up (no scroll, no taps reaching the menus underneath)
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup', 'click', 'contextmenu']) {
    box.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
  }
  uiRoot.appendChild(box);

  let shown = false;
  let pausedByUs = false;

  function pauseGame() {
    const st = state();
    if (st && st.phase === 'playing' && game()?.pause) { game().pause(); pausedByUs = true; }
  }

  function show() {
    shown = true;
    box.style.display = 'flex';
    startAnim();
    pauseGame();
  }

  function hide() {
    shown = false;
    box.style.display = 'none';
    stopAnim();
    if (pausedByUs) {
      pausedByUs = false;
      const st = state();
      if (st && st.phase === 'paused' && game()?.resume) game().resume();
    }
  }

  const isPortrait = () => innerHeight > innerWidth;
  function check() {
    const want = isPortrait();
    if (want && !shown) show();
    else if (!want && shown) hide();
  }
  function checkSoon() {
    check();
    setTimeout(check, 120);
    setTimeout(check, 400);
  }

  addEventListener('resize', checkSoon);
  addEventListener('orientationchange', checkSoon);
  try { matchMedia('(orientation: portrait)').addEventListener('change', checkSoon); } catch (e) { /* older WebKit */ }

  // a run that starts (or continues) while the prompt is up is paused again
  window.__ctx?.events?.on('phase', (p) => { if (shown && p?.phase === 'playing') pauseGame(); });

  check();
  return { show, hide, get shown() { return shown; } };
}
