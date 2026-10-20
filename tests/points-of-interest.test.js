import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import {
  POI_RULES,
  poiAnchor,
  generatePointsOfInterest,
  poiSuitability,
  interiorCrossingCandidate,
} from '../src/generation/points-of-interest.js';
import { prepareRiverGeometry, riverFieldFor } from '../src/generation/presentation.js';
import { riverLandValue, riverIslandValue } from '../src/generation/river-surfaces.js';
import { distance, neighbours } from '../src/generation/hex.js';
import { fitsHex } from '../src/generation/legacy.js';
import { isBarrier, barrierDistance } from '../src/generation/settlement-props.js';
import { prepareMountainRanges } from '../src/generation/mountain-surfaces.js';
import { surfaceHeight } from '../src/generation/math.js';

test('POI footings sample the surrounding mountain surface instead of a uniform column', () => {
  const world = generateWorld('5');
  const dressing = generateDressing(world, 0);
  const mountains = prepareMountainRanges(world, dressing);
  let checked = 0;
  for (const cell of dressing.cells) {
    const surface = mountains.get(cell.key)?.surface;
    for (const prop of cell.props.filter((p) => p.kind === 'poi')) {
      if (!surface) {
        assert.equal(prop.foundationHeights, undefined);
        continue;
      }
      checked++;
      assert.equal(prop.foundationHeights.length, 12);
      for (let k = 0; k < 12; k++) {
        const ground = surfaceHeight(
          surface,
          prop.x + Math.cos((k * Math.PI) / 6) * prop.footprint,
          prop.z + Math.sin((k * Math.PI) / 6) * prop.footprint,
        );
        assert.ok(Math.abs(prop.y + prop.foundationHeights[k] + 0.015 - ground) < 1e-9);
      }
    }
  }
  assert.ok(checked > 0);
});

test('POIs replay without changing earlier generation or moving on Regenerate', () => {
  const world = generateWorld('7');
  const earlier = world.cells.map(({ pointsOfInterest, crossing, ...cell }) => cell);
  const replay = generatePointsOfInterest(structuredClone(world));
  assert.deepEqual(replay, world);
  assert.deepEqual(
    replay.cells.map(({ pointsOfInterest, crossing, ...cell }) => cell),
    earlier,
  );
  const before = JSON.stringify(world);
  const a = generateDressing(world, 8),
    b = generateDressing(world, 9);
  assert.equal(JSON.stringify(world), before);
  assert.deepEqual(a, generateDressing(world, 8));
  assert.notDeepEqual(a, b);
  for (const [i, cell] of a.cells.entries()) {
    const pois = cell.props.filter((p) => p.kind === 'poi');
    assert.deepEqual(
      pois.map((p) => [p.poiKind, p.variant, p.x, p.z, p.detailSeed]),
      b.cells[i].props
        .filter((p) => p.kind === 'poi')
        .map((p) => [p.poiKind, p.variant, p.x, p.z, p.detailSeed]),
    );
    for (const poi of pois) {
      const anchor = poiAnchor(poi);
      assert.equal(poi.x, anchor.x);
      assert.equal(poi.z, anchor.z);
      assert.ok(fitsHex(poi.x, poi.z, poi.footprint));
      assert.ok(Number.isFinite(poi.y) && poi.pedestalDepth >= 0.035 - 1e-9);
      for (const prop of cell.props.filter((p) => p !== poi))
        assert.ok(
          (isBarrier(prop)
            ? barrierDistance(prop, poi.x, poi.z)
            : Math.hypot(prop.x - poi.x, prop.z - poi.z)) >=
            prop.footprint + poi.footprint + 0.025 - 1e-9,
        );
    }
  }
});

