import { test, expect, campaign, library, openCampaign } from './fixtures.js';

const importFile = {
  name: 'adventure.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      format: 'wilderness-almanac-campaign',
      version: 2,
      campaign: {
        ...campaign,
        name: 'Imported adventure',
        partyToken: { key: '0,0', style: 'warden', weeks: 3 },
      },
    }),
  ),
};

test('Settings stages defaults and imports, Cancel discards, and Save persists new-campaign defaults', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-save')).toBeDisabled();
  await expect(page.locator('#settings-palette')).toHaveValue('classic');
  await expect(page.locator('#settings-time')).toHaveValue('dawn');
  await page.locator('#settings-palette').selectOption('glacial');
  await page.locator('#settings-time').selectOption('night');
  await page.locator('#settings-motion').click();
  await page.locator('#campaign-file').setInputFiles(importFile);
  await expect(page.locator('#settings-filename')).toHaveText('adventure.json');
  await expect(page.locator('#settings-message')).toContainText('Ready to import');
  expect((await library(page)).campaigns).toHaveLength(1);
  await page.locator('#settings-cancel').click();
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-save')).toBeDisabled();
  await expect(page.locator('#settings-palette')).toHaveValue('classic');
  await expect(page.locator('#settings-time')).toHaveValue('dawn');
  await expect(page.locator('#settings-motion')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#settings-filename')).toHaveText('No file selected');
  await page.locator('#campaign-file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken'),
  });
  await expect(page.locator('#settings-message')).toContainText('not valid JSON');
  await expect(page.locator('#settings-save')).toBeDisabled();
  await page.locator('#settings-palette').selectOption('glacial');
  await page.locator('#settings-time').selectOption('night');
  await page.locator('#settings-motion').click();
  await page.locator('#campaign-file').setInputFiles(importFile);
  await expect(page.locator('#settings-save')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('settings.png') });
  await page.locator('#settings-save').click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.locator('.campaign-card')).toHaveCount(2);
  await expect(page.locator('.campaign-week')).toHaveText(['1', '3']);
  expect((await library(page)).campaigns[1].id).not.toBe(campaign.id);
  await page.reload();
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-palette')).toHaveValue('glacial');
  await expect(page.locator('#settings-palette option:checked')).toHaveText('Frozen synapse');
  await expect(page.locator('#settings-time')).toHaveValue('night');
  await expect(page.locator('#settings-motion')).toHaveAttribute('aria-checked', 'false');
  await page.locator('#open-palette-manager').click();
  await expect(page.locator('#palette-manager-dialog')).toBeVisible();
  await page.locator('#close-palette-manager').click();
  await expect(page.locator('#settings-save')).toBeDisabled();
  await page.locator('#settings-cancel').click();
  await page.locator('#new-campaign').click();
  await expect(page.locator('#cc-palette')).toHaveValue('glacial');
  await expect(page.locator('#cc-create')).toBeEnabled();
  await page.locator('#cc-create').click();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-time-of-day', 'night');
  await expect(page.locator('#hp-scene canvas')).toHaveAttribute('data-motion', 'still');
  const created = (await library(page)).campaigns.at(-1);
  expect(created.timeOfDay).toBe('night');
  expect(created.paletteName).toBe('Frozen synapse');
  // Saved campaigns retain their original presentation instead of adopting defaults.
  await page.locator('#hp-back-menu').click();
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#campaign-workspace')).toHaveAttribute('data-time-of-day', 'day');
});

test('browser Back protects drafts, Forward reopens, and campaign reloads preserve history', async ({
  page,
}) => {
  await openCampaign(page);
  await expect(page).toHaveURL(/\/campaign\/test-campaign\?/);
  await page.locator('#hp-hex-edit').click();
  const before = await page.locator('#hp-hex-terrain').inputValue();
  await page.locator('#hp-hex-terrain').selectOption(before === 'meadow' ? 'woodland' : 'meadow');
  await page.evaluate(() => history.back());
  const draft = page.getByRole('dialog', { name: 'Unsaved edits', exact: true });
  await expect(draft).toBeVisible();
  await expect(page).toHaveURL(/\/campaign\/test-campaign\?/);
  await draft.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('#hp-hex-form')).toHaveClass(/is-editing/);
  await page.evaluate(() => history.back());
  await expect(draft).toBeVisible();
  await draft.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('#campaign-menu')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.evaluate(() => history.forward());
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await page.reload();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(page.locator('#campaign-menu')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
});

