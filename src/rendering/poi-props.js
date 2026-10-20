import * as THREE from 'three';
import { randomStream } from '../generation/math.js';

// Small dioramas share the existing material roles and building components.
export function createPoiBuilder({ addMesh, propMaterial, makeHouse, makeTower, roofGeometry }) {
  return function makePoi(parent, prop) {
    const random = randomStream(prop.detailSeed);
    const integer = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
    const g = new THREE.Group();
    g.position.set(prop.x, prop.y, prop.z);
    g.rotation.y = 0.55;
    const model = new THREE.Group();
    model.scale.setScalar(prop.footprint / 0.245);
    g.add(model);
    const material = (role) => propMaterial(role, prop.temperature);
    const mesh = (geometry, role, x, y, z) => addMesh(model, geometry, material(role), x, y, z);
    const box = (x, y, z, w, h, d, role = 'rock') =>
      mesh(new THREE.BoxGeometry(w, h, d), role, x, y, z);
    const cylinder = (x, y, z, r, h, role = 'rockLight', top = r, sides = 6) =>
      mesh(new THREE.CylinderGeometry(top, r, h, sides), role, x, y, z);
    const stone = (x, y, z, scale, role = 'rock') => {
      const part = mesh(new THREE.DodecahedronGeometry(scale, 0), role, x, y, z);
      part.scale.set(0.8, 1.3, 0.7);
      part.rotation.y = random() * Math.PI;
      return part;
    };
    if (prop.foundationHeights) {
      const vertices = [];
      for (let k = 0; k < 12; k++) {
        const next = (k + 1) % 12;
        const point = (index, y) => [
          Math.cos((index * Math.PI) / 6) * prop.footprint,
          y,
          Math.sin((index * Math.PI) / 6) * prop.footprint,
        ];
        const a = point(k, 0.004),
          b = point(next, 0.004);
        const c = point(k, prop.foundationHeights[k]),
          d = point(next, prop.foundationHeights[next]);
        vertices.push(0, 0.004, 0, ...b, ...a, ...a, ...b, ...c, ...b, ...d, ...c);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      const footing = addMesh(g, geometry, material('ridge'));
      footing.rotation.y = -g.rotation.y;
      footing.userData.poiPart = 'terrain-footing';
    } else
      addMesh(
        g,
        new THREE.CylinderGeometry(prop.footprint, prop.footprint, prop.pedestalDepth + 0.012, 12),
        material('rockMid'),
        0,
        -prop.pedestalDepth / 2,
        0,
      );
    const archProfile = (width, shoulder, top, bottom = 0.015) => {
      const shape = new THREE.Shape();
      shape.moveTo(-width, bottom);
      shape.lineTo(width, bottom);
      shape.lineTo(width, shoulder);
      for (let k = 1; k <= 8; k++) {
        const a = (k * Math.PI) / 8;
        shape.lineTo(Math.cos(a) * width, shoulder + Math.sin(a) * (top - shoulder));
      }
      shape.closePath();
      return shape;
    };
    const arch = (outer, inner, depth, z, role = 'rockLight', tunnel = false) => {
      outer.holes.push(new THREE.Path(inner.getPoints()));
      const geometry = new THREE.ExtrudeGeometry(outer, {
        depth,
        bevelEnabled: false,
        curveSegments: 1,
      });
      geometry.translate(0, 0, -depth);
      const frame = mesh(geometry, role, 0, 0, z);
      frame.userData.poiPart = 'entrance-frame';
      if (tunnel) {
        const back = mesh(new THREE.ShapeGeometry(inner), 'door', 0, 0, z - depth - 0.002);
        back.userData.poiPart = 'tunnel-back';
      }
      return frame;
    };
    const skull = (x, z, scale = 1) => {
      const group = new THREE.Group();
      group.position.set(x, 0.012, z);
      group.scale.setScalar(scale);
      group.userData.poiPart = 'skull';
      model.add(group);
      const part = (geometry, role, px, py, pz) =>
        addMesh(group, geometry, material(role), px, py, pz);
      const head = part(new THREE.DodecahedronGeometry(0.047, 0), 'rockLight', 0, 0.055, 0);
      head.scale.set(1, 0.9, 0.85);
      part(new THREE.BoxGeometry(0.055, 0.024, 0.05), 'rockLight', 0, 0.021, 0.008);
      for (const px of [-0.018, 0.018])
        part(new THREE.BoxGeometry(0.017, 0.018, 0.008), 'door', px, 0.057, 0.036);
      part(new THREE.ConeGeometry(0.008, 0.015, 3), 'door', 0, 0.038, 0.038).rotation.x =
        Math.PI / 2;
      for (let k = -1; k <= 1; k++)
        part(new THREE.BoxGeometry(0.003, 0.012, 0.006), 'door', k * 0.014, 0.016, 0.034);
    };
    if (prop.poiKind === 'ruins') {
      box(0, 0.012, 0, 0.31, 0.024, 0.26, 'rockMid');
      if (prop.variant === 0) {
        arch(archProfile(0.155, 0.22, 0.34), archProfile(0.073, 0.17, 0.25), 0.065, 0.08);
        box(-0.14, 0.115, -0.04, 0.045, 0.23, 0.2);
        box(0, 0.07, -0.12, 0.28, 0.14, 0.045);
        box(0.11, 0.155, -0.12, 0.06, 0.31, 0.045);
        box(-0.105, 0.35, 0.055, 0.075, 0.055, 0.075, 'rockLight');
        box(0, 0.11, -0.07, 0.045, 0.05, 0.13, 'door');
      } else if (prop.variant === 1) {
        arch(archProfile(0.15, 0.21, 0.32), archProfile(0.073, 0.16, 0.24), 0.055, 0.035);
        for (const x of [-0.12, 0.12]) {
          cylinder(x, 0.16, -0.11, 0.031, 0.29);
          box(x, 0.315, -0.11, 0.085, 0.035, 0.075, 'rockLight');
        }
        box(-0.06, 0.35, -0.11, 0.2, 0.04, 0.065, 'rockLight');
        box(0.13, 0.06, 0.1, 0.04, 0.12, 0.09);
      } else {
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 4,
            h = 0.22 + random() * 0.17;
          const wall = box(Math.cos(a) * 0.105, h / 2, Math.sin(a) * 0.105 - 0.025, 0.085, h, 0.04);
          wall.rotation.y = -a + Math.PI / 2;
          box(
            Math.cos(a) * 0.105,
            h + 0.015,
            Math.sin(a) * 0.105 - 0.025,
            0.055,
            0.03,
            0.055,
            'rockLight',
          );
        }
        arch(archProfile(0.11, 0.17, 0.27), archProfile(0.055, 0.13, 0.2), 0.06, 0.12);
      }
      for (let k = 0; k < 4; k++) stone(-0.12 + k * 0.07, 0.028, 0.145, 0.025 + random() * 0.01);
    } else if (prop.poiKind === 'encampment') {
      const tents = integer(1, 3);
      for (let k = 0; k < tents; k++) {
        const a = k * 2.1,
          x = Math.cos(a) * 0.125,
          z = Math.sin(a) * 0.125;
        const tent = new THREE.Group();
        tent.position.set(x, 0.015, z);
        tent.rotation.y = Math.PI / 2 - a;
        tent.userData.poiPart = 'tent';
        model.add(tent);
        addMesh(tent, roofGeometry(0.15, 0.17, 0.18), material(k % 2 ? 'wall' : 'roofLight'));
        const door = new THREE.Shape();
        door.moveTo(-0.044, 0);
        door.lineTo(0.044, 0);
        door.lineTo(0, 0.125);
        door.closePath();
        addMesh(tent, new THREE.ShapeGeometry(door), material('door'), 0, 0.001, 0.086);
        addMesh(
          tent,
          new THREE.CylinderGeometry(0.005, 0.006, 0.2, 4),
          material('trunk'),
          0,
          0.095,
          0.085,
        );
      }
      for (let k = 0; k < 7; k++)
        stone(
          Math.cos((k * Math.PI * 2) / 7) * 0.047,
          0.015,
          Math.sin((k * Math.PI * 2) / 7) * 0.047,
          0.016,
          'rockMid',
        );
      const log = box(0, 0.025, 0, 0.08, 0.025, 0.022, 'trunk');
      log.rotation.y = 0.65;
      mesh(new THREE.ConeGeometry(0.034, 0.105, 5), 'roofLight', 0, 0.08, 0);
      box(0, 0.025, -0.17, 0.065, 0.05, 0.045, 'bridgeWood');
    } else if (prop.poiKind === 'watchtower') {
      if (prop.variant === 'watchtower')
        makeTower(model, {
          x: 0,
          y: 0,
          z: 0,
          angle: 0,
          scale: 0.55,
          temperature: prop.temperature,
        });
      else {
        cylinder(0, 0.2, 0, 0.105, 0.4, 'wall', 0.073);
        cylinder(0, 0.405, 0, 0.12, 0.035, 'rockLight');
        cylinder(0, 0.48, 0, 0.07, 0.11, 'waterEdge');
        for (const x of [-0.064, 0.064])
          for (const z of [-0.045, 0.045]) box(x, 0.48, z, 0.014, 0.12, 0.014, 'door');
        mesh(new THREE.ConeGeometry(0.11, 0.09, 6), 'roof', 0, 0.58, 0);
      }
    } else if (prop.poiKind === 'stronghold') {
      const variant = Number(prop.variant) % 3;
      box(0, 0.016, 0, 0.32, 0.032, 0.3, 'rockMid');
      for (const x of [-0.145, 0.145]) box(x, 0.095, 0, 0.035, 0.19, 0.27, 'wall');
      box(0, 0.095, -0.135, 0.29, 0.19, 0.035, 'wall');
      for (const x of [-0.11, 0.11]) box(x, 0.085, 0.135, 0.08, 0.17, 0.035, 'wall');
      arch(
        archProfile(0.085, 0.13, 0.205),
        archProfile(0.042, 0.095, 0.15),
        0.045,
        0.155,
        'rockLight',
      );
      box(0, 0.08, 0.13, 0.065, 0.14, 0.012, 'door');
      for (let k = -2; k <= 2; k++) {
        box(k * 0.055, 0.21, -0.135, 0.028, 0.045, 0.04, 'rockLight');
        for (const x of [-0.145, 0.145]) box(x, 0.21, k * 0.05, 0.04, 0.045, 0.028, 'rockLight');
      }
      const corners = [
        [-0.125, -0.11],
        [0.125, -0.11],
        [-0.125, 0.11],
        [0.125, 0.11],
      ];
      for (let k = 0; k < 2 + variant; k++) {
        const [x, z] = corners[k],
          height = 0.25 + random() * 0.13;
        cylinder(x, height / 2, z, 0.044, height, 'wall', 0.044, variant === 0 ? 4 : 8);
        if (variant === 1 && k % 2 === 0)
          mesh(new THREE.ConeGeometry(0.06, 0.13, 6), 'roof', x, height + 0.065, z);
        else {
          cylinder(x, height + 0.012, z, 0.053, 0.028, 'rockLight', 0.053, 8);
          for (let i = 0; i < 4; i++)
            box(
              x + Math.cos((i * Math.PI) / 2) * 0.033,
              height + 0.043,
              z + Math.sin((i * Math.PI) / 2) * 0.033,
              0.025,
              0.035,
              0.025,
              'rockLight',
            );
        }
      }
      if (variant === 0) {
        box(0.025, 0.19, -0.025, 0.16, 0.38, 0.15, 'wall');
        mesh(new THREE.ConeGeometry(0.135, 0.15, 4), 'roof', 0.025, 0.455, -0.025).rotation.y =
          Math.PI / 4;
      } else if (variant === 1) {
        cylinder(-0.025, 0.215, -0.025, 0.085, 0.43, 'wall', 0.085, 8);
        cylinder(-0.025, 0.445, -0.025, 0.1, 0.04, 'rockLight', 0.1, 8);
      } else
        makeHouse(model, {
          x: 0,
          y: 0.02,
          z: -0.035,
          angle: 0,
          scale: 0.52,
          variant: 2,
          temperature: prop.temperature,
        });
    } else if (prop.poiKind === 'lair') {
      if (prop.variant === 'nest') {
        for (const y of [0.035, 0.075]) {
          const ring = mesh(new THREE.TorusGeometry(0.13, 0.032, 4, 11), 'trunk', 0, y, 0);
          ring.rotation.x = Math.PI / 2;
        }
        for (let k = 0; k < 9; k++) {
          const a = (k * Math.PI * 2) / 9;
          const twig = box(
            Math.cos(a) * 0.13,
            0.06,
            Math.sin(a) * 0.13,
            0.11,
            0.015,
            0.018,
            'bridgeWood',
          );
          twig.rotation.y = -a + 0.7;
        }
        for (const [x, z] of [
          [-0.047, 0.018],
          [0.045, 0.015],
          [0, -0.05],
        ]) {
          const egg = stone(x, 0.1, z, 0.047, 'rockLight');
          egg.scale.set(0.8, 1.3, 0.8);
        }
      } else {
        arch(
          archProfile(0.18, 0.12, 0.3, 0),
          archProfile(0.095, 0.11, 0.205),
          0.14,
          0.055,
          'rockMid',
          true,
        );
        for (const x of [-0.15, 0.15]) stone(x, 0.09, -0.035, 0.055);
        stone(-0.08, 0.265, -0.015, 0.06, 'rock');
        box(0, 0.009, 0.1, 0.16, 0.018, 0.14, 'rockMid');
        skull(-0.125, 0.125, 0.65);
      }
    } else if (prop.poiKind === 'mystic') {
      if (prop.variant === 'portal') {
        const ring = mesh(new THREE.TorusGeometry(0.135, 0.028, 4, 10), 'rockLight', 0, 0.22, 0);
        ring.rotation.z = 0;
        mesh(new THREE.CircleGeometry(0.105, 10), 'waterEdge', 0, 0.22, -0.006);
        for (const x of [-0.13, 0.13]) box(x, 0.07, 0, 0.065, 0.14, 0.085);
        box(0, 0.017, 0, 0.31, 0.034, 0.19, 'rockMid');
        for (const x of [-0.13, 0.13]) box(x, 0.2, 0.029, 0.016, 0.04, 0.008, 'waterEdge');
      } else if (prop.variant === 'altar') {
        box(0, 0.018, 0, 0.31, 0.036, 0.23, 'rockMid');
        box(0, 0.11, 0, 0.16, 0.19, 0.12);
        box(0, 0.225, 0, 0.29, 0.05, 0.19, 'rockLight');
        cylinder(0, 0.27, 0, 0.055, 0.04, 'rockMid');
        mesh(new THREE.IcosahedronGeometry(0.045, 0), 'waterEdge', 0, 0.345, 0);
        for (const x of [-0.1, 0, 0.1]) box(x, 0.23, 0.101, 0.018, 0.022, 0.008, 'waterEdge');
      } else {
        for (const [x, z, h] of [
          [0, -0.045, 0.43],
          [-0.13, 0.075, 0.29],
          [0.13, 0.075, 0.34],
        ]) {
          const monolith = mesh(new THREE.DodecahedronGeometry(1, 0), 'rockLight', x, h / 2, z);
          monolith.scale.set(0.065, h / 2, 0.045);
          box(x, h * 0.58, z + 0.045, 0.014, h * 0.28, 0.008, 'waterEdge');
        }
      }
    } else if (prop.poiKind === 'abbey') {
      makeHouse(model, {
        x: 0,
        y: 0,
        z: 0,
        angle: Math.PI / 2,
        scale: 0.62,
        variant: 1,
        temperature: prop.temperature,
      });
      cylinder(-0.12, 0.16, -0.07, 0.065, 0.32, 'wall', 0.065, 4);
      mesh(new THREE.ConeGeometry(0.095, 0.14, 4), 'roof', -0.12, 0.39, -0.07);
    } else if (prop.poiKind === 'battlefield') {
      cylinder(-0.08, 0.27, -0.035, 0.009, 0.54, 'trunk');
      const flag = new THREE.Shape();
      flag.moveTo(-0.07, 0.51);
      flag.lineTo(0.12, 0.49);
      flag.lineTo(0.12, 0.34);
      flag.lineTo(0.075, 0.365);
      flag.lineTo(0.025, 0.34);
      flag.lineTo(-0.07, 0.36);
      flag.closePath();
      const banner = mesh(new THREE.ShapeGeometry(flag), 'roofLight', 0, 0, -0.025);
      banner.material.side = THREE.DoubleSide;
      banner.userData.poiPart = 'banner';
      const sites = [
        [-0.13, 0.1],
        [-0.02, 0.14],
        [0.105, 0.1],
        [-0.09, -0.12],
        [0.1, -0.1],
      ];
      for (let k = 0, count = integer(1, 5); k < count; k++) skull(...sites[k]);
    } else if (prop.poiKind === 'dungeon') {
      const mine = prop.variant === 'mine';
      const opening = mine ? new THREE.Shape() : archProfile(0.075, 0.15, 0.235);
      if (mine) {
        opening.moveTo(-0.075, 0.015);
        opening.lineTo(0.075, 0.015);
        opening.lineTo(0.075, 0.225);
        opening.lineTo(-0.075, 0.225);
        opening.closePath();
      }
      arch(
        archProfile(0.18, 0.18, 0.34, 0),
        opening,
        0.15,
        0.065,
        mine ? 'rockMid' : 'rockLight',
        true,
      );
      for (const x of [-0.15, 0.15]) stone(x, 0.08, -0.055, 0.055, 'rockMid');
      if (mine) {
        for (const x of [-0.102, 0.102]) box(x, 0.125, 0.082, 0.044, 0.25, 0.05, 'bridgeDark');
        box(0, 0.247, 0.082, 0.25, 0.045, 0.06, 'bridgeWood');
        for (const x of [-0.055, 0.055]) box(x, 0.016, 0.055, 0.014, 0.028, 0.3, 'rockMid');
        for (let k = 0; k < 5; k++)
          box(0, 0.009, -0.06 + k * 0.055, 0.15, 0.018, 0.018, 'bridgeWood');
        box(0.1, 0.065, 0.145, 0.085, 0.065, 0.075, 'bridgeDark');
        for (const x of [0.063, 0.137])
          for (const z of [0.12, 0.17]) cylinder(x, 0.025, z, 0.013, 0.02, 'rockMid', 0.013, 6);
        stone(-0.14, 0.04, 0.115, 0.035, 'waterEdge');
      } else {
        for (let k = 0; k < 3; k++)
          box(0, 0.014 + k * 0.014, 0.18 - k * 0.048, 0.17, 0.028, 0.055, 'rockMid');
        for (const x of [-0.04, 0, 0.04]) box(x, 0.12, 0.005, 0.008, 0.2, 0.012, 'rockMid');
        box(0, 0.205, 0.072, 0.18, 0.035, 0.065, 'rock');
        box(0, 0.31, 0.072, 0.055, 0.075, 0.075, 'rock');
        for (const x of [-0.13, 0.13]) {
          box(x, 0.16, 0.079, 0.025, 0.06, 0.035, 'door');
          cylinder(x, 0.19, 0.08, 0.019, 0.035, 'waterEdge', 0.019, 4);
        }
      }
    }
    parent.add(g);
  };
}
