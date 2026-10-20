import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { installTreeSway, installWaveDrift, windWeight } from './ambient-motion.js';
import { createPoiBuilder } from './poi-props.js';
import { createSettlementBuilder, roofGeometry } from './settlement-props.js';
import { palettes } from '../palette.js';
import { createMapPalette, materialRoles } from '../map-palette.js';
import { randomStream, surfaceHeight, TOP_RADIUS } from '../generation/math.js';
import {
  riverBankValue,
  riverIslandValue,
  riverLandValue,
  riverBankHeight,
  riverTopHeight,
} from '../generation/river-surfaces.js';

export function createMapRenderer(
  host,
  { onSelect = () => {}, onHover = () => {}, motion = true } = {},
) {
  const loading = host.querySelector('#hp-loading');
  const listeners = new AbortController();
  const listen = (target, event, handler, options = {}) =>
    target.addEventListener(event, handler, { ...options, signal: listeners.signal });
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
  } catch (error) {
    if (loading) loading.textContent = 'This preview needs WebGL support.';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute(
    'aria-label',
    'Interactive isometric hex map with forests, wetlands, farms, settlements, mountains and rivers. Drag to pan, scroll or pinch to zoom. Select a hex using the list below.',
  );
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 180);
  camera.position.set(24, 30, 37);
  camera.lookAt(0, 0.3, 0);
  const ambient = new THREE.HemisphereLight(0xffffff, 0x777777, 1.8);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-15, 30, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -24,
    right: 24,
    top: 24,
    bottom: -24,
    near: 1,
    far: 90,
  });
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.0002;
  sun.shadow.radius = 3;
  scene.add(sun);
  const shadowFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.ShadowMaterial({ opacity: 0.17 }),
  );
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = -0.12;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);
  let color = createMapPalette(palettes.dusk);
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
  const map = new THREE.Group();
  scene.add(map);
  const cells = [];

  function addMesh(parent, geometry, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function geometryFrom(points) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    g.computeVertexNormals();
    return g;
  }
  function bevelTile(height, isWater, corners = null, shared = null) {
    const rings = isWater
      ? [
          [0.97, 0],
          [1, 0.025],
          [1, height - 0.025],
          [0.976, height],
        ]
      : [
          [0.955, 0],
          [1, 0.045],
          [1, height - 0.075],
          [TOP_RADIUS, height],
        ];
    const points = [],
      groups = [];
    const p = (radius, y, k, top = false) =>
      top && corners
        ? [corners[k % 6][0], y, corners[k % 6][1]]
        : [Math.sin((k * Math.PI) / 3) * radius, y, Math.cos((k * Math.PI) / 3) * radius];
    for (let j = 0; j < rings.length - 1; j++) {
      const start = points.length / 3;
      for (let k = 0; k < 6; k++) {
        if (shared && shared[(7 - k) % 6]) continue;
        const a = p(...rings[j], k),
          b = p(...rings[j], k + 1),
          c = p(...rings[j + 1], k, j === 2),
          d = p(...rings[j + 1], k + 1, j === 2);
        points.push(...a, ...b, ...c, ...b, ...d, ...c);
      }
      groups.push({ start, count: points.length / 3 - start, materialIndex: j === 2 ? 1 : 0 });
    }
    if (!corners) {
      const start = points.length / 3;
      for (let k = 0; k < 6; k++)
        points.push(0, height, 0, ...p(...rings[3], k), ...p(...rings[3], k + 1));
      groups.push({ start, count: 18, materialIndex: 2 });
    }
    const geo = geometryFrom(points);
    groups.forEach((g) => geo.addGroup(g.start, g.count, g.materialIndex));
    return geo;
  }
  function makeTree(parent, prop) {
    const g = new THREE.Group();
    g.userData.tree = true;
    g.userData.wind = { height: 0.8, strength: 1 };
    g.position.set(prop.x, prop.y || 0, prop.z);
    g.rotation.y = prop.angle;
    g.scale.setScalar(prop.scale);
    addMesh(
      g,
      new THREE.CylinderGeometry(0.025, 0.04, 0.29, 5),
      propMaterial('trunk', prop.temperature),
      0,
      0.145,
      0,
    );
    if (prop.variant === 1) {
      const crown = addMesh(
        g,
        new THREE.DodecahedronGeometry(0.23, 0),
        propMaterial('leaf', prop.temperature, prop.foliageTone),
        0,
        0.52,
        0,
      );
      crown.scale.set(1, 1.25, 0.9);
      addMesh(
        g,
        new THREE.DodecahedronGeometry(0.16, 0),
        propMaterial('leafLight', prop.temperature, prop.foliageTone),
        0,
        0.73,
        0,
      );
    } else {
      addMesh(
        g,
        new THREE.ConeGeometry(0.24, 0.53, prop.variant === 2 ? 6 : 5),
        propMaterial('leafDark', prop.temperature),
        0,
        0.47,
        0,
      );
      addMesh(
        g,
        new THREE.ConeGeometry(
          prop.variant === 2 ? 0.16 : 0.19,
          prop.variant === 2 ? 0.63 : 0.49,
          5,
        ),
        propMaterial('leaf', prop.temperature),
        0,
        prop.variant === 2 ? 0.75 : 0.7,
        0,
      );
    }
    parent.add(g);
  }
  function makeRidge(parent, surface) {
    const points = [],
      groups = [],
      buckets = [[], [], [], []];
    for (const face of surface.triangles) {
      const [a, b, c] = face.map((i) => surface.vertices[i]),
        ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ],
        up = normal[1] / Math.hypot(...normal),
        height = (a[1] + b[1] + c[1]) / 3;
      const materialIndex = height < 0.14 ? 3 : up < 0.67 ? 2 : height > 0.48 ? 1 : 0;
      buckets[materialIndex].push(...a, ...b, ...c);
    }
    buckets.forEach((bucket, materialIndex) => {
      if (bucket.length) {
        groups.push({ start: points.length / 3, count: bucket.length / 3, materialIndex });
        points.push(...bucket);
      }
    });
    const geo = geometryFrom(points);
    groups.forEach((g) => geo.addGroup(g.start, g.count, g.materialIndex));
    addMesh(parent, geo, [
      materials.ridge,
      materials.ridgeLight,
      materials.ridgeDark,
      materials.ridgeMeadow,
    ]);
  }
  const { makeHouse, makeTower, makeHall, makeBarrier } = createSettlementBuilder({
    addMesh,
    propMaterial,
    roofGeometry,
  });
  function makeRock(parent, prop) {
    const rand = randomStream(prop.detailSeed),
      geo =
        prop.variant === 1
          ? new THREE.IcosahedronGeometry(1, 0)
          : new THREE.DodecahedronGeometry(1, 0);
    const mesh = addMesh(
      parent,
      geo,
      propMaterial(prop.variant === 2 ? 'rockMid' : 'rock', prop.temperature),
      prop.x,
      (prop.y || 0) + prop.footprint * 0.33,
      prop.z,
    );
    mesh.scale.set(
      prop.footprint * (0.8 + rand() * 0.2),
      prop.footprint * (0.48 + rand() * 0.22),
      prop.footprint * (0.65 + rand() * 0.25),
    );
    mesh.rotation.y = prop.angle;
  }
  function makeGrass(parent, prop) {
    const rand = randomStream(prop.detailSeed),
      vertices = [];
    const blades = 3 + prop.variant;
    for (let n = 0; n < blades; n++) {
      const a = (n * Math.PI * 2) / blades + prop.angle,
        bx = Math.cos(a) * 0.025,
        bz = Math.sin(a) * 0.025,
        h = (0.11 + rand() * 0.08) * prop.scale,
        lean = 0.02 + rand() * 0.015;
      vertices.push(
        bx - 0.014,
        0,
        bz,
        bx + 0.014,
        0,
        bz,
        bx + Math.cos(a) * lean,
        h,
        bz + Math.sin(a) * lean,
      );
    }
    const geo = geometryFrom(vertices);
    const mesh = addMesh(
      parent,
      geo,
      propMaterial(prop.wind ? 'reeds' : 'grass', prop.temperature),
      prop.x,
      prop.y || 0,
      prop.z,
    );
    mesh.castShadow = false;
    if (prop.wind && !parent.userData.wind)
      mesh.userData.wind = { height: 0.22 * prop.scale, strength: 0.38 };
  }
  function makePuddle(parent, prop) {
    const points = [],
      random = randomStream(prop.detailSeed),
      n = 10;
    const rim = Array.from({ length: n }, (_, k) => {
      const angle = (k * Math.PI * 2) / n,
        radius = prop.footprint * (0.83 + random() * 0.17);
      return [Math.sin(angle) * radius, 0.006, Math.cos(angle) * radius * 0.7];
    });
    for (let k = 0; k < n; k++) points.push(0, 0.006, 0, ...rim[k], ...rim[(k + 1) % n]);
    const mesh = addMesh(
      parent,
      geometryFrom(points),
      propMaterial('water', prop.temperature),
      prop.x,
      prop.y,
      prop.z,
    );
    mesh.rotation.y = prop.angle;
    mesh.castShadow = false;
  }
  function makeReeds(parent, prop) {
    const g = new THREE.Group();
    g.position.set(prop.x, prop.y, prop.z);
    g.rotation.y = prop.angle;
    g.scale.setScalar(prop.scale);
    g.userData.wind = { height: 0.34 * prop.scale, strength: 0.5 };
    makeGrass(g, { ...prop, x: 0, y: 0, z: 0, angle: 0, scale: 1.7, variant: 2, wind: true });
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.025,
        z = (i % 2) * 0.025,
        height = 0.22 + i * 0.025;
      addMesh(
        g,
        new THREE.CylinderGeometry(0.004, 0.006, height, 3),
        propMaterial('reeds', prop.temperature),
        x,
        height / 2,
        z,
      );
      addMesh(
        g,
        new THREE.BoxGeometry(0.018, 0.045, 0.018),
        propMaterial('reedHead', prop.temperature),
        x,
        height,
        z,
      );
    }
    parent.add(g);
  }
  function makeCrops(parent, prop) {
    const g = new THREE.Group();
    g.position.set(prop.x, prop.y, prop.z);
    g.rotation.y = prop.angle;
    g.scale.setScalar(prop.scale);
    addMesh(
      g,
      new THREE.BoxGeometry(0.36, 0.012, 0.4),
      propMaterial('soil', prop.temperature),
      0,
      0.006,
      0,
    );
    for (let row = 0; row < 4; row++) {
      const z = (row - 1.5) * 0.085;
      addMesh(
        g,
        new THREE.BoxGeometry(0.32, 0.028, 0.027),
        propMaterial('crop', prop.temperature),
        0,
        0.025,
        z,
      );
      for (let k = 0; k < 5; k++)
        addMesh(
          g,
          new THREE.ConeGeometry(0.012, 0.065 + prop.variant * 0.01, 3),
          propMaterial('crop', prop.temperature),
          (k - 2) * 0.06,
          0.058,
          z,
        );
    }
    parent.add(g);
  }
  const makePoi = createPoiBuilder({
    addMesh,
    propMaterial,
    makeHouse,
    makeTower,
    roofGeometry,
  });
  function makeWave(parent, prop) {
    const points = [];
    // Three shallow arcs, well inside the hex throughout the slow drift loop.
    for (let row = 0; row < 3; row++) {
      for (let step = 0; step < 6; step++) {
        const a = -0.22 + (step * 0.44) / 6,
          b = a + 0.44 / 6;
        const za = (row - 1) * 0.08 + a * a * 0.6,
          zb = (row - 1) * 0.08 + b * b * 0.6;
        points.push(
          a,
          0,
          za,
          b,
          0,
          zb,
          a,
          0,
          za + 0.024,
          b,
          0,
          zb,
          b,
          0,
          zb + 0.024,
          a,
          0,
          za + 0.024,
        );
      }
    }
    const mesh = addMesh(parent, geometryFrom(points), materials.wave, prop.x, prop.y, prop.z);
    mesh.rotation.y = Math.PI / 2 - prop.angle;
    mesh.userData.wavePhase = prop.phase;
    mesh.castShadow = false;
  }
  function smoothTerrainGeometry(surface, cell) {
    if (cell.bankBevel) {
      const groups = [[], []];
      surface.triangles.forEach((face, index) => {
        for (const vertex of face)
          groups[surface.materialIndices[index]].push(...surface.vertices[vertex]);
      });
      // Separate faces retain the exact sharp normals and material of the
      // ordinary land bevel; sharing/averaging normals rounds the tile edge.
      const geometry = geometryFrom([...groups[0], ...groups[1]]);
      geometry.addGroup(0, groups[0].length / 3, 0);
      geometry.addGroup(groups[0].length / 3, groups[1].length / 3, 1);
      return geometry;
    }
    const geometry = new THREE.BufferGeometry(),
      points = surface.vertices.flat(),
      normals = [];
    for (const [x, y, z] of surface.vertices) {
      const wx = x + cell.wx,
        wz = z + cell.wz;
      if (riverIslandValue(cell.river, wx, wz) > riverBankValue(cell.river, wx, wz)) {
        normals.push(0, 1, 0);
        continue;
      }
      const e = 0.002,
        dx =
          (riverBankHeight(cell.river, wx + e, wz) - riverBankHeight(cell.river, wx - e, wz)) /
          (2 * e),
        dz =
          (riverBankHeight(cell.river, wx, wz + e) - riverBankHeight(cell.river, wx, wz - e)) /
          (2 * e),
        length = Math.hypot(dx, 1, dz);
      normals.push(-dx / length, 1 / length, -dz / length);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(surface.triangles.flat());
    return geometry;
  }
  function makeLandBankJoin(parent, data) {
    if (!data.shoreCornerHeights) return;
    const points = [];
    for (let sector = 0; sector < 6; sector++)
      if (data.shoreLinks[(7 - sector) % 6]) {
        const corner = (k, outer) => {
          k %= 6;
          const a = (k * Math.PI) / 3,
            x = outer ? Math.sin(a) : data.corners ? data.corners[k][0] : Math.sin(a) * TOP_RADIUS,
            z = outer ? Math.cos(a) : data.corners ? data.corners[k][1] : Math.cos(a) * TOP_RADIUS,
            y = outer
              ? data.shoreCornerHeights[k] - data.top
              : data.surface
                ? surfaceHeight(data.surface, x, z)
                : 0;
          return [x, y, z];
        };
        const a = corner(sector, false),
          b = corner(sector + 1, false),
          c = corner(sector, true),
          d = corner(sector + 1, true);
        points.push(...a, ...c, ...d, ...a, ...d, ...b);
      }
    if (points.length) addMesh(parent, geometryFrom(points), materials.riverGround);
  }
  function makeRiver(parent, data) {
    const surface = data.riverSurface,
      water = [],
      cliffs = [],
      normals = [];
    if (surface.triangles.length)
      addMesh(
        parent,
        smoothTerrainGeometry(surface, data),
        data.bankBevel ? [materials.riverGround, materials.bevel] : materials.riverGround,
      );
    if (surface.water) {
      for (const face of surface.water.triangles)
        for (const index of face) water.push(...surface.water.vertices[index]);
    } else
      for (let k = 0; k < 6; k++) {
        const a = data.riverCorners[k],
          b = data.riverCorners[(k + 1) % 6];
        water.push(0, 0, 0, a[0], 0, a[1], b[0], 0, b[1]);
      }
    const waterMesh = addMesh(parent, geometryFrom(water), materials.water);
    waterMesh.castShadow = false;
    function normal(p) {
      const x = data.wx + p[0],
        z = data.wz + p[2],
        e = 0.002,
        dx = riverLandValue(data.river, x + e, z) - riverLandValue(data.river, x - e, z),
        dz = riverLandValue(data.river, x, z + e) - riverLandValue(data.river, x, z - e),
        length = Math.hypot(dx, dz) || 1;
      return [-dx / length, 0, -dz / length];
    }
    function wall(a, b, na = normal(a), nb = normal(b)) {
      if ((b[2] - a[2]) * na[0] - (b[0] - a[0]) * na[2] < 0) {
        [a, b] = [b, a];
        [na, nb] = [nb, na];
      }
      const c = [a[0], -0.008, a[2]],
        d = [b[0], -0.008, b[2]];
      cliffs.push(...a, ...b, ...c, ...b, ...d, ...c);
      normals.push(...na, ...nb, ...na, ...nb, ...nb, ...na);
    }
    for (const [a, b] of surface.shore) wall(a, b);
    // At the map edge, close exposed land. At neighbouring land, only close a
    // water-reaching section; otherwise the matching bank and land form one top.
    for (let k = 0; k < 6; k++)
      if (!data.riverShared[(7 - k) % 6]) {
        const a = data.riverCorners[k],
          b = data.riverCorners[(k + 1) % 6],
          land = data.riverLandSides[(7 - k) % 6],
          at = (t) => {
            const x = a[0] + (b[0] - a[0]) * t,
              z = a[1] + (b[1] - a[1]) * t;
            return { x, z, v: riverLandValue(data.river, data.wx + x, data.wz + z) };
          };
        for (let j = 0; j < 28; j++) {
          let p = at(j / 28),
            q = at((j + 1) / 28);
          const keep = (v) => (land ? v < 0 : v >= 0);
          if (!keep(p.v) && !keep(q.v)) continue;
          if (keep(p.v) !== keep(q.v)) {
            const t = p.v / (p.v - q.v),
              m = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, v: 0 };
            if (keep(p.v)) q = m;
            else p = m;
          }
          const point = (p) => [p.x, riverTopHeight(data, p.x, p.z), p.z],
            dx = b[0] - a[0],
            dz = b[1] - a[1],
            length = Math.hypot(dx, dz),
            n = land ? [-dz / length, 0, dx / length] : [dz / length, 0, -dx / length];
          wall(point(p), point(q), n, n);
        }
      }
    if (cliffs.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(cliffs, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      addMesh(parent, g, materials.riverCliff);
    }
    if (data.crossing) makeCrossing(parent, data.crossing);
  }
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

  function buildMap(layout) {
    const old = new Set();
    map.traverse((o) => {
      if (o.geometry) old.add(o.geometry);
    });
    map.clear();
    old.forEach((g) => g.dispose());
    cells.length = 0;
    const propBatches = new Map();
    const wave = layout.flatMap((cell) => cell.props).find((prop) => prop.kind === 'wave');
    if (wave) waveDirection.value.set(Math.cos(wave.angle), Math.sin(wave.angle));
    for (const data of layout) {
      const g = new THREE.Group();
      g.position.set(Math.sqrt(3) * (data.q + data.r / 2), 0, 1.5 * data.r);
      const river = !!data.riverSurface;
      const openWater = data.type === 'Open water';
      const water = river || openWater;
      addMesh(
        g,
        bevelTile(
          data.top,
          water,
          river
            ? data.riverCorners
            : openWater
              ? Array.from({ length: 6 }, (_, k) => [
                  Math.sin((k * Math.PI) / 3),
                  Math.cos((k * Math.PI) / 3),
                ])
              : data.corners,
          water ? (data.riverShared ?? data.openWaterShared) : data.surface ? data.shared : null,
        ),
        [
          materials.side,
          water && !(data.water === 'river' && data.clipWater)
            ? materials.waterDeep
            : materials.bevel,
          water ? materials.water : data.tone ? materials.groundLight : materials.ground,
        ],
      );
      const content = new THREE.Group();
      content.position.y = data.top;
      g.add(content);
      if (data.surface) makeRidge(content, data.surface);
      if (river) makeRiver(content, data);
      else if (openWater) {
        const vertices = [];
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3,
            b = ((k + 1) * Math.PI) / 3;
          vertices.push(0, 0, 0, Math.sin(a), 0, Math.cos(a), Math.sin(b), 0, Math.cos(b));
        }
        const surface = addMesh(content, geometryFrom(vertices), materials.water);
        surface.castShadow = false;
      } else makeLandBankJoin(content, data);
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
  function ringGeometry(cell) {
    const points = [],
      surface = cell.surface || cell.riverSurface,
      mountain = !!surface,
      n = cell.riverSurface ? 28 : mountain ? 8 : 1;
    const corners =
      cell.riverCorners ||
      cell.corners ||
      Array.from({ length: 6 }, (_, k) => [
        Math.sin((k * Math.PI) / 3),
        Math.cos((k * Math.PI) / 3),
      ]);
    function point(k, t, factor) {
      const a = corners[k],
        b = corners[(k + 1) % 6],
        x = (a[0] + (b[0] - a[0]) * t) * factor,
        z = (a[1] + (b[1] - a[1]) * t) * factor;
      return [x, cell.top + (mountain ? Math.max(0, surfaceHeight(surface, x, z)) : 0) + 0.018, z];
    }
    for (let k = 0; k < 6; k++)
      for (let j = 0; j < n; j++) {
        const a = point(k, j / n, mountain ? 0.966 : 0.932),
          b = point(k, j / n, mountain ? 0.996 : 0.977),
          c = point(k, (j + 1) / n, mountain ? 0.996 : 0.977),
          d = point(k, (j + 1) / n, mountain ? 0.966 : 0.932);
        points.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    return geometryFrom(points);
  }
  const activeRing = new THREE.Mesh(new THREE.BufferGeometry(), materials.line),
    hoverRing = new THREE.Mesh(new THREE.BufferGeometry(), materials.hover);
  scene.add(activeRing, hoverRing);
  hoverRing.visible = false;
  function setRing(ring, cell) {
    ring.geometry.dispose();
    ring.geometry = ringGeometry(cell);
    ring.position.set(cell.g.position.x, 0, cell.g.position.z);
  }
  let selected = null,
    hovered = null,
    zoom = 1;
  function choose(key) {
    const cell = cells.find((cell) => cell.key === key);
    if (!cell) return;
    selected = key;
    hoverRing.visible = false;
    setRing(activeRing, cell);
    activeRing.visible = true;
    onSelect(key);
    draw();
  }
  activeRing.visible = false;
  function applyPalette() {
    scene.background = new THREE.Color(color.background());
    Object.keys(materialRoles).forEach((key) => materials[key].color.set(color.role(key)));
    for (const { material, role, temperature, colorTone } of tintedMaterials.values())
      material.color.set(color.role(role, temperature, colorTone));
    materials.line.color.set(color.role('active'));
    materials.hover.color.set(color.role('hover'));
    materials.wave.color.set(color.role('wave'));
    draw();
  }
  function draw() {
    renderer.domElement.dataset.zoom = String(camera.zoom);
    renderer.render(scene, camera);
  }
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    let width = 5,
      height = 4;
    for (const cell of cells) {
      const ridgeHeight = cell.surface ? Math.max(...cell.surface.vertices.map((v) => v[1])) : 0;
      const point = new THREE.Vector3(cell.g.position.x, cell.top + ridgeHeight, cell.g.position.z);
      width = Math.max(width, Math.abs(point.dot(right)) + 1.5);
      height = Math.max(height, Math.abs(point.dot(up)) + 1.5);
    }
    const vertical = Math.max(height, width / (w / h)) * 1.06;
    camera.left = (-vertical * w) / h;
    camera.right = (vertical * w) / h;
    camera.top = vertical;
    camera.bottom = -vertical;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    draw();
  }
  function changeZoom(factor) {
    zoom = Math.min(12, Math.max(0.7, zoom * factor));
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    draw();
  }
  const raycaster = new THREE.Raycaster(),
    mouse = new THREE.Vector2();
  function hit(x, y) {
    const rect = host.getBoundingClientRect();
    mouse.set(((x - rect.left) / rect.width) * 2 - 1, (-(y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(map.children, true);
    if (!hits.length) return null;
    const hit = hits[0],
      ranges = hit.object.userData.faceRanges;
    if (!ranges) return hit.object.userData.key;
    let low = 0,
      high = ranges.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (hit.faceIndex < ranges[mid].end) high = mid;
      else low = mid + 1;
    }
    return ranges[low].key;
  }
  const pointers = new Map();
  let last = null,
    start = null,
    pinched = false,
    pinchDistance = 0;
  listen(host, 'pointerdown', (e) => {
    if (e.button !== 0) return;
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      last = { x: e.clientX, y: e.clientY };
      start = { ...last };
      pinched = false;
    } else {
      pinched = true;
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
    hoverRing.visible = false;
    hovered = null;
    onHover(null);
  });
  listen(host, 'pointermove', (e) => {
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0) changeZoom(d / pinchDistance);
        pinchDistance = d;
        return;
      }
      if (last) {
        const dx = e.clientX - last.x,
          dy = e.clientY - last.y;
        const scale = (camera.right - camera.left) / (host.clientWidth * zoom);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        camera.position.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
        last = { x: e.clientX, y: e.clientY };
        draw();
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const key = hit(e.clientX, e.clientY);
      if (key !== hovered) {
        hovered = key;
        onHover(key);
        hoverRing.visible = !!key && key !== selected;
        if (hoverRing.visible) {
          const c = cells.find((c) => c.key === key);
          setRing(hoverRing, c);
        }
        draw();
      }
    }
  });
  function release(e) {
    const wasLast = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (wasLast && !pinched && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) {
      const key = hit(e.clientX, e.clientY);
      if (key) choose(key);
    }
    last = null;
    start = null;
    if (pointers.size === 1) last = [...pointers.values()][0];
  }
  listen(host, 'pointerup', release);
  listen(host, 'pointercancel', (e) => {
    pointers.delete(e.pointerId);
    last = null;
    start = null;
  });
  listen(host, 'pointerleave', () => {
    hovered = null;
    onHover(null);
    hoverRing.visible = false;
    draw();
  });
  listen(
    host,
    'wheel',
    (e) => {
      e.preventDefault();
      changeZoom(Math.exp(-e.deltaY * 0.001));
    },
    { passive: false },
  );
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motionEnabled = motion;
  let lastFrame = -Infinity;
  const updateMotion = () => {
    const enabled = motionEnabled && !reducedMotion.matches && !document.hidden;
    lastFrame = -Infinity;
    renderer.domElement.dataset.motion = enabled ? 'ambient' : 'still';
    renderer.setAnimationLoop(
      enabled
        ? (time) => {
            if (time - lastFrame < 50) return;
            if (Number.isFinite(lastFrame)) ambientTime.value += (time - lastFrame) / 1000;
            lastFrame = time;
            draw();
          }
        : null,
    );
    if (!enabled) {
      draw();
    }
  };
  listen(reducedMotion, 'change', updateMotion);
  listen(document, 'visibilitychange', updateMotion);
  updateMotion();
  if (loading) loading.hidden = true;
  return {
    setMotion(enabled) {
      motionEnabled = enabled;
      updateMotion();
    },
    setMap(layout, { resetView = false } = {}) {
      buildMap(layout);
      hovered = null;
      onHover(null);
      hoverRing.visible = false;
      if (resetView) {
        zoom = 1;
        camera.position.set(24, 30, 37);
        camera.lookAt(0, 0.3, 0);
      }
      if (selected && cells.some((cell) => cell.key === selected)) choose(selected);
      resize();
    },
    select: choose,
    zoom: changeZoom,
    snapshot() {
      draw();
      return renderer.domElement.toDataURL('image/png');
    },
    setPalette(seeds) {
      color = createMapPalette(seeds);
      applyPalette();
    },
    dispose() {
      renderer.setAnimationLoop(null);
      listeners.abort();
      observer.disconnect();
      const geometries = new Set();
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
      });
      geometries.forEach((geometry) => geometry.dispose());
      Object.values(materials).forEach((material) => material.dispose());
      for (const { material } of tintedMaterials.values()) material.dispose();
      treeDepth.dispose();
      shadowFloor.material.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
