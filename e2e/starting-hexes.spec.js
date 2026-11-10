// @ts-check
import { test, expect, campaign, library, openCampaign } from './fixtures.js';
import { seedCampaigns } from './data.js';
import { DIRECTIONS } from '../src/generation/hex.js';

/** @typedef {{x: number, y: number}} Point */
/** @typedef {{missing: string[], animated: string[]}} ContinuitySample */
/** @typedef {{firstDraw: {keys: string[], animated: boolean} | null, point: (key: string) => Point, partyPoint: () => Point, refreshPicking: () => void, watchKnown: () => string[], samples: ContinuitySample[]}} Probe */

/**
 * Observe the actual campaign camera and submitted geometry without adding a
 * debug API to the app. Coordinates come from the displayed canvas, so fixed
 * canvas dimensions cannot silently make the click assertions pass.
 * @param {import('@playwright/test').Page} page
 */
async function observeRenderer(page) {
  await page.route(/\/src\/rendering\/map-renderer\.js(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'builds = createBuilds({';
    expect(source).toContain(marker);
    await route.fulfill({
      response,
      body: source.replace(
        marker,
        `if (host.id === 'hp-scene') {
          const screen = (point) => {
            controls.camera.updateMatrixWorld();
            point.project(controls.camera);
            const box = renderer.domElement.getBoundingClientRect();
            return {x: box.left + (point.x + 1) * box.width / 2,
                    y: box.top + (1 - point.y) * box.height / 2};
          };
          const probe = window.__rendererProbe = {
            firstDraw: null,
            partyScene: null,
            watched: [],
            samples: [],
            watchKnown() {
              probe.watched = meshes.cells.filter((cell) => cell.fogState !== 'undiscovered')
                .map((cell) => cell.key);
              probe.samples = [];
              return probe.watched;
            },
            point(key) {
              const cell = meshes.cells.find((cell) => cell.key === key);
              return screen(new THREE.Vector3(cell.wx, cell.top + 0.01, cell.wz));
            },
            partyPoint() {
              return screen(new THREE.Box3().setFromObject(probe.partyScene)
                .getCenter(new THREE.Vector3()));
            },
            refreshPicking: controls.refreshPicking,
          };
          const sample = (root) => {
            const keys = new Set(), animated = new Set();
            root?.traverse((object) => {
              if (!object.isMesh) return;
              const owned = [object.userData.key, ...(object.userData.faceRanges ?? [])
                .map((range) => range.key)].filter(Boolean);
              const materials = Array.isArray(object.material) ? object.material : [object.material];
              const arriving = materials.some((material) => material.customProgramCacheKey().includes('hex-rise'));
              for (const key of owned) {
                keys.add(key);
                if (arriving) animated.add(key);
              }
            });
            if (probe.watched.length) probe.samples.push({
              missing: probe.watched.filter((key) => !keys.has(key)),
              animated: probe.watched.filter((key) => animated.has(key)),
            });
            return {keys: [...keys].sort(), animated: animated.size > 0};
          };
          const show = buildOptions.show;
          buildOptions.show = (record) => {
            show(record);
            sample(record?.map.root);
          };
          const render = renderer.render.bind(renderer);
          renderer.render = (target, camera) => {
            if (target === scene) {
              const frame = sample(builds?.active()?.map.root);
              if (!probe.firstDraw && frame.keys.length) probe.firstDraw = frame;
            }
            if (target !== scene) probe.partyScene = target;
            return render(target, camera);
          };
        }
        ${marker}`,
      ),
    });
  });
}

for (const artStyle of ['low-poly', 'pixelart']) {
  test(`moving the party through ${artStyle} fog keeps discovered terrain visible without arrivals`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop party keyboard movement');
    await observeRenderer(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await seedCampaigns(page, [
      {
        ...campaign,
        artStyle,
        fogOfWar: true,
        partyToken: { key: '0,0', style: 'cairn' },
        hexEdits: { version: 1, cells: { '0,0': { visited: true } } },
      },
    ]);
    await openCampaign(page, { expandInspector: false });
    const canvas = page.locator('#hp-scene canvas');
    await expect(canvas).toHaveAttribute('data-motion', 'ambient');
    await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    await page.locator('#hp-find-party').click();
    await page.keyboard.press('d');
    await expect.poll(async () => (await library(page)).campaigns[0].partyToken.key).toBe('1,0');
    await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    const watched = await page.evaluate(() =>
      /** @type {typeof window & {__rendererProbe: Probe}} */ (window).__rendererProbe.watchKnown(),
    );
    expect(watched, 'watch discovered terrain beyond the unanimated starting batch').toContain(
      '2,0',
    );
    for (const [shortcut, destination] of [
      ['d', '2,0'],
      ['q', '1,0'],
    ]) {
      await page.keyboard.press(shortcut);
      await expect
        .poll(async () => (await library(page)).campaigns[0].partyToken.key)
        .toBe(destination);
      await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    }
    const samples = await page.evaluate(
      () =>
        /** @type {typeof window & {__rendererProbe: Probe}} */ (window).__rendererProbe.samples,
    );
    expect(samples.length).toBeGreaterThan(2);
    expect(
      samples.flatMap((sample) => sample.missing),
      'known geometry remains mounted at every commit and draw',
    ).toEqual([]);
    expect(
      samples.flatMap((sample) => sample.animated),
      'known terrain does not replay arrivals',
    ).toEqual([]);
  });
}

