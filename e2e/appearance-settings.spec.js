import { test, expect } from '@playwright/test';

const open = (page) => page.getByRole('button', { name: 'Appearance', exact: true }).click();
const choose = (page, group, value) =>
  page.locator(`#settings-${group} input[value="${value}"]`).check();
const savedUI = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('wilderness-almanac:ui-v1')));

async function enter(page, variant = 0) {
  await page.goto(`/?seed=heliotest&generator=10&variant=${variant}`);
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
}
async function alphaAtCorner(image) {
  return image.evaluate(async (img) => {
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
}

test('campaign settings stage changes, persist separately and keep the fixed appearance bar', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enter(page);
  expect(await alphaAtCorner(page.locator('#hp-find-party-preview'))).toBe(0);
  const before = await page.locator('#hp-scene canvas').evaluate((x) => x.clientHeight);
  await expect(page.locator('#hp-toggle-settings')).toHaveCount(0);
  await expect(page.locator('#hp-preset option[value="save-new"]')).toHaveCount(0);
  await open(page);
  await expect(page.locator('#settings-title')).toHaveText('Appearance');
  await expect(page.locator('#settings-import-group')).toBeHidden();
  await expect(page.locator('#settings-regenerate')).toBeVisible();
  await expect(page.locator('#settings-save')).toBeDisabled();
  await choose(page, 'theme', 'light');
  await page.locator('#settings-cancel').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await open(page);
  await choose(page, 'theme', 'light');
  await choose(page, 'motion', 'false');
  await choose(page, 'panel-order', 'tracker');
  await choose(page, 'time-increment', 'day');
  await choose(page, 'time', 'night');
  await choose(page, 'art-style', 'pixelart');
  await page.locator('#settings-palette').selectOption('moss');
  await page.locator('#settings-save').click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-art-style', 'pixelart');
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-time-of-day', 'night');
  await expect(page.locator('#hp-preset')).toHaveValue('moss');
  expect(await page.locator('#hp-scene canvas').evaluate((x) => x.clientHeight)).toBe(before);
  const prefs = await savedUI(page),
    id = Object.keys(prefs.campaignSettings)[0];
  expect(prefs.campaignSettings[id]).toEqual({
    motion: false,
    journalFirst: true,
    timeIncrement: 'day',
  });
  expect(prefs.motion).toBe(true);
  expect(prefs.timeIncrement).toBe('week');
  expect(prefs.journalFirst).toBe(false);
  expect(await alphaAtCorner(page.locator('#hp-find-party-preview'))).toBe(0);
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open Inspector', exact: true }).click();
  expect(await alphaAtCorner(page.locator('#hp-hex-preview'))).toBe(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await open(page);
  await expect(page.locator('#settings-motion input[value="false"]')).toBeChecked();
  await page.locator('#settings-cancel').click();
  await page.locator('#hp-back-menu').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-palette')).toHaveValue('classic');
  await expect(page.locator('#settings-time input[value="dawn"]')).toBeChecked();
  await expect(page.locator('#settings-art-style input[value="low-poly"]')).toBeChecked();
  await expect(page.locator('#settings-motion input[value="true"]')).toBeChecked();
  await expect(page.locator('#settings-import-group')).toBeVisible();
  await page.locator('#settings-cancel').click();
  await enter(page, 2);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await open(page);
  await expect(page.locator('#settings-time-increment input[value="week"]')).toBeChecked();
  await page.locator('#settings-cancel').click();
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.width);
  expect(errors).toEqual([]);
});

test('built-in swatches create editable copies and campaign palette selection leaves defaults intact', async ({
  page,
}) => {
  await enter(page);
  await open(page);
  await page.locator('#open-palette-manager').click();
  await expect(page.locator('#default-palette')).toHaveText('Use palette');
  const row = page.locator('.palette-row[data-id="forbidden"]');
  const swatch = row.locator('input[type="color"]').first();
  const original = await swatch.inputValue();
  await swatch.evaluate((x) => {
    x.value = '#abcdef';
    x.dispatchEvent(new Event('input', { bubbles: true }));
    x.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(row.locator('input[type="color"]').first()).toHaveValue(original);
  const copy = page.locator('.palette-row.is-custom').last();
  await expect(copy.locator('input[type="color"]').first()).toHaveValue('#abcdef');
  const id = await copy.getAttribute('data-id');
  await copy
    .locator('input[type="color"]')
    .nth(1)
    .evaluate((x) => {
      x.value = '#123456';
      x.dispatchEvent(new Event('input', { bubbles: true }));
      x.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await expect(page.locator('.palette-row.is-custom')).toHaveCount(1);
  await page.locator('#close-palette-manager').click();
  await expect(page.locator('#settings-palette')).toHaveValue(id);
  await page.locator('#settings-save').click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.locator('#hp-preset')).toHaveValue(id);
  await page.locator('#hp-back-menu').click();
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-palette')).toHaveValue('classic');
});

test('regeneration lives in the campaign dialog and remains blocked by fog', async ({ page }) => {
  await enter(page);
  const initial = await page.locator('#campaign-workspace').getAttribute('data-variant');
  await open(page);
  await page.locator('#settings-regenerate').click();
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('data-variant', initial);
  await page.locator('#settings-cancel').click();
  await page.locator('#hp-fog').click();
  await open(page);
  await expect(page.locator('#settings-regenerate')).toBeDisabled();
});
