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
