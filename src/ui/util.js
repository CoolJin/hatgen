// Small shared helpers for the UI modules.
import { reducedMotion } from '../core/env.js';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const finePointer = () => window.matchMedia('(pointer: fine)').matches;

// Text-below-product layout (phones + portrait tablets). Mirrors the CSS media query.
export const STACKED_MQ = '(max-width: 767px), (max-width: 1180px) and (max-aspect-ratio: 4/5)';
export const isStacked = () => window.matchMedia(STACKED_MQ).matches;

// Pinned panels show one step (and one Konstruktion phase) at a time: the stacked layout plus
// short landscape screens. Mirrors the "COLLAPSED" media block in sections.css.
export const COLLAPSED_MQ = `${STACKED_MQ}, (min-width: 768px) and (max-height: 480px)`;
export const isCollapsed = () => window.matchMedia(COLLAPSED_MQ).matches;

// Absolute document Y of an element (not affected by sticky offsets of its own ancestors
// when called on a non-sticky element such as a section).
export function docTop(el) {
  return el.getBoundingClientRect().top + window.scrollY;
}

// Smooth scroll to a Y position or element, via Lenis when present.
export function scrollToTarget(target, { offset = 0, immediate = false } = {}) {
  const lenis = window.__lenis;
  const y = typeof target === 'number' ? target : target === document.body ? 0 : docTop(target) + offset;
  if (lenis) {
    const dist = Math.abs(y - window.scrollY) / Math.max(1, window.innerHeight);
    const duration = Math.min(2.4, Math.max(0.9, 0.7 + dist * 0.07));
    lenis.scrollTo(y, {
      immediate: immediate || reducedMotion,
      duration,
      easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
      force: true,
    });
  } else {
    window.scrollTo({ top: y, behavior: immediate || reducedMotion ? 'auto' : 'smooth' });
  }
}

// German number formatting with a fixed number of decimals.
const fmtCache = new Map();
export function fmtDe(n, dec = 0) {
  let f = fmtCache.get(dec);
  if (!f) {
    f = new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    fmtCache.set(dec, f);
  }
  return f.format(n);
}
