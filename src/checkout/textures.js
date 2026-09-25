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

// Tileable wood grain: long-wavelength colour drift, a few broad low-contrast
// "cathedral" figures (nested arches of flat-sawn timber), sparse straight grain of varying
// length, pores and a fine speckle. Neutral light wood; the meshes tint it per board with
// vertex colours (birch plywood, warmer pine for the pallet). The same map drives the bump
// and roughness, so it is kept soft: no dense hairlines that would read as scanlines.
export function woodTexture(renderer, size = 1024) {
  const W = size;
  const H = size / 2;
  const k = size / 1024;
  const [c, g] = canvas(W, H);
  const r = rng(7);
  g.fillStyle = '#d6c4a2';
  g.fillRect(0, 0, W, H);

  // draw something at x / y and at its wrapped copies (seamless tiling)
  const wrapped = (x, y, rx, ry, fn) => {
    for (const ox of [-W, 0, W]) {
      if (x + ox + rx < 0 || x + ox - rx > W) continue;
      for (const oy of [-H, 0, H]) {
        if (y + oy + ry < 0 || y + oy - ry > H) continue;
        fn(x + ox, y + oy);
      }
    }
  };

  // long-wavelength colour drift (big soft blobs, warm darker / paler)
  for (let i = 0; i < 16; i++) {
    const x = r() * W;
    const y = r() * H;
    const rad = (0.25 + r() * 0.45) * H;
    const dark = r() < 0.55;
    const a = 0.035 + r() * 0.05;
    wrapped(x, y, rad * 2.2, rad, (px, py) => {
      g.save();
      g.translate(px, py);
      g.scale(2.2, 1);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad);
      gr.addColorStop(0, dark ? `rgba(120,84,48,${a})` : `rgba(255,246,226,${a})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(-rad, -rad, rad * 2, rad * 2);
      g.restore();
    });
  }

  // broad soft early / late wood bands along the grain
  for (let i = 0; i < 14; i++) {
    const y = r() * H;
    const h = (14 + r() * 40) * k;
    const dark = r() < 0.5;
    const a = 0.025 + r() * 0.04;
    wrapped(W / 2, y, W, h, (_, py) => {
      const grad = g.createLinearGradient(0, py - h, 0, py + h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, dark ? `rgba(128,92,56,${a})` : `rgba(255,244,222,${a})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, py - h, W, 2 * h);
    });
  }

  // cathedral figures: nested arches opening along the grain, each growth ring a soft
  // darker latewood line that runs out into straight grain
  const figures = 4;
  for (let f = 0; f < figures; f++) {
    const cx = ((f + 0.15 + r() * 0.6) / figures) * W;
    const cy = (0.12 + r() * 0.76) * H;
    const rings = 7 + ((r() * 5) | 0);
    const dx = (26 + r() * 22) * k; // apex spacing along the grain
    const dy = (5 + r() * 3.5) * k; // ring spacing across the grain
    const dir = r() < 0.5 ? 1 : -1; // which way the arches open
    for (let j = 0; j < rings; j++) {
      const ax = cx - dir * j * dx;
      const cap = (j + 1) * dy;
      const run = (140 + r() * 160) * k; // how far the ring runs out along the grain
      const a = 0.05 + r() * 0.05;
      const lw = (1.6 + r() * 2.6) * k;
      const pts = [];
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = ax + dir * t * (run + cap * 6);
        const off = Math.min(cap, cap * Math.sqrt(t * 3.2));
        pts.push([x, off]);
      }
      wrapped(cx, cy, run + cap * 8 + rings * dx, cap + 4, (px, py) => {
        const sx = px - cx;
        const sy = py - cy;
        g.strokeStyle = `rgba(118,82,46,${a})`;
        g.lineWidth = lw;
        g.lineCap = 'round';
        g.beginPath();
        for (let i = pts.length - 1; i >= 0; i--) g[i === pts.length - 1 ? 'moveTo' : 'lineTo'](pts[i][0] + sx, cy + sy - pts[i][1]);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + sx, cy + sy + pts[i][1]);
        g.stroke();
        // the latewood band just inside the ring: a faint darker fill
        g.fillStyle = `rgba(150,110,66,${a * 0.12})`;
        g.fill();
      });
    }
  }

  // two small knots, stretched along the grain
  const knots = [
    { x: W * 0.28, y: H * 0.34, rx: 10 * k, ry: 4 * k },
    { x: W * 0.74, y: H * 0.71, rx: 7 * k, ry: 3 * k },
  ];

  // sparse straight grain: lines of varying length, very low contrast
  for (let i = 0; i < 80; i++) {
    const y0 = r() * H;
    const x0 = r() * W;
    const len = (0.15 + r() * 0.75) * W;
    const amp = (0.6 + r() * 2.2) * k;
    const f = ((1 + ((r() * 3) | 0)) * TAU_W) / W; // whole waves per tile: seamless
    const ph = r() * 6.28;
    const a = 0.015 + r() * 0.025;
    g.strokeStyle = `rgba(${100 + (r() * 30) | 0},${70 + (r() * 22) | 0},${42 + (r() * 16) | 0},${a})`;
    g.lineWidth = (0.8 + r() * 1.6) * k;
    g.lineCap = 'round';
    for (const ox of [0, -W]) {
      if (x0 + ox + len < 0) continue;
      g.beginPath();
      for (let x = x0; x <= x0 + len; x += 8 * k) {
        let y = y0 + Math.sin(x * f + ph) * amp;
        for (const kn of knots) {
          const ddx = (x - kn.x) / (kn.rx * 4);
          const ddy = y - kn.y;
          const inf = Math.exp(-ddx * ddx) * Math.exp(-(ddy * ddy) / (kn.ry * kn.ry * 26));
          y += Math.sign(ddy || 1) * inf * kn.ry * 2;
        }
        if (x === x0) g.moveTo(x + ox, y);
        else g.lineTo(x + ox, y);
      }
      g.stroke();
    }
  }
  for (const kn of knots) {
    for (let j = 4; j >= 0; j--) {
      g.fillStyle = `rgba(${96 - j * 5},${62 - j * 4},${34},${0.05 + (4 - j) * 0.05})`;
      g.beginPath();
      g.ellipse(kn.x, kn.y, kn.rx * (0.3 + j * 0.2), kn.ry * (0.3 + j * 0.2), 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // pores: short dark dashes along the grain
  for (let i = 0; i < 520; i++) {
    const x = r() * W;
    const y = r() * H;
    g.fillStyle = `rgba(90,60,34,${0.04 + r() * 0.06})`;
    g.fillRect(x, y, (2 + r() * 9) * k, (0.8 + r() * 0.8) * k);
  }

  // fine speckle
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 7;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.92));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.8));
  }
  g.putImageData(img, 0, 0);
  return finish(c, renderer, { repeat: true });
}
const TAU_W = Math.PI * 2;

