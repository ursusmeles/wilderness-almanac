import { test, expect, campaign, library, openCampaign } from './fixtures.js';

test.use({ reducedMotion: 'no-preference' });

test.beforeEach(({}, testInfo) =>
  test.skip(testInfo.project.name !== 'desktop', 'additional routing and settings checks'),
);

test('palette manager defaults remain saved when the surrounding Settings draft is cancelled', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#open-settings').click();
  await page.locator('#open-palette-manager').click();
  await page.locator('.palette-row[data-id="moss"]').click();
  await page.locator('#default-palette').click();
  await page.locator('#close-palette-manager').click();
  await expect(page.locator('#settings-palette')).toHaveValue('moss');
  await expect(page.locator('#settings-save')).toBeDisabled();
  await page.locator('#settings-cancel').click();
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-palette')).toHaveValue('moss');
});

test('a temporarily unavailable WebGL context reports an entry error and permits retry', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    window.blockWebGL = true;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (window.blockWebGL && /webgl/.test(type)) return null;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await page.locator('.campaign-enter').click();
  await expect(page.locator('#campaign-message')).toContainText('This map needs WebGL support');
  await expect(page.locator('.campaign-enter')).toBeEnabled();
  await expect(page.locator('#campaign-workspace')).toBeHidden();
  await page.evaluate(() => {
    window.blockWebGL = false;
  });
  await page.locator('.campaign-enter').click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  expect((await library(page)).campaigns).toHaveLength(1);
});

test('replay query changes take precedence over a known local campaign route', async ({ page }) => {
  await openCampaign(page);
  const url = new URL(page.url());
  url.searchParams.set('colors', '282039-237d89-e5b96e');
  await page.goto(url.href);
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await expect.poll(async () => (await library(page)).campaigns.length).toBe(2);
  const records = (await library(page)).campaigns;
  expect(records[0].colors).toEqual(campaign.colors);
  expect(records[1].colors).toEqual(['#282039', '#237d89', '#e5b96e']);
  await page.evaluate(() => history.back());
  await expect(page.locator('#campaign-menu')).toBeVisible();
});

test('browser Back during an active entry transition is queued and leaves entry usable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const start = document.startViewTransition.bind(document);
    let first = true;
    document.startViewTransition = (update) => {
      const transition = start(update);
      if (!first) return transition;
      first = false;
      const gate = new Promise((resolve) => {
        window.releaseEntry = resolve;
      });
      return {
        finished: Promise.all([transition.finished, gate]),
        skipTransition: () => transition.skipTransition(),
      };
    };
  });
  await page.goto('/');
  await page.locator('.campaign-enter').click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await page.evaluate(() => history.back());
  await page.evaluate(() => window.releaseEntry());
  await expect(page.locator('#campaign-menu')).toBeVisible();
  await expect(page.locator('#campaign-menu')).not.toHaveAttribute('inert');
  await expect(page.locator('.campaign-enter')).toBeEnabled();
  await page.locator('.campaign-enter').click();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
});
