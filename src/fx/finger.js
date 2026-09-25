// Finger FX: an electric, brand-red interaction drawn at the finger (touch and pen) on a fixed
// full-screen overlay canvas (pointer-events: none, so it never blocks scrolling or taps).
// The intensity follows the gesture, so reading and scrolling stay calm:
//   touch down   a contact ring that opens beyond the thumb pad (20 to 50 px) and a soft halo
//   tap          the full show where the finger lifts: HUD ring, flash, spark burst and two
//                fine forked discharges leaving the ring
//   swipe lock   the same show where the drag turns into "turn the product"
//   finger moves luminous trail that fades like current flowing through a wire, pulses
//                travelling toward the finger, sparks and now and then a fine discharge
//   scrolling    once the page scrolls under the finger: a dimmer trail, no discharges, few sparks
//   release      the contact glow dissipates, a few slow embers drift off
// Reduced motion: only a soft, short ripple. Everything is drawn additively ('lighter') into
// the overlay, which composites normally over the page (no CSS blend group), and only the
// region drawn in the previous frame is cleared. The canvas is hidden while idle.
// Time: all ages run on one simulated clock (advanced by the loop's capped dt), so a janky
// frame slows everything alike instead of dropping the ring while the sparks are young.
import { reducedMotion } from '../core/env.js';

