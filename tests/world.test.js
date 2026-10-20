import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopology, WORLD_RADIUS } from '../src/map-data.js';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { chooseCoastEdges, narrowPeninsulaChains } from '../src/generation/geography.js';
import { components, distance, neighbours, DIRECTIONS } from '../src/generation/hex.js';
import { riverLandValue } from '../src/generation/river-surfaces.js';
import { surfaceHeight } from '../src/generation/math.js';
import { readPreferences, savePreferences } from '../src/ui/storage.js';
import { bendLongRiverRuns } from '../src/generation/river-routing.js';
import { randomFor } from '../src/generation/seed.js';
import { TERRAIN_TYPES } from '../src/generation/terrain-types.js';

test('469 cells form a complete hex with six compact regions and reversible coordinates', () => {
  const { cells, regions } = createTopology();
  const byKey = new Map(cells.map((cell) => [cell.key, cell]));
  assert.equal(cells.length, 469);
  assert.equal(byKey.size, 469);
  assert.equal(new Set(cells.map((cell) => cell.id)).size, 469);
  assert.ok(cells.every((cell) => distance(cell) <= WORLD_RADIUS));
  assert.equal(cells.filter((cell) => distance(cell) === WORLD_RADIUS).length, 6 * WORLD_RADIUS);
  assert.equal(components(cells, byKey).length, 1);
  assert.equal(regions.length, 6);
  assert.ok(byKey.has('0,0'));
  for (const region of regions) {
    const local = cells.filter((cell) => cell.regionId === region.id);
    assert.ok(local.length >= 60 && local.length <= 90);
    assert.equal(components(local, byKey).length, 1);
    assert.deepEqual(
      region.hexIds,
      local.map((cell) => cell.id),
    );
    for (const cell of local) {
      assert.equal(cell.q, cell.x + region.origin.q);
      assert.equal(cell.r, cell.y + region.origin.r);
    }
  }
});

test('world seeds replay JSON data; dressing changes independently', () => {
  for (const seed of ['0', 'a world of bays', '🌊', '0007']) {
    const world = generateWorld(seed);
    assert.deepEqual(world, generateWorld(seed));
    assert.deepEqual(world, JSON.parse(JSON.stringify(world)));
    const before = JSON.stringify(world);
    const first = generateDressing(world, 1);
    assert.deepEqual(first, generateDressing(world, 1));
    assert.notDeepEqual(first, generateDressing(world, 2));
    assert.equal(JSON.stringify(world), before);
    assert.ok(
      world.cells.every(
        (cell) =>
          Number.isInteger(cell.elevation) &&
          cell.elevation >= 0 &&
          cell.elevation <= 4 &&
          TERRAIN_TYPES.includes(cell.terrain) &&
          Array.isArray(cell.pointsOfInterest),
      ),
    );
    assert.ok(first.cells.some((cell) => cell.props.length));
  }
  assert.notDeepEqual(generateWorld('7'), generateWorld('8'));
  assert.equal(generateWorld(' 7 ').seed, '7');
  assert.throws(() => generateWorld(' '), RangeError);
  assert.throws(() => generateWorld('a'.repeat(129)), RangeError);
});

test('coast rolls approximate 60% any / 8% all, with adjacent edges favoured', () => {
  const counts = Array(7).fill(0);
  let pairs = 0,
    adjacent = 0;
  for (let seed = 0; seed < 10000; seed++) {
    const edges = chooseCoastEdges(String(seed));
    counts[edges.length]++;
    if (edges.length === 2) {
      pairs++;
      if (edges.includes((edges[0] + 1) % 6) || edges.includes((edges[0] + 5) % 6)) adjacent++;
    }
  }
  assert.ok(Math.abs(counts[0] / 10000 - 0.4) < 0.02);
  assert.ok(Math.abs(counts[6] / 10000 - 0.08) < 0.015);
  assert.ok(adjacent / pairs > 0.7);
});

