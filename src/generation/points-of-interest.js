import rules from '../data/world-rules.json' with { type: 'json' };
import { DIRECTIONS, components, distance, neighbours } from './hex.js';
import { hashSeed, randomFor, weightedChoice } from './seed.js';
import { distanceField } from './spatial.js';
import { crossingChoice, crossingSite, bridgeMaterialFor } from './legacy.js';
import { prepareRiverGeometry, riverFieldFor } from './presentation.js';

export const POI_RULES = rules.pointsOfInterest;
export const POI_ANCHOR = { x: 0.5, z: 0.16, r: 0.245 };
const LARGE_POI_ANCHOR = { x: 0.43, z: 0.14, r: 0.32 };
const enlarged = new Set(['encampment', 'ruins', 'lair', 'dungeon', 'mystic', 'battlefield']);
export const poiAnchor = (poi) =>
  enlarged.has(poi.poiKind ?? poi.kind) ? LARGE_POI_ANCHOR : POI_ANCHOR;
const ordinary = POI_RULES.filter((rule) => !['bridge', 'ferry'].includes(rule.kind));
const rarity = { mystic: 0.25, battlefield: 0.25 };

export function poiSuitability(kind, cell, context) {
  if (cell.water || (cell.pointOfLight && !['watchtower', 'mystic'].includes(kind))) return 0;
  const { pl, smallPL, mountain, lake, canyon } = context;
  const nearPL = pl(cell) <= 3;
  const peninsula =
    !cell.islandId &&
    neighbours(cell, context.byKey).filter((c) => c.water === 'ocean').length >= 2;
  const remote = cell.islandId || peninsula;
  const cliff = neighbours(cell, context.byKey).some((c) => cell.elevation - c.elevation >= 2);
  const preferred = (types) => types.includes(cell.terrain);
  switch (kind) {
    case 'ruins':
      return (
        (preferred(['mountains', 'dense forest', 'wetlands']) || cell.islandId ? 4 : 1) *
        (nearPL ? 0.25 : 1) *
        (cell.terrain === 'farmlands' ? 0.2 : 1)
      );
    case 'encampment':
      return preferred(['meadow', 'light forest']) ? 4 : 0.5;
    case 'watchtower':
      return (
        (1 + cell.elevation * 0.6) *
        (cell.terrain === 'meadow' ? 2 : 1) *
        (nearPL ? 2 : 1) *
        (cliff ? 6 : 1) *
        (cell.terrain === 'dense forest' ? 0.15 : 1)
      );
    case 'stronghold':
      return (
        ([2, 3].includes(cell.elevation) ? 4 : 1) *
        (mountain(cell) <= 2 ? 2 : 1) *
        (cell.terrain === 'farmlands' ? 3 : 1) *
        (cell.terrain === 'wetlands' ? 0.08 : 1)
      );
    case 'lair':
      return (
        (preferred(['wetlands', 'mountains']) || canyon.has(cell.key) || remote ? 5 : 1) *
        (nearPL ? 0.04 : 1)
      );
    case 'mystic':
      return remote || lake(cell) <= 1 ? 5 : 1;
    case 'abbey':
      return (
        (cell.terrain === 'farmlands' ? 4 : 1) *
        (smallPL(cell) <= 1 ? 4 : smallPL(cell) <= 3 ? 2 : 0.5)
      );
    case 'battlefield':
      return cell.terrain === 'meadow' ? 5 : 0.3;
    case 'dungeon':
      return cell.elevation === 4 ? 12 : mountain(cell) <= 1 ? 3 : 0.2;
    default:
      return 0;
  }
}

export function interiorCrossingCandidate(cell, byKey) {
  if (!cell.upstream.length) return byKey.get(cell.downstream);
  if (byKey.get(cell.downstream)?.water !== 'river' && cell.upstream.length === 1)
    return byKey.get(cell.upstream[0]);
  return cell;
}

function spawnCrossings(world, byKey) {
  const fields = prepareRiverGeometry(world);
  const rivers = world.cells.filter((cell) => cell.water === 'river');
  const network = new Map();
  components(rivers, byKey).forEach((group, index) =>
    group.forEach((cell) => network.set(cell.key, index)),
  );
  const placed = [];
  world.crossingRolls = [];
  for (const settlement of world.settlements) {
    const group = settlement.hexKeys.map((key) => byKey.get(key));
    const proximity = (cell) => Math.min(...group.map((other) => distance(cell, other)));
    const nearby = rivers.filter((cell) => proximity(cell) <= 3);
    for (const networkId of new Set(nearby.map((cell) => network.get(cell.key)))) {
      const choice = crossingChoice(
        hashSeed(world.seed),
        byKey.get(settlement.anchorKey),
        networkId,
      );
      world.crossingRolls.push({ settlementId: settlement.id, networkId, ...choice });
      if (!choice.kind) continue;
      const ranked = nearby
        .filter((cell) => network.get(cell.key) === networkId)
        .sort((a, b) => proximity(a) - proximity(b) || a.q - b.q || a.r - b.r);
      const candidates = [
        ...new Set(ranked.map((cell) => interiorCrossingCandidate(cell, byKey))),
      ].filter((cell) => cell?.water === 'river');
      for (const cell of candidates) {
        if (
          cell.crossing ||
          cell.upstream.length !== 1 ||
          byKey.get(cell.downstream).water !== 'river' ||
          placed.some(
            (other) => other.crossing.networkId === networkId && distance(cell, other) <= 5,
          )
        )
          continue;
        const site = crossingSite({
          ...cell,
          riverCorners: Array.from({ length: 6 }, (_, k) => [
            Math.sin((k * Math.PI) / 3),
            Math.cos((k * Math.PI) / 3),
          ]),
          river: riverFieldFor(cell, fields),
          riverCurve: fields.curves.get(cell.key),
          riverLandSides: DIRECTIONS.map(([q, r]) => {
            const other = byKey.get(`${cell.q + q},${cell.r + r}`);
            return !!other && !other.water;
          }),
        });
        if (!site) continue;
        cell.crossing = {
          ...site,
          kind: choice.kind,
          networkId,
          material: bridgeMaterialFor(settlement.type),
          settlementId: settlement.id,
          boatPosition: choice.boatPosition,
        };
        placed.push(cell);
        break;
      }
    }
  }
  world.crossings = placed.map((cell) => ({ key: cell.key, ...cell.crossing }));
}

