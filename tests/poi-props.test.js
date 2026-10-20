import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPoiBuilder } from '../src/rendering/poi-props.js';
import { poiAnchor } from '../src/generation/points-of-interest.js';
import { createSettlementBuilder, roofGeometry } from '../src/rendering/settlement-props.js';

function buildPoi(poiKind, variant, detailSeed = 7, overrides = {}) {
  const material = new THREE.MeshBasicMaterial();
  const addMesh = (parent, geometry, mat, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const buildings = createSettlementBuilder({
    addMesh,
    propMaterial: () => material,
    roofGeometry,
  });
  const makePoi = createPoiBuilder({
    addMesh,
    propMaterial: () => material,
    roofGeometry,
    ...buildings,
  });
  const root = new THREE.Group();
  makePoi(root, {
    poiKind,
    variant,
    detailSeed,
    x: 0,
    y: 0,
    z: 0,
    footprint: poiAnchor({ kind: poiKind }).r,
    pedestalDepth: 0.035,
    temperature: -1,
    ...overrides,
  });
  root.updateMatrixWorld(true);
  const parts = (name) => {
    const found = [];
    root.traverse((object) => {
      if (object.userData.poiPart === name) found.push(object);
    });
    return found;
  };
  return {
    root,
    parts,
    dispose() {
      root.traverse((object) => object.geometry?.dispose());
      material.dispose();
    },
  };
}

test('every POI model variant produces finite geometry within its reserved corner footprint', () => {
  const material = new THREE.MeshBasicMaterial();
  const addMesh = (parent, geometry, mat, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const { makeHouse, makeTower } = createSettlementBuilder({
    addMesh,
    propMaterial: () => material,
    roofGeometry,
  });
  const makePoi = createPoiBuilder({
    addMesh,
    propMaterial: () => material,
    makeHouse,
    makeTower,
    roofGeometry,
  });
  const variants = {
    ruins: [0, 1, 2],
    encampment: [0, 1, 2],
    watchtower: ['watchtower', 'lighthouse'],
    stronghold: [0, 1, 2],
    lair: ['cave', 'nest'],
    mystic: ['portal', 'altar', 'standing stone'],
    abbey: [0],
    battlefield: [0, 1, 2],
    dungeon: ['mine', 'dungeon'],
  };
  for (const [poiKind, options] of Object.entries(variants))
    for (const variant of options)
      for (const detailSeed of [7, 17, 48]) {
        const root = new THREE.Group();
        const anchor = poiAnchor({ kind: poiKind });
        makePoi(root, {
          poiKind,
          variant,
          detailSeed,
          x: 0,
          y: 0,
          z: 0,
          footprint: anchor.r,
          pedestalDepth: 0.035,
          temperature: -1,
        });
        root.updateMatrixWorld(true);
        let vertices = 0;
        root.traverse((object) => {
          if (!object.isMesh) return;
          const points = object.geometry.attributes.position;
          for (let i = 0; i < points.count; i++) {
            const p = new THREE.Vector3()
              .fromBufferAttribute(points, i)
              .applyMatrix4(object.matrixWorld);
            assert.ok([p.x, p.y, p.z].every(Number.isFinite));
            assert.ok(
              Math.hypot(p.x, p.z) <= anchor.r + 1e-6,
              `${poiKind}/${variant} remains in its reserved circle`,
            );
            vertices++;
          }
          object.geometry.dispose();
        });
        assert.ok(vertices > 20);
      }
  material.dispose();
});

test('battlefields always have a banner and one to five larger skulls', () => {
  const counts = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const model = buildPoi('battlefield', seed % 3, seed);
    assert.equal(model.parts('banner').length, 1);
    const skulls = model.parts('skull');
    assert.ok(skulls.length >= 1 && skulls.length <= 5);
    counts.add(skulls.length);
    for (const skull of skulls) {
      const bounds = new THREE.Box3().setFromObject(skull);
      assert.ok(bounds.max.y - bounds.min.y > 0.1, 'Skulls remain legible at map scale');
    }
    model.dispose();
  }
  assert.equal(counts.size, 5);
});

test('cave, mine and dungeon entrances have recessed openings occluded by their surroundings', () => {
  for (const [kind, variant] of [
    ['lair', 'cave'],
    ['dungeon', 'mine'],
    ['dungeon', 'dungeon'],
  ]) {
    const model = buildPoi(kind, variant);
    assert.equal(model.parts('tunnel-back').length, 1);
    const body = model.root.children[0].children[0];
    const ray = (x) => {
      const origin = new THREE.Vector3(x, 0.12, 0.7).applyMatrix4(body.matrixWorld);
      const direction = new THREE.Vector3(0, 0, -1).transformDirection(body.matrixWorld);
      return new THREE.Raycaster(origin, direction).intersectObject(model.root, true)[0];
    };
    assert.equal(
      ray(-0.02)?.object.userData.poiPart,
      'tunnel-back',
      `${variant}: clear view into a recessed tunnel`,
    );
    assert.notEqual(
      ray(0.13)?.object.userData.poiPart,
      'tunnel-back',
      `${variant}: backing cannot leak outside the opening`,
    );
    assert.ok(ray(0.13), 'Solid sides enclose the opening');
    model.dispose();
  }
});

test('ruins retain open gates and encampments always include recognisable tents', () => {
  for (const variant of [0, 1, 2]) {
    const ruin = buildPoi('ruins', variant);
    assert.ok(ruin.parts('entrance-frame').length > 0);
    assert.equal(ruin.parts('tunnel-back').length, 0, 'Ruined gates stay open');
    ruin.dispose();
  }
  for (let seed = 0; seed < 15; seed++) {
    const camp = buildPoi('encampment', seed % 3, seed);
    assert.ok(camp.parts('tent').length >= 1 && camp.parts('tent').length <= 3);
    camp.dispose();
  }
});

test('mountain footings preserve sampled ground heights despite the model rotation', () => {
  const heights = Array.from({ length: 12 }, (_, i) => -0.02 - i * 0.012);
  const model = buildPoi('dungeon', 'mine', 7, { foundationHeights: heights });
  const footing = model.parts('terrain-footing')[0];
  assert.ok(footing);
  const positions = footing.geometry.attributes.position;
  const radius = poiAnchor({ kind: 'dungeon' }).r;
  for (let k = 0; k < 12; k++) {
    const point = new THREE.Vector3()
      .fromBufferAttribute(positions, k * 9 + 5)
      .applyMatrix4(footing.matrixWorld);
    assert.ok(Math.abs(point.y - heights[k]) < 1e-6);
    assert.ok(Math.abs(point.x - Math.cos((k * Math.PI) / 6) * radius) < 1e-6);
    assert.ok(Math.abs(point.z - Math.sin((k * Math.PI) / 6) * radius) < 1e-6);
  }
  model.dispose();
});
