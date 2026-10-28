import { TERRAIN_TYPES } from './terrain-types.js';
import rules from '../data/world-rules.json' with { type: 'json' };
import { fieldInset, polygonArea } from './farmland-patches.js';
import { fitsHex } from './prop-placement.js';

export const SETTLEMENT_TYPES = ['village', 'town', 'city'];
export const POI_TYPES = rules.pointsOfInterest
  .filter((rule) => !['bridge', 'ferry'].includes(rule.kind))
  .map((rule) => rule.kind);
export const POI_VARIANTS = {
  watchtower: ['watchtower', 'lighthouse'],
  lair: ['cave', 'nest'],
  dungeon: ['dungeon', 'mine'],
  mystic: ['portal', 'altar', 'standing stone'],
};
export const variantsFor = (kind) => POI_VARIANTS[kind] ?? [0, 1, 2];
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
const validKey = (key) => {
  if (!/^-?\d{1,2},-?\d{1,2}$/.test(key)) return false;
  const [q, r] = key.split(',').map(Number);
  return `${q},${r}` === key && Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 12;
};
const fail = () => {
  throw new Error('The campaign contains invalid hex edits.');
};
const propKinds = [
  'tree',
  'house',
  'tower',
  'hall',
  'city-wall',
  'fence',
  'rock',
  'grass',
  'puddle',
  'reeds',
  'crops',
  'wave',
  'poi',
];
const numericFields = [
  'x',
  'y',
  'z',
  'footprint',
  'scale',
  'angle',
  'detailSeed',
  'temperature',
  'pedestalDepth',
  'side',
  'length',
  'storeys',
  'phase',
  'foliageTone',
];

