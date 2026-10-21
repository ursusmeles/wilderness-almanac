import { components } from './hex.js';
import { updateHexes } from './campaign-world.js';

export function settlementJoin(world, keys) {
  const selected = new Set(keys);
  const cells = world.cells.filter((cell) => selected.has(cell.key));
  const type = cells[0]?.pointOfLight?.type;
  if (
    cells.length < 2 ||
    cells.length !== selected.size ||
    !['town', 'city'].includes(type) ||
    cells.some((cell) => cell.pointOfLight?.type !== type) ||
    components(cells, new Map(world.cells.map((cell) => [cell.key, cell]))).length !== 1
  )
    return null;
  const joined = cells.every(
    (cell) =>
      cell.pointOfLight.id === cells[0].pointOfLight.id && cell.pointOfLight.size === cells.length,
  );
  return { type, keys: cells.map((cell) => cell.key), joined };
}

export function joinSettlements(campaign, world, keys, baseWorld) {
  const selection = settlementJoin(world, keys);
  if (!selection) throw new Error('Select connected town hexes or connected city hexes.');
  if (selection.joined) throw new Error('These hexes already belong to one settlement.');
  const revision =
    1 +
    Math.max(
      0,
      ...Object.values(campaign.hexEdits?.cells ?? {}).map((edit) =>
        Number(edit.settlementGroup?.split('/')[1] ?? 0),
      ),
    );
  const group = `${selection.keys[0]}/${revision}`;
  return updateHexes(
    campaign,
    Object.fromEntries(
      selection.keys.map((key) => [
        key,
        {
          settlement: selection.type,
          settlementGroup: group,
        },
      ]),
    ),
    baseWorld,
  );
}
