import { test, expect, openCampaign } from './fixtures.js';

const controlGeometry = (page) =>
  page.locator('.icon-button').evaluateAll((buttons) =>
    buttons
      .filter((button) => button.getClientRects().length && !button.closest('[hidden]'))
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        const icon = button.querySelector('.ui-icon')?.getBoundingClientRect();
        return {
          name: button.id || button.getAttribute('aria-label'),
          width: rect.width,
          height: rect.height,
          padding: style.padding,
          iconFits:
            !icon ||
            (icon.left >= rect.left &&
              icon.right <= rect.right &&
              icon.top >= rect.top &&
              icon.bottom <= rect.bottom),
        };
      }),
  );

async function expectSquareControls(page) {
  for (const button of await controlGeometry(page)) {
    expect(button.width, `${button.name} is square`).toBeCloseTo(button.height, 1);
    expect(button.padding, `${button.name} has no padding`).toBe('0px');
    expect(button.iconFits, `${button.name} contains its icon`).toBe(true);
  }
}

test('desktop Inspector actions retain two columns with enlarged text and folded panels', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop panel geometry');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCampaign(page);
  for (const [width, height, fontSize] of [
    [761, 900, 16],
    [1280, 900, 16],
    [1920, 1080, 32],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = `${size}px`;
    }, fontSize);
    const actions = page.locator('#hp-hex-form .hp-inspector-action-cluster');
    await expect
      .poll(() =>
        actions.evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
        ),
      )
      .toBe(2);
    await expectSquareControls(page);
  }
  await page.evaluate(() => (document.documentElement.style.fontSize = '16px'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#hp-hex-multi-edit').click();
  for (const selector of [
    '.hp-batch-overview .hp-inspector-edit-actions',
    '#hp-batch-form .hp-inspector-action-cluster',
  ]) {
    await expect
      .poll(() =>
        page
          .locator(selector)
          .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      )
      .toBe(2);
  }
  await page.locator('#hp-batch-off').click();
  for (const panel of ['.hp-tracker-panel', '.hp-inspector-panel']) {
    await page.locator(`${panel} [data-horizontal]`).click();
    await expect(page.locator(panel)).toHaveClass(/is-side-collapsed/);
    await expectSquareControls(page);
  }
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-panel-rails', '2');
});

test('mobile palette geometry survives appearance toggles and viewport boundaries', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'touch workspace geometry');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCampaign(page, { expandInspector: false });
  for (const [width, height] of [
    [320, 844],
    [390, 844],
    [640, 900],
    [760, 900],
    [1024, 500],
  ]) {
    await page.setViewportSize({ width, height });
    for (const expanded of [false, true]) {
      const toggle = page.locator('#hp-toggle-settings');
      if (((await toggle.getAttribute('aria-expanded')) === 'true') !== expanded)
        await toggle.click();
      await expect(page.locator('.hp-map-options .hp-swatch').first()).toHaveCSS('width', '18px');
      await expect(page.locator('.hp-map-options .hp-color').first()).toHaveCSS('width', '22px');
      const palette = await page.locator('.hp-palette').boundingBox();
      for (const selector of ['#hp-preset', '#hp-time-of-day', '#hp-toggle-settings']) {
        const box = await page.locator(selector).boundingBox();
        expect(box.x, selector).toBeGreaterThanOrEqual(palette.x);
        expect(box.x + box.width, selector).toBeLessThanOrEqual(palette.x + palette.width);
      }
      await expectSquareControls(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  }
  await page.locator('#hp-expand-map').click();
  await expect(page.locator('.hp-side-panels')).toBeHidden();
  await expect(page.locator('.hp-map-options')).toBeHidden();
  await expect(page.locator('#hp-expand-map')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.hp-side-panels')).toBeVisible();
});

test('shared icon controls preserve disabled, keyboard-focus and hidden states', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCampaign(page);
  const out = page.locator('#hp-out');
  await page.keyboard.press('Tab');
  await out.focus();
  await expect(out).toHaveCSS('outline-style', 'solid');
  await expect(out).toHaveCSS('outline-width', '2px');
  await expect(page.locator('#hp-loading')).toBeHidden();
  await page.locator('#hp-back-menu').click();
  await page.locator('#open-settings').click();
  await page.locator('#open-palette-manager').click();
  const remove = page.locator('#delete-palette');
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveCSS('opacity', '0.45');
  await expect(page.locator('#palette-manager-message')).toBeHidden();
  await expect(page.locator('#close-palette-manager')).toHaveCSS('padding', '0px');
});
