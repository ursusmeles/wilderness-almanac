import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld, generateDressing } from '../src/generation/world.js';
import { prepareMap } from '../src/generation/presentation.js';
import {
  createCampaign,
  validateCampaign,
  exportCampaign,
  importCampaign,
  findCampaignReplay,
  replaceCampaignMap,
} from '../src/application/campaigns.js';
import { mapArtStyle } from '../src/application/map-art-style.js';
import { readUIPreferences, saveUIPreferences } from '../src/ui/ui-preferences.js';
import { mapLink, readMapLink } from '../src/ui/map-link.js';
import { saveThumbnails, loadThumbnails } from '../src/ui/thumbnail-cache.js';
import { createMapMaterials } from '../src/rendering/map-materials.js';
import { createMapMeshes } from '../src/rendering/map-meshes.js';

const world = generateWorld('heliotest');
const colors = ['#282039', '#237d89', '#e5b96e'];
const low = createCampaign(world, colors, 'Custom');
const pixel = createCampaign(world, colors, 'Custom', 0, 'dawn', 'pixelart');

test('new campaigns default to Low poly and art choice survives save/import/replacement', () => {
  assert.equal(low.artStyle, 'low-poly');
  for (const campaign of [low, pixel]) {
    assert.equal(importCampaign(exportCampaign(campaign)).artStyle, campaign.artStyle);
    assert.equal(replaceCampaignMap(campaign, world).artStyle, campaign.artStyle);
  }
  const { artStyle: _style, ...legacy } = low;
  assert.equal(mapArtStyle(validateCampaign(legacy).artStyle), 'low-poly');
  assert.deepEqual(
    importCampaign(exportCampaign(legacy)),
    legacy,
    'legacy records retain their hashes',
  );
  for (const artStyle of ['', 'Low poly', 'voxel', null, {}, 1])
    assert.throws(() => validateCampaign({ ...low, artStyle }), /invalid campaign data/);
});

test('default art preference is validated separately and does not alter saved campaigns', () => {
  let value;
  const storage = {
    getItem: () => value,
    setItem: (_, next) => {
      value = next;
    },
  };
  saveUIPreferences(storage, { defaultMapArtStyle: 'pixelart' });
  assert.equal(readUIPreferences(storage).defaultMapArtStyle, 'pixelart');
  assert.equal(low.artStyle, 'low-poly');
  saveUIPreferences(storage, { defaultMapArtStyle: 'invalid' });
  assert.equal(readUIPreferences(storage).defaultMapArtStyle, undefined);
});

test('share links and replay matching distinguish art styles on the same map', () => {
  const link = mapLink('https://example.com/?keep=yes', pixel);
  assert.equal(readMapLink(link).artStyle, 'pixelart');
  assert.equal(new URL(link).searchParams.get('keep'), 'yes');
  assert.equal(new URL(mapLink(link, low)).searchParams.has('art'), false);
  assert.equal(findCampaignReplay([low, pixel], pixel).id, pixel.id);
  assert.equal(findCampaignReplay([pixel, low], low).id, low.id);
});

test('stale thumbnail fallback never crosses art styles', async () => {
  const images = [{ key: '0,0', image: 'data:image/png;base64,art' }];
  await saveThumbnails(low, images);
  const changed = { ...low, artStyle: 'pixelart' };
  assert.deepEqual(await loadThumbnails(changed, { allowStale: true }), []);
  await saveThumbnails(changed, images);
  assert.deepEqual(await loadThumbnails(changed), images);
  assert.deepEqual(await loadThumbnails(low, { allowStale: true }), []);
});

function digest(group) {
  const hash = createHash('sha256');
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    for (const attribute of Object.values(mesh.geometry.attributes))
      hash.update(Buffer.from(attribute.array.buffer));
    if (mesh.geometry.index) hash.update(Buffer.from(mesh.geometry.index.array.buffer));
    hash.update(JSON.stringify(mesh.userData));
  });
  return hash.digest('hex');
}

test('switching campaign art preserves controls references, low-poly geometry and resource ownership', () => {
  const registry = createMapMaterials(),
    meshes = createMapMeshes(registry);
  const layout = prepareMap(world, generateDressing(world, 0));
  const group = meshes.group,
    cells = meshes.cells;
  try {
    meshes.setMap(layout);
    const original = digest(meshes.group);
    meshes.setMap(layout, { artStyle: 'pixelart' });
    assert.notEqual(digest(meshes.group), original);
    const resources = new Set();
    meshes.group.traverse((mesh) => {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        if (material?.map) {
          resources.add(material);
          resources.add(material.map);
        }
    });
    assert.ok(resources.size > 0);
    const released = new Map([...resources].map((resource) => [resource, 0]));
    for (const resource of resources)
      resource.addEventListener('dispose', () =>
        released.set(resource, released.get(resource) + 1),
      );
    meshes.setMap(layout, { artStyle: 'low-poly' });
    registry.releasePixelMaterials();
    assert.equal(meshes.group, group);
    assert.equal(meshes.cells, cells);
    assert.equal(digest(meshes.group), original);
    assert.ok([...released.values()].every((count) => count === 1));
    meshes.setMap(layout, { artStyle: 'pixelart' });
    assert.notEqual(digest(meshes.group), original, 'disposed pixel resources rebuild on demand');
  } finally {
    meshes.dispose();
    registry.dispose();
  }
});
