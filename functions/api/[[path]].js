// Cloudflare Pages keeps auth cookies on the frontend origin. No secret or
// office-server URL is compiled into the browser bundle.
export async function onRequest({ request, env }) {
  let origin;
  try {
    origin = new URL(env.API_ORIGIN);
    if (
      origin.protocol !== 'https:' ||
      origin.pathname !== '/' ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash
    )
      throw new Error('Invalid API origin');
    if (origin.origin === new URL(request.url).origin) throw new Error('Proxy loop');
    if (!env.API_PROXY_SECRET || env.API_PROXY_SECRET.length < 32)
      throw new Error('Missing proxy secret');
  } catch {
    return Response.json(
      { message: 'Account sync is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const target = new URL(request.url);
  target.protocol = origin.protocol;
  target.host = origin.host;
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('forwarded');
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-for');
  headers.set('x-forwarded-proto', 'https');
  // These values come from the trusted edge, never from caller-supplied headers.
  headers.set('x-wilderness-almanac-proxy-key', env.API_PROXY_SECRET);
  headers.set('x-wilderness-almanac-client-ip', request.headers.get('cf-connecting-ip') || '');
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    });
    const output = new Response(response.body, response);
    output.headers.set('Cache-Control', 'no-store');
    return output;
  } catch {
    return Response.json(
      {
        message:
          'The account server is unavailable. Your local campaigns are still saved in this browser.',
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
