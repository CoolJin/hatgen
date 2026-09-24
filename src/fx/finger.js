// Finger FX: an electric, brand-red interaction drawn at the finger (touch and pen) on a fixed
// full-screen overlay canvas (pointer-events: none, so it never blocks scrolling or taps).
//   touch start  glowing ripple ring + a small burst of sparks
//   finger moves luminous trail that fades like current flowing through a wire, pulses
//                travelling toward the finger, a few crackling arcs and sparks
//   release      the contact glow dissipates, a few slow embers drift off
// Reduced motion: only a soft, short ripple. Everything is drawn additively ('lighter') into
// the overlay, which composites normally over the page (no CSS blend group), and only the
// region drawn in the previous frame is cleared. The canvas is hidden while idle.
import { reducedMotion } from '../core/env.js';

const TAU = Math.PI * 2;
const DPR_MAX = 2;
const MAX_PIXELS = 4.2e6; // backing store cap in device pixels (large tablets)
const MAX_FINGERS = 3;
const MAX_SPARKS = 150;
const MAX_ARCS = 10;
const MAX_POINTS = 56;
const TRAIL_LIFE = 0.38; // s a trail point stays visible
const STEP = 3; // px between trail points (longer jumps are subdivided)
const GLOW_STEP = 4.5; // px between glow sprites along the trail
const STALE_MS = 8000; // a finger without any event for this long is released

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function sprite(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

export function createFinger({ loop, enabled }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-touch';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Soft glow sprites (drawn scaled with drawImage: far cheaper than shadowBlur).
  const RED = sprite(128, [
    [0, 'rgba(255, 104, 92, 1)'],
    [0.18, 'rgba(255, 62, 54, 0.62)'],
    [0.46, 'rgba(210, 30, 28, 0.2)'],
    [1, 'rgba(150, 12, 12, 0)'],
  ]);
  const HOT = sprite(64, [
    [0, 'rgba(255, 250, 247, 1)'],
    [0.28, 'rgba(255, 196, 186, 0.62)'],
    [0.62, 'rgba(255, 84, 72, 0.16)'],
    [1, 'rgba(255, 60, 50, 0)'],
  ]);

  const fingers = new Map();
  const sparks = [];
  const arcs = [];
  const rings = [];
  let active = false;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let sizeDirty = true;
  // dirty region drawn last frame (CSS px)
  const prev = { x0: 0, y0: 0, x1: 0, y1: 0, ok: false };
  const box = { x0: 0, y0: 0, x1: 0, y1: 0, ok: false };

  window.addEventListener('resize', () => (sizeDirty = true), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reset();
  });

  function ensureSize() {
    if (!sizeDirty) return;
    sizeDirty = false;
    // CSS size of the canvas (100% wide without a desktop scrollbar, 100lvh tall, so the
    // mobile URL bar showing / hiding never resizes it). Read only after a resize.
    const w = canvas.clientWidth || window.innerWidth;
    const h = Math.max(window.innerHeight, canvas.clientHeight || 0);
    let d = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    if (w * h * d * d > MAX_PIXELS) d = Math.sqrt(MAX_PIXELS / (w * h));
    if (w === cssW && h === cssH && d === dpr) return;
    cssW = w;
    cssH = h;
    dpr = d;
    canvas.width = Math.max(1, Math.round(w * d));
    canvas.height = Math.max(1, Math.round(h * d));
    prev.ok = false;
  }

  function show(on) {
    if (on === active) return;
    active = on;
    if (!on) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      prev.ok = false;
    }
    canvas.classList.toggle('is-on', on);
  }

  // ------------------------------------------------------------------ emitters
  function burst(x, y, n, speedMin, speedMax, hot = true) {
    for (let i = 0; i < n && sparks.length < MAX_SPARKS; i++) {
      const a = rand(0, TAU);
      const s = rand(speedMin, speedMax);
      sparks.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - s * 0.25,
        age: 0,
        life: rand(0.32, 0.72),
        w: rand(0.9, 1.7),
        hot,
      });
    }
  }

  function arc(x, y, dirx = 0, diry = 0, len = rand(12, 34)) {
    if (arcs.length >= MAX_ARCS) return;
    // mostly sideways to the motion, like sparks jumping off a live wire
    let a = rand(0, TAU);
    if (dirx || diry) a = Math.atan2(diry, dirx) + (Math.random() < 0.5 ? 1 : -1) * rand(0.9, 2.3);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const n = 5;
    const pts = [x, y];
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const off = (Math.random() - 0.5) * len * 0.5 * (1 - f * 0.4);
      pts.push(x + ca * len * f - sa * off, y + sa * len * f + ca * off);
    }
    arcs.push({ pts, age: 0, life: rand(0.07, 0.14) });
  }

  // ------------------------------------------------------------------ input
  function start(id, x, y, kind) {
    if (!enabled() || fingers.size >= MAX_FINGERS) return;
    ensureSize();
    const pen = kind === 'pen';
    const now = performance.now() / 1000;
    if (reducedMotion) {
      rings.push({ x, y, t0: now, type: 'soft', s: pen ? 0.7 : 1 });
    } else {
      fingers.set(id, {
        x, y, pen, down: true, pts: [{ x, y, t: now }], lastT: performance.now(),
        speed: 0, dx: 0, dy: 0, sparkAcc: 0, arcAcc: 0, releasedAt: 0, t0: now,
      });
      rings.push({ x, y, t0: now, type: 'down', s: pen ? 0.65 : 1 });
      burst(x, y, pen ? 7 : 13, 150, 440);
      arc(x, y);
    }
    show(true);
    loop.wake();
  }

  function move(id, x, y, time) {
    const f = fingers.get(id);
    if (!f || !f.down) return;
    const mx = x - f.x;
    const my = y - f.y;
    const d = Math.hypot(mx, my);
    if (d < 0.5) return;
    const dt = Math.max((time - f.lastT) / 1000, 0.008);
    f.lastT = time;
    f.speed += (Math.min(d / dt, 6000) - f.speed) * 0.4;
    f.dx = mx / d;
    f.dy = my / d;
    const now = time / 1000;
    const last = f.pts[f.pts.length - 1];
    const gap = Math.hypot(x - last.x, y - last.y);
    if (gap >= STEP) {
      // subdivide long jumps (sparse touchmove events) so the trail stays smooth
      const n = Math.min(12, Math.floor(gap / (STEP * 2)));
      for (let i = 1; i <= n; i++) {
        const k = i / (n + 1);
        f.pts.push({ x: last.x + (x - last.x) * k, y: last.y + (y - last.y) * k, t: last.t + (now - last.t) * k });
      }
      f.pts.push({ x, y, t: now });
      if (f.pts.length > MAX_POINTS) f.pts.splice(0, f.pts.length - MAX_POINTS);
    }
    f.x = x;
    f.y = y;
    loop.wake();
  }

  function end(id, x, y, cancelled) {
    const f = fingers.get(id);
    if (!f || !f.down) return;
    f.down = false;
    const now = performance.now() / 1000;
    f.releasedAt = now;
    if (!cancelled) {
      rings.push({ x: f.x, y: f.y, t0: now, type: 'up', s: f.pen ? 0.65 : 1 });
      burst(f.x, f.y, f.pen ? 3 : 6, 40, 150, false);
    }
    loop.wake();
  }

  // Modal opened etc.: drop everything at once.
  function reset() {
    fingers.clear();
    sparks.length = 0;
    arcs.length = 0;
    rings.length = 0;
    show(false);
  }

  // ------------------------------------------------------------------ simulation
  function simulate(dt, now) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      if (s.age >= s.life) {
        sparks[i] = sparks[sparks.length - 1];
        sparks.pop();
        continue;
      }
      const drag = Math.exp(-dt * 3.4);
      s.vx *= drag;
      s.vy = s.vy * drag + 520 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    for (let i = arcs.length - 1; i >= 0; i--) {
      arcs[i].age += dt;
      if (arcs[i].age >= arcs[i].life) arcs.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      const dur = r.type === 'down' ? 0.7 : r.type === 'up' ? 0.55 : 0.42;
      if (now - r.t0 > dur) rings.splice(i, 1);
    }
    for (const [id, f] of fingers) {
      let cut = 0;
      while (cut < f.pts.length - 1 && now - f.pts[cut].t > TRAIL_LIFE) cut++;
      if (cut) f.pts.splice(0, cut);
      // safety: a lost touchend (focus change, system gesture) never leaves a finger behind
      if (f.down && now * 1000 - f.lastT > STALE_MS) {
        f.down = false;
        f.releasedAt = now;
      }
      if (!f.down) {
        if (now - f.releasedAt > TRAIL_LIFE + 0.1) fingers.delete(id);
        continue;
      }
      // speed decays while the finger rests (no move events arrive then)
      f.speed *= Math.exp(-dt * 7);
      const sp = clamp01((f.speed - 140) / 1100);
      f.sparkAcc += sp * 30 * dt;
      while (f.sparkAcc >= 1 && sparks.length < MAX_SPARKS) {
        f.sparkAcc -= 1;
        const a = rand(0, TAU);
        const s = rand(60, 200);
        sparks.push({
          x: f.x, y: f.y,
          vx: -f.dx * f.speed * 0.1 + Math.cos(a) * s,
          vy: -f.dy * f.speed * 0.1 + Math.sin(a) * s - 60,
          age: 0, life: rand(0.25, 0.55), w: rand(0.8, 1.4), hot: Math.random() < 0.6,
        });
      }
      f.sparkAcc = Math.min(f.sparkAcc, 2);
      // crackle: a few short arcs, more while moving fast, a quiet idle crackle at rest
      f.arcAcc += (1.1 + clamp01(f.speed / 800) * 6.5) * dt;
      while (f.arcAcc >= 1) {
        f.arcAcc -= 1;
        // either at the fingertip or somewhere on the fresh part of the trail
        const p = Math.random() < 0.6 || f.pts.length < 4 ? f : f.pts[Math.floor(rand(f.pts.length * 0.5, f.pts.length))];
        arc(p.x, p.y, f.dx, f.dy, rand(10, 18 + clamp01(f.speed / 900) * 20));
      }
    }
  }

  // ------------------------------------------------------------------ drawing
  function grow(x, y, r) {
    if (!box.ok) {
      box.x0 = x - r; box.y0 = y - r; box.x1 = x + r; box.y1 = y + r;
      box.ok = true;
      return;
    }
    if (x - r < box.x0) box.x0 = x - r;
    if (y - r < box.y0) box.y0 = y - r;
    if (x + r > box.x1) box.x1 = x + r;
    if (y + r > box.y1) box.y1 = y + r;
  }

  function spriteAt(img, x, y, size, alpha) {
    if (alpha <= 0.004 || size <= 0.5) return;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    grow(x, y, size / 2);
  }

  // Trail points resampled at an even spacing (for glow sprites and the flow pulses).
  const even = [];
  function resample(pts, now, spacing) {
    even.length = 0;
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (seg < 0.01) continue;
      let d = carry;
      while (d <= seg) {
        const k = d / seg;
        const t = a.t + (b.t - a.t) * k;
        even.push(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, clamp01(1 - (now - t) / TRAIL_LIFE));
        d += spacing;
      }
      carry = d - seg;
    }
    return even;
  }

  function drawTrail(f, now) {
    const pts = f.pts;
    const head = f.down ? { x: f.x, y: f.y, t: now } : null;
    const all = head ? pts.concat(head) : pts;
    if (all.length < 2) return;
    const scale = f.pen ? 0.6 : 1;
    const fade = f.down ? 1 : clamp01(1 - (now - f.releasedAt) / TRAIL_LIFE);

    // 1 · soft glow tube: overlapping additive sprites, tapering toward the tail
    const ev = resample(all, now, GLOW_STEP);
    for (let i = 0; i < ev.length; i += 3) {
      const a = ev[i + 2] * fade;
      if (a <= 0.02) continue;
      spriteAt(RED, ev[i], ev[i + 1], (14 + 38 * a) * scale, 0.11 * a + 0.05 * a * a);
    }

    // 2 · filament: red body and a hot core, per segment (butt caps: no additive beads)
    ctx.lineCap = 'butt';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgb(255, 58, 50)' : 'rgb(255, 226, 220)';
      for (let i = 1; i < all.length; i++) {
        const p = all[i - 1];
        const q = all[i];
        const a = clamp01(1 - (now - (p.t + q.t) / 2) / TRAIL_LIFE) * fade;
        if (a <= 0.02) continue;
        ctx.globalAlpha = pass === 0 ? 0.62 * a : 0.9 * a * a;
        ctx.lineWidth = (pass === 0 ? 1.2 + 3.4 * a : 0.5 + 1.3 * a) * scale;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }

    // 3 · crackling strands: jagged lines around the fresh part, re-rolled every frame
    const from = Math.floor(all.length * 0.3);
    if (all.length - from >= 3) {
      ctx.lineCap = 'round';
      const amp = (2 + clamp01(f.speed / 900) * 4.5) * scale;
      for (let s = 0; s < 2; s++) {
        ctx.strokeStyle = s === 0 ? 'rgb(255, 92, 80)' : 'rgb(255, 180, 170)';
        ctx.globalAlpha = (s === 0 ? 0.55 : 0.35) * fade;
        ctx.lineWidth = s === 0 ? 1 : 0.7;
        ctx.beginPath();
        for (let i = from; i < all.length; i++) {
          const p = all[i];
          const q = all[Math.min(all.length - 1, i + 1)];
          const o = all[Math.max(0, i - 1)];
          let nx = -(q.y - o.y);
          let ny = q.x - o.x;
          const nl = Math.hypot(nx, ny) || 1;
          nx /= nl;
          ny /= nl;
          const k = (i - from) / (all.length - from);
          const off = (Math.random() - 0.5) * 2 * amp * Math.sin(Math.PI * Math.min(1, k * 1.1));
          if (i === from) ctx.moveTo(p.x + nx * off, p.y + ny * off);
          else ctx.lineTo(p.x + nx * off, p.y + ny * off);
        }
        ctx.stroke();
      }
    }

    // 4 · current pulses flowing from the tail toward the finger
    const n = ev.length / 3;
    if (n > 6) {
      for (let k = 0; k < 3; k++) {
        const u = (now * 1.9 + k / 3) % 1;
        const j = Math.min(n - 1, Math.floor(u * u * n)) * 3; // accelerate toward the head
        const a = ev[j + 2] * fade;
        spriteAt(HOT, ev[j], ev[j + 1], (8 + 16 * a) * scale, 0.55 * a);
      }
    }
  }

  function drawHead(f, now) {
    const scale = f.pen ? 0.6 : 1;
    if (f.down) {
      const age = now - f.t0;
      const breathe = 1 + Math.sin(now * 9) * 0.06 + (Math.random() - 0.5) * 0.08;
      const inA = clamp01(age / 0.12);
      spriteAt(RED, f.x, f.y, 76 * scale * breathe, 0.34 * inA);
      spriteAt(HOT, f.x, f.y, 24 * scale * breathe, 0.85 * inA);
    } else {
      const k = clamp01((now - f.releasedAt) / 0.32);
      if (k >= 1) return;
      const e = easeOut(k);
      spriteAt(RED, f.x, f.y, (76 + 60 * e) * scale, 0.34 * (1 - k));
      spriteAt(HOT, f.x, f.y, (24 - 14 * e) * scale, 0.85 * (1 - k) * (1 - k));
    }
  }

  function ring(x, y, r, width, alpha) {
    if (alpha <= 0.004 || r <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    grow(x, y, r + width);
  }

  function drawRings(now) {
    ctx.lineCap = 'butt';
    for (const r of rings) {
      const age = now - r.t0;
      if (r.type === 'down') {
        const k = clamp01(age / 0.7);
        const e = easeOut(k);
        const fade = Math.pow(1 - k, 1.4);
        const R = (8 + 54 * e) * r.s;
        ctx.strokeStyle = 'rgb(255, 44, 38)';
        ring(r.x, r.y, R, (2 + 10 * (1 - k)) * r.s, 0.12 * fade);
        ctx.strokeStyle = 'rgb(255, 84, 72)';
        ring(r.x, r.y, R, (0.6 + 1.8 * (1 - k)) * r.s, 0.9 * fade);
        // inner technical ring: dashed, turning, a little later
        const k2 = clamp01((age - 0.06) / 0.55);
        if (k2 > 0 && k2 < 1) {
          const e2 = easeOut(k2);
          ctx.save();
          ctx.setLineDash([2.5 * r.s, 5 * r.s]);
          ctx.lineDashOffset = -age * 40;
          ctx.strokeStyle = 'rgb(255, 196, 188)';
          ring(r.x, r.y, (5 + 30 * e2) * r.s, 1.1 * r.s, 0.55 * (1 - k2));
          ctx.restore();
        }
        const kf = clamp01(age / 0.32);
        spriteAt(HOT, r.x, r.y, (30 + 70 * easeOut(kf)) * r.s, 0.7 * (1 - kf) * (1 - kf));
      } else if (r.type === 'up') {
        const k = clamp01(age / 0.55);
        const e = easeOut(k);
        ctx.strokeStyle = 'rgb(255, 70, 60)';
        ring(r.x, r.y, (10 + 30 * e) * r.s, 1 * r.s, 0.32 * (1 - k));
        spriteAt(RED, r.x, r.y, (40 + 70 * e) * r.s, 0.22 * (1 - k));
      } else {
        // reduced motion: one soft, short ring
        const k = clamp01(age / 0.42);
        const e = easeOut(k);
        ctx.strokeStyle = 'rgb(255, 90, 80)';
        ring(r.x, r.y, (8 + 26 * e) * r.s, 1.4 * r.s, 0.45 * (1 - k));
        spriteAt(RED, r.x, r.y, (34 + 30 * e) * r.s, 0.18 * (1 - k));
      }
    }
  }

  function drawSparks() {
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgb(255, 64, 52)' : 'rgb(255, 232, 224)';
      for (const s of sparks) {
        const k = s.age / s.life;
        const hot = s.hot && k < 0.4;
        if ((pass === 1) !== hot) continue;
        const a = Math.pow(1 - k, 1.2);
        const tx = s.x - s.vx * 0.024;
        const ty = s.y - s.vy * 0.024;
        ctx.globalAlpha = a * (hot ? 1 : 0.85);
        ctx.lineWidth = s.w * (0.5 + 0.7 * (1 - k));
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        grow(s.x, s.y, 3);
        grow(tx, ty, 3);
      }
    }
  }

  function drawArcs() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgb(255, 50, 42)' : 'rgb(255, 222, 214)';
      ctx.lineWidth = pass === 0 ? 3.6 : 1;
      for (const a of arcs) {
        const k = a.age / a.life;
        const flicker = 0.55 + Math.random() * 0.45;
        ctx.globalAlpha = (pass === 0 ? 0.26 : 0.95) * (1 - k * k) * flicker;
        const p = a.pts;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.stroke();
        if (pass === 0) {
          grow(p[0], p[1], 4);
          grow(p[p.length - 2], p[p.length - 1], 4);
          for (let i = 2; i < p.length - 2; i += 2) grow(p[i], p[i + 1], 4);
        }
      }
    }
    ctx.lineJoin = 'round';
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    if (prev.ok) {
      ctx.clearRect(prev.x0 - 2, prev.y0 - 2, prev.x1 - prev.x0 + 4, prev.y1 - prev.y0 + 4);
    } else {
      ctx.clearRect(0, 0, cssW, cssH);
    }
    box.ok = false;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    for (const f of fingers.values()) drawTrail(f, now);
    drawArcs();
    drawSparks();
    drawRings(now);
    for (const f of fingers.values()) drawHead(f, now);
    ctx.globalAlpha = 1;
    prev.x0 = box.x0; prev.y0 = box.y0; prev.x1 = box.x1; prev.y1 = box.y1;
    prev.ok = box.ok;
    if (!box.ok) {
      // nothing drawn: keep the next clear cheap
      prev.ok = true;
      prev.x0 = prev.y0 = prev.x1 = prev.y1 = 0;
    }
  }

  function update(dt, time) {
    if (!active) return false;
    if (!enabled()) {
      reset();
      return false;
    }
    const now = time / 1000;
    simulate(dt, now);
    const alive = fingers.size > 0 || sparks.length > 0 || arcs.length > 0 || rings.length > 0;
    if (!alive) {
      show(false);
      return false;
    }
    draw(now);
    return true;
  }

  return { start, move, end, reset, update, canvas };
}
