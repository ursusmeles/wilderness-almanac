import * as THREE from 'three';
import { terrainFootingGeometry } from './geometry.js';
import { steppedRoofGeometry } from './pixel-model-geometry.js';

// Reuse cosmetic detail seeds without consuming any placement randomness.
export const settlementRoofTone = (prop) =>
  prop.detailSeed === undefined ? 0 : (prop.detailSeed % 5) - 2;

// Settlement models share building components and palette roles.
export function createSettlementBuilder({
  addMesh,
  propMaterial,
  roofGeometry,
  registerLight = () => {},
}) {
  function makeFooting(parent, prop) {
    if (!prop.foundationHeights) return;
    addMesh(
      parent,
      terrainFootingGeometry(prop.footprint, prop.foundationHeights),
      propMaterial('ridge'),
      prop.x,
      prop.y,
      prop.z,
    );
  }
  function makeHouse(parent, prop) {
    makeFooting(parent, prop);
    const g = new THREE.Group();
    g.position.set(prop.x, prop.y || 0, prop.z);
    g.rotation.y = prop.angle;
    g.scale.setScalar(prop.scale);
    const storeys = prop.storeys ?? 1;
    const straw = prop.roof === 'straw';
    const height = ((prop.variant === 2 ? 0.43 : 0.33) + (storeys - 1) * 0.27) * (straw ? 0.85 : 1);
    const roofHeight = prop.variant === 1 ? 0.19 : 0.27;
    addMesh(
      g,
      new THREE.BoxGeometry(0.36, height, 0.45),
      propMaterial('wall', prop.temperature),
      0,
      height / 2,
      0,
    );
    const roof = addMesh(
      g,
      roofGeometry(0.46, 0.55, roofHeight),
      propMaterial(
        straw ? 'straw' : prop.variant === 1 ? 'roofLight' : 'roof',
        prop.temperature,
        settlementRoofTone(prop),
      ),
      0,
      height,
      0,
    );
    roof.material.side = THREE.DoubleSide;
    if (straw) {
      addMesh(
        g,
        new THREE.BoxGeometry(0.46, 0.025, 0.55),
        propMaterial('strawDark', prop.temperature, settlementRoofTone(prop)),
        0,
        height,
        0,
      );
      for (const side of [-1, 1]) {
        for (let k = -2; k <= 2; k++) {
          const bundle = addMesh(
            g,
            new THREE.BoxGeometry(Math.hypot(0.23, roofHeight) * 0.98, 0.008, 0.013),
            propMaterial('strawDark', prop.temperature, settlementRoofTone(prop)),
            side * 0.115,
            height + roofHeight / 2 + 0.005,
            k * 0.105,
          );
          bundle.rotation.z = -side * Math.atan2(roofHeight, 0.23);
        }
      }
    }
    addMesh(
      g,
      new THREE.BoxGeometry(0.09, 0.18, 0.012),
      propMaterial('door', prop.temperature),
      0.06,
      0.09,
      0.232,
    );
    if (prop.variant === 2)
      addMesh(
        g,
        new THREE.BoxGeometry(0.065, 0.2, 0.07),
        propMaterial('wall', prop.temperature),
        -0.1,
        height + 0.14,
        -0.08,
      );
    for (let floor = 1; floor < storeys; floor++) {
      for (const x of [-0.1, 0.1])
        addMesh(
          g,
          new THREE.BoxGeometry(0.065, 0.095, 0.012),
          propMaterial('door', prop.temperature),
          x,
          0.17 + floor * 0.27,
          0.232,
        );
    }
    registerLight(g, { kind: 'warm', position: [0.06, 0.125, 0.241], size: [0.06, 0.075] });
    parent.add(g);
  }
  function makeTower(parent, prop) {
    makeFooting(parent, prop);
    const g = new THREE.Group();
    g.position.set(prop.x, prop.y || 0, prop.z);
    g.rotation.y = prop.angle;
    g.scale.setScalar(prop.scale);
    addMesh(
      g,
      new THREE.CylinderGeometry(0.22, 0.25, 0.67, 6),
      propMaterial('wall', prop.temperature),
      0,
      0.335,
      0,
    );
    addMesh(
      g,
      new THREE.ConeGeometry(0.33, 0.39, 6),
      propMaterial(
        prop.roof === 'straw' ? 'straw' : 'roof',
        prop.temperature,
        settlementRoofTone(prop),
      ),
      0,
      0.865,
      0,
    );
    addMesh(
      g,
      new THREE.BoxGeometry(0.12, 0.24, 0.015),
      propMaterial('door', prop.temperature),
      0,
      0.12,
      0.22,
    );
    registerLight(g, { kind: 'warm', position: [0, 0.47, 0.24], size: [0.075, 0.1] });
    parent.add(g);
  }
  function makeHall(parent, prop) {
    makeHouse(parent, { ...prop, scale: prop.scale, variant: 2 });
    makeTower(parent, { ...prop, x: prop.x - 0.07, z: prop.z - 0.04, scale: prop.scale * 0.7 });
  }
  function makeBarrier(parent, prop) {
    const g = new THREE.Group();
    g.position.set(prop.x, prop.y || 0, prop.z);
    g.rotation.y = -prop.angle;
    const fence = prop.kind === 'fence';
    const box = (w, h, d, x, y, role) =>
      addMesh(g, new THREE.BoxGeometry(w, h, d), propMaterial(role, prop.temperature), x, y, 0);
    if (fence) {
      for (const y of [0.055, 0.115]) box(prop.length, 0.018, 0.018, 0, y, 'bridgeWood');
      for (const x of [-prop.length / 2, 0, prop.length / 2]) {
        box(0.024, 0.16, 0.024, x, 0.08, 'bridgeDark');
        const tip = addMesh(
          g,
          new THREE.ConeGeometry(0.018, 0.035, 4),
          propMaterial('bridgeWood', prop.temperature),
          x,
          0.1775,
          0,
        );
        tip.rotation.y = Math.PI / 4;
      }
    } else {
      box(prop.length, 0.19, 0.055, 0, 0.095, 'rockMid');
      box(prop.length, 0.025, 0.065, 0, 0.195, 'rock');
      for (let k = 0; k <= 6; k++)
        box(0.045, 0.035, 0.055, (k / 6 - 0.5) * prop.length, 0.2225, 'rock');
      for (const x of [-prop.length / 2, prop.length / 2]) box(0.06, 0.26, 0.06, x, 0.13, 'rock');
    }
    parent.add(g);
  }
  return { makeHouse, makeTower, makeHall, makeBarrier };
}

export function roofGeometry(w, d, h) {
  return steppedRoofGeometry(w, d, h);
}
