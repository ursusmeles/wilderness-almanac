import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import {
  APIError,
  expectedRevision,
  saveCampaign,
  getCampaign,
  deleteCampaign,
} from './campaigns.js';
import {
  exportCampaign,
  campaignFilename,
  MAX_CAMPAIGN_BYTES,
} from '../src/application/campaigns.js';

const authRoutes = new Set([
  'POST /api/auth/email-otp/send-verification-otp',
  'POST /api/auth/sign-in/email-otp',
  'POST /api/auth/sign-out',
  'GET /api/auth/get-session',
]);

export function createApp({ db, auth, config }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    if (c.req.path.startsWith('/api/')) {
      if (config.production) {
        const expected = Buffer.from(config.proxySecret || '');
        const received = Buffer.from(c.req.header('x-wilderness-almanac-proxy-key') || '');
        if (
          !expected.length ||
          received.length !== expected.length ||
          !timingSafeEqual(received, expected)
        )
          return c.json({ message: 'Use the application HTTPS endpoint.' }, 403);
        if (!isIP(c.req.header('x-wilderness-almanac-client-ip') || ''))
          return c.json({ message: 'A trusted client address is required.' }, 400);
      }
      // The production port is private; Cloudflare terminates external TLS.
      if (config.production && c.req.header('x-forwarded-proto') !== 'https')
        return c.json({ message: 'HTTPS is required.' }, 400);
      const origin = c.req.header('origin');
      if (
        (origin && origin !== config.appOrigin) ||
        c.req.header('sec-fetch-site') === 'cross-site'
      )
        return c.json({ message: 'Untrusted request origin.' }, 403);
      if (!['GET', 'HEAD'].includes(c.req.method)) {
        if (origin !== config.appOrigin)
          return c.json({ message: 'An application origin is required.' }, 403);
        if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
          return c.json({ message: 'Send a JSON request.' }, 415);
      }
    }
    await next();
  });
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_CAMPAIGN_BYTES + 4096,
      onError: (c) => c.json({ message: 'The request exceeds the campaign size limit.' }, 413),
    }),
  );
  app.get('/healthz', (c) => {
    db.prepare('SELECT 1').get();
    return c.json({ status: 'ok' });
  });
  app.on(['GET', 'POST'], '/api/auth/*', (c) => {
    if (!authRoutes.has(`${c.req.method} ${c.req.path}`)) return c.notFound();
    return auth.handler(c.req.raw);
  });
  app.use('/api/campaigns/*', async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user?.id) return c.json({ message: 'Sign in to access account campaigns.' }, 401);
    c.set('owner', session.user.id);
    await next();
  });
  app.get('/api/campaigns', (c) => {
    const campaigns = db
      .prepare(
        `SELECT id, revision, updated_at AS updatedAt,
      json_extract(document, '$.name') AS name FROM campaigns
      WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id`,
      )
      .all(c.get('owner'));
    return c.json({ campaigns });
  });
  app.get('/api/campaigns/:id/export', (c) => {
    const result = getCampaign(db, c.get('owner'), c.req.param('id'));
    const filename = campaignFilename(result.campaign).replace(/[^a-zA-Z0-9._-]/g, '_');
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('ETag', `"${result.revision}"`);
    return c.body(exportCampaign(result.campaign));
  });
  app.get('/api/campaigns/:id', (c) => {
    const result = getCampaign(db, c.get('owner'), c.req.param('id'));
    c.header('ETag', `"${result.revision}"`);
    return c.json(result);
  });
  app.put('/api/campaigns/:id', async (c) => {
    const expected = expectedRevision(c.req.header('if-match'));
    let body;
    try {
      body = await c.req.json();
    } catch {
      throw new APIError(400, 'Invalid JSON.');
    }
    const result = saveCampaign(db, c.get('owner'), c.req.param('id'), expected, body?.campaign);
    c.header('ETag', `"${result.revision}"`);
    return c.json(result, expected === 0 ? 201 : 200);
  });
  app.delete('/api/campaigns/:id', (c) =>
    c.json(
      deleteCampaign(
        db,
        c.get('owner'),
        c.req.param('id'),
        expectedRevision(c.req.header('if-match')),
      ),
    ),
  );
  app.onError((error, c) => {
    if (error instanceof APIError) return c.json({ message: error.message }, error.status);
    if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_BUSY_SNAPSHOT') {
      c.header('Retry-After', '1');
      return c.json({ message: 'The database is busy. Retry shortly.' }, 503);
    }
    console.error('API request failed:', error.code || error.name);
    return c.json({ message: 'The request could not be completed.' }, 500);
  });
  return app;
}
