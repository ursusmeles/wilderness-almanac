import { randomStream } from './math.js';
import {
  riverBankValue,
  riverIslandValue,
  riverBankHeight,
  insideRiverTile,
} from './river-surfaces.js';

function curvePoint(curve, t) {
  const u = 1 - t;
  return [
    u * u * curve[0][0] + 2 * u * t * curve[1][0] + t * t * curve[2][0],
    u * u * curve[0][1] + 2 * u * t * curve[1][1] + t * t * curve[2][1],
  ];
}
function curveTangent(curve, t) {
  const dx = (1 - t) * (curve[1][0] - curve[0][0]) + t * (curve[2][0] - curve[1][0]),
    dz = (1 - t) * (curve[1][1] - curve[0][1]) + t * (curve[2][1] - curve[1][1]),
    d = Math.hypot(dx, dz);
  return [dx / d, dz / d];
}
function bridgeMaterialFor(size) {
  return ['large', 'town', 'city'].includes(size) ? 'stone' : 'wood';
}
function crossingChoice(seed, settlement, riverId) {
  const rand = randomStream(
      seed * 63029 + (settlement.q + 13) * 8191 + (settlement.r + 13) * 4133 + riverId * 7717,
    ),
    roll = rand();
  return {
    kind: roll < 0.5 ? 'bridge' : roll < 0.8 ? 'ferry' : null,
    roll,
    boatPosition: 0.4 + rand() * 0.2,
  };
}
function crossingSite(cell) {
  for (const t of [0.5, 0.35, 0.65, 0.23, 0.77, 0.12, 0.88, 0.06, 0.94]) {
    const center = curvePoint(cell.riverCurve, t),
      tangent = curveTangent(cell.riverCurve, t),
      normal = [-tangent[1], tangent[0]],
      ends = [];
    if (riverIslandValue(cell.river, ...center) > -0.13) continue;
    let clear = true;
    for (const sign of [-1, 1]) {
      let end = null;
      for (let d = 0.04; d < 1.16; d += 0.012) {
        const p = [center[0] + normal[0] * d * sign, center[1] + normal[1] * d * sign];
        if (!insideRiverTile(cell, p[0] - cell.wx, p[1] - cell.wz, 0.008)) {
          let side = 0,
            projection = -Infinity;
          for (let k = 0; k < 6; k++) {
            const v =
              (p[0] - cell.wx) * Math.cos((k * Math.PI) / 3) +
              (p[1] - cell.wz) * Math.sin((k * Math.PI) / 3);
            if (v > projection) {
              projection = v;
              side = k;
            }
          }
          if (cell.riverLandSides[side])
            end = [p[0] + normal[0] * sign * 0.03, p[1] + normal[1] * sign * 0.03];
          break;
        }
        if (riverIslandValue(cell.river, ...p) > -0.115) {
          clear = false;
          break;
        }
        if (riverBankValue(cell.river, ...p) > 0.018) {
          end = p;
          break;
        }
      }
      if (!end) {
        clear = false;
        break;
      }
      ends.push(end);
    }
    if (clear && ends.length === 2)
      return {
        a: [ends[0][0] - cell.wx, ends[0][1] - cell.wz],
        b: [ends[1][0] - cell.wx, ends[1][1] - cell.wz],
        heights: ends.map((p) => riverBankHeight(cell.river, ...p)),
      };
  }
  return null;
}

export { bridgeMaterialFor, crossingChoice, crossingSite };
