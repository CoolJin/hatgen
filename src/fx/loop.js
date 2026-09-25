// One shared requestAnimationFrame loop for all touch / scroll effects. It only runs while a
// task still has something to do: every task returns true while it needs another frame, and
// the loop goes to sleep as soon as all of them return false. Input events wake it again.
const MAX_DT = 1 / 20; // s, a stalled tab or a slow frame never jumps the simulations

export function createLoop() {
  const tasks = [];
  let raf = 0;
  let last = 0;
  let timer = 0;
  let timerAt = Infinity;

  function frame() {
    raf = 0;
    // performance.now() rather than the rAF timestamp: input events are stamped with it too
    const now = performance.now();
    const dt = last ? Math.min(Math.max((now - last) / 1000, 0), MAX_DT) : 1 / 60;
    last = now;
    let busy = false;
    for (let i = 0; i < tasks.length; i++) {
      try {
        if (tasks[i](dt, now)) busy = true;
      } catch (err) {
        console.error('[fx] task failed', err);
        tasks.splice(i--, 1);
      }
    }
    if (busy) raf = requestAnimationFrame(frame);
    else last = 0; // the next wake starts with a fresh dt
  }

  function wake() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  return {
    add(fn) {
      tasks.push(fn);
    },
    wake,
    // Wake the loop at a later time (e.g. the return after a pause) without spinning
    // empty frames until then. Only the earliest pending request is kept.
    wakeAt(time) {
      if (time >= timerAt && timer) return;
      clearTimeout(timer);
      timerAt = time;
      timer = setTimeout(() => {
        timer = 0;
        timerAt = Infinity;
        wake();
      }, Math.max(0, time - performance.now()));
    },
    get running() {
      return raf !== 0;
    },
  };
}
