import * as THREE from 'three';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import { surfaceHeight } from '../src/generation/math.js';
import { palettes, paletteNames, hexToOklch } from '../src/palette.js';
import { createMapPalette } from '../src/map-palette.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';
import { createPartyPiece } from './party-token-mesh.js';
import { createPartyRoute } from './party-token-model.js';
import { DIRECTIONS } from '../src/generation/hex.js';

const el = (id) => document.getElementById(id);
const styles = [
  [
    'The cairn pawn',
    'A broad, bevelled stone pawn with a domed cap, a coloured girdle and a short forked banner. Quiet, weighty and closest to the Lewis pawn silhouette.',
  ],
  [
    'The warden',
    'A squat wooden guardian with a helmet and shield. The coloured body and square standard make the party read as a little company of travellers.',
  ],
  [
    'The waystone',
    'A slender six-sided standing piece with carved marks and a hanging pennant. A lighter footprint with the tallest, clearest silhouette.',
  ],
];
const world = generateWorld('7');
const layout = prepareMap(world, generateDressing(world, 0));
const route = createPartyRoute(world.cells);
const tiles = new Map(layout.map((tile) => [tile.key, tile]));
const canvas = el('map');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;
const scene = new THREE.Scene(),
  tokenScene = new THREE.Scene(),
  detailScene = new THREE.Scene();
function light(root) {
  root.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-15, 30, -18);
  root.add(sun);
  return sun;
}
const sun = light(scene);
light(tokenScene);
light(detailScene);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 90 });
sun.shadow.normalBias = 0.035;
const registry = createMapMaterials(),
  meshes = createMapMeshes(registry);
