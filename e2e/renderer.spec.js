import { test, expect, openCampaign } from './fixtures.js';

test('renderer controls preserve selection during pan/pinch, clamp zoom and respect focus and reduced motion', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCampaign(page);
  const canvas = page.locator('#hp-scene canvas');
  const selection = page.locator('#hp-selection');
  const selected = await selection.inputValue();
  const rect = await canvas.boundingBox();
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  const before = await canvas.screenshot();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 50, y + 20, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(0, 0);
  expect(await selection.inputValue()).toBe(selected);
  expect(await canvas.screenshot(), 'pan changes the rendered viewpoint').not.toEqual(before);

  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -10000);
  await expect(canvas).toHaveAttribute('data-zoom', '12');
  await page.mouse.wheel(0, 10000);
  await expect(canvas).toHaveAttribute('data-zoom', '0.7');
  await page.keyboard.press('=');
  await expect(canvas).toHaveAttribute('data-zoom', '0.84');
  await selection.focus();
  await page.keyboard.press('-');
  await expect(canvas).toHaveAttribute('data-zoom', '0.84');
  await page
    .locator(testInfo.project.name === 'mobile' ? '#hp-expand-map' : '#hp-multi-edit')
    .focus();
  await page.keyboard.press('-');
  await expect(canvas).toHaveAttribute('data-zoom', '0.7');

  await expect(canvas).toHaveAttribute('data-motion', 'still');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(canvas).toHaveAttribute('data-motion', 'ambient');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(canvas).toHaveAttribute('data-motion', 'still');

  if (testInfo.project.name === 'mobile') {
    const active = await selection.inputValue();
    const session = await page.context().newCDPSession(page);
    const points = (distance) => [
      { id: 0, x: x - distance / 2, y },
      { id: 1, x: x + distance / 2, y },
    ];
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: points(80),
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(120),
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeCloseTo(1.05);
    expect(await selection.inputValue()).toBe(active);
    await session.detach();
  }
});
