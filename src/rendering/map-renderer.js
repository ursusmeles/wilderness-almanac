import * as THREE from 'three';
import { createMapMaterials } from './map-materials.js';
import { createMapMeshes } from './map-meshes.js';
import { createMapControls } from './map-controls.js';
import { createAmbientLoop } from './ambient-motion.js';

export function createMapRenderer(
  host,
  { onSelect = () => {}, onHover = () => {}, motion = true } = {},
) {
  const loading = host.querySelector('#hp-loading');
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
  const palette = createMapMaterials();
  const meshes = createMapMeshes(palette);
  scene.add(meshes.group);
  const controls = createMapControls({
    host,
    renderer,
    scene,
    map: meshes.group,
    cells: meshes.cells,
    materials: palette.materials,
    draw,
    onSelect,
    onHover,
  });
  function draw() {
    renderer.domElement.dataset.zoom = String(controls.camera.zoom);
    renderer.render(scene, controls.camera);
  }
  const ambientLoop = createAmbientLoop({
    renderer,
    ambientTime: palette.ambientTime,
    draw,
    motion,
  });
  if (loading) loading.hidden = true;
  return {
    setMotion: ambientLoop.setMotion,
    setMap(layout, options) {
      meshes.setMap(layout);
      controls.refresh(options);
    },
    select: controls.select,
    zoom: controls.zoom,
    snapshot() {
      draw();
      return renderer.domElement.toDataURL('image/png');
    },
    setPalette(seeds) {
      palette.setPalette(seeds);
      scene.background = new THREE.Color(palette.background());
      draw();
    },
    dispose() {
      ambientLoop.dispose();
      controls.dispose();
      meshes.dispose();
      palette.dispose();
      shadowFloor.geometry.dispose();
      shadowFloor.material.dispose();
      sun.shadow.dispose();
      scene.clear();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
