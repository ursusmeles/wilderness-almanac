import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTopology } from '../src/map-data.js';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { generatePropDressing, TOKEN_ANCHOR } from '../src/generation/props.js';
import { distance, DIRECTIONS } from '../src/generation/hex.js';
import { barrierDistance, barrierEnds, isBarrier } from '../src/generation/settlement-props.js';
import { fitsHex } from '../src/generation/legacy.js';
import { POI_ANCHOR } from '../src/generation/points-of-interest.js';
import { createSettlementBuilder, roofGeometry } from '../src/rendering/settlement-props.js';
import { windWeight, installTreeSway } from '../src/rendering/ambient-motion.js';

function fixture(type, size = 1, poi = false) {
  const world = {
    seed: 'settlement-props',
    cells: createTopology().cells.filter((c) => distance(c) <= 2),
  };
  const keys = ['0,0', '1,0', '0,1'].slice(0, size);
  for (const cell of world.cells) {
    cell.elevation = 1;
    cell.terrain = 'meadow';
    if (keys.includes(cell.key)) {
      cell.pointOfLight = { id: 'settlement', type, centre: cell.key === '0,0' };
      if (poi)
        cell.pointsOfInterest = [
          { kind: 'watchtower', variant: 'watchtower', temperature: -1, detailSeed: 7 },
        ];
    }
  }
  return world;
}

test('villages have roughly three straw-roof cottages and occasional fences; cities are denser and taller', () => {
  const counts = { village: 0, town: 0, city: 0, fenced: 0, tall: 0 };
  for (const type of ['village', 'town', 'city']) {
    const world = fixture(type);
    const before = structuredClone(world);
    for (let variant = 0; variant < 80; variant++) {
      const data = generatePropDressing(world, variant, new Map()).find((c) => c.key === '0,0');
      const houses = data.props.filter((p) => p.kind === 'house');
      counts[type] += houses.length;
      if (type === 'village') {
        assert.ok(houses.length >= 2 && houses.length <= 4);
        assert.ok(
          data.props
            .filter((p) => p.kind === 'house' || p.kind === 'tower')
            .every((p) => p.roof === 'straw'),
        );
        counts.fenced += data.props.some((p) => p.kind === 'fence');
      } else if (type === 'town') {
        assert.ok(!data.props.some(isBarrier));
        assert.ok(houses.every((p) => p.roof === undefined && p.storeys === undefined));
      } else {
        assert.ok(!data.props.some((p) => ['grass', 'rock'].includes(p.kind)));
        const walls = data.props.filter((p) => p.kind === 'city-wall');
        assert.ok(walls.length === 2 || walls.length === 3);
        counts.tall += houses.filter((p) => p.storeys >= 2).length;
      }
    }
    assert.deepEqual(world, before);
  }
  assert.ok(counts.village / 80 > 2.7 && counts.village / 80 < 3.3);
  assert.ok(counts.fenced > 12 && counts.fenced < 45);
  // The previous dressing averaged 10.125 successfully placed cottages here.
  assert.ok(counts.city / 80 > 11, 'Cities gain buildings after wall clearance is reserved');
  assert.ok(counts.tall / counts.city > 0.75);
});

