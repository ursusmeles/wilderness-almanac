import { seedCampaigns } from './data.js';
import { test as base, expect } from '@playwright/test';

export const campaign = {
  id: 'test-campaign',
  name: 'Test campaign',
  nameEdited: true,
  seed: '7',
  generatorVersion: 10,
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
    await page.addInitScript(() => {
      const write = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        const target = sessionStorage.getItem('test:blocked-target');
        if (
          this.transaction.db.name === 'wilderness-almanac:campaigns' &&
          (target === 'all' ||
            (target === 'campaigns' && this.name === 'campaigns') ||
            (target === 'preferences' && ['palettes', 'settings'].includes(this.name)))
        )
          throw new DOMException('Simulated full browser storage', 'QuotaExceededError');
        return write.call(this, value, ...args);
      };
    });
    await page.goto('/');
    await seedCampaigns(page, [campaign]);
    await page.goto('about:blank');
    await use(page);
    expect(errors, 'no unhandled browser exceptions').toEqual([]);
  },
});
export { expect };
export const library = (page) =>
  page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('wilderness-almanac:campaigns', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(['campaigns', 'settings', 'recovery']);
        const campaigns = transaction.objectStore('campaigns').getAll();
        const order = transaction.objectStore('settings').get('library');
        const deleted = transaction.objectStore('recovery').get('deleted');
        transaction.oncomplete = () =>
          resolve({
            version: 1,
            campaigns: order.result.value.map(
              (id) => campaigns.result.find((row) => row.id === id).value,
            ),
            deletedCampaign: deleted.result?.value ?? null,
          });
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
export async function openCampaign(page, { expandInspector = true } = {}) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('inert');
  // Editing flows below use the origin explicitly; entry itself now selects
  // and frames the party's saved hex.
  await page.locator('#hp-selection').selectOption('0,0');
  if (expandInspector) await revealInspector(page);
}

export async function revealInspector(page) {
  if (await page.locator('#hp-inspector-body').isHidden()) {
    const mapHandle = page.getByRole('separator', {
      name: 'Resize map and side panels',
      exact: true,
    });
    if (await mapHandle.isVisible()) await mapHandle.press('Enter');
    const open = page.getByRole('button', { name: 'Open Inspector', exact: true });
    if (await open.isVisible()) await open.click();
    else if (await page.locator('#hp-inspector-body').isHidden()) {
      const handle = page.getByRole('separator', { name: 'Resize Inspector', exact: true });
      if (await handle.isVisible()) await handle.press('Enter');
    }
  }
}
export async function exportFromMenu(page) {
  const download = page.waitForEvent('download');
  await page.locator('.campaign-card [data-action="download"]').first().click();
  return await download;
}
