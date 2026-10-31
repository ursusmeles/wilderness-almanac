import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { palettes } from '../src/palette.js';

// SVGRenderer needs only these DOM operations; asset generation needs no WebGL or browser.
class SvgElement {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.childNodes = [];
    this.style = {};
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  appendChild(child) {
    this.childNodes.push(child);
  }
  removeChild(child) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
  }
  serialize() {
    return `<${this.tag} ${Object.entries(this.attributes)
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ')}>${this.childNodes.map((child) => child.serialize()).join('')}</${this.tag}>`;
  }
}
globalThis.document = { createElementNS: (_, tag) => new SvgElement(tag) };
const palette = createMapMaterials();
// Fixed Verdant Kingdoms forest and stone watchtower, independent of campaign choices.
palette.setPalette(palettes.classic);
const meshes = createMapMeshes(palette);
meshes.setMap([
  {
    key: 'default',
    q: 0,
    r: 0,
    wx: 0,
    wz: 0,
    type: 'Land',
    terrain: 'light forest',
    top: 0.34,
    tone: true,
    props: [
      {
        kind: 'poi',
        poiKind: 'watchtower',
        variant: 'watchtower',
        detailSeed: 7,
        temperature: 0,
        x: 0.27,
        z: 0.18,
        y: 0,
        footprint: 0.3,
        pedestalDepth: 0.035,
      },
      ...[
        [-0.4, -0.3, 1.1],
        [-0.05, -0.45, 0.95],
        [0.38, -0.34, 1],
        [-0.55, 0.12, 0.95],
        [-0.28, 0.28, 0.9],
      ].map(([x, z, scale], i) => ({
        kind: 'tree',
        x,
        z,
        scale,
        angle: i * 0.7,
        variant: 1,
        temperature: i % 2 ? -0.4 : 0.4,
      })),
      ...[
        [-0.42, 0.28],
        [-0.5, 0.09],
        [0.36, -0.35],
        [0.53, -0.21],
        [0.03, 0.54],
      ].map(([x, z], i) => ({
        kind: 'grass',
        x,
        z,
        scale: 0.9,
        angle: i,
        variant: 1,
        detailSeed: i + 1,
      })),
    ],
  },
]);
const scene = new THREE.Scene();
scene.add(meshes.group, new THREE.AmbientLight(0xffffff, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-15, 30, -18);
scene.add(sun);
// Flat, faceted contact shadows preserve the map's contrast in the baked still.
for (const [x, z, sx, sz] of [
  [-0.29, -0.05, 0.43, 0.29],
  [0.29, 0.2, 0.31, 0.25],
]) {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 12),
    new THREE.MeshBasicMaterial({
      color: '#34452f',
      transparent: false,
      opacity: 1,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(sx, sz, 1);
  shadow.position.set(x, 0.343, z);
  scene.add(shadow);
}
const camera = new THREE.OrthographicCamera(-1.32, 1.32, 1.32, -1.32, 0.1, 180);
camera.position.set(24, 30, 37);
camera.lookAt(0, 0.43, 0);
const renderer = new SVGRenderer();
renderer.setSize(384, 384);
renderer.setPrecision(2);
renderer.render(scene, camera);
const svg = renderer.domElement
  .serialize()
  .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
// Keep the canvas transparent so the same still works on light and dark UI surfaces.
await writeFile(process.argv[2] ?? '/tmp/wilderness-almanac-default-icon.svg', svg);
meshes.dispose();
palette.dispose();