test('long straight rivers bend in free land and keep narrow constrained routes intact', () => {
  const grid = [];
  for (let q = -2; q <= 9; q++)
    for (let r = -3; r <= 3; r++) grid.push({ q, r, key: `${q},${r}`, water: null });
  const byKey = new Map(grid.map((cell) => [cell.key, cell]));
  const route = Array.from({ length: 8 }, (_, q) => byKey.get(`${q},0`));
  const bent = bendLongRiverRuns(route, byKey, new Set(), randomFor('bend', 'test'));
  assert.equal(bent[0], route[0]);
  assert.equal(bent.at(-1), route.at(-1));
  assert.ok(bent.some((cell) => cell.r !== 0));
  let last,
    run = 0;
  for (let i = 1; i < bent.length; i++) {
    const direction = `${bent[i].q - bent[i - 1].q},${bent[i].r - bent[i - 1].r}`;
    run = direction === last ? run + 1 : 1;
    assert.ok(run < 4);
    last = direction;
    for (let j = 0; j < i - 1; j++)
      assert.ok(distance(bent[i], bent[j]) > 1, 'No self-touching detours');
  }
  const corridor = new Map(route.map((cell) => [cell.key, cell]));
  assert.deepEqual(bendLongRiverRuns(route, corridor, new Set(), randomFor('bend', 'test')), route);
});

test('200 worlds preserve mainland, coasts, short peninsulas, lakes and winding drainage', () => {
  let confluences = 0,
    archipelagos = 0;
  const longestRivers = [];
  let turns = 0;
  let longStraightReaches = 0;
  const waterFractions = [];
  for (let seed = 0; seed < 200; seed++) {
    const world = generateWorld(String(seed));
    const { cells, geography, hydrology } = world;
    const byKey = new Map(cells.map((cell) => [cell.key, cell]));
    const mainland = cells.filter((cell) => !cell.islandId && cell.water !== 'ocean');
    assert.equal(components(mainland, byKey).length, 1, `mainland ${seed}`);
    const coastline = cells.map((cell) => ({
      ...cell,
      water: cell.water === 'river' || cell.water === 'lake' ? null : cell.water,
    }));
    const coastByKey = new Map(coastline.map((cell) => [cell.key, cell]));
    assert.ok(
      narrowPeninsulaChains(coastline, coastByKey).every((chain) => chain.length <= 2),
      `peninsula limit ${seed}`,
    );
    longestRivers.push(Math.max(0, ...cells.map((cell) => cell.drainageRank ?? 0)));
    for (const source of hydrology.sources) {
      let current = byKey.get(source),
        previousDirection,
        run = 0;
      while (current.water === 'river') {
        const next = byKey.get(current.downstream);
        const direction = `${next.q - current.q},${next.r - current.r}`;
        run = direction === previousDirection ? run + 1 : 1;
        if (run === 4) longStraightReaches++;
        previousDirection = direction;
        current = next;
      }
    }
    archipelagos += geography.archipelagos.length;
    if (geography.coastEdges.length)
      waterFractions.push(cells.filter((cell) => cell.water === 'ocean').length / cells.length);
    for (const cell of cells) {
      const coast = cell.edgeSides.some((side) => geography.coastEdges.includes(side));
      if (coast) assert.equal(cell.water, 'ocean', `coast edge ${seed}/${cell.key}`);
      else if (cell.edgeSides.length)
        assert.notEqual(cell.water, 'ocean', `inland edge ${seed}/${cell.key}`);
      if (cell.islandId) {
        assert.equal(cell.edgeSides.length, 0);
        for (const next of neighbours(cell, byKey))
          assert.ok(next.water === 'ocean' || next.islandId === cell.islandId);
      }
      if (cell.water !== 'river') continue;
      if (cell.upstream.length === 1) {
        const previous = byKey.get(cell.upstream[0]),
          next = byKey.get(cell.downstream);
        if (previous.q + next.q !== cell.q * 2 || previous.r + next.r !== cell.r * 2) turns++;
      }
      if (cell.upstream.length > 1) confluences++;
      for (const next of neighbours(cell, byKey).filter((next) => next.water === 'river')) {
        assert.ok(
          cell.downstream === next.key || next.downstream === cell.key,
          `unjoined rivers ${seed}/${cell.key}`,
        );
      }
      const visited = new Set();
      let current = cell;
      while (current.water === 'river') {
        assert.ok(!visited.has(current.key), 'No drainage cycles');
        visited.add(current.key);
        const next = byKey.get(current.downstream);
        assert.ok(next);
        assert.equal(distance(current, next), 1);
        if (next.water === 'river') {
          assert.ok(next.riverWidth >= current.riverWidth);
          assert.ok(next.riverWidth - current.riverWidth < 0.035, 'Gradual width changes');
          assert.ok(next.flow > current.flow);
          assert.ok(next.drainageRank < current.drainageRank);
          assert.ok(next.upstream.includes(current.key));
        }
        current = next;
      }
      assert.ok(current.water === 'ocean' || current.water === 'lake');
    }
    for (const region of world.regions)
      assert.ok(hydrology.lakes.filter((lake) => lake.regionId === region.id).length <= 2);
    for (const lake of hydrology.lakes) {
      const group = lake.hexKeys.map((key) => byKey.get(key));
      assert.ok(group.length >= 1 && group.length <= 5);
      assert.equal(components(group, byKey).length, 1);
      for (const cell of group) {
        assert.equal(cell.edgeSides.length, 0);
        for (const next of neighbours(cell, byKey)) {
          assert.ok(
            !next.water || next.water === 'river' || next.lakeId === lake.id,
            'Lake enclosed by land, allowing river mouths',
          );
        }
      }
    }
    for (const island of geography.islands) {
      assert.ok(island.hexKeys.length >= 1 && island.hexKeys.length <= 5);
      assert.equal(
        components(
          island.hexKeys.map((key) => byKey.get(key)),
          byKey,
        ).length,
        1,
      );
    }
  }
  assert.ok(confluences > 0);
  assert.ok(archipelagos > 0);
  assert.ok(longestRivers.sort((a, b) => a - b)[100] >= 8, 'Longer main stems across the sample');
  assert.ok(turns > 400, 'Routes turn across the drainage field');
  assert.ok(longStraightReaches < 15, 'Long axis-aligned runs are rare when bends can fit');
  assert.ok(Math.min(...waterFractions) < 0.3 && Math.max(...waterFractions) > 0.7);
});

