// @ts-check
import { test, expect, library } from './fixtures.js';
import { DIRECTIONS } from '../src/generation/hex.js';

/** @typedef {{keys: string[], animated: boolean, status: string | null}} Frame */
/** @typedef {{first: Record<string, Frame>, animatedSeeds: string[], builds: number, buildsAtDispose: number, disposed: boolean, lateBuilds: number, framing: () => {position: number[], zoom: number}}} Probe */

/** Observe real submissions and disposal; choose a repeatable initial seed. @param {import('@playwright/test').Page} page */
async function observePreview(page) {
  const module = await page.request.get('/src/ui/campaign-creator.js');
  test.skip(
    !module.ok() || !module.headers()['content-type']?.includes('javascript'),
    'Requires source-served instrumentation.',
  );
  await page.route(/\/src\/ui\/campaign-creator\.js(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'seedInput.value = freshSeed();';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, "seedInput.value = '7';") });
  });
  await page.route(/\/src\/rendering\/map-renderer\.js(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'builds = createBuilds({';
    expect(source).toContain(marker);
    await route.fulfill({
      response,
      body: source.replace(
        marker,
        `if (host.id === 'cc-scene') {
        const probe = {
          first: {}, animatedSeeds: [], builds: 0, buildsAtDispose: 0,
          disposed: false, lateBuilds: 0,
          framing: () => ({position: controls.camera.position.toArray(), zoom: controls.camera.zoom}),
        };
        (window.__creationProbes ??= []).push(probe);
        const build = buildOptions.build;
        buildOptions.build = (...args) => {
          probe.builds++;
          if (probe.disposed) probe.lateBuilds++;
          return build(...args);
        };
        const dispose = renderer.dispose.bind(renderer);
        renderer.dispose = () => {
          probe.disposed = true;
          probe.buildsAtDispose = probe.builds;
          dispose();
        };
        const render = renderer.render.bind(renderer);
        renderer.render = (target, camera) => {
          const result = render(target, camera);
          const keys = new Set();
          let animated = false;
          builds?.active()?.map.root.traverse((object) => {
            if (!object.isMesh) return;
            if (object.userData.key) keys.add(object.userData.key);
            for (const range of object.userData.faceRanges ?? []) keys.add(range.key);
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            animated ||= materials.some((material) => material.customProgramCacheKey().includes('hex-rise'));
          });
          const seed = host.dataset.seed;
          if (keys.size && !probe.first[seed]) {
            probe.first[seed] = {keys: [...keys].sort(), animated,
              status: document.querySelector('#cc-preview-status').textContent};
            const action = window.__creationFirstDrawAction;
            if (action) {
              window.__creationFirstDrawAction = null;
              queueMicrotask(() => document.querySelector(action).click());
            }
          }
          if (animated && !probe.animatedSeeds.includes(seed)) probe.animatedSeeds.push(seed);
          return result;
        };
      }
      ${marker}`,
      ),
    });
  });
}

for (const artStyle of ['low-poly', 'pixelart']) {
  test(`${artStyle} creation preview builds outward with arrivals and preserves pan and zoom`, async ({
    page,
  }, info) => {
    await observePreview(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.locator('#new-campaign').click();
    const canvas = page.locator('#cc-scene canvas');
    await expect(canvas).toHaveAttribute('data-renderer', 'fiber-retained');
    await expect(page.locator('#cc-preview-status')).toHaveText('Preview ready.');
    if (artStyle === 'pixelart') {
      await page
        .locator('#create-campaign-dialog')
        .getByRole('radio', { name: 'Pixelart', exact: true })
        .check();
      await expect(canvas).toHaveAttribute('data-art-style', artStyle);
      await expect(canvas).toHaveAttribute('data-render-state', 'ready');
    }
    await page.locator('#cc-zoom-in').click();
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    const before = await page.evaluate(() =>
      /** @type {Probe[]} */ (Reflect.get(window, '__creationProbes'))[0].framing(),
    );
    await page.locator('#cc-seed').fill('8');
    await page.locator('#cc-generate').click();
    await expect(page.locator('#cc-scene')).toHaveAttribute('data-seed', '8');
    await expect(page.locator('#cc-preview-status')).toHaveText('Preview ready.');
    const observed = await page.evaluate(() => {
      const probe = /** @type {Probe[]} */ (Reflect.get(window, '__creationProbes'))[0];
      return {
        first: probe.first['8'],
        animated: probe.animatedSeeds.includes('8'),
        framing: probe.framing(),
      };
    });
    expect(observed.first).toEqual({
      keys: ['0,0', ...DIRECTIONS.map(([q, r]) => `${q},${r}`)].sort(),
      animated: false,
      status: 'Building preview…',
    });
    expect(observed.animated).toBe(true);
    expect(observed.framing).toEqual(before);
    await canvas.screenshot({ path: info.outputPath('creation-preview.png') });
    expect((await library(page)).campaigns).toHaveLength(1);
  });
}

for (const mode of ['reduced motion', 'Movement Off']) {
  test(`creation preview keeps incremental building with ${mode}`, async ({ page }) => {
    await observePreview(page);
    await page.emulateMedia({
      reducedMotion: mode === 'reduced motion' ? 'reduce' : 'no-preference',
    });
    await page.goto('/');
    if (mode === 'Movement Off') {
      await page.locator('#open-settings').click();
      await page
        .locator('#settings-dialog')
        .getByRole('radio', { name: 'Movement Off', exact: true })
        .check();
      await page.locator('#settings-save').click();
    }
    await page.locator('#new-campaign').click();
    await expect(page.locator('#cc-scene canvas')).toHaveAttribute('data-motion', 'still');
    await expect(page.locator('#cc-preview-status')).toHaveText('Preview ready.');
    const probe = await page.evaluate(() => {
      const probe = /** @type {Probe[]} */ (Reflect.get(window, '__creationProbes'))[0];
      return { first: probe.first['7'], animatedSeeds: probe.animatedSeeds, builds: probe.builds };
    });
    expect(probe.first.keys).toHaveLength(7);
    expect(probe.animatedSeeds).toEqual([]);
    expect(probe.builds).toBeGreaterThan(1);
  });
}

test('closing or creating after the first preview frame cancels unfinished builds', async ({
  page,
}) => {
  await observePreview(page);
  await page.goto('/');
  for (const action of ['#cc-dismiss', '#cc-create']) {
    await page.evaluate(
      (action) => Reflect.set(window, '__creationFirstDrawAction', action),
      action,
    );
    await page.locator('#new-campaign').click();
    await expect(page.locator('#create-campaign-dialog')).toBeHidden();
    if (action === '#cc-create')
      await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-render-state', 'ready');
    // Let any cancelled callbacks have their turn before inspecting disposal.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const stopped = await page.evaluate(() => {
      const probe = /** @type {Probe[]} */ (Reflect.get(window, '__creationProbes')).at(-1);
      return {
        disposed: probe?.disposed,
        builds: probe?.builds,
        buildsAtDispose: probe?.buildsAtDispose,
        lateBuilds: probe?.lateBuilds,
      };
    });
    expect(stopped).toEqual({ disposed: true, builds: 1, buildsAtDispose: 1, lateBuilds: 0 });
  }
  expect((await library(page)).campaigns).toHaveLength(2);
});
