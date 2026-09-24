// Konstruktion scene: blueprint frame fades with the 3D line drawing, stat counters run
// once, and on phones / short landscape screens the panel switches from copy (phase A) to
// figures (phase B).
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { $, $$, smoothstep, isCollapsed } from './util.js';
import { countUp, zeroCounters } from './counters.js';

export function initKonstruktion() {
  const section = document.getElementById('konstruktion');
  if (!section) return;
  const bp = $('.bp', section);
  const counters = $$('.stats [data-count]', section);
  let counted = false;
  let phaseB = false;

  zeroCounters(counters);
  const runCounters = () => {
    if (counted) return;
    counted = true;
    countUp(counters, { duration: 1.9, stagger: 0.09 });
  };

  function update(p) {
    // matches the director: blueprint look ramps in over the first quarter
    const o = smoothstep(0.06, 0.24, p) * (1 - smoothstep(0.93, 1, p));
    bp?.style.setProperty('--bp', o.toFixed(3));
    const b = p >= 0.46;
    if (b !== phaseB) {
      phaseB = b;
      section.classList.toggle('is-phase-b', b);
    }
    if (isCollapsed() ? b : p > 0) runCounters();
  }

  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => update(self.progress),
    onRefresh: (self) => update(self.progress),
  });
  // desktop: the figures come into view shortly before the scene pins
  ScrollTrigger.create({
    trigger: section,
    start: 'top 12%',
    once: true,
    onEnter: () => {
      if (!isCollapsed()) runCounters();
    },
  });
}
