import { generateWorld, generateDressing } from './world.js';
import { components, distance, neighbours, DIRECTIONS } from './hex.js';
import { randomFor } from './seed.js';
import { emptyHexEdits, validateHexEdits } from './hex-edits.js';
import { prepareRiverGeometry, riverFieldFor } from './presentation.js';
import { crossingSite } from './crossings.js';
import { poiAnchor } from './points-of-interest.js';
import { riverBankValue, riverBankHeight } from './river-surfaces.js';
import { fitsHex, minimumSpacing, fitsTree } from './prop-placement.js';
import { prepareMountainRanges } from './mountain-surfaces.js';
import { surfaceHeight } from './math.js';

const own = (value, key) => Object.hasOwn(value, key);
const structural = ['terrain', 'elevation', 'settlement', 'poi', 'crossing'];
const openWater = (cell) => ['ocean', 'lake'].includes(cell.water);

export function campaignWorld(campaign, base = generateWorld(campaign.seed)) {
  const edits = campaign.hexEdits?.cells ?? {};
  if (!Object.values(edits).some((edit) => structural.some((field) => own(edit, field))))
    return base;
  const world = structuredClone(base);
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  for (const cell of world.cells) {
    const edit = edits[cell.key];
    if (!edit) continue;
    if (edit.terrain !== undefined) {
      cell.terrain = edit.terrain;
      cell.water =
        edit.terrain === 'river'
          ? 'river'
          : edit.terrain === 'open water'
            ? openWater(cell)
              ? cell.water
              : 'lake'
            : null;
      cell.elevation = cell.water
        ? 0
        : cell.terrain === 'mountains'
          ? 4
          : Math.min(cell.elevation, 3);
    }
    if (edit.elevation !== undefined && !cell.water && cell.terrain !== 'mountains')
      cell.elevation = Math.min(edit.elevation, 3);
    if (own(edit, 'settlement')) {
      if (edit.settlement === null) delete cell.pointOfLight;
      else if (cell.pointOfLight?.type !== edit.settlement)
        cell.pointOfLight = {
          id: `manual-settlement:${cell.key}`,
          type: edit.settlement,
          centre: true,
          size: 1,
        };
    }
    if (own(edit, 'poi')) {
      const random = randomFor(
        world.seed,
        `manual-poi:${cell.key}:${edit.poi?.kind}:${edit.poi?.variant}`,
      );
      cell.pointsOfInterest = edit.poi
        ? [
            {
              ...edit.poi,
              id: `manual-poi:${cell.key}`,
              key: cell.key,
              regionId: cell.regionId,
              detailSeed: Math.floor(random() * 4294967296),
              temperature: ['lair', 'dungeon', 'mystic'].includes(edit.poi.kind) ? -1 : 1,
            },
          ]
        : [];
    }
    if (openWater(cell)) {
      if (edit.poi || edit.settlement)
        throw new Error('Open water cannot contain settlements or POIs.');
      delete cell.pointOfLight;
      cell.pointsOfInterest = [];
    }
    if (cell.water === 'river') delete cell.pointOfLight;
    if (edit.crossing && cell.water !== 'river')
      throw new Error('Crossings can only be placed on rivers.');
    if (cell.water !== 'river' || edit.crossing === null) delete cell.crossing;
  }
  // Repair only broken/new drainage links. Existing river routes remain in place.
  for (const cell of world.cells) cell.upstream = [];
  for (const cell of world.cells) {
    if (cell.water !== 'river') {
      delete cell.downstream;
      continue;
    }
    if (!byKey.get(cell.downstream)?.water) cell.downstream = null;
    if (!(cell.riverWidth > 0)) cell.riverWidth = 0.16;
  }
  for (const cell of world.cells.filter(
    (cell) =>
      cell.water === 'river' &&
      base.cells.find((original) => original.key === cell.key)?.water !== 'river',
  )) {
    const createsCycle = (candidate) => {
      const seen = new Set([cell.key]);
      while (candidate?.water === 'river') {
        if (seen.has(candidate.key)) return true;
        seen.add(candidate.key);
        candidate = byKey.get(candidate.downstream);
      }
      return false;
    };
    const candidates = neighbours(cell, byKey)
      .filter((next) => next.water && !createsCycle(next))
      .sort((a, b) => Number(openWater(b)) - Number(openWater(a)) || a.key.localeCompare(b.key));
    cell.downstream = candidates[0]?.key ?? null;
    if (candidates[0]?.water === 'river') cell.riverWidth = candidates[0].riverWidth;
  }
  for (const cell of world.cells.filter((cell) => cell.water === 'river'))
    byKey.get(cell.downstream)?.upstream.push(cell.key);

  world.settlements = [];
  const settlementIds = [
    ...new Set(world.cells.filter((cell) => cell.pointOfLight).map((cell) => cell.pointOfLight.id)),
  ];
  for (const id of settlementIds) {
    const groups = components(
      world.cells.filter((cell) => cell.pointOfLight?.id === id),
      byKey,
    );
    groups.forEach((group, index) => {
      const groupId = index ? `${id}:${group[0].key}` : id;
      const anchor = group.find((cell) => cell.pointOfLight.centre) ?? group[0];
      for (const cell of group)
        cell.pointOfLight = {
          ...cell.pointOfLight,
          id: groupId,
          size: group.length,
          centre: cell === anchor,
        };
      world.settlements.push({
        id: groupId,
        type: anchor.pointOfLight.type,
        regionId: anchor.regionId,
        anchorKey: anchor.key,
        hexKeys: group.map((cell) => cell.key),
      });
    });
  }
  const used = new Set();
  world.elevation.ranges = components(
    world.cells.filter((cell) => cell.terrain === 'mountains'),
    byKey,
  ).map((group) => {
    const original = group.map((cell) => cell.mountainRangeId).find((id) => id && !used.has(id));
    const id = original ?? `manual-range:${group[0].key}`;
    used.add(id);
    for (const cell of group) cell.mountainRangeId = id;
    return { id, hexKeys: group.map((cell) => cell.key) };
  });
  for (const cell of world.cells) if (cell.terrain !== 'mountains') cell.mountainRangeId = null;
  world.pointsOfInterest = world.cells.flatMap((cell) => cell.pointsOfInterest);
  world.terrain.counts = Object.fromEntries(
    [...new Set(world.cells.map((cell) => cell.terrain))].map((type) => [
      type,
      world.cells.filter((cell) => cell.terrain === type).length,
    ]),
  );
  const fields = prepareRiverGeometry(world);
  for (const cell of world.cells.filter((cell) => cell.water === 'river')) {
    const kind = own(edits[cell.key] ?? {}, 'crossing')
      ? edits[cell.key].crossing
      : cell.crossing?.kind;
    if (!kind) continue;
    const site = crossingFor(cell, fields);
    if (!site) {
      delete cell.crossing;
      continue;
    }
    cell.crossing = {
      ...cell.crossing,
      ...site,
      kind,
      material: cell.crossing?.material ?? 'wood',
      boatPosition: cell.crossing?.boatPosition ?? 0.5,
    };
  }
  world.crossings = world.cells
    .filter((cell) => cell.crossing)
    .map((cell) => ({ key: cell.key, ...cell.crossing }));
  return world;
}

