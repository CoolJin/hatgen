// One-time "Wischen zum Drehen" hint on phones: a caption on the floor under the product in the
// hero (no plate, so it never reads as a label stuck on the unit), centred under the product.
// Appears once per page view after the intro, fades after the first swipe, after SHOW_MS, or
// as soon as the visitor scrolls away. Nothing is stored on the device (not even a "seen"
// flag in sessionStorage: storing on the device needs consent unless strictly necessary).
import { isStacked, reducedMotion } from '../core/env.js';

const DELAY_MS = 1900; // after the page is revealed (lets the hero entrance play first)
const SHOW_MS = 5000;

// Hand under a double arrow (kept apart, so it reads at 32 px), animated in fx.css.
const ICON = `<svg class="fx-hint__icon" viewBox="0 0 48 36" aria-hidden="true" focusable="false">
  <path class="fx-hint__arrow" d="M9 4h30M13 1 9 4l4 3M35 1l4 3-4 3"/>
  <g class="fx-hint__hand">
    <circle class="fx-hint__tap" cx="23" cy="15.6" r="4.2"/>
    <path d="M21 35v-4.2l-4.6-5.3a2 2 0 0 1 2.9-2.7l2.7 2.6V15.6a2 2 0 0 1 4 0v6.2l6.7 1.1a2.6 2.6 0 0 1 2.2 2.9L34 35"/>
  </g>
</svg>`;

export function createHint({ getScene, suspended }) {
  const phone = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  let state = phone ? 'waiting' : 'done'; // waiting | shown | done
  let el = null;
  let timer = 0;
  let removeTimer = 0;

  function onScroll() {
    if (window.scrollY > window.innerHeight * 0.12) hide();
  }

  function place() {
    const hero = el?.parentNode;
    const scene = getScene();
    if (!hero || !scene) return;
    const heroTop = hero.getBoundingClientRect().top;
    const h = el.offsetHeight;
    let top = hero.offsetHeight * 0.46;
    let cx = window.innerWidth / 2;
    try {
      // the four bottom corners of the housing: the lowest one is where the floor starts
      // (the front wheels reach furthest down), the middle of them is the product's centre
      let low = -Infinity;
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const x of [-0.475, 0.475]) {
        for (const z of [-0.275, 0.275]) {
          const p = scene.stage.project([x, 0, z]);
          if (!p || p.behind || !Number.isFinite(p.y) || !Number.isFinite(p.x)) continue;
          low = Math.max(low, p.y);
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
        }
      }
      if (low > 0) top = low - heroTop + 7; // on the floor, just in front of the wheels
      if (x1 > x0) cx = (x0 + x1) / 2;
    } catch {
      /* keep the fallback */
    }
    // never on the hero copy: where the floor strip under the wheels is too narrow (phones),
    // the caption straddles the floor line, and moves up only as far as the copy demands
    const content = hero.querySelector('.hero__content');
    if (content) {
      const limit = content.getBoundingClientRect().top - heroTop - h - 6;
      if (limit > 80) top = Math.min(top, limit);
    }
    const half = el.offsetWidth / 2 + 16;
    cx = Math.min(Math.max(cx, half), window.innerWidth - half);
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(cx)}px`;
  }

  function show() {
    if (state !== 'waiting') return;
    const scene = getScene();
    const hero = document.getElementById('hero');
    if (!scene || !hero || !isStacked() || suspended() || window.scrollY > window.innerHeight * 0.08) {
      state = 'done';
      return;
    }
    state = 'shown';
    el = document.createElement('div');
    el.className = 'fx-hint';
    el.setAttribute('aria-hidden', 'true');
    // same wording and label style as the checkout's 3D caption
    el.innerHTML = `${ICON}<span class="fx-hint__label">360° · Wischen zum Drehen</span>`;
    hero.appendChild(el);
    place();
    window.addEventListener('resize', place, { passive: true });
    window.visualViewport?.addEventListener('resize', place, { passive: true });
    // next frame: fade in
    requestAnimationFrame(() => requestAnimationFrame(() => el?.classList.add('is-in')));
    timer = setTimeout(hide, SHOW_MS);
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function hide() {
    if (state === 'waiting') {
      state = 'done';
      return;
    }
    if (state !== 'shown') return;
    state = 'done';
    clearTimeout(timer);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', place);
    window.visualViewport?.removeEventListener('resize', place);
    const node = el;
    el = null;
    node.classList.remove('is-in');
    node.classList.add('is-out');
    removeTimer = setTimeout(() => node.remove(), reducedMotion ? 50 : 700);
  }

  // Start once the 3D is up and the loader has revealed the page.
  function arm() {
    if (state !== 'waiting') return;
    const html = document.documentElement;
    const go = () => setTimeout(show, DELAY_MS);
    if (html.classList.contains('is-loaded')) {
      go();
      return;
    }
    const mo = new MutationObserver(() => {
      if (html.classList.contains('is-loaded')) {
        mo.disconnect();
        go();
      }
    });
    mo.observe(html, { attributes: true, attributeFilter: ['class'] });
  }

  return {
    arm,
    used: hide,
    dispose() {
      clearTimeout(timer);
      clearTimeout(removeTimer);
    },
    get state() {
      return state;
    },
  };
}
