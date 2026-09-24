// Camera / scene keyframes per section.
// s: section id, p: progress inside the section (pinned: sticky range, others: section height),
// vh: extra offset in viewport heights. Values carry forward to later keyframes.
// look: anchor name (or list, averaged) the camera target moves toward (lookMix 0..1).
// m: explicit overrides for the stacked layout (phones, portrait tablets). Without them the
// stacked layout derives its framing automatically: product centered horizontally, lifted
// above the text (MOBILE_OY per section) and pulled back to fit the narrow width.

// Hold a shot across one step of a pinned section: arrive at `from`, stay until `to`.
function hold(s, from, to, shot) {
  return [{ s, p: from, ...shot }, { s, p: to, ...shot }];
}

// Vertical subject offset in the stacked layout (negative = up, CSS convention of the stage).
const MOBILE_OY = {
  hero: -0.17,
  statement: -0.24,
  anschluesse: -0.2,
  innen: -0.2,
  avr: -0.26,
  konstruktion: -0.24,
  modelle: -0.24,
  kontakt: -0.22,
};

function desktopShots() {
  // Rim light is lowered where the camera looks into the opened unit, so the internals keep
  // their real colors (aluminium, copper, steel) instead of drowning in red.
  return [
    // HERO: 3/4 front view, product on the right. It drifts further right while the hero
    // copy leaves, so the statement column never overlaps it.
    { s: 'hero', p: 0, az: 30, el: 8, dist: 3.2, tx: 0, ty: 0.4, tz: 0, fov: 30, ox: 0.23, oy: 0, key: 1, rim: 1, fill: 1, backdrop: 1, dust: 0.7, beam: 0.8, tint: 1, floor: 1, power: 0, sway: 0 },
    { s: 'hero', p: 0.5, az: 20, el: 8, dist: 3.35, ox: 0.29, backdrop: 0.6, beam: 0.65 },
    { s: 'hero', p: 0.85, az: 8, el: 7, dist: 3.65, ox: 0.28, backdrop: 0.35, beam: 0.5 },

    // STATEMENT: orbit to the door and label side.
    { s: 'statement', p: 0.0, az: -18, el: 8, dist: 3.8, ox: 0.28, backdrop: 0.12, beam: 0.35, key: 0.85, dust: 0.45 },
    { s: 'statement', p: 1.0, az: -32, el: 14, dist: 3.7, ox: 0.28 },

    // ANSCHLUESSE: control panel close-ups, one per step (4 steps). Seen from the panel side
    // (az 28 to 38) so the door and its big decal recede away from the text column.
    { s: 'anschluesse', p: -0.04, look: 'panel', az: 28, el: 8, dist: 1.3, fov: 28, ox: 0.31, power: 1, backdrop: 0, beam: 0.15, dust: 0.25, key: 1 },
    // The whole panel stays in frame (it is about as tall as the view at this distance);
    // the target only leans toward the highlighted part.
    ...hold('anschluesse', 0.05, 0.19, { look: ['display', 'panel'], highlight: 'display', az: 32, el: 7, dist: 1.06 }),
    ...hold('anschluesse', 0.3, 0.44, { look: ['cee', 'panel', 'panel'], highlight: 'cee', az: 38, el: 10, dist: 1.14 }),
    ...hold('anschluesse', 0.55, 0.69, { look: ['schuko1', 'schuko2', 'panel'], highlight: 'schuko1', az: 36, el: 9, dist: 1.1 }),
    ...hold('anschluesse', 0.8, 1.0, { look: ['keySwitch', 'panel'], highlight: 'keySwitch', az: 28, el: 8, dist: 1.06 }),

    // INNEN: open the enclosure, explode, then visit each part (7 steps). The exploded
    // assembly is about 1.6 m wide, so the camera stays far enough to keep the whole cage
    // between the text column and the right edge.
    { s: 'innen', p: -0.05, look: null, tx: 0, ty: 0.42, tz: 0, az: 34, el: 20, dist: 3.4, fov: 30, ox: 0.21, open: 0, explode: 0, power: 0.4, backdrop: 0.15, beam: 0.5, dust: 0.5, rim: 0.8 },
    { s: 'innen', p: 0.11, open: 1, az: 38, el: 22, dist: 3.75, rim: 0.55, fill: 1.3 },
    ...hold('innen', 0.2, 0.26, { explode: 1, ty: 0.4, look: 'engine', lookMix: 0.2, highlight: 'engine', az: 30, el: 20, dist: 4.1, rim: 0.45 }),
    ...hold('innen', 0.33, 0.4, { look: 'alternator', lookMix: 0.2, highlight: 'alternator', az: 42, el: 18, dist: 4.1 }),
    ...hold('innen', 0.47, 0.55, { look: 'tank', lookMix: 0.15, highlight: 'tank', az: 36, el: 27, dist: 4.15 }),
    ...hold('innen', 0.62, 0.69, { look: 'battery', lookMix: 0.2, highlight: 'battery', az: 48, el: 16, dist: 4.05 }),
    ...hold('innen', 0.76, 0.83, { look: 'muffler', lookMix: 0.2, highlight: 'muffler', az: 64, el: 22, dist: 4.2 }),
    ...hold('innen', 0.9, 1.0, { look: 'insulation', lookMix: 0.1, highlight: 'insulation', az: 44, el: 20, dist: 4.2 }),

    // AVR: reassemble (explode first, then close), product right, powered.
    { s: 'avr', p: 0.0, explode: 0, open: 1, look: null, tx: 0, ty: 0.42, tz: 0, az: 20, el: 14, dist: 3.95, ox: 0.2, highlight: null, power: 1, rim: 0.7, fill: 1.15 },
    { s: 'avr', p: 0.28, open: 0, az: -16, el: 9, dist: 3.45, ox: 0.27, backdrop: 0.2, beam: 0.55, rim: 1, fill: 1 },
    { s: 'avr', p: 1.0, az: -30, el: 8, dist: 3.45 },

    // KONSTRUKTION: blueprint drawing with dimension lines, kept clear of the title block.
    { s: 'konstruktion', p: 0.0, az: 38, el: 20, dist: 3.3, ox: 0.2, blueprint: 0, dimensions: 0, stageBlueprint: 0, grid: 0, power: 0 },
    { s: 'konstruktion', p: 0.25, blueprint: 1, stageBlueprint: 1, grid: 1, backdrop: 0, beam: 0, dust: 0.15, key: 0.7, az: 42, el: 24 },
    { s: 'konstruktion', p: 0.62, dimensions: 1, az: 45, el: 26, dist: 3.6, ox: 0.18 },
    { s: 'konstruktion', p: 1.0, az: 49, el: 28, dist: 3.65 },

    // MODELLE: back to the real look, slow turntable sway.
    { s: 'modelle', p: 0, vh: -0.2, blueprint: 0, dimensions: 0, stageBlueprint: 0, grid: 0, backdrop: 0.55, beam: 0.6, dust: 0.5, key: 1, az: 24, el: 9, dist: 3.2, ox: 0.22, sway: 1, power: 0 },
    // Stacked layouts: the heading and toggle sit right below the product, so the product
    // scrolls with the section instead of letting the copy pass over it.
    { s: 'modelle', p: 0, vh: 0.08, ease: 'linear', stackedOnly: true },
    { s: 'modelle', p: 0, vh: 1.08, ease: 'linear', stackedOnly: true, m: { oy: MOBILE_OY.modelle - 1 } },
    // Desktop: it leaves with its section while the solid Einsatz section slides in.
    { s: 'einsatz', p: 0, vh: -1, az: -12, el: 11, dist: 3.25, oy: 0, ease: 'linear', desktopOnly: true },
    { s: 'einsatz', p: 0, vh: 0, oy: -1, ease: 'linear', desktopOnly: true },

    // KONTAKT: 3/4 hero view above the text with a slow dolly-in, engine running. The
    // vertical offset moves one viewport per viewport scrolled (linear), so the product
    // travels with the section instead of floating under the scrolling text and footer.
    { s: 'kontakt', p: 0, vh: -1, az: 26, el: 8, dist: 3.55, ox: 0, oy: KONTAKT_OY + 1, sway: 0, running: 1, power: 1, backdrop: 1, beam: 1, dust: 0.8, ease: 'linear', m: { oy: MOBILE_OY.kontakt + 1 } },
    { s: 'kontakt', p: 0, oy: KONTAKT_OY, az: 18, el: 8, dist: 3.4, ease: 'linear', m: { oy: MOBILE_OY.kontakt } },
    { s: 'kontakt', p: 1, oy: KONTAKT_OY - 1, az: 10, el: 7, dist: 3.25, ease: 'linear', m: { oy: MOBILE_OY.kontakt - 1 } },
  ];
}

