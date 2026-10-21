export const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];
export const keyOf = (q, r) => `${q},${r}`;
export const hexAddress = (cell) => `Region #${cell.regionId} · ${cell.x}, ${cell.y}`;
export const distance = (a, b = { q: 0, r: 0 }) =>
  Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
export const worldPosition = ({ q, r }) => ({ wx: Math.sqrt(3) * (q + r / 2), wz: 1.5 * r });
export const neighbours = (cell, byKey) =>
  DIRECTIONS.map(([q, r]) => byKey.get(keyOf(cell.q + q, cell.r + r))).filter(Boolean);
export const directionTo = (a, b) =>
  DIRECTIONS.findIndex(([q, r]) => a.q + q === b.q && a.r + r === b.r);

export function components(cells, byKey) {
  const available = new Set(cells.map((cell) => cell.key));
  const groups = [];
  for (const start of cells) {
    if (!available.delete(start.key)) continue;
    const group = [start];
    for (let i = 0; i < group.length; i++) {
      for (const next of neighbours(group[i], byKey)) {
        if (available.delete(next.key)) group.push(next);
      }
    }
    groups.push(group);
  }
  return groups;
}