test('partial walls follow exterior city edges and preserve building, token and POI clearance', () => {
  for (const size of [1, 2, 3]) {
    const world = fixture('city', size, true);
    const byKey = new Map(world.cells.map((c) => [c.key, c]));
    for (let variant = 0; variant < 12; variant++) {
      const dressing = generatePropDressing(world, variant, new Map());
      assert.deepEqual(dressing, generatePropDressing(world, variant, new Map()));
      let count = 0;
      for (const data of dressing) {
        const cell = byKey.get(data.key);
        for (const wall of data.props.filter(isBarrier)) {
          count++;
          const [q, r] = DIRECTIONS[wall.side];
          assert.notEqual(byKey.get(`${cell.q + q},${cell.r + r}`)?.pointOfLight?.id, 'settlement');
          assert.ok(barrierEnds(wall).every(([x, z]) => fitsHex(x, z, wall.footprint)));
          assert.ok(
            barrierDistance(wall, TOKEN_ANCHOR.x, TOKEN_ANCHOR.z) >=
              TOKEN_ANCHOR.r + wall.footprint,
          );
          assert.ok(
            barrierDistance(wall, POI_ANCHOR.x, POI_ANCHOR.z) >=
              POI_ANCHOR.r + wall.footprint + 0.025,
          );
          for (const building of data.props.filter((p) =>
            ['house', 'hall', 'tower'].includes(p.kind),
          ))
            assert.ok(
              barrierDistance(wall, building.x, building.z) >=
                building.footprint + wall.footprint + 0.025 - 1e-9,
            );
        }
      }
      assert.ok(count === 2 || count === 3);
    }
  }
});

test('settlement geometry stays inside reserved shapes and city buildings gain height', () => {
  const roles = new Map();
  const material = (role) => {
    if (!roles.has(role)) roles.set(role, new THREE.MeshBasicMaterial());
    return roles.get(role);
  };
  const addMesh = (parent, geometry, mat, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const { makeHouse, makeBarrier } = createSettlementBuilder({
    addMesh,
    propMaterial: material,
    roofGeometry,
  });
  const measure = (build, prop) => {
    const root = new THREE.Group();
    build(root, prop);
    root.updateMatrixWorld(true);
    let height = 0;
    root.traverse((object) => {
      if (!object.isMesh) return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const p = new THREE.Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(object.matrixWorld);
        assert.ok([p.x, p.y, p.z].every(Number.isFinite));
        if (isBarrier(prop)) assert.ok(barrierDistance(prop, p.x, p.z) <= prop.footprint + 1e-6);
        else assert.ok(Math.hypot(p.x, p.z) <= 0.36 * prop.scale + 1e-6);
        height = Math.max(height, p.y);
      }
      object.geometry.dispose();
    });
    return height;
  };
  for (const variant of [0, 1, 2]) {
    const base = { x: 0, y: 0, z: 0, angle: 0.7, scale: 0.55, variant };
    const town = measure(makeHouse, base);
    measure(makeHouse, { ...base, roof: 'straw' });
    assert.ok(measure(makeHouse, { ...base, storeys: 3 }) > town + 0.25);
  }
  for (const [kind, footprint] of [
    ['fence', 0.022],
    ['city-wall', 0.045],
  ])
    for (let side = 0; side < 6; side++)
      measure(makeBarrier, {
        kind,
        footprint,
        x: 0.2,
        y: 0,
        z: -0.1,
        angle: (side * Math.PI) / 3,
        length: 0.78,
        temperature: 0,
      });
  assert.ok(roles.has('straw') && roles.has('strawDark'));
  for (const mat of roles.values()) mat.dispose();
});

test('swamp grass joins anchored wind while static grass and stone materials stay separate', () => {
  const world = generateWorld('2');
  const dressing = generateDressing(world, 0);
  for (const [i, cell] of dressing.cells.entries()) {
    for (const prop of cell.props.filter((p) => p.kind === 'grass'))
      assert.equal(Boolean(prop.wind), world.cells[i].terrain === 'wetlands');
  }
  const wetlandWind = { height: 0.34, strength: 0.5 };
  assert.equal(windWeight(0, wetlandWind), 0);
  assert.equal(windWeight(-1, wetlandWind), 0);
  assert.ok(windWeight(0.17, wetlandWind) < windWeight(0.34, wetlandWind));
  assert.equal(windWeight(0.34, wetlandWind), 0.5);
  const material = new THREE.MeshStandardMaterial();
  const time = { value: 3 };
  installTreeSway(material, time);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>' };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.ambientTime, time);
  assert.match(shader.vertexShader, /swayWeight/);
  material.dispose();
});
