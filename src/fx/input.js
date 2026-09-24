// Unified finger / pen input for the effects. Touch input is read from touch events (passive):
// unlike pointer events they keep arriving after the browser has taken the gesture over for
// native scrolling, so the finger effect can follow a scrolling finger. Pens only produce
// pointer events. Nothing here ever calls preventDefault: scrolling and taps stay native.
//
// handlers: start(id, x, y, target, kind, count), move(id, x, y, t), end(id, x, y, cancelled),
//           nativeGesture() (the browser started panning), mouse() (a mouse is in use)

export function createInput(handlers) {
  const opts = { passive: true, capture: true };

  // ---- touch
  window.addEventListener(
    'touchstart',
    (e) => {
      const count = e.touches.length;
      for (const t of e.changedTouches) handlers.start(`t${t.identifier}`, t.clientX, t.clientY, e.target, 'touch', count);
    },
    opts,
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      const time = performance.now();
      for (const t of e.changedTouches) handlers.move(`t${t.identifier}`, t.clientX, t.clientY, time);
    },
    opts,
  );
  const touchEnd = (cancelled) => (e) => {
    for (const t of e.changedTouches) handlers.end(`t${t.identifier}`, t.clientX, t.clientY, cancelled);
  };
  window.addEventListener('touchend', touchEnd(false), opts);
  window.addEventListener('touchcancel', touchEnd(true), opts);

  // ---- pen (and the mouse / native gesture signals)
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'pen') handlers.start(`p${e.pointerId}`, e.clientX, e.clientY, e.target, 'pen', 1);
      else if (e.pointerType === 'mouse') handlers.mouse?.();
    },
    opts,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'pen' || !e.buttons) return;
      handlers.move(`p${e.pointerId}`, e.clientX, e.clientY, performance.now());
    },
    opts,
  );
  window.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerType === 'pen') handlers.end(`p${e.pointerId}`, e.clientX, e.clientY, false);
    },
    opts,
  );
  window.addEventListener(
    'pointercancel',
    (e) => {
      // A touch pointer is cancelled when the browser starts a native pan (scroll / zoom).
      handlers.nativeGesture?.();
      if (e.pointerType === 'pen') handlers.end(`p${e.pointerId}`, e.clientX, e.clientY, true);
    },
    opts,
  );
  window.addEventListener('wheel', () => handlers.mouse?.(), opts);
}
