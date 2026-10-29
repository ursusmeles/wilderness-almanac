import * as THREE from 'three';
import { palettes, DEFAULT_PALETTE, paletteTheme } from '../palette.js';
import { createMapPalette, materialRoles } from '../map-palette.js';
import { installTreeSway, installWaveDrift } from './ambient-motion.js';
import { applyNightColor } from './daylight.js';
import { timeOfDay, windForTimeOfDay } from '../application/time-of-day.js';
import { createPixelFoliageMaterials } from './pixel-foliage-materials.js';
import { createPixelDressingMaterials } from './pixel-dressing-materials.js';
import { createPixelModelMaterials } from './pixel-model-materials.js';
import { createPixelTerrainMaterials } from './pixel-terrain-materials.js';

export function createMapMaterials() {
  let color = createMapPalette(palettes[DEFAULT_PALETTE]);
  let theme = paletteTheme(palettes[DEFAULT_PALETTE]);
  let mode = 'day';
  const fogMaterials = new Map();
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
  materials.grain.side = THREE.DoubleSide;
  materials.grainStem.side = THREE.DoubleSide;
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
  const wind = { strength: { value: 1.2 }, gustPeriod: { value: 18 } };
  const pixelOptions = {
    getColor: (...args) => new THREE.Color(color.role(...args)),
    shadeColor: (color) => applyNightColor(color, mode),
    getHiddenColor: (role) => {
      const hidden = applyNightColor(
        new THREE.Color(role === 'bevel' ? theme.line : theme.bg),
        mode,
      );
      return role === 'side' ? hidden.multiplyScalar(0.55) : hidden;
    },
    time: ambientTime,
    wind,
  };
  const pixelFoliage = createPixelFoliageMaterials(pixelOptions);
  const pixelDressing = createPixelDressingMaterials(pixelOptions);
  const pixelModels = createPixelModelMaterials(pixelOptions);
  const pixelTerrain = createPixelTerrainMaterials(pixelOptions);
  const waveDirection = { value: new THREE.Vector2(1, 0) };
  for (const role of [
    'leaf',
    'leafLight',
    'leafDark',
    'trunk',
    'reeds',
    'reedHead',
    'fruit',
    'grain',
    'grainStem',
  ])
    installTreeSway(materials[role], ambientTime, wind);
  const treeDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  installTreeSway(treeDepth, ambientTime, wind);
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
      if (materials[role].userData.treeSway) installTreeSway(material, ambientTime, wind);
      material.color.set(color.role(role, temperature, colorTone));
      applyNightColor(material.color, mode);
      tintedMaterials.set(key, { material, role, temperature, colorTone });
    }
    return tintedMaterials.get(key).material;
  }
  function updateFogMaterial(base, material, state) {
    material.color.copy(base.color);
    if (state === 'unvisited') {
      const gray = base.color.r * 0.2126 + base.color.g * 0.7152 + base.color.b * 0.0722;
      material.color.setRGB(gray, gray, gray);
    } else {
      material.color.set(base === materials.bevel ? theme.line : theme.bg);
      if (base === materials.side) material.color.multiplyScalar(0.55);
      applyNightColor(material.color, mode);
    }
  }
  function fogMaterial(base, state) {
    if (!state || state === 'visited') return base;
    if (Array.isArray(base)) return base.map((material) => fogMaterial(material, state));
    if (base.userData.pixelFoliage) {
      const { temperature, tone, family } = base.userData.pixelFoliage;
      return pixelFoliage.material(temperature, tone, state, family);
    }
    if (base.userData.pixelBark) {
      const { species, temperature, tone } = base.userData.pixelBark;
      return pixelFoliage.barkMaterial(species, temperature, tone, state);
    }
    if (base.userData.pixelDressing) {
      const { kind, temperature } = base.userData.pixelDressing;
      return pixelDressing.material(kind, temperature, state);
    }
    if (base.userData.pixelTerrain) {
      const { kind, temperature, light } = base.userData.pixelTerrain;
      return pixelTerrain.material(kind, temperature, light, state);
    }
    if (base.userData.pixelModel) {
      const { role, temperature, tone } = base.userData.pixelModel;
      const material = pixelModels.material(role, temperature, tone, state);
      if (material.side !== base.side) {
        material.side = base.side;
        material.needsUpdate = true;
      }
      return material;
    }
    if (!fogMaterials.has(base)) fogMaterials.set(base, new Map());
    const variants = fogMaterials.get(base);
    if (!variants.has(state)) {
      const material = base.clone();
      if (base.userData.treeSway) installTreeSway(material, ambientTime, wind);
      if (base === materials.wave) installWaveDrift(material, ambientTime, waveDirection);
      updateFogMaterial(base, material, state);
      variants.set(state, material);
    }
    return variants.get(state);
  }
  return {
    materials,
    fogMaterial,
    propMaterial,
    pixelMaterial: pixelFoliage.material,
    pixelDeciduousMaterial: (temperature, tone) =>
      pixelFoliage.material(temperature, tone, 'visited', 'deciduous'),
    pixelBarkMaterial: pixelFoliage.barkMaterial,
    pixelPropMaterial: pixelDressing.material,
    pixelModelMaterial: pixelModels.material,
    pixelTerrainMaterial: pixelTerrain.material,
    treeDepth,
    ambientTime,
    waveDirection,
    background: () => applyNightColor(new THREE.Color(color.background()), mode),
    setTimeOfDay(value) {
      mode = timeOfDay(value);
      const profile = windForTimeOfDay(mode);
      wind.strength.value = profile.strength;
      wind.gustPeriod.value = profile.gustPeriod;
      repaint();
    },
    setPalette(seeds) {
      color = createMapPalette(seeds);
      theme = paletteTheme(seeds);
      repaint();
    },
    releasePixelMaterials() {
      pixelFoliage.dispose();
      pixelDressing.dispose();
      pixelModels.dispose();
      pixelTerrain.dispose();
    },
    dispose() {
      Object.values(materials).forEach((material) => material.dispose());
      for (const { material } of tintedMaterials.values()) material.dispose();
      for (const variants of fogMaterials.values())
        for (const material of variants.values()) material.dispose();
      treeDepth.dispose();
      pixelFoliage.dispose();
      pixelDressing.dispose();
      pixelModels.dispose();
      pixelTerrain.dispose();
    },
  };
  function repaint() {
    Object.keys(materialRoles).forEach((key) => {
      materials[key].color.set(color.role(key));
      if (!['hover', 'wave'].includes(key)) applyNightColor(materials[key].color, mode);
    });
    for (const { material, role, temperature, colorTone } of tintedMaterials.values()) {
      material.color.set(color.role(role, temperature, colorTone));
      applyNightColor(material.color, mode);
    }
    materials.line.color.set(color.role('active'));
    materials.hover.color.set(color.role('hover'));
    materials.wave.color.set(color.role('wave'));
    applyNightColor(materials.wave.color, mode);
    for (const [base, variants] of fogMaterials)
      for (const [state, material] of variants) updateFogMaterial(base, material, state);
    pixelFoliage.repaint();
    pixelDressing.repaint();
    pixelModels.repaint();
    pixelTerrain.repaint();
  }
}
