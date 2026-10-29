import * as THREE from 'three';
import { randomStream } from '../generation/math.js';
import { addMesh, geometryFrom } from './geometry.js';
import { createFarmlandBuilder } from './farmland-props.js';
import { createPixelDeciduousBuilder } from './pixel-deciduous.js';
import {
  createPixelEvergreenBuilder,
  evergreenSpecies,
  evergreenForm,
} from './pixel-evergreens.js';

export function createNatureBuilder({
  materials,
  propMaterial,
  pixelMaterial,
  pixelDeciduousMaterial,
  pixelBarkMaterial,
}) {
  const makeField = createFarmlandBuilder({ propMaterial });
  const makeEvergreen = createPixelEvergreenBuilder({ pixelMaterial });
  const makeDeciduous = createPixelDeciduousBuilder({
    pixelDeciduousMaterial,
    pixelBarkMaterial,
    propMaterial,
  });
  function makeTree(parent, prop, forest, context) {
    const g = new THREE.Group();
    g.userData.tree = true;
    g.userData.wind = { height: 0.8, strength: 1 };
    g.position.set(prop.x, prop.y || 0, prop.z);
    g.rotation.y = prop.angle;
    g.scale.setScalar(prop.scale);
    if (prop.variant === 1) {
      makeDeciduous(g, prop, forest, context);
      parent.add(g);
      return;
    }
    const species = evergreenSpecies(prop, forest);
    const style = ((prop.detailSeed ?? 0) >>> 0) % 8;
    const form = evergreenForm(species, prop.variant, style);
    if (species !== 'pine')
      addMesh(
        g,
        new THREE.CylinderGeometry(0.025, 0.04, form.trunkHeight, 5),
        pixelBarkMaterial(species, prop.temperature),
        0,
        form.trunkHeight / 2,
        0,
      );
    if (species === 'pine') {
      for (const limb of form.limbs) {
        const start = new THREE.Vector3(...limb.start);
        const end = new THREE.Vector3(...limb.end);
        const axis = end.clone().sub(start);
        const center = start.clone().add(end).multiplyScalar(0.5);
        const branch = addMesh(
          g,
          new THREE.CylinderGeometry(limb.radius * 0.65, limb.radius, axis.length(), 4, 1, true),
          pixelBarkMaterial(species, prop.temperature, start.y > form.height * 0.45 ? 1 : 0),
          center.x,
          center.y,
          center.z,
        );
        branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
      }
    }
    makeEvergreen(g, prop, species);
    parent.add(g);
  }
  function makeRock(parent, prop) {
    const rand = randomStream(prop.detailSeed),
      geo =
        prop.variant === 1
          ? new THREE.IcosahedronGeometry(1, 0)
          : new THREE.DodecahedronGeometry(1, 0);
    const mesh = addMesh(
      parent,
      geo,
      propMaterial(prop.variant === 2 ? 'rockMid' : 'rock', prop.temperature),
      prop.x,
      (prop.y || 0) + prop.footprint * 0.33,
      prop.z,
    );
    mesh.scale.set(
      prop.footprint * (0.8 + rand() * 0.2),
      prop.footprint * (0.48 + rand() * 0.22),
      prop.footprint * (0.65 + rand() * 0.25),
    );
    mesh.rotation.y = prop.angle;
  }
  function makeGrass(parent, prop) {
    const rand = randomStream(prop.detailSeed),
      vertices = [];
    const blades = 3 + prop.variant;
    for (let n = 0; n < blades; n++) {
      const a = (n * Math.PI * 2) / blades + prop.angle,
        bx = Math.cos(a) * 0.025,
        bz = Math.sin(a) * 0.025,
        h = (0.11 + rand() * 0.08) * prop.scale,
        lean = 0.02 + rand() * 0.015;
      vertices.push(
        bx - 0.014,
        0,
        bz,
        bx + 0.014,
        0,
        bz,
        bx + Math.cos(a) * lean,
        h,
        bz + Math.sin(a) * lean,
      );
    }
    const geo = geometryFrom(vertices);
    const mesh = addMesh(
      parent,
      geo,
      propMaterial(prop.wind ? 'reeds' : 'grass', prop.temperature),
      prop.x,
      prop.y || 0,
      prop.z,
    );
    mesh.castShadow = false;
    if (prop.wind && !parent.userData.wind)
      mesh.userData.wind = { height: 0.22 * prop.scale, strength: 0.38 };
  }
  function makePuddle(parent, prop) {
    const points = [],
      random = randomStream(prop.detailSeed),
      n = 10;
    const rim = Array.from({ length: n }, (_, k) => {
      const angle = (k * Math.PI * 2) / n,
        radius = prop.footprint * (0.83 + random() * 0.17);
      return [Math.sin(angle) * radius, 0.006, Math.cos(angle) * radius * 0.7];
    });
    for (let k = 0; k < n; k++) points.push(0, 0.006, 0, ...rim[k], ...rim[(k + 1) % n]);
    const mesh = addMesh(
      parent,
      geometryFrom(points),
      propMaterial('water', prop.temperature),
      prop.x,
      prop.y,
      prop.z,
    );
    mesh.rotation.y = prop.angle;
    mesh.castShadow = false;
  }
  function makeReeds(parent, prop) {
    const g = new THREE.Group();
    g.position.set(prop.x, prop.y, prop.z);
    g.rotation.y = prop.angle;
    g.scale.setScalar(prop.scale);
    g.userData.wind = { height: 0.34 * prop.scale, strength: 0.5 };
    makeGrass(g, { ...prop, x: 0, y: 0, z: 0, angle: 0, scale: 1.7, variant: 2, wind: true });
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.025,
        z = (i % 2) * 0.025,
        height = 0.22 + i * 0.025;
      addMesh(
        g,
        new THREE.CylinderGeometry(0.004, 0.006, height, 3),
        propMaterial('reeds', prop.temperature),
        x,
        height / 2,
        z,
      );
      addMesh(
        g,
        new THREE.BoxGeometry(0.018, 0.045, 0.018),
        propMaterial('reedHead', prop.temperature),
        x,
        height,
        z,
      );
    }
    parent.add(g);
  }
  function makeCrops(parent, prop, cell) {
    return makeField(
      parent,
      !prop.cropStyle || prop.cropStyle === 'plots'
        ? { ...prop, cropStyle: 'grain', detailSeed: prop.detailSeed ?? 0 }
        : prop,
      cell,
    );
  }
  function makeWave(parent, prop) {
    const points = [];
    // Three shallow arcs, well inside the hex throughout the slow drift loop.
    for (let row = 0; row < 3; row++) {
      for (let step = 0; step < 6; step++) {
        const a = -0.22 + (step * 0.44) / 6,
          b = a + 0.44 / 6;
        const za = (row - 1) * 0.08 + a * a * 0.6,
          zb = (row - 1) * 0.08 + b * b * 0.6;
        points.push(
          a,
          0,
          za,
          b,
          0,
          zb,
          a,
          0,
          za + 0.024,
          b,
          0,
          zb,
          b,
          0,
          zb + 0.024,
          a,
          0,
          za + 0.024,
        );
      }
    }
    const mesh = addMesh(parent, geometryFrom(points), materials.wave, prop.x, prop.y, prop.z);
    mesh.rotation.y = Math.PI / 2 - prop.angle;
    mesh.userData.wavePhase = prop.phase;
    mesh.castShadow = false;
  }
  return { makeTree, makeRock, makeGrass, makePuddle, makeReeds, makeCrops, makeWave };
}
