import * as THREE from 'three';

export function createPartyPiece(style = 0, color = '#ec405c') {
  const group = new THREE.Group();
  const materials = [];
  const mat = (value) => {
    const material = new THREE.MeshStandardMaterial({
      color: value,
      roughness: 0.93,
      flatShading: true,
    });
    materials.push(material);
    return material;
  };
  const accent = mat(color),
    pale = mat(style === 1 ? '#c9a576' : '#efe1be'),
    dark = mat('#302d2b');
  function mesh(geometry, material, x, y, z) {
    const part = new THREE.Mesh(geometry, material);
    part.position.set(x, y, z);
    part.castShadow = true;
    group.add(part);
    return part;
  }
  const cylinder = (top, bottom, h, y, material, sides = 8) =>
    mesh(new THREE.CylinderGeometry(top, bottom, h, sides), material, 0, y, 0);
  const selectionMaterial = new THREE.MeshBasicMaterial({
    color: '#fff1b8',
    side: THREE.DoubleSide,
  });
  materials.push(selectionMaterial);
  const selection = mesh(new THREE.RingGeometry(0.225, 0.26, 24), selectionMaterial, 0, 0.01, 0);
  selection.rotation.x = -Math.PI / 2;
  selection.visible = false;
  cylinder(0.19, 0.22, 0.07, 0.035, dark);
  cylinder(0.185, 0.2, 0.07, 0.095, accent);
  if (style === 0) {
    // Bevelled, domed obelisk inspired by the Lewis pawns.
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
    shield.lineTo(0.11, -0.08);
    shield.lineTo(0, -0.18);
    shield.lineTo(-0.11, -0.08);
    shield.closePath();
    mesh(
      new THREE.ExtrudeGeometry(shield, { depth: 0.035, bevelEnabled: false }),
      pale,
      0,
      0.32,
      0.15,
    );
    mesh(new THREE.BoxGeometry(0.025, 0.2, 0.015), accent, 0, 0.32, 0.195);
  } else {
    cylinder(0.08, 0.145, 0.57, 0.42, pale, 6);
    cylinder(0, 0.08, 0.14, 0.775, accent, 6);
    for (const y of [0.32, 0.44, 0.56]) {
      const rune = mesh(
        new THREE.BoxGeometry(0.07, 0.018, 0.018),
        accent,
        0,
        y,
        0.112 - (y - 0.32) * 0.11,
      );
      rune.rotation.z = Math.PI / 4;
    }
  }
  mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.83, 6), dark, 0.15, 0.49, -0.035);
  mesh(new THREE.SphereGeometry(0.027, 6, 4), pale, 0.15, 0.92, -0.035);
  const flag = new THREE.Shape();
  flag.moveTo(0, 0);
  flag.lineTo(0.34, -0.015);
  if (style === 0) {
    flag.lineTo(0.26, -0.1);
    flag.lineTo(0.34, -0.19);
  } else if (style === 1) flag.lineTo(0.29, -0.21);
  else flag.lineTo(0.34, -0.22);
  flag.lineTo(0, -0.19);
  flag.closePath();
  const banner = mesh(
    new THREE.ExtrudeGeometry(flag, { depth: 0.018, bevelEnabled: false }),
    accent,
    0.16,
    0.87,
    -0.035,
  );
  banner.rotation.y = -0.45;
  group.rotation.y = 0.55;
  return {
    group,
    setSelected(selected) {
      selection.visible = selected;
    },
    dispose() {
      group.traverse((part) => part.geometry?.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
