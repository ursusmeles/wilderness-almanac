import * as THREE from 'three';
import { randomStream } from '../generation/math.js';
import { addMesh } from './geometry.js';
import { voxelFaces, packFoliageAtlas, crownGeometry } from './pixel-foliage-geometry.js';
import { DECIDUOUS_SPECIES, FOLIAGE_TONE_COUNT } from './pixel-foliage-colors.js';

const SIZE = 9;
const WIDTH = 0.48;
const forms = new Map();

export function deciduousSpecies(prop, forest, { terrain, deciduousCount } = {}) {
  if (prop.fruit) return 'orchard';
  const seed = (prop.detailSeed ?? 0) >>> 0;
  const type = forest?.family === 'evergreen' ? forest.neighbourType : forest?.type;
  const light =
    terrain === 'light forest' || deciduousCount === 1 || prop.zone === 'outlier' || !forest;
  if (light && seed % 5 < 2) return 'birch';
  if (DECIDUOUS_SPECIES.includes(type) && type !== 'orchard' && (!light || type !== 'birch'))
    return type;
  return ['oak', 'beech', 'ash'][(seed >>> 3) % 3];
}

function deciduousForm(species, style) {
  const key = `${species}:${style}`;
  if (forms.has(key)) return forms.get(key);
  const random = randomStream(6127 + style * 1931 + DECIDUOUS_SPECIES.indexOf(species) * 3989);
  const phase = random() * Math.PI * 2;
  const lean = [(random() - 0.5) * 0.05, (random() - 0.5) * 0.035];
  const lobe = (x, y, z, rx, ry, rz) => ({
    center: [x + lean[0], y + (random() - 0.5) * 0.025, z + lean[1]],
    radius: [rx * (0.94 + random() * 0.08), ry, rz],
    angle: phase,
  });
  let lobes;
  if (species === 'birch')
    lobes = [
      lobe(0, 0.62, 0, 0.13, 0.24, 0.115),
      lobe(-0.055, 0.53, 0.02, 0.115, 0.17, 0.1),
      lobe(0.065, 0.72, -0.015, 0.105, 0.16, 0.095),
      lobe(0.01, 0.82, 0, 0.09, 0.12, 0.08),
    ];
  else if (species === 'oak')
    lobes = [
      lobe(0, 0.57, 0, 0.17, 0.17, 0.16),
      lobe(-0.085, 0.49, 0.03, 0.145, 0.14, 0.14),
      lobe(0.085, 0.54, -0.025, 0.145, 0.15, 0.14),
      lobe(0, 0.58, -0.085, 0.14, 0.14, 0.13),
      lobe(0.035, 0.71, 0.025, 0.115, 0.12, 0.11),
    ];
  else if (species === 'beech')
    lobes = [
      lobe(0, 0.61, 0, 0.2, 0.27, 0.175),
      lobe(-0.06, 0.46, 0.02, 0.15, 0.19, 0.14),
      lobe(0.065, 0.5, -0.025, 0.15, 0.2, 0.145),
      lobe(0.01, 0.77, 0, 0.12, 0.13, 0.11),
    ];
  else if (species === 'ash')
    lobes = [
      lobe(0.015, 0.74, 0, 0.135, 0.18, 0.12),
      lobe(-0.09, 0.58, 0.025, 0.12, 0.17, 0.105),
      lobe(0.095, 0.65, -0.02, 0.12, 0.17, 0.1),
      lobe(-0.035, 0.56, -0.09, 0.11, 0.15, 0.1),
    ];
  else
    lobes = [
      lobe(0, 0.55, 0, 0.2, 0.22, 0.17),
      lobe(-0.08, 0.48, 0.035, 0.14, 0.17, 0.135),
      lobe(0.075, 0.58, -0.03, 0.14, 0.18, 0.14),
      lobe(0.02, 0.73, 0, 0.12, 0.1, 0.11),
    ];
  const birch = species === 'birch';
  const stem = [
    [0, 0, 0],
    [lean[0] * 0.3, birch ? 0.39 : 0.28, 0],
    [lean[0], birch ? 0.8 : 0.63, lean[1]],
  ];
  const limbs = stem.slice(1).map((end, i) => ({
    start: stem[i],
    end,
    radius: birch ? 0.019 - i * 0.005 : 0.034 - i * 0.009,
    tone: 0,
  }));
  for (const tuft of lobes.slice(0, 3))
    limbs.push({
      start: stem[1],
      end: [tuft.center[0], tuft.center[1] - 0.035, tuft.center[2]],
      radius: birch ? 0.008 : 0.016,
      tone: birch ? -1 : 0,
    });
  const form = { height: birch ? 0.96 : species === 'ash' ? 0.94 : 0.91, base: 0.25, lobes, limbs };
  forms.set(key, form);
  return form;
}