test('river meshes share bank height/shore samples and never cut through dry boundaries', () => {
  for (const seed of ['0', '3', '4', '7', '8', '17']) {
    const world = generateWorld(seed);
    const before = JSON.stringify(world);
    const map = prepareMap(world, generateDressing(world));
    assert.equal(JSON.stringify(world), before);
    const byKey = new Map(map.map((cell) => [cell.key, cell]));
    for (const cell of map.filter((cell) => cell.mouthSurface)) {
      const contributors = world.cells.filter((river) => river.downstream === cell.key);
      for (const mouth of cell.river.mouths) {
        assert.ok(
          contributors.some((river) => river.riverWidth === mouth.width),
          'No width jump at the river mouth',
        );
        const valueAt = (depth, across) =>
          riverLandValue(
            cell.river,
            mouth.x + mouth.nx * depth - mouth.nz * across,
            mouth.z + mouth.nz * depth + mouth.nx * across,
          );
        assert.ok(valueAt(0.05, 0) < 0, 'Mouth keeps its channel open');
        assert.ok(valueAt(0.05, 0.4) > 0, 'Bank continues smoothly into receiving water');
        assert.ok(valueAt(0.45, 0.4) < 0, 'Rounded bank ends inside receiving water');
      }
    }
    for (const cell of map.filter((cell) => cell.riverSurface)) {
      assert.ok(cell.riverSurface.vertices.flat().every(Number.isFinite));
      const water = cell.riverSurface.water;
      assert.ok(water.vertices.flat().every(Number.isFinite));
      const areaOf = (surface) =>
        surface.triangles.reduce((sum, face) => {
          const [a, b, c] = face.map((index) => surface.vertices[index]);
          return sum + ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])) / 2;
        }, 0);
      assert.ok(
        Math.abs(areaOf(cell.riverSurface) + areaOf(water) - (3 * Math.sqrt(3)) / 2) < 1e-7,
        'Bank and clipped water cover the tile without holes',
      );
      if (!cell.mouthSurface) {
        for (const vertex of water.vertices)
          for (const corner of cell.riverCorners)
            assert.ok(
              Math.hypot(vertex[0] - corner[0], vertex[2] - corner[1]) > 0.04,
              'Water never reaches dry tile corners',
            );
      }
      for (const face of cell.riverSurface.triangles) {
        const [a, b, c] = face.map((index) => cell.riverSurface.vertices[index]);
        assert.ok((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) >= -1e-9);
        const apothem = Math.sqrt(3) / 2;
        const radii = [a, b, c].map(
          ([x, , z]) =>
            Math.max(
              Math.abs(x),
              Math.abs(x * 0.5 + z * apothem),
              Math.abs(x * 0.5 - z * apothem),
            ) / apothem,
        );
        assert.ok(
          Math.max(...radii) <= 0.92 + 1e-8 || Math.min(...radii) >= 0.92 - 1e-8,
          'Triangles stop at the exact land bevel crease',
        );
      }
      for (let side = 0; side < 6; side++) {
        const [q, r] = DIRECTIONS[side];
        const next = byKey.get(`${cell.q + q},${cell.r + r}`);
        const nx = Math.cos((side * Math.PI) / 3),
          nz = Math.sin((side * Math.PI) / 3);
        for (let sample = 1; sample < 28; sample++) {
          const t = sample / 28 - 0.5;
          const x = cell.wx + (nx * Math.sqrt(3)) / 2 - nz * t;
          const z = cell.wz + (nz * Math.sqrt(3)) / 2 + nx * t;
          const value = riverLandValue(cell.river, x, z);
          if (!next?.water && !cell.mouthSurface) {
            assert.ok(value >= 0, 'Continuous bank at dry edge');
            assert.ok(
              Math.abs(surfaceHeight(cell.riverSurface, x - cell.wx, z - cell.wz) - 0.065) < 1e-6,
              'River border keeps the ordinary tile bevel',
            );
          }
          if (next?.riverSurface) {
            if (!cell.mouthSurface && !next.mouthSurface)
              assert.ok(
                Math.abs(value - riverLandValue(next.river, x, z)) < 1e-8,
                'Shared shoreline',
              );
            const otherValue = riverLandValue(next.river, x, z);
            if (Math.abs(value) > 0.015 && Math.abs(otherValue) > 0.015)
              assert.equal(value > 0, otherValue > 0, 'Mouth opening shares the river shoreline');
            if (value > 0.01 && otherValue > 0.01)
              assert.ok(
                Math.abs(
                  surfaceHeight(cell.riverSurface, x - cell.wx, z - cell.wz) -
                    surfaceHeight(next.riverSurface, x - next.wx, z - next.wz),
                ) < 1e-6,
                'Shared bank height',
              );
          }
        }
      }
    }
  }
});

