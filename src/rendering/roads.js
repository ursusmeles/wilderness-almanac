import * as THREE from 'three';
import { addMesh, geometryFrom } from './geometry.js';
import { roadHeight } from '../generation/road-geometry.js';
import { pixelUV } from './pixel-model-geometry.js';

export function createRoadBuilder({ pixelModelMaterial, pixelPropMaterial }) {
  return function makeRoads(parent, data) {
    if (!data.roads?.length) return;
    const vertices = [];
    const point = (x, z) => [x, roadHeight(data, x, z, data.roadSurface) + 0.003, z];
    for (const path of data.roads) {
      const sides = path.points.map(([x, z], i) => {
        const a = path.points[Math.max(0, i - 1)],
          b = path.points[Math.min(path.points.length - 1, i + 1)];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = (-(b[1] - a[1]) / length) * path.width;
        const nz = ((b[0] - a[0]) / length) * path.width;
        return [point(x + nx, z + nz), point(x - nx, z - nz)];
      });
      for (let i = 1; i < sides.length; i++) {
        const [a, b] = sides[i - 1],
          [c, d] = sides[i];
        vertices.push(...a, ...c, ...b, ...b, ...c, ...d);
      }
    }
    if (!data.water && !data.pointOfLight && !data.pointsOfInterest.length) {
      const [x, z] = data.roads[0].points.at(-1);
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6,
          b = ((i + 1) * Math.PI) / 6;
        vertices.push(
          ...point(x, z),
          ...point(x + Math.cos(b) * 0.022, z + Math.sin(b) * 0.022),
          ...point(x + Math.cos(a) * 0.022, z + Math.sin(a) * 0.022),
        );
      }
    }
    const mesh = addMesh(
      parent,
      pixelUV(geometryFrom(vertices), { offset: [data.wx, data.top, data.wz], horizontal: true }),
      pixelModelMaterial('road', 0, data.tone ? 1 : 0),
    );
    mesh.castShadow = false;
    for (const stone of data.roadStones ?? []) {
      const rock = addMesh(
        parent,
        new THREE.BoxGeometry(stone.scale * 1.4, stone.scale, stone.scale * 1.2),
        pixelPropMaterial('roadStone'),
        stone.x,
        roadHeight(data, stone.x, stone.z, data.roadSurface) + 0.003 + stone.scale * 0.2,
        stone.z,
      );
      rock.scale.y = 0.4;
      rock.castShadow = false;
    }
  };
}
