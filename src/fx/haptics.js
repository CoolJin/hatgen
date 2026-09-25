// Haptics (Android; navigator.vibrate is missing or a no-op on iOS): a very short tick when a
// pinned scene step changes and when the model changes. Only with touch input, only after the
// visitor has interacted with the page (sticky user activation, so the browser never blocks
// the call), at most one tick per MIN_GAP ms, never with reduced motion. Step ticks only come
// from the visitor's own scrolling (finger down or its fling): a programmatic smooth scroll
// (menu links, "Modelle ansehen", the steps list) passes the steps silently. They are detents
// for slow scrubbing: a fling (faster than SCRUB_MAX) or steps changing in quick succession
// pass silently, and the step the page then settles on ticks once (SETTLE_MS later).
import { reducedMotion } from '../core/env.js';

const TICK_MS = 8;
const MIN_GAP = 250;
const SCRUB_MAX = 2.5; // viewport heights per second
const RAPID_MS = 400; // a step change this soon after the previous one is part of a fling
const SETTLE_MS = 220; // a skipped step that holds this long (slowly) ticks once

export function createHaptics({ getScene, isTouch, fingerScroll = () => true, speed = () => 0 }) {
  const supported = !reducedMotion && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  let interacted = false;
  let last = -1e9;
  let key; // last pinned scene:step seen (undefined until the first observation)
  let changedAt = -1e9; // when it last changed
  let pending = false; // the current step was passed silently: tick if it holds

  if (supported && !navigator.userActivation) {
    // fallback for browsers without the UserActivation API: a completed tap or a key press
    const mark = () => (interacted = true);
    window.addEventListener('pointerup', mark, { passive: true, capture: true });
    window.addEventListener('keydown', mark, { passive: true, capture: true });
  }

  function activated() {
    return navigator.userActivation ? navigator.userActivation.hasBeenActive : interacted;
  }

  function tick() {
    if (!supported || !isTouch() || !activated() || document.hidden) return false;
    const now = performance.now();
    if (now - last < MIN_GAP) return false;
    last = now;
    try {
      navigator.vibrate(TICK_MS);
    } catch {
      /* ignored */
    }
    return true;
  }

  // Called every frame while the fx loop runs (it runs while the page scrolls).
  function watch() {
    if (!supported) return;
    const info = getScene()?.director?.info;
    if (!info) return;
    const k = info.pinned ? `${info.scene}:${info.step}` : null;
    if (k === null) {
      pending = false;
      return;
    }
    const now = performance.now();
    const own = window.__lenis?.isScrolling !== 'smooth' && fingerScroll(); // not programmatic
    if (key !== undefined && k !== key) {
      const rapid = now - changedAt < RAPID_MS;
      changedAt = now;
      pending = false;
      if (own) {
        if (!rapid && speed() <= SCRUB_MAX) tick();
        else pending = true;
      }
    } else if (pending && now - changedAt > SETTLE_MS && speed() <= SCRUB_MAX * 0.5) {
      pending = false;
      if (own) tick();
    }
    key = k;
  }

  return { tick, watch, supported };
}