test('palette preferences round-trip; malformed/blocked browser storage is harmless', () => {
  let stored;
  const storage = {
    getItem: () => stored,
    setItem: (_, value) => {
      stored = value;
    },
  };
  const saved = {
    seed: 'bay',
    variant: 4,
    colors: ['#282039', '#237d89', '#e5b96e'],
    palettes: [{ name: 'Test', colors: ['#282039', '#237d89', '#e5b96e'] }],
  };
  assert.equal(savePreferences(storage, saved), true);
  assert.deepEqual(readPreferences(storage), saved);
  assert.equal(savePreferences(storage, { ...saved, motion: false }), true);
  assert.equal(readPreferences(storage).motion, false);
  assert.equal(savePreferences(storage, { ...saved, settingsOpen: false }), true);
  assert.equal(readPreferences(storage).settingsOpen, false);
  assert.equal(savePreferences(storage, { ...saved, settingsOpen: true }), true);
  assert.equal(readPreferences(storage).settingsOpen, true);
  stored = JSON.stringify({ version: 1, motion: 'false' });
  assert.equal(readPreferences(storage).motion, undefined);
  stored = JSON.stringify({ version: 1, settingsOpen: 'false' });
  assert.equal(readPreferences(storage).settingsOpen, undefined);
  stored = '{broken';
  assert.deepEqual(readPreferences(storage), {});
  stored = JSON.stringify({ version: 1, colors: ['red'], palettes: [{ name: 'bad', colors: [] }] });
  assert.equal(readPreferences(storage).colors, undefined);
  assert.deepEqual(readPreferences(storage).palettes, []);
  assert.deepEqual(readPreferences(undefined), {});
  assert.equal(savePreferences(undefined, saved), false);
});
