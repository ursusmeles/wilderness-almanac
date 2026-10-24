export function configuration(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const appURL = new URL(env.APP_ORIGIN || 'http://localhost:5173');
  if (appURL.pathname !== '/' || appURL.search || appURL.hash || appURL.username || appURL.password)
    throw new Error('APP_ORIGIN must be an origin without a path or credentials.');
  if (production && appURL.protocol !== 'https:')
    throw new Error('Production APP_ORIGIN must use HTTPS.');
  if (!['https:', 'http:'].includes(appURL.protocol)) throw new Error('Invalid APP_ORIGIN.');
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error('BETTER_AUTH_SECRET needs at least 32 characters.');
  if (production && (!env.API_PROXY_SECRET || env.API_PROXY_SECRET.length < 32))
    throw new Error('API_PROXY_SECRET needs at least 32 characters in production.');
  if (!env.RESEND_API_KEY || !env.RESEND_FROM)
    throw new Error('RESEND_API_KEY and RESEND_FROM are required.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  return {
    production,
    appOrigin: appURL.origin,
    secret,
    proxySecret: env.API_PROXY_SECRET,
    port,
    databasePath: env.DATABASE_PATH || './data/wilderness-almanac.sqlite',
    resendKey: env.RESEND_API_KEY,
    resendFrom: env.RESEND_FROM,
  };
}
