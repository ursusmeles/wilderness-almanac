import { TERRAIN_TYPES } from '../generation/terrain-types.js';
import { isVineyard } from '../generation/farmland-patches.js';

// Vineyards are an editor choice for farmland dressing, not a new world terrain.
export const TERRAIN_OPTIONS = TERRAIN_TYPES.flatMap((terrain) =>
  terrain === 'farmlands' ? [terrain, 'vineyards'] : [terrain],
);

export const terrainValue = (cell, props, cropStyle) =>
  cell.terrain === 'farmlands' &&
  (isVineyard(cell, props) ||
    (!props?.some((prop) => prop.kind === 'crops') && cropStyle === 'vineyard'))
    ? 'vineyards'
    : cell.terrain;

export const terrainPatch = (value) =>
  value === 'vineyards'
    ? { terrain: 'farmlands', cropStyle: 'vineyard' }
    : value === 'farmlands'
      ? { terrain: value, cropStyle: 'grain' }
      : { terrain: value };
