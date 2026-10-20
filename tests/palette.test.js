import test from 'node:test';
import assert from 'node:assert/strict';
import {
  palettes,
  createColorScale,
  hexToOklch,
  contrastRatio,
  paletteTheme,
} from '../src/palette.js';
import { createMapPalette, materialRoles } from '../src/map-palette.js';

const lightness = (hex) => hexToOklch(hex)[0];
const chroma = (hex) => hexToOklch(hex)[1];
const hueDistance = (a, b) => {
  const difference = hexToOklch(a)[2] - hexToOklch(b)[2];
  return (Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference))) * 180) / Math.PI;
};

test('light green produces visibly lighter ground than dark green; surfaces retain their shading', () => {
  const maps = ['#000000', '#26a269', '#8ff0a4', '#ffffff'].map((ground) =>
    createMapPalette([ground, ...palettes.dusk.slice(1)]),
  );
  assert.ok(lightness(maps[2].role('ground')) - lightness(maps[1].role('ground')) > 0.1);
  for (const map of maps) {
    const L = lightness(map.role('ground'));
    assert.ok(L >= 0.275 && L <= 0.635);
    for (const [role, difference] of [
      ['groundLight', 0.03],
      ['bevel', 0.07],
      ['ridge', 0.04],
      ['ridgeLight', 0.11],
      ['riverShore', -0.04],
    ]) {
      assert.ok(Math.abs(lightness(map.role(role)) - L - difference) < 0.005, role);
    }
    assert.equal(map.role('ground'), map.role('riverGround'));
    assert.equal(map.role('ground'), map.role('ridgeMeadow'));
  }
  const familyRange = (index, role) => {
    const result = ['#000000', '#ffffff'].map((seed) => {
      const seeds = palettes.dusk.slice();
      seeds[index] = seed;
      return lightness(createMapPalette(seeds).role(role));
    });
    return Math.abs(result[1] - result[0]);
  };
  assert.ok(familyRange(0, 'ground') > familyRange(1, 'water'));
  assert.ok(familyRange(1, 'water') > familyRange(2, 'leaf'));
  // The response softens towards the ends instead of clipping large input bands.
  const nearWhite = createMapPalette(['#fafafa', ...palettes.dusk.slice(1)]);
  assert.ok(
    Math.abs(lightness(nearWhite.role('ground')) - lightness(maps[3].role('ground'))) < 0.003,
  );
});

test('presets keep their terrain appearance and dark anchors retain their established colours', () => {
  const golden = {
    dusk: ['#271f38', '#432f05', '#312102'],
    ember: ['#2d1e2e', '#56200b', '#421201'],
    moss: ['#162824', '#38331b', '#28240e'],
  };
  for (const name of Object.keys(golden)) {
    const seeds = palettes[name];
    const map = createMapPalette(seeds);
    const fixed = createColorScale(seeds);
    assert.deepEqual(
      ['side', 'trunk', 'door'].map((role) => map.role(role)),
      golden[name],
    );
    for (const role of ['ground', 'groundLight', 'bevel', 'ridge', 'riverShore']) {
      const [index, L, C] = materialRoles[role];
      const before = fixed(index, L, C);
      assert.ok(Math.abs(lightness(map.role(role)) - lightness(before)) < 0.002);
      assert.ok(hueDistance(map.role(role), before) < 0.5);
    }
  }
  for (const seed of ['#000000', '#ffffff', '#8ff0a4', '#26a269', '#0000ff', '#ff0000']) {
    const seeds = [seed, seed, seed];
    const map = createMapPalette(seeds);
    const fixed = createColorScale(seeds);
    for (const role of ['side', 'trunk', 'door', 'bridgeDark', 'soil', 'riverCliff', 'ridgeDark']) {
      const [index, L, C] = materialRoles[role];
      for (const temperature of [-1, 0, 1])
        assert.equal(map.role(role, temperature), fixed(index, L, C, temperature), role);
    }
  }
});

test('extreme and identical seed combinations preserve terrain, shore, prop, selection and UI separation', () => {
  const colors = [
    '#000000',
    '#ffffff',
    '#888888',
    '#ff0000',
    '#00ff00',
    '#0000ff',
    '#ffff00',
    '#00ffff',
    '#ff00ff',
    '#8ff0a4',
    '#26a269',
  ];
  for (const ground of colors)
    for (const water of colors)
      for (const elements of colors) {
        const seeds = [ground, water, elements];
        const map = createMapPalette(seeds);
        const values = Object.fromEntries(
          Object.keys(materialRoles).map((role) => [role, map.role(role)]),
        );
        for (const hex of Object.values(values)) assert.match(hex, /^#[0-9a-f]{6}$/);
        assert.ok(contrastRatio(values.ground, values.water) >= 1.35, `${seeds}: water`);
        assert.ok(contrastRatio(values.riverShore, values.waterEdge) >= 1.35, `${seeds}: shore`);
        assert.ok(contrastRatio(values.ground, values.leaf) >= 1.5, `${seeds}: foliage`);
        assert.ok(contrastRatio(values.active, values.ground) >= 2.5, `${seeds}: land selection`);
        assert.ok(contrastRatio(values.active, values.water) >= 2.5, `${seeds}: water selection`);
        assert.ok(chroma(values.wall) <= 0.024, `${seeds}: plaster stays nearly neutral`);
        assert.ok(lightness(values.wall) >= 0.85);
        const ui = paletteTheme(seeds);
        assert.ok(contrastRatio(ui.bg, ui.text) >= 4.5, `${seeds}: text`);
        assert.ok(contrastRatio(ui.bg, ui.muted) >= 4.5, `${seeds}: secondary text`);
      }
});

test('gamut fitting retains more saturation without changing intended hue or lightness', () => {
  const seeds = ['#00ff00', '#0000ff', '#ff0000'];
  const fixed = createColorScale(seeds);
  const vivid = createColorScale(seeds, { preserveChroma: true });
  let improved = 0;
  for (let index = 0; index < 3; index++)
    for (const L of [0.3, 0.5, 0.7, 0.85]) {
      const color = vivid(index, L, 1.1);
      assert.ok(Math.abs(lightness(color) - L) < 0.002);
      assert.ok(hueDistance(color, seeds[index]) < 1);
      assert.ok(chroma(color) >= chroma(fixed(index, L, 1.1)) - 0.002);
      improved += chroma(color) > chroma(fixed(index, L, 1.1)) + 0.003;
    }
  assert.ok(improved >= 6);
});

test('settlement plaster is brighter and less colourful than foliage; roofs stay varied and palette-related', () => {
  for (const seeds of Object.values(palettes)) {
    const map = createMapPalette(seeds);
    assert.ok(lightness(map.role('wall')) - lightness(map.role('leaf')) > 0.12);
    assert.ok(chroma(map.role('wall')) < chroma(map.role('leaf')) * 0.3);
    const roofs = [-2, -1, 0, 1, 2].map((tone) => map.role('roof', 1, tone));
    assert.equal(new Set(roofs).size, 5);
    assert.ok(roofs.some((color) => hueDistance(color, roofs[2]) > 35));
    assert.ok(roofs.every((color) => hueDistance(color, roofs[2]) < 125));
    for (const tone of [-2, -1, 0, 1, 2])
      assert.ok(hueDistance(map.role('straw', 1, tone), map.role('straw', 1, 0)) < 10);
  }
  assert.notEqual(
    createMapPalette(palettes.dusk).role('roof', 1, 1),
    createMapPalette(palettes.ember).role('roof', 1, 1),
  );
});
