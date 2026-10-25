import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { worldPosition } from '../src/generation/hex.js';
import {
  BEAM_LENGTH,
  LANDING_RADIUS,
  lighthouseSweep,
  sweepTarget,
  softenBeamEnd,
} from '../src/rendering/lighthouse-beams.js';

function coast() {
  const cells = [];
  for (let q = -4; q <= 4; q++)
    for (let r = -4; r <= 4; r++) {
      const { wx } = worldPosition({ q, r });
      cells.push({
        key: `${q},${r}`,
        q,
        r,
        top: wx > 0.9 ? 0.2 : 0.5,
        terrain: wx > 0.9 ? 'open water' : 'meadow',
      });
    }
  return cells;
}

// Independent nearest-centre lookup checks the interpolated path, not only its samples.
function cellAt(cells, x, z) {
  return cells.toSorted((a, b) => {
    const pa = worldPosition(a),
      pb = worldPosition(b);
    return Math.hypot(pa.wx - x, pa.wz - z) - Math.hypot(pb.wx - x, pb.wz - z);
  })[0];
}

test('open sea permits a multi-hex arc at approximately two hexes of reach', () => {
  const origin = new THREE.Vector3(0, 0.8, 0.05),
    cells = coast(),
    saved = JSON.stringify(cells);
  const sweep = lighthouseSweep(origin, cells);
  assert.ok(sweep[0].distanceTo(sweep.at(-1)) > Math.sqrt(3) * 2);
  assert.ok(
    Math.abs(
      Math.hypot(sweepTarget(sweep, 0.5).x, sweepTarget(sweep, 0.5).z - origin.z) - BEAM_LENGTH,
    ) < 0.02,
  );
  assert.equal(JSON.stringify(cells), saved);
});

test('wide sweeps and round water landings avoid islands and undiscovered water', () => {
  for (const obstruction of ['meadow', 'hidden']) {
    const cells = coast();
    const blocked = cells.find(({ key }) => key === '2,0');
    if (obstruction === 'hidden') blocked.fogState = 'undiscovered';
    else blocked.terrain = 'meadow';
    const origin = new THREE.Vector3(0, 0.8, 0.05),
      sweep = lighthouseSweep(origin, cells);
    assert.ok(sweep);
    for (let i = 0; i <= 120; i++) {
      const end = sweepTarget(sweep, i / 120);
      for (let side = 0; side < 12; side++) {
        const a = (side * Math.PI) / 6;
        const cell = cellAt(
          cells,
          end.x + Math.cos(a) * LANDING_RADIUS,
          end.z + Math.sin(a) * LANDING_RADIUS,
        );
        assert.equal(cell.terrain, 'open water');
        assert.notEqual(cell.fogState, 'undiscovered');
      }
      for (let step = 1; step <= 48; step++) {
        const p = origin.clone().lerp(end, step / 48),
          cell = cellAt(cells, p.x, p.z);
        assert.notEqual(cell.fogState, 'undiscovered');
        assert.notEqual(cell.key, blocked.key);
      }
    }
  }
});

test('the lighthouse shaft fades before the round landing instead of ending with a hard cut', () => {
  const material = new THREE.MeshBasicMaterial();
  softenBeamEnd(material);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  };
  material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /vBeamProgress = -position.y/);
  assert.match(shader.fragmentShader, /1.0 - smoothstep\(0.72, 1.0, vBeamProgress\)/);
  material.dispose();
});
