import { distance } from '../generation/hex.js';

export const PARTY_STYLES = ['cairn', 'warden', 'waystone'];
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
  return { key: value.key, style: value.style };
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
