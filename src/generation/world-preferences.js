// Versioned, seed-independent inputs. Never salt the seed with slider values:
// adjacent settings must reuse the same spatial fields and named random streams.
export const PREFERENCE_NAMES = ['water', 'elevation', 'forests', 'settlements'];
export const DEFAULT_WORLD_PREFERENCES = Object.freeze(
  Object.fromEntries(PREFERENCE_NAMES.map((name) => [name, 0])),
);
export function worldPreferences(value = {}) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !PREFERENCE_NAMES.includes(key)) ||
    Object.values(value).some((step) => !Number.isInteger(step) || step < -2 || step > 2)
  )
    throw new Error('World preferences must use integer steps from -2 to 2.');
  return { ...DEFAULT_WORLD_PREFERENCES, ...value };
}

// Do not clamp a second time at the old name-weight ceiling: a named Thorned
// forest plus Dense must still be stronger than Thorned alone.
export function preferenceWeights(world) {
  const weights = { ...world.naming.weights };
  const { forests = 0, settlements = 0 } = world.preferences ?? {};
  if (Math.abs(forests) === 1) {
    weights.LW *= 2.1 ** forests;
    weights.DW *= 2.1 ** forests;
    if (forests < 0) weights.F /= 2.1;
  }
  if (settlements) {
    const step = Math.sign(settlements);
    weights.PL *= 2.1 ** step;
    weights.F *= 2.1 ** step;
  }
  return weights;
}
