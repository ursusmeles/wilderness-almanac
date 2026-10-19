export function windWeight(height, { height: reach = 0.8, strength = 1 } = {}) {
  return Math.min(1, Math.max(0, height / reach)) ** 2 * strength;
}

export function installTreeSway(material, time) {
  material.userData.treeSway = true;
  material.customProgramCacheKey = () => 'hex-tree-sway-v2';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.ambientTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
      #include <common>
      uniform float ambientTime;
      attribute float swayWeight;
    `,
      )
      .replace(
        '#include <begin_vertex>',
        `
      #include <begin_vertex>
      float cycle = mod(ambientTime, 24.0) / 24.0;
      float angle = ambientTime * 1.0471975512;
      float phase = position.x * 0.15 + position.z * 0.1;
      float gust = smoothstep(0.28, 0.31, cycle) * (1.0 - smoothstep(0.35, 0.39, cycle));
      transformed.x += (sin(angle + phase) * 0.066
        + gust * (0.165 + sin(angle * 2.0 + phase) * 0.03)) * swayWeight;
      transformed.z += (cos(angle + phase) * 0.036
        + gust * 0.06) * swayWeight;
    `,
      );
  };
}

export function installWaveDrift(material, time, direction) {
  material.customProgramCacheKey = () => 'hex-wave-drift-v2';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.ambientTime = time;
    shader.uniforms.waveDirection = direction;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
      #include <common>
      uniform float ambientTime;
      uniform vec2 waveDirection;
      attribute float wavePhase;
      varying float waveFade;
    `,
      )
      .replace(
        '#include <begin_vertex>',
        `
      #include <begin_vertex>
      float travel = fract(ambientTime / 14.0 + wavePhase);
      transformed.xz += waveDirection * ((travel - 0.5) * 0.46);
      waveFade = smoothstep(0.0, 0.16, travel) * (1.0 - smoothstep(0.78, 1.0, travel));
    `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
      #include <common>
      varying float waveFade;
    `,
      )
      .replace(
        '#include <color_fragment>',
        `
      #include <color_fragment>
      diffuseColor.a *= waveFade;
    `,
      );
  };
}