// Persist bounded prop descriptors, never imported meshes or arbitrary object keys.
function validateLock(value, key) {
  if (!record(value) || !Array.isArray(value.props) || value.props.length > 128) fail();
  const props = value.props.map((source) => {
    if (!record(source) || !propKinds.includes(source.kind)) fail();
    const prop = { kind: source.kind };
    for (const field of numericFields)
      if (source[field] !== undefined) {
        if (!Number.isFinite(source[field]) || Math.abs(source[field]) > 4294967296) fail();
        prop[field] = source[field];
      }
    if (
      !['x', 'y', 'z', 'footprint'].every((field) => Number.isFinite(prop[field])) ||
      Math.abs(prop.x) > 2 ||
      Math.abs(prop.z) > 2 ||
      Math.abs(prop.y) > 3 ||
      prop.footprint <= 0 ||
      prop.footprint > 2
    )
      fail();
    if (source.scale !== undefined && (source.scale <= 0 || source.scale > 3)) fail();
    if (source.length !== undefined && (source.length <= 0 || source.length > 3)) fail();
    if (
      source.pedestalDepth !== undefined &&
      (source.pedestalDepth < 0 || source.pedestalDepth > 3)
    )
      fail();
    if (
      source.side !== undefined &&
      (!Number.isInteger(source.side) || source.side < 0 || source.side > 5)
    )
      fail();
    if (source.temperature !== undefined && Math.abs(source.temperature) > 1) fail();
    if (source.foliageTone !== undefined && ![-1, 0, 1].includes(source.foliageTone)) fail();
    if (source.cropStyle !== undefined) {
      if (source.kind !== 'crops' || !['plots', 'grain', 'vineyard'].includes(source.cropStyle))
        fail();
      prop.cropStyle = source.cropStyle;
    }
    if (source.patch !== undefined) {
      if (
        source.kind !== 'crops' ||
        source.cropStyle !== 'grain' ||
        source.scale !== 1 ||
        source.angle !== 0 ||
        !Array.isArray(source.patch) ||
        source.patch.length < 3 ||
        source.patch.length > 24
      )
        fail();
      const points = source.patch;
      if (
        !points.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every(Number.isFinite) &&
            Math.hypot(...point) <= prop.footprint + 1e-6 &&
            fitsHex(point[0] + prop.x, point[1] + prop.z, 0),
        )
      )
        fail();
      if (
        polygonArea(points) < 0.01 ||
        points.some((a, i) => {
          const b = points[(i + 1) % points.length];
          return Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6;
        }) ||
        points.some(([x, z]) => fieldInset(points, x, z) < -1e-7)
      )
        fail();
      prop.patch = points.map((point) => point.slice());
    }
    if (source.fruit !== undefined) {
      if (
        source.kind !== 'tree' ||
        typeof source.fruit !== 'boolean' ||
        (source.fruit && source.variant !== 1)
      )
        fail();
      prop.fruit = source.fruit;
    }
    if (
      source.storeys !== undefined &&
      (!Number.isInteger(source.storeys) || source.storeys < 1 || source.storeys > 4)
    )
      fail();
    if (source.kind === 'poi') {
      if (
        !POI_TYPES.includes(source.poiKind) ||
        !variantsFor(source.poiKind).includes(source.variant)
      )
        fail();
      prop.poiKind = source.poiKind;
      prop.variant = source.variant;
    } else if (source.variant !== undefined) {
      if (!Number.isInteger(source.variant) || source.variant < 0 || source.variant > 2) fail();
      prop.variant = source.variant;
    }
    if (source.roof !== undefined) {
      if (source.roof !== 'straw') fail();
      prop.roof = source.roof;
    }
    for (const field of ['wind', 'flank'])
      if (source[field] !== undefined) {
        if (typeof source[field] !== 'boolean') fail();
        prop[field] = source[field];
      }
    if (source.zone !== undefined) {
      if (!['canopy', 'outlier'].includes(source.zone)) fail();
      prop.zone = source.zone;
    }
    if (source.foundationHeights !== undefined) {
      if (
        !Array.isArray(source.foundationHeights) ||
        source.foundationHeights.length !== 12 ||
        !source.foundationHeights.every((n) => Number.isFinite(n) && Math.abs(n) < 3)
      )
        fail();
      prop.foundationHeights = source.foundationHeights.slice();
    }
    return prop;
  });
  const lock = {
    key,
    props,
    placementSeed: 0,
    sparse: Boolean(value.sparse),
    links: Array(6).fill(null),
  };
  if (value.forest !== undefined) {
    if (!record(value.forest)) fail();
    lock.forest = {};
    for (const field of ['clusterId', 'family', 'type', 'name', 'neighbourType'])
      if (value.forest[field] !== undefined) {
        if (typeof value.forest[field] !== 'string' || value.forest[field].length > 100) fail();
        lock.forest[field] = value.forest[field];
      }
    lock.forest.mixed = Boolean(value.forest.mixed);
  }
  if (value.mountain !== undefined) {
    if (
      !record(value.mountain) ||
      !['phase', 'angle', 'heightScale'].every(
        (field) => Number.isFinite(value.mountain[field]) && Math.abs(value.mountain[field]) <= 7,
      ) ||
      value.mountain.heightScale !== 0.6
    )
      fail();
    lock.mountain = Object.fromEntries(
      ['phase', 'angle', 'heightScale'].map((field) => [field, value.mountain[field]]),
    );
    if (value.mountain.profile !== undefined) {
      if (![0, 1].includes(value.mountain.profile)) fail();
      lock.mountain.profile = value.mountain.profile;
    }
  }
  if (value.roadShape !== undefined) {
    if (
      !record(value.roadShape) ||
      !integer(value.roadShape.variant) ||
      !integer(value.roadShape.revision)
    )
      fail();
    lock.roadShape = { variant: value.roadShape.variant, revision: value.roadShape.revision };
  }
  if (value.roadMask !== undefined) {
    if (!Number.isInteger(value.roadMask) || value.roadMask < 0 || value.roadMask > 63) fail();
    lock.roadMask = value.roadMask;
  }
  return lock;
}

