import { createTopology } from '../map-data.js';
import { generateRoads } from './roads.js';
import { randomFor } from './seed.js';

// An explicit fixture within the versioned pipeline, using ordinary world data.
export function sandboxWorld(world) {
  Object.assign(world, createTopology({ radius: 1, sites: [[0, 0]] }), {
    name: 'Heliotest',
    geography: { coastEdges: [0], islands: [], archipelagos: [], waterFraction: 1 / 7 },
    hydrology: { lakes: [], sources: [], riverKeys: [], meanderBends: [] },
    elevation: { ranges: [{ id: 'range-1', hexKeys: ['0,-1'] }], features: [] },
    terrain: { openLandMinimum: 0, counts: {} },
    settlements: [
      { id: 'settlement-1', type: 'town', regionId: 1, anchorKey: '0,0', hexKeys: ['0,0'] },
    ],
    crossings: [],
  });
  const definitions = {
    '0,-1': ['mountains', 4, { kind: 'lair', variant: 'nest' }],
    '1,-1': ['dense forest', 3],
    '1,0': ['light forest', 2, { kind: 'abbey', variant: 0 }],
    '0,1': ['open water', 0],
    '-1,1': ['meadow', 0],
    '-1,0': ['farmlands', 1, { kind: 'encampment', variant: 0 }],
    '0,0': ['meadow', 1],
  };
  for (const cell of world.cells) {
    const [terrain, elevation, poi] = definitions[cell.key];
    Object.assign(cell, {
      terrain,
      elevation,
      treeVariant: cell.key === '1,-1' ? 0 : 1,
    });
    if (cell.key === '0,-1') cell.mountainRangeId = 'range-1';
    if (cell.key === '0,1') cell.water = 'ocean';
    if (cell.key === '1,-1') cell.forestType = 'pine';
    if (cell.key === '1,0') cell.forestType = 'ash';
    if (cell.key === '-1,0') cell.cropStyle = 'vineyard';
    if (cell.key === '0,0')
      cell.pointOfLight = { id: 'settlement-1', type: 'town', size: 1, centre: true };
    if (poi)
      cell.pointsOfInterest = [
        {
          ...poi,
          id: `sandbox-poi:${cell.key}`,
          key: cell.key,
          regionId: 1,
          detailSeed: Math.floor(randomFor(world.seed, `poi:${cell.key}`)() * 4294967296),
          temperature: 1,
        },
      ];
    world.terrain.counts[terrain] = (world.terrain.counts[terrain] ?? 0) + 1;
  }
  world.pointsOfInterest = world.cells.flatMap((cell) => cell.pointsOfInterest);
  generateRoads(world);
  return world;
}