const TAU = Math.PI * 2;
const DPR_MAX = 2;
const MAX_PIXELS = 4.2e6; // backing store cap in device pixels (large tablets)
const MAX_FINGERS = 3; // fingers down at once
const MAX_SPARKS = 150;
const MAX_ARCS = 6; // fine forked discharges alive at once
const MAX_POINTS = 48; // raw input samples per finger (no subdivision in the buffer)
const TRAIL_LIFE = 0.38; // s a trail sample stays visible
const MAX_LEN = 380; // px of visible trail (pen x0.6); the last TAIL of it fades out
const TAIL = 0.3;
const SEG_PX = 5; // px between the spline points drawn between two samples
const SEG_MAX = 10;
const GLOW_STEP = 6; // px between glow sprites along the trail
const ROLL = 0.05; // s, flicker re-roll interval (not every frame: no shimmer at 120 Hz)
const TAP_MS = 250; // a touch shorter than this ...
const TAP_PX = 10; // ... that moved less than this is a tap
const STALE_MS = 8000; // a finger without any event for this long is released
const SCROLL = { trail: 0.6, sparks: 0.3 }; // scrolling variant
const BUCKETS = 10; // alpha levels the trail filament is batched into (one path each)
const SPARK_AGES = 4; // age levels the sparks are batched into

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const smooth = (t) => t * t * (3 - 2 * t);
// cheap deterministic noise 0..1
const hash = (x) => {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

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
  let clock = 0; // simulated seconds
  let uid = 0;
  let roll = 0; // flicker re-roll counter
  let rollAt = 0;
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

  // A fine discharge: a tapered three-segment filament (slight bends, no zigzag) with a
  // short fork, leaving (x, y) in direction ang. Lives for a flicker (0.09 to 0.15 s).
  function arc(x, y, ang, len) {
    if (arcs.length >= MAX_ARCS) return;
    const pts = [x, y];
    const seg = len / 3;
    let a = ang;
    let px = x;
    let py = y;
    for (let i = 0; i < 3; i++) {
      a += rand(-0.42, 0.42);
      const l = seg * rand(0.8, 1.2);
      px += Math.cos(a) * l;
      py += Math.sin(a) * l;
      pts.push(px, py);
    }
    let fork = null;
    if (Math.random() < 0.7) {
      const fa = Math.atan2(pts[5] - pts[3], pts[4] - pts[2]) + (Math.random() < 0.5 ? 1 : -1) * rand(0.5, 0.95);
      fork = [pts[2] + Math.cos(fa) * seg * 0.9, pts[3] + Math.sin(fa) * seg * 0.9];
    }
    arcs.push({ pts, fork, age: 0, life: rand(0.09, 0.15), seed: Math.random() * 100 });
  }

  // The full touch show: HUD ring, flash, spark burst and two discharges off the ring
  // (outside the thumb pad, where they can be seen).
  function flourish(x, y, pen) {
    const sc = pen ? 0.65 : 1;
    rings.push({ x, y, t0: clock, type: 'down', s: sc });
    burst(x, y, pen ? 7 : 13, 150, 440);
    const a0 = rand(0, TAU);
    for (let i = 0; i < 2; i++) {
      const a = a0 + i * Math.PI + rand(-0.5, 0.5);
      arc(x + Math.cos(a) * 30 * sc, y + Math.sin(a) * 30 * sc, a, rand(10, 15) * sc);
    }
  }

  // ------------------------------------------------------------------ input
  function start(id, x, y, kind, time = performance.now(), sy = window.scrollY) {
    if (!enabled()) return;
    let down = 0;
    let oldest = null;
    for (const [k, f] of fingers) {
      if (f.down) down++;
      else if (!oldest) oldest = k;
    }
    if (down >= MAX_FINGERS) return;
    // released fingers still fading out never block a new touch
    if (fingers.size >= MAX_FINGERS + 2 && oldest) fingers.delete(oldest);
    // a reused touch identifier: the old trail keeps fading under another key
    const old = fingers.get(id);
    if (old) {
      fingers.delete(id);
      if (!old.down) fingers.set(`${id}~${++uid}`, old);
    }
    ensureSize();
    const pen = kind === 'pen';
    if (reducedMotion) {
      rings.push({ x, y, t0: clock, type: 'soft', s: pen ? 0.7 : 1 });
    } else {
      fingers.set(id, {
        x, y, x0: x, y0: y, pen, down: true, mode: 'touch', sy, travel: 0,
        pts: [{ x, y, t: clock }],
        lastT: time, tw0: time, wall: performance.now(),
        speed: 0, dx: 0, dy: 0, sparkAcc: 0, arcAcc: 0, releasedAt: 0, t0: clock,
      });
      rings.push({ x, y, t0: clock, type: 'contact', s: pen ? 0.7 : 1 });
    }
    show(true);
    loop.wake();
  }

  function move(id, x, y, time, sy = window.scrollY) {
    const f = fingers.get(id);
    if (!f || !f.down) return;
    f.wall = performance.now();
    // the page scrolls under the finger: this is a scroll, not a play with the light
    if (f.mode === 'touch' && Math.abs(sy - f.sy) > 2) f.mode = 'scroll';
    const mx = x - f.x;
    const my = y - f.y;
    const d = Math.hypot(mx, my);
    if (d < 0.5) return;
    f.travel = Math.max(f.travel, Math.hypot(x - f.x0, y - f.y0));
    const dt = Math.max((time - f.lastT) / 1000, 0.008);
    f.lastT = time;
    f.speed += (Math.min(d / dt, 6000) - f.speed) * 0.4;
    f.dx = mx / d;
    f.dy = my / d;
    const last = f.pts[f.pts.length - 1];
    if (Math.hypot(x - last.x, y - last.y) >= 2) {
      f.pts.push({ x, y, t: clock });
      if (f.pts.length > MAX_POINTS) f.pts.splice(0, f.pts.length - MAX_POINTS);
    }
    f.x = x;
    f.y = y;
    loop.wake();
  }

  function end(id, x, y, cancelled, time = performance.now()) {
    const f = fingers.get(id);
    if (!f || !f.down) return;
    f.down = false;
    f.releasedAt = clock;
    if (!cancelled) {
      const tap = f.mode === 'touch' && time - f.tw0 < TAP_MS && f.travel < TAP_PX;
      if (tap) {
        flourish(f.x, f.y, f.pen);
      } else if (f.mode === 'scroll') {
        burst(f.x, f.y, 2, 30, 110, false);
      } else {
        rings.push({ x: f.x, y: f.y, t0: clock, type: 'up', s: f.pen ? 0.65 : 1 });
        burst(f.x, f.y, f.pen ? 3 : 6, 40, 150, false);
      }
    }
    loop.wake();
  }

  // The swipe module took the drag over (it turns the product now): the full show there.
  function lock(id, x, y) {
    const f = fingers.get(id);
    if (!f || !f.down || reducedMotion) return;
    f.mode = 'swipe';
    flourish(x, y, f.pen);
    loop.wake();
  }

  // The browser started a native pan: every finger that is not turning the product scrolls.
  function native() {
    for (const f of fingers.values()) if (f.down && f.mode === 'touch') f.mode = 'scroll';
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
  const RING_LIFE = { contact: 0.45, down: 0.62, up: 0.5, soft: 0.42 };

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
      if (now - rings[i].t0 > RING_LIFE[rings[i].type]) rings.splice(i, 1);
    }
    const wall = performance.now();
    for (const [id, f] of fingers) {
      let cut = 0;
      while (cut < f.pts.length - 1 && now - f.pts[cut].t > TRAIL_LIFE) cut++;
      if (cut) f.pts.splice(0, cut);
      // safety: a lost touchend (focus change, system gesture) never leaves a finger behind
      if (f.down && wall - f.wall > STALE_MS) {
        f.down = false;
        f.releasedAt = now;
      }
      if (!f.down) {
        if (now - f.releasedAt > TRAIL_LIFE + 0.1) fingers.delete(id);
        continue;
      }
      const scroll = f.mode === 'scroll';
      // speed decays while the finger rests (no move events arrive then)
      f.speed *= Math.exp(-dt * 7);
      const sp = clamp01((f.speed - 140) / 1100);
      f.sparkAcc += sp * 30 * (scroll ? SCROLL.sparks : 1) * dt;
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
      if (scroll) continue; // no discharges while scrolling
      // now and then a fine discharge: off the fresh trail while moving, off the rim of the
      // thumb pad at rest (the fingertip itself is hidden under the finger)
      f.arcAcc += (0.4 + clamp01(f.speed / 800) * 1.6) * dt;
      while (f.arcAcc >= 1) {
        f.arcAcc -= 1;
        const side = Math.random() < 0.5 ? 1 : -1;
        const sc = f.pen ? 0.6 : 1;
        if (f.pts.length >= 5 && f.speed > 120) {
          const p = f.pts[Math.floor(rand(f.pts.length * 0.35, f.pts.length * 0.75))];
          arc(p.x, p.y, Math.atan2(f.dy, f.dx) + side * rand(1.1, 2.0), rand(9, 14) * sc);
        } else {
          const a = rand(0, TAU);
          arc(f.x + Math.cos(a) * 28 * sc, f.y + Math.sin(a) * 28 * sc, a + side * rand(0, 0.5), rand(8, 12) * sc);
        }
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
    if (alpha <= 0.02 || size <= 0.5) return;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    grow(x, y, size / 2);
  }

  // The trail as a smooth spline through the raw samples (Catmull-Rom), built at draw time:
  // x, y, alpha (age x length taper). Tail first, head last.
  const SX = new Float32Array(MAX_POINTS * SEG_MAX + 4);
  const SY = new Float32Array(SX.length);
  const SA = new Float32Array(SX.length);
  const SD = new Float32Array(SX.length); // arc length from the tail
  const SB = new Int8Array(SX.length); // alpha bucket of the segment ending at i (-1: skipped)
  let sn = 0;

  function spline(all, now, fade, scale) {
    sn = 0;
    const n = all.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = all[i > 0 ? i - 1 : 0];
      const p1 = all[i];
      const p2 = all[i + 1];
      const p3 = all[i + 2 < n ? i + 2 : n - 1];
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const m = Math.min(SEG_MAX, Math.max(1, Math.ceil(len / SEG_PX)));
      for (let j = 0; j < m; j++) {
        const t = j / m;
        const t2 = t * t;
        const t3 = t2 * t;
        const a = -0.5 * t3 + t2 - 0.5 * t;
        const b = 1.5 * t3 - 2.5 * t2 + 1;
        const c = -1.5 * t3 + 2 * t2 + 0.5 * t;
        const d = 0.5 * t3 - 0.5 * t2;
        SX[sn] = a * p0.x + b * p1.x + c * p2.x + d * p3.x;
        SY[sn] = a * p0.y + b * p1.y + c * p2.y + d * p3.y;
        SA[sn] = p1.t + (p2.t - p1.t) * t; // time, turned into alpha below
        sn++;
      }
    }
    const last = all[n - 1];
    SX[sn] = last.x;
    SY[sn] = last.y;
    SA[sn] = last.t;
    sn++;
    // arc length, then alpha = age fade x length taper (the tail always fades out to zero)
    SD[0] = 0;
    for (let i = 1; i < sn; i++) SD[i] = SD[i - 1] + Math.hypot(SX[i] - SX[i - 1], SY[i] - SY[i - 1]);
    const total = SD[sn - 1];
    const vis = Math.min(total, MAX_LEN * scale);
    for (let i = 0; i < sn; i++) {
      const fromHead = total - SD[i];
      const u = vis > 0 ? 1 - fromHead / vis : 1; // 1 at the head, 0 where the visible trail ends
      const taper = u <= 0 ? 0 : u >= TAIL ? 1 : smooth(u / TAIL);
      SA[i] = clamp01(1 - (now - SA[i]) / TRAIL_LIFE) * taper * fade;
    }
    return total;
  }

  // Spline points resampled at an even spacing (glow sprites and the flow pulses).
  const even = [];
  function resample(spacing) {
    even.length = 0;
    let carry = 0;
    for (let i = 1; i < sn; i++) {
      const seg = SD[i] - SD[i - 1];
      if (seg < 0.01) continue;
      let d = carry;
      while (d <= seg) {
        const k = d / seg;
        even.push(SX[i - 1] + (SX[i] - SX[i - 1]) * k, SY[i - 1] + (SY[i] - SY[i - 1]) * k, SA[i - 1] + (SA[i] - SA[i - 1]) * k);
        d += spacing;
      }
      carry = d - seg;
    }
    return even;
  }

  function drawTrail(f, now) {
    const head = f.down ? { x: f.x, y: f.y, t: now } : null;
    const all = head ? f.pts.concat(head) : f.pts;
    if (all.length < 2) return;
    const scale = f.pen ? 0.6 : 1;
    const scroll = f.mode === 'scroll';
    const fade = (f.down ? 1 : clamp01(1 - (now - f.releasedAt) / TRAIL_LIFE)) * (scroll ? SCROLL.trail : 1);
    spline(all, now, fade, scale);
    if (sn < 2) return;

    // 1 · soft glow tube: overlapping additive sprites, tapering toward the tail
    const ev = resample(GLOW_STEP);
    for (let i = 0; i < ev.length; i += 3) {
      const a = ev[i + 2];
      if (a <= 0.02) continue;
      spriteAt(RED, ev[i], ev[i + 1], (14 + 38 * a) * scale, 0.14 * a + 0.065 * a * a);
    }

    // 2 · filament: red body and a hot core. Batched: each alpha level is one path (runs of
    //     neighbouring segments stay connected) and one stroke; butt caps, no additive beads.
    ctx.lineCap = 'butt';
    for (let i = 1; i < sn; i++) {
      const a = (SA[i - 1] + SA[i]) * 0.5;
      SB[i] = a <= 0.02 ? -1 : Math.min(BUCKETS - 1, Math.floor(a * BUCKETS));
      if (SB[i] >= 0) grow(SX[i], SY[i], 1.2 + 3.4 * a + 1);
    }
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgb(255, 58, 50)' : 'rgb(255, 226, 220)';
      for (let b = 0; b < BUCKETS; b++) {
        let any = false;
        let run = false;
        ctx.beginPath();
        for (let i = 1; i < sn; i++) {
          if (SB[i] !== b) {
            run = false;
            continue;
          }
          if (!run) ctx.moveTo(SX[i - 1], SY[i - 1]);
          ctx.lineTo(SX[i], SY[i]);
          run = true;
          any = true;
        }
        if (!any) continue;
        const a = (b + 0.5) / BUCKETS;
        ctx.globalAlpha = pass === 0 ? 0.62 * a : 0.9 * a * a;
        ctx.lineWidth = (pass === 0 ? 1.2 + 3.4 * a : 0.5 + 1.3 * a) * scale;
        ctx.stroke();
      }
    }

    // 3 · current pulses flowing from the tail toward the finger
    const n = ev.length / 3;
    if (n > 6) {
      for (let k = 0; k < 3; k++) {
        const u = (now * 1.9 + k / 3) % 1;
        const j = Math.min(n - 1, Math.floor(u * u * n)) * 3; // accelerate toward the head
        const a = ev[j + 2];
        spriteAt(HOT, ev[j], ev[j + 1], (8 + 16 * a) * scale, 0.55 * a);
      }
    }
  }

  function drawHead(f, now) {
    const scale = f.pen ? 0.6 : 1;
    const dim = f.mode === 'scroll' ? 0.7 : 1;
    if (f.down) {
      const age = now - f.t0;
      const breathe = 1 + Math.sin(now * 9) * 0.06 + (hash(roll * 1.31 + f.x0) - 0.5) * 0.08;
      const inA = clamp01(age / 0.12) * dim;
      spriteAt(RED, f.x, f.y, 76 * scale * breathe, 0.34 * inA);
      spriteAt(HOT, f.x, f.y, 24 * scale * breathe, 0.85 * inA);
    } else {
      const k = clamp01((now - f.releasedAt) / 0.32);
      if (k >= 1) return;
      const e = easeOut(k);
      spriteAt(RED, f.x, f.y, (76 + 60 * e) * scale, 0.34 * (1 - k) * dim);
      spriteAt(HOT, f.x, f.y, (24 - 14 * e) * scale, 0.85 * (1 - k) * (1 - k) * dim);
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
      const age = Math.max(0, now - r.t0);
      if (r.type === 'down') {
        // HUD ring: outer glow ring, crisp ring, turning dashed inner ring, flash
        const k = clamp01(age / RING_LIFE.down);
        const e = easeOut(k);
        const fade = Math.pow(1 - k, 1.4);
        const R = (8 + 42 * e) * r.s;
        ctx.strokeStyle = 'rgb(255, 44, 38)';
        ring(r.x, r.y, R, (2 + 9 * (1 - k)) * r.s, 0.12 * fade);
        ctx.strokeStyle = 'rgb(255, 84, 72)';
        ring(r.x, r.y, R, (0.6 + 1.8 * (1 - k)) * r.s, 0.9 * fade);
        const k2 = clamp01((age - 0.05) / 0.5);
        if (k2 > 0 && k2 < 1) {
          const e2 = easeOut(k2);
          ctx.save();
          ctx.setLineDash([2.5 * r.s, 5 * r.s]);
          ctx.lineDashOffset = -age * 40;
          ctx.strokeStyle = 'rgb(255, 196, 188)';
          ring(r.x, r.y, (28 + 18 * e2) * r.s, 1.1 * r.s, 0.55 * (1 - k2));
          ctx.restore();
        }
        const kf = clamp01(age / 0.3);
        spriteAt(HOT, r.x, r.y, (30 + 56 * easeOut(kf)) * r.s, 0.7 * (1 - kf) * (1 - kf));
      } else if (r.type === 'contact') {
        const k = clamp01(age / RING_LIFE.contact);
        const e = easeOut(k);
        if (r.s < 1) {
          // pen: a small ring, the tip does not hide it
          const kp = clamp01(age / 0.3);
          ctx.strokeStyle = 'rgb(255, 84, 72)';
          ring(r.x, r.y, (7 + 15 * easeOut(kp)) * r.s, (0.6 + 1.2 * (1 - kp)) * r.s, 0.75 * (1 - kp) * (1 - kp));
        } else {
          // finger: the ring opens from under the thumb pad (40 to 60 px) to well beyond it
          const R = 20 + 30 * e;
          ctx.strokeStyle = 'rgb(255, 44, 38)';
          ring(r.x, r.y, R, 1.5 + 4 * (1 - k), 0.16 * (1 - k));
          ctx.strokeStyle = 'rgb(255, 104, 92)';
          ring(r.x, r.y, R, 1.3 - 0.6 * k, 0.72 * (1 - k));
          spriteAt(RED, r.x, r.y, 88 + 26 * e, 0.14 * (1 - k));
        }
      } else if (r.type === 'up') {
        const k = clamp01(age / RING_LIFE.up);
        const e = easeOut(k);
        ctx.strokeStyle = 'rgb(255, 70, 60)';
        ring(r.x, r.y, (10 + 26 * e) * r.s, 1 * r.s, 0.3 * (1 - k));
        spriteAt(RED, r.x, r.y, (40 + 60 * e) * r.s, 0.2 * (1 - k));
      } else {
        // reduced motion: one soft, short ring
        const k = clamp01(age / RING_LIFE.soft);
        const e = easeOut(k);
        ctx.strokeStyle = 'rgb(255, 90, 80)';
        ring(r.x, r.y, (8 + 26 * e) * r.s, 1.4 * r.s, 0.45 * (1 - k));
        spriteAt(RED, r.x, r.y, (34 + 30 * e) * r.s, 0.18 * (1 - k));
      }
    }
  }

  // Sparks, batched: per colour pass, age level and width class one path and one stroke.
  function drawSparks() {
    if (!sparks.length) return;
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgb(255, 64, 52)' : 'rgb(255, 232, 224)';
      for (let lv = 0; lv < SPARK_AGES; lv++) {
        for (let wide = 0; wide < 2; wide++) {
          let any = false;
          ctx.beginPath();
          for (const s of sparks) {
            const k = s.age / s.life;
            const hot = s.hot && k < 0.4;
            if ((pass === 1) !== hot) continue;
            if (Math.min(SPARK_AGES - 1, Math.floor(k * SPARK_AGES)) !== lv || (s.w > 1.3 ? 1 : 0) !== wide) continue;
            const tx = s.x - s.vx * 0.024;
            const ty = s.y - s.vy * 0.024;
            ctx.moveTo(tx, ty);
            ctx.lineTo(s.x, s.y);
            grow(s.x, s.y, 3);
            grow(tx, ty, 3);
            any = true;
          }
          if (!any) continue;
          const k = (lv + 0.5) / SPARK_AGES;
          ctx.globalAlpha = Math.pow(1 - k, 1.2) * (pass === 1 ? 1 : 0.85);
          ctx.lineWidth = (wide ? 1.5 : 1.05) * (0.5 + 0.7 * (1 - k));
          ctx.stroke();
        }
      }
    }
  }

  // Discharges: a soft red glow and a pale core that tapers toward the tip (1.0, 0.75 and
  // 0.5 px segments) plus the fork, flickering on the re-roll clock.
  function drawArcs() {
    if (!arcs.length) return;
    ctx.lineCap = 'round';
    for (const a of arcs) {
      const k = a.age / a.life;
      const al = (1 - k * k) * (0.6 + hash(a.seed + roll * 7.7) * 0.4);
      const p = a.pts;
      spriteAt(RED, (p[0] + p[6]) * 0.5, (p[1] + p[7]) * 0.5, 30, 0.2 * al);
      ctx.strokeStyle = 'rgb(255, 212, 204)';
      for (let j = 0; j < 3; j++) {
        ctx.globalAlpha = al * (0.9 - j * 0.2);
        ctx.lineWidth = 1 - j * 0.25;
        ctx.beginPath();
        ctx.moveTo(p[j * 2], p[j * 2 + 1]);
        ctx.lineTo(p[j * 2 + 2], p[j * 2 + 3]);
        ctx.stroke();
        grow(p[j * 2 + 2], p[j * 2 + 3], 2);
      }
      if (a.fork) {
        ctx.globalAlpha = al * 0.55;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(p[2], p[3]);
        ctx.lineTo(a.fork[0], a.fork[1]);
        ctx.stroke();
        grow(a.fork[0], a.fork[1], 2);
      }
      grow(p[0], p[1], 2);
    }
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

  function update(dt) {
    if (!active) return false;
    if (!enabled()) {
      reset();
      return false;
    }
    clock += dt;
    if (clock - rollAt >= ROLL) {
      rollAt = clock;
      roll = (roll + 1) % 10000;
    }
    const now = clock;
    simulate(dt, now);
    const alive = fingers.size > 0 || sparks.length > 0 || arcs.length > 0 || rings.length > 0;
    if (!alive) {
      show(false);
      return false;
    }
    draw(now);
    return true;
  }

  return { start, move, end, lock, native, reset, update, canvas };
}
