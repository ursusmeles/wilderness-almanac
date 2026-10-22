import * as THREE from 'three';
import { surfaceHeight } from '../generation/math.js';
import { PARTY_STYLES } from '../application/party-token.js';
import { createPartyPiece } from './party-piece.js';
import { partyColor } from './party-color.js';

// A separately rendered piece shares the map camera, but never moves it.
export function createPartyToken({ host, draw, onMove }) {
  const scene = new THREE.Scene(),
    root = new THREE.Group();
  scene.add(root, new THREE.HemisphereLight(0xffffff, 0x777777, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-15, 30, -18);
  scene.add(sun);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController();
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2(),
    target = new THREE.Vector3();
  let piece,
    state,
    tiles,
    appearance,
    dragging = false,
    frame = 0,
    drop = -1,
    lastTime = 0,
    previous,
    pointerStart,
    moved = false;
  let leanX = 0,
    leanZ = 0;
  let selected = false;
  function select(value) {
    selected = value;
    piece?.setSelected(value);
    host.dataset.partySelected = String(value);
    schedule();
  }
  const offset = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function position(key) {
    const tile = tiles.find((tile) => tile.key === key);
    if (!tile) return null;
    const x = -0.48,
      z = 0.31,
      surface = tile.surface ?? tile.riverSurface;
    return new THREE.Vector3(
      tile.g.position.x + x,
      tile.top + Math.max(0, surface ? surfaceHeight(surface, x, z) : 0) + 0.025,
      tile.g.position.z + z,
    );
  }
  function cast(event, camera) {
    const rect = host.getBoundingClientRect();
    mouse.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
  }
  function schedule() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function tick(time) {
    frame = 0;
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (!dragging) {
      root.position.copy(target);
      if (drop >= 0) {
        const progress = Math.min(
          1,
          (time - drop) / [280, 360, 230][PARTY_STYLES.indexOf(state.style)],
        );
        root.position.y += 0.38 * (1 - progress) ** 2;
        if (progress === 1) drop = -1;
      }
    }
    root.rotation.x = THREE.MathUtils.damp(root.rotation.x, reduced.matches ? 0 : leanX, 14, dt);
    root.rotation.z = THREE.MathUtils.damp(root.rotation.z, reduced.matches ? 0 : leanZ, 14, dt);
    leanX *= 0.85;
    leanZ *= 0.85;
    draw();
    if (dragging || drop >= 0 || Math.abs(root.rotation.x) + Math.abs(root.rotation.z) > 0.001)
      schedule();
  }
  function land() {
    dragging = false;
    leanX = leanZ = 0;
    host.style.removeProperty('cursor');
    if (!state) return;
    target.copy(position(state.key));
    drop = reduced.matches ? -1 : performance.now();
    if (reduced.matches) {
      root.position.copy(target);
      root.rotation.set(0, 0, 0);
    }
    schedule();
  }
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        land();
      } else schedule();
    },
    { signal: listeners.signal },
  );
  reduced.addEventListener(
    'change',
    () => {
      if (reduced.matches) {
        drop = -1;
        leanX = leanZ = 0;
        root.rotation.set(0, 0, 0);
      }
      schedule();
    },
    { signal: listeners.signal },
  );
  return {
    set(value, cells, seeds) {
      tiles = cells;
      const next = position(value.key);
      if (!next) return;
      const changed = state && state.key !== value.key;
      const color = partyColor(seeds),
        signature = `${value.style}:${color}`;
      if (appearance !== signature) {
        piece?.group.removeFromParent();
        piece?.dispose();
        piece = createPartyPiece(PARTY_STYLES.indexOf(value.style), color);
        piece.setSelected(selected);
        root.add(piece.group);
        appearance = signature;
      }
      state = value;
      target.copy(next);
      if (!dragging) root.position.copy(target);
      if (changed) land();
      draw();
    },
    start(event, camera) {
      if (!piece || document.hidden) return false;
      cast(event, camera);
      root.updateWorldMatrix(true, true);
      if (!ray.intersectObject(root, true).length) return false;
      select(true);
      dragging = true;
      drop = -1;
      moved = false;
      pointerStart = { x: event.clientX, y: event.clientY };
      previous = null;
      plane.constant = -target.y - 0.55;
      const point = ray.ray.intersectPlane(plane, new THREE.Vector3());
      offset.copy(root.position).sub(point ?? root.position);
      offset.y = 0;
      host.style.cursor = 'grabbing';
      schedule();
      return true;
    },
    move(event, camera) {
      if (!dragging) return;
      moved ||= Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 3;
      if (!moved) return;
      cast(event, camera);
      const point = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!point) return;
      point.add(offset);
      if (previous) {
        leanX = THREE.MathUtils.clamp(-(point.z - previous.z) * 1.8, -0.18, 0.18);
        leanZ = THREE.MathUtils.clamp((point.x - previous.x) * 1.8, -0.18, 0.18);
      }
      root.position.copy(point);
      previous = point;
      schedule();
    },
    end(event, hit) {
      const rect = host.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      const key = inside && moved ? hit(event.clientX, event.clientY) : null;
      dragging = false;
      if (key) onMove(key);
      land();
    },
    cancel: land,
    deselect: () => select(false),
    render(renderer, camera) {
      if (piece) {
        renderer.clearDepth();
        renderer.render(scene, camera);
      }
    },
    dispose() {
      listeners.abort();
      cancelAnimationFrame(frame);
      host.style.removeProperty('cursor');
      delete host.dataset.partySelected;
      piece?.dispose();
      scene.clear();
    },
  };
}
