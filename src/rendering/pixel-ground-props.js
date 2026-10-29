import * as THREE from 'three';
import { randomStream } from '../generation/math.js';
import { addMesh } from './geometry.js';
import { dressingGeometry, appendPlant, plantGeometry } from './pixel-dressing-geometry.js';

export function createPixelGroundBuilder({ pixelPropMaterial }) {
  function blades(parent, prop, kind, width, height) {
    const points = [],
      uvs = [],
      indices = [];
    appendPlant(points, uvs, indices, {
      width,
      height,
      angle: prop.angle,
      lean: 0.015,
      style: (prop.detailSeed ?? 0) >>> 0,
    });
    const mesh = addMesh(
      parent,
      plantGeometry(points, uvs, indices),
      pixelPropMaterial(kind, prop.temperature),
      prop.x,
      prop.y || 0,
      prop.z,
    );
    mesh.castShadow = false;
    return mesh;
  }
  return {
    makeRock(parent, prop) {
      const random = randomStream(prop.detailSeed);
      const mesh = addMesh(
        parent,
        dressingGeometry('rock', prop.detailSeed, prop.variant),
        pixelPropMaterial(prop.variant === 2 ? 'rockMid' : 'rock', prop.temperature),
        prop.x,
        prop.y || 0,
        prop.z,
      );
      mesh.scale.set(
        prop.footprint * (0.8 + random() * 0.2),
        prop.footprint * (0.85 + random() * 0.2),
        prop.footprint * (0.8 + random() * 0.2),
      );
      mesh.rotation.y = prop.angle;
    },
    makeGrass(parent, prop) {
      const random = randomStream(prop.detailSeed);
      const mesh = blades(
        parent,
        prop,
        prop.wind ? 'marshGrass' : 'grass',
        (0.085 + prop.variant * 0.008) * prop.scale,
        (0.13 + random() * 0.06) * prop.scale,
      );
      if (prop.wind) mesh.userData.wind = { height: 0.22 * prop.scale, strength: 0.38 };
    },
    makePuddle(parent, prop) {
      const mesh = addMesh(
        parent,
        dressingGeometry('puddle', prop.detailSeed, prop.variant),
        pixelPropMaterial('puddle', prop.temperature),
        prop.x,
        prop.y || 0,
        prop.z,
      );
      mesh.scale.set(prop.footprint, 1, prop.footprint);
      mesh.rotation.y = prop.angle;
      mesh.castShadow = false;
    },
    makeReeds(parent, prop) {
      const group = new THREE.Group();
      group.position.set(prop.x, prop.y || 0, prop.z);
      group.rotation.y = prop.angle;
      group.scale.setScalar(prop.scale);
      group.userData.wind = { height: 0.34 * prop.scale, strength: 0.5 };
      blades(group, { ...prop, x: 0, y: 0, z: 0, angle: 0 }, 'reeds', 0.105, 0.3);
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 0.025,
          z = (i % 2) * 0.025;
        const height = 0.22 + i * 0.025;
        addMesh(
          group,
          new THREE.BoxGeometry(0.005, height, 0.005),
          pixelPropMaterial('reedStem', prop.temperature),
          x,
          height / 2,
          z,
        );
        addMesh(
          group,
          new THREE.BoxGeometry(0.016, 0.045, 0.016),
          pixelPropMaterial('reedHead', prop.temperature),
          x,
          height,
          z,
        );
      }
      parent.add(group);
    },
  };
}
