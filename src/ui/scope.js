// AVR scene: SVG oscilloscope. A distorted, jittery wave ("UNGEREGELT") morphs into a
// clean red sine ("MIT AVR") as the pinned section scrolls. A faint gray trace keeps
// showing the unregulated signal for comparison.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { reducedMotion } from '../core/env.js';
import { $, fmtDe, smoothstep } from './util.js';

// Plot area only: the HUD (tags, readout) lives in its own bar above the SVG, so the trace
// never runs through the labels. The trace ends a little before the right edge so the
// write-head dot sits fully inside the frame.
// Scale matches the HUD (CH1 · 200 V/div · 5 ms/div): 4 vertical divisions of 47.5 units,
// 10 horizontal divisions of 56 units (50 ms). 230 V RMS is 325 V peak, i.e. 1.63 div;
// 50 Hz over the traced 48.9 ms is 2.45 cycles.
const W = 560;
const H = 190;
const MID = H / 2;
const AMP = 77;
const X_END = W - 12;
const CYCLES = 2.45;
const Y_MIN = 3; // spikes clip at the screen edge, like on a real scope
const Y_MAX = H - 3;
const N = 196;
const NS = 'http://www.w3.org/2000/svg';

// deterministic pseudo random in [-1, 1]
function hash(i, seed) {
  const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function buildGrid(g) {
  const frag = document.createDocumentFragment();
  const line = (x1, y1, x2, y2, cls) => {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', x1);
    l.setAttribute('y1', y1);
    l.setAttribute('x2', x2);
    l.setAttribute('y2', y2);
    if (cls) l.setAttribute('class', cls);
    frag.appendChild(l);
  };
  const row = H / 4;
  for (let i = 1; i < 10; i++) line(i * 56, 0, i * 56, H, i === 5 ? 'axis' : '');
  for (let j = 1; j < 4; j++) line(0, j * row, W, j * row, j === 2 ? 'axis' : '');
  for (let t = 0; t <= 50; t++) {
    const x = t * 11.2;
    line(x, MID - 3, x, MID + 3, 'tick');
  }
  for (let t = 0; t <= 20; t++) {
    const y = t * (H / 20);
    line(W / 2 - 3, y, W / 2 + 3, y, 'tick');
  }
  g.appendChild(frag);
}

export function initScope() {
  const section = document.getElementById('avr');
  const scope = section && $('.scope', section);
  if (!scope) return;
  const svg = $('.scope__svg', scope);
  const trace = $('.scope__trace', scope);
  const ghost = $('.scope__ghost', scope);
  const cursor = $('.scope__cursor', scope);
  const volt = $('.scope__volt', scope);
  buildGrid($('.scope__grid', svg));

  let m = 0; // 0 = unregulated, 1 = regulated
  let time = 0;
  let visible = false;
  let lastNoiseStep = -1;
  const noise = new Float32Array(N + 1);

  function refreshNoise(step) {
    for (let i = 0; i <= N; i++) noise[i] = hash(i, step) * 0.5 + hash(i * 0.37, step + 17) * 0.5;
  }

  // distorted signal: harmonics, flattened peaks, spikes and jitter
  function distorted(i, ph) {
    let v = Math.sin(ph) + 0.2 * Math.sin(3 * ph + 0.7) + 0.11 * Math.sin(5 * ph + 1.9) + 0.07 * Math.sin(11 * ph);
    v = Math.max(-0.92, Math.min(0.92, v)) * 1.02;
    v += noise[i] * 0.11;
    const spike = Math.pow(Math.max(0, Math.sin(ph * 0.5 + 1.1)), 60) * 0.42;
    v += spike * (hash(i, 3) > 0 ? 1 : -1);
    return v * (0.9 + 0.12 * Math.sin(time * 1.7 + i * 0.01));
  }

  function draw() {
    const phase = time * 2.4;
    const step = Math.floor(time * 14);
    if (step !== lastNoiseStep) {
      lastNoiseStep = step;
      refreshNoise(step);
    }
    let dT = '';
    let dG = '';
    let lastY = MID;
    for (let i = 0; i <= N; i++) {
      const x = (i / N) * X_END;
      const ph = (i / N) * CYCLES * Math.PI * 2 - phase;
      const clean = Math.sin(ph);
      const dist = distorted(i, ph);
      const v = dist + (clean - dist) * m;
      const yT = Math.min(Y_MAX, Math.max(Y_MIN, MID - v * AMP));
      const yG = Math.min(Y_MAX, Math.max(Y_MIN, MID - dist * AMP));
      dT += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + yT.toFixed(1);
      dG += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + yG.toFixed(1);
      lastY = yT;
    }
    trace.setAttribute('d', dT);
    ghost.setAttribute('d', dG);
    cursor.setAttribute('cy', lastY.toFixed(1));
    trace.style.opacity = (0.35 + 0.65 * m).toFixed(3);
    ghost.style.opacity = (1 - 0.62 * m).toFixed(3);
    scope.style.setProperty('--m', m.toFixed(3));
    if (volt) {
      const jitter = (1 - m) * (Math.sin(time * 9.1) * 14 + Math.sin(time * 23.7) * 7 + noise[5] * 6);
      volt.textContent = fmtDe(230 + jitter + m * Math.sin(time * 3) * 0.4, 1);
    }
  }

  const tick = (_, deltaMs) => {
    if (!visible) return;
    time += Math.min(deltaMs, 50) / 1000;
    draw();
  };

  if (reducedMotion) {
    refreshNoise(1);
    ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        const next = self.progress > 0.3 ? 1 : 0;
        if (next !== m) {
          m = next;
          draw();
        }
      },
    });
    draw();
    return;
  }

  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      m = smoothstep(0.08, 0.62, self.progress);
    },
    onRefresh: (self) => {
      m = smoothstep(0.08, 0.62, self.progress);
    },
  });
  ScrollTrigger.create({
    trigger: section,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      visible = self.isActive;
    },
  });
  refreshNoise(0);
  draw();
  gsap.ticker.add(tick);
}
