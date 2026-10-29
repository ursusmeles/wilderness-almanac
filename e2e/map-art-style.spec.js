import { test, expect, library } from './fixtures.js';

test.use({ actionTimeout: 15000 });

test('art defaults, live previews and saved campaign choices stay independent', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.locator('#open-settings').click();
  const settings = page.locator('#settings-dialog');
  await expect(
    settings.getByRole('group', { name: 'Default map art style', exact: true }),
  ).toBeVisible();
  await expect(settings.getByRole('radio', { name: 'Low poly', exact: true })).toBeChecked();
  await expect(page.locator('#settings-save')).toBeDisabled();
  await settings.getByRole('radio', { name: 'Pixelart', exact: true }).check();
  await settings.getByRole('radio', { name: 'Movement Off', exact: true }).check();
  await expect(page.locator('#settings-pixelart-warning')).toHaveText(
    'Warning: uses more resources.',
  );
  await page.screenshot({ path: testInfo.outputPath('art-style-settings.png') });
  await page.locator('#settings-save').click();
  await page.locator('#new-campaign').click();
  const creator = page.locator('#create-campaign-dialog');
  await expect(page.locator('#cc-preview-status')).toHaveText('Preview ready.', { timeout: 30000 });
  await expect(creator.getByRole('radio', { name: 'Pixelart', exact: true })).toBeChecked();
  await page.locator('#cc-seed').fill('heliotest');
  await page.locator('#cc-generate').click();
  await expect(page.locator('#cc-scene')).toHaveAttribute('data-seed', 'heliotest');
  await expect(page.locator('#cc-preview-status')).toHaveText('Preview ready.');
  await creator.getByRole('radio', { name: 'Low poly', exact: true }).check();
  await expect(page.locator('#cc-scene canvas')).toHaveAttribute('data-art-style', 'low-poly');
  await expect(page.locator('#cc-generate')).toBeDisabled();
  await creator.getByRole('radio', { name: 'Pixelart', exact: true }).check();
  await expect(page.locator('#cc-scene canvas')).toHaveAttribute('data-art-style', 'pixelart');
  await expect(page.locator('#cc-scene')).toHaveAttribute('data-seed', 'heliotest');
  await page.screenshot({ path: testInfo.outputPath('art-style-creator.png') });
  await page.locator('#cc-name').fill('Pixelart choice');
  await page.locator('#cc-create').click();
  await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-art-style', 'pixelart');
  await expect
    .poll(
      async () =>
        (await library(page)).campaigns.find((c) => c.name === 'Pixelart choice')?.artStyle,
    )
    .toBe('pixelart');
  await page.locator('#hp-back-menu').click();
  await page.locator('#open-settings').click();
  await settings.getByRole('radio', { name: 'Low poly', exact: true }).check();
  await page.locator('#settings-save').click();
  await page.getByRole('button', { name: 'Enter Pixelart choice', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-art-style', 'pixelart');
  await page.locator('#hp-back-menu').click();
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-art-style', 'low-poly');
  await page.locator('#hp-back-menu').click();
  await page.locator('#new-campaign').click();
  await expect(creator.getByRole('radio', { name: 'Low poly', exact: true })).toBeChecked();
  await expect(page.locator('#cc-scene canvas')).toHaveAttribute('data-art-style', 'low-poly');
});
