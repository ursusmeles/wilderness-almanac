import { distance } from '../generation/hex.js';

export const PARTY_STYLES = ['cairn', 'warden', 'waystone'];
export const PARTY_COLORS = ['#ef365c', '#13d9f2', '#c4f532'];
export function validatePartyToken(value) {
  if (
    !value ||
    !PARTY_STYLES.includes(value.style) ||
    typeof value.key !== 'string' ||
    !/^-?\d{1,2},-?\d{1,2}$/.test(value.key)
  )
    throw new Error('The campaign contains an invalid party token.');
  const [q, r] = value.key.split(',').map(Number);
  if (`${q},${r}` !== value.key || Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > 12)
    throw new Error('The campaign contains an invalid party token.');
  if (
    (value.name !== undefined &&
      (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100)) ||
    (value.color !== undefined && !PARTY_COLORS.includes(value.color)) ||
    ['daysTravelled', 'sessionsPlayed'].some(
      (key) =>
        value[key] !== undefined &&
        (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > 1000000),
    )
  )
    throw new Error('The campaign contains invalid party details.');
  return {
    key: value.key,
    style: value.style,
    ...(value.name !== undefined ? { name: value.name.trim() } : {}),
    ...(value.color !== undefined ? { color: value.color } : {}),
    ...Object.fromEntries(
      ['daysTravelled', 'sessionsPlayed']
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, value[key]]),
    ),
  };
}

export function partyMetadata(world, campaign, { visibleWorld = world } = {}) {
  const party = campaign.partyToken,
    cell = world.cells.find((cell) => cell.key === party.key);
  const nearest = (cells) =>
    [...cells].sort(
      (a, b) => distance(cell, a) - distance(cell, b) || a.key.localeCompare(b.key),
    )[0];
  const proximityWorld = campaign.fogOfWar ? visibleWorld : world;
  const settlement = nearest(proximityWorld.cells.filter((other) => other.pointOfLight));
  const poiCell = nearest(proximityWorld.cells.filter((other) => other.pointsOfInterest?.length));
  const poi = poiCell?.pointsOfInterest[0];
  const names = {
    cave: 'Cave lair',
    nest: 'Nest',
    mine: 'Mine',
    dungeon: 'Dungeon entrance',
    portal: 'Portal',
    altar: 'Altar',
    'standing stone': 'Standing stones',
    lighthouse: 'Lighthouse',
    mystic: 'Mystic site',
  };
  const label =
    poi &&
    (poi.name ??
      names[poi.variant] ??
      names[poi.kind] ??
      poi.kind[0].toUpperCase() + poi.kind.slice(1));
  const land = world.cells.filter(
    (other) => !['ocean', 'lake'].includes(other.water) && other.terrain !== 'open water',
  );
  const visitedKeys = land
    .filter((other) => campaign.hexEdits?.cells[other.key]?.visited)
    .map((other) => other.key);
  const visited = visitedKeys.length;
  return {
    cell,
    settlement: settlement ? distance(cell, settlement) : null,
    settlementKey: settlement?.key ?? null,
    poi: poi ? { key: poiCell.key, name: label, distance: distance(cell, poiCell) } : null,
    visited,
    visitedKeys,
    land: land.length,
    percent: land.length ? Math.round((visited / land.length) * 100) : 0,
    days: party.daysTravelled ?? 1,
    sessions: party.sessionsPlayed ?? 1,
  };
}

export function initialPartyToken(world) {
  const nearest = (cells) =>
    [...cells].sort((a, b) => distance(a) - distance(b) || a.key.localeCompare(b.key))[0];
  const cell =
    nearest(world.cells.filter((cell) => cell.pointOfLight)) ??
    nearest(world.cells.filter((cell) => !cell.water)) ??
    nearest(world.cells);
  return { key: cell.key, style: 'warden' };
}
