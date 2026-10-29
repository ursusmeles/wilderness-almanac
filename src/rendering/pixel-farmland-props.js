import * as THREE from 'three';
import { cropHeight } from '../generation/farmland-patches.js';
import { randomStream } from '../generation/math.js';
import { addMesh } from './geometry.js';
import { createGrainBuilder } from './pixel-grain-props.js';
import {
  dressingGeometry,
  groundGeometry,
  appendPlant,
  plantGeometry,
} from './pixel-dressing-geometry.js';

export function createFarmlandBuilder({ pixelPropMaterial }) {
  const makeGrain = createGrainBuilder({ pixelPropMaterial });
  return function makeField(parent, prop, cell) {
    if (prop.patch) return makeGrain(parent, prop, cell);
    const group = new THREE.Group();
    group.position.set(prop.x, prop.y, prop.z);
    group.rotation.y = prop.angle;
    group.scale.setScalar(prop.scale);
    const height = (x, z) => cropHeight(prop, x, z);
    const random = randomStream(prop.detailSeed);
    const soil = [];
    for (let row = 0; row < 6; row++)
      for (let col = 0; col < 6; col++) {
        const x = -0.18 + col * 0.06,
          z = -0.2 + row / 15;
        const point = (x, z) => [x, height(x, z) + 0.004, z];
        const a = point(x, z),
          b = point(x + 0.06, z),
          c = point(x, z + 1 / 15),
          d = point(x + 0.06, z + 1 / 15);
        soil.push(...a, ...c, ...b, ...b, ...c, ...d);
      }
    const ground = addMesh(
      group,
      groundGeometry(soil),
      pixelPropMaterial(prop.cropStyle === 'grain' ? 'grainGround' : 'soil', prop.temperature),
    );
    ground.castShadow = false;
    if (prop.cropStyle === 'vineyard') {
      for (let row = 0; row < 3; row++) {
        const z = (row - 1) * 0.13;
        for (const x of [-0.15, 0.15])
          addMesh(
            group,
            new THREE.BoxGeometry(0.012, 0.18, 0.012),
            pixelPropMaterial('timber', prop.temperature),
            x,
            height(x, z) + 0.09,
            z,
          );
        addMesh(
          group,
          new THREE.BoxGeometry(0.32, 0.007, 0.007),
          pixelPropMaterial('timber', prop.temperature),
          0,
          height(0, z) + 0.15,
          z,
        );
        // Broad overlapping clumps read as a row without a mesh for every leaf.
        for (let plant = 0; plant < 3; plant++) {
          const x = (plant - 1) * 0.11,
            y = height(x, z);
          addMesh(
            group,
            dressingGeometry('vine', prop.detailSeed + row * 3 + plant),
            pixelPropMaterial('vine', prop.temperature),
            x,
            y + 0.1,
            z,
          );
          for (let grape = 0; grape < 2; grape++)
            addMesh(
              group,
              new THREE.BoxGeometry(0.021 - grape * 0.006, 0.022, 0.021 - grape * 0.006),
              pixelPropMaterial('grape'),
              x + grape * 0.005,
              y + 0.1 - grape * 0.018,
              z + 0.034,
            );
        }
      }
    } else {
      // The same dense legacy footprint, with colour/outline detail in a texture.
      const points = [],
        uvs = [],
        indices = [];
      for (let row = 0; row < 8; row++)
        for (let col = 0; col < 8; col++) {
          const x = (col - 3.5) * 0.043 + (random() - 0.5) * 0.01;
          const z = (row - 3.5) * 0.048 + (random() - 0.5) * 0.01;
          const y = height(x, z) + 0.004,
            h = 0.07 + random() * 0.045;
          const lean = (random() - 0.5) * 0.025;
          appendPlant(points, uvs, indices, {
            x,
            y,
            z,
            height: h + 0.025,
            width: 0.018,
            lean,
            style: row + col,
          });
        }
      group.userData.wind = { height: 0.18 * prop.scale, strength: 0.18 };
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
