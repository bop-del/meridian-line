// Rail-relative leader paths shared by grunts and formations. All functions write into `out` (no allocation).
export const T_APPROACH = 2.4;
export const T_HOLD = 3.8;

const easeOut = (u) => 1 - (1 - u) * (1 - u);
/** Approach duration: at least T_APPROACH, longer when spawned far ahead so entry speed stays sane (about 55 u/s average). */
export const approachTime = (z0, zh) => Math.max(T_APPROACH, (zh - z0) / 55);

/**
 * Swoop-in, strafe, peel away. Rail-relative output.
 * o: {x0,y0,z0 start, xc,yc hold centre, zh hold depth, dir peel side (-1|1), up peel lift, amp strafe, ph strafe phase}
 */
export function swoop(t, out, o) {
  const A = o.A ?? (o.A = approachTime(o.z0, o.zh)), H = o.H ?? T_HOLD;
  if (t < A) {
    const u = t / A, e = easeOut(u);
    out.x = o.x0 + (o.xc - o.x0) * e + Math.sin(u * Math.PI) * (o.bulge ?? 0);
    out.y = o.y0 + (o.yc - o.y0) * e;
    out.z = o.z0 + (o.zh - o.z0) * e;
    return out;
  }
  const p = Math.min(t - A, H), q = Math.max(0, t - A - H);
  const amp = o.amp ?? 9;
  out.x = o.xc + amp * Math.sin(p * 1.6 + (o.ph ?? 0));
  out.y = o.yc + 1.6 * Math.sin(p * 2.3 + (o.ph ?? 0));
  out.z = o.zh + p * 3;
  if (q > 0) {
    out.x += o.dir * (q * 10 + q * q * 26);
    out.y += (o.up ?? 1) * (q * 3 + q * q * 12);
    out.z += q * 10 + q * q * 22;
  }
  return out;
}
