// Animated number counters: <span data-count="6.5" data-dec="1">6,5</span>
import gsap from 'gsap';
import { fmtDe } from './util.js';
import { reducedMotion } from '../core/env.js';

function read(el) {
  return { to: parseFloat(el.dataset.count), dec: parseInt(el.dataset.dec || '0', 10) };
}

// Put counters at 0 (only when they will be animated later).
export function zeroCounters(els) {
  if (reducedMotion) return;
  els.forEach((el) => {
    const { dec } = read(el);
    el.textContent = fmtDe(0, dec);
  });
}

// Returns a timeline counting every element from 0 to its data-count value.
export function countUp(els, { duration = 1.6, stagger = 0.06, ease = 'power3.out' } = {}) {
  const tl = gsap.timeline();
  els.forEach((el, i) => {
    const { to, dec } = read(el);
    if (!Number.isFinite(to)) return;
    if (reducedMotion) {
      el.textContent = fmtDe(to, dec);
      return;
    }
    const o = { v: 0 };
    tl.to(
      o,
      {
        v: to,
        duration,
        ease,
        onUpdate: () => {
          el.textContent = fmtDe(o.v, dec);
        },
      },
      i * stagger,
    );
  });
  return tl;
}
