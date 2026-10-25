import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceHeight } from '../generation/math.js';
import { worldPosition } from '../generation/hex.js';
import { DAYLIGHT, timeOfDay } from '../application/time-of-day.js';

const COLORS = { warm: '#ffd269', mystic: '#9b79ff', dungeon: '#f65b49' };
const POINT_LIMIT = 4,
  BEAM_LIMIT = 2;
const Y = new THREE.Vector3(0, 1, 0);
const point = (cell) => {
  const { wx, wz } = worldPosition(cell);
  return new THREE.Vector3(wx, 0, wz);
};

// The beam aims at a visible water hex, never inferred hidden coastline.
export function lighthouseTarget(position, cells) {
  const water = cells.filter(
    (cell) =>
      cell.fogState !== 'undiscovered' &&
      (cell.terrain === 'open water' || cell.water === 'ocean' || cell.water === 'lake'),
  );
  const nearest = water.sort(
    (a, b) => point(a).distanceToSquared(position) - point(b).distanceToSquared(position),
  )[0];
  if (!nearest) return null;
  const target = point(nearest).setY(nearest.top + 0.025);
  if (target.distanceTo(position) > 7) return null;
  if (cells.some((cell) => cell.fogState === 'undiscovered')) {
    for (let k = 1; k < 12; k++) {
      const sample = position.clone().lerp(target, k / 12);
      const closest = cells.reduce(
        (best, cell) =>
          !best || point(cell).distanceToSquared(sample) < point(best).distanceToSquared(sample)
            ? cell
            : best,
        null,
      );
      if (closest?.fogState === 'undiscovered') return null;
    }
  }
  return target;
}