for (const artStyle of ['low-poly', 'pixelart']) {
  test(`the first ${artStyle} frame contains the saved party hex and neighbours without arrivals`, async ({
    page,
  }) => {
    await observeRenderer(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const q = 4,
      r = -4;
    await seedCampaigns(page, [
      { ...campaign, artStyle, partyToken: { key: `${q},${r}`, style: 'cairn' } },
    ]);
    await openCampaign(page, { expandInspector: false });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            /** @type {typeof window & {__rendererProbe: Probe}} */ (window).__rendererProbe
              .firstDraw,
        ),
      )
      .not.toBeNull();
    const first = await page.evaluate(
      () =>
        /** @type {typeof window & {__rendererProbe: Probe}} */ (window).__rendererProbe.firstDraw,
    );
    expect(first).toEqual({
      keys: [`${q},${r}`, ...DIRECTIONS.map(([dq, dr]) => `${q + dq},${r + dr}`)].sort(),
      animated: false,
    });
  });
}

test('visible hex hits, stationary hover and party dragging survive panel and window resizes', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop panel splitter and mouse dragging');
  await observeRenderer(page);
  await page.goto('/');
  await seedCampaigns(page, [
    { ...campaign, seed: 'heliotest', partyToken: { key: '0,0', style: 'cairn' } },
  ]);
  await openCampaign(page, { expandInspector: false });
  const canvas = page.locator('#hp-scene canvas');
  await expect(canvas).toHaveAttribute('data-render-state', 'ready');
  await page
    .getByRole('separator', { name: 'Resize map and side panels', exact: true })
    .press('Home');
  const assertCanvasFits = async () => {
    await expect
      .poll(async () => {
        const host = await page.locator('#hp-scene').boundingBox();
        const box = await canvas.boundingBox();
        return (
          Math.abs((host?.width ?? 0) - (box?.width ?? 0)) +
          Math.abs((host?.height ?? 0) - (box?.height ?? 0))
        );
      })
      .toBeLessThan(1);
  };
  await assertCanvasFits();

  const water = await page.evaluate(() =>
    /** @type {typeof window & {__rendererProbe: Probe}} */ (window).__rendererProbe.point('0,1'),
  );
  await page.mouse.move(water.x, water.y);
  await expect(page.locator('#hp-message')).toHaveText('1/0,1');
  await page.evaluate(() =>
    /** @type {typeof window & {__rendererProbe: Probe}} */ (
      window
    ).__rendererProbe.refreshPicking(),
  );
  await expect(page.locator('#hp-message')).toHaveText('1/0,1');
  await page.mouse.click(water.x, water.y);
  await expect(page.locator('#hp-selection')).toHaveValue('0,1');

  const token = await page.evaluate(() =>
    /** @type {typeof window & {__rendererProbe: Probe}} */ (window).__rendererProbe.partyPoint(),
  );
  await page.mouse.click(token.x, token.y);
  await expect(page.locator('#hp-selection')).toHaveValue('__party__');
  const drag = await page.evaluate(() => {
    const probe = /** @type {typeof window & {__rendererProbe: Probe}} */ (window).__rendererProbe;
    return { from: probe.partyPoint(), to: probe.point('-1,1') };
  });
  await page.mouse.move(drag.from.x, drag.from.y);
  await page.mouse.down();
  await page.mouse.move(drag.to.x, drag.to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await library(page)).campaigns[0].partyToken.key).toBe('-1,1');

  await page.setViewportSize({ width: 1200, height: 850 });
  await assertCanvasFits();
  const afterResize = await page.evaluate(() =>
    /** @type {typeof window & {__rendererProbe: Probe}} */ (window).__rendererProbe.point('0,1'),
  );
  await page.mouse.click(afterResize.x, afterResize.y);
  await expect(page.locator('#hp-selection')).toHaveValue('0,1');
});
