// Unified finger / pen input for the effects. Touch input is read from touch events (passive):
// unlike pointer events they keep arriving after the browser has taken the gesture over for
// native scrolling, so the finger effect can follow a scrolling finger. Pens only produce
// pointer events. Nothing here ever calls preventDefault: scrolling and taps stay native.
// A pen can produce both: iPadOS Safari sends touch events for the Apple Pencil (touchType
// 'stylus') and Chrome for Android sends compatibility touch events for a stylus. Those touches
// are skipped, so a pen stroke is one contact (read from its pointer events), not two.
//
// handlers: start(id, x, y, target, kind, count, time), move(id, x, y, time),
//           end(id, x, y, cancelled, time), nativeGesture() (the browser started panning),
//           mouse() (a mouse is in use)
// time is the event's own timestamp (performance.now() time base): on a busy main thread
// touchmoves arrive batched, and the handler time would misjudge the finger speed.

function stamp(e) {
  const t = e.timeStamp;
  const now = performance.now();
  // very old engines used epoch milliseconds here: fall back to the handler time
  return t > 0 && t <= now + 50 && now - t < 1000 ? t : now;
}

const PEN_NEAR_PX = 30; // a touch starting this close to a pen that is down ...
const PEN_NEAR_MS = 120; // ... this soon after the pen went down is that pen

export function createInput(handlers) {
  const opts = { passive: true, capture: true };
  const pens = new Map(); // pen pointers down: id -> { x, y, t }
  const skipped = new Set(); // touch identifiers that belong to a pen

  function penTouch(t, time) {
    if (t.touchType === 'stylus') return true;
    for (const p of pens.values()) {
      if (Math.abs(time - p.t) < PEN_NEAR_MS && Math.hypot(t.clientX - p.x, t.clientY - p.y) < PEN_NEAR_PX) return true;
    }
    return false;
  }

  // ---- touch
  window.addEventListener(
    'touchstart',
    (e) => {
      const time = stamp(e);
      let count = 0;
      for (const t of e.touches) if (!skipped.has(t.identifier)) count++;
      for (const t of e.changedTouches) {
        if (penTouch(t, time)) {
          skipped.add(t.identifier);
          count--;
        }
      }
      if (count <= 0) return;
      for (const t of e.changedTouches) {
        if (!skipped.has(t.identifier)) handlers.start(`t${t.identifier}`, t.clientX, t.clientY, e.target, 'touch', count, time);
      }
    },
    opts,
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      const time = stamp(e);
      for (const t of e.changedTouches) {
        if (!skipped.has(t.identifier)) handlers.move(`t${t.identifier}`, t.clientX, t.clientY, time);
      }
    },
    opts,
  );
  const touchEnd = (cancelled) => (e) => {
    const time = stamp(e);
    for (const t of e.changedTouches) {
      if (skipped.delete(t.identifier)) continue;
      handlers.end(`t${t.identifier}`, t.clientX, t.clientY, cancelled, time);
    }
  };
  window.addEventListener('touchend', touchEnd(false), opts);
  window.addEventListener('touchcancel', touchEnd(true), opts);

  // ---- pen (and the mouse / native gesture signals)
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'pen') {
        const time = stamp(e);
        pens.set(e.pointerId, { x: e.clientX, y: e.clientY, t: time });
        handlers.start(`p${e.pointerId}`, e.clientX, e.clientY, e.target, 'pen', 1, time);
      } else if (e.pointerType === 'mouse') handlers.mouse?.();
    },
    opts,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'pen' || !e.buttons) return;
      handlers.move(`p${e.pointerId}`, e.clientX, e.clientY, stamp(e));
    },
    opts,
  );
  window.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerType !== 'pen') return;
      pens.delete(e.pointerId);
      handlers.end(`p${e.pointerId}`, e.clientX, e.clientY, false, stamp(e));
    },
    opts,
  );
  window.addEventListener(
    'pointercancel',
    (e) => {
      // A touch pointer is cancelled when the browser starts a native pan (scroll / zoom).
      handlers.nativeGesture?.();
      if (e.pointerType !== 'pen') return;
      pens.delete(e.pointerId);
      handlers.end(`p${e.pointerId}`, e.clientX, e.clientY, true, stamp(e));
    },
    opts,
  );
  window.addEventListener('wheel', () => handlers.mouse?.(), opts);
}
