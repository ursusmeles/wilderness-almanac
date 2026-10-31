import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopology } from '../src/map-data.js';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { generateRoads, roadGraph, roadCellKey } from '../src/generation/roads.js';
import { roadPort, roadHeight, hexRadius } from '../src/generation/road-geometry.js';
import { directionTo } from '../src/generation/hex.js';
import {
  campaignWorld,
  campaignDressing,
  updateHex,
  updateHexes,
  lockHex,
} from '../src/generation/campaign-world.js';
import { validateHexEdits } from '../src/generation/hex-edits.js';
import { createCampaign, exportCampaign, importCampaign } from '../src/application/campaigns.js';
import { createCampaignSession } from '../src/application/campaign-session.js';
import { prepareMap } from '../src/generation/presentation.js';
import { createFogView } from '../src/application/fog-view.js';
import { describeHex } from '../src/ui/map-link.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';

const base = generateWorld('1234');
const campaign = createCampaign(base, ['#cdab8f', '#0b365e', '#11b329'], 'Forbidden Lands');
const find = (world, key) => world.cells.find((cell) => cell.key === key);
const counted = (cell) =>
  cell.road && !cell.water && !cell.pointOfLight && !cell.pointsOfInterest.length;

test('roads replay deterministically, obey the unique tile budget and avoid mountains and steep jumps', () => {
  for (const seed of ['7', '1234', 'roads', 'meadow', 'islands', 'desolated']) {
    const world = generateWorld(seed),
      graph = roadGraph(world);
    assert.deepEqual(generateWorld(seed), world);
    assert.ok(world.cells.filter(counted).length <= world.roads.budget);
    assert.ok(world.roads.budget <= Math.floor(world.roads.dryLand * 0.2));
    for (const id of world.roads.edges) {
      const edge = graph.edges.get(id);
      assert.ok(edge, id);
      for (const node of [edge.a, edge.b])
        assert.notEqual(graph.nodes.get(node).cell.terrain, 'mountains');
      if (!edge.crossing) {
        const a = graph.nodes.get(edge.a).cell,
          b = graph.nodes.get(edge.b).cell;
        assert.ok(Math.abs(a.elevation - b.elevation) <= 1);
        const side = directionTo(a, b);
        assert.ok(a.road.exits & (1 << side));
        assert.ok(b.road.exits & (1 << ((side + 3) % 6)));
      }
    }
  }
});

function corridor() {
  const world = {
    ...createTopology(),
    seed: 'corridor',
    naming: { weights: { PL: 1 } },
    preferences: {},
    settlements: [],
  };
  for (const cell of world.cells)
    Object.assign(cell, { terrain: 'mountains', elevation: 4, water: null, pointsOfInterest: [] });
  for (let q = -3; q <= 3; q++)
    Object.assign(find(world, `${q},0`), {
      terrain: 'meadow',
      elevation: q < -1 ? 0 : q < 2 ? 1 : 2,
    });
  for (const [q, type] of [
    [-3, 'city'],
    [3, 'town'],
  ]) {
    const cell = find(world, `${q},0`),
      id = `place-${q}`;
    cell.pointOfLight = { type, id, size: 1, centre: true };
    world.settlements.push({ id, type, anchorKey: cell.key, hexKeys: [cell.key] });
  }
  return world;
}

test('a lone city falls back to a town and roads can climb successive single elevation levels', () => {
  const world = generateRoads(corridor());
  assert.equal(world.roads.links.length, 1);
  assert.equal(world.roads.links[0].path.length, 7);
  const blocked = corridor();
  find(blocked, '0,0').elevation = 3;
  assert.equal(generateRoads(blocked).roads.links.length, 0);
  const mountain = corridor();
  find(mountain, '0,0').terrain = 'mountains';
  assert.equal(generateRoads(mountain).roads.links.length, 0);
});

test('negative settlement modifiers reduce the budget and over-budget routes are omitted whole', () => {
  const neutral = generateRoads(corridor());
  const sparse = corridor();
  sparse.naming.weights.PL = 0.3;
  sparse.preferences.settlements = -1;
  assert.ok(generateRoads(sparse).roads.budget < neutral.roads.budget);
  const empty = corridor();
  empty.naming.weights.PL = 0.01;
  generateRoads(empty);
  assert.equal(empty.roads.links.length, 0);
  assert.equal(empty.roads.edges.length, 0);
});

