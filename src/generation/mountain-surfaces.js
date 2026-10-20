import { DIRECTIONS } from './hex.js';
import { TOP_RADIUS } from './math.js';
import { ridgeSurface } from './ridge-surface.js';
import { randomFor } from './seed.js';

// Build broad, faceted ranges. A single height field per range
// keeps neighbouring mountain tiles joined instead of placing isolated cones.
export function prepareMountainRanges(world, dressing) {
  const byKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const shapes = new Map(dressing.mountains.map((shape) => [shape.rangeId, shape]));
  const result = new Map();
  for (const range of world.elevation.ranges) {
    const shape = shapes.get(range.id);
    if (!shape) continue;
    const cells = range.hexKeys.map((key) => byKey.get(key)).filter((cell) => cell.elevation === 4);
    const keys = new Set(cells.map((cell) => cell.key));
    const field = { ...shape, boundary: [], spines: [] };
    for (const cell of cells) {
      const shared = DIRECTIONS.map(([q, r]) => keys.has(`${cell.q + q},${cell.r + r}`));
      const corners = Array.from({ length: 6 }, (_, k) => {
        const radius = shared[(7 - k) % 6] || shared[(8 - k) % 6] ? 1 : TOP_RADIUS;
        return [Math.sin((k * Math.PI) / 3) * radius, Math.cos((k * Math.PI) / 3) * radius];
      });
      result.set(cell.key, { type: 'Mountains', shared, corners });
      for (let k = 0; k < 6; k++) {
        if (shared[(7 - k) % 6]) continue;
        field.boundary.push(
          [corners[k], corners[(k + 1) % 6]].map(([x, z]) => [x + cell.wx, z + cell.wz]),
        );
      }
      for (let k = 0; k < 3; k++) {
        if (!shared[k]) continue;
        const [q, r] = DIRECTIONS[k];
        const next = byKey.get(`${cell.q + q},${cell.r + r}`);
        field.spines.push([
          [cell.wx, cell.wz],
          [next.wx, next.wz],
        ]);
      }
    }
    for (const cell of cells) {
      const data = result.get(cell.key);
      data.surface = ridgeSurface({ ...cell, corners: data.corners }, field);
      // Keep the existing low-poly facets but limit their added silhouette.
      for (const vertex of data.surface.vertices) vertex[1] *= shape.heightScale;
      const revision = dressing.revisions?.[cell.key];
      if (revision) {
        const random = randomFor(world.seed, `ridge-detail:${cell.key}:${revision}`);
        const phase = random() * Math.PI * 2;
        for (const vertex of data.surface.vertices) {
          // Local relief fades to zero at every edge, retaining shared seams.
          const radius = Math.max(
            ...DIRECTIONS.map(
              (_, side) =>
                vertex[0] * Math.cos((side * Math.PI) / 3) +
                vertex[2] * Math.sin((side * Math.PI) / 3),
            ),
          );
          const weight = Math.max(0, 1 - radius / ((Math.sqrt(3) / 2) * TOP_RADIUS));
          vertex[1] *= 1 + Math.sin(vertex[0] * 4 + vertex[2] * 3 + phase) * 0.3 * weight;
        }
      }
    }
  }
  return result;
}
