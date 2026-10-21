import { writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';

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
// Dusk ground/water with Ember foliage, fixed independently of campaign palettes.
palette.setPalette(['#282039', '#237d89', '#ed8965']);
const meshes = createMapMeshes(palette);
meshes.setMap([
  {
    key: 'default',
    q: 0,
    r: 0,
    wx: 0,
    wz: 0,
    type: 'Land',
    terrain: 'meadow',
    top: 0.34,
    tone: false,
    props: [
      { kind: 'tree', x: -0.27, z: -0.16, scale: 1.18, angle: 0.3, variant: 1, temperature: 0.5 },
      { kind: 'rock', x: 0.3, z: 0.28, footprint: 0.23, angle: 0.5, variant: 0, detailSeed: 14 },
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
  [-0.1, -0.01, 0.29, 0.17],
  [0.34, 0.31, 0.17, 0.1],
]) {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 12),
    new THREE.MeshBasicMaterial({
      color: '#393046',
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
let svg = renderer.domElement
  .serialize()
  .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
svg = svg.replace(
  /(<svg[^>]*>)/,
  '$1<rect x="-192" y="-192" width="384" height="384" fill="#211c36"/>',
);
await writeFile(process.argv[2] ?? '/tmp/wilderness-almanac-default-icon.svg', svg);
meshes.dispose();
palette.dispose();