test('removing a destination deletes its complete links, retains shared links, and never reallocates budget', () => {
  const link = base.roads.links[0],
    endpoint = roadCellKey(link.path[0]);
  const cell = find(base, endpoint);
  const patch =
    link.from.kind === 'settlement'
      ? { settlement: null }
      : link.from.kind === 'crossing'
        ? { crossing: null }
        : { poi: null };
  const edited = updateHex(campaign, endpoint, patch),
    world = campaignWorld(edited, base);
  assert.equal(edited.hexEdits.version, 3);
  assert.ok(edited.hexEdits.cells[endpoint].removedRoadLinks.includes(link.id));
  assert.ok(world.roads.links.length < base.roads.links.length);
  assert.ok(world.roads.edges.every((edge) => base.roads.edges.includes(edge)));
  const removed = new Set(edited.hexEdits.cells[endpoint].removedRoadLinks);
  assert.deepEqual(
    world.roads.links,
    base.roads.links.filter((route) => !removed.has(route.id)),
  );
  const restored = updateHex(
    edited,
    endpoint,
    cell.pointOfLight
      ? { settlement: cell.pointOfLight.type }
      : cell.crossing
        ? { crossing: cell.crossing.kind }
        : {
            poi: { kind: cell.pointsOfInterest[0].kind, variant: cell.pointsOfInterest[0].variant },
          },
  );
  assert.deepEqual(
    campaignWorld(restored, base).roads.edges,
    world.roads.edges,
    'adding the destination again does not generate roads',
  );
  assert.deepEqual(
    campaignWorld(importCampaign(exportCampaign(restored))).roads,
    campaignWorld(restored, base).roads,
  );
});

test('adding eligible destinations leaves every existing road link and edge unchanged', () => {
  const cell = base.cells.find(
    (cell) =>
      !cell.water &&
      cell.terrain !== 'mountains' &&
      !cell.pointOfLight &&
      !cell.pointsOfInterest.length &&
      !cell.road,
  );
  const edited = updateHex(campaign, cell.key, {
    settlement: 'city',
    poi: { kind: 'abbey', variant: 0 },
  });
  assert.deepEqual(campaignWorld(edited, base).roads, base.roads);
});

test('manual exits connect both neighbours, survive import, and reset from either side', () => {
  const graph = roadGraph(base);
  const edge = [...graph.edges.values()].find(
    (edge) =>
      !edge.crossing &&
      !base.roads.edges.includes(edge.id) &&
      !graph.nodes.get(edge.a).bank &&
      !graph.nodes.get(edge.b).bank,
  );
  const a = graph.nodes.get(edge.a).cell,
    b = graph.nodes.get(edge.b).cell;
  const side = directionTo(a, b),
    mask = (a.road?.exits ?? 0) | (1 << side);
  const edited = updateHex(campaign, a.key, { roadExits: mask });
  const world = campaignWorld(edited, base);
  assert.ok(world.roads.edges.includes(edge.id));
  assert.ok(find(world, b.key).road.exits & (1 << ((side + 3) % 6)));
  assert.deepEqual(campaignWorld(importCampaign(exportCampaign(edited))).roads, world.roads);
  const reset = updateHexes(edited, { [b.key]: null }, base);
  assert.deepEqual(campaignWorld(reset, base).roads.edges, base.roads.edges);
  assert.throws(
    () => updateHexes(campaign, { '0,0': { roadExits: 1 } }, { ...base, roads: undefined }),
    /unavailable on this map/,
  );
  const mountain = base.cells.find((cell) => cell.terrain === 'mountains');
  assert.throws(() => updateHex(campaign, mountain.key, { roadExits: 1 }), /Roads need/);
});

test('dressing changes shapes without moving routes; locks and local rerolls preserve shared ports', () => {
  const first = generateDressing(base, 0),
    second = generateDressing(base, 1);
  const cell = base.cells.find(counted),
    shape = first.cells.find((entry) => entry.key === cell.key);
  assert.notDeepEqual(shape.roads, second.cells.find((entry) => entry.key === cell.key).roads);
  assert.deepEqual(base, generateWorld('1234'));
  const locked = lockHex(campaign, cell.key, base, first);
  const frozen = campaignDressing({ ...locked, variant: 1 }, base).cells.find(
    (entry) => entry.key === cell.key,
  );
  assert.deepEqual(frozen.roads, shape.roads);
  const imported = importCampaign(exportCampaign({ ...locked, variant: 1 }));
  assert.deepEqual(
    campaignDressing(imported, base).cells.find((entry) => entry.key === cell.key).roads,
    shape.roads,
  );
  const rerolled = campaignDressing(updateHex(campaign, cell.key, { revision: 1 }), base, {
    rerollKey: cell.key,
    fixedCells: Object.fromEntries(
      first.cells.filter((entry) => entry.key !== cell.key).map((entry) => [entry.key, entry]),
    ),
  });
  for (const other of first.cells.filter((entry) => entry.key !== cell.key))
    assert.deepEqual(rerolled.cells.find((entry) => entry.key === other.key).roads, other.roads);
  const graph = roadGraph(base);
  for (const id of base.roads.edges) {
    const edge = graph.edges.get(id);
    if (edge.crossing) continue;
    const a = graph.nodes.get(edge.a).cell,
      b = graph.nodes.get(edge.b).cell;
    const pa = roadPort(base, a, b),
      pb = roadPort(base, b, a);
    assert.ok(Math.abs(a.wx + pa.x - b.wx - pb.x) < 1e-10);
    assert.ok(Math.abs(a.wz + pa.z - b.wz - pb.z) < 1e-10);
  }
});

