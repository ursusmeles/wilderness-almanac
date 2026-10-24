import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, migrate } from '../database.js';
import { runBackup, restoreSnapshot } from '../backup.js';

test('online backup includes committed WAL data and a downloaded copy restores consistently', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wilderness-almanac-backup-test-'));
  const path = join(directory, 'live.sqlite');
  const db = connect(path);
  migrate(db);
  db.prepare('INSERT INTO user VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'owner',
    'Owner',
    'owner@example.com',
    1,
    null,
    Date.now(),
    Date.now(),
  );
  db.prepare(
    'INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('session', Date.now() + 60000, 'old-session', Date.now(), Date.now(), 'owner');
  db.prepare('INSERT INTO campaigns VALUES (?, ?, ?, ?, ?, ?)').run(
    'owner',
    'one',
    1,
    '{"name":"Committed WAL record"}',
    new Date().toISOString(),
    null,
  );
  await access(path + '-wal');
  let uploaded;
  const store = {
    async upload(key, file) {
      uploaded = { key, bytes: await readFile(file) };
      // Writes continue after the snapshot without altering its point in time.
      db.prepare('UPDATE campaigns SET revision = 2').run();
    },
    async download(key, file) {
      assert.equal(key, uploaded.key);
      await writeFile(file, uploaded.bytes);
    },
  };
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const result = await runBackup({ databasePath: path, directory: join(directory, 'work'), store });
  assert.equal(result.verifiedRestore, true);
  assert.equal(result.campaigns, 1);
  const snapshot = join(directory, 'remote-copy.sqlite');
  await writeFile(snapshot, uploaded.bytes);
  const restoredPath = join(directory, 'restore', 'app.sqlite');
  await restoreSnapshot(snapshot, restoredPath, { revokeSessions: true });
  const restored = connect(restoredPath);
  assert.equal(restored.prepare('SELECT revision FROM campaigns').get().revision, 1);
  assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM session').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM session').get().count, 1);
  assert.equal(db.prepare('SELECT revision FROM campaigns').get().revision, 2);
  restored.close();
  await assert.rejects(restoreSnapshot(snapshot, path), /already exists/);
  const status = JSON.parse(await readFile(join(directory, 'work', 'last-success.json'), 'utf8'));
  assert.equal(status.sha256, result.sha256);
});

test('corrupted downloads never record a successful off-server backup', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'wilderness-almanac-bad-backup-'));
  const path = join(directory, 'live.sqlite');
  const db = connect(path);
  migrate(db);
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const work = join(directory, 'work');
  await assert.rejects(
    runBackup({
      databasePath: path,
      directory: work,
      store: {
        async upload() {},
        async download(_key, file) {
          await writeFile(file, 'broken');
        },
      },
    }),
    /checksum/,
  );
  await assert.rejects(access(join(work, 'last-success.json')));
});
