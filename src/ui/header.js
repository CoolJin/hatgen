// Header glass state, top scroll progress bar, active nav item, side progress,
// mobile burger menu and smooth anchor links.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { reducedMotion } from '../core/env.js';
import { $, $$, docTop, scrollToTarget } from './util.js';

// Which header nav item is active for a given section id.
const NAV_OF = {
  anschluesse: 'anschluesse',
  innen: 'innen',
  avr: 'innen',
  konstruktion: 'innen',
  modelle: 'modelle',
  daten: 'daten',
  service: 'service',
};

export function initHeader() {
  const header = document.getElementById('header');
  const bar = $('.scroll-progress__bar');
  const navLinks = $$('.nav-link[data-nav]');
  const side = $('.sidenav');
  const sideLinks = side ? $$('a[data-side]', side) : [];
  const sections = $$('main > section[id]');

  // transparent scenes where the product can reach the right edge: the ticks dim there
  const overScene = new Set(sections.filter((el) => el.classList.contains('scene')).map((el) => el.id));

  let marks = [];
  let docMax = 1;
  let current; // undefined so the first update always applies
  let flashTimer = 0;
  let ticking = false;

  function measure() {
    marks = sections.map((el) => ({ id: el.id, top: docTop(el), bottom: docTop(el) + el.offsetHeight }));
    marks.einsatzHorizontal = !!document.querySelector('#einsatz.is-horizontal');
    applySideVisibility();
    docMax = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }

  // hidden on the hero and over the horizontal card rail (the ticks would sit on the cards)
  function applySideVisibility() {
    if (!side || current === undefined) return;
    side.classList.toggle('is-hidden', !current || current === 'hero' || (current === 'einsatz' && marks.einsatzHorizontal));
  }

  function setCurrent(id) {
    if (id === current) return;
    current = id;
    const nav = NAV_OF[id] || null;
    navLinks.forEach((a) => {
      const on = a.dataset.nav === nav;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
    sideLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.side === id));
    if (side) {
      applySideVisibility();
      side.classList.toggle('is-dim', overScene.has(id));
      // show the chapter label briefly after a chapter change, then keep only the ticks
      side.classList.add('is-flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => side.classList.remove('is-flash'), 2200);
    }
  }

  function update() {
    ticking = false;
    const y = window.scrollY;
    header?.classList.toggle('is-scrolled', y > 40);
    if (bar) bar.style.transform = `scaleX(${Math.min(1, y / docMax).toFixed(4)})`;
    const mid = y + window.innerHeight * 0.5;
    let id = null;
    for (const m of marks) {
      if (mid >= m.top && mid < m.bottom) {
        id = m.id;
        break;
      }
    }
    setCurrent(id);
  }

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };

  measure();
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  ScrollTrigger.addEventListener('refresh', () => {
    measure();
    update();
  });
  window.addEventListener('resize', () => {
    measure();
    onScroll();
  }, { passive: true });

  initMenu();
  initAnchors();
}

// ---------------------------------------------------------------------------
function initMenu() {
  const burger = $('.burger');
  const menu = document.getElementById('menu');
  if (!burger || !menu) return;
  const links = $$('.menu__nav a', menu);
  const foot = $('.menu__foot', menu);
  // everything outside the dialog except the burger (its close button) leaves the tab order
  const inertEls = [
    $('.skip-link'),
    $('.header__logo'),
    $('.header__cta'),
    document.getElementById('main'),
    document.getElementById('footer'),
    $('.sidenav'),
  ].filter(Boolean);
  let open = false;
  let tl = null;

  function setOpen(next, { focusBurger = true } = {}) {
    if (next === open) return;
    open = next;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
    document.documentElement.classList.toggle('menu-open', open);
    inertEls.forEach((el) => {
      el.inert = open;
    });
    tl?.kill();
    if (open) {
      window.__lenis?.stop();
      menu.hidden = false;
      if (reducedMotion) {
        tl = gsap.timeline().fromTo(menu, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 });
      } else {
        tl = gsap
          .timeline()
          .fromTo(menu, { autoAlpha: 1, clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.85, ease: 'expo.inOut' })
          .fromTo(links, { yPercent: 105 }, { yPercent: 0, duration: 1, ease: 'expo.out', stagger: 0.05 }, 0.32)
          .fromTo(foot, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'expo.out' }, 0.55);
      }
      links[0]?.focus({ preventScroll: true });
    } else {
      window.__lenis?.start();
      const done = () => {
        menu.hidden = true;
        gsap.set(menu, { clearProps: 'clipPath,opacity,visibility' });
      };
      if (reducedMotion) {
        tl = gsap.timeline({ onComplete: done }).to(menu, { autoAlpha: 0, duration: 0.25 });
      } else {
        tl = gsap.timeline({ onComplete: done }).to(menu, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.7, ease: 'expo.inOut' });
      }
      if (focusBurger) burger.focus({ preventScroll: true });
    }
  }

  burger.addEventListener('click', () => setOpen(!open));
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false, { focusBurger: false });
  });
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    // keep Tab inside the dialog: burger (close) -> menu links -> shop button -> contacts -> burger
    if (e.key !== 'Tab') return;
    const items = [burger, ...$$('a[href], button', menu)];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  });
  window.matchMedia('(min-width: 1024px)').addEventListener('change', (e) => {
    if (e.matches && open) setOpen(false, { focusBurger: false });
  });
}

// ---------------------------------------------------------------------------
function initAnchors() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!id) return;
    const target = id === 'top' ? document.body : document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    scrollToTarget(target);
    if (history.replaceState) history.replaceState(null, '', id === 'top' ? location.pathname + location.search : `#${id}`);
    // move focus for keyboard / screen reader users without jumping
    const focusEl = target === document.body ? document.getElementById('main') : target;
    if (focusEl) {
      if (!focusEl.hasAttribute('tabindex')) focusEl.setAttribute('tabindex', '-1');
      focusEl.focus({ preventScroll: true });
    }
  });
}
