import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignSync, campaignHash } from '../src/application/campaign-sync.js';
import { createAccountClient } from '../src/persistence/account-client.js';

const campaign = {
  id: 'one',
  name: 'Campaign',
  seed: '7',
  generatorVersion: 8,
  variant: 0,
  createdAt: '2026-10-24T00:00:00.000Z',
  paletteName: 'Dusk',
  colors: ['#cdab8f', '#0b365e', '#11b329'],
};

function fixture() {
  let local = structuredClone(campaign);
  let remote = { campaign: structuredClone(campaign), revision: 1 };
  const states = new Map();
  const copies = [];
  const writes = [];
  const store = {
    async remoteState(account, id) {
      return structuredClone(states.get(`${account}:${id}`));
    },
    async rememberRemote(account, id, value, expected) {
      const key = `${account}:${id}`;
      if ((states.get(key)?.revision ?? 0) !== (expected?.revision ?? 0))
        throw new Error('Metadata conflict');
      states.set(key, { revision: (expected?.revision ?? 0) + 1, value });
    },
  };
  const library = {
    snapshotCampaigns: () => (local ? [structuredClone(local)] : []),
    async applyRemote(next, expected = null) {
      if (next.id !== campaign.id) {
        copies.push(next);
        return;
      }
      assert.deepEqual(local, expected);
      local = structuredClone(next);
    },
  };
  const client = {
    get: async () => structuredClone(remote),
    async put(value, revision) {
      writes.push({ value, revision });
      if (revision !== remote.revision) throw new Error('Server revision conflict');
      remote = { campaign: structuredClone(value), revision: revision + 1 };
      return remote;
    },
  };
  return {
    store,
    library,
    client,
    states,
    copies,
    writes,
    sync: (accountId = 'alice') => createCampaignSync({ client, store, library, accountId }),
    local: () => local,
    remote: () => remote,
    editLocal(name) {
      local.name = name;
    },
    editRemote(name) {
      remote.campaign.name = name;
      remote.revision++;
    },
    clearLocal() {
      local = null;
    },
  };
}

test('sync loads unmodified local data but preserves divergent edits as separate copies', async () => {
  const f = fixture();
  await f.sync().load('one');
  f.editRemote('New account version');
  await f.sync().load('one');
  assert.equal(f.local().name, 'New account version');
  f.editLocal('Offline edits');
  f.editRemote('Other device edits');
  await assert.rejects(f.sync().load('one'), /unsynced changes/);
  assert.equal(f.local().name, 'Offline edits');
  const copy = await f.sync().load('one', { asCopy: true });
  assert.notEqual(copy.id, campaign.id);
  assert.equal(copy.name, 'Other device edits');
  assert.equal(f.copies.length, 1);
  assert.equal(f.local().name, 'Offline edits');
});

test('uploads carry the last acknowledged revision and never force overwrite', async () => {
  const f = fixture();
  await assert.rejects(f.sync().upload('one'), /revision conflict/);
  assert.equal(f.writes[0].revision, 0);
  await f.sync().load('one');
  f.editLocal('Edit after loading');
  await f.sync().upload('one');
  assert.equal(f.writes[1].revision, 1);
  assert.equal(f.remote().campaign.name, 'Edit after loading');
  f.editRemote('Concurrent device');
  await assert.rejects(f.sync().upload('one'), /revision conflict/);
  assert.equal(f.remote().campaign.name, 'Concurrent device');
  assert.equal(f.local().name, 'Edit after loading');
});

test('sync revisions are isolated by account and never acknowledge unsent local changes', async () => {
  const f = fixture();
  await f.sync('alice').load('one');
  await assert.rejects(f.sync('bob').upload('one'), /revision conflict/);
  const originalPut = f.client.put;
  f.client.put = async (...args) => {
    const result = await originalPut(...args);
    f.editLocal('Newer in-memory work');
    return result;
  };
  await f.sync('alice').upload('one');
  const saved = f.states.get('alice:one').value;
  assert.notEqual(saved.hash, await campaignHash(f.local()));
  assert.equal(saved.hash, await campaignHash(f.remote().campaign));
});

test('loads do not replace newer local edits that arrived while the network request ran', async () => {
  const f = fixture();
  await f.sync().load('one');
  f.client.get = async () => {
    f.editLocal('Edited during download');
    return { campaign: { ...campaign, name: 'Server changes' }, revision: 2 };
  };
  await assert.rejects(f.sync().load('one'), /unsynced changes/);
  assert.equal(f.local().name, 'Edited during download');
});

test('HTTP client keeps tokens out of browser storage and sends conditional same-origin writes', async () => {
  const calls = [];
  const client = createAccountClient(async (url, options) => {
    calls.push({ url, options });
    return Response.json({ revision: 3 });
  });
  await client.put(campaign, 2);
  assert.equal(calls[0].url, '/api/campaigns/one');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers['If-Match'], '"2"');
  const failing = createAccountClient(async () =>
    Response.json({ message: 'Changed on server' }, { status: 409 }),
  );
  await assert.rejects(
    failing.put(campaign, 1),
    (error) => error.status === 409 && error.message === 'Changed on server',
  );
});
