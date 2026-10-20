import * as THREE from 'three';
import { palettes, DEFAULT_PALETTE } from '../palette.js';
import { createMapPalette, materialRoles } from '../map-palette.js';
import { installTreeSway, installWaveDrift } from './ambient-motion.js';

export function createMapMaterials() {
  let color = createMapPalette(palettes[DEFAULT_PALETTE]);
  const materials = {};
  Object.keys(materialRoles)
    .filter((key) => key !== 'hover' && key !== 'wave')
    .forEach(
      (key) =>
        (materials[key] = new THREE.MeshStandardMaterial({
          color: color.role(key),
          roughness: 1,
          metalness: 0,
          flatShading: true,
        })),
    );
  materials.riverGround.flatShading = false;
  materials.riverCliff.flatShading = false;
  materials.grass.side = THREE.DoubleSide;
  materials.reeds.side = THREE.DoubleSide;
  materials.rock.side = THREE.DoubleSide;
  materials.rockMid.side = THREE.DoubleSide;
  materials.rockLight.side = THREE.DoubleSide;
  materials.line = new THREE.MeshBasicMaterial({
    color: color.role('active'),
    side: THREE.DoubleSide,
  });
  materials.hover = new THREE.MeshBasicMaterial({
    color: color.role('hover'),
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  const tintedMaterials = new Map();
  const ambientTime = { value: 0 };
  const waveDirection = { value: new THREE.Vector2(1, 0) };
  for (const role of ['leaf', 'leafLight', 'leafDark', 'trunk', 'reeds', 'reedHead'])
    installTreeSway(materials[role], ambientTime);
  const treeDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  installTreeSway(treeDepth, ambientTime);
  materials.wave = new THREE.MeshBasicMaterial({
    color: color.role('wave'),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  installWaveDrift(materials.wave, ambientTime, waveDirection);
  function propMaterial(role, temperature = 0, colorTone = 0) {
    if (!temperature && !colorTone) return materials[role];
    const key = `${role}:${temperature}:${colorTone}`;
    if (!tintedMaterials.has(key)) {
      const material = materials[role].clone();
      if (materials[role].userData.treeSway) installTreeSway(material, ambientTime);
      material.color.set(color.role(role, temperature, colorTone));
      tintedMaterials.set(key, { material, role, temperature, colorTone });
    }
    return tintedMaterials.get(key).material;
  }
  return {
    materials,
    propMaterial,
    treeDepth,
    ambientTime,
    waveDirection,
    background: () => color.background(),
    setPalette(seeds) {
      color = createMapPalette(seeds);
      Object.keys(materialRoles).forEach((key) => materials[key].color.set(color.role(key)));
      for (const { material, role, temperature, colorTone } of tintedMaterials.values())
        material.color.set(color.role(role, temperature, colorTone));
      materials.line.color.set(color.role('active'));
      materials.hover.color.set(color.role('hover'));
      materials.wave.color.set(color.role('wave'));
    },
    dispose() {
      Object.values(materials).forEach((material) => material.dispose());
      for (const { material } of tintedMaterials.values()) material.dispose();
      treeDepth.dispose();
    },
  };
}
