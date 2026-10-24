import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export function connect(path, { readonly = false, fileMustExist = false, wal = true } = {}) {
  if (path !== ':memory:' && !readonly) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { readonly, fileMustExist, timeout: 5000 });
  try {
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    if (!readonly && wal) db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    if (wal && path !== ':memory:' && db.pragma('journal_mode', { simple: true }) !== 'wal')
      throw new Error('The database must use WAL on a local disk.');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function migrate(db, directory = fileURLToPath(new URL('./migrations', import.meta.url))) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const files = readdirSync(directory)
    .filter((name) => /^\d{3}-.+\.sql$/.test(name))
    .sort();
  const applied = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
  if (applied.length > files.length) throw new Error('Database schema is newer than this server.');
  for (const [index, name] of files.entries()) {
    const version = Number(name.slice(0, 3));
    if (version !== index + 1) throw new Error('Schema migration versions must be consecutive.');
    const sql = readFileSync(join(directory, name), 'utf8');
    const sha256 = createHash('sha256').update(sql).digest('hex');
    if (applied[index]) {
      if (applied[index].name !== name || applied[index].sha256 !== sha256)
        throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    db.transaction(() => {
      // Recheck under the write lock if two processes started together.
      const current = db.prepare('SELECT * FROM schema_migrations WHERE version = ?').get(version);
      if (current) {
        if (current.name !== name || current.sha256 !== sha256)
          throw new Error('Migration conflict.');
        return;
      }
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, sha256) VALUES (?, ?, ?)').run(
        version,
        name,
        sha256,
      );
      db.pragma(`user_version = ${version}`);
    }).immediate();
  }
}

export function checkIntegrity(db) {
  if (
    db.pragma('integrity_check', { simple: true }) !== 'ok' ||
    db.pragma('foreign_key_check').length
  )
    throw new Error('Database integrity verification failed.');
  const versions = db
    .prepare('SELECT version, sha256 FROM schema_migrations ORDER BY version')
    .all();
  if (!versions.length) throw new Error('The backup has no application schema.');
  return {
    versions,
    campaigns: db.prepare('SELECT COUNT(*) AS count FROM campaigns').get().count,
    users: db.prepare('SELECT COUNT(*) AS count FROM user').get().count,
  };
}
