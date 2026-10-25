import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TOP_RADIUS } from '../generation/math.js';
import { worldPosition } from '../generation/hex.js';
import { DAYLIGHT, timeOfDay } from '../application/time-of-day.js';

const COLORS = { warm: '#ffd269', mystic: '#9b79ff', dungeon: '#f65b49' };
const POINT_LIMIT = 4,
  BEAM_LIMIT = 2;
const BEAM_LENGTH = 2 * Math.sqrt(3);
const BEAM_SWEEP = Math.atan(0.3 / BEAM_LENGTH);
const GLOW_RADIUS = {
  village: 0.58,
  town: 0.78,
  city: 0.98,
  watchtower: 0.5,
  abbey: 0.6,
  stronghold: 0.68,
  warm: 0.5,
  mystic: 0.45,
  dungeon: 0.23,
};
const Y = new THREE.Vector3(0, 1, 0);
const point = (cell) => {
  const { wx, wz } = worldPosition(cell);
  return new THREE.Vector3(wx, 0, wz);
};

const isWater = (cell) =>
  cell.terrain === 'open water' || cell.water === 'ocean' || cell.water === 'lake';

// Extend seaward for two hex spacings, stopping at land, fog or the map edge.
export function lighthouseTarget(position, cells) {
  const locations = cells.map((cell) => ({ cell, position: point(cell) }));
  const water = locations.filter(({ cell }) => cell.fogState !== 'undiscovered' && isWater(cell));
  const nearest = water.sort(
    (a, b) => a.position.distanceToSquared(position) - b.position.distanceToSquared(position),
  )[0];
  if (!nearest) return null;
  const direction = nearest.position.clone().sub(position).setY(0);
  if (direction.length() > BEAM_LENGTH || direction.lengthSq() < 1e-8) return null;
  direction.normalize();
  const across = new THREE.Vector3(-direction.z, 0, direction.x);
  function cellAt(sample) {
    const closest = locations.reduce(
      (best, entry) =>
        !best || entry.position.distanceToSquared(sample) < best.position.distanceToSquared(sample)
          ? entry
          : best,
      null,
    );
    const x = sample.x - closest.position.x,
      z = sample.z - closest.position.z;
    // Nearest-centre lookup alone would extend a beam beyond the map boundary.
    return Math.max(
      ...Array.from(
        { length: 6 },
        (_, k) => x * Math.cos((k * Math.PI) / 3) + z * Math.sin((k * Math.PI) / 3),
      ),
    ) <=
      Math.sqrt(3) / 2 + 1e-6
      ? closest.cell
      : null;
  }
  let target = null,
    clearWater = false;
  const steps = 48;
  for (let k = 0; k <= steps; k++) {
    const distance = (BEAM_LENGTH * k) / steps;
    const sample = position.clone().setY(0).addScaledVector(direction, distance);
    const cell = cellAt(sample);
    if (!cell || cell.fogState === 'undiscovered' || (target && !isWater(cell))) break;
    // Include the cone width and maximum sweep, not just its centre line.
    const width = distance * 0.1 + (0.3 * distance) / BEAM_LENGTH;
    const edges = [-1, 1].map((side) =>
      cellAt(sample.clone().addScaledVector(across, width * side)),
    );
    if (
      edges.some(
        (edge) => !edge || edge.fogState === 'undiscovered' || (clearWater && !isWater(edge)),
      )
    )
      break;
    if (isWater(cell)) {
      target = sample.setY(cell.top + 0.025);
      clearWater ||= edges.every(isWater);
    }
  }
  return target;
}

