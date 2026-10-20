import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addMesh, clearGeometries } from './geometry.js';
import { windWeight } from './ambient-motion.js';
import { createTerrainBuilder } from './terrain-meshes.js';
import { createNatureBuilder } from './nature-props.js';
import { createCrossingBuilder } from './crossings.js';
import { createPoiBuilder } from './poi-props.js';
import { createSettlementBuilder, roofGeometry } from './settlement-props.js';

// Own map geometry and prop batches; the material registry outlives rebuilds.
export function createMapMeshes({ materials, propMaterial, treeDepth, waveDirection }) {
  const map = new THREE.Group();
  const cells = [];
  const makeTerrain = createTerrainBuilder({
    materials,
    makeCrossing: createCrossingBuilder(materials),
  });
  const { makeTree, makeRock, makeGrass, makePuddle, makeReeds, makeCrops, makeWave } =
    createNatureBuilder({ materials, propMaterial });
  const { makeHouse, makeTower, makeHall, makeBarrier } = createSettlementBuilder({
    addMesh,
    propMaterial,
    roofGeometry,
  });
  const makePoi = createPoiBuilder({ addMesh, propMaterial, makeHouse, makeTower, roofGeometry });
  function buildMap(layout) {
    clearGeometries(map);
    cells.length = 0;
    const propBatches = new Map();
    const wave = layout.flatMap((cell) => cell.props).find((prop) => prop.kind === 'wave');
    if (wave) waveDirection.value.set(Math.cos(wave.angle), Math.sin(wave.angle));
    for (const data of layout) {
      const { g, content } = makeTerrain(data);
      const propRoot = new THREE.Group();
      content.add(propRoot);
      for (const prop of data.props) {
        if (prop.kind === 'tree') makeTree(propRoot, prop);
        else if (prop.kind === 'house') makeHouse(propRoot, prop);
        else if (prop.kind === 'tower') makeTower(propRoot, prop);
        else if (prop.kind === 'hall') makeHall(propRoot, prop);
        else if (prop.kind === 'city-wall' || prop.kind === 'fence') makeBarrier(propRoot, prop);
        else if (prop.kind === 'rock') makeRock(propRoot, prop);
        else if (prop.kind === 'grass') makeGrass(propRoot, prop);
        else if (prop.kind === 'puddle') makePuddle(propRoot, prop);
        else if (prop.kind === 'reeds') makeReeds(propRoot, prop);
        else if (prop.kind === 'crops') makeCrops(propRoot, prop);
        else if (prop.kind === 'wave') makeWave(propRoot, prop);
        else if (prop.kind === 'poi') makePoi(propRoot, prop);
        else {
          const mesh = addMesh(
            propRoot,
            new THREE.BoxGeometry(0.18 * prop.scale, 0.003, 0.015),
            materials.waterEdge,
            prop.x,
            0.003,
            prop.z,
          );
          mesh.rotation.y = prop.angle;
          mesh.castShadow = false;
        }
      }
      // Keep the existing component meshes, then bake static props by material.
      // Face ranges retain hex selection after merging across the whole map.
      propRoot.updateWorldMatrix(true, true);
      propRoot.traverse((object) => {
        if (!object.isMesh) return;
        const geometry = object.geometry.index
          ? object.geometry.toNonIndexed()
          : object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld);
        for (const name of Object.keys(geometry.attributes))
          if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
        let plant = object;
        while (plant && !plant.userData.wind) plant = plant.parent;
        const base = plant ? new THREE.Vector3().setFromMatrixPosition(plant.matrixWorld).y : 0;
        const positions = geometry.attributes.position;
        const sway = new Float32Array(positions.count),
          phase = new Float32Array(positions.count);
        for (let i = 0; i < positions.count; i++) {
          sway[i] = plant ? windWeight(positions.getY(i) - base, plant.userData.wind) : 0;
          phase[i] = object.userData.wavePhase ?? 0;
        }
        geometry.setAttribute('swayWeight', new THREE.BufferAttribute(sway, 1));
        geometry.setAttribute('wavePhase', new THREE.BufferAttribute(phase, 1));
        const batchKey = `${object.material.uuid}:${object.castShadow}`;
        if (!propBatches.has(batchKey))
          propBatches.set(batchKey, {
            material: object.material,
            castShadow: object.castShadow,
            geometries: [],
            faceRanges: [],
            faces: 0,
          });
        const batch = propBatches.get(batchKey);
        batch.geometries.push(geometry);
        batch.faces += geometry.attributes.position.count / 3;
        batch.faceRanges.push({ end: batch.faces, key: data.key });
        object.geometry.dispose();
      });
      propRoot.removeFromParent();
      g.traverse((o) => {
        if (o.isMesh) o.userData.key = data.key;
      });
      map.add(g);
      cells.push({ ...data, g });
    }
    for (const batch of propBatches.values()) {
      const geometry = mergeGeometries(batch.geometries);
      batch.geometries.forEach((part) => part.dispose());
      const mesh = addMesh(map, geometry, batch.material);
      mesh.castShadow = batch.castShadow;
      mesh.userData.faceRanges = batch.faceRanges;
      if (batch.material.userData.treeSway) mesh.customDepthMaterial = treeDepth;
    }
  }
  return {
    group: map,
    cells,
    setMap: buildMap,
    dispose() {
      clearGeometries(map);
      cells.length = 0;
    },
  };
}
