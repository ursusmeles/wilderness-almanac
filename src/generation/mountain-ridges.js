import { DIRECTIONS } from './hex.js';
import { randomFor, smoothNoise } from './seed.js';

// A wandering main crest and its tributaries replace the lattice formed by
// connecting every pair of neighbouring hex centres. Everything stays numeric.
export function mountainRidges(cells, shape, seed) {
  const ordered = [...cells].sort((a, b) => a.key.localeCompare(b.key));
  const byKey = new Map(ordered.map((cell) => [cell.key, cell]));
  const adjacent = (cell) =>
    DIRECTIONS.map(([q, r]) => byKey.get(`${cell.q + q},${cell.r + r}`)).filter(Boolean);
  function traverse(start) {
    const queue = [start],
      parents = new Map([[start.key, null]]);
    for (const cell of queue)
      for (const next of adjacent(cell))
        if (!parents.has(next.key)) {
          parents.set(next.key, cell);
          queue.push(next);
        }
    return { last: queue.at(-1), parents };
  }
  const start = traverse(ordered[0]).last;
  const { last, parents } = traverse(start);
  const path = [];
  for (let cell = last; cell; cell = parents.get(cell.key)) path.push(cell);
  const salt = `${shape.rangeId}:${shape.phase}:${shape.angle}`;
  const random = randomFor(seed, `ridge-profile:${salt}`);
  const ruggedness = random() < 0.65 ? random() * 0.45 : 0.65 + random() * 0.35;
  const nodes = new Map(
    ordered.map((cell) => [
      cell.key,
      [cell.wx + (random() - 0.5) * 0.55, cell.wz + (random() - 0.5) * 0.55],
    ]),
  );
  const main = [],
    branches = [];
  function connect(a, b, target) {
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    const bend = (random() - 0.5) * 0.5;
    let previous = a;
    for (let step = 1; step <= 6; step++) {
      const t = step / 6,
        offset = Math.sin(t * Math.PI) * bend;
      const point = [
        a[0] + dx * t - (dz / length) * offset,
        a[1] + dz * t + (dx / length) * offset,
      ];
      target.push([previous, point]);
      previous = point;
    }
  }
  for (let i = 1; i < path.length; i++)
    connect(nodes.get(path[i - 1].key), nodes.get(path[i].key), main);
  if (path.length === 1) {
    const [x, z] = nodes.get(path[0].key),
      dx = Math.cos(shape.angle) * 0.5,
      dz = Math.sin(shape.angle) * 0.5;
    connect([x - dx, z - dz], [x + dx, z + dz], main);
  }
  const visited = new Set(path.map((cell) => cell.key));
  const queue = [...path];
  for (const cell of queue)
    for (const next of adjacent(cell))
      if (!visited.has(next.key)) {
        visited.add(next.key);
        queue.push(next);
        connect(nodes.get(cell.key), nodes.get(next.key), branches);
      }
  return {
    main,
    branches,
    ruggedness,
    width: 0.82 - ruggedness * 0.36,
    relief: smoothNoise(`${seed}:ridge-relief:${salt}`, 1.3),
    detail: smoothNoise(`${seed}:ridge-summits:${salt}`, 0.55),
  };
}
