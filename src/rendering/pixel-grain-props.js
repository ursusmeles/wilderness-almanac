import * as THREE from 'three';
import { clipField, cropHeight, grainPlants, polygonArea } from '../generation/farmland-patches.js';
import { addMesh } from './geometry.js';
import { groundGeometry, appendPlant, plantGeometry } from './pixel-dressing-geometry.js';
import { roadHeight } from '../generation/road-geometry.js';

export function createGrainBuilder({ pixelPropMaterial }) {
  return function makeGrain(parent, prop, cell) {
    const group = new THREE.Group();
    group.position.set(prop.x, prop.y, prop.z);
    group.rotation.y = prop.angle;
    group.scale.setScalar(prop.scale);
    const groundOffset = (x, z) =>
      cell?.roadSurface ? roadHeight(cell, prop.x + x, prop.z + z, cell.roadSurface) - prop.y : 0;
    const xs = prop.patch.map((p) => p[0]),
      zs = prop.patch.map((p) => p[1]);
    const soil = [],
      points = [],
      uvs = [],
      indices = [];
    let plant = 0;
    // Subdivide the clipped ground so the stalk roots follow the rolling patch.
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 0.07)
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 0.07) {
        let polygon = prop.patch;
        for (const [nx, nz, limit] of [
          [-1, 0, -x],
          [1, 0, x + 0.07],
          [0, -1, -z],
          [0, 1, z + 0.07],
        ])
          polygon = clipField(polygon, nx, nz, limit);
        if (polygon.length < 3 || polygonArea(polygon) < 1e-9) continue;
        const point = ([x, z]) => [x, groundOffset(x, z) + cropHeight(prop, x, z) + 0.004, z];
        for (let i = 1; i < polygon.length - 1; i++)
          soil.push(...point(polygon[0]), ...point(polygon[i + 1]), ...point(polygon[i]));
      }
    for (const { x, y: baseY, z, height, lean } of grainPlants(prop)) {
      const y = baseY + groundOffset(x, z);
      appendPlant(points, uvs, indices, {
        x,
        y,
        z,
        height: height + 0.028,
        width: 0.02,
        lean,
        style: prop.detailSeed + plant++,
      });
    }
    group.userData.wind = { height: 0.2 * prop.scale, strength: 0.18 };
    if (soil.length) {
      const ground = addMesh(
        group,
        groundGeometry(soil),
        pixelPropMaterial('grainGround', prop.temperature),
      );
      ground.castShadow = false;
    }
    if (points.length) {
      const plants = addMesh(
        group,
        plantGeometry(points, uvs, indices),
        pixelPropMaterial('grain', prop.temperature),
      );
      plants.castShadow = false;
    }
    parent.add(group);
  };
}
