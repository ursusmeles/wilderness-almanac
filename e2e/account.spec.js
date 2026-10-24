import { test, expect, campaign, library } from './fixtures.js';

test('email sign-in, conditional transfer and divergent-copy recovery keep IndexedDB working', async ({
  page,
}) => {
  let signedIn = false;
  let remote;
  const requests = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(path);
    let value = {};
    let status = 200;
    if (path.endsWith('/get-session'))
      value = signedIn ? { user: { id: 'alice', email: 'alice@example.com' } } : null;
    else if (path.endsWith('/sign-in/email-otp')) signedIn = true;
    else if (path.endsWith('/sign-out')) signedIn = false;
    else if (path === '/api/campaigns')
      value = {
        campaigns: remote
          ? [{ id: remote.campaign.id, name: remote.campaign.name, revision: remote.revision }]
          : [],
      };
    else if (request.method() === 'PUT') {
      const expected = Number(request.headers()['if-match'].replaceAll('"', ''));
      if (expected !== (remote?.revision ?? 0)) {
        status = 409;
        value = { message: 'The account copy changed. Both versions have been kept.' };
      } else {
        remote = { campaign: request.postDataJSON().campaign, revision: expected + 1 };
        value = remote;
      }
    } else if (path === `/api/campaigns/${campaign.id}`) value = remote;
    await route.fulfill({ status, json: value });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Account & sync', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Account & sync' });
  await dialog.getByLabel('Email', { exact: true }).fill('alice@example.com');
  await dialog.getByRole('button', { name: 'Send sign-in code' }).click();
  await expect(dialog.getByLabel('Six-digit code')).toBeVisible();
  await dialog.getByLabel('Six-digit code').fill('123456');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog.getByText('alice@example.com', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save to account', exact: true }).click();
  await expect(dialog.locator('#account-message')).toContainText('Saved');
  expect(remote.revision).toBe(1);
  remote = { campaign: { ...remote.campaign, name: 'Other device edit' }, revision: 2 };
  await page.getByRole('button', { name: 'Close account', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Campaign name: Test campaign', exact: true });
  await name.fill('Offline device edit');
  await name.press('Enter');
  await expect(page.locator('#campaign-message')).toContainText('saved');
  await page.getByRole('button', { name: 'Account & sync', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save to account', exact: true }).click();
  await expect(dialog.locator('#account-message')).toContainText('Both versions');
  expect(remote.campaign.name).toBe('Other device edit');
  await dialog.getByRole('button', { name: 'Load on this device', exact: true }).click();
  await expect(dialog.locator('#account-message')).toContainText('unsynced changes');
  await dialog.getByRole('button', { name: 'Import as copy', exact: true }).click();
  await expect(dialog.locator('#account-message')).toContainText('separate copy');
  const stored = await library(page);
  expect(stored.campaigns.map((item) => item.name).sort()).toEqual([
    'Offline device edit',
    'Other device edit',
  ]);
  expect(new Set(stored.campaigns.map((item) => item.id)).size).toBe(2);
  await page.screenshot({ path: test.info().outputPath('account-desktop.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(dialog.getByLabel('Email', { exact: true })).toBeVisible();
  expect((await library(page)).campaigns.length).toBe(2);
  expect(requests.some((path) => path.includes('email-otp'))).toBe(true);
});

test('account dialog remains usable and fits a phone viewport when the API is unavailable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 502, json: { message: 'Account server unavailable' } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Account & sync', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Account & sync' });
  await expect(dialog.locator('#account-message')).toContainText('unavailable');
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('account-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Close account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account & sync', exact: true })).toBeFocused();
  expect((await library(page)).campaigns.length).toBe(1);
});
