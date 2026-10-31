import { test, expect } from '@playwright/test';

const commands = [
  '/help',
  '/clear',
  '/abstract',
  '/explore',
  '/oracle',
  '/d4',
  '/d6',
  '/d8',
  '/d10',
  '/d12',
  '/d20',
];

test('oracle entries show a single result badge with modifiers, copy and reroll preserved', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?seed=heliotest&generator=10');
  await page.locator('#hp-find-party').click();
  const input = page.locator('#hp-journal-input'),
    entries = page.locator('#hp-journal-entries .hp-journal-oracle');
  await page.evaluate(() => {
    window.journalRandom = Math.random;
    Math.random = () => 0.99;
  });
  for (const command of ['/oracle', '/oracle -1 Is it safe?', '/oracle -100']) {
    await input.fill(command);
    await page.locator('#hp-journal-add').click();
  }
  await expect(entries.locator('kbd')).toHaveText(['6', '5', '1']);
  await expect(entries.first().locator('.hp-journal-entry-text')).toHaveText('Oracle: 6 Yes, and…');
  await expect(page.locator('#hp-journal-entries')).not.toContainText('d6:');
  await expect(entries.nth(1)).toContainText('Is it safe?');
  await entries.nth(1).focus();
  await entries.nth(1).getByRole('button', { name: 'Copy journal entry' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Is it safe?\nOracle: 5 Yes.',
  );
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await entries.nth(1).focus();
  await entries.nth(1).getByRole('button', { name: 'Reroll journal entry' }).click();
  await expect(entries.nth(1).locator('kbd')).toHaveText('1');
  await expect(entries.nth(1)).toContainText('Is it safe?');
  await page.evaluate(() => {
    Math.random = window.journalRandom;
  });
  await page.screenshot({ path: info.outputPath('oracle-results.png'), fullPage: true });
  await page.reload();
  await page.locator('#hp-find-party').click();
  await expect(entries.locator('kbd')).toHaveText(['6', '1', '1']);
  await expect(page.locator('#hp-journal-entries')).not.toContainText('d6:');
  expect(errors).toEqual([]);
});

