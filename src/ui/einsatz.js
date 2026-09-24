// Einsatzbereiche: pinned horizontal rail on desktop (sticky + translateX from scroll),
// plain grid on smaller screens / reduced motion. Cards tilt toward the pointer.
// The section height follows the travel distance of the rail, so one pixel of scrolling
// moves the rail by roughly one pixel (no "stuck" feeling on wide screens).
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { reducedMotion } from '../core/env.js';
import { $, $$, finePointer } from './util.js';

const SCROLL_PER_PX = 1.15;
// The heading block is the rail's first panel: hold the rail still for this share of a
// viewport height after the section pins, so the heading can be read before it slides away.
const DWELL_VH = 0.3;
const HORIZONTAL_MQ = '(min-width: 1024px)';

export function initEinsatz() {
  const section = document.getElementById('einsatz');
  if (!section) return;
  const rail = $('.einsatz__rail', section);
  const cards = $$('.card', section);
  const progress = $('.einsatz__progress', section);
  const count = $('.einsatz__count b', section);
  if (!rail) return;

  if (!reducedMotion) initRail(section, rail, cards, progress, count);

  if (reducedMotion || !finePointer()) return;
  cards.forEach((card) => {
    gsap.set(card, { transformPerspective: 1100 });
    const rx = gsap.quickTo(card, 'rotationX', { duration: 0.7, ease: 'power3' });
    const ry = gsap.quickTo(card, 'rotationY', { duration: 0.7, ease: 'power3' });
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      ry((x - 0.5) * 9);
      rx((0.5 - y) * 7);
      card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    });
    card.addEventListener('pointerleave', () => {
      rx(0);
      ry(0);
    });
  });
}

// One ScrollTrigger for the page's lifetime; the horizontal mode is switched by a media query
// listener. (ScrollTriggers created later, e.g. in a gsap.matchMedia() callback when a tablet
// is rotated, make ScrollTrigger lose the scroll position and jump to the top.)
function initRail(section, rail, cards, progress, count) {
  const mq = window.matchMedia(HORIZONTAL_MQ);
  const setX = gsap.quickSetter(rail, 'x', 'px');
  let horizontal = false;
  let distance = 0;
  let dwell = 0;
  let shown = -1;

  function setHeight() {
    if (!horizontal) return;
    distance = Math.max(0, rail.scrollWidth - document.documentElement.clientWidth);
    dwell = Math.round(window.innerHeight * DWELL_VH);
    section.style.height = `${Math.round(window.innerHeight + dwell + distance * SCROLL_PER_PX)}px`;
  }

  function render(self) {
    if (!horizontal) return;
    const p = self.progress;
    setX(-distance * p);
    progress?.style.setProperty('--p', p.toFixed(4));
    const i = Math.min(cards.length - 1, Math.floor(p * cards.length));
    if (i !== shown && count) {
      shown = i;
      count.textContent = String(i + 1).padStart(2, '0');
    }
  }

  function apply() {
    const next = mq.matches;
    if (next === horizontal) return;
    horizontal = next;
    section.classList.toggle('is-horizontal', next);
    if (next) {
      setHeight();
    } else {
      section.style.removeProperty('height');
      gsap.set(rail, { clearProps: 'transform' });
      dwell = 0;
    }
  }

  apply();
  ScrollTrigger.addEventListener('refreshInit', setHeight);
  ScrollTrigger.create({
    trigger: section,
    // the rail starts moving once the pinned section has scrolled past the dwell
    start: () => `top top-=${dwell}`,
    end: 'bottom bottom',
    onUpdate: render,
    onRefresh: render,
  });
  mq.addEventListener('change', () => {
    apply();
    ScrollTrigger.refresh();
  });
}
