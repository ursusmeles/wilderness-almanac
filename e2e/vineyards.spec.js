import { test, expect, openCampaign, library } from './fixtures.js';

test('single and batch editors offer vineyards, preserve saves and allow regeneration', async ({
  page,
}) => {
  await openCampaign(page);
  await page.locator('#hp-hex-edit').click();
  const terrain = page.locator('#hp-hex-terrain');
  const options = await terrain
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => node.value));
  expect(options[options.indexOf('farmlands') + 1]).toBe('vineyards');
  await terrain.selectOption('vineyards');
  await page.locator('#hp-hex-elevation').selectOption('0');
  await page.locator('#hp-hex-settlement').selectOption('');
  await page.locator('#hp-hex-poi').selectOption('');
  await page.locator('#hp-hex-apply').click();
  await expect(terrain).toHaveValue('vineyards');
  await expect
    .poll(async () => (await library(page)).campaigns[0].hexEdits?.cells['0,0']?.cropStyle)
    .toBe('vineyard');
  await page.locator('#hp-hex-regenerate').click();
  await expect(terrain).toHaveValue('farmlands');
  await expect
    .poll(async () => (await library(page)).campaigns[0].hexEdits?.cells['0,0']?.cropStyle)
    .toBeUndefined();
  await page.locator('#hp-hex-multi-edit').click();
  await page.locator('#hp-selection').selectOption('1,0');
  await expect(page.locator('#hp-batch-count')).toHaveText('2 hexes selected');
  await page.locator('#hp-batch-terrain').selectOption('vineyards');
  await page.locator('#hp-batch-elevation').selectOption('1');
  await page.locator('#hp-batch-settlement').selectOption('');
  await page.locator('#hp-batch-poi').selectOption('');
  await page.locator('#hp-batch-apply').click();
  for (const key of ['0,0', '1,0']) {
    await expect
      .poll(async () => (await library(page)).campaigns[0].hexEdits?.cells[key]?.cropStyle)
      .toBe('vineyard');
  }
  await page.locator('#hp-batch-off').click();
  await expect(terrain).toHaveValue('vineyards');
  await page.reload();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await page.locator('#hp-selection').selectOption('0,0');
  await expect(terrain).toHaveValue('vineyards');
});
