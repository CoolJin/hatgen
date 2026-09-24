// Tiny event bus shared by UI, 3D stage and scroll director.
// Events in use:
//   'model'        payload: 's5500' | 's6500'   (configurator / spec table switch)
//   'engine:start' payload: none                 (test start button, starts demo run)
//   'engine:stop'  payload: none
//   'scene'        payload: { stage, gen, director, lenis } once the 3D is up (use get/on)
//   'checkout:open' / 'checkout:close'  payload: none (checkout overlay state)
const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export function emit(type, payload) {
  listeners.get(type)?.forEach((fn) => fn(payload));
}

// Last emitted value per type, useful for late subscribers (e.g. current model).
const last = new Map();
export function set(type, payload) {
  last.set(type, payload);
  emit(type, payload);
}
export function get(type, fallback) {
  return last.has(type) ? last.get(type) : fallback;
}
