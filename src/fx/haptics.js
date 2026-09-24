// Haptics (Android; navigator.vibrate is missing or a no-op on iOS): a very short tick when a
// pinned scene step changes and when the model changes. Only with touch input, only after the
// visitor has interacted with the page (sticky user activation, so the browser never blocks
// the call), at most one tick per MIN_GAP ms, never with reduced motion.
import { reducedMotion } from '../core/env.js';

const TICK_MS = 8;
const MIN_GAP = 250;

export function createHaptics({ getScene, isTouch }) {
  const supported = !reducedMotion && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  let interacted = false;
  let last = -1e9;
  let key; // last pinned scene:step seen (undefined until the first observation)

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
    if (k === null) return;
    if (key !== undefined && k !== key) tick();
    key = k;
  }

  return { tick, watch, supported };
}
