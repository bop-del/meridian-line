// Device facts, read once at startup. Imported by any module that needs to know about phones. Nothing here changes at runtime
// except `portrait`, which follows orientation changes.
//   device.touch      primary input is a finger ((pointer: coarse)), or forced with ?touch=1 on any device (testing on a desktop)
//   device.ios        iPhone, iPad or iPadOS that reports itself as a Mac (every iOS browser uses WebKit)
//   device.phone      touch and the short side of the screen is 500 CSS px or less
//   device.standalone launched from the Home Screen (no browser bars)
//   device.portrait   the viewport is taller than wide right now
// It also puts classes on <body> so CSS can react: `touch`, `ios`, `phone`, `portrait`.
const params = new URLSearchParams(location.search);

const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };

const ua = navigator.userAgent || '';
const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const forced = params.get('touch') === '1';
const touch = forced || mq('(pointer: coarse)');
const short = Math.min(screen.width || innerWidth, screen.height || innerHeight);

export const device = {
  touch,
  ios,
  forced,
  phone: touch && short <= 500,
  standalone: mq('(display-mode: standalone)') || navigator.standalone === true,
  portrait: innerHeight > innerWidth,
};

function apply() {
  device.portrait = innerHeight > innerWidth;
  const c = document.body.classList;
  c.toggle('touch', device.touch);
  c.toggle('ios', device.ios);
  c.toggle('phone', device.phone);
  c.toggle('portrait', device.portrait);
}

if (document.body) apply(); else addEventListener('DOMContentLoaded', apply);
addEventListener('resize', apply);
addEventListener('orientationchange', apply);