test('campaign entry commits even when the browser skips a view transition before its update', async ({
  page,
}) => {
  await page.addInitScript(() => {
    document.startViewTransition = () => ({
      finished: Promise.reject(new DOMException('Transition skipped', 'AbortError')),
      skipTransition() {},
    });
  });
  await openCampaign(page);
  await page.locator('#hp-back-menu').click();
  await expect(page.locator('#campaign-menu')).toBeVisible();
  await page.getByRole('button', { name: 'Enter Test campaign', exact: true }).click();
  await expect(page.locator('#campaign-menu')).toBeHidden();
  await expect(page.locator('#hp-scene canvas')).toBeVisible();
  await expect(page.locator('#campaign-workspace')).not.toHaveAttribute('inert');
});

test('Inspector hides empty feature metadata, keeps proximity, and offers Undo only while editing', async ({
  page,
}, testInfo) => {
  await openCampaign(page);
  const key = await page
    .locator('#hp-selection option')
    .evaluateAll(
      (options) =>
        options.find(
          (option) =>
            option.dataset.terrain &&
            option.dataset.terrain !== 'open water' &&
            !option.dataset.settlement &&
            !option.dataset.poi,
        ).value,
    );
  await page.locator('#hp-selection').selectOption(key);
  for (const field of ['settlement', 'poi', 'crossing'])
    await expect(page.locator(`#hp-hex-${field}`)).toBeHidden();
  await expect(page.locator('#hp-hex-road')).toBeHidden();
  await expect(page.locator('#hp-hex-distance-settlement')).toBeVisible();
  await expect(page.locator('#hp-hex-distance-river')).toBeVisible();
  await expect(page.locator('#hp-hex-undo')).toBeHidden();
  const rows = await page
    .locator('#hp-hex-form .hp-inspector-edit-actions button:visible')
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        label: button.textContent.trim(),
        y: button.getBoundingClientRect().top,
      })),
    );
  expect(rows.map((row) => row.label)).toEqual(['Edit', 'Edit many', 'Reset', 'Regenerate']);
  expect(new Set(rows.map((row) => row.y)).size).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('inspector.png'), fullPage: true });
  await page.locator('#hp-hex-visited').click();
  await page.locator('#hp-hex-edit').click();
  for (const field of ['settlement', 'poi', 'crossing'])
    await expect(page.locator(`#hp-hex-${field}`)).toBeVisible();
  await expect(page.locator('#hp-hex-undo')).toBeEnabled();
  await page.locator('#hp-hex-undo').click();
  await expect(page.locator('#hp-hex-visited')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#hp-hex-form')).toHaveClass(/is-editing/);
  await page.locator('#hp-hex-cancel').click();
  await expect(page.locator('#hp-hex-undo')).toBeHidden();
  await page.locator('#hp-find-party').click();
  await expect(page.locator('#hp-party-weeks')).toHaveText('1');
  await expect(page.getByText('Sessions played', { exact: true })).toHaveCount(0);
});

test('mobile tapping the selected party’s occupied tile inspects it without a move prompt', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile tap interaction');
  await openCampaign(page, { expandInspector: false });
  const partyKey = (await library(page)).campaigns[0].partyToken.key;
  for (const fog of [false, true]) {
    if (fog) await page.locator('#hp-fog').click();
    await page.locator('#hp-find-party').click();
    await expect(page.locator('#hp-selection')).toHaveValue('__party__');
    const canvas = page.locator('#hp-scene canvas');
    const box = await canvas.boundingBox();
    await canvas.tap({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.locator('#hp-move-party-dialog')).toBeHidden();
    await expect(page.locator('#hp-selection')).toHaveValue(partyKey);
    expect((await library(page)).campaigns[0].partyToken.key).toBe(partyKey);
  }
});