export function crossingFor(cell, fields) {
  if (cell.water !== 'river' || !fields.curves.get(cell.key)) return null;
  return crossingSite({
    ...cell,
    riverCorners: Array.from({ length: 6 }, (_, k) => [
      Math.sin((k * Math.PI) / 3),
      Math.cos((k * Math.PI) / 3),
    ]),
    river: riverFieldFor(cell, fields),
    riverCurve: fields.curves.get(cell.key),
    riverLandSides: DIRECTIONS.map(([q, r]) => {
      const next = fields.byKey.get(`${cell.q + q},${cell.r + r}`);
      return !!next && !next.water;
    }),
  });
}

export function campaignDressing(
  campaign,
  world,
  { fixedCells = {}, rerollKey, mountainBase = [] } = {},
) {
  const edits = campaign.hexEdits?.cells ?? {};
  const fixed = { ...fixedCells };
  const revisions = {};
  const mountainLocks = Object.fromEntries(mountainBase.map((shape) => [shape.rangeId, shape]));
  for (const [key, edit] of Object.entries(edits).sort(([a], [b]) => a.localeCompare(b))) {
    if (edit.revision) revisions[key] = edit.revision;
    if (edit.dressing && edit.dressingVariant === campaign.variant && key !== rerollKey) {
      fixed[key] = edit.dressing;
      const range = world.cells.find((cell) => cell.key === key)?.mountainRangeId;
      if (range && edit.dressing.mountain && !mountainLocks[range])
        mountainLocks[range] = edit.dressing.mountain;
    }
    if (edit.lock) {
      fixed[key] = edit.lock;
      const range = world.cells.find((cell) => cell.key === key)?.mountainRangeId;
      if (range && edit.lock.mountain && !mountainLocks[range])
        mountainLocks[range] = edit.lock.mountain;
    }
  }
  const dressing = generateDressing(world, campaign.variant, {
    fixedCells: rerollKey ? fixed : {},
    revisions,
    mountainLocks,
    canopySalt: rerollKey ? `${rerollKey}:${revisions[rerollKey]}` : '',
  });
  const worldByKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const fixedMountains = Object.keys(fixed).some(
    (key) => worldByKey.get(key)?.terrain === 'mountains',
  )
    ? prepareMountainRanges(world, dressing)
    : new Map();
  for (const cell of dressing.cells) {
    if (fixed[cell.key]) {
      const origin = worldByKey.get(cell.key);
      if (openWater(origin) && fixed[cell.key].props.some((prop) => prop.kind !== 'wave'))
        throw new Error('Open water cannot contain frozen land props or POIs.');
      if (
        fixed[cell.key].props.some(
          (prop) =>
            prop.kind === 'poi' &&
            !origin.pointsOfInterest.some(
              (poi) => poi.kind === prop.poiKind && poi.variant === prop.variant,
            ),
        )
      )
        throw new Error('Frozen POI dressing does not match this hex’s features.');
      const forest = cell.forest;
      const links = cell.links;
      Object.assign(cell, structuredClone(fixed[cell.key]));
      if (forest) cell.forest = forest;
      // A deliberate neighbouring terrain edit can close a formerly shared
      // canopy edge. Keep the lock, but clip crowns that no longer fit it.
      if (forest) {
        cell.props = cell.props.filter(
          (prop) =>
            prop.kind !== 'tree' || fitsTree({ ...origin, links }, prop.x, prop.z, prop.footprint),
        );
      }
      const surface = fixedMountains.get(cell.key)?.surface;
      if (surface)
        for (const prop of cell.props) {
          if (prop.kind !== 'poi') prop.y = surfaceHeight(surface, prop.x, prop.z);
          else {
            const heights = Array.from({ length: 12 }, (_, side) =>
              surfaceHeight(
                surface,
                prop.x + Math.cos((side * Math.PI) / 6) * prop.footprint,
                prop.z + Math.sin((side * Math.PI) / 6) * prop.footprint,
              ),
            );
            const top = Math.max(...heights, surfaceHeight(surface, prop.x, prop.z));
            prop.y = top;
            prop.pedestalDepth =
              top - Math.min(...heights, surfaceHeight(surface, prop.x, prop.z)) + 0.035;
            prop.foundationHeights = heights.map((height) => height - top - 0.015);
          }
        }
    }
  }
  // Reserve frozen crowns before accepting freshly generated neighbours. Local
  // rerolls fit around existing trees; global rerolls cannot overlap a lock.
  for (const cell of dressing.cells) {
    if (fixed[cell.key]) continue;
    const origin = worldByKey.get(cell.key);
    const frozenNeighbours = neighbours(origin, worldByKey).filter((next) => fixed[next.key]);
    if (!frozenNeighbours.length) continue;
    cell.props = cell.props.filter(
      (prop) =>
        prop.kind !== 'tree' ||
        frozenNeighbours.every((next) =>
          fixed[next.key].props.every(
            (other) =>
              other.kind !== 'tree' ||
              Math.hypot(
                origin.wx + prop.x - next.wx - other.x,
                origin.wz + prop.z - next.wz - other.z,
              ) >= minimumSpacing(prop, other),
          ),
        ),
    );
  }
  // Manual river POIs occupy an actual dry bank, with their complete footprint.
  const rivers = world.cells.filter(
    (cell) => cell.water === 'river' && cell.pointsOfInterest.length && !fixed[cell.key],
  );
  if (rivers.length) {
    const fields = prepareRiverGeometry(world);
    for (const cell of rivers) {
      const props = dressing.cells.find((entry) => entry.key === cell.key).props;
      const river = riverFieldFor(cell, fields);
      for (const prop of props.filter((entry) => entry.kind === 'poi')) {
        let best;
        for (let ring = 0; ring < 8; ring++)
          for (let k = 0; k < 36; k++) {
            const radius = 0.12 + ring * 0.08,
              angle = (k * Math.PI) / 18;
            const x = Math.cos(angle) * radius,
              z = Math.sin(angle) * radius;
            if (!fitsHex(x, z, prop.footprint)) continue;
            const points = Array.from({ length: 12 }, (_, side) => [
              x + Math.cos((side * Math.PI) / 6) * prop.footprint,
              z + Math.sin((side * Math.PI) / 6) * prop.footprint,
            ]);
            if (
              !points.every(([px, pz]) => riverBankValue(river, cell.wx + px, cell.wz + pz) > 0.01)
            )
              continue;
            if (cell.crossing && distanceToCrossing(x, z, cell.crossing) < prop.footprint + 0.1)
              continue;
            const score = Math.hypot(x - poiAnchor(prop).x, z - poiAnchor(prop).z);
            if (!best || score < best.score)
              best = {
                x,
                z,
                score,
                y: Math.max(
                  ...points.map(([px, pz]) => riverBankHeight(river, cell.wx + px, cell.wz + pz)),
                ),
              };
          }
        if (!best)
          throw new Error(
            'This river has no dry bank large enough for that POI. Try a neighbouring river hex.',
          );
        Object.assign(prop, { x: best.x, z: best.z, y: best.y, pedestalDepth: 0.04 });
      }
    }
  }
  return dressing;
}