// Burnt-in stamp on the pallet blocks (heat treatment mark), dark brown on transparent.
export function stampTexture(renderer) {
  const W = 256;
  const H = 180;
  const [c, g] = canvas(W, H);
  const ink = 'rgba(46, 26, 10, 0.9)';
  g.save();
  g.shadowColor = 'rgba(46, 26, 10, 0.8)';
  g.shadowBlur = 5;
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = 7;
  g.beginPath();
  if (g.roundRect) g.roundRect(14, 14, W - 28, H - 28, 16);
  else g.rect(14, 14, W - 28, H - 28);
  g.stroke();
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(86, 22);
  g.lineTo(86, H - 22);
  g.stroke();
  g.font = `800 58px ${DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('HT', 50, H / 2 + 2);
  g.font = `700 30px ${MONO}`;
  g.fillText('DE-BW', 168, 62);
  g.font = `600 26px ${MONO}`;
  g.fillText('73577', 168, 104);
  g.font = `600 17px ${MONO}`;
  g.fillText('HEINZE', 168, 138);
  g.restore();
  wear(g, W, H, 5, 0.5);
  return finish(c, renderer);
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
    // The side decal is only ~0.24 m wide (between the frame and the middle batten), and
    // the 22 mm battens hide a strip next to them when the crate is seen at an angle: all
    // markings stay in the middle ~60 % of the field.
    const inner = W * 0.6;
    arrowUp(g, W * 0.5 - m(0.036), m(0.17), m(0.055), ink);
    arrowUp(g, W * 0.5 + m(0.036), m(0.17), m(0.055), ink);
    stencilText(g, 'OBEN', W * 0.5, m(0.275), m(0.036), { align: 'center', spacing: 0.12, maxWidth: inner });
    glassIcon(g, W * 0.5 - m(0.036), m(0.44), m(0.055), ink);
    umbrellaIcon(g, W * 0.5 + m(0.036), m(0.45), m(0.055), ink);
    stencilText(g, 'VORSICHT', W * 0.5, m(0.585), m(0.026), { align: 'center', spacing: 0.06, maxWidth: inner });
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
export function labelTexture(renderer, { orderNo, name, city, modelName, qty, weight = 175 }) {
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
  g.fillText(`SPEDITION · ${Math.round(weight).toLocaleString('de-DE')} KG`, W - 24, 54);
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
