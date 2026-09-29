import { startGame } from './core/game.js';

const mount = document.getElementById('app');
const uiRoot = document.getElementById('ui-root');

function notice(title, text, { fixed = true } = {}) {
  const box = document.createElement('div');
  box.style.cssText = fixed
    ? 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;background:#02060c;color:#dff6f2;font:14px/1.5 system-ui,sans-serif;pointer-events:auto;'
    : 'position:fixed;left:12px;right:12px;bottom:12px;padding:10px 14px;text-align:center;background:rgba(2,10,18,0.9);border:1px solid rgba(70,230,210,0.4);color:#dff6f2;font:13px/1.4 system-ui,sans-serif;z-index:100;pointer-events:auto;';
  box.innerHTML = fixed
    ? `<div style="font-size:20px;letter-spacing:0.3em;font-weight:300">${title}</div><div style="max-width:32em;opacity:.8">${text}</div>`
    : `${title} ${text}`;
  uiRoot.appendChild(box);
  return box;
}

function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
}

if (!hasWebGL2()) {
  notice('MERIDIAN LINE NEEDS WEBGL2', 'Use a recent Chrome, Edge, Firefox or Safari, make sure hardware acceleration is on, then reload the page.');
} else {
  try {
    startGame(mount, uiRoot);
  } catch (e) {
    console.error(e);
    notice('COULD NOT START THE GAME', String(e && e.message ? e.message : e));
  }
  if (matchMedia('(pointer: coarse)').matches) {
    const n = notice('Best on a desktop with a keyboard or gamepad.', '(tap to dismiss)', { fixed: false });
    n.addEventListener('click', () => n.remove());
    setTimeout(() => n.remove(), 10000);
  }
}
