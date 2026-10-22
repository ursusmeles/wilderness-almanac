import { distance, DIRECTIONS } from '../src/generation/hex.js';

// Review prototype: state stays separate from meshes and browser storage.
export function createPartyRoute(cells) {
  const byKey = new Map(cells.map((cell) => [cell.key, cell]));
  const nearest = (list) =>
    [...list].sort((a, b) => distance(a) - distance(b) || a.key.localeCompare(b.key))[0];
  const start =
    nearest(cells.filter((cell) => cell.pointOfLight)) ??
    nearest(cells.filter((cell) => !cell.water)) ??
    nearest(cells);
  let current = start;
  const visited = new Set([start.key]);
  return {
    get current() {
      return current;
    },
    visited,
    move(key) {
      if (!byKey.has(key)) return false;
      current = byKey.get(key);
      visited.add(key);
      return true;
    },
    neighbour(direction) {
      const [q, r] = DIRECTIONS[direction];
      return byKey.get(`${current.q + q},${current.r + r}`);
    },
  };
}