test('journal selection, week pages, commands, mentions and entry actions work on desktop and mobile', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?seed=heliotest&generator=10');
  const workspace = page.locator('#campaign-workspace'),
    title = page.locator('#hp-tracker-title');
  const input = page.locator('#hp-journal-input'),
    entries = page.locator('#hp-journal-entries');
  const add = page.locator('#hp-journal-add'),
    week = page.locator('#hp-journal-week');
  const nav = (name) => page.locator(`[data-week-page="${name}"]`);
  async function write(text) {
    await input.fill(text);
    await add.click();
  }
  await expect(workspace).toHaveAttribute('data-hex-count', '7');
  await expect(title).toHaveText('Journal');
  await expect(input).toBeHidden();
  await page.locator('#hp-find-party').click();
  await expect(page.locator('.hp-party-panel')).toBeVisible();
  await expect(page.locator('#hp-party-name')).toHaveValue('Adventurers');
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('placeholder', 'Write a note or type / for commands');
  await expect(page.locator('.hp-journal h3')).toHaveCount(0);
  await expect(page.locator('.hp-journal-input-meta')).toHaveCount(0);
  await expect(page.locator('#hp-party-keyboard-help')).toHaveCount(0);
  await expect(page.locator('.hp-journal-pagination [data-tooltip]')).toHaveCount(0);
  await expect(page.locator('.hp-journal-pagination')).toHaveCSS('gap', '8px');
  await expect(page.locator('#hp-journal-count')).toHaveCSS('position', 'absolute');
  await expect(input).toHaveCSS('padding-top', '8px');
  expect(await page.locator('.hp-journal-input-wrap').locator('#hp-journal-count').count()).toBe(1);
  const positions = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    return {
      log: box('#hp-journal-log').x,
      panel: box('.hp-party-panel').x,
      logBottom: box('#hp-journal-log').bottom,
      logTop: box('#hp-journal-log').top,
      metadataBottom: box('.hp-party-overview').bottom,
      rolls: box('.hp-journal-actions').top,
      rollHeight: box('.hp-journal-actions button').height,
      normalHeight: box('#hp-find-party').height,
      input: box('#hp-journal-form').top,
    };
  });
  expect(Math.abs(positions.log - positions.panel)).toBeLessThan(2);
  expect(Math.abs(positions.logTop - positions.metadataBottom)).toBeLessThan(2);
  expect(positions.rollHeight).toBe(positions.normalHeight);
  expect(positions.rolls).toBeGreaterThanOrEqual(positions.logBottom);
  expect(positions.input).toBeGreaterThan(positions.rolls);
  if (testInfo.project.name === 'desktop') {
    async function aligned() {
      return page.evaluate(() =>
        Math.abs(
          document.querySelector('#hp-journal-input').getBoundingClientRect().top -
            document.querySelector('#hp-map-options').getBoundingClientRect().top,
        ),
      );
    }
    await expect.poll(aligned).toBeLessThan(2);
    await page.locator('#hp-appearance-settings').click();
    await expect.poll(aligned).toBeLessThan(2);
    await page.locator('#settings-cancel').click();
    await expect.poll(aligned).toBeLessThan(2);
  }
  await page.keyboard.press('+');
  await expect(page.locator('html')).toHaveAttribute('data-map-input', 'pointer');
  await page.keyboard.press('-');
  await expect(page.locator('html')).toHaveAttribute('data-map-input', 'pointer');

  await input.fill('/');
  const suggested = await page.locator('#hp-journal-suggestions [role="option"]').allTextContents();
  expect(suggested.map((text) => text.split(' · ')[0])).toEqual(commands);
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('Tab');
  await expect(input).toHaveValue('/abstract ');
  await add.click();
  const abstract = entries.locator('.hp-journal-abstract');
  await expect(abstract).toContainText('Abstract:');
  await expect(abstract.locator('.hp-journal-entry-text')).toHaveText(/\.$/);
  await expect(abstract.locator('.hp-journal-entry-text')).toHaveCSS('text-wrap-style', 'pretty');
  await abstract.focus();
  const reroll = abstract.getByRole('button', { name: 'Reroll journal entry', exact: true });
  await expect(reroll).toHaveAttribute('data-tooltip', 'Reroll');
  await expect(abstract.getByRole('button', { name: 'Edit journal entry' })).toBeHidden();
  await abstract.getByRole('button', { name: 'Copy journal entry' }).click();
  await expect(abstract.locator('.hp-journal-entry-controls')).toHaveCSS('opacity', '0');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await abstract.locator('.hp-journal-entry-text').textContent(),
  );
  await abstract.focus();
  await reroll.click();
  await expect(abstract.locator('.hp-journal-entry-controls')).toHaveCSS('opacity', '0');
  await expect(abstract).not.toBeFocused();

  await write('/help');
  await expect(entries.locator('.hp-journal-help')).toBeVisible();
  await expect(entries.locator('.hp-journal-help p')).toHaveCount(5);
  for (const symbol of ['@party', '#week', '$hex']) {
    const token = entries.locator('.hp-journal-help-symbol').filter({ hasText: symbol });
    await expect(token).toHaveCount(1);
    expect(await token.evaluate((node) => getComputedStyle(node).color)).not.toBe(
      await token.evaluate((node) => getComputedStyle(node.parentElement).color),
    );
  }
  await page.screenshot({ path: testInfo.outputPath('journal-help.png'), fullPage: true });
  await write('<img src=x onerror=alert(1)>');
  await expect(entries.locator('.hp-journal-help')).toHaveCount(0);
  await expect(entries.locator('img')).toHaveCount(0);
  const note = entries.locator('.hp-journal-note').first();
  const noteId = await note.getAttribute('data-entry-id');
  await note.focus();
  await expect(note.getByRole('button', { name: 'Reroll journal entry' })).toBeHidden();
  await note.getByRole('button', { name: 'Edit journal entry' }).click();
  await expect(input).toHaveValue('<img src=x onerror=alert(1)>');
  await input.fill('A revised manual note.');
  await add.click();
  await expect(note).toContainText('A revised manual note.');
  await expect(note).toHaveAttribute('data-entry-id', noteId);
  await expect(add).toHaveText('Add to Journal');

  await page.locator('#hp-selection').selectOption('1,0');
  await expect(title).toHaveText('Journal');
  await expect(input).toBeHidden();
  const inspectorName = await page.locator('#hp-hex-name').textContent();
  await page.locator('#hp-find-party').click();
  await expect(page.locator('.hp-party-panel')).toBeVisible();
  await expect(page.locator('#hp-party-name')).toHaveValue('Adventurers');
  await input.fill('$1,0');
  await input.press('Tab');
  await expect(input).toHaveValue(`${inspectorName} `);
  await add.click();
  const hex = entries.locator('[data-mention-type="hex"]').last();
  await expect(hex).toHaveText(inspectorName);
  await expect(hex).toHaveCSS('text-decoration-line', 'none');
  expect(await hex.textContent()).not.toMatch(/[$]|Region|1,0/);
  await input.fill('See #1');
  await input.press('Tab');
  await add.click();
  await expect(entries.locator('[data-mention-type="week"]')).toHaveText('Week 1');
  await input.fill('x'.repeat(301));
  await expect(add).toBeDisabled();
  await input.fill('🌿'.repeat(300));
  await expect(add).toBeEnabled();
  await input.fill('');
  await page.evaluate(() => {
    window.journalRandom = Math.random;
    Math.random = () => 0;
  });
  await write('/2d6+1 1d20-d4');
  await page.evaluate(() => {
    Math.random = window.journalRandom;
  });
  const roll = entries.locator('.hp-journal-roll');
  await expect(roll.locator('kbd')).toHaveText(['1', '1', '1', '1']);
  await expect(roll.locator('.hp-journal-entry-text')).toHaveText(
    '2d6+1: 1 + 1 + 1 = 3\n1d20-d4: 1 − 1 = 0.',
  );
  await roll.focus();
  await expect(roll.getByRole('button', { name: 'Edit journal entry' })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('journal-controls.png'), fullPage: true });

  await nav('last').click();
  await expect(week).toHaveText('Week 2');
  await expect(entries.locator('.hp-journal-entry')).toHaveCount(0);
  await expect(input).toBeDisabled();
  await expect(input).toHaveCSS('border-top-style', 'dashed');
  await expect(input).toHaveCSS('opacity', '0.55');
  await expect(input).toHaveAttribute('placeholder', 'Start this week to write in the journal');
  await expect(add).toBeDisabled();
  for (const button of await page.locator('[data-journal-command]').all())
    await expect(button).toBeDisabled();
  await expect(page.locator('#hp-journal-start')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('new-week.png'), fullPage: true });
  await page.locator('#hp-journal-start').click();
  await expect(week).toHaveText('Week 2');
  await expect(input).toBeEnabled();
  await expect(entries.locator('.hp-journal-entry-text')).toHaveText(
    'Adventurers lived another week.',
  );
  await expect(entries.locator('[data-entry-action="regenerate"]')).toBeHidden();
  await expect(entries.locator('[data-entry-action="edit"]')).toBeHidden();
  await expect(entries.locator('[data-entry-action="delete"]')).toBeHidden();
  await expect(page.locator('#hp-party-weeks')).toHaveText('2');
  await input.fill('Go to #1');
  await input.press('Tab');
  await add.click();
  await entries.locator('[data-mention-type="week"]').click();
  await expect(week).toHaveText('Week 1');
  await expect(entries.locator('.hp-journal-week')).toHaveCount(0);
  await write('A later note in Week 1.');
  await abstract.focus();
  await abstract.getByRole('button', { name: 'Delete journal entry' }).click();
  await expect(entries.locator('.hp-journal-abstract')).toHaveCount(0);
  await nav('next').click();
  await expect(week).toHaveText('Week 2');
  await expect(entries).not.toContainText('A later note in Week 1.');
  await nav('next').click();
  await expect(week).toHaveText('Week 3');
  await expect(input).toBeDisabled();
  await nav('first').click();
  await expect(week).toHaveText('Week 1');
  await expect(input).toBeEnabled();

  await page.locator('#hp-back-menu').click();
  await expect(page.locator('.campaign-week')).toHaveText('2');
  await page.reload();
  await page
    .getByRole('button', { name: /^Enter/ })
    .first()
    .click();
  await page.locator('#hp-find-party').click();
  await expect(week).toHaveText('Week 2');
  await entries.locator('[data-mention-type="week"]').click();
  await expect(week).toHaveText('Week 1');
  await expect(entries).toContainText('A revised manual note.');
  await expect(entries).toContainText('A later note in Week 1.');
  await expect(entries.locator('.hp-journal-abstract')).toHaveCount(0);
  await expect(entries.locator('.hp-journal-roll kbd')).toHaveCount(4);
  await nav('next').click();
  await write('/oracle Will we find shelter?');
  await write('/oracle -1');
  await write('/d4');
  await write('/help');
  await expect(entries.locator('.hp-journal-help')).toBeVisible();
  await write('/clear');
  await expect(entries.locator('.hp-journal-help')).toHaveCount(0);
  await expect(entries.locator('.hp-journal-roll')).toHaveCount(0);
  await expect(entries.locator('.hp-journal-oracle')).toHaveCount(1);
  await expect(entries.locator('.hp-journal-oracle')).toContainText('Will we find shelter?');
  await expect(entries.locator('.hp-journal-week')).toHaveCount(1);
  await nav('first').click();
  await expect(entries.locator('.hp-journal-roll')).toHaveCount(0);
  await expect(entries).toContainText('A later note in Week 1.');
  await write('/help');
  await write('/clear');
  await expect(entries.locator('.hp-journal-help')).toHaveCount(0);
  await page.reload();
  await page.locator('#hp-find-party').click();
  await expect(entries.locator('.hp-journal-oracle')).toHaveCount(1);
  await expect(entries.locator('.hp-journal-roll')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('each week filters its entries, retains drafts and loads older messages within that week', async ({
  page,
}) => {
  await page.route('**/src/main.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.goto('/');
  await page.evaluate(async () => {
    const { createPartyJournal } = await import('/src/ui/party-journal.js');
    const { createCampaignSession } = await import('/src/application/campaign-session.js');
    const { generateWorld } = await import('/src/generation/world.js');
    const { createCampaign } = await import('/src/application/campaigns.js');
    const world = generateWorld('heliotest');
    const campaign = createCampaign(world, ['#cdab8f', '#0b365e', '#11b329'], 'Test');
    campaign.partyToken = { key: '0,0', style: 'warden', weeks: 3 };
    campaign.journal = Array.from({ length: 200 }, (_, index) => ({
      id: index + 1,
      week: index < 125 ? 1 : index < 175 ? 2 : 3,
      kind: 'note',
      text: `Entry ${index + 1}: a memory from the road.`,
      mentions: [],
    }));
    const destination = 'Light ash forest with an abbey';
    campaign.journal.push(
      {
        id: 201,
        week: 3,
        kind: 'move',
        text: `Adventurers travelled to ${destination} · Region #1 · 1, 0`,
        mentions: [{ type: 'hex', key: '1,0', start: 25, end: 25 + destination.length }],
      },
      {
        id: 202,
        week: 3,
        kind: 'rename',
        text: 'Adventurers changed name to Wanderers',
        mentions: [],
      },
      { id: 203, week: 3, kind: 'week', text: 'Adventurers lived another week', mentions: [] },
      {
        id: 204,
        week: 3,
        kind: 'move',
        text: 'Adventurers travelled to Region #1 · 1, 0 · Stillwater',
        mentions: [{ type: 'hex', key: '1,0', start: 25, end: 54 }],
      },
    );
    const session = createCampaignSession({
      persist: () => ({ campaignSaved: true, preferencesSaved: true }),
    });
    session.open(campaign, world);
    session.selectParty();
    const host = document.createElement('div');
    host.style.cssText = 'height:600px;max-width:450px';
    document.body.append(host);
    const ui = createPartyJournal(host, {
      isBusy: () => false,
      onMention: () => {},
      onNextWeek() {
        const result = session.nextWeek();
        ui.update(session.snapshot());
        return result;
      },
      onEdit(id, text, mentions) {
        const result = session.editJournal(id, text, mentions);
        if (result.ok) ui.update(session.snapshot());
        return result;
      },
      onSubmit(text, mentions, week) {
        const result = session.addJournal(text, mentions, undefined, { week });
        if (result.ok) ui.update(session.snapshot());
        return result;
      },
    });
    ui.update(session.snapshot());
  });
  const entries = page.locator('.hp-journal-entry'),
    log = page.locator('#hp-journal-log'),
    input = page.locator('#hp-journal-input');
  await expect(page.locator('#hp-journal-week')).toHaveText('Week 3');
  await expect(entries).toHaveCount(29);
  const automatic = page.locator('.hp-journal-move, .hp-journal-rename, .hp-journal-week');
  await expect(automatic).toHaveCount(4);
  for (const entry of await automatic.all()) {
    await entry.focus();
    await expect(entry.locator('[data-entry-action="delete"]')).toBeHidden();
    await expect(entry.locator('.hp-journal-entry-text')).toHaveText(/\.$/);
  }
  const moves = page.locator('.hp-journal-move .hp-journal-entry-text');
  await expect(moves.first()).toHaveText(
    'Adventurers travelled to Light ash forest with an abbey.',
  );
  for (const move of await moves.all())
    await expect(move).not.toContainText(/Region|1, 0|Stillwater/);
  await page.locator('[data-week-page="first"]').click();
  await expect(entries).toHaveCount(50);
  await expect(entries.first()).toContainText('Entry 76:');
  await log.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(entries).toHaveCount(100);
  expect(await log.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await log.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(entries).toHaveCount(125);
  await expect(entries.first()).toContainText('Entry 1:');
  await input.fill('Draft for Week 1');
  await page.locator('[data-week-page="next"]').click();
  await expect(entries).toHaveCount(50);
  await expect(input).toHaveValue('');
  await input.fill('Draft for Week 2');
  await page.locator('[data-week-page="first"]').click();
  await expect(input).toHaveValue('Draft for Week 1');
  const note = entries.last();
  await note.focus();
  await note.getByRole('button', { name: 'Edit journal entry' }).click();
  await expect(input).toHaveValue('Entry 125: a memory from the road.');
  await page.getByRole('button', { name: 'Cancel journal edit' }).click();
  await expect(input).toHaveValue('Draft for Week 1');
  await page.locator('[data-week-page="last"]').click();
  await expect(page.locator('#hp-journal-week')).toHaveText('Week 4');
  await expect(entries).toHaveCount(0);
  await expect(input).toBeDisabled();
  await page.locator('#hp-journal-start').click();
  await expect(input).toBeEnabled();
  await expect(entries).toHaveText('Adventurers lived another week.');
});