test('100 worlds keep POIs sparse and suitable; crossings join dry banks near settlements', () => {
  const kinds = new Map(),
    rolls = { bridge: 0, ferry: 0, neither: 0 };
  let bonus = 0,
    crossingCount = 0;
  for (let seed = 0; seed < 100; seed++) {
    const world = generateWorld(String(seed));
    const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
    const fields = prepareRiverGeometry(world);
    for (const budget of world.poiBudgets) {
      const regional = world.pointsOfInterest.filter(
        (p) => p.regionId === budget.regionId && !p.bonus,
      );
      assert.ok(budget.target >= (budget.wild ? 2 : 1) && budget.target <= (budget.wild ? 5 : 4));
      assert.ok(regional.length <= budget.target);
      assert.ok(regional.filter((p) => p.kind === 'stronghold').length <= 1);
      if (world.cells.filter((c) => c.regionId === budget.regionId && !c.water).length >= 15)
        assert.equal(regional.length, budget.target);
    }
    for (const poi of world.pointsOfInterest) {
      const cell = byKey.get(poi.key);
      kinds.set(poi.kind, (kinds.get(poi.kind) ?? 0) + 1);
      assert.ok(!cell.water && cell.pointsOfInterest.length === 1);
      assert.equal(poi.temperature, ['encampment', 'abbey'].includes(poi.kind) ? 1 : -1);
      if (cell.pointOfLight) assert.ok(['watchtower', 'mystic'].includes(poi.kind));
      if (poi.variant === 'lighthouse')
        assert.ok(neighbours(cell, byKey).some((c) => c.water === 'ocean'));
      if (poi.kind === 'dungeon')
        assert.equal(
          poi.variant === 'mine',
          world.cells.some((c) => c.pointOfLight && distance(cell, c) <= 3),
        );
      if (poi.bonus) {
        bonus++;
        assert.equal(poi.kind, 'battlefield');
        assert.ok(
          neighbours(cell, byKey).some((c) =>
            c.pointsOfInterest.some((p) => ['stronghold', 'watchtower'].includes(p.kind)),
          ),
        );
      }
    }
    for (const roll of world.crossingRolls) rolls[roll.kind ?? 'neither']++;
    for (const [i, crossing] of world.crossings.entries()) {
      crossingCount++;
      const cell = byKey.get(crossing.key),
        field = riverFieldFor(cell, fields);
      assert.equal(cell.water, 'river');
      const settlement = world.settlements.find((s) => s.id === crossing.settlementId);
      assert.ok(cell.upstream.length === 1 && byKey.get(cell.downstream).water === 'river');
      assert.ok(
        settlement.hexKeys.some((key) => distance(cell, byKey.get(key)) <= 3) ||
          neighbours(cell, byKey).some(
            (terminal) =>
              terminal.water === 'river' &&
              (!terminal.upstream.length || byKey.get(terminal.downstream)?.water !== 'river') &&
              interiorCrossingCandidate(terminal, byKey) === cell &&
              settlement.hexKeys.some((key) => distance(terminal, byKey.get(key)) <= 3),
          ),
      );
      assert.equal(crossing.material, settlement.type === 'village' ? 'wood' : 'stone');
      assert.ok(crossing.a.every(Number.isFinite) && crossing.b.every(Number.isFinite));
      for (const p of [crossing.a, crossing.b]) {
        assert.ok(riverLandValue(field, cell.wx + p[0], cell.wz + p[1]) > 0);
        assert.ok(riverIslandValue(field, cell.wx + p[0], cell.wz + p[1]) < 0);
      }
      for (const other of world.crossings.slice(0, i))
        if (other.networkId === crossing.networkId)
          assert.ok(distance(cell, byKey.get(other.key)) > 5);
    }
  }
  assert.ok(
    POI_RULES.filter((r) => !['bridge', 'ferry'].includes(r.kind)).every((r) => kinds.has(r.kind)),
  );
  assert.ok(kinds.get('mystic') < kinds.get('encampment') * 0.5);
  assert.ok(kinds.get('battlefield') < kinds.get('ruins') * 0.6);
  assert.ok(bonus > 10 && crossingCount > 100);
  const total = Object.values(rolls).reduce((a, b) => a + b, 0);
  for (const [kind, share] of [
    ['bridge', 0.5],
    ['ferry', 0.3],
    ['neither', 0.2],
  ])
    assert.ok(Math.abs(rolls[kind] / total - share) < 0.05);
});

test('source and mouth crossing candidates move one river hex inward', () => {
  const source = { key: '0,0', water: 'river', upstream: [], downstream: '1,0' };
  const middle = { key: '1,0', water: 'river', upstream: ['0,0'], downstream: '2,0' };
  const mouth = { key: '2,0', water: 'river', upstream: ['1,0'], downstream: '3,0' };
  const ocean = { key: '3,0', water: 'ocean' };
  const byKey = new Map([source, middle, mouth, ocean].map((cell) => [cell.key, cell]));
  assert.equal(interiorCrossingCandidate(source, byKey), middle);
  assert.equal(interiorCrossingCandidate(mouth, byKey), middle);
  assert.equal(interiorCrossingCandidate(middle, byKey), middle);
});

test('POI suitability encodes preferences, cliff bias and settlement exclusions', () => {
  const meadow = { key: '0,0', q: 0, r: 0, terrain: 'meadow', elevation: 2 };
  const context = {
    byKey: new Map([['0,0', meadow]]),
    pl: () => 99,
    smallPL: () => 99,
    mountain: () => 99,
    lake: () => 99,
    canyon: new Set(),
  };
  const score = (kind, cell = meadow, overrides = {}) =>
    poiSuitability(kind, cell, { ...context, ...overrides });
  assert.ok(
    score('dungeon', { ...meadow, elevation: 4, terrain: 'mountains' }) > score('dungeon') * 10,
  );
  assert.ok(score('lair', meadow, { pl: () => 1 }) < score('lair') / 10);
  assert.ok(score('ruins', { ...meadow, terrain: 'wetlands' }) > score('ruins'));
  assert.ok(
    score('abbey', { ...meadow, terrain: 'farmlands' }, { smallPL: () => 1 }) > score('abbey') * 10,
  );
  const cliff = new Map([['1,0', { q: 1, r: 0, elevation: 0 }]]);
  assert.ok(score('watchtower', meadow, { byKey: cliff }) >= score('watchtower') * 5);
  for (const rule of POI_RULES.filter((r) => !['bridge', 'ferry'].includes(r.kind)))
    assert.equal(
      score(rule.kind, { ...meadow, pointOfLight: { type: 'village' } }) > 0,
      ['watchtower', 'mystic'].includes(rule.kind),
    );
});
