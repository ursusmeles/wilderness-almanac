import { distance, neighbours } from './hex.js';
import { randomFor, weightedChoice } from './seed.js';
import { clamp, distanceField } from './spatial.js';
import { preferenceWeights } from './world-preferences.js';

// One combined exception: elevation and steep neighbours never compound it.
export function settlementSuitability(cell, byKey, type) {
  if (cell.water) return 0;
  if (cell.terrain === 'mountains') return type === 'village' ? 0.3 : 0;
  if (!['meadow', 'light forest'].includes(cell.terrain) || cell.elevation > 3) return 0;
  return cell.elevation === 3 ||
    neighbours(cell, byKey).some((next) => Math.abs(next.elevation - cell.elevation) > 1)
    ? 0.3
    : 1;
}

export function planSettlements(world) {
  const step = world.preferences?.settlements ?? 0;
  const weights = preferenceWeights(world);
  return world.regions.map((region) => {
    const cells = world.cells.filter((cell) => cell.regionId === region.id);
    const dryLand = cells.filter((cell) => !cell.water).length;
    const landFraction =
      cells.filter((cell) => !['ocean', 'lake'].includes(cell.water)).length / cells.length;
    // Nearly submerged regions can be empty, even with positive name/slider weights.
    const density = clamp((landFraction - 0.1) / 0.55, 0, 1);
    const random = randomFor(world.seed, `settlement-plan:${region.id}`);
    const roll = (chance) => random() < clamp(chance * weights.PL, 0.05, 0.95) * density;
    const major = [];
    if (step !== -2 && roll(0.42)) major.push('city');
    for (let i = 0; i < (step === -2 ? 1 : 2); i++) if (roll(0.34)) major.push('town');
    // Resolve competing counts before site selection; a city has no reserved slot.
    if (major.length > 2) major.splice(Math.floor(random() * major.length), 1);
    let villages = 0;
    for (let i = 0; i < 5; i++) if (roll(0.32)) villages++;
    return {
      regionId: region.id,
      landFraction,
      density,
      hexBudget: Math.floor(dryLand * 0.2),
      city: major.filter((type) => type === 'city').length,
      town: major.filter((type) => type === 'town').length,
      village: Math.min(4, villages),
    };
  });
}

export function generateSettlements(world) {
  const random = randomFor(world.seed, 'points-of-light');
  const step = world.preferences?.settlements ?? 0;
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const water = distanceField(world.cells, byKey, (cell) => !!cell.water);
  const occupied = [];
  const settlements = [];
  world.settlementPlans = planSettlements(world);
  const eligible = (cell, type) =>
    settlementSuitability(cell, byKey, type) > 0 &&
    occupied.every((other) => distance(cell, other) > 2) &&
    (type !== 'city' || !cell.islandId);
  const score = (cell, type) =>
    (1 + 4 / (1 + water(cell))) *
    (cell.terrain === 'light forest' ? 1 : 1.5) *
    (cell.elevation === 1 ? 1.35 : 1) *
    settlementSuitability(cell, byKey, type);
  for (const type of ['city', 'town', 'village']) {
    for (const plan of world.settlementPlans) {
      for (let attempt = 0; attempt < plan[type]; attempt++) {
        if (
          step === -2 &&
          (settlements.length >= 6 ||
            settlements.filter((s) => s.type === type).length >= (type === 'town' ? 3 : 5))
        )
          break;
        const size =
          step === 2
            ? type === 'city'
              ? weightedChoice(random, [1, 2, 3, 4, 5, 6], [10, 20, 25, 20, 15, 10])
              : type === 'town'
                ? weightedChoice(random, [1, 2], [55, 45])
                : 1
            : type === 'city'
              ? weightedChoice(random, [1, 2, 3], [50, 40, 10])
              : 1;
        const used = occupied.filter((cell) => cell.regionId === plan.regionId).length;
        if (used + size > plan.hexBudget) continue;
        const candidates = world.cells.filter(
          (cell) => cell.regionId === plan.regionId && eligible(cell, type),
        );
        while (candidates.length) {
          const anchor = weightedChoice(
            random,
            candidates,
            candidates.map((cell) => score(cell, type)),
          );
          candidates.splice(candidates.indexOf(anchor), 1);
          const group = [anchor];
          while (group.length < size) {
            const frontier = [...new Set(group.flatMap((cell) => neighbours(cell, byKey)))].filter(
              (cell) =>
                !group.includes(cell) &&
                cell.regionId === plan.regionId &&
                cell.elevation === anchor.elevation &&
                eligible(cell, type),
            );
            if (!frontier.length) break;
            group.push(
              weightedChoice(
                random,
                frontier,
                frontier.map((cell) => score(cell, type)),
              ),
            );
          }
          if (group.length < size) continue;
          const id = `settlement-${settlements.length + 1}`;
          for (const cell of group) cell.pointOfLight = { id, type, size, centre: cell === anchor };
          settlements.push({
            id,
            type,
            regionId: plan.regionId,
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
