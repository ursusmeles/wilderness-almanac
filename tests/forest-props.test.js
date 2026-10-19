import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopology } from '../src/map-data.js';
import { distance, DIRECTIONS, neighbours } from '../src/generation/hex.js';
import { generatePropDressing, TOKEN_ANCHOR } from '../src/generation/props.js';
import { fitsTree, minimumSpacing } from '../src/generation/legacy.js';
import { POI_ANCHOR } from '../src/generation/points-of-interest.js';

function woodland(radius = 3) {
  return {
    seed: 'forest-regression',
    cells: createTopology()
      .cells.filter((cell) => distance(cell) <= radius)
      .map((cell) => ({
        ...cell,
        terrain: 'dense forest',
        elevation: 1,
        treeVariant: 1,
      })),
  };
}

function treesInWorld(world, dressing) {
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  return dressing.flatMap((data) => {
    const cell = byKey.get(data.key);
    return data.props
      .filter((prop) => prop.kind === 'tree')
      .map((prop) => ({
        ...prop,
        key: cell.key,
        wx: cell.wx + prop.x,
        wz: cell.wz + prop.z,
      }));
  });
}

test('large canopies fill patches across hexes without concentrating trees on six linking spokes', () => {
  const world = woodland();
  let total = 0,
    spokes = 0,
    centre = 0,
    crossTileCrowns = 0;
  for (let variant = 0; variant < 5; variant++) {
    const trees = treesInWorld(world, generatePropDressing(world, variant, new Map()));
    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      total++;
      const radius = Math.hypot(tree.x, tree.z);
      if (radius < 0.3) centre++;
      if (
        radius > 0.28 &&
        DIRECTIONS.some(
          (_, side) =>
            Math.abs(
              tree.x * Math.sin((side * Math.PI) / 3) - tree.z * Math.cos((side * Math.PI) / 3),
            ) < 0.08,
        )
      )
        spokes++;
      for (const other of trees.slice(0, i)) {
        const gap = Math.hypot(tree.wx - other.wx, tree.wz - other.wz);
        assert.ok(gap >= minimumSpacing(tree, other) - 1e-9, 'Spacing also holds across hex edges');
        if (tree.key !== other.key && gap < tree.footprint + other.footprint) crossTileCrowns++;
      }
    }
  }
  assert.ok(total > 2000, 'Retain dense woodland');
  assert.ok(spokes / total < 0.35, 'Do not rebuild the triangular network of straight rows');
  assert.ok(centre / total > 0.1, 'Canopy also occupies tile interiors');
  assert.ok(crossTileCrowns > 30, 'Patches can join with touching crowns across tiles');
});

test('cluster dressing replays independently of cell iteration order and preserves its world', () => {
  const world = woodland(2);
  const before = structuredClone(world);
  const ordered = (data) => data.sort((a, b) => a.key.localeCompare(b.key));
  const dressing = generatePropDressing(world, 3, new Map());
  assert.deepEqual(dressing, generatePropDressing(world, 3, new Map()));
  assert.deepEqual(world, before);
  assert.deepEqual(
    ordered(generatePropDressing({ ...world, cells: world.cells.toReversed() }, 3, new Map())),
    ordered(dressing),
  );
  assert.notDeepEqual(dressing, ordered(generatePropDressing(world, 4, new Map())));
});

test('canopies stop at water, settlements and cliffs and yield POI and token footprints', () => {
  const world = woodland(2);
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  Object.assign(byKey.get('-1,0'), { terrain: 'open water', water: 'lake' });
  Object.assign(byKey.get('1,0'), {
    pointOfLight: { type: 'village', id: 'village', centre: true },
  });
  byKey.get('0,1').elevation = 2;
  byKey.get('0,0').pointsOfInterest = [
    { kind: 'ruins', variant: 0, detailSeed: 7, temperature: -1 },
  ];
  for (let variant = 0; variant < 4; variant++) {
    const dressing = generatePropDressing(world, variant, new Map());
    for (const data of dressing) {
      const cell = byKey.get(data.key);
      for (let side = 0; side < 6; side++) {
        if (!data.links[side]) continue;
        const [q, r] = DIRECTIONS[side];
        const next = byKey.get(`${cell.q + q},${cell.r + r}`);
        assert.ok(!next.water && !next.pointOfLight);
        assert.equal(next.elevation, cell.elevation);
      }
      if (cell.water || cell.pointOfLight) continue;
      for (const tree of data.props.filter((prop) => prop.kind === 'tree')) {
        assert.ok(fitsTree(data, tree.x, tree.z, tree.footprint));
        assert.ok(
          Math.hypot(tree.x - TOKEN_ANCHOR.x, tree.z - TOKEN_ANCHOR.z) >=
            TOKEN_ANCHOR.r + tree.footprint * 0.48,
        );
        for (const next of [cell, ...neighbours(cell, byKey)]) {
          if (!next.pointsOfInterest.length) continue;
          assert.ok(
            Math.hypot(
              cell.wx + tree.x - next.wx - POI_ANCHOR.x,
              cell.wz + tree.z - next.wz - POI_ANCHOR.z,
            ) >=
              tree.footprint + POI_ANCHOR.r + 0.14,
          );
        }
      }
    }
  }
  const isolated = woodland(0);
  const data = generatePropDressing(isolated, 0, new Map())[0];
  assert.ok(data.props.some((prop) => prop.kind === 'tree'));
  assert.ok(data.links.every((link) => !link));
});
