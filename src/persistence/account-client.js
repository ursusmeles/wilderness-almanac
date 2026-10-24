export function createAccountClient(fetcher = globalThis.fetch) {
  async function request(path, { method = 'GET', body, revision } = {}) {
    const response = await fetcher(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      headers: {
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}),
      },
      ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    let value;
    try {
      value = await response.json();
    } catch {
      throw new Error('The account server returned an unreadable response.');
    }
    if (!response.ok) {
      const error = new Error(
        value.message || 'The account request failed. Your local campaigns have been kept.',
      );
      error.status = response.status;
      throw error;
    }
    return value;
  }
  return {
    session: () => request('/auth/get-session'),
    sendCode: (email) =>
      request('/auth/email-otp/send-verification-otp', {
        method: 'POST',
        body: { email, type: 'sign-in' },
      }),
    signIn: (email, otp) =>
      request('/auth/sign-in/email-otp', { method: 'POST', body: { email, otp } }),
    signOut: () => request('/auth/sign-out', { method: 'POST' }),
    list: () => request('/campaigns'),
    get: (id) => request(`/campaigns/${encodeURIComponent(id)}`),
    put: (campaign, revision) =>
      request(`/campaigns/${encodeURIComponent(campaign.id)}`, {
        method: 'PUT',
        revision,
        body: { campaign },
      }),
    remove: (id, revision) =>
      request(`/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE', revision }),
  };
}
