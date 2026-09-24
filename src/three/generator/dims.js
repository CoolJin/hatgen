// Layout constants of the HATGEN S5500-5DS enclosure (meters, real scale).
// x = length (right is +X when looking at the front), y = up, z = depth, front faces +Z.
// Origin: floor level, centered in x and z.

export const L = 0.95;
export const W = 0.55;
export const H = 0.8;

export const SHEET = 0.012; // visual sheet thickness of the enclosure panels
export const FOAM = 0.02; // acoustic foam thickness

// Main body walls (inset a few millimeters from the lid outline: the lid has a slight lip).
export const BODY = { x: 0.469, z: 0.269, y0: 0.105, y1: 0.72 };

// Lid: T-shaped top section (full width at the front band, narrower behind it where
// the two tubular carry handles sit in recessed channels at the left and right ends).
export const LID = { x: 0.475, z: 0.275, y0: 0.72, y1: 0.8, notchX: 0.408, bandZ: 0.143, chanY: 0.733 };

// Plinth skirt below the body, slightly narrower, notched at the corners for the casters.
export const PLINTH = { x: 0.457, z: 0.257, y0: 0.046, y1: 0.105, notch: 0.112 };

export const WHEEL = { r: 0.05, w: 0.03, x: 0.4, z: 0.2 };

// Front openings (in unit coordinates).
export const DOOR = { x0: -0.255, x1: 0.185, y0: 0.15, y1: 0.685, gap: 0.0025 };
// The recess runs almost the full door height, as on the real unit (photo: ~18 to 90 %).
export const PANEL = { x0: 0.214, x1: 0.414, y0: 0.19, y1: 0.65, recess: 0.03 };

// Side vents (on both end panels), in the panel's z/y coordinates.
export const VENT = { z0: -0.17, z1: 0.17, y0: 0.27, y1: 0.6, slats: 11 };

// Internal component placement.
export const CRANK_Y = 0.252;
export const ENGINE_POS = [-0.215, CRANK_Y, -0.035];
export const ALT_POS = [0.02, CRANK_Y, -0.035];
export const TANK = { x0: -0.4, x1: 0.04, z0: -0.2, z1: 0.135, y0: 0.598, y1: 0.698 };
export const CAP = { x: -0.16, z: -0.045 };
export const BATTERY = { x: 0.355, y: 0.108, z: 0.075, w: 0.13, h: 0.172, d: 0.196 };
export const MUFFLER = { x0: -0.11, x1: 0.2, y: 0.445, z: -0.163, r: 0.064 };
export const OUTLET = { x: 0.3, y: 0.445 };

export const DETAIL = {
  high: { seg: 32, segS: 16, rb: 2, curve: 6, tex: 1, finsCyl: 12, finsHead: 7 },
  medium: { seg: 24, segS: 12, rb: 2, curve: 5, tex: 0.75, finsCyl: 12, finsHead: 7 },
  low: { seg: 12, segS: 8, rb: 1, curve: 3, tex: 0.5, finsCyl: 6, finsHead: 4 },
};
