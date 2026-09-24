// Hero entrance: header drops in, H1 characters rise out of their line masks,
// lead / buttons / facts follow, counters run. Also the hero scroll-away parallax.
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { reducedMotion } from '../core/env.js';
import { $, $$, STACKED_MQ } from './util.js';
import { countUp, zeroCounters } from './counters.js';

// Each gradient character carries its own background; align them so the
// gradient reads as one continuous sweep across the whole line.
function alignGradient(container, chars) {
  if (!container || !chars.length) return;
  const box = container.getBoundingClientRect();
  const w = Math.max(1, box.width);
  chars.forEach((c) => {
    const r = c.getBoundingClientRect();
    c.style.backgroundSize = `${w.toFixed(1)}px 100%`;
    c.style.backgroundPosition = `${(box.left - r.left).toFixed(1)}px 0`;
  });
}

// Scroll-away: the hero copy drifts up and fades as the camera starts to move (side by side
// layout only; stacked layouts keep the copy in place). One ScrollTrigger for the page's
// lifetime, gated by a media query listener: creating ScrollTriggers later (for example in a
// gsap.matchMedia() callback on rotation) makes ScrollTrigger lose the scroll position.
function initScrollAway(hero, content, hint) {
  const stacked = window.matchMedia(STACKED_MQ);
  // the hint's parts fade, not the hint itself: the intro owns the hint's opacity
  const hintParts = hint ? $$('.scroll-hint__label, .scroll-hint__line', hint) : [];
  const setY = content && gsap.quickSetter(content, 'yPercent');
  const setO = content && gsap.quickSetter(content, 'opacity');
  const setHint = hintParts.length && gsap.quickSetter(hintParts, 'opacity');
  let lastC = -1;
  let lastH = -1;
  let copy = null;
  let cue = null;

  function apply() {
    if (!copy || !cue) return;
    const on = !stacked.matches;
    const c = on ? copy.progress : 0;
    const h = on ? cue.progress : 0;
    if (setY && c !== lastC) {
      lastC = c;
      setY(-14 * c);
      setO(1 - c);
    }
    if (setHint && h !== lastH) {
      lastH = h;
      setHint(1 - h);
    }
  }

  const cb = { onUpdate: apply, onRefresh: apply };
  copy = ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom 15%', ...cb });
  cue = ScrollTrigger.create({ trigger: hero, start: 'top top', end: '12% top', ...cb });
  stacked.addEventListener('change', apply);
  apply();
}

export function createIntro() {
  const hero = document.getElementById('hero');
  const header = document.getElementById('header');
  if (!hero) return { play: () => gsap.timeline(), get played() { return true; } };

  const title = $('.hero__title', hero);
  const lines = $$('.hero__line', hero);
  const eyebrow = $('.hero__eyebrow', hero);
  const lead = $('.hero__lead', hero);
  const actions = $('.hero__actions', hero);
  const facts = $$('[data-intro-fact]', hero);
  const hint = $('.scroll-hint', hero);
  const counters = $$('[data-count]', hero);
  const content = $('.hero__content', hero);

  let tl = null;
  let played = false;
  let lineChars = [];

  if (reducedMotion) {
    gsap.set([header, title, eyebrow, lead, actions, hint, ...facts].filter(Boolean), { opacity: 0 });
  } else {
    lineChars = lines.map((line) => {
      const host = $('.grad', line) || line;
      // the H1 carries an sr-only copy and its visual lines are aria-hidden (index.html),
      // so the split adds no aria attributes of its own
      const split = SplitText.create(host, { type: 'words,chars', wordsClass: 'word', charsClass: 'char', aria: 'none' });
      if (host.classList.contains('grad')) {
        host.classList.add('is-split');
        const align = () => alignGradient(host, split.chars);
        align();
        document.fonts?.ready.then(align);
        window.addEventListener('resize', align, { passive: true });
      }
      return split.chars;
    });
    gsap.set(lineChars.flat(), { yPercent: 118, rotate: 6, transformOrigin: '0% 100%' });
    // opacity only (no visibility): header links and hero buttons stay keyboard reachable
    gsap.set([eyebrow, lead, actions].filter(Boolean), { opacity: 0, y: 26 });
    gsap.set(facts, { opacity: 0, y: 18 });
    gsap.set(hint, { opacity: 0, y: 12 });
    gsap.set(header, { opacity: 0, y: -24 });
    zeroCounters(counters);
    initScrollAway(hero, content, hint);
  }

  function play() {
    if (tl) return tl;
    played = true;
    tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    if (reducedMotion) {
      tl.to([header, eyebrow, title, lead, actions, ...facts, hint].filter(Boolean), {
        opacity: 1,
        duration: 0.6,
        stagger: 0.03,
        ease: 'power1.out',
      });
      tl.add(countUp(counters), 0);
      return tl;
    }
    tl.to(header, { opacity: 1, y: 0, duration: 1.3 }, 0.35)
      .to(eyebrow, { opacity: 1, y: 0, duration: 1.1 }, 0)
      .to(lineChars[0] || [], { yPercent: 0, rotate: 0, duration: 1.3, stagger: 0.032 }, 0.08)
      .to(lineChars[1] || [], { yPercent: 0, rotate: 0, duration: 1.3, stagger: 0.03 }, 0.26)
      .to(lead, { opacity: 1, y: 0, duration: 1.2 }, 0.62)
      .to(actions, { opacity: 1, y: 0, duration: 1.2 }, 0.74)
      .to(facts, { opacity: 1, y: 0, duration: 1.1, stagger: 0.08 }, 0.86)
      .add(countUp(counters, { duration: 1.8, stagger: 0.07 }), 0.9)
      .to(hint, { opacity: 1, y: 0, duration: 1.2 }, 1.3);
    tl.eventCallback('onComplete', () => {
      gsap.set(lineChars.flat(), { clearProps: 'transform,willChange' });
      ScrollTrigger.refresh();
    });
    return tl;
  }

  return {
    play,
    get played() {
      return played;
    },
  };
}
