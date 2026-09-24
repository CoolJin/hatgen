// All textures are generated at runtime on canvases (no image files).
import * as THREE from 'three';
import { PANEL } from './dims.js';
import { runSteps } from './utils.js';

const SANS = '"Inter Variable", "Inter", "Helvetica Neue", Arial, "Liberation Sans", sans-serif';
const DISPLAY = '"Space Grotesk Variable", "Inter Variable", Arial, "Liberation Sans", sans-serif';
const MONO = '"JetBrains Mono Variable", "JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono", monospace';
const SERIF = 'Georgia, "Times New Roman", "DejaVu Serif", "Liberation Serif", serif';

// Layout of the control panel plate (panel-local meters, origin at plate center, u right, v up).
export const PLATE_W = PANEL.x1 - PANEL.x0;
export const PLATE_H = PANEL.y1 - PANEL.y0;
// Vertical order follows the photo: breaker / display / key / 12 V on the left, two Schuko
// sockets and the CEE socket on the right, stickers in the lower part of the recess.
export const PANEL_LAYOUT = {
  breaker: { u: -0.04, v: 0.181, w: 0.056, h: 0.05 },
  schuko1: { u: 0.047, v: 0.176, s: 0.058 },
  schuko2: { u: 0.047, v: 0.096, s: 0.058 },
  display: { u: -0.04, v: 0.108, w: 0.074, h: 0.046, ww: 0.064, wh: 0.036 },
  keySwitch: { u: -0.046, v: 0.031, r: 0.0175 },
  ledRun: { u: -0.012, v: 0.041 },
  ledOil: { u: -0.012, v: 0.021 },
  dcPlus: { u: -0.072, v: -0.036 },
  dcMinus: { u: -0.05, v: -0.036 },
  dcReset: { u: -0.018, v: -0.036 },
  cee: { u: 0.047, v: -0.006, w: 0.078, h: 0.086 },
  // printed stickers inside the recess: [key, u, v, width]
  stickers: [['hz50', -0.061, -0.104, 0.05], ['lowoil', 0.036, -0.103, 0.07], ['caution', -0.054, -0.15, 0.068], ['silent', 0.043, -0.182, 0.1]],
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable multi-octave value noise in 0..1.
function valueNoise(size, cellsStart, octaves, seed, persistence = 0.5) {
  const rand = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = cellsStart << o;
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const iy = Math.floor(fy);
      let ty = fy - iy;
      ty = ty * ty * (3 - 2 * ty);
      const y0 = iy % cells;
      const y1 = (iy + 1) % cells;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const ix = Math.floor(fx);
        let tx = fx - ix;
        tx = tx * tx * (3 - 2 * tx);
        const x0 = ix % cells;
        const x1 = (ix + 1) % cells;
        const a = lat[y0 * cells + x0];
        const b = lat[y0 * cells + x1];
        const c = lat[y1 * cells + x0];
        const d = lat[y1 * cells + x1];
        out[y * size + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function dataTexture(c, repeat, colorSpace = THREE.NoColorSpace, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = colorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function colorTexture(c, aniso) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- procedural surfaces

// Powder coat: R = fine orange-peel height (bump), G = soft roughness blotches.
function powderTexture(size, aniso) {
  const fine = valueNoise(size, 128, 2, 11, 0.6);
  const blotch = valueNoise(size, 4, 4, 23, 0.55);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = Math.round(fine[i] * 255);
    // subtle blotches only: strong ones break grazing reflections into patches
    img.data[i * 4 + 1] = Math.round((0.92 + 0.04 * (blotch[i] - 0.5) + 0.05 * (fine[i] - 0.5)) * 255);
    img.data[i * 4 + 2] = Math.round(blotch[i] * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return dataTexture(c, 1 / 0.16, THREE.NoColorSpace, aniso);
}

// Cast metal: coarser grain for engine castings.
function castTexture(size, aniso) {
  const n = valueNoise(size, 32, 4, 57, 0.6);
  const b = valueNoise(size, 6, 3, 91, 0.5);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = Math.round(n[i] * 255);
    img.data[i * 4 + 1] = Math.round((0.8 + 0.35 * (b[i] - 0.5) + 0.2 * (n[i] - 0.5)) * 255);
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return dataTexture(c, 1 / 0.09, THREE.NoColorSpace, aniso);
}

// Brushed metal streaks along U (roughness in G).
function brushedTexture(size, aniso) {
  const rand = rng(77);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(128,150,128)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 3; i++) {
    const y = rand() * size;
    const g = 110 + rand() * 90;
    ctx.fillStyle = `rgba(${g},${g},${g},${0.15 + rand() * 0.25})`;
    const len = size * (0.2 + rand() * 0.8);
    const x = rand() * size;
    ctx.fillRect(x, y, len, 1);
    ctx.fillRect(x - size, y, len, 1);
  }
  return dataTexture(c, 1 / 0.2, THREE.NoColorSpace, aniso);
}

// Egg-crate acoustic foam: normal map + color (valleys darker).
function foamTextures(size, aniso) {
  const cn = canvas(size, size);
  const cc = canvas(size, size);
  const nctx = cn.getContext('2d');
  const cctx = cc.getContext('2d');
  const nImg = nctx.createImageData(size, size);
  const cImg = cctx.createImageData(size, size);
  const grain = valueNoise(size, 64, 2, 5, 0.7);
  const k = 2; // bumps per tile per axis
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const su = Math.sin(TAU * k * u);
      const sv = Math.sin(TAU * k * v);
      const h = su * sv;
      const du = TAU * k * Math.cos(TAU * k * u) * sv;
      const dv = TAU * k * su * Math.cos(TAU * k * v);
      const g = grain[y * size + x] - 0.5;
      const s = 0.05;
      let nx = -du * s + g * 0.5;
      let ny = dv * s + g * 0.5; // canvas y is flipped vs uv v
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * size + x) * 4;
      nImg.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      nImg.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nImg.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      nImg.data[i + 3] = 255;
      const shade = 0.8 + 0.05 * (h * 0.5 + 0.5) + g * 0.24;
      const cv = Math.round(Math.min(1, shade) * 255);
      cImg.data[i] = cv;
      cImg.data[i + 1] = cv;
      cImg.data[i + 2] = Math.round(cv * 1.02 > 255 ? 255 : cv * 1.02);
      cImg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nImg, 0, 0);
  cctx.putImageData(cImg, 0, 0);
  return {
    normal: dataTexture(cn, 1 / 0.064, THREE.NoColorSpace, aniso),
    color: dataTexture(cc, 1 / 0.064, THREE.SRGBColorSpace, aniso),
  };
}

// Muffler: brushed stainless with heat tint near the inlet (cylinder UVs: u around, v along).
function heatTexture(aniso) {
  const w = 256;
  const h = 512;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  // canvas top = v 1 = cylinder +Y end (after rotation: +X end, i.e. right side / outlet)
  g.addColorStop(0.0, '#b9b6b0');
  g.addColorStop(0.45, '#aaa49a');
  g.addColorStop(0.68, '#b39a6c');
  g.addColorStop(0.8, '#8c6a52');
  g.addColorStop(0.9, '#5b5a7a');
  g.addColorStop(1.0, '#6d6f86');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rand = rng(3);
  for (let i = 0; i < 900; i++) {
    const x = rand() * w;
    const a = 0.04 + rand() * 0.08;
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(x, 0, 1, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Copper windings: bump stripes (R) around the coil.
function windingTexture(aniso) {
  const c = canvas(64, 256);
  const ctx = c.getContext('2d');
  for (let y = 0; y < 256; y++) {
    const v = 0.5 + 0.5 * Math.sin((y / 256) * Math.PI * 2 * 48);
    const g = Math.round(90 + v * 150);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(0, y, 64, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

// ---------------------------------------------------------------- drawing helpers

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function para(ctx, x, y, w, h, skew) {
  ctx.beginPath();
  ctx.moveTo(x + skew, y);
  ctx.lineTo(x + w + skew, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

function text(ctx, str, x, y, { size, weight = 600, family = SANS, color = '#fff', align = 'left', base = 'alphabetic', italic = false, skew = 0, sx = 1, spacing = 0 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (skew) ctx.transform(1, 0, -skew, 1, 0, 0);
  if (sx !== 1) ctx.scale(sx, 1);
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

function measure(ctx, str, size, weight = 600, family = SANS, italic = false) {
  ctx.save();
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
  const m = ctx.measureText(str).width;
  ctx.restore();
  return m;
}

function warnTriangle(ctx, x, y, s, stroke = '#fff', fill = null, lw = 0) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + s / 2, y);
  ctx.lineTo(x + s, y + s * 0.88);
  ctx.lineTo(x, y + s * 0.88);
  ctx.closePath();
  ctx.lineJoin = 'round';
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.lineWidth = lw || s * 0.09;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.fillStyle = stroke;
  ctx.fillRect(x + s * 0.46, y + s * 0.3, s * 0.08, s * 0.3);
  ctx.fillRect(x + s * 0.46, y + s * 0.66, s * 0.08, s * 0.08);
  ctx.restore();
}

function silverBg(ctx, w, h, r) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#d9dcde');
  g.addColorStop(0.45, '#b4b9bc');
  g.addColorStop(0.55, '#c9cdd0');
  g.addColorStop(1, '#9aa0a4');
  ctx.fillStyle = g;
  rr(ctx, 0, 0, w, h, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = Math.max(1, w * 0.006);
  ctx.stroke();
}

function textLines(ctx, x, y, w, lh, n, color, seed = 1) {
  const rand = rng(seed);
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    let cx = x;
    const end = x + w * (i === n - 1 ? 0.55 : 0.92 + rand() * 0.08);
    while (cx < end) {
      const ww = lh * (0.4 + rand() * 1.8);
      ctx.fillRect(cx, y + i * lh * 1.6, Math.min(ww, end - cx), lh * 0.62);
      cx += ww + lh * 0.45;
    }
  }
}

// ---------------------------------------------------------------- door label (per model)

function drawLabel(ctx, W, H, name, watt) {
  const s = W / 2048;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(s, s);
  // sticker body
  const bg = ctx.createLinearGradient(0, 0, 0, 840);
  bg.addColorStop(0, '#121111');
  bg.addColorStop(1, '#070707');
  ctx.fillStyle = bg;
  rr(ctx, 0, 0, 2048, 840, 26);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 4;
  rr(ctx, 6, 6, 2036, 828, 22);
  ctx.stroke();

  // HATGEN wordmark: extended bold italic red
  const hw = measure(ctx, 'HATGEN', 215, 900);
  text(ctx, 'HATGEN', 96, 318, { size: 215, weight: 900, color: '#e8262c', skew: 0.2, sx: Math.min(1.45, 1000 / hw) });
  // red model tag
  ctx.fillStyle = '#d4212a';
  para(ctx, 1165, 205, 800, 150, 40);
  ctx.fill();
  ctx.fillStyle = '#b3141c';
  para(ctx, 1165, 330, 800, 25, 5);
  ctx.fill();
  const tw = measure(ctx, name, 124, 900);
  text(ctx, name, 1580, 318, { size: 124, weight: 900, color: '#ffffff', align: 'center', skew: 0.24, sx: Math.min(1.05, 700 / tw) });
  // "Max 5500 Watt" band
  ctx.fillStyle = '#d4212a';
  para(ctx, 96, 408, 1040, 136, 34);
  ctx.fill();
  const maxW = measure(ctx, 'Max', 96, 700);
  const numW = measure(ctx, String(watt), 150, 900);
  let x = 150;
  text(ctx, 'Max', x, 518, { size: 96, weight: 700, color: '#fff' });
  x += maxW + 14;
  text(ctx, String(watt), x, 528, { size: 150, weight: 900, color: '#ffc21c' });
  x += numW + 14;
  text(ctx, 'Watt', x, 518, { size: 96, weight: 700, color: '#fff' });
  // SILENT / DIESEL GENERATOR
  text(ctx, 'SILENT', 112, 700, { size: 170, weight: 700, family: SERIF, italic: true, color: '#f4f1ec', skew: 0.08, sx: 1.12 });
  text(ctx, 'DIESEL GENERATOR', 112, 800, { size: 96, weight: 700, family: SERIF, italic: true, color: '#f4f1ec', sx: 1.06 });
  text(ctx, '3PHASE', 1150, 798, { size: 62, weight: 700, family: SERIF, italic: true, color: '#d8d4cf', sx: 1.1 });
  ctx.restore();
}

// ---------------------------------------------------------------- sticker atlas

const STICKERS = {
  outdoor: [0.15, 0.018, (c, w, h) => {
    warnTriangle(c, h * 0.08, h * 0.12, h * 0.8, '#f4f1ec');
    text(c, 'OUTDOOR USE ONLY', h * 1.12, h * 0.8, { size: h * 0.66, weight: 700, color: '#f4f1ec', spacing: h * 0.03 });
  }],
  iso: [0.15, 0.022, (c, w, h) => {
    text(c, 'ISO 9001', h * 0.1, h * 0.62, { size: h * 0.58, weight: 800, color: '#f4f1ec', skew: 0.18 });
    text(c, 'CERTIFICATION', h * 0.12, h * 0.94, { size: h * 0.2, weight: 600, color: 'rgba(244,241,236,.85)', spacing: h * 0.03 });
    for (let i = 0; i < 3; i++) {
      const cx = w - h * (0.55 + i * 0.98);
      const cy = h * 0.5;
      c.strokeStyle = '#f4f1ec';
      c.lineWidth = h * 0.07;
      c.beginPath();
      c.arc(cx, cy, h * 0.36, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = '#f4f1ec';
      if (i === 0) warnTriangle(c, cx - h * 0.2, cy - h * 0.2, h * 0.4, '#f4f1ec');
      if (i === 1) {
        c.fillRect(cx - h * 0.15, cy - h * 0.16, h * 0.3, h * 0.32);
        c.clearRect(cx - h * 0.09, cy - h * 0.1, h * 0.18, h * 0.04);
      }
      if (i === 2) {
        c.beginPath();
        c.moveTo(cx - h * 0.2, cy + h * 0.16);
        c.lineTo(cx + h * 0.02, cy - h * 0.22);
        c.lineTo(cx + h * 0.02, cy + h * 0.02);
        c.lineTo(cx + h * 0.2, cy - h * 0.1);
        c.lineTo(cx - h * 0.02, cy + h * 0.24);
        c.lineTo(cx - h * 0.02, cy + h * 0.06);
        c.closePath();
        c.fill();
      }
    }
  }],
  hz50: [0.054, 0.025, (c, w, h) => {
    c.fillStyle = '#0b0b0b';
    rr(c, 1, 1, w - 2, h - 2, h * 0.08);
    c.fill();
    c.strokeStyle = '#e9e6e1';
    c.lineWidth = h * 0.07;
    rr(c, h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12, h * 0.06);
    c.stroke();
    text(c, '50', w * 0.08, h * 0.78, { size: h * 0.7, weight: 800, color: '#f4f1ec' });
    c.fillStyle = '#f4f1ec';
    c.fillRect(w * 0.52, h * 0.16, w * 0.4, h * 0.68);
    text(c, 'Hz', w * 0.72, h * 0.73, { size: h * 0.56, weight: 800, color: '#0b0b0b', align: 'center' });
  }],
  lowoil: [0.075, 0.011, (c, w, h) => {
    c.fillStyle = 'rgba(0,0,0,0.6)';
    rr(c, 0, 0, w, h, h * 0.2);
    c.fill();
    c.strokeStyle = 'rgba(244,241,236,.7)';
    c.lineWidth = h * 0.06;
    rr(c, h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1, h * 0.18);
    c.stroke();
    text(c, 'LOW OIL WARNING', w / 2, h * 0.7, { size: h * 0.5, weight: 700, color: '#f4f1ec', align: 'center', spacing: h * 0.04 });
  }],
  caution: [0.072, 0.034, (c, w, h) => {
    warnTriangle(c, h * 0.05, h * 0.04, h * 0.3, '#f4f1ec');
    text(c, 'CAUTION', h * 0.42, h * 0.3, { size: h * 0.27, weight: 800, color: '#f4f1ec' });
    textLines(c, h * 0.05, h * 0.45, w - h * 0.1, h * 0.085, 4, 'rgba(244,241,236,.72)', 9);
  }],
  silent: [0.11, 0.034, (c, w, h) => {
    c.strokeStyle = 'rgba(210,210,210,.5)';
    c.lineWidth = h * 0.06;
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.55, w * 0.48, h * 0.36, -0.08, Math.PI * 0.95, Math.PI * 2.05);
    c.stroke();
    text(c, 'SILENT', w * 0.5, h * 0.78, { size: h * 0.72, weight: 900, color: 'rgba(225,225,225,.62)', align: 'center', skew: 0.22, sx: 1.12 });
  }],
  topPlate: [0.075, 0.045, (c, w, h) => {
    silverBg(c, w, h, h * 0.05);
    text(c, 'HATGEN', h * 0.1, h * 0.25, { size: h * 0.17, weight: 900, color: '#1b1b1b', skew: 0.2, sx: 1.2 });
    text(c, 'SILENT DIESEL GENERATOR', h * 0.1, h * 0.39, { size: h * 0.085, weight: 700, color: '#222' });
    const rows = ['SERIES', '5DS', 'OUTPUT', '400 V / 230 V', 'FREQ.', '50 Hz', 'ENGINE', '498 cm³', 'LWA', '97 dB(A)'];
    for (let i = 0; i < rows.length; i += 2) {
      const y = h * (0.52 + (i / 2) * 0.1);
      text(c, rows[i], h * 0.1, y, { size: h * 0.068, weight: 600, color: '#3a3a3a' });
      text(c, rows[i + 1], h * 0.62, y, { size: h * 0.068, weight: 700, color: '#161616' });
      c.fillStyle = 'rgba(0,0,0,.18)';
      c.fillRect(h * 0.1, y + h * 0.02, w - h * 0.2, Math.max(1, h * 0.004));
    }
  }],
  doorPlate: [0.07, 0.033, (c, w, h) => {
    silverBg(c, w, h, h * 0.06);
    text(c, 'HATGEN', h * 0.12, h * 0.34, { size: h * 0.24, weight: 900, color: '#1c1c1c', skew: 0.2, sx: 1.15 });
    text(c, 'POWER EQUIPMENT', h * 0.12, h * 0.5, { size: h * 0.1, weight: 700, color: '#333' });
    const rand = rng(12);
    let x = h * 0.12;
    while (x < w - h * 0.14) {
      const bw = h * (0.012 + rand() * 0.03);
      c.fillStyle = '#161616';
      c.fillRect(x, h * 0.6, bw, h * 0.22);
      x += bw + h * (0.012 + rand() * 0.02);
    }
    text(c, '400V/230V · 50Hz', h * 0.12, h * 0.94, { size: h * 0.09, weight: 600, color: '#333', family: MONO });
  }],
  doorText: [0.085, 0.032, (c, w, h) => {
    text(c, 'WARNING', 0, h * 0.2, { size: h * 0.17, weight: 800, color: 'rgba(244,241,236,.9)' });
    textLines(c, 0, h * 0.32, w, h * 0.07, 6, 'rgba(244,241,236,.6)', 4);
  }],
  warnStrip: [0.24, 0.046, (c, w, h) => {
    c.fillStyle = '#c21d1d';
    rr(c, 0, 0, w, h, h * 0.04);
    c.fill();
    c.fillStyle = '#e0e0de';
    c.fillRect(h * 0.08, h * 0.08, w - h * 0.16, h * 0.1);
    text(c, 'WARNING · READ MANUAL BEFORE OPERATION', w / 2, h * 0.16, { size: h * 0.085, weight: 800, color: '#b71a1a', align: 'center', spacing: h * 0.01 });
    const n = 7;
    const bw = (w - h * 0.16 - (n - 1) * h * 0.06) / n;
    for (let i = 0; i < n; i++) {
      const x = h * 0.08 + i * (bw + h * 0.06);
      const y = h * 0.26;
      const bh = h * 0.64;
      c.fillStyle = '#f2efe9';
      rr(c, x, y, bw, bh, h * 0.04);
      c.fill();
      c.fillStyle = '#1a1a1a';
      const cx = x + bw * 0.3;
      const cy = y + bh * 0.5;
      const s = bh * 0.62;
      if (i % 3 === 0) warnTriangle(c, cx - s / 2, cy - s / 2, s, '#1a1a1a', '#f5c518', s * 0.08);
      else if (i % 3 === 1) {
        c.beginPath();
        c.arc(cx, cy, s * 0.46, 0, Math.PI * 2);
        c.fillStyle = '#1e5fb8';
        c.fill();
        c.fillStyle = '#fff';
        c.fillRect(cx - s * 0.06, cy - s * 0.25, s * 0.12, s * 0.5);
      } else {
        c.beginPath();
        c.arc(cx, cy, s * 0.46, 0, Math.PI * 2);
        c.strokeStyle = '#c21d1d';
        c.lineWidth = s * 0.1;
        c.stroke();
        c.beginPath();
        c.moveTo(cx - s * 0.32, cy - s * 0.32);
        c.lineTo(cx + s * 0.32, cy + s * 0.32);
        c.stroke();
      }
      textLines(c, x + bw * 0.58, y + bh * 0.22, bw * 0.36, bh * 0.08, 4, '#555', i + 3);
    }
  }],
  shroud: [0.11, 0.026, (c, w, h) => {
    text(c, 'HATGEN', 0, h * 0.62, { size: h * 0.62, weight: 900, color: '#f6f2ee', skew: 0.2, sx: 1.05 });
    text(c, 'DIESEL', w * 0.99, h * 0.6, { size: h * 0.26, weight: 700, color: 'rgba(246,242,238,.85)', align: 'right', family: MONO });
    c.fillStyle = 'rgba(246,242,238,.85)';
    c.fillRect(0, h * 0.8, w, h * 0.05);
  }],
  battery: [0.15, 0.1, (c, w, h) => {
    c.fillStyle = '#121212';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#c8201f';
    c.fillRect(0, h * 0.08, w, h * 0.06);
    const x = w * 0.07;
    text(c, 'STARTER BATTERY', x, h * 0.34, { size: h * 0.1, weight: 800, color: '#f2f0ec', spacing: h * 0.012 });
    const bs = h * 0.29;
    const vw = measure(c, '12V', bs, 800);
    text(c, '12V', x, h * 0.72, { size: bs, weight: 800, color: '#f2f0ec' });
    text(c, '30Ah', x + vw + h * 0.08, h * 0.72, { size: bs, weight: 800, color: '#e8262c' });
  }],
  altPlate: [0.07, 0.036, (c, w, h) => {
    silverBg(c, w, h, h * 0.06);
    text(c, 'HATGEN', h * 0.12, h * 0.28, { size: h * 0.19, weight: 900, color: '#1b1b1b', skew: 0.2, sx: 1.15 });
    text(c, 'ALTERNATOR · AVR', h * 0.12, h * 0.44, { size: h * 0.09, weight: 700, color: '#2a2a2a' });
    const rows = ['3~ 400 V', '1~ 230 V', '50 Hz', '12 V DC'];
    rows.forEach((r, i) => {
      text(c, r, h * 0.12 + (i % 2) * w * 0.48, h * (0.62 + Math.floor(i / 2) * 0.14), { size: h * 0.1, weight: 600, color: '#222', family: MONO });
    });
  }],
  avr: [0.06, 0.022, (c, w, h) => {
    text(c, 'AVR', h * 0.1, h * 0.62, { size: h * 0.56, weight: 900, color: '#f2f0ec', skew: 0.15 });
    text(c, 'VOLTAGE', w * 0.5, h * 0.44, { size: h * 0.22, weight: 700, color: 'rgba(242,240,236,.75)' });
    text(c, 'REGULATOR', w * 0.5, h * 0.72, { size: h * 0.22, weight: 700, color: 'rgba(242,240,236,.75)' });
  }],
  gauge: [0.05, 0.05, (c, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const r = w * 0.47;
    const g = c.createRadialGradient(cx, cy * 0.8, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#f4f1ea');
    g.addColorStop(1, '#d6d1c6');
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#1b1b1b';
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (1.15 + (i / 8) * 0.7);
      c.lineWidth = i % 4 === 0 ? r * 0.06 : r * 0.03;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62);
      c.lineTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
      c.stroke();
    }
    c.fillStyle = '#c21d1d';
    c.beginPath();
    c.arc(cx, cy, r * 0.62, Math.PI * 1.15, Math.PI * 1.32);
    c.arc(cx, cy, r * 0.82, Math.PI * 1.32, Math.PI * 1.15, true);
    c.fill();
    text(c, 'E', cx - r * 0.55, cy + r * 0.12, { size: r * 0.26, weight: 800, color: '#1b1b1b', align: 'center' });
    text(c, 'F', cx + r * 0.55, cy + r * 0.12, { size: r * 0.26, weight: 800, color: '#1b1b1b', align: 'center' });
    text(c, 'FUEL', cx, cy + r * 0.5, { size: r * 0.2, weight: 800, color: '#c21d1d', align: 'center', spacing: r * 0.03 });
    const a = Math.PI * (1.15 + 0.72 * 0.7);
    c.strokeStyle = '#d11a14';
    c.lineWidth = r * 0.07;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx - Math.cos(a) * r * 0.12, cy - Math.sin(a) * r * 0.12);
    c.lineTo(cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.75);
    c.stroke();
    c.fillStyle = '#1b1b1b';
    c.beginPath();
    c.arc(cx, cy, r * 0.09, 0, Math.PI * 2);
    c.fill();
  }],
  exhaustHot: [0.07, 0.03, (c, w, h) => {
    c.fillStyle = '#f5c518';
    rr(c, 0, 0, w, h, h * 0.08);
    c.fill();
    c.fillStyle = '#111';
    rr(c, h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12, h * 0.05);
    c.lineWidth = h * 0.04;
    c.strokeStyle = '#111';
    c.stroke();
    warnTriangle(c, h * 0.12, h * 0.14, h * 0.72, '#111', '#f5c518', h * 0.06);
    text(c, 'HOT', h * 1.0, h * 0.5, { size: h * 0.36, weight: 900, color: '#111' });
    text(c, 'SURFACE', h * 1.0, h * 0.84, { size: h * 0.26, weight: 800, color: '#111' });
  }],
  ceeLid: [0.044, 0.044, (c, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const ink = 'rgba(255,236,232,0.9)';
    c.strokeStyle = ink;
    c.fillStyle = ink;
    c.lineWidth = w * 0.018;
    c.beginPath();
    c.arc(cx, cy - h * 0.1, w * 0.17, 0, Math.PI * 2);
    c.stroke();
    // 3P + N + PE contact pattern, earth pin (larger) at 6 h
    for (const clock of [8, 10.5, 1.5, 4]) {
      const a = (clock / 12) * Math.PI * 2;
      c.beginPath();
      c.arc(cx + Math.sin(a) * w * 0.105, cy - h * 0.1 - Math.cos(a) * w * 0.105, w * 0.022, 0, Math.PI * 2);
      c.fill();
    }
    c.beginPath();
    c.arc(cx, cy - h * 0.1 + w * 0.11, w * 0.03, 0, Math.PI * 2);
    c.fill();
    text(c, '32A', cx, cy + h * 0.24, { size: h * 0.15, weight: 800, color: ink, align: 'center' });
    text(c, '400V · 6h', cx, cy + h * 0.36, { size: h * 0.085, weight: 700, color: ink, align: 'center', spacing: h * 0.004 });
  }],
  engineWarn: [0.05, 0.02, (c, w, h) => {
    c.fillStyle = '#f5c518';
    rr(c, 0, 0, w, h, h * 0.1);
    c.fill();
    warnTriangle(c, h * 0.12, h * 0.14, h * 0.7, '#111', null, h * 0.06);
    text(c, 'CHECK', h * 0.95, h * 0.5, { size: h * 0.34, weight: 900, color: '#111' });
    text(c, 'OIL LEVEL', h * 0.95, h * 0.84, { size: h * 0.24, weight: 800, color: '#111' });
  }],
};

// Stickers printed into the control panel legend instead of the decal atlas.
const LEGEND_ONLY = new Set(['hz50', 'lowoil', 'caution', 'silent']);

function buildAtlas(scale, aniso) {
  const density = 4500 * scale; // px per meter
  const pad = Math.ceil(8 * scale);
  const W = Math.round(2048 * scale);
  const entries = Object.entries(STICKERS).filter(([k]) => !LEGEND_ONLY.has(k)).map(([k, [w, h, draw]]) => ({ k, w, h, draw, pw: Math.ceil(w * density), ph: Math.ceil(h * density) }));
  entries.sort((a, b) => b.ph - a.ph);
  let x = pad;
  let y = pad;
  let rowH = 0;
  for (const e of entries) {
    if (x + e.pw + pad > W) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    e.x = x;
    e.y = y;
    x += e.pw + pad;
    rowH = Math.max(rowH, e.ph);
  }
  const need = y + rowH + pad;
  let Hh = 256;
  while (Hh < need) Hh *= 2;
  const c = canvas(W, Hh);
  const ctx = c.getContext('2d');
  const rects = {};
  const redraw = () => {
    ctx.clearRect(0, 0, W, Hh);
    for (const e of entries) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.beginPath();
      ctx.rect(0, 0, e.pw, e.ph);
      ctx.clip();
      e.draw(ctx, e.pw, e.ph);
      ctx.restore();
    }
  };
  redraw();
  for (const e of entries) rects[e.k] = { uv: [e.x / W, 1 - (e.y + e.ph) / Hh, e.pw / W, e.ph / Hh], w: e.w, h: e.h };
  const t = colorTexture(c, aniso);
  return { texture: t, rects, redraw: () => { redraw(); t.needsUpdate = true; } };
}

// ---------------------------------------------------------------- control panel legends

function drawPanelLegend(ctx, W, H) {
  const k = W / PLATE_W; // px per meter
  const X = (u) => (u + PLATE_W / 2) * k;
  const Y = (v) => (PLATE_H / 2 - v) * k;
  const L = PANEL_LAYOUT;
  const white = 'rgba(240,236,232,0.92)';
  const dim = 'rgba(240,236,232,0.55)';
  const mm = k / 1000;
  ctx.clearRect(0, 0, W, H);
  // inset hairline frame
  ctx.strokeStyle = 'rgba(240,236,232,0.16)';
  ctx.lineWidth = Math.max(1, 0.35 * mm);
  rr(ctx, 5 * mm, 5 * mm, W - 10 * mm, H - 10 * mm, 2 * mm);
  ctx.stroke();
  // vertical divider between the two columns, short rule above the sticker field
  ctx.beginPath();
  ctx.moveTo(X(0.004), Y(0.208));
  ctx.lineTo(X(0.004), Y(-0.074));
  ctx.moveTo(X(-0.088), Y(-0.078));
  ctx.lineTo(X(0.088), Y(-0.078));
  ctx.stroke();
  // printed stickers (50 Hz, low oil, caution, SILENT)
  for (const [key, u, v, w] of L.stickers) {
    const st = STICKERS[key];
    if (!st) continue;
    const pw = w * k;
    const ph = (w * st[1] / st[0]) * k;
    ctx.save();
    ctx.translate(X(u) - pw / 2, Y(v) - ph / 2);
    ctx.beginPath();
    ctx.rect(0, 0, pw, ph);
    ctx.clip();
    st[2](ctx, pw, ph);
    ctx.restore();
  }
  const t = (s, u, v, size, o = {}) => text(ctx, s, X(u), Y(v), { size: size * mm, weight: 700, color: white, align: 'center', family: SANS, spacing: size * mm * 0.06, ...o });
  t('MAIN SWITCH', L.breaker.u, L.breaker.v + L.breaker.h / 2 + 0.0065, 3.6);
  t('AC 230V', L.schuko1.u, L.schuko1.v - L.schuko1.s / 2 - 0.0062, 3.4);
  t('AC 230V', L.schuko2.u, L.schuko2.v - L.schuko2.s / 2 - 0.0062, 3.4);
  t('STARTER', L.keySwitch.u, L.keySwitch.v + 0.0285, 3.4);
  // OFF / ON / START around the key
  const ring = [['OFF', 150], ['ON', 90], ['START', 30]];
  for (const [s, a] of ring) {
    const r = 0.0235;
    const u = L.keySwitch.u + Math.cos((a * Math.PI) / 180) * r;
    const v = L.keySwitch.v + Math.sin((a * Math.PI) / 180) * r - 0.0012;
    t(s, u, v, 2.6, { color: s === 'START' ? '#ff4a3d' : white, weight: 800 });
  }
  // key position ticks
  ctx.strokeStyle = dim;
  ctx.lineWidth = 0.5 * mm;
  for (const a of [150, 90, 30]) {
    const r0 = 0.0185;
    const r1 = 0.0205;
    const ca = Math.cos((a * Math.PI) / 180);
    const sa = Math.sin((a * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(X(L.keySwitch.u + ca * r0), Y(L.keySwitch.v + sa * r0));
    ctx.lineTo(X(L.keySwitch.u + ca * r1), Y(L.keySwitch.v + sa * r1));
    ctx.stroke();
  }
  t('RUN', L.ledRun.u + 0.0075, L.ledRun.v - 0.0012, 2.6, { align: 'left' });
  t('OIL', L.ledOil.u + 0.0075, L.ledOil.v - 0.0012, 2.6, { align: 'left' });
  t('+', L.dcPlus.u, L.dcPlus.v + 0.0115, 4.6, { color: '#ff4a3d', weight: 800 });
  ctx.fillStyle = white;
  ctx.fillRect(X(L.dcMinus.u - 0.0018), Y(L.dcMinus.v + 0.0132), 3.6 * mm, 0.9 * mm);
  t('DC 12V · 8.3A', (L.dcPlus.u + L.dcMinus.u) / 2, L.dcPlus.v - 0.0135, 3.0);
  t('DC CIRCUIT', L.dcReset.u, L.dcReset.v + 0.0115, 2.5);
  t('RESET', L.dcReset.u, L.dcReset.v - 0.0125, 2.5, { color: dim });
  t('3~ 400V · 32A', L.cee.u, L.cee.v - L.cee.h / 2 - 0.0152, 3.4);
  t('6h', L.cee.u, L.cee.v - L.cee.h / 2 - 0.0199, 2.4, { color: dim });
  // earth symbol near CEE
  ctx.strokeStyle = dim;
  ctx.lineWidth = 0.5 * mm;
  const ex = X(0.089);
  const ey = Y(-0.064);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(ex - (2.2 - i * 0.7) * mm, ey + i * 0.9 * mm);
    ctx.lineTo(ex + (2.2 - i * 0.7) * mm, ey + i * 0.9 * mm);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex, ey - 2.2 * mm);
  ctx.stroke();
}

// ---------------------------------------------------------------- 7-segment display

const SEGS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };

function drawDigit(ctx, x, y, w, h, ch, on, off) {
  const t = w * 0.2;
  const g = t * 0.14;
  const hh = h / 2;
  const segH = (x0, y0, len) => {
    ctx.beginPath();
    ctx.moveTo(x0 + g, y0);
    ctx.lineTo(x0 + g + t / 2, y0 - t / 2);
    ctx.lineTo(x0 + len - g - t / 2, y0 - t / 2);
    ctx.lineTo(x0 + len - g, y0);
    ctx.lineTo(x0 + len - g - t / 2, y0 + t / 2);
    ctx.lineTo(x0 + g + t / 2, y0 + t / 2);
    ctx.closePath();
  };
  const segV = (x0, y0, len) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0 + g);
    ctx.lineTo(x0 + t / 2, y0 + g + t / 2);
    ctx.lineTo(x0 + t / 2, y0 + len - g - t / 2);
    ctx.lineTo(x0, y0 + len - g);
    ctx.lineTo(x0 - t / 2, y0 + len - g - t / 2);
    ctx.lineTo(x0 - t / 2, y0 + g + t / 2);
    ctx.closePath();
  };
  const paths = {
    a: () => segH(x, y, w),
    b: () => segV(x + w, y, hh),
    c: () => segV(x + w, y + hh, hh),
    d: () => segH(x, y + h, w),
    e: () => segV(x, y + hh, hh),
    f: () => segV(x, y, hh),
    g: () => segH(x, y + hh, w),
  };
  const lit = SEGS[ch] || '';
  for (const s of 'abcdefg') {
    paths[s]();
    ctx.fillStyle = lit.includes(s) ? on : off;
    ctx.fill();
  }
}

function drawSevenRow(ctx, str, x, y, w, h, gap, count, on, off) {
  // str may contain '.', rendered as decimal point of the previous digit
  const digits = [];
  for (const ch of str) {
    if (ch === '.' && digits.length) digits[digits.length - 1].dp = true;
    else digits.push({ ch, dp: false });
  }
  while (digits.length < count) digits.unshift({ ch: ' ', dp: false });
  for (let i = 0; i < count; i++) {
    const d = digits[i];
    const dx = x + i * (w + gap);
    drawDigit(ctx, dx, y, w, h, d.ch, on, off);
    ctx.beginPath();
    ctx.arc(dx + w + gap * 0.5, y + h + w * 0.02, w * 0.11, 0, Math.PI * 2);
    ctx.fillStyle = d.dp ? on : off;
    ctx.fill();
  }
}

function createDisplay(scale, aniso) {
  const W = Math.round(640 * Math.max(0.75, scale));
  const H = Math.round(W * 0.5625);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const tex = colorTexture(c, aniso);
  let last = '';
  const units = ['V', 'A', 'Hz', 'kW'];
  function draw(top, bottom, unit, on) {
    const key = `${top}|${bottom}|${unit}|${on ? 1 : 0}`;
    if (key === last) return false;
    last = key;
    const s = W / 640;
    ctx.save();
    ctx.scale(s, s);
    ctx.fillStyle = '#030101';
    ctx.fillRect(0, 0, 640, 360);
    const onC = on ? '#ff2b1c' : 'rgba(255,50,40,0.05)';
    const offC = 'rgba(255,50,40,0.05)';
    ctx.save();
    ctx.transform(1, 0, -0.09, 1, 0, 0);
    if (on) {
      ctx.shadowColor = 'rgba(255,40,20,0.9)';
      ctx.shadowBlur = 14;
    }
    drawSevenRow(ctx, top, 70, 34, 86, 150, 30, 4, onC, offC);
    drawSevenRow(ctx, bottom, 76, 236, 50, 86, 20, 5, onC, offC);
    ctx.restore();
    // unit column
    units.forEach((u, i) => {
      const y = 58 + i * 50;
      const active = on && u === unit;
      ctx.fillStyle = active ? '#ff2b1c' : 'rgba(255,50,40,0.1)';
      if (active) {
        ctx.shadowColor = 'rgba(255,40,20,0.9)';
        ctx.shadowBlur = 10;
      }
      ctx.fillRect(516, y - 14, 16, 16);
      ctx.shadowBlur = 0;
      ctx.font = `700 30px ${MONO}`;
      ctx.fillStyle = active ? 'rgba(255,90,70,0.95)' : 'rgba(255,60,50,0.22)';
      ctx.fillText(u, 546, y + 2);
    });
    ctx.font = `700 30px ${MONO}`;
    ctx.fillStyle = on ? 'rgba(255,90,70,0.8)' : 'rgba(255,60,50,0.22)';
    ctx.fillText('h', 546, 312);
    ctx.restore();
    tex.needsUpdate = true;
    return true;
  }
  draw('8.8.8.8', '88888', 'V', false);
  return { texture: tex, draw, reset: () => { last = ''; } };
}

// ---------------------------------------------------------------- dimension labels

// Canvas 512 x 128: the number is set in a 64 px mono face, so the sprite's pixel height is
// twice the on-screen font size (see dimensions.js).
function dimLabel(str, scale, aniso) {
  const W = Math.round(512 * Math.max(0.75, scale));
  const H = Math.round(W / 4);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const tex = colorTexture(c, aniso);
  const draw = () => {
    const s = W / 512;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.scale(s, s);
    const [num, unit] = str.split(' ');
    ctx.font = `560 64px ${MONO}`;
    const nw = ctx.measureText(num).width;
    ctx.font = `500 44px ${MONO}`;
    const uw = ctx.measureText(unit).width;
    const gap = 12;
    const x0 = 256 - (nw + gap + uw) / 2;
    // dark halo so the label reads over lines and edges without a UI chip behind it
    for (const blur of [18, 8]) {
      ctx.shadowColor = 'rgba(7,2,2,0.95)';
      ctx.shadowBlur = blur;
      text(ctx, num, x0, 86, { size: 64, weight: 560, family: MONO, color: 'rgba(7,2,2,0.9)' });
      text(ctx, unit, x0 + nw + gap, 86, { size: 44, weight: 500, family: MONO, color: 'rgba(7,2,2,0.9)' });
    }
    ctx.shadowBlur = 0;
    text(ctx, num, x0, 86, { size: 64, weight: 560, family: MONO, color: '#fbf6f4' });
    text(ctx, unit, x0 + nw + gap, 86, { size: 44, weight: 500, family: MONO, color: '#ff5a50' });
    ctx.restore();
    tex.needsUpdate = true;
  };
  draw();
  return { texture: tex, redraw: draw, aspect: W / H };
}

function puffTexture() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- public factory

// Web fonts the text textures are set in (weights are ranges of the variable faces).
export const TEXT_FONTS = [`900 64px "Inter Variable"`, `600 64px "JetBrains Mono Variable"`];
const fontMissing = (f) => {
  try {
    return !document.fonts.check(f);
  } catch {
    return false;
  }
};
// Resolves once the text fonts are loaded (true) or after `timeout` ms. Nothing is fetched
// when they are ready already.
export function loadTextFonts(timeout = 2500) {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve(true);
  const missing = TEXT_FONTS.filter(fontMissing);
  if (!missing.length) return Promise.resolve(true);
  const load = Promise.all(missing.map((f) => document.fonts.load(f).catch(() => []))).then(() => true);
  return Promise.race([load, new Promise((r) => setTimeout(() => r(false), timeout))]);
}
// Yielded by textureSteps() right before the first text is drawn: an async builder can wait
// for loadTextFonts() there, so the text textures are drawn once, in the right face.
export const WAIT_FONTS = Symbol('hatgen:fonts');

export function createTextures(opts) {
  return runSteps(textureSteps(opts));
}

// The texture build as a generator: it yields between the heavier chunks, so an async
// caller can give the browser a frame in between (see createGeneratorAsync).
export function* textureSteps({ renderer, quality = 'high' }) {
  const scale = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
  const aniso = renderer?.capabilities?.getMaxAnisotropy?.() || 8;
  const nSize = quality === 'low' ? 256 : 512;

  const t = {};
  t.powder = powderTexture(nSize, aniso);
  yield;
  t.cast = castTexture(Math.min(256, nSize), aniso);
  t.brushed = brushedTexture(256, aniso);
  yield;
  const foam = foamTextures(quality === 'low' ? 128 : 256, aniso);
  t.foamNormal = foam.normal;
  t.foamColor = foam.color;
  t.heat = heatTexture(aniso);
  t.winding = windingTexture(aniso);
  t.puff = puffTexture();
  yield WAIT_FONTS;

  // Door label, one texture per model.
  const LW = Math.round(2048 * scale);
  const LH = Math.round(LW * (840 / 2048));
  const labels = {};
  const labelDefs = { s5500: ['S5500-5DS', 5500], s6500: ['S6500-5DS', 6500] };
  for (const [id, [name, watt]] of Object.entries(labelDefs)) {
    const c = canvas(LW, LH);
    const ctx = c.getContext('2d');
    drawLabel(ctx, LW, LH, name, watt);
    const tx = colorTexture(c, aniso);
    labels[id] = { texture: tx, redraw: () => { drawLabel(ctx, LW, LH, name, watt); tx.needsUpdate = true; } };
  }
  t.label = { s5500: labels.s5500.texture, s6500: labels.s6500.texture };
  yield;

  const atlas = buildAtlas(scale, aniso);
  t.atlas = atlas.texture;
  t.rects = atlas.rects;
  yield;

  const PW = Math.round(1024 * scale);
  const PH = Math.round(PW * (PLATE_H / PLATE_W));
  const pc = canvas(PW, PH);
  const pctx = pc.getContext('2d');
  drawPanelLegend(pctx, PW, PH);
  t.panel = colorTexture(pc, aniso);
  yield;

  t.display = createDisplay(scale, aniso);

  t.dims = {
    length: dimLabel('950 mm', scale, aniso),
    depth: dimLabel('550 mm', scale, aniso),
    height: dimLabel('800 mm', scale, aniso),
  };

  // Redraw the text textures if a web font was still missing at the first draw (then the
  // text above was set in a fallback face). load() also resolves for faces that are
  // loaded already, so only the missing ones are waited for.
  t.redrawText = () => {
    Object.values(labels).forEach((l) => l.redraw());
    atlas.redraw();
    drawPanelLegend(pctx, PW, PH);
    t.panel.needsUpdate = true;
    Object.values(t.dims).forEach((d) => d.redraw());
    t.display.reset();
  };
  if (typeof document !== 'undefined' && document.fonts?.load) {
    const missing = TEXT_FONTS.filter(fontMissing);
    if (missing.length) {
      Promise.all(missing.map((f) => document.fonts.load(f).catch(() => [])))
        .then((res) => {
          if (res.some((r) => r && r.length)) t.redrawText();
        })
        .catch(() => {});
    }
  }

  t.dispose = () => {
    const all = [t.powder, t.cast, t.brushed, t.foamNormal, t.foamColor, t.heat, t.winding, t.puff, t.label.s5500, t.label.s6500, t.atlas, t.panel, t.display.texture, ...Object.values(t.dims).map((d) => d.texture)];
    all.forEach((x) => x.dispose());
  };
  return t;
}
