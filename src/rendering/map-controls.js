import * as THREE from 'three';
import { geometryFrom } from './geometry.js';
import { surfaceHeight } from '../generation/math.js';
import { fitPreviewCamera } from './preview-framing.js';

export function createMapControls({
  host,
  renderer,
  scene,
  map,
  cells,
  materials,
  draw,
  onSelect,
  onHover,
  party,
  touchMultiSelect = false,
}) {
  const listeners = new AbortController();
  const listen = (target, event, handler, options = {}) =>
    target.addEventListener(event, handler, { ...options, signal: listeners.signal });
  const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 180);
  camera.position.set(24, 30, 37);
  camera.lookAt(0, 0.3, 0);
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
    selectionKeys = null,
    hovered = null,
    zoom = 1,
    fitContent = false;
  function showSelection() {
    if (selectionKeys === null) {
      const cell = cells.find((cell) => cell.key === selected);
      activeRing.visible = Boolean(cell);
      if (cell) setRing(activeRing, cell);
      return;
    }
    const points = [];
    const keys = new Set(selectionKeys);
    for (const cell of cells.filter((cell) => keys.has(cell.key))) {
      const geometry = ringGeometry(cell);
      const positions = geometry.attributes.position;
      for (let index = 0; index < positions.count; index++)
        points.push(
          positions.getX(index) + cell.g.position.x,
          positions.getY(index),
          positions.getZ(index) + cell.g.position.z,
        );
      geometry.dispose();
    }
    activeRing.geometry.dispose();
    activeRing.geometry = geometryFrom(points);
    activeRing.position.set(0, 0, 0);
    activeRing.visible = points.length > 0;
  }
  function choose(key, { notify = true, additive = false, fromMap = false } = {}) {
    const cell = cells.find((cell) => cell.key === key);
    if (!cell) return;
    selected = key;
    hoverRing.visible = false;
    if (selectionKeys === null) showSelection();
    if (notify) onSelect(key, { additive, ...(fromMap ? { fromMap } : {}) });
    draw();
  }
  activeRing.visible = false;
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    if (fitContent && fitPreviewCamera(camera, map, w / h)) {
      zoom = 1;
      draw();
      return;
    }
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
  function focus(key) {
    const cell = cells.find((cell) => cell.key === key);
    if (!cell) return false;
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const target = new THREE.Vector3(cell.g.position.x, cell.top, cell.g.position.z);
    const delta = target.sub(camera.position);
    camera.position.addScaledVector(right, delta.dot(right)).addScaledVector(up, delta.dot(up));
    // Show roughly six mesh units vertically; retain an already closer view.
    zoom = Math.min(12, Math.max(zoom, (camera.top - camera.bottom) / 6));
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    draw();
    return true;
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
  let partyPointer = null;
  let longPressTimer,
    longPressed = false,
    gestureMoved = false;
  function cancelLongPress() {
    clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }
  let last = null,
    start = null,
    pinched = false,
    pinchDistance = 0;
  listen(host, 'pointerdown', (e) => {
    if (e.button !== 0) return;
    cancelLongPress();
    if (partyPointer !== null) {
      party.cancel();
      partyPointer = null;
      return;
    }
    if (pointers.size === 0 && party?.start(e, camera)) {
      partyPointer = e.pointerId;
      host.setPointerCapture(e.pointerId);
      return;
    }
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      last = { x: e.clientX, y: e.clientY };
      start = { ...last };
      pinched = false;
      longPressed = false;
      gestureMoved = false;
      const key = touchMultiSelect && e.pointerType === 'touch' ? hit(e.clientX, e.clientY) : null;
      const keys = selectionKeys ?? (selected ? [selected] : []);
      if (key && keys.length && !keys.includes(key)) {
        longPressTimer = setTimeout(() => {
          longPressed = true;
          choose(key, { additive: true, fromMap: true });
        }, 550);
      }
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
    if (partyPointer === e.pointerId) {
      party.move(e, camera);
      return;
    }
    if (pointers.has(e.pointerId)) {
      if (longPressed) return;
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 6) {
        gestureMoved = true;
        cancelLongPress();
      }
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
        hoverRing.visible = !!key && !(selectionKeys ?? [selected]).includes(key);
        if (hoverRing.visible) {
          const c = cells.find((c) => c.key === key);
          setRing(hoverRing, c);
        }
        draw();
      }
    }
  });
  function release(e) {
    cancelLongPress();
    if (partyPointer === e.pointerId) {
      partyPointer = null;
      party.end(e, hit);
      return;
    }
    const wasLast = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (
      wasLast &&
      !pinched &&
      !longPressed &&
      !gestureMoved &&
      start &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6
    ) {
      const key = hit(e.clientX, e.clientY);
      if (key) choose(key, { additive: e.ctrlKey || e.metaKey, fromMap: true });
    }
    last = null;
    start = null;
    if (pointers.size === 1) last = [...pointers.values()][0];
  }
  listen(host, 'pointerup', release);
  listen(host, 'pointercancel', (e) => {
    cancelLongPress();
    if (partyPointer === e.pointerId) {
      partyPointer = null;
      party.cancel();
      return;
    }
    pointers.delete(e.pointerId);
    last = null;
    start = null;
  });
  listen(host, 'contextmenu', (event) => {
    if (longPressTimer !== undefined || longPressed) event.preventDefault();
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
  return {
    camera,
    refresh({ resetView = false, fitContent: fit = false } = {}) {
      fitContent = fit;
      hovered = null;
      onHover(null);
      hoverRing.visible = false;
      if (resetView) {
        zoom = 1;
        camera.position.set(24, 30, 37);
        camera.lookAt(0, 0.3, 0);
      }
      if (selected && cells.some((cell) => cell.key === selected))
        choose(selected, { notify: false });
      if (selectionKeys !== null) showSelection();
      resize();
    },
    cancelInteraction() {
      cancelLongPress();
      for (const id of [...pointers.keys(), partyPointer])
        if (id !== null && host.hasPointerCapture?.(id)) host.releasePointerCapture(id);
      pointers.clear();
      partyPointer = null;
      last = start = null;
      pinched = longPressed = gestureMoved = false;
      party?.cancel();
    },
    select: choose,
    focus,
    setSelection(keys) {
      selectionKeys = keys === null ? null : [...keys];
      showSelection();
      draw();
    },
    zoom: changeZoom,
    dispose() {
      cancelLongPress();
      listeners.abort();
      observer.disconnect();
      for (const ring of [activeRing, hoverRing]) {
        ring.geometry.dispose();
        ring.removeFromParent();
      }
    },
  };
}
