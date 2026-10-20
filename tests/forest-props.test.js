import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopology } from '../src/map-data.js';
import { distance, DIRECTIONS, neighbours } from '../src/generation/hex.js';
import { generatePropDressing, TOKEN_ANCHOR } from '../src/generation/props.js';
import { fitsTree, minimumSpacing } from '../src/generation/legacy.js';
import { poiAnchor } from '../src/generation/points-of-interest.js';
import { forestProfiles, FOREST_TYPES } from '../src/generation/forest-types.js';
import { describeHex } from '../src/ui/map-link.js';
import { createColorScale, palettes } from '../src/palette.js';

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
          const anchor = poiAnchor(next.pointsOfInterest[0]);
          assert.ok(
            Math.hypot(
              cell.wx + tree.x - next.wx - anchor.x,
              cell.wz + tree.z - next.wz - anchor.z,
            ) >=
              tree.footprint + anchor.r + 0.14,
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

test('European forest names are shared across cluster densities and slopes, with plain Taiga labels', () => {
  const world = woodland();
  for (const cell of world.cells) {
    cell.treeVariant = cell.q < 0 ? 1 : 0;
    if (cell.r > 0) {
      cell.terrain = 'light forest';
      cell.elevation = 2;
    }
  }
  const found = new Set();
  let borders = 0,
    blends = 0;
  const byKey = new Map(world.cells.map((c) => [c.key, c]));
  for (let i = 0; i < 40; i++) {
    const profiles = forestProfiles(world.cells, String(i));
    assert.deepEqual(profiles, forestProfiles(world.cells.toReversed(), String(i)));
    assert.equal(new Set([...profiles.values()].map((p) => p.clusterId)).size, 2);
    const clusters = new Map();
    for (const cell of world.cells) {
      const profile = profiles.get(cell.key);
      found.add(profile.type);
      assert.ok(FOREST_TYPES[profile.family].includes(profile.type));
      if (clusters.has(profile.clusterId))
        assert.equal(profile.type, clusters.get(profile.clusterId));
      clusters.set(profile.clusterId, profile.type);
      const opposite = neighbours(cell, byKey).some((c) => c.treeVariant !== cell.treeVariant);
      borders += opposite;
      blends += profile.mixed;
      if (profile.mixed)
        assert.ok(opposite, 'Only touching evergreen/deciduous boundaries can mix');
      const label = describeHex({ ...cell, forest: profile });
      if (profile.type === 'taiga') {
        assert.equal(profile.name, 'taiga');
        assert.match(label, / · Taiga$/);
      } else assert.equal(profile.name, cell.terrain.replace('forest', `${profile.type} forest`));
    }
  }
  assert.equal(found.size, 8, 'All selected European flavours, including Taiga, occur');
  assert.ok(blends / borders > 0.25 && blends / borders < 0.6, 'Boundary mixing is occasional');
});

test('Taiga is reserved for at least seven connected evergreen hexes', () => {
  let largeTaigas = 0;
  for (let size = 1; size <= 7; size++) {
    const world = woodland(2);
    // Deciduous neighbours cannot inflate the size of the evergreen cluster.
    for (const [i, cell] of world.cells.entries()) cell.treeVariant = i < size ? 0 : 1;
    for (let seed = 0; seed < 40; seed++) {
      const profiles = forestProfiles(world.cells, String(seed));
      const evergreen = world.cells.slice(0, size).map((cell) => profiles.get(cell.key));
      assert.equal(new Set(evergreen.map((profile) => profile.clusterId)).size, 1);
      assert.equal(new Set(evergreen.map((profile) => profile.type)).size, 1);
      if (size < 7)
        assert.ok(evergreen.every((profile) => ['pine', 'spruce', 'fir'].includes(profile.type)));
      else if (evergreen[0].type === 'taiga') largeTaigas++;
    }
  }
  assert.ok(largeTaigas > 0, 'Large evergreen clusters can still roll Taiga');
  const separated = woodland();
  for (const cell of separated.cells) cell.treeVariant = Math.abs(cell.q) === 3 ? 0 : 1;
  for (let seed = 0; seed < 40; seed++) {
    const profiles = forestProfiles(separated.cells, String(seed));
    const evergreen = [...profiles.values()].filter((profile) => profile.family === 'evergreen');
    assert.equal(evergreen.length, 8);
    assert.equal(new Set(evergreen.map((profile) => profile.clusterId)).size, 2);
    assert.ok(
      evergreen.every((profile) => profile.type !== 'taiga'),
      'Disconnected patches do not combine into Taiga',
    );
  }
});

test('mixed boundary hexes contain both silhouettes and stay mixed through Regenerate', () => {
  const world = woodland();
  for (const cell of world.cells) cell.treeVariant = cell.q < 0 ? 1 : 0;
  let mixed = 0;
  let originalProfiles;
  for (let variant = 0; variant < 5; variant++) {
    const dressing = generatePropDressing(world, variant, new Map());
    const profiles = dressing.map((c) => c.forest);
    if (originalProfiles) assert.deepEqual(profiles, originalProfiles);
    else originalProfiles = profiles;
    for (const cell of dressing) {
      const trees = cell.props.filter((p) => p.kind === 'tree');
      if (cell.forest.mixed && trees.length >= 2) {
        mixed++;
        assert.ok(trees.some((p) => p.variant === 1));
        assert.ok(trees.some((p) => p.variant !== 1));
      } else if (!cell.forest.mixed)
        assert.ok(trees.every((p) => (p.variant === 1) === (cell.forest.family === 'deciduous')));
      for (const tree of trees) {
        if (tree.variant === 1) {
          assert.ok(tree.scale >= 0.55 && tree.scale < 0.8);
          assert.ok([-1, 0, 1].includes(tree.foliageTone));
        } else {
          assert.ok(tree.scale >= 0.57 && tree.scale < 0.77);
          assert.equal(tree.foliageTone, undefined);
        }
      }
    }
  }
  assert.ok(mixed > 10);
});

test('deciduous foliage adds restrained light and hue variation for every palette', () => {
  const dressing = generatePropDressing(woodland(), 0, new Map());
  const trees = dressing.flatMap((c) => c.props.filter((p) => p.kind === 'tree'));
  assert.equal(new Set(trees.map((p) => p.foliageTone)).size, 3);
  const sizes = trees.map((p) => p.scale);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) > 0.24);
  const rgb = (hex) => [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));
  const lab = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  for (const seeds of Object.values(palettes)) {
    const color = createColorScale(seeds);
    for (const lightness of [0.68, 0.77]) {
      const base = rgb(color(2, lightness, 1, 2 / 3));
      for (const tone of [-1, 1]) {
        const shifted = rgb(color(2, lightness + tone * 0.014, 1, 2 / 3, tone * 2));
        const before = lab(base),
          after = lab(shifted);
        const delta = Math.hypot(...after.map((v, i) => v - before[i]));
        assert.ok(
          delta > 0.005 && delta < 0.035,
          'Visible but restrained perceptual colour variation',
        );
      }
    }
  }
});
