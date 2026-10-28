import { hexAddress } from '../generation/hex.js';
import { isVineyard } from '../generation/farmland-patches.js';

export function hexName(cell) {
  if (cell.fogState === 'undiscovered') return 'Undiscovered hex';
  const label =
    cell.pointOfLight?.type ??
    (cell.water === 'lake'
      ? 'lake'
      : isVineyard(cell)
        ? 'vineyards'
        : (cell.forest?.name ?? cell.terrain));
  const articles = {
    ruins: 'ruins',
    encampment: 'an encampment',
    watchtower: 'a watchtower',
    stronghold: 'a stronghold',
    lair: 'a lair',
    mystic: 'a mystic site',
    abbey: 'an abbey',
    battlefield: 'a battlefield',
    dungeon: 'a dungeon',
  };
  const poi = cell.pointsOfInterest[0];
  const exits = Array.from({ length: 6 }, (_, side) => side).filter(
    (side) => (cell.road?.exits ?? 0) & (1 << side),
  );
  const subtypes = {
    lair: { cave: 'a cave lair', nest: 'a nest' },
    dungeon: { mine: 'a mine', dungeon: 'a dungeon entrance' },
    mystic: { portal: 'a portal', altar: 'an altar', 'standing stone': 'standing stones' },
  };
  const feature = poi
    ? poi.variant === 'lighthouse'
      ? 'a lighthouse'
      : (subtypes[poi.kind]?.[poi.variant] ?? articles[poi.kind])
    : cell.crossing
      ? cell.crossing.kind === 'ferry'
        ? 'a ferry'
        : `a ${cell.crossing.material === 'stone' ? 'stone' : 'wooden'} bridge`
      : !cell.pointOfLight && exits.length
        ? exits.length >= 3
          ? 'crossroads'
          : 'a road'
        : '';
  return `${label[0].toUpperCase() + label.slice(1)}${feature ? ` with ${feature}` : ''}`;
}

export const describeHex = (cell) => `${hexAddress(cell)} · ${hexName(cell)}`;
