import { neighbours } from './hex.js';
import { randomFor } from './seed.js';

export const FOREST_TYPES = {
  deciduous: ['oak', 'beech', 'birch', 'ash'],
  evergreen: ['pine', 'spruce', 'fir', 'taiga'],
};
export const TAIGA_MIN_CLUSTER_SIZE = 7;
export const isForest = (cell) =>
  !cell.water && !cell.pointOfLight && ['light forest', 'dense forest'].includes(cell.terrain);
const familyOf = (cell) => (cell.treeVariant === 1 ? 'deciduous' : 'evergreen');

// Seed-bound flavour is separate from the terrain model and cosmetic variant.
// A species cluster spans density changes and slopes, unlike canopy clipping.
export function forestProfiles(cells, seed) {
  const byKey = new Map(cells.map((cell) => [cell.key, cell]));
  const forests = cells.filter(isForest).sort((a, b) => a.q - b.q || a.r - b.r);
  const available = new Set(forests.map((cell) => cell.key));
  const profiles = new Map();
  for (const start of forests) {
    if (!available.delete(start.key)) continue;
    const family = familyOf(start);
    const group = [start];
    for (let i = 0; i < group.length; i++) {
      for (const next of neighbours(group[i], byKey)) {
        if (isForest(next) && familyOf(next) === family && available.delete(next.key))
          group.push(next);
      }
    }
    const choices = FOREST_TYPES[family];
    const random = randomFor(seed, `forest-name:${family}:${start.key}`);
    let type = choices[Math.floor(random() * choices.length)];
    if (type === 'taiga' && group.length < TAIGA_MIN_CLUSTER_SIZE) {
      const smallerWoods = choices.filter((choice) => choice !== 'taiga');
      type = smallerWoods[Math.floor(random() * smallerWoods.length)];
    }
    for (const cell of group)
      profiles.set(cell.key, {
        clusterId: `forest:${start.key}`,
        family,
        type,
        mixed: false,
        name: type === 'taiga' ? 'taiga' : cell.terrain.replace('forest', `${type} forest`),
      });
  }
  for (const cell of forests) {
    const profile = profiles.get(cell.key);
    const opposite = neighbours(cell, byKey).filter(
      (next) => profiles.has(next.key) && familyOf(next) !== profile.family,
    );
    const random = randomFor(seed, `forest-blend:${cell.key}`);
    if (!opposite.length || random() >= 0.42) continue;
    const next = opposite[Math.floor(random() * opposite.length)];
    profile.mixed = true;
    profile.neighbourType = profiles.get(next.key).type;
  }
  return profiles;
}
