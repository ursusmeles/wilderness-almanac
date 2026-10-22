import * as THREE from 'three';

// Fit actual mesh vertices in camera space, including raised bases and tall props.
export function fitPreviewCamera(camera, root, aspect, padding = 1.08) {
  root.updateWorldMatrix(true, true);
  camera.updateMatrixWorld();
  const bounds = new THREE.Box3();
  const transform = new THREE.Matrix4();
  const point = new THREE.Vector3();
  root.traverseVisible((object) => {
    const positions = object.isMesh && object.geometry.attributes.position;
    if (!positions) return;
    transform.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(transform);
      bounds.expandByPoint(point);
    }
  });
  if (bounds.isEmpty()) return false;
  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  camera.position.addScaledVector(right, centre.x).addScaledVector(up, centre.y);
  const halfHeight = Math.max(size.y / 2, size.x / (2 * aspect), 0.01) * padding;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.zoom = 1;
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return true;
}
