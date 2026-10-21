import { readFile } from 'node:fs/promises';
import { test, expect, campaign, library, openCampaign, exportFromMenu } from './fixtures.js';

test('homepage never requests WebGL code, and cached icons survive reload without loading it', async ({
  page,
}, testInfo) => {
  const scripts = [];
  const scriptResponses = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script') scriptResponses.push(response);
  });
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('.campaign-card')).toHaveCount(1);
  await expect(page.locator('.campaign-icon-placeholder')).toBeVisible();
  expect(scripts.some((url) => url.includes('map-view-'))).toBe(false);
  const initialBytes = (
    await Promise.all(scriptResponses.map(async (response) => (await response.body()).length))
  ).reduce((sum, bytes) => sum + bytes, 0);
  expect(initialBytes, 'homepage JavaScript remains below the 200 KB budget').toBeLessThan(200000);
  const screenshot = testInfo.outputPath('homepage.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('Homepage before map loading', {
    path: screenshot,
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  expect(scripts.some((url) => url.includes('map-view-'))).toBe(true);
  await page.locator('#hp-return-menu').click();
  await expect(page.locator('.campaign-icon img')).toBeVisible();
  await expect(page.locator('.campaign-icon img')).toHaveAttribute('src', /^data:image\/png/);
  scripts.length = 0;
  await page.reload();
  await expect(page.locator('.campaign-icon img')).toBeVisible();
  expect(scripts.some((url) => url.includes('map-view-'))).toBe(false);
});

test('icon refresh cycles prepared previews and wraps without loading WebGL on the menu', async ({
  page,
}) => {
  await openCampaign(page);
  await page.locator('#hp-return-menu').click();
  const card = page.locator('.campaign-card');
  const image = card.locator('.campaign-icon img');
  await card.locator('[data-action="icon-controls"]').click();
  const next = card.locator('[data-action="shuffle"]');
  await expect(next).toBeEnabled();
  const count = await card.evaluate((element) => element.iconEntries.length);
  expect(count).toBeGreaterThanOrEqual(8);
  expect(count).toBeLessThanOrEqual(9);
  const first = await image.getAttribute('data-hex-key');
  const seen = new Set([first]);
  for (let i = 0; i < count; i++) {
    const before = await image.getAttribute('data-hex-key');
    await next.click();
    await expect(image).toBeVisible();
    await expect(card.locator('.campaign-icon-placeholder')).toBeHidden();
    await expect(image).not.toHaveAttribute('data-hex-key', before);
    seen.add(await image.getAttribute('data-hex-key'));
  }
  expect(seen.size).toBe(count);
  await expect(image).toHaveAttribute('data-hex-key', first);
  await next.click();
  const chosen = await image.getAttribute('data-hex-key');
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.reload();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('data-hex-key', chosen);
  expect(requests.some((url) => url.includes('map-view-'))).toBe(false);
});

test('Inspector can set a water hex as world icon and keep it after returning and reloading', async ({
  page,
}) => {
  await openCampaign(page);
  const key = await page
    .locator('#hp-selection option')
    .evaluateAll(
      (options) => options.find((option) => /Open water|Lake/.test(option.textContent)).value,
    );
  await page.locator('#hp-selection').selectOption(key);
  const setIcon = page.getByRole('button', { name: 'Set as world icon', exact: true });
  await setIcon.click();
  await expect(setIcon).toBeDisabled();
  expect((await library(page)).campaigns[0].iconKey).toBe(key);
  await page.locator('#hp-return-menu').click();
  const image = page.locator('.campaign-icon img');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('data-hex-key', key);
  await page.reload();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('data-hex-key', key);
});

test('New Map replaces one campaign, retains its name/identity and preserves zoom', async ({
  page,
}) => {
  await openCampaign(page);
  const before = (await library(page)).campaigns[0];
  const zoom = await page.locator('#hp-scene canvas').getAttribute('data-zoom');
  await page.getByRole('button', { name: 'New map settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Map seed', exact: true }).fill('browser replacement');
  await page.getByRole('button', { name: 'Create map', exact: true }).click();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute(
    'data-seed',
    'browser replacement',
  );
  const after = await library(page);
  expect(after.campaigns).toHaveLength(1);
  expect(after.campaigns[0]).toMatchObject({
    id: before.id,
    name: before.name,
    createdAt: before.createdAt,
    seed: 'browser replacement',
  });
  await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-zoom', zoom);
});

test('campaign JSON export/import preserves edits and creates an independent save', async ({
  page,
}) => {
  await openCampaign(page);
  await page.getByRole('switch', { name: 'Visited', exact: true }).click();
  await page.getByRole('switch', { name: 'Lock hex dressing', exact: true }).click();
  await page.locator('#hp-return-menu').click();
  const download = await exportFromMenu(page);
  expect(download.suggestedFilename()).toMatch(/^wilderness-almanac-test-campaign-\d{4}-\d{2}-\d{2}\.json$/);
  const source = await readFile(await download.path(), 'utf8');
  const exported = JSON.parse(source).campaign;
  expect(exported.hexEdits.cells['0,0'].visited).toBe(true);
  expect(exported.hexEdits.cells['0,0'].lock.props.length).toBeGreaterThan(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import campaign', exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: 'campaign.json', mimeType: 'application/json', buffer: Buffer.from(source) });
  await expect(page.locator('.campaign-card')).toHaveCount(2);
  const records = (await library(page)).campaigns;
  expect(records[1].id).not.toBe(records[0].id);
  expect(records[1].hexEdits).toEqual(exported.hexEdits);
  await page.reload();
  await expect(page.locator('.campaign-card')).toHaveCount(2);
});

test('unapplied edits can be kept or applied before changing selection; Undo restores the terrain', async ({
  page,
}) => {
  await openCampaign(page);
  await page.getByRole('button', { name: 'Edit hex', exact: true }).click();
  await page.getByRole('combobox', { name: 'Terrain', exact: true }).selectOption('meadow');
  await page.getByRole('combobox', { name: 'Selected hex', exact: true }).selectOption('1,0');
  const dialog = page.getByRole('dialog', { name: 'Unapplied hex changes', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('#hp-selection')).toHaveValue('0,0');
  await expect(page.getByRole('combobox', { name: 'Terrain', exact: true })).toHaveValue('meadow');
  await page.locator('#hp-selection').selectOption('1,0');
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.locator('#hp-selection')).toHaveValue('1,0');
  expect((await library(page)).campaigns[0].hexEdits.cells['0,0'].terrain).toBe('meadow');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await library(page)).campaigns[0].hexEdits).toBeUndefined();
});

