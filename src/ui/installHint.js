// "Full screen" help for iPhone and iPad. Safari has no fullscreen button for web pages, the only way to lose the browser bars is to
// install the page on the Home Screen. A strip of three drawn steps (the Share icon in the Safari bar, the Add to Home Screen row,
// the installed icon) is shown on the sound gate and on the rotate prompt whenever the game runs inside a browser tab on iOS, on
// every visit, and goes away by itself once the game is launched from the Home Screen (device.standalone).
//   installHint({ bottom })   returns the strip to append, or null when it is not wanted (desktop, Android, installed app).
//                             bottom: true pins it to the bottom edge of its parent (the full-screen sound gate)
// The steps are drawn with inline SVG instead of screenshots of the iOS interface, so they stay sharp and do not go stale when the
// system look changes.
import { device } from '../core/device.js';

const TEAL = '#46e6d2';
const FONT = "'Avenir Next','Futura','Century Gothic','Helvetica Neue','Segoe UI',Arial,sans-serif";

export function wantInstallHint() { return device.ios && !device.standalone; }

// the iOS Share glyph (a box open at the top with an arrow leaving it) and the Add to Home Screen glyph (a square with a plus)
const SHARE = '<path d="M12 15V3.6M8.2 7.2 12 3.4l3.8 3.8M7.4 10.2H6.6a1.8 1.8 0 0 0-1.8 1.8v7a1.8 1.8 0 0 0 1.8 1.8h10.8a1.8 1.8 0 0 0 1.8-1.8v-7a1.8 1.8 0 0 0-1.8-1.8h-.8"/>';
const ADD = '<rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3.6"/><path d="M12 8.4v7.2M8.4 12h7.2"/>';

// step 1: the top bar of Safari with the Share icon ringed
const STEP1 = `<svg viewBox="0 0 200 64" width="100%" aria-hidden="true" fill="none" stroke="rgba(223,246,242,0.55)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="8" width="196" height="48" rx="24" fill="rgba(255,255,255,0.05)" stroke="rgba(223,246,242,0.2)"/>
  <circle cx="26" cy="32" r="12" stroke="rgba(223,246,242,0.25)"/><path d="M29 26l-6 6 6 6" stroke="rgba(223,246,242,0.5)"/>
  <rect x="48" y="19" width="84" height="26" rx="13" stroke="rgba(223,246,242,0.25)"/><path d="M62 32h56" stroke="rgba(223,246,242,0.25)" stroke-width="3"/>
  <circle cx="160" cy="32" r="17" stroke="${TEAL}" stroke-width="2"><animate attributeName="r" values="15;19;15" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.35;1" dur="1.8s" repeatCount="indefinite"/></circle>
  <g transform="translate(148 20) scale(1)" stroke="${TEAL}" stroke-width="1.8">${SHARE}</g>
  <circle cx="186" cy="32" r="2" fill="rgba(223,246,242,0.3)" stroke="none"/>
</svg>`;

// step 2: the share sheet with the Add to Home Screen row picked out
const STEP2 = `<svg viewBox="0 0 200 64" width="100%" aria-hidden="true" fill="none" stroke="rgba(223,246,242,0.55)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="2" width="196" height="60" rx="14" fill="rgba(255,255,255,0.05)" stroke="rgba(223,246,242,0.2)"/>
  <path d="M16 14h70" stroke="rgba(223,246,242,0.22)" stroke-width="3"/><path d="M16 52h92" stroke="rgba(223,246,242,0.22)" stroke-width="3"/>
  <rect x="8" y="22" width="184" height="22" rx="8" fill="rgba(70,230,210,0.12)" stroke="${TEAL}" stroke-width="1.8"/>
  <g transform="translate(14 22) scale(0.9)" stroke="${TEAL}" stroke-width="1.9">${ADD}</g>
  <text x="42" y="37.5" fill="${TEAL}" stroke="none" font-family="${FONT}" font-size="10" letter-spacing="0.4">Add to Home Screen</text>
</svg>`;