export function validateHexEdits(value) {
  if (
    !record(value) ||
    ![1, 2, 3, 4].includes(value.version) ||
    !record(value.cells) ||
    Object.keys(value.cells).length > 469
  )
    fail();
  const cells = {};
  for (const [key, source] of Object.entries(value.cells)) {
    if (!validKey(key) || !record(source)) fail();
    const edit = {};
    if (source.terrain !== undefined) {
      if (!TERRAIN_TYPES.includes(source.terrain)) fail();
      edit.terrain = source.terrain;
    }
    if (source.cropStyle !== undefined) {
      if (
        value.version < 4 ||
        edit.terrain !== 'farmlands' ||
        !['grain', 'vineyard'].includes(source.cropStyle)
      )
        fail();
      edit.cropStyle = source.cropStyle;
    }
    if (source.elevation !== undefined) {
      if (!Number.isInteger(source.elevation) || source.elevation < 0 || source.elevation > 4)
        fail();
      edit.elevation = source.elevation;
    }
    if (source.settlement !== undefined) {
      if (source.settlement !== null && !SETTLEMENT_TYPES.includes(source.settlement)) fail();
      edit.settlement = source.settlement;
    }
    if (source.settlementGroup !== undefined) {
      const parts =
        typeof source.settlementGroup === 'string' ? source.settlementGroup.split('/') : [];
      if (
        value.version < 2 ||
        !['town', 'city'].includes(edit.settlement) ||
        parts.length !== 2 ||
        !validKey(parts[0]) ||
        !/^[1-9]\d{0,5}$/.test(parts[1])
      )
        fail();
      edit.settlementGroup = source.settlementGroup;
    }
    if (source.poi !== undefined) {
      if (source.poi === null) edit.poi = null;
      else {
        if (
          !record(source.poi) ||
          !POI_TYPES.includes(source.poi.kind) ||
          !variantsFor(source.poi.kind).includes(source.poi.variant)
        )
          fail();
        edit.poi = { kind: source.poi.kind, variant: source.poi.variant };
      }
    }
    if (source.crossing !== undefined) {
      if (![null, 'bridge', 'ferry'].includes(source.crossing)) fail();
      edit.crossing = source.crossing;
    }
    if (source.road !== undefined) {
      if (
        value.version < 3 ||
        !Array.isArray(source.road) ||
        source.road.length !== 6 ||
        !source.road.every((exit) => exit === null || typeof exit === 'boolean')
      )
        fail();
      edit.road = source.road.slice();
    }
    if (source.removedRoadLinks !== undefined) {
      if (
        value.version < 3 ||
        !Array.isArray(source.removedRoadLinks) ||
        source.removedRoadLinks.length > 469 ||
        !source.removedRoadLinks.every(
          (id) => typeof id === 'string' && /^road-[1-9]\d{0,2}$/.test(id),
        ) ||
        new Set(source.removedRoadLinks).size !== source.removedRoadLinks.length
      )
        fail();
      edit.removedRoadLinks = source.removedRoadLinks.slice();
    }
    if (source.visited !== undefined) {
      if (typeof source.visited !== 'boolean') fail();
      edit.visited = source.visited;
    }
    if (source.revision !== undefined) {
      if (!integer(source.revision)) fail();
      edit.revision = source.revision;
    }
    if (source.lock !== undefined) edit.lock = validateLock(source.lock, key);
    if (source.dressing !== undefined) {
      if (!integer(source.dressingVariant)) fail();
      edit.dressing = validateLock(source.dressing, key);
      edit.dressingVariant = source.dressingVariant;
    }
    cells[key] = edit;
  }
  const groups = new Map();
  for (const edit of Object.values(cells))
    if (edit.settlementGroup) {
      if (groups.has(edit.settlementGroup) && groups.get(edit.settlementGroup) !== edit.settlement)
        fail();
      groups.set(edit.settlementGroup, edit.settlement);
    }
  return { version: value.version, cells };
}

export const emptyHexEdits = () => ({ version: 1, cells: {} });
