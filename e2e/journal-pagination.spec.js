import { test, expect } from '@playwright/test';

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
