// Magnetic buttons (desktop, fine pointer): the button leans toward the cursor,
// its label a little further for depth.
import gsap from 'gsap';
import { reducedMotion } from '../core/env.js';
import { $, $$, finePointer } from './util.js';

export function initMagnetic() {
  if (reducedMotion || !finePointer()) return;
  $$('[data-magnetic]').forEach((el) => {
    const label = $('.btn__label', el);
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3' });
    const lx = label ? gsap.quickTo(label, 'x', { duration: 0.6, ease: 'power3' }) : null;
    const ly = label ? gsap.quickTo(label, 'y', { duration: 0.6, ease: 'power3' }) : null;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      xTo(dx * 0.2);
      yTo(dy * 0.32);
      lx?.(dx * 0.08);
      ly?.(dy * 0.12);
    });
    el.addEventListener('pointerleave', () => {
      xTo(0);
      yTo(0);
      lx?.(0);
      ly?.(0);
    });
  });
}
