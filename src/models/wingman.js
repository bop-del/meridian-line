// Escorts: three distinct hulls in the same graphite family, each with its own colours. vex is a twin boom (dark indigo with
// magenta), ferro a flying wing, a blunt manta (deep green with amber), pip a small blunt bodied drone with a forward sensor
// lens and no cockpit (warm yellow with teal). Same object as createVanta() plus name and label. Hull recipes are in hulls.js.
import { createVanta } from './vanta.js';

export const WINGMEN = {
  vex: {
    label: 'VEX',
    variant: 'vex',
    colors: {
      hull: 0x1c1f3e, plate: 0x2e3463, dark: 0x0d0f22, metal: 0x9aa0c8, accent: 0xff3fb4, accent2: 0xb98cff,
      glass: 0x3a1a5c,
      flame: 0xffb0e4, flameEdge: 0xd0107c, boostCore: 0xffe4ff, boostEdge: 0x8a3cff, ion: 0xd49cff, ionEdge: 0x6a2cff,
    },
  },
  ferro: {
    label: 'FERRO',
    variant: 'ferro',
    colors: {
      hull: 0x1e3a2b, plate: 0x30563f, dark: 0x0f1c14, metal: 0xa4b2a6, accent: 0xf2b230, accent2: 0xc8e26a,
      glass: 0x1a5a44,
      flame: 0xffd48a, flameEdge: 0xff6a14, boostCore: 0xeaffcc, boostEdge: 0x2fd070, ion: 0xb8f070, ionEdge: 0x20a050,
    },
  },
  pip: {
    label: 'PIP',
    variant: 'pip',
    colors: {
      hull: 0xc4951f, plate: 0xdcb03a, dark: 0x2a2314, metal: 0xcfc6a8, accent: 0x14c8b8, accent2: 0xfff0a0,
      glass: 0x1d6a78,
      flame: 0xffe6a0, flameEdge: 0xff8a30, boostCore: 0xd8fff6, boostEdge: 0x14b4ff, ion: 0x66f4e6, ionEdge: 0x1d6dff,
    },
  },
};

export function createWingman(name = 'vex', opts = {}) {
  const key = String(name).toLowerCase();
  const def = WINGMEN[key] || WINGMEN.vex;
  const ship = createVanta({ variant: def.variant, colors: def.colors, light: opts.light === true, name: 'wingman_' + key });
  ship.name = key;
  ship.label = def.label;
  ship.group.name = 'wingman_' + key;
  return ship;
}
