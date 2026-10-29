import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pixelModelMesh } from './pixel-model-geometry.js';
import { createPartyPieceMaterials } from './party-piece-materials.js';

export function createPartyPiece(style = 0, color = '#ec405c') {
  const group = new THREE.Group();
  const materials = createPartyPieceMaterials(style, color);
  const { accent, pale, dark } = materials;
  const mesh = (geometry, material, x, y, z) => pixelModelMesh(group, geometry, material, x, y, z);
  const cylinder = (top, bottom, h, y, material, sides = 8) =>
    mesh(new THREE.CylinderGeometry(top, bottom, h, sides), material, 0, y, 0);
  const selectionMaterial = new THREE.MeshBasicMaterial({
    color: '#fff1b8',
    side: THREE.DoubleSide,
  });
  // Keep the existing selection ring's exact geometry and material.
  const selection = new THREE.Mesh(new THREE.RingGeometry(0.225, 0.26, 24), selectionMaterial);
  selection.position.set(0, 0.01, 0);
  selection.castShadow = true;
  group.add(selection);
  selection.rotation.x = -Math.PI / 2;
  selection.visible = false;
  cylinder(0.19, 0.22, 0.07, 0.035, dark);
  cylinder(0.185, 0.2, 0.07, 0.095, accent);
  if (style === 0) {
    // Carved Cairn, with stepped shoulders and an inset coloured seal.
    cylinder(0.125, 0.18, 0.43, 0.34, pale);
    cylinder(0.09, 0.13, 0.13, 0.62, pale);
    cylinder(0, 0.09, 0.07, 0.72, pale);
    cylinder(0.158, 0.162, 0.035, 0.32, accent);
    const diamond = mesh(new THREE.BoxGeometry(0.105, 0.105, 0.025), accent, 0, 0.48, 0.146);
    diamond.rotation.z = Math.PI / 4;
  } else if (style === 1) {
    cylinder(0.12, 0.19, 0.35, 0.31, accent, 6);
    cylinder(0.14, 0.14, 0.16, 0.55, pale, 8);
    cylinder(0, 0.16, 0.12, 0.69, dark, 8);
    mesh(new THREE.BoxGeometry(0.19, 0.025, 0.025), dark, 0, 0.56, 0.135);
    const shield = new THREE.Shape();
    shield.moveTo(-0.13, 0.12);
    shield.lineTo(0.13, 0.12);
    shield.lineTo(0.13, -0.02);
    shield.lineTo(0.1, -0.02);
    shield.lineTo(0.1, -0.08);
    shield.lineTo(0.06, -0.08);
    shield.lineTo(0.06, -0.13);
    shield.lineTo(0.02, -0.13);
    shield.lineTo(0.02, -0.17);
    shield.lineTo(-0.02, -0.17);
    shield.lineTo(-0.02, -0.13);
    shield.lineTo(-0.06, -0.13);
    shield.lineTo(-0.06, -0.08);
    shield.lineTo(-0.1, -0.08);
    shield.lineTo(-0.1, -0.02);
    shield.lineTo(-0.13, -0.02);
    shield.closePath();
    mesh(
      new THREE.ExtrudeGeometry(shield, { depth: 0.035, bevelEnabled: false }),
      pale,
      0,
      0.32,
      0.15,
    );
    mesh(new THREE.BoxGeometry(0.025, 0.2, 0.015), accent, 0, 0.32, 0.195);
    mesh(new THREE.BoxGeometry(0.12, 0.025, 0.015), accent, 0, 0.35, 0.195);
    for (const x of [-0.13, 0.13])
      mesh(new THREE.BoxGeometry(0.065, 0.075, 0.14), pale, x, 0.43, 0);
    mesh(new THREE.BoxGeometry(0.035, 0.06, 0.18), accent, 0, 0.74, -0.01);
  } else {
    cylinder(0.08, 0.145, 0.57, 0.42, pale, 6);
    cylinder(0, 0.08, 0.14, 0.775, accent, 6);
    mesh(new THREE.BoxGeometry(0.09, 0.33, 0.02), dark, 0, 0.445, 0.12);
    for (const y of [0.32, 0.44, 0.56]) {
      const z = 0.137;
      for (const [x, dy] of [
        [-0.02, 0],
        [0, 0.02],
        [0.02, 0],
      ])
        mesh(new THREE.BoxGeometry(0.025, 0.025, 0.018), accent, x, y + dy, z);
    }
  }
  mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.83, 6), dark, 0.15, 0.49, -0.035);
  mesh(new THREE.SphereGeometry(0.027, 6, 4), pale, 0.15, 0.92, -0.035);
  const flag = new THREE.Shape();
  flag.moveTo(0, 0);
  flag.lineTo(0.32, 0);
  flag.lineTo(0.32, -0.04);
  if (style === 0) {
    flag.lineTo(0.28, -0.04);
    flag.lineTo(0.28, -0.08);
    flag.lineTo(0.24, -0.08);
    flag.lineTo(0.24, -0.12);
    flag.lineTo(0.28, -0.12);
    flag.lineTo(0.28, -0.16);
    flag.lineTo(0.32, -0.16);
    flag.lineTo(0.32, -0.2);
  } else if (style === 1) {
    flag.lineTo(0.28, -0.04);
    flag.lineTo(0.28, -0.16);
    flag.lineTo(0.24, -0.16);
    flag.lineTo(0.24, -0.2);
  } else {
    flag.lineTo(0.32, -0.2);
    flag.lineTo(0.28, -0.2);
    flag.lineTo(0.28, -0.16);
    flag.lineTo(0.24, -0.16);
    flag.lineTo(0.24, -0.2);
  }
  flag.lineTo(0, -0.2);
  flag.closePath();
  const banner = mesh(
    new THREE.ExtrudeGeometry(flag, { depth: 0.018, bevelEnabled: false }),
    accent,
    0.16,
    0.87,
    -0.035,
  );
  banner.rotation.y = -0.45;
  // Merge solid parts by ramp; details add no separate draw call per pixel.
  const batches = new Map();
  for (const part of [...group.children]) {
    if (part === selection) continue;
    part.updateMatrix();
    const geometry = part.geometry.clone().applyMatrix4(part.matrix);
    if (!batches.has(part.material)) batches.set(part.material, []);
    batches.get(part.material).push(geometry);
    part.geometry.dispose();
    part.removeFromParent();
  }
  for (const [material, geometries] of batches) {
    const part = new THREE.Mesh(mergeGeometries(geometries), material);
    part.castShadow = part.receiveShadow = true;
    group.add(part);
    geometries.forEach((geometry) => geometry.dispose());
  }
  group.rotation.y = 0.55;
  return {
    group,
    setSelected(selected) {
      selection.visible = selected;
    },
    dispose() {
      group.traverse((part) => part.geometry?.dispose());
      selectionMaterial.dispose();
      materials.dispose();
    },
  };
}
