import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, migrate } from '../database.js';
import { createAuth } from '../auth.js';
import { createApp } from '../app.js';
import { importCampaign } from '../../src/application/campaigns.js';

export const campaign = {
  id: 'campaign-1',
  name: 'Office campaign',
  seed: '7',
  generatorVersion: 8,
  variant: 0,
  createdAt: '2026-10-24T00:00:00.000Z',
  paletteName: 'Dusk',
  colors: ['#cdab8f', '#0b365e', '#11b329'],
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wilderness-almanac-api-test-'));
  const db = connect(join(directory, 'app.sqlite'));
  migrate(db);
  const config = {
    production: true,
    appOrigin: 'https://almanac.example.com',
    proxySecret: 'test-only-proxy-secret-with-more-than-32-characters',
    secret: 'test-only-auth-secret-with-more-than-32-characters',
    resendKey: 're_test_not_a_real_key',
    resendFrom: 'Wilderness Almanac <login@example.com>',
  };
  const codes = new Map();
  const auth = createAuth(db, config, { deliverOTP: ({ email, otp }) => codes.set(email, otp) });
  await auth.$context;
  const app = createApp({ db, auth, config });
  const request = (path, { method = 'GET', cookie = '', body, headers = {} } = {}) =>
    app.request(`https://almanac.example.com${path}`, {
      method,
      headers: {
        'x-forwarded-proto': 'https',
        origin: config.appOrigin,
        cookie,
        'content-type': 'application/json',
        'x-wilderness-almanac-client-ip': '192.0.2.7',
        'x-wilderness-almanac-proxy-key': config.proxySecret,
        ...headers,
      },
      ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  async function login(email) {
    const sent = await request('/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      body: { email, type: 'sign-in' },
    });
    assert.equal(sent.status, 200, await sent.text());
    const response = await request('/api/auth/sign-in/email-otp', {
      method: 'POST',
      body: { email, otp: codes.get(email) },
    });
    assert.equal(response.status, 200, await response.clone().text());
    const cookies = response.headers.getSetCookie();
    assert.ok(
      cookies.some(
        (value) => /HttpOnly/i.test(value) && /Secure/.test(value) && /SameSite=Lax/i.test(value),
      ),
    );
    return cookies.map((value) => value.split(';')[0]).join('; ');
  }
  t.after(async () => {
    if (db.open) db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { db, auth, request, login, codes };
}

test('real email OTP authentication hashes codes, rejects reuse, and revokes sessions', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/campaigns')).status, 401);
  const cookie = await f.login('alice@example.com');
  const session = await (await f.request('/api/auth/get-session', { cookie })).json();
  assert.equal(session.user.email, 'alice@example.com');
  const replay = await f.request('/api/auth/sign-in/email-otp', {
    method: 'POST',
    body: { email: 'alice@example.com', otp: f.codes.get('alice@example.com') },
  });
  assert.notEqual(replay.status, 200);
  await f.request('/api/auth/email-otp/send-verification-otp', {
    method: 'POST',
    body: { email: 'bob@example.com', type: 'sign-in' },
  });
  const values = f.db.prepare('SELECT value FROM verification').all();
  assert.ok(values.length);
  assert.ok(values.every(({ value }) => !value.includes(f.codes.get('bob@example.com'))));
  assert.equal((await f.request('/api/auth/get-verification-otp')).status, 404);
  assert.equal((await f.request('/api/auth/sign-out', { method: 'POST', cookie })).status, 200);
  assert.equal((await f.request('/api/campaigns', { cookie })).status, 401);
});

test('campaign reads, writes, exports and deletions enforce ownership', async (t) => {
  const f = await fixture(t);
  const alice = await f.login('alice@example.com');
  const bob = await f.login('bob@example.com');
  assert.equal(
    (
      await f.request('/api/campaigns/campaign-1', {
        method: 'PUT',
        cookie: alice,
        headers: { 'if-match': '"0"' },
        body: { campaign },
      })
    ).status,
    201,
  );
  assert.equal((await f.request('/api/campaigns/campaign-1', { cookie: bob })).status, 404);
  assert.equal((await f.request('/api/campaigns/campaign-1/export', { cookie: bob })).status, 404);
  assert.equal(
    (
      await f.request('/api/campaigns/campaign-1', {
        method: 'DELETE',
        cookie: bob,
        headers: { 'if-match': '"1"' },
      })
    ).status,
    409,
  );
  assert.equal((await f.request('/api/campaigns', { cookie: bob })).status, 200);
  assert.deepEqual(
    (await (await f.request('/api/campaigns', { cookie: bob })).json()).campaigns,
    [],
  );
  assert.equal(
    (
      await f.request('/api/campaigns/campaign-1', {
        method: 'PUT',
        cookie: bob,
        headers: { 'if-match': '"0"' },
        body: { campaign: { ...campaign, name: 'Bob world' } },
      })
    ).status,
    201,
  );
  const list = await (await f.request('/api/campaigns', { cookie: alice })).json();
  assert.equal(list.campaigns[0].name, campaign.name);
  assert.equal(list.campaigns.length, 1);
  const exported = await f.request('/api/campaigns/campaign-1/export', { cookie: alice });
  assert.equal(exported.headers.get('etag'), '"1"');
  assert.deepEqual(importCampaign(await exported.text()), campaign);
});

test('conditional saves reject stale revisions and deletion cannot reset revision identity', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login('alice@example.com');
  const save = (revision, name) =>
    f.request('/api/campaigns/campaign-1', {
      method: 'PUT',
      cookie,
      headers: { 'if-match': `"${revision}"` },
      body: { campaign: { ...campaign, name } },
    });
  assert.equal((await save(0, 'First')).status, 201);
  assert.equal((await save(1, 'Second')).status, 200);
  assert.equal((await save(1, 'Stale edit')).status, 409);
  assert.equal(
    (await (await f.request('/api/campaigns/campaign-1', { cookie })).json()).campaign.name,
    'Second',
  );
  assert.equal(
    (
      await f.request('/api/campaigns/campaign-1', {
        method: 'DELETE',
        cookie,
        headers: { 'if-match': '"1"' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request('/api/campaigns/campaign-1', {
        method: 'DELETE',
        cookie,
        headers: { 'if-match': '"2"' },
      })
    ).status,
    200,
  );
  assert.equal((await save(0, 'Resurrect stale data')).status, 409);
  assert.equal((await save(2, 'Old revision')).status, 409);
  assert.equal((await f.request('/api/campaigns/campaign-1', { cookie })).status, 404);
});

test('account copies and version-3 exports preserve journal results and reject malformed references', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login('journal@example.com');
  const value = {
    ...campaign,
    seed: 'heliotest',
    generatorVersion: 10,
    partyToken: { key: '0,0', style: 'warden', weeks: 2 },
    journal: [{ id: 1, week: 2, kind: 'oracle', text: 'Oracle: Yes (d6: 5 = 5)', mentions: [] }],
  };
  const saved = await f.request('/api/campaigns/campaign-1', {
    method: 'PUT',
    cookie,
    headers: { 'if-match': '"0"' },
    body: { campaign: value },
  });
  assert.equal(saved.status, 201);
  const loaded = await (await f.request('/api/campaigns/campaign-1', { cookie })).json();
  assert.deepEqual(loaded.campaign, value);
  const exported = await (await f.request('/api/campaigns/campaign-1/export', { cookie })).text();
  assert.equal(JSON.parse(exported).version, 3);
  assert.deepEqual(importCampaign(exported), value);
  const bad = {
    ...value,
    journal: [
      { ...value.journal[0], mentions: [{ type: 'hex', key: '999,999', start: 0, end: 3 }] },
    ],
  };
  const rejected = await f.request('/api/campaigns/campaign-1', {
    method: 'PUT',
    cookie,
    headers: { 'if-match': '"1"' },
    body: { campaign: bad },
  });
  assert.equal(rejected.status, 400);
  const unchanged = await (await f.request('/api/campaigns/campaign-1', { cookie })).json();
  assert.equal(unchanged.revision, 1);
});

test('HTTPS, trusted origins, content type, required revisions and input bounds are enforced', async (t) => {
  const f = await fixture(t);
  const cookie = await f.login('alice@example.com');
  const base = { method: 'PUT', cookie, body: { campaign } };
  assert.equal((await f.request('/api/campaigns/campaign-1', base)).status, 428);
  assert.equal(
    (
      await f.request('/api/campaigns/campaign-1', {
        ...base,
        headers: { 'if-match': '"0"', origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request('/api/campaigns/campaign-1', { ...base, headers: { origin: '' } })).status,
    403,
  );
  assert.equal(
    (await f.request('/api/campaigns', { cookie, headers: { 'x-forwarded-proto': 'http' } }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.request('/api/campaigns', {
        cookie,
        headers: { 'x-wilderness-almanac-proxy-key': '' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request('/api/campaigns', {
        cookie,
        headers: { 'x-wilderness-almanac-client-ip': '' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request('/api/campaigns/campaign-1', {
        ...base,
        headers: { 'content-type': 'text/plain' },
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await f.request('/api/campaigns/campaign-1', {
        ...base,
        headers: { 'if-match': '"0"' },
        body: { campaign: { ...campaign, generatorVersion: 999 } },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request('/api/campaigns/campaign-1', {
        ...base,
        headers: { 'if-match': '"0"' },
        body: { padding: 'x'.repeat(16 * 1024 * 1024 + 5000) },
      })
    ).status,
    413,
  );
  assert.equal(f.db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(f.db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(f.db.pragma('busy_timeout', { simple: true }), 5000);
  assert.equal(f.db.pragma('synchronous', { simple: true }), 2);
  f.db.prepare('UPDATE session SET expiresAt = 0').run();
  assert.equal((await f.request('/api/campaigns', { cookie })).status, 401);
});

test('email OTP sends are rate limited using the trusted edge client address', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 3; index++) {
    assert.equal(
      (
        await f.request('/api/auth/email-otp/send-verification-otp', {
          method: 'POST',
          body: { email: 'alice@example.com', type: 'sign-in' },
        })
      ).status,
      200,
    );
  }
  assert.equal(
    (
      await f.request('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        body: { email: 'alice@example.com', type: 'sign-in' },
      })
    ).status,
    429,
  );
});

test('versioned migrations are atomic and refuse edited applied migrations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wilderness-almanac-migrate-test-'));
  const db = connect(join(directory, 'app.sqlite'));
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(join(directory, '001-first.sql'), 'CREATE TABLE first (id TEXT PRIMARY KEY);');
  migrate(db, directory);
  migrate(db, directory);
  assert.equal(db.pragma('user_version', { simple: true }), 1);
  await writeFile(join(directory, '002-broken.sql'), 'CREATE TABLE second (id TEXT); INVALID SQL;');
  assert.throws(() => migrate(db, directory));
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'second'").get(), undefined);
  assert.equal(db.pragma('user_version', { simple: true }), 1);
  const original = await readFile(join(directory, '001-first.sql'), 'utf8');
  await writeFile(join(directory, '001-first.sql'), original + '\n-- edited');
  assert.throws(() => migrate(db, directory), /Applied migration changed/);
});
