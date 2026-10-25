import * as THREE from 'three';
import { randomFor } from '../generation/seed.js';

export function glowTiming(source, position) {
  const random = randomFor(
    source.tile.key,
    `${source.kind}:${position
      .toArray()
      .map((value) => value.toFixed(4))
      .join(',')}:glow`,
  );
  return { phase: random() * Math.PI * 2, rate: 0.65 + random() * 0.35 };
}

export const glowPulse = (time, { phase, rate }) => 0.7 + Math.sin(time * rate + phase) * 0.3;

export function addGlowTiming(geometry, { phase, rate }) {
  const count = geometry.attributes.position.count;
  geometry.setAttribute(
    'glowPhase',
    new THREE.Float32BufferAttribute(new Float32Array(count).fill(phase), 1),
  );
  geometry.setAttribute(
    'glowRate',
    new THREE.Float32BufferAttribute(new Float32Array(count).fill(rate), 1),
  );
  return geometry;
}

// Per-emitter timings survive merging, retaining six shared glow draw calls.
export function installGlowPulse(material, time) {
  material.customProgramCacheKey = () => 'feature-glow-pulse-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.glowTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float glowTime;
        attribute float glowPhase;
        attribute float glowRate;
        varying float vGlowPulse;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGlowPulse = 0.7 + sin(glowTime * glowRate + glowPhase) * 0.3;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlowPulse;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= vGlowPulse;',
      );
  };
}
