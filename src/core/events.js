// Tiny event emitter shared by all modules.
const map = new Map();
export const events = {
  on(name, fn) { (map.get(name) ?? map.set(name, new Set()).get(name)).add(fn); return () => events.off(name, fn); },
  off(name, fn) { map.get(name)?.delete(fn); },
  emit(name, payload) { map.get(name)?.forEach((fn) => fn(payload)); },
};