scene.add(meshes.group);
meshes.setMap(layout);
const camera = new THREE.OrthographicCamera(-6, 6, 5, -5, 0.1, 180);
const detailCamera = new THREE.OrthographicCamera(-0.72, 0.72, 1, -0.2, 0.1, 30);
detailCamera.position.set(2.4, 1.9, 3.7);
detailCamera.lookAt(0, 0.46, 0);
const detailRenderer = new THREE.WebGLRenderer({
  canvas: el('detail'),
  antialias: true,
  alpha: true,
});
detailRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const tokenRoot = new THREE.Group();
tokenScene.add(tokenRoot);
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.26, 24),
  new THREE.MeshBasicMaterial({
    color: 0x15121c,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);
const visited = new THREE.Group();
scene.add(visited);
let style = Number(new URLSearchParams(location.search).get('style') ?? 0);
if (![0, 1, 2].includes(style)) style = 0;
let piece,
  detailPiece,
  selected = true,
  drag = false,
  pointerId,
  hoverKey,
  drop = -1,
  lastTime = 0;
let leanX = 0,
  leanZ = 0,
  lastPoint;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const target = new THREE.Vector3();
function position(cell) {
  const tile = tiles.get(cell.key),
    x = -0.48,
    z = 0.31;
  return new THREE.Vector3(
    tile.wx + x,
    tile.top +
      Math.max(
        0,
        tile.surface || tile.riverSurface
          ? surfaceHeight(tile.surface ?? tile.riverSurface, x, z)
          : 0,
      ) +
      0.025,
    tile.wz + z,
  );
}
function centreCamera() {
  const tile = tiles.get(route.current.key);
  const centre = new THREE.Vector3(tile.wx, tile.top + 0.1, tile.wz);
  camera.position.copy(centre).add(new THREE.Vector3(24, 30, 37));
  camera.lookAt(centre);
  camera.updateMatrixWorld();
}
function marks() {
  for (const child of [...visited.children]) {
    child.geometry.dispose();
    child.material.dispose();
    visited.remove(child);
  }
  for (const key of route.visited) {
    const tile = tiles.get(key);
    const mark = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 0.82, 6),
      new THREE.MeshBasicMaterial({
        color: '#f6d896',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(tile.wx, tile.top + 0.018, tile.wz);
    visited.add(mark);
  }
}
function update() {
  const cell = route.current;
  el('location').textContent = `Region #${cell.regionId} · ${cell.x}, ${cell.y}`;
  el('status').textContent =
    `${route.visited.size} ${route.visited.size === 1 ? 'hex' : 'hexes'} visited · ${cell.pointOfLight?.type ?? cell.terrain}`;
  el('pick').setAttribute('aria-pressed', String(selected));
  el('pick').textContent = selected ? 'Party token selected' : 'Select party token';
  for (const button of el('directions').children)
    button.disabled = !selected || !route.neighbour(Number(button.dataset.direction));
  canvas.style.cursor = drag ? 'grabbing' : selected ? 'grab' : 'default';
}
function move(key) {
  if (!route.move(key)) return;
  target.copy(position(route.current));
  drop = reduced.matches ? -1 : performance.now();
  centreCamera();
  marks();
  update();
}
function accentFor(seeds) {
  const palette = createMapPalette(seeds);
  const lab = (hex) => {
    const [l, c, h] = hexToOklch(hex);
    return [l, c * Math.cos(h), c * Math.sin(h)];
  };
  const surfaces = ['ground', 'leaf', 'leafLight', 'roof', 'water'].map((role) =>
    lab(palette.role(role)),
  );
  return ['#ef365c', '#13d9f2', '#c4f532']
    .map((color) => ({
      color,
      score: Math.min(
        ...surfaces.map((surface) => Math.hypot(...lab(color).map((n, i) => n - surface[i]))),
      ),
    }))
    .sort((a, b) => b.score - a.score)[0].color;
}
function setStyle() {
  const color = accentFor(palettes[el('palette').value]);
  piece?.group.removeFromParent();
  detailPiece?.removeFromParent();
  piece?.dispose();
  piece = createPartyPiece(style, color);
  tokenRoot.add(piece.group);
  detailPiece = piece.group.clone(true);
  detailScene.add(detailPiece);
  document.documentElement.style.setProperty('--accent', color);
  el('number').textContent = `APPROACH 0${style + 1}`;
  el('name').textContent = styles[style][0];
  el('description').textContent = styles[style][1];
  document
    .querySelectorAll('[data-style]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(Number(button.dataset.style) === style)),
    );
}
for (const [key, name] of Object.entries(paletteNames)) el('palette').add(new Option(name, key));
el('palette').value = 'forbidden';
el('palette').addEventListener('change', () => {
  registry.setPalette(palettes[el('palette').value]);
  scene.background = new THREE.Color(registry.background());
  setStyle();
});
document.querySelectorAll('[data-style]').forEach((button) =>
  button.addEventListener('click', () => {
    style = Number(button.dataset.style);
    setStyle();
  }),
);
const keyDirections = ['d', 'x', 'z', 'a', 'q', 'w'];
centreCamera();
for (let i = 0; i < 6; i++) {
  const button = document.createElement('button');
  const [q, r] = DIRECTIONS[i];
  const vector = new THREE.Vector3(Math.sqrt(3) * (q + r / 2), 0, 1.5 * r).applyQuaternion(
    camera.quaternion.clone().invert(),
  );
  const angle = Math.atan2(-vector.y, vector.x);
  button.style.left = `${73 + 68 * Math.cos(angle)}px`;
  button.style.top = `${43 + 41 * Math.sin(angle)}px`;
  button.textContent = '➜';
  button.style.rotate = `${angle}rad`;
  button.dataset.direction = i;
  button.setAttribute('aria-label', `Move one hex (${keyDirections[i].toUpperCase()})`);
  button.addEventListener('click', () => {
    const next = route.neighbour(i);
    if (next) move(next.key);
  });
  el('directions').append(button);
}
el('pick').addEventListener('click', () => {
  selected = !selected;
  update();
  if (selected) canvas.focus();
});
document.addEventListener('keydown', (event) => {
  if (event.target.closest('select,input') || event.ctrlKey || event.metaKey || event.altKey)
    return;
  if (event.key === 'Escape') {
    selected = false;
    update();
  }
  const index = keyDirections.indexOf(event.key.toLowerCase());
  if (!selected || index < 0) return;
  event.preventDefault();
  const next = route.neighbour(index);
  if (next) move(next.key);
});
const ray = new THREE.Raycaster(),
  mouse = new THREE.Vector2();
function cast(event) {
  const rect = canvas.getBoundingClientRect();
  mouse.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    (-(event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  ray.setFromCamera(mouse, camera);
}
function hexHit() {
  const hit = ray.intersectObject(meshes.group, true)[0];
  if (!hit) return;
  const ranges = hit.object.userData.faceRanges;
  return ranges ? ranges.find((range) => hit.faceIndex < range.end)?.key : hit.object.userData.key;
}
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  cast(event);
  if (ray.intersectObject(tokenRoot, true).length) {
    selected = true;
    drag = true;
    pointerId = event.pointerId;
    canvas.setPointerCapture(pointerId);
    drop = -1;
    lastPoint = null;
  } else if (selected) {
    const key = hexHit();
    if (key) move(key);
  }
  canvas.focus();
  update();
});
canvas.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== pointerId) return;
  cast(event);
  hoverKey = hexHit();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -target.y - 0.6);
  const point = ray.ray.intersectPlane(plane, new THREE.Vector3());
  if (!point) return;
  if (lastPoint) {
    leanX = THREE.MathUtils.clamp(-(point.z - lastPoint.z) * 1.8, -0.18, 0.18);
    leanZ = THREE.MathUtils.clamp((point.x - lastPoint.x) * 1.8, -0.18, 0.18);
  }
  tokenRoot.position.copy(point);
  lastPoint = point;
});
function release(event) {
  if (!drag || event.pointerId !== pointerId) return;
  drag = false;
  leanX = leanZ = 0;
  if (event.type === 'pointercancel') hoverKey = null;
  move(hoverKey ?? route.current.key);
  hoverKey = null;
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
const observer = new ResizeObserver(() => {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.left = (-5.2 * width) / height;
  camera.right = (5.2 * width) / height;
  camera.top = 5.2;
  camera.bottom = -5.2;
  camera.updateProjectionMatrix();
  detailRenderer.setSize(el('detail').clientWidth, el('detail').clientHeight, false);
  const aspect = el('detail').clientWidth / el('detail').clientHeight;
  detailCamera.left = -0.65 * aspect;
  detailCamera.right = 0.65 * aspect;
  detailCamera.top = 0.65;
  detailCamera.bottom = -0.65;
  detailCamera.updateProjectionMatrix();
});
observer.observe(canvas);
observer.observe(el('detail'));
registry.setPalette(palettes.forbidden);
scene.background = new THREE.Color(registry.background());
centreCamera();
target.copy(position(route.current));
tokenRoot.position.copy(target);
setStyle();
marks();
update();
function frame(time) {
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;
  if (!drag) {
    let lift = 0;
    if (drop >= 0) {
      const progress = Math.min(1, (time - drop) / [280, 360, 230][style]);
      lift = 0.38 * (1 - progress) ** 2;
      if (progress === 1) drop = -1;
    }
    tokenRoot.position.copy(target);
    tokenRoot.position.y += lift;
  }
  tokenRoot.rotation.x = THREE.MathUtils.damp(
    tokenRoot.rotation.x,
    reduced.matches ? 0 : leanX,
    14,
    dt,
  );
  tokenRoot.rotation.z = THREE.MathUtils.damp(
    tokenRoot.rotation.z,
    reduced.matches ? 0 : leanZ,
    14,
    dt,
  );
  leanX *= 0.9;
  leanZ *= 0.9;
  shadow.position.copy(target);
  shadow.position.y += 0.005;
  shadow.scale.setScalar(drag ? 0.8 : 1);
  shadow.material.opacity = drag ? 0.13 : 0.28;
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(tokenScene, camera);
  detailRenderer.render(detailScene, detailCamera);
  frameId = requestAnimationFrame(frame);
}
let frameId = requestAnimationFrame(frame);
window.addEventListener(
  'pagehide',
  () => {
    cancelAnimationFrame(frameId);
    observer.disconnect();
    piece.dispose();
    meshes.dispose();
    registry.dispose();
    shadow.geometry.dispose();
    shadow.material.dispose();
    visited.children.forEach((mark) => {
      mark.geometry.dispose();
      mark.material.dispose();
    });
    sun.shadow.dispose();
    renderer.dispose();
    detailRenderer.dispose();
  },
  { once: true },
);