// Use the tile's actual top triangles: the texture clips the radius while the
// geometry clips the light to dry ground, including slopes and river banks.
function groundGlow(tile, position, radius) {
  const centre = point(tile);
  const surface = tile.surface || tile.riverSurface || tile.roadSurface;
  const vertices = surface?.vertices ?? [
    [0, 0, 0],
    ...Array.from({ length: 6 }, (_, k) => [
      Math.sin((k * Math.PI) / 3) * TOP_RADIUS,
      0,
      Math.cos((k * Math.PI) / 3) * TOP_RADIUS,
    ]),
  ];
  const triangles = surface
    ? surface.triangles.filter(
        (_, i) => surface !== tile.roadSurface || surface.materialIndices[i] === 2,
      )
    : Array.from({ length: 6 }, (_, k) => [0, k + 1, ((k + 1) % 6) + 1]);
  const height = surface && surface === tile.roadSurface ? 0 : tile.top;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      vertices.flatMap(([x, y, z]) => [centre.x + x, height + y + 0.012, centre.z + z]),
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      vertices.flatMap(([x, , z]) => [
        0.5 + (centre.x + x - position.x) / (2 * radius),
        0.5 + (centre.z + z - position.z) / (2 * radius),
      ]),
      2,
    ),
  );
  geometry.setIndex(triangles.flat());
  geometry.computeVertexNormals();
  return geometry;
}

function glowTexture() {
  const size = 32,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] =
        x === 0 || y === 0 || x === size - 1 || y === size - 1
          ? 0
          : Math.round(Math.max(0, 1 - radius) ** 1.3 * 255);
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
    opacity: 0.16,
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
    const pools = new Map();
    function add(key, geometry) {
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(geometry);
    }
    for (const source of entries) {
      if (source.tile.fogState && source.tile.fogState !== 'visited') continue;
      const position = new THREE.Vector3().fromArray(source.position).applyMatrix4(source.matrix);
      const kind = source.kind === 'lighthouse' ? 'warm' : source.kind;
      const feature =
        source.kind === 'lighthouse'
          ? 'warm'
          : (source.feature ?? (kind === 'warm' ? source.tile.pointOfLight?.type : null) ?? kind);
      const record = { position, kind, radius: GLOW_RADIUS[feature] ?? GLOW_RADIUS[kind] };
      const key = `${source.tile.key}:${feature}:${kind}`;
      if (!pools.has(key))
        pools.set(key, { ...record, tile: source.tile, position: new THREE.Vector3(), count: 0 });
      const pool = pools.get(key);
      pool.position.add(position);
      pool.count++;
      const window = new THREE.PlaneGeometry(...source.size);
      window.translate(...source.position).applyMatrix4(source.matrix);
      add(`${kind}:window`, window);
      if (source.kind === 'lighthouse') {
        const target = lighthouseTarget(position, cells);
        if (target) {
          const mesh = new THREE.Mesh(cone, beamMaterial);
          beamGroup.add(mesh);
          lighthouses.push({ ...record, target, mesh, aim: new THREE.Vector3() });
        }
      }
    }
    // One broad pool per settlement/POI keeps every location lit across the
    // viewport, without stacking fourteen house halos into a white city centre.
    for (const pool of pools.values()) {
      pool.position.divideScalar(pool.count);
      sources.push(pool);
      add(`${pool.kind}:ground`, groundGlow(pool.tile, pool.position, pool.radius));
    }
    for (const [key, geometries] of batches) {
      const geometry = mergeGeometries(geometries);
      geometries.forEach((item) => item.dispose());
      const mesh = new THREE.Mesh(geometry, materials.get(key));
      mesh.name = key;
      group.add(mesh);
    }
  }
  function update(time, camera) {
    const strength = DAYLIGHT[mode].glow;
    group.visible = strength > 0;
    beamGroup.visible = strength > 0;
    const pulse = 0.98 + Math.sin(time * 0.85) * 0.02;
    for (const [key, material] of materials)
      material.opacity =
        strength * pulse * (key.endsWith('ground') ? (key.startsWith('dungeon') ? 0.3 : 0.65) : 1);
    camera.getWorldDirection(direction);
    focus
      .copy(camera.position)
      .addScaledVector(direction, -camera.position.y / Math.min(-0.01, direction.y));
    // Warm buildings use persistent windows/pools only. Assigning them a native
    // light here would make their facades brighten again when centred on screen.
    const nearest = strength
      ? sources
          .filter((source) => source.kind !== 'warm')
          .toSorted(
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
      const sweep = Math.sin((time * Math.PI) / 10) * BEAM_SWEEP;
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
      light.intensity = source ? strength * pulse * 4.4 : 0;
      if (source) {
        light.position.copy(source.position);
        light.target.position.copy(source.aim);
      }
    });
    beamMaterial.opacity = strength * pulse * 0.16;
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
