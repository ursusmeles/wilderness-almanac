import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, checkIntegrity } from './database.js';

export async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function restoreSnapshot(source, target, { revokeSessions = false } = {}) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(target + suffix))
      throw new Error(
        'Restore target already exists. Restore into an empty directory with the API stopped.',
      );
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const input = connect(source, { readonly: true, fileMustExist: true, wal: false });
  try {
    checkIntegrity(input);
    await input.backup(target);
  } finally {
    input.close();
  }
  const restored = connect(target, { fileMustExist: true });
  try {
    if (revokeSessions)
      restored
        .transaction(() => {
          restored.prepare('DELETE FROM session').run();
          restored.prepare('DELETE FROM verification').run();
        })
        .immediate();
    return checkIntegrity(restored);
  } finally {
    restored.close();
  }
}

export function objectStore(env = process.env) {
  if (
    !env.BACKUP_BUCKET ||
    !env.S3_ENDPOINT ||
    !env.AWS_ACCESS_KEY_ID ||
    !env.AWS_SECRET_ACCESS_KEY
  )
    throw new Error('Configure the off-server S3 backup bucket, endpoint and credentials.');
  const endpoint = new URL(env.S3_ENDPOINT);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password)
    throw new Error('The off-server backup endpoint must use HTTPS.');
  const client = new S3Client({
    endpoint: endpoint.href,
    region: env.AWS_REGION || 'auto',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY },
  });
  return {
    async upload(key, file, sha256) {
      await client.send(
        new PutObjectCommand({
          Bucket: env.BACKUP_BUCKET,
          Key: key,
          Body: createReadStream(file),
          ContentLength: (await stat(file)).size,
          ContentType: 'application/vnd.sqlite3',
          Metadata: { sha256 },
        }),
        { abortSignal: AbortSignal.timeout(120_000) },
      );
    },
    async download(key, file) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: env.BACKUP_BUCKET, Key: key }),
        { abortSignal: AbortSignal.timeout(120_000) },
      );
      await pipeline(response.Body, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    },
  };
}

export async function runBackup({
  databasePath,
  directory,
  store,
  prefix = 'wilderness-almanac',
  now = new Date(),
}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(directory, 'snapshot-'));
  const snapshot = join(work, 'snapshot.sqlite');
  const download = join(work, 'download.sqlite');
  const key = `${prefix}/${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`;
  try {
    const source = connect(databasePath, { readonly: true, fileMustExist: true });
    try {
      await source.backup(snapshot);
    } finally {
      source.close();
    }
    const original = connect(snapshot, { readonly: true, wal: false });
    let expected;
    try {
      expected = checkIntegrity(original);
    } finally {
      original.close();
    }
    const sha256 = await digest(snapshot);
    await store.upload(key, snapshot, sha256);
    await store.download(key, download);
    if ((await digest(download)) !== sha256)
      throw new Error('The downloaded backup checksum does not match.');
    const restored = await restoreSnapshot(download, join(work, 'restored.sqlite'));
    if (JSON.stringify(expected) !== JSON.stringify(restored))
      throw new Error('Restored backup verification failed.');
    const result = {
      key,
      sha256,
      completedAt: now.toISOString(),
      verifiedRestore: true,
      ...restored,
    };
    await writeFile(join(directory, 'last-success.json.tmp'), JSON.stringify(result), {
      mode: 0o600,
    });
    await rename(join(directory, 'last-success.json.tmp'), join(directory, 'last-success.json'));
    return result;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function interval(env) {
  const hours = Number(env.BACKUP_INTERVAL_HOURS || 6);
  if (!Number.isFinite(hours) || hours < 1 || hours > 24)
    throw new Error('BACKUP_INTERVAL_HOURS must be between 1 and 24.');
  return hours * 60 * 60 * 1000;
}

async function main() {
  process.umask(0o077);
  const env = process.env;
  const directory = env.BACKUP_DIRECTORY || '/backups';
  const databasePath = env.DATABASE_PATH || '/data/wilderness-almanac.sqlite';
  const action = process.argv[2] || 'once';
  if (action === 'health') {
    const result = JSON.parse(await readFile(join(directory, 'last-success.json'), 'utf8'));
    if (!result.verifiedRestore || Date.now() - Date.parse(result.completedAt) > interval(env) * 2)
      throw new Error('No recent verified off-server backup.');
    return;
  }
  if (action === 'restore') {
    const [key, target] = process.argv.slice(3);
    if (!key || !target) throw new Error('Usage: backup.js restore OBJECT_KEY NEW_DATABASE_PATH');
    // Restore never overwrites an existing database or its WAL sidecars.
    const work = await mkdtemp(join('/tmp/', 'wilderness-almanac-restore-'));
    try {
      const file = join(work, 'snapshot.sqlite');
      await objectStore(env).download(key, file);
      const result = await restoreSnapshot(file, resolve(target), { revokeSessions: true });
      console.log('Restore verified:', JSON.stringify(result));
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    return;
  }
  if (!['once', 'loop'].includes(action)) throw new Error('Unknown backup action.');
  const store = objectStore(env);
  do {
    let wait = interval(env);
    try {
      const result = await runBackup({
        databasePath,
        directory,
        store,
        prefix: env.BACKUP_PREFIX || 'wilderness-almanac',
      });
      console.log('Off-server backup and downloaded restore verified:', result.key);
    } catch (error) {
      if (action !== 'loop') throw error;
      console.error('Backup failed; retrying in one minute:', error.name);
      wait = 60_000;
    }
    if (action === 'once') break;
    await delay(wait);
  } while (true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
