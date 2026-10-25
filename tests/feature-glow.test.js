import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  addGlowTiming,
  glowTiming,
  glowPulse,
  installGlowPulse,
} from '../src/rendering/feature-glow.js';

test('individual light timings are stable and pulses vary independently between 40 and 100 percent', () => {
  const source = { kind: 'warm', tile: { key: '1,2' } };
  const timings = [
    new THREE.Vector3(1, 0.4, 2),
    new THREE.Vector3(1.4, 0.4, 2),
    new THREE.Vector3(3, 0.4, 2),
  ].map((position) => glowTiming(source, position));
  assert.equal(new Set(timings.map(({ phase }) => phase)).size, 3);
  assert.equal(new Set(timings.map(({ rate }) => rate)).size, 3);
  assert.deepEqual(timings[0], glowTiming(source, new THREE.Vector3(1, 0.4, 2)));
  for (const timing of timings) {
    const values = Array.from({ length: 601 }, (_, i) => glowPulse(i / 20, timing));
    assert.ok(Math.min(...values) >= 0.4 - 1e-8 && Math.min(...values) < 0.401);
    assert.ok(Math.max(...values) <= 1 + 1e-8 && Math.max(...values) > 0.999);
  }
  assert.ok(Math.abs(glowPulse(3, timings[0]) - glowPulse(3, timings[1])) > 0.1);
});

test('batched glow shaders retain individual timings and share the paused ambient clock', () => {
  const material = new THREE.MeshBasicMaterial(),
    clock = { value: 0 };
  installGlowPulse(material, clock);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.glowTime, clock);
  assert.match(shader.vertexShader, /glowTime \* glowRate \+ glowPhase/);
  assert.match(shader.fragmentShader, /diffuseColor.a \*= vGlowPulse/);
  const geometry = addGlowTiming(new THREE.PlaneGeometry(), { phase: 1.3, rate: 0.8 });
  assert.equal(geometry.attributes.glowPhase.count, geometry.attributes.position.count);
  assert.ok(
    [...geometry.attributes.glowPhase.array].every((phase) => Math.abs(phase - 1.3) < 1e-6),
  );
  clock.value = 12;
  assert.equal(shader.uniforms.glowTime.value, 12);
  geometry.dispose();
  material.dispose();
});
