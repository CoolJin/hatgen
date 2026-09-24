// Marquee strip: seamless loop, speed reacts subtly to scroll velocity.
import gsap from 'gsap';
import { reducedMotion } from '../core/env.js';
import { $ } from './util.js';

const BASE = 55; // px per second

export function initMarquee() {
  const root = $('.marquee');
  const track = root && $('.marquee__track', root);
  const group = track && $('.marquee__group', track);
  if (!group) return;

  let groupW = 0;
  function fill() {
    groupW = group.offsetWidth;
    const need = Math.ceil((window.innerWidth * 1.5) / Math.max(1, groupW)) + 1;
    while (track.children.length < need + 1) {
      const clone = group.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    }
  }
  fill();
  document.fonts?.ready.then(fill);
  window.addEventListener('resize', fill, { passive: true });
  if (reducedMotion) return;

  let x = 0;
  let boost = 0;
  let lastY = window.scrollY;
  let visible = false;
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  }).observe(root);

  gsap.ticker.add((_, deltaMs) => {
    const dt = Math.min(deltaMs, 50) / 1000;
    const y = window.scrollY;
    const v = dt > 0 ? Math.abs(y - lastY) / dt : 0;
    lastY = y;
    boost += (Math.min(v / 700, 3.5) - boost) * Math.min(1, dt * 4);
    if (!visible || !groupW) return;
    x -= BASE * (1 + boost) * dt;
    if (x <= -groupW) x += groupW;
    track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
  });
}