function glowTexture() {
  const size = 32,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, 1 - radius) ** 2 * 255);
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Window glows/ground pools are batched. Only a fixed pool of real lights is
// evaluated by the surface shaders; none of these lights casts shadows.
export function createFeatureLighting(scene) {
  const group = new THREE.Group();
  const beamGroup = new THREE.Group();
  scene.add(group, beamGroup);
  const texture = glowTexture();
  const materials = new Map();
  for (const [kind, color] of Object.entries(COLORS))
    for (const layer of ['window', 'ground']) {
      const material = new THREE.MeshBasicMaterial({
        color,
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      materials.set(`${kind}:${layer}`, material);
    }
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.warm,
    transparent: true,
    opacity: 0.035,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const cone = new THREE.CylinderGeometry(0, 0.1, 1, 12, 1, true);
  cone.translate(0, -0.5, 0);
  const points = Array.from(
    { length: POINT_LIMIT },
    () => new THREE.PointLight(0xffffff, 0, 1.6, 2),
  );
  const beams = Array.from({ length: BEAM_LIMIT }, () => {
    const light = new THREE.SpotLight(COLORS.warm, 0, 8, 0.1, 0.8, 2);
    scene.add(light, light.target);
    return light;
  });
  scene.add(...points);
  let sources = [],
    lighthouses = [],
    mode = 'day';
  const aim = new THREE.Vector3(),
    direction = new THREE.Vector3(),
    focus = new THREE.Vector3();
  function clear() {
    for (const mesh of group.children) mesh.geometry.dispose();
    group.clear();
    beamGroup.clear();
    sources = [];
    lighthouses = [];
  }
  function setSources(entries, cells) {
    clear();
    const batches = new Map();
    function add(key, geometry) {
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(geometry);
    }
    for (const source of entries) {
      if (source.tile.fogState && source.tile.fogState !== 'visited') continue;
      const position = new THREE.Vector3().fromArray(source.position).applyMatrix4(source.matrix);
      const kind = source.kind === 'lighthouse' ? 'warm' : source.kind;
      const record = { position, kind };
      sources.push(record);
      const window = new THREE.PlaneGeometry(...source.size);
      window.translate(...source.position).applyMatrix4(source.matrix);
      add(`${kind}:window`, window);
      const centre = point(source.tile);
      const x = position.x - centre.x,
        z = position.z - centre.z;
      const clearance = Math.min(
        ...Array.from(
          { length: 6 },
          (_, side) =>
            Math.sqrt(3) / 2 -
            x * Math.cos((side * Math.PI) / 3) -
            z * Math.sin((side * Math.PI) / 3),
        ),
      );
      const radius = Math.min(
        kind === 'mystic' ? 0.45 : kind === 'dungeon' ? 0.23 : 0.32,
        clearance - 0.025,
      );
      if (radius > 0.025) {
        const halo = new THREE.CircleGeometry(radius, 20);
        halo.rotateX(-Math.PI / 2);
        const vertices = halo.attributes.position;
        const surface = source.tile.surface || source.tile.riverSurface;
        for (let i = 0; i < vertices.count; i++) {
          const px = x + vertices.getX(i),
            pz = z + vertices.getZ(i);
          vertices.setXYZ(
            i,
            centre.x + px,
            source.tile.top + (surface ? surfaceHeight(surface, px, pz) : 0) + 0.012,
            centre.z + pz,
          );
        }
        add(`${kind}:ground`, halo);
      }
      if (source.kind === 'lighthouse') {
        const target = lighthouseTarget(position, cells);
        if (target) {
          const mesh = new THREE.Mesh(cone, beamMaterial);
          beamGroup.add(mesh);
          lighthouses.push({ ...record, target, mesh, aim: new THREE.Vector3() });
        }
      }
    }
    for (const [key, geometries] of batches) {
      const geometry = mergeGeometries(geometries);
      geometries.forEach((item) => item.dispose());
      const mesh = new THREE.Mesh(geometry, materials.get(key));
      group.add(mesh);
    }
  }
  function update(time, camera) {
    const strength = DAYLIGHT[mode].glow;
    group.visible = strength > 0;
    beamGroup.visible = strength > 0;
    const pulse = 0.94 + Math.sin(time * 0.85) * 0.06;
    for (const [key, material] of materials)
      material.opacity = strength * pulse * (key.endsWith('ground') ? 0.22 : 1);
    camera.getWorldDirection(direction);
    focus
      .copy(camera.position)
      .addScaledVector(direction, -camera.position.y / Math.min(-0.01, direction.y));
    const nearest = strength
      ? sources.toSorted(
          (a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus),
        )
      : [];
    points.forEach((light, i) => {
      const source = nearest[i];
      light.visible = Boolean(source);
      light.intensity = source ? strength * pulse * (source.kind === 'dungeon' ? 0.055 : 0.18) : 0;
      if (source) {
        light.color.set(COLORS[source.kind]);
        light.position.copy(source.position);
      }
    });
    for (const source of lighthouses) {
      const mesh = source.mesh;
      const distance = source.position.distanceTo(source.target);
      const sweep = Math.sin((time * Math.PI) / 10) * Math.min(0.16, 0.3 / distance);
      direction.copy(source.target).sub(source.position);
      direction.applyAxisAngle(Y, sweep);
      aim.copy(source.position).add(direction);
      source.aim.copy(aim);
      mesh.position.copy(source.position);
      mesh.scale.set(distance, distance, distance);
      mesh.quaternion.setFromUnitVectors(Y, direction.normalize().negate());
    }
    const nearby = strength
      ? lighthouses.toSorted(
          (a, b) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus),
        )
      : [];
    beams.forEach((light, i) => {
      const source = nearby[i];
      light.visible = Boolean(source);
      light.intensity = source ? strength * 2.2 : 0;
      if (source) {
        light.position.copy(source.position);
        light.target.position.copy(source.aim);
      }
    });
    beamMaterial.opacity = strength * pulse * 0.035;
  }
  return {
    group,
    beamGroup,
    points,
    beams,
    setSources,
    setMode(value) {
      mode = timeOfDay(value);
    },
    update,
    dispose() {
      clear();
      group.removeFromParent();
      beamGroup.removeFromParent();
      for (const light of points) light.removeFromParent();
      for (const light of beams) {
        light.removeFromParent();
        light.target.removeFromParent();
        light.shadow.dispose();
      }
      cone.dispose();
      beamMaterial.dispose();
      texture.dispose();
      for (const material of materials.values()) material.dispose();
    },
  };
}