function crownFaces(species, style) {
  const { base, height, lobes } = deciduousForm(species, style);
  const dims = [SIZE, Math.ceil((height - base) / (WIDTH / SIZE)), SIZE];
  const step = [WIDTH / SIZE, (height - base) / dims[1], WIDTH / SIZE];
  const origin = [-WIDTH / 2, base, -WIDTH / 2];
  const data = new Uint8Array(dims[0] * dims[1] * dims[2]);
  for (let y = 0; y < dims[1]; y++)
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        const point = [
          origin[0] + (x + 0.5) * step[0],
          base + (y + 0.5) * step[1],
          origin[2] + (z + 0.5) * step[2],
        ];
        if (
          lobes.some((lobe) => {
            const dx = point[0] - lobe.center[0],
              dz = point[2] - lobe.center[2];
            const u = dx * Math.cos(lobe.angle) + dz * Math.sin(lobe.angle);
            const v = dz * Math.cos(lobe.angle) - dx * Math.sin(lobe.angle);
            return (
              (u / lobe.radius[0]) ** 2 +
                (v / lobe.radius[2]) ** 2 +
                ((point[1] - lobe.center[1]) / lobe.radius[1]) ** 2 <=
              1
            );
          })
        )
          data[(y * SIZE + z) * SIZE + x] = 1;
      }
  return voxelFaces({
    dims,
    step,
    origin,
    data,
    shade([x, y, z], axis, sign) {
      const cluster =
        (Math.floor((x + (style % 2)) / 2) * 3 +
          Math.floor(y / 2) * 5 +
          Math.floor(z / 2) * 7 +
          style) %
        9;
      let tone = [2, 3, 4, 3, 5, 2, 3, 4, 1][cluster];
      if (axis === 1) tone = sign < 0 ? 0 : cluster % 3 === 0 ? 6 : cluster === 4 ? 7 : 4;
      if (species === 'birch' && axis !== 1 && (x + z + style) % 4 === 0)
        tone = Math.max(1, tone - 1);
      return DECIDUOUS_SPECIES.indexOf(species) * FOLIAGE_TONE_COUNT + tone + 1;
    },
  });
}

let atlas;
export function deciduousAtlas() {
  if (!atlas) {
    const templates = new Map();
    for (const species of DECIDUOUS_SPECIES)
      for (let style = 0; style < 8; style++)
        templates.set(`${species}:${style}`, crownFaces(species, style));
    atlas = packFoliageAtlas(templates);
  }
  return atlas;
}

export function createPixelDeciduousBuilder({
  pixelDeciduousMaterial,
  pixelBarkMaterial,
  propMaterial,
}) {
  return (parent, prop, forest, context) => {
    const species = deciduousSpecies(prop, forest, context);
    const style = ((prop.detailSeed ?? 0) >>> 0) % 8;
    const form = deciduousForm(species, style);
    for (const limb of form.limbs) {
      const start = new THREE.Vector3(...limb.start),
        end = new THREE.Vector3(...limb.end);
      const axis = end.clone().sub(start),
        center = start.clone().add(end).multiplyScalar(0.5);
      const mesh = addMesh(
        parent,
        new THREE.CylinderGeometry(limb.radius * 0.7, limb.radius, axis.length(), 4, 1, true),
        pixelBarkMaterial(species, prop.temperature, limb.tone),
        center.x,
        center.y,
        center.z,
      );
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    }
    addMesh(
      parent,
      crownGeometry(deciduousAtlas().crowns.get(`${species}:${style}`)),
      pixelDeciduousMaterial(prop.temperature, prop.foliageTone),
    );
    if (prop.fruit) {
      const random = randomStream(prop.detailSeed);
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI * 2) / 10 + random() * 0.3;
        const y = 0.45 + random() * 0.18;
        const radius = 0.22 * Math.sqrt(1 - ((y - 0.52) / 0.29) ** 2);
        addMesh(
          parent,
          new THREE.BoxGeometry(0.04, 0.04, 0.04),
          propMaterial('fruit', 0, prop.detailSeed % 3),
          Math.cos(angle) * radius,
          y,
          Math.sin(angle) * radius * 0.9,
        );
      }
    }
  };
}