const KONTAKT_OY = -0.17;

export function buildShots({ mobile, aspect }) {
  const all = desktopShots();
  const shots = all.filter((k) => (mobile ? !k.desktopOnly : !k.stackedOnly));
  if (!mobile) {
    // Keyframes are tuned for 16:10. The copy column has a fixed width inside a centred
    // container, so wider screens push the product further right into the free space, and
    // narrower landscape screens push it right and pull the camera back.
    const wideShift = Math.min(0.08, Math.max(0, aspect - 1.6) * 0.35);
    const narrowShift = Math.min(0.08, Math.max(0, 1.6 - aspect) * 0.25);
    const shift = wideShift + narrowShift;
    const distMul = 1 + Math.max(0, 1.6 - aspect) * 0.9;
    if (!shift && distMul === 1) return shots;
    // shots that already sit far right (statement, close-ups) only move a little
    const moveOx = (ox) => (ox <= 0.25 ? Math.min(0.3, ox + shift) : Math.min(0.33, ox + shift * 0.3));
    return shots.map((k) => ({
      ...k,
      ...(k.ox > 0 ? { ox: +moveOx(k.ox).toFixed(3) } : null),
      ...(k.dist !== undefined ? { dist: +(k.dist * distMul).toFixed(3) } : null),
    }));
  }

  // Portrait screens need more distance to fit the unit horizontally.
  const far = Math.min(1.9, Math.max(1.2, 1.05 / Math.max(aspect, 0.3)));
  return shots.map((k) => {
    const m = { ox: 0, oy: MOBILE_OY[k.s] ?? -0.2, ...(k.m || {}) };
    if (k.dist !== undefined && m.dist === undefined) m.dist = +(k.dist * far).toFixed(3);
    return { ...k, m };
  });
}
