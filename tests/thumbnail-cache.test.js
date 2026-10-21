import test from 'node:test';
import assert from 'node:assert/strict';
import { loadThumbnails, saveThumbnails } from '../src/ui/thumbnail-cache.js';

const campaign = {
  id: 'gallery',
  generatorVersion: 6,
  seed: 'gallery',
  variant: 0,
  colors: ['#cdab8f', '#0b365e', '#11b329'],
  iconKey: '0,0',
};
const images = Array.from({ length: 8 }, (_, i) => ({
  key: `${i},0`,
  image: `data:image/png;base64,${i}`,
}));

test('thumbnail galleries survive unavailable IndexedDB and do not depend on the selected icon', async () => {
  // Node has no IndexedDB: use the same session fallback as blocked browser storage.
  assert.equal(await saveThumbnails(campaign, images), false);
  assert.deepEqual(await loadThumbnails({ ...campaign, iconKey: '1,0', name: 'Renamed' }), images);
  assert.deepEqual(
    await loadThumbnails({
      ...campaign,
      hexEdits: { version: 1, cells: { '0,0': { visited: true } } },
    }),
    images,
  );
  for (const changed of [
    { variant: 1 },
    { id: 'another-campaign' },
    { colors: ['#000000', '#000000', '#000000'] },
    { hexEdits: { version: 1, cells: { '0,0': { terrain: 'mountains' } } } },
  ])
    assert.deepEqual(await loadThumbnails({ ...campaign, ...changed }), []);
});

test('appearance changes retain the last preview until fresh renders replace it', async () => {
  const changed = { ...campaign, colors: ['#111111', '#222222', '#333333'] };
  assert.deepEqual(await loadThumbnails(changed), []);
  assert.deepEqual(await loadThumbnails(changed, { allowStale: true }), images);
  assert.deepEqual(
    await loadThumbnails({ ...changed, seed: 'replacement' }, { allowStale: true }),
    [],
  );
  const updated = images.map((entry) => ({ ...entry, image: 'data:image/png;base64,updated' }));
  await saveThumbnails(changed, updated);
  assert.deepEqual(await loadThumbnails(changed), updated);
  assert.deepEqual(await loadThumbnails(campaign, { allowStale: true }), updated);
});

test('cache budgets whole campaigns rather than evicting after four galleries', async () => {
  const custom = [...images, { key: '0,1', image: 'data:image/png;base64,custom' }];
  for (let i = 0; i < 5; i++) await saveThumbnails({ ...campaign, id: `gallery-${i}` }, custom);
  assert.deepEqual(await loadThumbnails({ ...campaign, id: 'gallery-0', iconKey: '0,1' }), custom);
  // Repeated palette/dressing changes occupy one record per campaign.
  for (let variant = 0; variant < 40; variant++)
    await saveThumbnails({ ...campaign, variant }, images);
  assert.deepEqual(await loadThumbnails({ ...campaign, id: 'gallery-0' }), custom);
  for (let i = 5; i < 37; i++) await saveThumbnails({ ...campaign, id: `gallery-${i}` }, images);
  assert.deepEqual(await loadThumbnails({ ...campaign, id: 'gallery-0' }), []);
  assert.deepEqual(await loadThumbnails({ ...campaign, id: 'gallery-36' }), images);
});