function distanceToCrossing(x, z, crossing) {
  const [a, b] = [crossing.a, crossing.b],
    dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

export function updateHex(campaign, key, patch) {
  const previous = campaign.hexEdits ?? emptyHexEdits();
  const hexEdits = { version: 1, cells: { ...previous.cells } };
  const edit = { ...hexEdits.cells[key], ...patch };
  if (structural.some((field) => own(patch, field))) delete edit.lock;
  if (structural.some((field) => own(patch, field))) {
    delete edit.dressing;
    delete edit.dressingVariant;
  }
  hexEdits.cells[key] = validateHexEdits({ version: 1, cells: { [key]: edit } }).cells[key];
  let next = { ...campaign, hexEdits };
  if (
    structural.some((field) => own(patch, field)) &&
    Object.values(hexEdits.cells).some((value) => value.dressing)
  ) {
    // Cosmetic snapshots remain local until a structural edit changes their
    // shared forest/ridge context. Clear snapshots only in affected components.
    const affected = new Set([key]);
    const base = generateWorld(campaign.seed);
    for (const world of [campaignWorld(campaign, base), campaignWorld(next, base)]) {
      const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
      const target = byKey.get(key);
      const nearby = [target, ...neighbours(target, byKey)];
      nearby.forEach((cell) => affected.add(cell.key));
      for (const predicate of [
        (cell) => cell.terrain.includes('forest'),
        (cell) => cell.terrain === 'mountains',
      ]) {
        for (const group of components(world.cells.filter(predicate), byKey))
          if (group.some((cell) => affected.has(cell.key)))
            group.forEach((cell) => affected.add(cell.key));
      }
    }
    for (const target of affected)
      if (hexEdits.cells[target]) {
        hexEdits.cells[target] = { ...hexEdits.cells[target] };
        delete hexEdits.cells[target].dressing;
        delete hexEdits.cells[target].dressingVariant;
      }
    next = { ...campaign, hexEdits };
  }
  return next;
}

export function inspectDistances(world, cell) {
  const nearest = (predicate) => {
    const values = world.cells.filter(predicate).map((other) => distance(cell, other));
    return values.length ? Math.min(...values) : null;
  };
  return {
    settlement: nearest((other) => other.pointOfLight),
    river: nearest((other) => other.water === 'river'),
    water: nearest(openWater),
  };
}

export function lockHex(campaign, key, world, dressing) {
  const next = updateHex(campaign, key, {});
  const lock = structuredClone(dressing.cells.find((cell) => cell.key === key));
  const range = world.cells.find((cell) => cell.key === key)?.mountainRangeId;
  if (range) lock.mountain = dressing.mountains.find((shape) => shape.rangeId === range);
  next.hexEdits.cells[key].lock = lock;
  next.hexEdits.cells[key] = validateHexEdits({
    version: 1,
    cells: { [key]: next.hexEdits.cells[key] },
  }).cells[key];
  return next;
}
