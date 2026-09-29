// Tiny DOM helpers shared by the UI modules.
export function h(tag, cls, text, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null && text !== '') e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function setText(el, value) {
  // write only on change to keep DOM churn minimal
  if (el._v !== value) { el._v = value; el.textContent = value; }
}

export function setClass(el, cls, on) {
  const key = '_c_' + cls;
  if (el[key] !== on) { el[key] = on; el.classList.toggle(cls, !!on); }
}

export function fmt(n) {
  return Math.max(0, Math.floor(n || 0)).toLocaleString('en-US');
}

export function safeAnimate(el, keyframes, opts) {
  try { return el.animate ? el.animate(keyframes, opts) : null; } catch (e) { return null; }
}
