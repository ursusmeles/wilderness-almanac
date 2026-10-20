import * as THREE from 'three';
import { addMesh, geometryFrom } from './geometry.js';

export function createCrossingBuilder(materials) {
  function timberBetween(parent, a, b, width, material) {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b),
      delta = new THREE.Vector3().subVectors(end, start),
      mesh = addMesh(parent, new THREE.CylinderGeometry(width, width, delta.length(), 5), material);
    mesh.position.copy(start.add(end).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return mesh;
  }
  function makeStoneBridge(parent, length, heights) {
    const arch = (t) => heights[0] * (1 - t) + heights[1] * t + 0.025 + 0.1 * Math.sin(Math.PI * t),
      points = [];
    for (let j = 0; j < 20; j++) {
      const ta = j / 20,
        tb = (j + 1) / 20,
        xa = (ta - 0.5) * length,
        xb = (tb - 0.5) * length,
        ya = arch(ta),
        yb = arch(tb);
      const a = [xa, ya, -0.125],
        b = [xb, yb, -0.125],
        c = [xa, ya, 0.125],
        d = [xb, yb, 0.125];
      points.push(...a, ...c, ...b, ...b, ...c, ...d);
      for (const sign of [-1, 1]) {
        const z = sign * 0.125,
          lowA = ya - 0.085,
          lowB = yb - 0.085;
        points.push(xa, ya, z, xb, yb, z, xa, lowA, z, xb, yb, z, xb, lowB, z, xa, lowA, z);
      }
    }
    const mesh = addMesh(parent, geometryFrom(points), materials.rock);
    mesh.material.side = THREE.DoubleSide;
    for (const side of [-1, 1])
      for (let j = 0; j < 9; j++) {
        const t = (j + 0.5) / 9;
        addMesh(
          parent,
          new THREE.BoxGeometry((length / 9) * 0.98, 0.06, 0.035),
          materials.rockLight,
          (t - 0.5) * length,
          arch(t) + 0.025,
          side * 0.13,
        );
      }
    for (const side of [-1, 1]) {
      const y = heights[side === -1 ? 0 : 1] + 0.045;
      addMesh(
        parent,
        new THREE.BoxGeometry(0.12, y, 0.27),
        materials.rockMid,
        side * (length / 2 - 0.06),
        y / 2,
        0,
      );
    }
  }
  function makeCrossing(parent, crossing) {
    const { a, b } = crossing,
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz),
      g = new THREE.Group();
    g.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
    g.rotation.y = -Math.atan2(dz, dx);
    g.userData.crossing = crossing.kind;
    parent.add(g);
    if (crossing.kind === 'bridge') {
      if (crossing.material === 'stone') {
        makeStoneBridge(g, length, crossing.heights);
        return;
      }
      const count = Math.ceil(length / 0.085),
        arch = (t) =>
          crossing.heights[0] * (1 - t) +
          crossing.heights[1] * t +
          0.02 +
          0.075 * Math.sin(t * Math.PI);
      for (let j = 0; j < count; j++) {
        const t = (j + 0.5) / count;
        addMesh(
          g,
          new THREE.BoxGeometry((length / count) * 0.94, 0.028, 0.225),
          j % 3 === 0 ? materials.bridgeLight : materials.bridgeWood,
          (t - 0.5) * length,
          arch(t),
          0,
        );
      }
      for (const z of [-0.127, 0.127]) {
        for (let j = 0; j < 5; j++) {
          const t = j / 4,
            x = (t - 0.5) * length,
            y = arch(t);
          addMesh(
            g,
            new THREE.CylinderGeometry(0.012, 0.014, 0.15, 5),
            materials.bridgeDark,
            x,
            y + 0.065,
            z,
          );
          if (j < 4) {
            const t2 = (j + 1) / 4;
            timberBetween(
              g,
              [x, y + 0.13, z],
              [(t2 - 0.5) * length, arch(t2) + 0.13, z],
              0.01,
              materials.bridgeLight,
            );
          }
        }
        for (let j = 0; j < 4; j++) {
          const t = j / 4,
            t2 = (j + 1) / 4;
          timberBetween(
            g,
            [(t - 0.5) * length, arch(t) - 0.035, z * 0.65],
            [(t2 - 0.5) * length, arch(t2) - 0.035, z * 0.65],
            0.018,
            materials.bridgeDark,
          );
        }
      }
      for (const t of [0.24, 0.76])
        for (const z of [-0.085, 0.085]) {
          const height = arch(t) - 0.02;
          addMesh(
            g,
            new THREE.CylinderGeometry(0.018, 0.024, height, 5),
            materials.bridgeDark,
            (t - 0.5) * length,
            height / 2,
            z,
          );
        }
    } else {
      const dockStep = Math.min(0.037, (length * 0.22) / 6);
      const dockLength = dockStep * 6;
      for (const sign of [-1, 1]) {
        const dock = new THREE.Group();
        dock.userData.prop = 'dock';
        g.add(dock);
        const x = (sign * length) / 2,
          bank = crossing.heights[sign === -1 ? 0 : 1],
          height = bank + 0.018;
        for (let j = 0; j < 7; j++)
          addMesh(
            dock,
            new THREE.BoxGeometry(dockStep * 1.05, 0.025, 0.23),
            j % 2 ? materials.bridgeWood : materials.bridgeLight,
            x - sign * j * dockStep,
            height,
            0,
          );
        for (const d of [dockLength * 0.1, dockLength * 0.9])
          for (const z of [-0.095, 0.095]) {
            const h = height + 0.045;
            addMesh(
              dock,
              new THREE.CylinderGeometry(0.014, 0.018, h, 5),
              materials.bridgeDark,
              x - sign * d,
              h / 2,
              z,
            );
          }
        timberBetween(
          dock,
          [x, height - 0.028, -0.075],
          [x - sign * dockLength, height - 0.028, -0.075],
          0.015,
          materials.bridgeDark,
        );
        timberBetween(
          dock,
          [x, height - 0.028, 0.075],
          [x - sign * dockLength, height - 0.028, 0.075],
          0.015,
          materials.bridgeDark,
        );
      }
      const boat = new THREE.Group();
      boat.userData.prop = 'ferry';
      boat.scale.setScalar(Math.min(1, (length * 0.33) / 0.38));
      boat.position.x = (crossing.boatPosition - 0.5) * length;
      g.add(boat);
      const outline = [
          [-0.18, 0],
          [-0.11, -0.13],
          [0.12, -0.13],
          [0.19, 0],
          [0.12, 0.13],
          [-0.11, 0.13],
        ],
        hull = [];
      for (let k = 0; k < 6; k++) {
        const a = outline[k],
          b = outline[(k + 1) % 6],
          bottomA = [a[0] * 0.74, 0.008, a[1] * 0.74],
          bottomB = [b[0] * 0.74, 0.008, b[1] * 0.74],
          topA = [a[0], 0.072, a[1]],
          topB = [b[0], 0.072, b[1]];
        hull.push(...bottomA, ...topA, ...bottomB, ...bottomB, ...topA, ...topB);
      }
      const hullMesh = addMesh(boat, geometryFrom(hull), materials.bridgeDark);
      hullMesh.material.side = THREE.DoubleSide;
      for (let j = 0; j < 6; j++)
        addMesh(
          boat,
          new THREE.BoxGeometry(0.041, 0.019, 0.2),
          j % 2 ? materials.bridgeLight : materials.bridgeWood,
          -0.11 + j * 0.044,
          0.05,
          0,
        );
      for (const x of [-0.08, 0.085])
        addMesh(boat, new THREE.BoxGeometry(0.035, 0.025, 0.21), materials.bridgeWood, x, 0.088, 0);
      timberBetween(boat, [-0.13, 0.105, 0.04], [0.19, 0.105, 0.17], 0.008, materials.bridgeLight);
    }
  }

  return makeCrossing;
}
