import * as THREE from 'three';
import { cropHeight } from '../generation/farmland-patches.js';
import { randomStream } from '../generation/math.js';
import { addMesh, geometryFrom } from './geometry.js';
import { createGrainBuilder } from './grain-props.js';

export function createFarmlandBuilder({ propMaterial }) {
  const makeGrain = createGrainBuilder({ propMaterial });
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
      geometryFrom(soil),
      propMaterial(prop.cropStyle === 'grain' ? 'crop' : 'soil', prop.temperature),
    );
    ground.castShadow = false;
    if (prop.cropStyle === 'vineyard') {
      for (let row = 0; row < 3; row++) {
        const z = (row - 1) * 0.13;
        for (const x of [-0.15, 0.15])
          addMesh(
            group,
            new THREE.BoxGeometry(0.012, 0.18, 0.012),
            propMaterial('trunk', prop.temperature),
            x,
            height(x, z) + 0.09,
            z,
          );
        addMesh(
          group,
          new THREE.BoxGeometry(0.32, 0.007, 0.007),
          propMaterial('rope', prop.temperature),
          0,
          0.16,
          z,
        );
        for (let plant = 0; plant < 5; plant++) {
          const x = (plant - 2) * 0.066,
            y = height(x, z);
          const foliage = addMesh(
            group,
            new THREE.DodecahedronGeometry(0.047, 0),
            propMaterial('leaf', prop.temperature),
            x,
            y + 0.13,
            z,
          );
          foliage.scale.set(1, 0.6, 0.75);
          for (let grape = 0; grape < 4; grape++)
            addMesh(
              group,
              new THREE.IcosahedronGeometry(0.011, 0),
              propMaterial('grape'),
              x + ((grape % 2) - 0.5) * 0.014,
              y + 0.105 - Math.floor(grape / 2) * 0.014,
              z + 0.033,
            );
        }
      }
    } else {
      // Crossed stalks keep dense, golden grain inexpensive after batching.
      const stalks = [],
        heads = [];
      for (let row = 0; row < 8; row++)
        for (let col = 0; col < 8; col++) {
          const x = (col - 3.5) * 0.043 + (random() - 0.5) * 0.01;
          const z = (row - 3.5) * 0.048 + (random() - 0.5) * 0.01;
          const y = height(x, z) + 0.004,
            h = 0.07 + random() * 0.045;
          const lean = (random() - 0.5) * 0.025;
          for (const [dx, dz] of [
            [0.007, 0],
            [0, 0.007],
          ]) {
            stalks.push(x - dx, y, z - dz, x + dx, y, z + dz, x + lean, y + h, z);
            heads.push(
              x + lean - dx,
              y + h * 0.8,
              z - dz,
              x + lean + dx,
              y + h * 0.8,
              z + dz,
              x + lean,
              y + h + 0.025,
              z,
            );
          }
        }
      group.userData.wind = { height: 0.18 * prop.scale, strength: 0.18 };
      const stems = addMesh(
        group,
        geometryFrom(stalks),
        propMaterial('grainStem', prop.temperature),
      );
      const ears = addMesh(group, geometryFrom(heads), propMaterial('grain', prop.temperature));
      stems.castShadow = false;
      ears.castShadow = false;
    }
    parent.add(group);
  };
}