// step 3: the installed icon, the real one the game ships
const STEP3 = `<svg viewBox="0 0 200 64" width="100%" aria-hidden="true">
  <rect x="2" y="2" width="196" height="60" rx="14" fill="rgba(255,255,255,0.05)" stroke="rgba(223,246,242,0.2)" stroke-width="1.6"/>
  <image href="./apple-touch-icon.png" x="82" y="8" width="36" height="36" preserveAspectRatio="xMidYMid slice" style="clip-path:inset(0 round 8px)"/>
  <text x="100" y="56" text-anchor="middle" fill="rgba(223,246,242,0.75)" font-family="${FONT}" font-size="8" letter-spacing="0.5">MERIDIAN LINE</text>
</svg>`;

const STEPS = [
  { art: STEP1, text: 'Tap Share, the square with an up arrow' },
  { art: STEP2, text: 'Scroll and tap Add to Home Screen' },
  { art: STEP3, text: 'Tap Add, then open it from your Home Screen' },
];

// Layout lives in one injected stylesheet so it can react to the screen height. A phone held sideways in a Safari tab has only
// about 290 CSS px of height (the tab bar and address bar take the rest), far too little for text above a strip, so on short
// landscape screens the gate turns into two columns: the sound prompt on the left and the steps as a vertical list on the right.
const CSS = `
.install-hint{display:flex;flex-direction:column;align-items:center;gap:6px;box-sizing:border-box;text-align:center;pointer-events:none;width:100%}
.install-hint .ih-title{font-size:clamp(9px,1.4vw,11px);letter-spacing:.34em;margin-right:-.34em;color:${TEAL};text-transform:uppercase;opacity:.95}
.install-hint .ih-row{display:flex;justify-content:center;align-items:flex-start;gap:clamp(8px,2.4vw,20px)}
.install-hint .ih-tile{width:clamp(110px,27vw,210px);display:flex;flex-direction:column;align-items:center;gap:3px}
.install-hint .ih-art{width:min(100%,34vh)}
.install-hint .ih-cap{font-size:clamp(9px,1.45vw,11px);line-height:1.35;letter-spacing:.04em;color:rgba(223,246,242,.86);text-wrap:balance}
.install-hint .ih-n{color:${TEAL};font-weight:600;margin-right:.4em}
.install-hint.ih-bottom{position:absolute;left:0;right:0;bottom:max(8px,env(safe-area-inset-bottom));width:auto;padding:8px max(12px,env(safe-area-inset-right)) 8px max(12px,env(safe-area-inset-left));background:linear-gradient(rgba(2,6,12,0),rgba(2,6,12,.88) 22%)}
@media (max-height:360px) and (orientation:landscape){
  .install-hint.ih-bottom{left:auto;top:50%;bottom:auto;right:max(14px,env(safe-area-inset-right));transform:translateY(-50%);width:min(50vw,400px);padding:10px 14px 12px;gap:8px;background:rgba(2,6,12,.93);border:1px solid rgba(70,230,210,.24);border-radius:10px}
  .install-hint .ih-title{font-size:11px}
  .install-hint .ih-row{flex-direction:column;align-items:stretch;gap:8px;width:100%}
  .install-hint .ih-tile{width:100%;flex-direction:row;align-items:center;gap:12px;text-align:left}
  .install-hint .ih-art{width:36%;flex:none}
  .install-hint .ih-cap{font-size:12px;line-height:1.35;flex:1}
}`;
let styled = false;
function addStyle() {
  if (styled) return;
  styled = true;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
}

export function installHint({ bottom = false } = {}) {
  if (!wantInstallHint()) return null;
  addStyle();
  const wrap = document.createElement('div');
  wrap.className = 'install-hint' + (bottom ? ' ih-bottom' : '');
  wrap.setAttribute('aria-label', 'How to play full screen: Share, Add to Home Screen, open from the Home Screen');
  const title = document.createElement('div');
  title.className = 'ih-title';
  title.textContent = 'Play full screen';
  const row = document.createElement('div');
  row.className = 'ih-row';
  STEPS.forEach((st, i) => {
    const tile = document.createElement('div');
    tile.className = 'ih-tile';
    const art = document.createElement('div');
    art.className = 'ih-art';
    art.innerHTML = st.art;
    const cap = document.createElement('div');
    cap.className = 'ih-cap';
    const n = document.createElement('span');
    n.className = 'ih-n';
    n.textContent = String(i + 1);
    cap.append(n, document.createTextNode(st.text));
    tile.append(art, cap);
    row.append(tile);
  });
  wrap.append(title, row);
  return wrap;
}