test('road geometry is finite, stays in the hex, meets at elevation ramps, and renders with valid picking data', () => {
  const dressing = generateDressing(base),
    layout = prepareMap(base, dressing);
  for (const data of layout.filter((cell) => cell.roads?.length)) {
    for (const path of data.roads)
      for (const [x, z] of path.points) {
        assert.ok(hexRadius(x, z) <= 1.00001);
        assert.ok(Number.isFinite(roadHeight(data, x, z, data.roadSurface)));
      }
    if (
      data.roads.length === 2 &&
      !data.water &&
      !data.pointOfLight &&
      !data.pointsOfInterest.length
    ) {
      const tangents = data.roads.map((path) => {
        const a = path.points.at(-1),
          b = path.points.at(-2);
        return [a[0] - b[0], a[1] - b[1]];
      });
      const dot =
        (tangents[0][0] * tangents[1][0] + tangents[0][1] * tangents[1][1]) /
        Math.hypot(...tangents[0]) /
        Math.hypot(...tangents[1]);
      assert.ok(dot < -0.98, 'two road branches must meet smoothly');
    }
  }
  const graph = roadGraph(base);
  for (const id of base.roads.edges) {
    const edge = graph.edges.get(id);
    if (edge.crossing) continue;
    const a = layout.find((cell) => cell.key === roadCellKey(edge.a)),
      b = layout.find((cell) => cell.key === roadCellKey(edge.b));
    const pa = roadPort(base, a, b),
      pb = roadPort(base, b, a);
    const ya = a.top + roadHeight(a, pa.x, pa.z, a.roadSurface),
      yb = b.top + roadHeight(b, pb.x, pb.z, b.roadSurface);
    assert.ok(Math.abs(ya - yb) < 0.01, `${id}: ${ya} vs ${yb}`);
  }
  const registry = createMapMaterials(),
    meshes = createMapMeshes(registry);
  try {
    meshes.setMap(layout);
    meshes.group.traverse((object) => {
      if (!object.isMesh) return;
      assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
      assert.ok(object.userData.key || object.userData.faceRanges);
    });
  } finally {
    meshes.dispose();
    registry.dispose();
  }
});

test('road names respect destination labels and undiscovered fog tiles hide road geometry', () => {
  const cell = base.cells.find(counted);
  assert.match(describeHex(cell), /with (?:a road|crossroads)$/);
  assert.doesNotMatch(
    describeHex({ ...cell, pointOfLight: { type: 'city' } }),
    /with (?:a road|crossroads)/,
  );
  const layout = prepareMap(base, generateDressing(base));
  const states = new Map(base.cells.map((entry) => [entry.key, 'undiscovered']));
  const view = createFogView(base, layout, states);
  assert.ok(view.layout.every((entry) => !entry.roads && !entry.roadSurface && !entry.road));
});

test('road edits and destination removal are saved and undone atomically', () => {
  const writes = [],
    session = createCampaignSession({
      persist: (record) => {
        writes.push(record);
        return { campaignSaved: true, preferencesSaved: true };
      },
    });
  session.open(campaign, base);
  const link = base.roads.links[0],
    key = roadCellKey(link.path[0]);
  session.select(key);
  const before = session.snapshot();
  const patch =
    link.from.kind === 'settlement'
      ? { settlement: null }
      : link.from.kind === 'crossing'
        ? { crossing: null }
        : { poi: null };
  const count = writes.length;
  assert.equal(session.apply(patch).ok, true);
  assert.equal(writes.length, count + 1);
  assert.ok(session.snapshot().world.roads.links.length < before.world.roads.links.length);
  assert.equal(session.undo().ok, true);
  assert.deepEqual(session.snapshot().world.roads, before.world.roads);
});

test('imports reject malformed road overrides and frozen shapes', () => {
  for (const edit of [
    { road: [true] },
    { road: Array(6).fill('yes') },
    { removedRoadLinks: ['arbitrary'] },
    {
      road: Array(6).fill(null),
      lock: { props: [], roadShape: { variant: Infinity, revision: 0 } },
    },
  ])
    assert.throws(() => validateHexEdits({ version: 3, cells: { '0,0': edit } }));
  assert.throws(() =>
    validateHexEdits({ version: 2, cells: { '0,0': { road: Array(6).fill(true) } } }),
  );
});
