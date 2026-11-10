import { test, expect } from '@playwright/test';

test('library theme controls persist, match Settings icon size and synchronise across tabs', async ({
  page,
  context,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('wilderness-almanac:ui-v1', JSON.stringify({ version: 1, motion: false }));
  });
  await page.goto('/');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.locator('.campaign-toolbar-actions [data-theme-toggle]').click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');

  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await other.locator('#app-footer [data-theme-toggle]').click();
  await expect(root).toHaveAttribute('data-theme', 'dark');

  await other.locator('#app-footer [data-theme-toggle]').click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  for (const icon of await page.locator('[data-theme-toggle] .ui-icon').all())
    await expect(icon).toHaveCSS('width', '16px');
  await page.locator('.campaign-toolbar-actions [data-theme-toggle]').click();
  for (const icon of await page.locator('[data-theme-toggle] use').all())
    await expect(icon).toHaveAttribute('href', '/icons/pixelarticons.svg#lightbulb');
  await expect(page.locator('#app-footer [data-theme-label]')).toHaveText('Light mode');
  expect(errors).toEqual([]);
});

test('restricted theme storage still allows an in-memory manual switch', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    const write = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'wilderness-theme') throw new DOMException('Blocked', 'SecurityError');
      return read.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'wilderness-theme') throw new DOMException('Blocked', 'SecurityError');
      return write.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.locator('.campaign-toolbar-actions [data-theme-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
