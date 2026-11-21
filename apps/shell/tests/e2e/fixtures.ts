import { test as base, expect, type Page } from '@playwright/test';

export const SERVER = 'http://127.0.0.1:8090';

export interface MockServer {
  devicesCreated: Record<string, unknown>[];
  requests: string[];
}

/** Mocks the PocketBase routes the shell uses in M2. Nothing leaves the machine. */
export async function mockPocketBase(page: Page): Promise<MockServer> {
  const state: MockServer = { devicesCreated: [], requests: [] };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await page.route(`${SERVER}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    state.requests.push(`${req.method()} ${url.pathname}`);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (url.pathname === '/api/health') return json(200, { code: 200, message: 'API is healthy.' });
    if (url.pathname === '/api/collections/users/auth-with-password') {
      const body = req.postDataJSON() as { identity: string; password: string };
      if (body.password !== 'correct-horse') return json(400, { status: 400, message: 'Failed to authenticate.', data: {} });
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = `x.${Buffer.from(JSON.stringify({ exp, type: 'auth', collectionId: '_pb_users_auth_' })).toString('base64url')}.y`;
      return json(200, { token, record: { id: 'user00000000001', email: body.identity, name: 'Nick', collectionName: 'users', collectionId: '_pb_users_auth_' } });
    }
    if (url.pathname === '/api/collections/core_devices/records' && req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>;
      state.devicesCreated.push(body);
      return json(200, { id: 'device000000001', ...body });
    }
    if (url.pathname.startsWith('/api/collections/core_devices/records/')) return json(200, { id: url.pathname.split('/').pop() });
    return json(404, { status: 404, message: 'Not found (mock)', data: {} });
  });
  return state;
}

export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Server URL').fill(SERVER);
  await page.getByLabel('Email').fill('nick@example.test');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByTestId('tile-hello')).toBeVisible();
}

export const test = base.extend<{ server: MockServer }>({
  server: async ({ page }, use) => {
    await use(await mockPocketBase(page));
  },
});

export { expect };
