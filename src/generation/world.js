import { createTopology } from '../map-data.js';
import { normalizeSeed, randomFor } from './seed.js';
import { generateGeography } from './geography.js';
import { generateHydrology } from './hydrology.js';
import { generateElevation } from './elevation.js';
import { generateTerrainTypes, generateFarmlands } from './terrain-types.js';
import { generateMapName } from './map-names.js';
import { generatePropDressing } from './props.js';
import { prepareMountainRanges } from './mountain-surfaces.js';
import { generatePointsOfLight } from './points-of-light.js';
import { generatePointsOfInterest } from './points-of-interest.js';

export const GENERATOR_VERSION = 6;

export function generateWorld(seed) {
  const world = {
    schemaVersion: 1,
    generatorVersion: GENERATOR_VERSION,
    seed: normalizeSeed(seed),
    ...createTopology(),
    scale: { hexSpacingKm: 18 },
    stages: {
      geography: true,
      hydrology: true,
      elevation: true,
      mountains: true,
      terrain: true,
      pointsOfLight: true,
      pointsOfInterest: true,
      props: true,
    },
  };
  Object.assign(world, generateMapName(world.seed));
  generateGeography(world);
  generateHydrology(world);
  generateElevation(world);
  generateTerrainTypes(world);
  generatePointsOfLight(world);
  generateFarmlands(world);
  generatePointsOfInterest(world);
  return world;
}

// Cosmetic state is deliberately outside the world. Replaying a variant is also
// deterministic; creating/regenerating a map advances only this dressing stream.
export function generateDressing(world, variant = 0) {
  const dressing = {
    seed: world.seed,
    variant,
    enabled: world.stages.props,
    mountains:
      world.stages.props && world.stages.mountains
        ? world.elevation.ranges.map((range) => {
            const ridgeRandom = randomFor(world.seed, `mountains:${range.id}:${variant}`);
            return {
              rangeId: range.id,
              phase: ridgeRandom() * Math.PI * 2,
              angle: ridgeRandom() * Math.PI,
              heightScale: 0.6,
            };
          })
        : [],
    cells: [],
  };
  dressing.cells = world.stages.props
    ? generatePropDressing(world, variant, prepareMountainRanges(world, dressing))
    : world.cells.map((cell) => ({ key: cell.key, placementSeed: 0, props: [] }));
  return dressing;
}