export function generatePointsOfInterest(world) {
  for (const cell of world.cells) {
    cell.pointsOfInterest = [];
    delete cell.crossing;
  }
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const context = {
    byKey,
    pl: distanceField(world.cells, byKey, (cell) => !!cell.pointOfLight),
    smallPL: distanceField(world.cells, byKey, (cell) =>
      ['village', 'town'].includes(cell.pointOfLight?.type),
    ),
    mountain: distanceField(world.cells, byKey, (cell) => cell.elevation === 4),
    lake: distanceField(world.cells, byKey, (cell) => cell.water === 'lake'),
    coast: distanceField(world.cells, byKey, (cell) => cell.water === 'ocean'),
    canyon: new Set(
      world.elevation.features
        .filter((feature) => feature.kind === 'canyon')
        .flatMap((feature) => feature.hexKeys),
    ),
  };
  world.pointsOfInterest = [];
  world.poiBudgets = [];
  const add = (cell, rule, random, bonus = false) => {
    const variant =
      rule.kind === 'watchtower'
        ? context.coast(cell) === 1 && random() < 0.25
          ? 'lighthouse'
          : 'watchtower'
        : rule.kind === 'dungeon'
          ? context.pl(cell) <= 3
            ? 'mine'
            : 'dungeon'
          : rule.kind === 'lair'
            ? random() < 0.5
              ? 'cave'
              : 'nest'
            : rule.kind === 'mystic'
              ? ['portal', 'altar', 'standing stone'][Math.floor(random() * 3)]
              : Math.floor(random() * 3);
    const poi = {
      id: `poi-${world.pointsOfInterest.length + 1}`,
      key: cell.key,
      regionId: cell.regionId,
      kind: rule.kind,
      variant,
      temperature: rule.hue === 'W' ? 1 : -1,
      detailSeed: Math.floor(random() * 4294967296),
      bonus,
    };
    cell.pointsOfInterest.push(poi);
    world.pointsOfInterest.push(poi);
  };
  for (const region of world.regions) {
    const random = randomFor(world.seed, `points-of-interest:${region.id}`);
    const wild = world.settlements.filter((s) => s.regionId === region.id).length <= 2;
    const target = 1 + Math.floor(random() * 4) + Number(wild);
    world.poiBudgets.push({ regionId: region.id, wild, target });
    const placed = [];
    for (let slot = 0; slot < target; slot++) {
      const options = ordinary
        .map((rule) => {
          const candidates = world.cells.filter(
            (cell) =>
              cell.regionId === region.id &&
              !cell.pointsOfInterest.length &&
              placed.every((other) => distance(other, cell) >= 2),
          );
          const scores = candidates.map((cell) =>
            rule.kind === 'stronghold' &&
            placed.some((other) => other.pointsOfInterest[0].kind === 'stronghold')
              ? 0
              : poiSuitability(rule.kind, cell, context),
          );
          return { rule, candidates, scores, available: scores.some((score) => score > 0) };
        })
        .filter((option) => option.available);
      if (!options.length) break;
      const option = weightedChoice(
        random,
        options,
        options.map((o) => rarity[o.rule.kind] ?? 1),
      );
      const cell = weightedChoice(random, option.candidates, option.scores);
      add(cell, option.rule, random);
      placed.push(cell);
    }
  }
  // Rare aftermath near a defensive POI is explicitly outside the regional budget.
  for (const defence of world.pointsOfInterest
    .slice()
    .filter((p) => ['watchtower', 'stronghold'].includes(p.kind))) {
    const random = randomFor(world.seed, `battlefield:${defence.id}`);
    if (random() >= 0.12) continue;
    const candidates = neighbours(byKey.get(defence.key), byKey).filter(
      (cell) =>
        !cell.water &&
        !cell.pointOfLight &&
        !cell.pointsOfInterest.length &&
        cell.terrain === 'meadow',
    );
    if (candidates.length)
      add(
        candidates[Math.floor(random() * candidates.length)],
        ordinary.find((rule) => rule.kind === 'battlefield'),
        random,
        true,
      );
  }
  spawnCrossings(world, byKey);
  return world;
}
