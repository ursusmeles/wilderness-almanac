import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMountainRanges } from '../src/generation/mountain-surfaces.js';
import { surfaceHeight } from '../src/generation/math.js';
import { DIRECTIONS } from '../src/generation/hex.js';

test('mountain dressing replays, changes by variant and stays on level-four footprints', () => {
  for (const seed of ['0', '7', '17', 'elevation']) {
    const world = generateWorld(seed);
    const before = JSON.stringify(world);
    const dressing = generateDressing(world, 3);
    const surfaces = prepareMountainRanges(world, dressing);
    assert.deepEqual(surfaces, prepareMountainRanges(world, generateDressing(world, 3)));
    const next = prepareMountainRanges(world, generateDressing(world, 4));
    if (surfaces.size) assert.notDeepEqual(surfaces, next);
    assert.equal(JSON.stringify(world), before, 'Dressing cannot change terrain or hydrology');
    assert.equal(surfaces.size, world.cells.filter((cell) => cell.elevation === 4).length);
    for (const cell of world.cells) {
      const data = surfaces.get(cell.key);
      assert.equal(!!data, cell.elevation === 4);
      if (!data) continue;
      assert.ok(!cell.water && !cell.islandId);
      const heights = data.surface.vertices.map((vertex) => vertex[1]);
      assert.ok(data.surface.vertices.flat().every(Number.isFinite));
      assert.ok(Math.min(...heights) >= 0 && Math.max(...heights) <= 1.2);
      assert.ok(Math.max(...heights) > 0.2, 'Readable ridge silhouette');
      assert.deepEqual(data.shared, next.get(cell.key).shared);
      assert.deepEqual(data.corners, next.get(cell.key).corners);
    }
    world.stages.props = false;
    assert.equal(prepareMountainRanges(world, generateDressing(world, 3)).size, 0);
  }
});

test('range profiles mix low rounded terrain with occasional prominent relief', () => {
  const peaks = [];
  for (const seed of ['0', '1', '2', '3', '7']) {
    const world = generateWorld(seed);
    const surfaces = prepareMountainRanges(world, generateDressing(world));
    for (const range of world.elevation.ranges)
      peaks.push(
        Math.max(
          ...range.hexKeys.flatMap((key) =>
            surfaces.get(key).surface.vertices.map((vertex) => vertex[1]),
          ),
        ),
      );
  }
  assert.ok(
    peaks.some((height) => height < 0.55),
    'Keep low rounded ranges',
  );
  assert.ok(
    peaks.some((height) => height > 0.7),
    'Some ranges have prominent summits',
  );
  assert.ok(Math.max(...peaks) - Math.min(...peaks) > 0.3, 'Range silhouettes vary substantially');
});

test('legacy mountain locks retain their old numeric shape in current campaigns', () => {
  const world = generateWorld('7');
  const oldWorld = { ...world, generatorVersion: 8 };
  const mountainLocks = Object.fromEntries(
    world.elevation.ranges.map((range) => [
      range.id,
      {
        phase: 0.7,
        angle: 1.2,
        heightScale: 0.6,
      },
    ]),
  );
  const current = generateDressing(world, 2, { mountainLocks });
  const legacy = generateDressing(oldWorld, 2, { mountainLocks });
  assert.deepEqual(prepareMountainRanges(world, current), prepareMountainRanges(oldWorld, legacy));
});

test('connected mountain meshes share exact heights and taper to their outside perimeter', () => {
  const world = generateWorld('7');
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const surfaces = prepareMountainRanges(world, generateDressing(world, 3));
  let checkedJoins = 0;
  for (const [key, data] of surfaces) {
    const cell = byKey.get(key);
    for (let sector = 0; sector < 6; sector++) {
      const a = data.corners[sector],
        b = data.corners[(sector + 1) % 6];
      const side = (7 - sector) % 6;
      const [q, r] = DIRECTIONS[side];
      const next = byKey.get(`${cell.q + q},${cell.r + r}`);
      const other = next && surfaces.get(next.key);
      for (let sample = 0; sample <= 8; sample++) {
        const t = sample / 8,
          x = a[0] * (1 - t) + b[0] * t,
          z = a[1] * (1 - t) + b[1] * t;
        const height = surfaceHeight(data.surface, x, z);
        if (other) {
          checkedJoins++;
          assert.ok(
            Math.abs(
              height - surfaceHeight(other.surface, x + cell.wx - next.wx, z + cell.wz - next.wz),
            ) < 1e-7,
            `Continuous range at ${key}/${next.key}`,
          );
        } else assert.ok(Math.abs(height) < 1e-7, 'Mountain emerges from its tile base');
      }
    }
  }
  assert.ok(checkedJoins > 100);
});
