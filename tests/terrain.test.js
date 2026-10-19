import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { generateMapName, nameModifiers, NAME_WORDS } from '../src/generation/map-names.js';
import {
  generateTerrainTypes,
  generateFarmlands,
  TERRAIN_TYPES,
} from '../src/generation/terrain-types.js';
import { chooseCitySize, generatePointsOfLight } from '../src/generation/points-of-light.js';
import { randomFor } from '../src/generation/seed.js';
import { components, distance, neighbours, DIRECTIONS } from '../src/generation/hex.js';
import { fitsHex, fitsTree, lowProp, minimumSpacing } from '../src/generation/legacy.js';
import { TOKEN_ANCHOR } from '../src/generation/props.js';
import { isBarrier, barrierEnds, barrierDistance } from '../src/generation/settlement-props.js';
import { createColorScale, palettes } from '../src/palette.js';

test('names replay in sentence case from the 30-by-30 Sheet snapshot', () => {
  assert.equal(NAME_WORDS.adjectives.length, 30);
  assert.equal(NAME_WORDS.nouns.length, 30);
  for (let seed = 0; seed < 100; seed++) {
    const name = generateMapName(String(seed));
    assert.deepEqual(name, generateMapName(String(seed)));
    assert.match(name.name, /^The [a-z]+ [a-z]+$/);
    assert.ok(NAME_WORDS.adjectives.some((item) => item.word === name.naming.adjective));
    assert.ok(NAME_WORDS.nouns.some((item) => item.word === name.naming.noun));
  }
  assert.equal(nameModifiers(['W', '-W']).W, 1);
  assert.equal(nameModifiers(['W', 'W']).W, 3.2);
  assert.equal(nameModifiers(['-PL', '-PL']).PL, 0.3);
});

test('name modifiers produce conspicuous differences on identical geography', () => {
  const base = generateWorld('2');
  const terrain = (modifiers) => {
    const world = structuredClone(base);
    for (const cell of world.cells) cell.pointOfLight = null;
    world.naming.weights = nameModifiers(modifiers);
    generateTerrainTypes(world);
    generatePointsOfLight(world);
    generateFarmlands(world);
    assert.deepEqual(
      world.cells.map((c) => [c.water, c.elevation, c.downstream]),
      base.cells.map((c) => [c.water, c.elevation, c.downstream]),
    );
    return world;
  };
  const neutral = terrain([]),
    wet = terrain(['W']),
    dry = terrain(['-W']);
  assert.ok(wet.terrain.counts.wetlands >= neutral.terrain.counts.wetlands * 1.8);
  assert.ok(dry.terrain.counts.wetlands <= neutral.terrain.counts.wetlands * 0.6);
  assert.ok(
    terrain(['DW']).terrain.counts['dense forest'] >= neutral.terrain.counts['dense forest'] * 1.8,
  );
  assert.ok(
    terrain(['-DW']).terrain.counts['dense forest'] <= neutral.terrain.counts['dense forest'] * 0.6,
  );
  const settled = terrain(['PL', 'F']),
    empty = terrain(['-PL', '-F']);
  assert.ok(settled.settlements.length > empty.settlements.length * 2);
  assert.ok(settled.terrain.counts.farmlands > empty.terrain.counts.farmlands * 3);
});

