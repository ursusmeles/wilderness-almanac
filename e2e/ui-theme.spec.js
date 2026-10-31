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
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');

  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await other.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');

  await other.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('[data-theme-toggle] .ui-icon')).toHaveCSS('width', '16px');
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(page.locator('[data-theme-toggle] use')).toHaveAttribute(
    'href',
    '/icons/pixelarticons.svg#lightbulb',
  );
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
  await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
