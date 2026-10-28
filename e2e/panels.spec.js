import { test, expect } from '@playwright/test';

const visiblePanels = (page) => page.locator('.hp-side-panels > section:visible');
const mapResize = (page) =>
  page.getByRole('separator', { name: 'Resize map and side panels', exact: true });
const resize = (page, name = 'Inspector') =>
  page.getByRole('separator', { name: `Resize ${name}`, exact: true });
async function enter(page) {
  await page.goto('/?seed=heliotest&generator=10');
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
}
async function order(page) {
  return visiblePanels(page).evaluateAll((nodes) => nodes.map((node) => node.dataset.panel));
}

test('Settings order applies on desktop/mobile, stages cancellation and survives reload', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  await expect.poll(() => order(page)).toEqual(['inspector', 'tracker']);
  await expect(page.locator('.hp-panel-bar button:visible')).toHaveCount(
    info.project.name === 'mobile' ? (await order(page)).length : 0,
  );
  await page.locator('#hp-back-menu').click();
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-save')).toBeDisabled();
  await expect(page.locator('#settings-panel-order')).toHaveValue('inspector');
  const positions = await page.evaluate(() =>
    ['settings-time', 'settings-panel-order', 'settings-palette'].map(
      (id) => document.getElementById(id).getBoundingClientRect().y,
    ),
  );
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);
  await page.locator('#settings-panel-order').selectOption('tracker');
  await page.locator('#settings-cancel').click();
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-panel-order')).toHaveValue('inspector');
  await expect(page.locator('#settings-save')).toBeDisabled();
  await page.locator('#settings-panel-order').selectOption('tracker');
  await page.locator('#settings-save').click();
  await page
    .getByRole('button', { name: /^Enter/ })
    .first()
    .click();
  await expect.poll(() => order(page)).toEqual(['tracker', 'inspector']);
  await expect(page.locator('#hp-tracker-title')).toHaveText('Journal');
  await expect(page.locator('#hp-inspector-title')).toHaveText('Inspector');
  if (info.project.name === 'mobile') {
    await expect(page.locator('#hp-inspector-body')).toBeHidden();
    await page.getByRole('button', { name: 'Open Inspector', exact: true }).click();
    await expect(page.locator('#hp-inspector-body')).toBeVisible();
    await page.getByRole('button', { name: 'Close Inspector', exact: true }).click();
    await expect(page.locator('#hp-inspector-body')).toBeHidden();
    const dimensions = await page.evaluate(() => ({
      bottom: document.querySelector('.hp-side-panels').getBoundingClientRect().bottom,
      viewport: innerHeight,
    }));
    expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
  await page.reload();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect.poll(() => order(page)).toEqual(['tracker', 'inspector']);
  await page.screenshot({ path: info.outputPath('panel-order.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('desktop map divider resizes both columns, folds rails and restores defaults', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop divider');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  const map = page.locator('.hp-map-panel'),
    side = page.locator('.hp-side-panels'),
    handle = mapResize(page);
  const initial = await map.boundingBox();
  const grab = await handle.boundingBox();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(380, grab.y + grab.height / 2, { steps: 8 });
  await page.mouse.up();
  expect((await map.boundingBox()).width).toBeLessThan(initial.width - 100);
  expect((await map.boundingBox()).width).toBeGreaterThanOrEqual(320);
  await handle.press('Home');
  expect((await map.boundingBox()).width).toBeGreaterThanOrEqual(320);
  await expect(page.locator('#hp-back-menu')).toBeInViewport();
  await page.locator('#hp-toggle-settings').click();
  for (const id of [
    'ground',
    'water',
    'elements',
    'preset',
    'regenerate',
    'motion',
    'time-of-day',
  ]) {
    const box = await page.locator(`#hp-${id}`).boundingBox(),
      container = await map.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(container.x);
    expect(box.x + box.width).toBeLessThanOrEqual(container.x + container.width);
  }
  await page.locator('#hp-toggle-settings').click();
  const narrow = await handle.boundingBox();
  await page.mouse.move(narrow.x + narrow.width / 2, narrow.y + narrow.height / 2);
  await page.mouse.down();
  await page.mouse.move(1235, narrow.y + narrow.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-panel-rails', '2');
  await expect(page.locator('#hp-inspector-body')).toBeHidden();
  expect((await side.boundingBox()).width).toBeLessThan(120);
  expect(await map.evaluate((node) => node.scrollLeft)).toBe(0);
  await expect(page.locator('#hp-back-menu')).toBeInViewport();
  await expect(page.locator('.hp-title')).toHaveText('Heliotest');
  await handle.press('ArrowLeft');
  expect((await side.boundingBox()).width).toBeGreaterThanOrEqual(300);
  await handle.press('End');
  await expect(page.locator('.hp-title')).toBeInViewport();
  await page.locator('.hp-top').screenshot({ path: info.outputPath('map-header.png') });
  await page.screenshot({ path: info.outputPath('folded-panels.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-panel-rails', '2');
  await mapResize(page).dblclick();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-panel-rails', '0');
  expect(Math.abs((await map.boundingBox()).width - initial.width)).toBeLessThan(2);
  await mapResize(page).dblclick();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-panel-rails', '2');
  await mapResize(page).press('Enter');
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-panel-rails', '0');
  const bar = await resize(page).boundingBox();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 180, { steps: 8 });
  await page.mouse.up();
  const grown = await page.locator('.hp-inspector-panel').boundingBox();
  await resize(page).dblclick();
  const normal = await page.locator('.hp-inspector-panel').boundingBox();
  expect(normal.height).toBeLessThan(grown.height - 50);
  await expect(page.locator('#hp-inspector-body')).toBeVisible();
  await resize(page).dblclick();
  await expect(page.locator('#hp-inspector-body')).toBeHidden();
  await resize(page).dblclick();
  await expect(page.locator('#hp-inspector-body')).toBeVisible();
  expect(
    Math.abs((await page.locator('.hp-inspector-panel').boundingBox()).height - normal.height),
  ).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath('default-panels.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('Party replaces both tools, edits its header, navigates calendar and retains drafts', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open Inspector', exact: true }).click();
  await page.locator('#hp-hex-edit').click();
  await page.locator('#hp-hex-terrain').selectOption('light forest');
  await page.locator('#hp-find-party').click();
  const draft = page.getByRole('dialog', { name: 'Unsaved edits', exact: true });
  await expect(draft).toBeVisible();
  await draft.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('.hp-party-panel')).toBeHidden();
  await page.locator('#hp-find-party').click();
  await draft.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect.poll(() => order(page)).toEqual(['party']);
  await expect(page.locator('.hp-panel-bar button:visible')).toHaveCount(
    info.project.name === 'mobile' ? (await order(page)).length : 0,
  );
  await expect(page.locator('#hp-party-name')).toHaveCount(1);
  if (info.project.name === 'mobile') {
    const name = await page.locator('#hp-party-name-form').boundingBox(),
      disclosure = await page
        .getByRole('button', { name: 'Close Party panel', exact: true })
        .boundingBox();
    expect(name.x + name.width).toBeLessThanOrEqual(disclosure.x);
  }
  await expect(page.locator('.hp-party-overview input')).toHaveCount(0);
  await expect(page.locator('.hp-party-overview dt > span')).toHaveText([
    'Region',
    'Nearest settlement',
    'Nearest POI',
    'Hexes visited',
    'Week',
  ]);
  const rows = await page
    .locator('.hp-party-overview dl > div')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(Math.max(...rows) - Math.min(...rows)).toBeLessThan(1);
  await page.locator('#hp-party-name').fill('Ash walkers');
  await page.locator('#hp-party-name').press('Enter');
  await expect(page.locator('.hp-journal-rename')).toContainText(
    'Adventurers changed name to Ash walkers.',
  );
  await page.locator('[data-week-page="last"]').click();
  await page.locator('#hp-journal-start').click();
  await page.locator('[data-week-page="first"]').click();
  await expect(page.locator('#hp-journal-week')).toHaveText('Week 1');
  await page.locator('#hp-party-show-week').click();
  await expect(page.locator('#hp-journal-week')).toHaveText('Week 2');
  await expect(page.locator('#hp-party-show-week use')).toHaveAttribute('href', /#calendar$/);
  await page.locator('#hp-journal-input').fill('A draft to keep');
  if (info.project.name === 'desktop') {
    const input = page.locator('#hp-journal-input');
    await expect(input).toHaveCSS('resize', 'vertical');
    const before = await input.boundingBox();
    await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width - 3, before.y + before.height + 60, { steps: 8 });
    await page.mouse.up();
    expect((await input.boundingBox()).height).toBeGreaterThan(before.height + 30);
    expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(
      Number.parseFloat(await input.evaluate((node) => getComputedStyle(node).minHeight)),
    );
    const party = await page.locator('.hp-party-panel').boundingBox(),
      side = await page.locator('.hp-side-panels').boundingBox();
    expect(Math.abs(party.height - side.height)).toBeLessThan(1);
    await mapResize(page).dblclick();
    await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-panel-rails', '1');
    await mapResize(page).dblclick();
  }
  await page.screenshot({ path: info.outputPath('party-panel.png'), fullPage: true });
  await page.locator('#hp-selection').selectOption('1,0');
  await expect.poll(() => order(page)).toEqual(['inspector', 'tracker']);
  await page.locator('#hp-find-party').click();
  await expect(page.locator('#hp-party-name')).toHaveValue('Ash walkers');
  await expect(page.locator('#hp-journal-input')).toHaveValue('A draft to keep');
  await page.reload();
  await page.locator('#hp-find-party').click();
  await expect(page.locator('#hp-party-name')).toHaveValue('Ash walkers');
  expect(errors).toEqual([]);
});

test('party links replace the previous Inspector tile with the destination preview', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open Inspector', exact: true }).click();
  const selection = page.locator('#hp-selection'),
    preview = page.locator('#hp-hex-preview');
  async function showPreviousTile() {
    await selection.selectOption('0,1');
    await expect(preview).toHaveAttribute('alt', /Open water/);
    const source = await preview.getAttribute('src');
    await page.locator('#hp-find-party').click();
    return source;
  }
  async function expectDestination(key, previous) {
    await expect(selection).toHaveValue(key);
    await expect(page.locator('[data-hex-key]')).toHaveAttribute('data-hex-key', key);
    const name = await page.locator('#hp-hex-name').textContent();
    await expect(preview).toHaveAttribute('alt', `Isometric view of ${name}`);
    await expect.poll(async () => (await preview.getAttribute('src')) !== previous).toBe(true);
    await expect.poll(() => preview.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  }
  for (const [control, key] of [
    ['poi', '-1,0'],
    ['settlement', '0,0'],
    ['position', '0,0'],
  ]) {
    const previous = await showPreviousTile();
    await page.locator(`#hp-party-locate-${control}`).click();
    await expectDestination(key, previous);
  }
  const previous = await showPreviousTile();
  const input = page.locator('#hp-journal-input');
  await input.fill('$1,0');
  await input.press('Tab');
  await page.locator('#hp-journal-add').click();
  await page.locator('#hp-journal-entries [data-mention-type="hex"]').click();
  await expectDestination('1,0', previous);
  await showPreviousTile();
  const beforeDropdown = await preview.getAttribute('src');
  await selection.selectOption('0,-1');
  await expectDestination('0,-1', beforeDropdown);
  expect(errors).toEqual([]);
});

test('legacy combined folds migrate and new column sizes remain campaign-local', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop saved column layouts');
  await page.addInitScript(() => {
    if (sessionStorage.getItem('test:panel-migration')) return;
    const base = {
      seed: 'heliotest',
      generatorVersion: 10,
      variant: 0,
      createdAt: '2026-10-28T12:00:00.000Z',
      colors: ['#cdab8f', '#0b365e', '#11b329'],
      paletteName: 'Forbidden Lands',
      iconKey: '0,0',
    };
    localStorage.setItem(
      'wilderness-almanac:campaigns-v1',
      JSON.stringify({
        version: 1,
        campaigns: [
          { ...base, id: 'one', name: 'One' },
          { ...base, id: 'two', name: 'Two' },
        ],
      }),
    );
    localStorage.setItem(
      'wilderness-almanac:ui-v1',
      JSON.stringify({
        version: 1,
        journalFirst: true,
        campaignPanels: {
          one: {
            panelOrder: ['inspector', 'tracker'],
            panelsHorizontal: { inspector: true, tracker: false },
            panelsCollapsed: { inspector: true, tracker: true },
          },
          two: { mapSplit: 0.5, sidePanelsFolded: false },
        },
      }),
    );
    sessionStorage.setItem('test:panel-migration', '1');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter One', exact: true }).click();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-panel-rails', '2');
  await expect.poll(() => order(page)).toEqual(['tracker', 'inspector']);
  await mapResize(page).press('Enter');
  await mapResize(page).press('Home');
  const first = (await page.locator('.hp-map-panel').boundingBox()).width;
  await page.locator('#hp-back-menu').click();
  await page.getByRole('button', { name: 'Enter Two', exact: true }).click();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-panel-rails', '0');
  await expect.poll(() => order(page)).toEqual(['tracker', 'inspector']);
  expect((await page.locator('.hp-map-panel').boundingBox()).width).toBeGreaterThan(first + 50);
  await page.locator('#hp-back-menu').click();
  await page.getByRole('button', { name: 'Enter One', exact: true }).click();
  await expect
    .poll(async () => Math.abs((await page.locator('.hp-map-panel').boundingBox()).width - first))
    .toBeLessThan(2);
  await page.reload();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect
    .poll(async () => Math.abs((await page.locator('.hp-map-panel').boundingBox()).width - first))
    .toBeLessThan(2);
});
