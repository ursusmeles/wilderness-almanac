import * as THREE from 'three';
import { addMesh, geometryFrom } from './geometry.js';
import { createFarmlandBuilder } from './farmland-props.js';
import { createPixelGroundBuilder } from './pixel-ground-props.js';
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
  pixelPropMaterial,
}) {
  const makeField = createFarmlandBuilder({ pixelPropMaterial });
  const { makeRock, makeGrass, makePuddle, makeReeds } = createPixelGroundBuilder({
    pixelPropMaterial,
  });
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
    // Broken pixel crests stay inside the existing drift footprint.
    for (let row = 0; row < 3; row++) {
      for (let step = 0; step < 5; step++) {
        if ((row + step) % 5 === 0) continue;
        const a = -0.2 + step * 0.08,
          b = a + 0.08;
        const z = (row - 1) * 0.09 + (step === 0 || step === 4 ? 0.035 : 0);
        points.push(a, 0, z, b, 0, z, a, 0, z + 0.025, b, 0, z, b, 0, z + 0.025, a, 0, z + 0.025);
      }
    }
    const mesh = addMesh(parent, geometryFrom(points), materials.wave, prop.x, prop.y, prop.z);
    mesh.rotation.y = Math.PI / 2 - prop.angle;
    mesh.userData.wavePhase = prop.phase;
    mesh.castShadow = false;
  }
  return { makeTree, makeRock, makeGrass, makePuddle, makeReeds, makeCrops, makeWave };
}
