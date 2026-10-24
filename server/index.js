import { serve } from '@hono/node-server';
import { configuration } from './config.js';
import { connect, migrate } from './database.js';
import { createAuth } from './auth.js';
import { createApp } from './app.js';

process.umask(0o077);
const config = configuration();
const db = connect(config.databasePath);
migrate(db);
const auth = createAuth(db, config);
const app = createApp({ db, auth, config });
const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, () => {
  console.log(`Wilderness Almanac API listening on port ${config.port}`);
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
