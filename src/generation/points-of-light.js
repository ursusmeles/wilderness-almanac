import { distance, neighbours } from './hex.js';
import { randomFor, weightedChoice } from './seed.js';
import { clamp, distanceField } from './spatial.js';
import { preferenceWeights } from './world-preferences.js';
import { generateSettlements } from './settlement-placement.js';

export const chooseCitySize = (random) => weightedChoice(random, [1, 2, 3], [50, 40, 10]);

export function generatePointsOfLight(world) {
  if (world.generatorVersion >= 8) return generateSettlements(world);
  // Versions 6/7 retain their original stream consumption, eligibility and order.
  const random = randomFor(world.seed, 'points-of-light');
  const step = world.preferences?.settlements ?? 0;
  const weights = preferenceWeights(world);
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const water = distanceField(world.cells, byKey, (cell) => !!cell.water);
  const settlements = [];
  const occupied = [];
  const eligible = (cell) =>
    !cell.water &&
    cell.elevation <= 2 &&
    ['meadow', 'light forest'].includes(cell.terrain) &&
    neighbours(cell, byKey).every((next) => Math.abs(next.elevation - cell.elevation) <= 1) &&
    occupied.every((other) => distance(cell, other) > 2);
  // Global size order: cities first across all regions, then towns, then villages.
  for (const [type, cap, chance] of [
    ['city', step === -2 ? 0 : 1, 0.42],
    ['town', step === -2 ? 1 : 2, 0.34],
    ['village', 5, 0.32],
  ]) {
    for (const region of world.regions) {
      for (let attempt = 0; attempt < cap; attempt++) {
        if (
          step === -2 &&
          (settlements.length >= 6 ||
            settlements.filter((entry) => entry.type === type).length >= (type === 'town' ? 3 : 5))
        )
          break;
        if (random() >= clamp(chance * weights.PL, 0.05, 0.95)) continue;
        const size =
          step === 2
            ? type === 'city'
              ? weightedChoice(random, [1, 2, 3, 4, 5, 6], [10, 20, 25, 20, 15, 10])
              : type === 'town'
                ? weightedChoice(random, [1, 2], [55, 45])
                : 1
            : type === 'city'
              ? chooseCitySize(random)
              : 1;
        const candidates = world.cells.filter(
          (cell) =>
            cell.regionId === region.id && eligible(cell) && (type !== 'city' || !cell.islandId),
        );
        while (candidates.length) {
          const score = (cell) =>
            (1 + 4 / (1 + water(cell))) *
            (cell.terrain === 'meadow' ? 1.5 : 1) *
            (cell.elevation === 1 ? 1.35 : 1);
          const anchor = weightedChoice(random, candidates, candidates.map(score));
          candidates.splice(candidates.indexOf(anchor), 1);
          const group = [anchor];
          while (group.length < size) {
            const frontier = [...new Set(group.flatMap((cell) => neighbours(cell, byKey)))].filter(
              (cell) =>
                !group.includes(cell) &&
                cell.regionId === region.id &&
                cell.elevation === anchor.elevation &&
                eligible(cell),
            );
            if (!frontier.length) break;
            group.push(weightedChoice(random, frontier, frontier.map(score)));
          }
          if (group.length < size) continue;
          const id = `settlement-${settlements.length + 1}`;
          for (const cell of group) cell.pointOfLight = { id, type, size, centre: cell === anchor };
          settlements.push({
            id,
            type,
            regionId: region.id,
            anchorKey: anchor.key,
            hexKeys: group.map((cell) => cell.key),
          });
          occupied.push(...group);
          break;
        }
      }
    }
  }
  world.settlements = settlements;
  return world;
}
