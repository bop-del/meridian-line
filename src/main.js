import './core/device.js';
import { startGame } from './core/game.js';
import { initRotate } from './ui/rotate.js';

const mount = document.getElementById('app');
const uiRoot = document.getElementById('ui-root');

function notice(title, text, { fixed = true } = {}) {
  const box = document.createElement('div');
  box.style.cssText = fixed
    ? 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;background:#02060c;color:#dff6f2;font:14px/1.5 system-ui,sans-serif;pointer-events:auto;'
    : 'position:fixed;left:12px;right:12px;bottom:12px;padding:10px 14px;text-align:center;background:rgba(2,10,18,0.9);border:1px solid rgba(70,230,210,0.4);color:#dff6f2;font:13px/1.4 system-ui,sans-serif;z-index:100;pointer-events:auto;';
  if (fixed) {
    const t = document.createElement('div'); t.style.cssText = 'font-size:20px;letter-spacing:0.3em;font-weight:300'; t.textContent = title;
    const d = document.createElement('div'); d.style.cssText = 'max-width:32em;opacity:.8'; d.textContent = text;
    box.append(t, d);
  } else box.textContent = `${title} ${text}`;
  uiRoot.appendChild(box);
  return box;
}

// The start-up screen (#boot in index.html) stays until the first frame of the title scene has been drawn. Test browsers
// (navigator.webdriver) skip the fade so screenshots never catch it half transparent.
const boot = document.getElementById('boot');
function dropBoot() {
  if (!boot || !boot.isConnected) return;
  if (navigator.webdriver) { boot.remove(); return; }
  boot.classList.add('out');
  setTimeout(() => boot.remove(), 600);
}

function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
}

if (!hasWebGL2()) {
  boot?.remove();
  notice('MERIDIAN LINE NEEDS WEBGL2', 'This browser or device cannot run WebGL2. Use a current Chrome, Edge, Firefox or Safari (on iPhone and iPad: iOS 15.4 or later), turn hardware acceleration on where the browser has that setting, then reload the page.');
} else {
  try {
    startGame(mount, uiRoot);
  } catch (e) {
    console.error(e);
    boot?.remove();
    notice('COULD NOT START THE GAME', String(e && e.message ? e.message : e));
  }
  // two animation frames: the first draws the title scene (shaders compile inside it), the second means it reached the screen
  requestAnimationFrame(() => requestAnimationFrame(dropBoot));
  setTimeout(dropBoot, 12000);   // never leave the screen up if frames do not come (background tab)
  // touch devices: landscape only, a portrait phone gets the rotate prompt (the game waits paused behind it)
  try { initRotate(uiRoot); } catch (e) { console.error(e); }
}
