// Canvas textures for the checkout props: plywood / pine grain, strap weave, stencilled
// crate markings, the shipping label and the text band of the pickup marker ring.
// Loaded lazily together with props.js (first checkout opening).
import * as THREE from 'three';

const DISPLAY = '"Space Grotesk Variable", "Space Grotesk", "Inter Variable", Arial, sans-serif';
const MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, Menlo, monospace';
const SANS = '"Inter Variable", "Inter", Arial, sans-serif';
// Slant of the HATGEN wordmark in canvas text (same as the backdrop word).
const SLANT = 0.2;

// Small deterministic PRNG so the textures look the same on every visit.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, renderer, { srgb = true, repeat = false, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (!mips) {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  t.needsUpdate = true;
  return t;
}

// Wavy horizontal grain, a few knots, fine speckle. Neutral light wood; the meshes tint
// it per board with vertex colours (pale birch plywood, warmer pine for the pallet).
export function woodTexture(renderer, size = 1024) {
  const W = size;
  const H = size / 2;
  const k = size / 1024;
  const [c, g] = canvas(W, H);
  const r = rng(7);
  g.fillStyle = '#dccaa8';
  g.fillRect(0, 0, W, H);

  // broad soft bands (early / late wood)
  for (let i = 0; i < 22; i++) {
    const y = r() * H;
    const h = (10 + r() * 36) * k;
    const grad = g.createLinearGradient(0, y - h, 0, y + h);
    const dark = r() < 0.5;
    const a = 0.03 + r() * 0.06;
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, dark ? `rgba(130,96,60,${a})` : `rgba(255,244,222,${a})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, y - h, W, 2 * h);
  }

  // two small knots, stretched along the grain; the grain lines bend around them
  const knots = [
    { x: W * 0.28, y: H * 0.34, rx: 11 * k, ry: 4.5 * k },
    { x: W * 0.74, y: H * 0.71, rx: 8 * k, ry: 3.5 * k },
  ];

  // fine grain lines
  for (let i = 0; i < 360; i++) {
    const y0 = r() * H;
    const amp = (0.6 + r() * 2.4) * k;
    const f = (0.002 + r() * 0.006) / k;
    const ph = r() * 6.28;
    const a = 0.025 + r() * 0.07;
    g.strokeStyle = `rgba(${105 + (r() * 30) | 0},${74 + (r() * 22) | 0},${44 + (r() * 16) | 0},${a})`;
    g.lineWidth = (0.5 + r() * 1.4) * k;
    g.beginPath();
    for (let x = -10; x <= W + 10; x += 10 * k) {
      let y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.7 + ph * 2) * amp * 0.25;
      for (const kn of knots) {
        const dx = (x - kn.x) / (kn.rx * 4);
        const dy = y - kn.y;
        const inf = Math.exp(-dx * dx) * Math.exp(-(dy * dy) / (kn.ry * kn.ry * 26));
        y += Math.sign(dy || 1) * inf * kn.ry * 2;
      }
      if (x < 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  for (const kn of knots) {
    for (let j = 4; j >= 0; j--) {
      g.fillStyle = `rgba(${96 - j * 5},${62 - j * 4},${34},${0.06 + (4 - j) * 0.06})`;
      g.beginPath();
      g.ellipse(kn.x, kn.y, kn.rx * (0.3 + j * 0.2), kn.ry * (0.3 + j * 0.2), 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // fine speckle / pores
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 12;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.92));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.8));
  }
  g.putImageData(img, 0, 0);
  return finish(c, renderer, { repeat: true });
}

// Woven polyester strap (grayscale; the material colours it).
export function strapTexture(renderer) {
  const [c, g] = canvas(64, 256);
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 4) {
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(0, y, 64, 1.4);
  }
  for (let x = 0; x < 64; x += 3) {
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(x, 0, 1, 256);
  }
  // darker selvedge edges
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, 0, 3, 256);
  g.fillRect(61, 0, 3, 256);
  // white safety marking stripes
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(14, 0, 2, 256);
  g.fillRect(48, 0, 2, 256);
  return finish(c, renderer, { repeat: true });
}

// ------------------------------------------------------------------ stencils
function wear(g, w, h, seed, amount = 0.2) {
  const r = rng(seed);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < w * h * 0.0022 * amount * 10; i++) {
    const x = r() * w;
    const y = r() * h;
    const s = 0.6 + r() * 2.4;
    g.globalAlpha = 0.25 + r() * 0.6;
    g.fillRect(x, y, s, s * (0.4 + r()));
  }
  // horizontal scuffs
  for (let i = 0; i < 16 * amount * 5; i++) {
    g.globalAlpha = 0.15 + r() * 0.25;
    g.fillRect(r() * w, r() * h, 20 + r() * 90, 0.8 + r() * 1.5);
  }
  g.restore();
}

// Draws with a soft overspray halo, like spray paint through a stencil.
function spray(g, color, draw, px) {
  g.save();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.shadowColor = color;
  g.shadowBlur = Math.max(2, px * 0.08);
  g.globalAlpha = 0.5;
  draw();
  g.restore();
  g.save();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.globalAlpha = 0.9;
  draw();
  g.restore();
}

// Stencil text with gaps ("bridges") cut through each glyph, like a real stencil.
// maxWidth (px): the text is set smaller if it would not fit (never clipped by the decal).
function stencilText(g, text, x, y, px, { font = DISPLAY, weight = 700, spacing = 0.06, align = 'left', color = '#141010', slant = 0, bridges = true, maxWidth = 0 } = {}) {
  g.save();
  const chars = [...text];
  const measure = () => {
    g.font = `${weight} ${px}px ${font}`;
    const w = chars.map((ch) => g.measureText(ch).width);
    return [w, w.reduce((a, b) => a + b, 0) + px * spacing * (chars.length - 1) + px * slant * 0.8];
  };
  let [widths, total] = measure();
  if (maxWidth && total > maxWidth) {
    px *= maxWidth / total;
    [widths, total] = measure();
  }
  g.textBaseline = 'alphabetic';
  const sp = px * spacing;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const [lc, lg] = canvas(Math.ceil(total + px * 0.6), Math.ceil(px * 1.5));
  lg.font = g.font;
  lg.textBaseline = 'alphabetic';
  const base = px * 1.12;
  let lx = px * 0.2;
  if (slant) lg.setTransform(1, 0, -slant, 1, slant * base, 0);
  for (let i = 0; i < chars.length; i++) {
    lg.fillStyle = '#000';
    lg.fillText(chars[i], lx, base);
    if (bridges && chars[i] !== ' ') {
      // one thin vertical bridge through the glyph middle
      lg.save();
      lg.globalCompositeOperation = 'destination-out';
      lg.fillRect(lx + widths[i] * 0.47, base - px * 0.95, Math.max(1.5, px * 0.045), px * 1.1);
      lg.restore();
    }
    lx += widths[i] + sp;
  }
  lg.setTransform(1, 0, 0, 1, 0, 0);
  // colour the mask
  lg.globalCompositeOperation = 'source-in';
  lg.fillStyle = color;
  lg.fillRect(0, 0, lc.width, lc.height);
  spray(g, color, () => g.drawImage(lc, cx - px * 0.2, y - base), px);
  g.restore();
  return total;
}

function arrowUp(g, x, y, s, color) {
  spray(g, color, () => {
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.55, y - s * 0.38);
    g.lineTo(x + s * 0.2, y - s * 0.38);
    g.lineTo(x + s * 0.2, y + s * 0.55);
    g.lineTo(x - s * 0.2, y + s * 0.55);
    g.lineTo(x - s * 0.2, y - s * 0.38);
    g.lineTo(x - s * 0.55, y - s * 0.38);
    g.closePath();
    g.fill();
  }, s);
}

function glassIcon(g, x, y, s, color) {
  spray(g, color, () => {
    g.lineWidth = s * 0.09;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(x - s * 0.34, y - s * 0.55);
    g.lineTo(x + s * 0.34, y - s * 0.55);
    g.quadraticCurveTo(x + s * 0.36, y + s * 0.02, x, y + s * 0.08);
    g.quadraticCurveTo(x - s * 0.36, y + s * 0.02, x - s * 0.34, y - s * 0.55);
    g.stroke();
    g.beginPath();
    g.moveTo(x, y + s * 0.08);
    g.lineTo(x, y + s * 0.48);
    g.moveTo(x - s * 0.22, y + s * 0.5);
    g.lineTo(x + s * 0.22, y + s * 0.5);
    g.stroke();
    // crack
    g.lineWidth = s * 0.05;
    g.beginPath();
    g.moveTo(x - s * 0.05, y - s * 0.55);
    g.lineTo(x + s * 0.06, y - s * 0.36);
    g.lineTo(x - s * 0.04, y - s * 0.22);
    g.lineTo(x + s * 0.05, y - s * 0.08);
    g.stroke();
  }, s);
}

function umbrellaIcon(g, x, y, s, color) {
  spray(g, color, () => {
    g.lineWidth = s * 0.09;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(x, y - s * 0.05, s * 0.5, Math.PI, 0);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(x, y - s * 0.05);
    g.lineTo(x, y + s * 0.42);
    g.arc(x - s * 0.1, y + s * 0.42, s * 0.1, 0, Math.PI);
    g.stroke();
    for (const dx of [-0.22, 0, 0.22]) {
      g.beginPath();
      g.moveTo(x + dx * s - s * 0.02, y - s * 0.75);
      g.lineTo(x + dx * s + s * 0.02, y - s * 0.62);
      g.stroke();
    }
  }, s);
}

// Pixel density of the stencil decals.
const PPM = 760;

// Soft contact shadow along the edges of a decal that sits between the crate battens:
// the battens stand 22 mm proud of the plywood, so the board darkens where it meets them.
function edgeShade(g, W, H, e) {
  const col = (a) => `rgba(46, 30, 14, ${a})`;
  const band = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, col(0.5));
    gr.addColorStop(0.35, col(0.2));
    gr.addColorStop(1, col(0));
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  };
  g.save();
  band(0, 0, 0, e, 0, 0, W, e);
  band(0, H, 0, H - e, 0, H - e, W, e);
  band(0, 0, e, 0, 0, 0, e, H);
  band(W, 0, W - e, 0, W - e, 0, e, H);
  g.restore();
}

// A decal that only carries the contact shade (wall halves without markings).
export function shadeTexture(renderer, w, h) {
  const W = Math.round(w * PPM * 0.5);
  const H = Math.round(h * PPM * 0.5);
  const [c, g] = canvas(W, H);
  edgeShade(g, W, H, 0.03 * PPM * 0.5);
  return finish(c, renderer);
}

// kind: 'front' | 'back' | 'side' | 'lid'. w, h: decal size in metres.
export function stencilTexture(renderer, kind, w, h, { modelName = 'S5500-5DS', kw = '5,5' } = {}) {
  const W = Math.round(w * PPM);
  const H = Math.round(h * PPM);
  const [c, g] = canvas(W, H);
  const ink = '#161111';
  const red = '#b3201c';
  const m = (v) => v * PPM; // metres -> px
  const fit = W - m(0.03); // widest text line: 15 mm margin on both sides
  edgeShade(g, W, H, m(0.03));

  if (kind === 'front') {
    stencilText(g, 'HATGEN', m(0.05), m(0.21), m(0.15), { color: red, slant: SLANT, spacing: 0.02, bridges: false, weight: 800 });
    stencilText(g, 'HEINZE AUTOMATISIERUNGSTECHNIK', m(0.055), m(0.285), m(0.034), { font: MONO, weight: 700, spacing: 0.08, maxWidth: W - m(0.07) });
    stencilText(g, `${modelName} · ${kw} kW`, m(0.055), m(0.345), m(0.03), { font: MONO, weight: 600, spacing: 0.1, maxWidth: W - m(0.07) });
    // handling marks bottom left
    arrowUp(g, m(0.09), m(0.58), m(0.075), ink);
    arrowUp(g, m(0.17), m(0.58), m(0.075), ink);
    stencilText(g, 'OBEN', m(0.235), m(0.61), m(0.05), { spacing: 0.1 });
    glassIcon(g, m(0.47), m(0.57), m(0.1), ink);
    stencilText(g, 'VORSICHT', m(0.53), m(0.61), m(0.05), { spacing: 0.08, maxWidth: W - m(0.545) });
  } else if (kind === 'back') {
    stencilText(g, 'HATGEN', w * PPM * 0.5, m(0.2), m(0.12), { color: red, slant: SLANT, spacing: 0.02, align: 'center', bridges: false, weight: 800 });
    stencilText(g, 'HEINZE AUTOMATISIERUNGSTECHNIK', w * PPM * 0.5, m(0.27), m(0.032), { font: MONO, spacing: 0.08, align: 'center', maxWidth: fit });
    stencilText(g, '73577 RUPPERTSHOFEN', w * PPM * 0.5, m(0.32), m(0.028), { font: MONO, spacing: 0.12, align: 'center', weight: 600, maxWidth: fit });
    arrowUp(g, W * 0.5 - m(0.06), m(0.56), m(0.07), ink);
    arrowUp(g, W * 0.5 + m(0.06), m(0.56), m(0.07), ink);
  } else if (kind === 'side') {
    // the side decal is only ~0.24 m wide (between the frame and the middle batten)
    arrowUp(g, W * 0.5 - m(0.05), m(0.17), m(0.066), ink);
    arrowUp(g, W * 0.5 + m(0.05), m(0.17), m(0.066), ink);
    stencilText(g, 'OBEN', W * 0.5, m(0.285), m(0.048), { align: 'center', spacing: 0.12, maxWidth: fit });
    glassIcon(g, W * 0.5 - m(0.055), m(0.45), m(0.075), ink);
    umbrellaIcon(g, W * 0.5 + m(0.055), m(0.46), m(0.075), ink);
    stencilText(g, 'VORSICHT', W * 0.5, m(0.62), m(0.04), { align: 'center', spacing: 0.06, maxWidth: fit });
  } else if (kind === 'lid') {
    stencilText(g, 'HATGEN', W * 0.5, H * 0.5 + m(0.02), m(0.1), { color: red, slant: SLANT, align: 'center', bridges: false, weight: 800 });
    stencilText(g, 'OBEN', W * 0.5, H * 0.5 + m(0.1), m(0.04), { align: 'center', spacing: 0.14 });
  }
  wear(g, W, H, kind.length * 31 + W, 0.25);
  return finish(c, renderer);
}

// ------------------------------------------------------------------ shipping label
function barcode(g, x, y, w, h, seedStr) {
  let seed = 0;
  for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const r = rng(seed || 3);
  let cx = x;
  g.fillStyle = '#111';
  while (cx < x + w) {
    const bw = [1, 1, 2, 3][(r() * 4) | 0] * (w / 190);
    const gap = [1, 1, 2, 3][(r() * 4) | 0] * (w / 190);
    if (cx + bw > x + w) break;
    g.fillRect(cx, y, bw, h);
    cx += bw + gap;
  }
}

// The shipping label (paper, ~0.26 × 0.18 m).
export function labelTexture(renderer, { orderNo, name, city, modelName, qty }) {
  const W = 780;
  const H = 540;
  const [c, g] = canvas(W, H);
  // paper
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, W, H);
  const pr = rng(11);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(120,100,80,${pr() * 0.05})`;
    g.fillRect(pr() * W, pr() * H, 1.5, 1.5);
  }
  // header band
  g.fillStyle = '#141111';
  g.fillRect(0, 0, W, 86);
  g.save();
  g.font = `800 50px ${DISPLAY}`;
  g.fillStyle = '#ff3b36';
  g.setTransform(1, 0, -SLANT, 1, SLANT * 62, 0);
  g.fillText('HATGEN', 26, 62);
  g.restore();
  g.font = `600 20px ${MONO}`;
  g.fillStyle = '#f4f1ea';
  g.textAlign = 'right';
  // one pallet per unit: this crate is package 1 of the order
  g.fillText(`SPEDITION · PACKSTÜCK 1 / ${Math.max(1, qty | 0)}`, W - 24, 54);
  g.textAlign = 'left';

  const label = (t, x, y) => {
    g.font = `600 15px ${MONO}`;
    g.fillStyle = '#6a625a';
    g.fillText(t, x, y);
  };
  label('ABSENDER', 26, 122);
  g.font = `600 19px ${SANS}`;
  g.fillStyle = '#141111';
  g.fillText('Heinze Automatisierungstechnik', 26, 148);
  g.font = `400 17px ${SANS}`;
  g.fillText('Utzstetter Str. 7/2 · 73577 Ruppertshofen', 26, 172);

  g.fillStyle = '#141111';
  g.fillRect(26, 192, W - 52, 2);
  label('EMPFÄNGER', 26, 222);
  g.font = `700 34px ${SANS}`;
  g.fillStyle = '#141111';
  const fit = (t, max) => {
    let s = t;
    while (g.measureText(s).width > max && s.length > 3) s = s.slice(0, -2) + '…';
    return s;
  };
  g.fillText(fit(name || 'Ihr Name', W - 52), 26, 262);
  g.font = `500 24px ${SANS}`;
  g.fillText(fit(city || 'Ihr Ort', W - 52), 26, 296);

  // order number + barcode
  g.fillRect(26, 318, W - 52, 2);
  label('BESTELLNUMMER', 26, 350);
  g.font = `700 44px ${MONO}`;
  g.fillStyle = '#141111';
  g.fillText(orderNo, 26, 396);
  g.font = `500 17px ${MONO}`;
  g.fillText(`${modelName} · ${qty} ${qty > 1 ? 'Geräte' : 'Gerät'}`, 26, 428);
  barcode(g, 26, 446, W - 52, 70, orderNo);
  // red corner mark
  g.fillStyle = '#d12420';
  g.beginPath();
  g.moveTo(W - 110, 318);
  g.lineTo(W - 26, 318);
  g.lineTo(W - 26, 402);
  g.closePath();
  g.fill();
  return finish(c, renderer);
}

// Text band of the pickup marker ring (repeats around the circle, red channel = mask).
export const RING_TEXT = 'ABHOLUNG · UTZSTETTER STR. 7/2 · 73577 RUPPERTSHOFEN · ';
export function ringTextTexture(renderer, seg = RING_TEXT) {
  const W = 2048;
  const H = 64;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.font = `600 30px ${MONO}`;
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  const sw = g.measureText(seg).width;
  // stretch so a whole number of repeats fills the width (seamless)
  const n = Math.max(1, Math.round(W / sw));
  g.save();
  g.scale(W / (n * sw), 1);
  for (let i = 0; i < n; i++) g.fillText(seg, i * sw, H / 2 + 1);
  g.restore();
  const t = finish(c, renderer, { srgb: false, repeat: true });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
