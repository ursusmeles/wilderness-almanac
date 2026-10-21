import { test as base, expect } from '@playwright/test';

export const campaign = {
  id: 'test-campaign',
  name: 'Test campaign',
  nameEdited: true,
  seed: '7',
  generatorVersion: 6,
  variant: 0,
  createdAt: '2026-10-20T12:00:00.000Z',
  colors: ['#cdab8f', '#0b365e', '#11b329'],
  paletteName: 'Forbidden Lands',
  iconKey: '0,0',
};
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
      ({ campaign }) => {
        if (!sessionStorage.getItem('test:initialized')) {
          localStorage.setItem(
            'wilderness-almanac:campaigns-v1',
            JSON.stringify({ version: 1, campaigns: [campaign] }),
          );
          localStorage.setItem(
            'hex-sandbox:map-v1',
            JSON.stringify({
              version: 1,
              colors: campaign.colors,
              campaignId: campaign.id,
              seed: campaign.seed,
              variant: 0,
            }),
          );
          sessionStorage.setItem('test:initialized', '1');
        }
        const write = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          const target = sessionStorage.getItem('test:blocked-target');
          if (
            this === localStorage &&
            (target === 'all' ||
              (target === 'campaigns' && key === 'wilderness-almanac:campaigns-v1') ||
              (target === 'preferences' && key === 'hex-sandbox:map-v1'))
          )
            throw new DOMException('Simulated full browser storage', 'QuotaExceededError');
          return write.call(this, key, value);
        };
      },
      { campaign },
    );
    await use(page);
    expect(errors, 'no unhandled browser exceptions').toEqual([]);
  },
});
export { expect };
export const library = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('wilderness-almanac:campaigns-v1')));
export async function openCampaign(page, { expandInspector = true } = {}) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  const expand = page.getByRole('button', { name: 'Expand Hex Inspector', exact: true });
  if (expandInspector && (await expand.isVisible())) await expand.click();
}
export async function exportFromMenu(page) {
  const download = page.waitForEvent('download');
  await page.locator('.campaign-card [data-action="download"]').first().click();
  return await download;
}
