// Scroll reveals: headings rise line by line out of masks, eyebrows / copy / blocks fade up.
//   data-reveal="lines"    SplitText lines with mask (headings)
//   data-reveal="fade"     fade + rise
//   data-reveal="stagger"  children fade + rise with stagger
// Only opacity is animated (never visibility), so links and buttons inside a block that has
// not been revealed yet stay reachable by keyboard; focusing one reveals its block at once.
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { reducedMotion } from '../core/env.js';
import { $$ } from './util.js';

// Elements inside a CSS-sticky container move with the scroll, so ScrollTrigger
// cannot measure them reliably: trigger on the (static) section instead.
// The offset of the element inside its sticky box is stable, so start when
// (section top + offset) reaches 88 % of the viewport.
function triggerFor(el) {
  const sticky = el.closest('.scene__sticky, .einsatz.is-horizontal .einsatz__sticky');
  if (sticky) {
    const section = sticky.closest('section') || sticky.parentElement;
    const offset = () => Math.max(0, el.getBoundingClientRect().top - sticky.getBoundingClientRect().top);
    return { trigger: section, start: () => `top+=${offset().toFixed(0)} 90%`, invalidateOnRefresh: true };
  }
  return { trigger: el, start: 'top 90%' };
}

export function initReveals() {
  const lines = $$('[data-reveal="lines"]');
  const fades = $$('[data-reveal="fade"]');
  const staggers = $$('[data-reveal="stagger"]');

  initFocusReveal();

  if (reducedMotion) {
    [...lines, ...fades, ...staggers].forEach((el) => {
      gsap.from(el, { opacity: 0, duration: 0.5, ease: 'power1.out', scrollTrigger: { ...triggerFor(el), once: true } });
    });
    return;
  }

  lines.forEach((el) => {
    const st = triggerFor(el);
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      reduceWhiteSpace: false, // keep &nbsp; between numbers and units
      linesClass: 'split-line',
      autoSplit: true,
      onSplit(self) {
        return gsap.from(self.lines, {
          yPercent: 112,
          rotate: 2.5,
          transformOrigin: '0% 100%',
          duration: 1.2,
          ease: 'expo.out',
          stagger: 0.1,
          scrollTrigger: { ...st, once: true },
        });
      },
    });
  });

  fades.forEach((el) => {
    const st = triggerFor(el);
    const isEyebrow = el.classList.contains('eyebrow');
    gsap.from(el, {
      opacity: 0,
      y: isEyebrow ? 12 : 26,
      duration: isEyebrow ? 1 : 1.15,
      delay: isEyebrow ? 0 : 0.12,
      ease: 'expo.out',
      scrollTrigger: { ...st, once: true },
    });
  });

  staggers.forEach((el) => {
    const st = triggerFor(el);
    gsap.from(el.children, {
      opacity: 0,
      y: 22,
      duration: 1.1,
      ease: 'expo.out',
      stagger: 0.08,
      delay: 0.15,
      scrollTrigger: { ...st, once: true },
    });
  });
}

// Keyboard users can tab into a block before its scroll reveal has fired (the browser scrolls
// it into view, but the reveal may be a frame late or, in a pinned scene, far away): finish
// the pending reveal tweens of the focused element's block immediately.
function initFocusReveal() {
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const block = t.closest('[data-reveal]');
    if (!block) return;
    const targets = [block, ...block.children];
    const split = block.querySelectorAll('.split-line');
    if (split.length) targets.push(...split);
    gsap.getTweensOf(targets).forEach((tw) => {
      if (tw.progress() >= 1) return;
      tw.progress(1);
      tw.scrollTrigger?.kill(false, true);
    });
  });
}