test('100 worlds preserve terrain suitability, clusters, open ground and settlement footprints', () => {
  let isolatedForest = 0,
    forestCount = 0,
    bigCities = 0,
    canyonWetlands = 0;
  for (let seed = 0; seed < 100; seed++) {
    const world = generateWorld(String(seed));
    const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
    const land = world.cells.filter((cell) => !cell.water);
    const open = land.filter(
      (cell) => !cell.pointOfLight && ['meadow', 'farmlands'].includes(cell.terrain),
    );
    assert.ok(open.length >= Math.ceil(land.length * 0.28));
    const forests = land.filter((cell) => cell.terrain.includes('forest'));
    forestCount += forests.length;
    isolatedForest += components(forests, byKey).filter((group) => group.length === 1).length;
    const canyonKeys = new Set(
      world.elevation.features.filter((f) => f.kind === 'canyon').flatMap((f) => f.hexKeys),
    );
    const fresh = world.cells.filter((cell) => cell.water === 'river' || cell.water === 'lake');
    for (const cell of world.cells) {
      assert.ok(TERRAIN_TYPES.includes(cell.terrain));
      if (cell.water) assert.equal(cell.terrain, cell.water === 'river' ? 'river' : 'open water');
      assert.equal(cell.terrain === 'mountains', cell.elevation === 4);
      if (cell.terrain === 'wetlands') {
        assert.ok(cell.elevation <= 1 && !cell.pointOfLight);
        assert.ok(canyonKeys.has(cell.key) || fresh.some((next) => distance(cell, next) <= 2));
        if (canyonKeys.has(cell.key)) canyonWetlands++;
      }
      if (cell.terrain === 'farmlands') {
        assert.ok(!cell.water && !cell.pointOfLight && cell.elevation <= 2);
        assert.ok(world.cells.some((next) => next.pointOfLight && distance(cell, next) <= 2));
      }
    }
    const occupied = new Set();
    for (const settlement of world.settlements) {
      const group = settlement.hexKeys.map((key) => byKey.get(key));
      assert.equal(components(group, byKey).length, 1);
      assert.ok(group.length >= 1 && group.length <= (settlement.type === 'city' ? 3 : 1));
      if (group.length > 1) bigCities++;
      assert.equal(new Set(group.map((cell) => cell.elevation)).size, 1);
      assert.equal(group.filter((cell) => cell.pointOfLight.centre).length, 1);
      for (const cell of group) {
        assert.ok(!occupied.has(cell.key));
        occupied.add(cell.key);
        assert.equal(cell.pointOfLight.id, settlement.id);
        assert.equal(cell.regionId, settlement.regionId);
        assert.ok(['meadow', 'light forest'].includes(cell.terrain));
        assert.ok(cell.elevation <= 2 && !cell.water);
        assert.ok(
          neighbours(cell, byKey).every((next) => Math.abs(next.elevation - cell.elevation) <= 1),
        );
      }
    }
    for (const region of world.regions) {
      for (const [type, maximum] of [
        ['city', 1],
        ['town', 2],
        ['village', 5],
      ])
        assert.ok(
          world.settlements.filter((s) => s.regionId === region.id && s.type === type).length <=
            maximum,
        );
    }
  }
  assert.ok(isolatedForest / forestCount < 0.04, 'Coherent forests, not independent random tiles');
  assert.ok(bigCities > 20);
  assert.ok(canyonWetlands > 20);
});

test('city footprint rolls follow 50% one, 40% two and 10% three hexes', () => {
  const counts = [0, 0, 0];
  for (let seed = 0; seed < 10000; seed++)
    counts[chooseCitySize(randomFor(String(seed), 'city-size-test')) - 1]++;
  for (const [i, share] of [0.5, 0.4, 0.1].entries())
    assert.ok(Math.abs(counts[i] / 10000 - share) < 0.02);
});