test('leaving the map protects a draft and map replacement confirms clearing saved edits', async ({
  page,
}) => {
  await openCampaign(page);
  await page.getByRole('button', { name: 'Edit hex', exact: true }).click();
  await page.getByRole('combobox', { name: 'Terrain', exact: true }).selectOption('meadow');
  await page.locator('#hp-return-menu').click();
  const dialog = page.getByRole('dialog', { name: 'Unapplied hex changes', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('#campaign-menu')).toBeVisible();
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await page.getByRole('switch', { name: 'Visited', exact: true }).click();
  await page.getByRole('button', { name: 'New Map', exact: true }).click();
  const replace = page.getByRole('dialog', { name: 'Replace this world?', exact: true });
  await expect(replace).toBeVisible();
  await replace.getByRole('button', { name: 'Keep world', exact: true }).click();
  expect((await library(page)).campaigns[0].seed).toBe('7');
  await page.getByRole('button', { name: 'New Map', exact: true }).click();
  await replace.getByRole('button', { name: 'Create new map', exact: true }).click();
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('data-seed', '7');
  expect((await library(page)).campaigns[0].hexEdits).toBeUndefined();
});

test('storage errors remain visible, exports contain unsaved changes, and successful retries clear the warning', async ({
  page,
}, testInfo) => {
  await openCampaign(page);
  await page.evaluate(() => sessionStorage.setItem('test:blocked-target', 'all'));
  await page.getByRole('switch', { name: 'Visited', exact: true }).click();
  await expect(page.locator('#hp-save-warning')).toBeVisible();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open palette and settings', exact: true }).click();
  await page.getByRole('button', { name: 'Copy seed', exact: true }).click();
  await expect(page.locator('#hp-save-warning')).toBeVisible();
  expect((await library(page)).campaigns[0].hexEdits).toBeUndefined();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download campaign', exact: true }).click();
  const exported = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(exported.campaign.hexEdits.cells['0,0'].visited).toBe(true);
  await page.evaluate(() => sessionStorage.removeItem('test:blocked-target'));
  await page.getByRole('switch', { name: 'Visited', exact: true }).click();
  await expect(page.locator('#hp-save-warning')).toBeHidden();
  expect((await library(page)).campaigns[0].hexEdits.cells['0,0'].visited).toBe(false);
});

test('unreadable saved records survive normal campaign actions and recovery download', async ({
  page,
}) => {
  await page.goto('/');
  const future = {
    ...campaign,
    id: 'future',
    generatorVersion: 99,
    futureData: { notes: ['keep me'] },
  };
  await page.evaluate((future) => {
    const saved = JSON.parse(localStorage.getItem('wilderness-almanac:campaigns-v1'));
    saved.campaigns.push(future);
    localStorage.setItem('wilderness-almanac:campaigns-v1', JSON.stringify(saved));
  }, future);
  await page.reload();
  await expect(page.locator('#campaign-recovery')).toBeVisible();
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await page.getByRole('switch', { name: 'Visited', exact: true }).click();
  await page.locator('#hp-return-menu').click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download recovery file', exact: true }).click();
  const recovered = JSON.parse(await readFile(await (await event).path(), 'utf8'));
  expect(recovered.campaigns.find((record) => record.id === 'future')).toEqual(future);
});

test('mobile panels follow a viewport-height map and restore correctly after expansion', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile layout');
  await openCampaign(page);
  const dimensions = await page.evaluate(() => {
    const map = document.querySelector('.hp-map-panel').getBoundingClientRect();
    const inspector = document.querySelector('.hp-inspector-panel').getBoundingClientRect();
    const tracker = document.querySelector('.hp-tracker-panel').getBoundingClientRect();
    return {
      height: map.height,
      viewport: innerHeight,
      inspectorTop: inspector.top,
      mapBottom: map.bottom,
      trackerTop: tracker.top,
      inspectorBottom: inspector.bottom,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(dimensions.height).toBe(dimensions.viewport);
  expect(dimensions.inspectorTop).toBeGreaterThanOrEqual(dimensions.mapBottom);
  expect(dimensions.trackerTop).toBeGreaterThanOrEqual(dimensions.inspectorBottom);
  expect(dimensions.overflow).toBe(false);
  await page.getByRole('button', { name: 'Expand map to viewport', exact: true }).click();
  await expect(page.locator('.hp-side-panels')).toBeHidden();
  await page.getByRole('button', { name: 'Exit expanded map', exact: true }).click();
  await expect(page.locator('.hp-side-panels')).toBeVisible();
  await page.getByRole('button', { name: 'Minimise Hex Inspector', exact: true }).click();
  await expect(page.locator('#hp-inspector-body')).toBeHidden();
  await page.getByRole('button', { name: 'Expand Hex Inspector', exact: true }).click();
  await expect(page.locator('#hp-inspector-body')).toBeVisible();
});
