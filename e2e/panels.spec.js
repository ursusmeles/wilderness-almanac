import { test, expect, campaign, openCampaign } from './fixtures.js';

test('desktop panel defaults and saved layouts belong to each campaign', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop panel preferences');
  await page.addInitScript(
    ({ campaign }) => {
      if (sessionStorage.getItem('test:panel-layouts')) return;
      localStorage.setItem(
        'wilderness-almanac:campaigns-v1',
        JSON.stringify({
          version: 1,
          campaigns: [campaign, { ...campaign, id: 'other-campaign', name: 'Other campaign' }],
        }),
      );
      localStorage.setItem(
        'wilderness-almanac:ui-v1',
        JSON.stringify({
          version: 1,
          panelsCollapsed: { tracker: true, inspector: true },
          panelsHorizontal: { tracker: true, inspector: true },
        }),
      );
      sessionStorage.setItem('test:initialized', '1');
      sessionStorage.setItem('test:panel-layouts', '1');
    },
    { campaign },
  );
  await openCampaign(page);
  const inspector = page.locator('.hp-inspector-panel');
  const sandbox = page.locator('.hp-tracker-panel');
  await expect(inspector).not.toHaveClass(/is-collapsed|is-side-collapsed/);
  await expect(sandbox).not.toHaveClass(/is-collapsed|is-side-collapsed/);
  await expect(page.locator('.hp-side-panels > section').first()).toHaveAttribute(
    'data-panel',
    'inspector',
  );
  await page.getByRole('separator', { name: 'Resize Hex Inspector', exact: true }).focus();
  await page.keyboard.press('End');
  await inspector.locator('[data-horizontal]').click();
  await page.locator('#hp-back-menu').click();
  await page.getByRole('button', { name: 'Enter Other campaign', exact: true }).click();
  await expect(inspector).not.toHaveClass(/is-collapsed|is-side-collapsed/);
  await expect(sandbox).not.toHaveClass(/is-collapsed|is-side-collapsed/);
  await sandbox.locator('[data-horizontal]').click();
  await page.locator('#hp-back-menu').click();
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(inspector).toHaveClass(/is-side-collapsed/);
  await expect(sandbox).toHaveClass(/is-collapsed/);
  await expect(sandbox).not.toHaveClass(/is-side-collapsed/);
  await page.reload();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(inspector).toHaveClass(/is-side-collapsed/);
  await expect(sandbox).toHaveClass(/is-collapsed/);
});

test('desktop Inspector fold follows the overview height and wrapped titles', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop Inspector fold');
  await page.addInitScript(() => {
    window.panelErrors = [];
    window.addEventListener('error', (event) => window.panelErrors.push(event.message));
  });
  await openCampaign(page);
  await page.evaluate(() => document.fonts.ready);
  const foldGap = () =>
    page.evaluate(() => {
      const body = document.querySelector('#hp-inspector-body').getBoundingClientRect();
      const overview = document.querySelector('.hp-inspector-overview').getBoundingClientRect();
      return Math.abs(body.bottom - overview.bottom);
    });
  await expect.poll(foldGap).toBeLessThan(0.1);
  await page.setViewportSize({ width: 960, height: 900 });
  await expect.poll(foldGap).toBeLessThan(0.1);
  const overview = page.locator('.hp-inspector-overview');
  const before = await overview.evaluate((element) => element.getBoundingClientRect().height);
  await page.locator('#hp-hex-name').evaluate((element) => {
    element.textContent =
      'Ancient stronghold in the dense evergreen forest above the winding river and distant mountain foothills';
  });
  await expect
    .poll(() => overview.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(before);
  await expect.poll(foldGap).toBeLessThan(0.1);
  await page.getByRole('separator', { name: 'Resize Hex Inspector', exact: true }).focus();
  await page.keyboard.press('End');
  const inspector = await page.locator('.hp-inspector-panel').boundingBox();
  const column = await page.locator('.hp-side-panels').boundingBox();
  expect(inspector.height).toBeGreaterThan(column.height / 2);
  expect(await page.evaluate(() => window.panelErrors)).toEqual([]);
});