test('dressing retains crown clusters, links, spacing, token clearance and terrain-specific props', () => {
  const found = new Set();
  let touchingCrowns = 0,
    linkedEdges = 0,
    sparse = 0,
    denseTrees = 0,
    denseTiles = 0,
    lightTrees = 0,
    lightTiles = 0;
  for (const seed of ['7', '2', '17']) {
    const world = generateWorld(seed),
      before = JSON.stringify(world);
    const dressing = generateDressing(world, 8);
    assert.deepEqual(dressing, generateDressing(world, 8));
    assert.notDeepEqual(dressing, generateDressing(world, 9));
    assert.equal(JSON.stringify(world), before);
    const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
    const dressByKey = new Map(dressing.cells.map((cell) => [cell.key, cell]));
    for (const data of dressing.cells) {
      const cell = byKey.get(data.key),
        woodland = cell.terrain.includes('forest') && !cell.pointOfLight;
      const trees = data.props.filter((p) => p.kind === 'tree');
      if (woodland && data.sparse) sparse++;
      if (woodland && !data.sparse) {
        if (cell.terrain === 'dense forest') {
          denseTrees += trees.length;
          denseTiles++;
        } else {
          lightTrees += trees.length;
          lightTiles++;
        }
      }
      for (let side = 0; side < 6; side++) {
        if (!data.links[side]) continue;
        linkedEdges++;
        const [q, r] = DIRECTIONS[side],
          other = dressByKey.get(`${cell.q + q},${cell.r + r}`);
        assert.equal(other.links[(side + 3) % 6], true);
        assert.equal(byKey.get(other.key).elevation, cell.elevation);
        assert.ok(byKey.get(other.key).terrain.includes('forest'));
        assert.ok(!byKey.get(other.key).pointOfLight);
      }
      for (let i = 0; i < data.props.length; i++) {
        const prop = data.props[i];
        found.add(prop.kind);
        assert.ok(Number.isFinite(prop.y) && Math.abs(prop.temperature) <= 1);
        if (prop.kind === 'wave') {
          assert.ok(cell.water === 'ocean' || cell.water === 'lake');
          continue;
        }
        if (prop.kind === 'poi') {
          assert.ok(cell.pointsOfInterest.some((poi) => poi.kind === prop.poiKind));
          continue;
        }
        assert.ok(!cell.water);
        if (isBarrier(prop)) {
          assert.ok(barrierEnds(prop).every(([x, z]) => fitsHex(x, z, prop.footprint)));
          assert.ok(
            barrierDistance(prop, TOKEN_ANCHOR.x, TOKEN_ANCHOR.z) >=
              TOKEN_ANCHOR.r + prop.footprint,
          );
          continue;
        }
        assert.ok(
          prop.kind === 'tree' && woodland
            ? fitsTree({ links: data.links }, prop.x, prop.z, prop.footprint)
            : fitsHex(prop.x, prop.z, prop.footprint),
        );
        if (!lowProp(prop.kind))
          assert.ok(
            Math.hypot(prop.x - TOKEN_ANCHOR.x, prop.z - TOKEN_ANCHOR.z) >=
              TOKEN_ANCHOR.r + prop.footprint * 0.48,
          );
        for (const other of data.props.slice(0, i)) {
          if (isBarrier(other)) {
            assert.ok(
              barrierDistance(other, prop.x, prop.z) >=
                prop.footprint + other.footprint + 0.025 - 1e-9,
            );
            continue;
          }
          const gap = Math.hypot(prop.x - other.x, prop.z - other.z);
          assert.ok(gap >= minimumSpacing(prop, other) - 1e-9);
          if (
            prop.kind === 'tree' &&
            other.kind === 'tree' &&
            gap < prop.footprint + other.footprint
          )
            touchingCrowns++;
        }
        if (cell.terrain === 'wetlands') assert.ok(prop.temperature <= 0);
        if (cell.pointOfLight || cell.terrain === 'farmlands') assert.ok(prop.temperature >= 0);
        if (prop.kind === 'crops') assert.equal(cell.terrain, 'farmlands');
        if (prop.kind === 'puddle' || prop.kind === 'reeds') assert.equal(cell.terrain, 'wetlands');
        if (['house', 'tower', 'hall'].includes(prop.kind)) assert.ok(cell.pointOfLight);
      }
    }
  }
  assert.ok(
    ['tree', 'house', 'tower', 'hall', 'crops', 'puddle', 'reeds', 'rock', 'grass'].every((kind) =>
      found.has(kind),
    ),
  );
  assert.ok(linkedEdges > 20 && touchingCrowns > 100 && sparse > 10);
  assert.ok(denseTrees / denseTiles > lightTrees / lightTiles + 3);
});

test('open-water wave marks are sparse, spaced, deterministic and share a drift direction', () => {
  const world = generateWorld('7');
  const dressing = generateDressing(world, 8);
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const waves = dressing.cells.filter((cell) => cell.props.some((prop) => prop.kind === 'wave'));
  const open = world.cells.filter((cell) => cell.water === 'ocean' || cell.water === 'lake');
  assert.ok(waves.length > 4 && waves.length < open.length / 4);
  assert.equal(new Set(waves.map((cell) => cell.props[0].angle)).size, 1);
  for (let i = 0; i < waves.length; i++) {
    const cell = byKey.get(waves[i].key),
      wave = waves[i].props[0];
    assert.ok(wave.phase >= 0 && wave.phase < 1);
    assert.ok(
      !world.cells.some((other) => other.water === 'river' && other.downstream === cell.key),
    );
    assert.ok(fitsHex(wave.x, wave.z, wave.footprint), 'Reserved wave motion area fits its tile');
    for (let j = 0; j < i; j++) assert.ok(distance(cell, byKey.get(waves[j].key)) >= 2);
  }
});

test('prop hue temperatures preserve the base palette and stay valid for every preset', () => {
  for (const seeds of Object.values(palettes)) {
    const color = createColorScale(seeds);
    assert.equal(color(2, 0.68), color(2, 0.68, 1, 0));
    assert.notEqual(color(2, 0.68, 1, 1), color(2, 0.68, 1, -1));
    for (const temperature of [-1, -1 / 3, 0, 1 / 3, 1])
      assert.match(color(2, 0.68, 1, temperature), /^#[0-9a-f]{6}$/);
  }
});
