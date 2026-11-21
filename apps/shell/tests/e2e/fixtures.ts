import { test as base, expect, type Page } from '@playwright/test';
import { FakeOpsServer } from '../support/fake-ops-server.ts';

export const SERVER = 'http://127.0.0.1:8090';

export interface MockServer {
  devicesCreated: Record<string, unknown>[];
  requests: string[];
  /** Real server write-path logic (server/pb_hooks/lib/ops.js) over memory. */
  ops: FakeOpsServer;
  /** Airplane mode: every request to the server fails at the network layer. */
  offline: boolean;
  /** Delay before answering ops (the op is applied first, as a slow server would). */
  opsDelayMs: number;
}

/** Mocks the PocketBase routes the shell uses in M2. Nothing leaves the machine. */
export async function mockPocketBase(page: Page): Promise<MockServer> {
  const state: MockServer = { devicesCreated: [], requests: [], ops: new FakeOpsServer(), offline: false, opsDelayMs: 0 };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await page.route(`${SERVER}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    state.requests.push(`${req.method()} ${url.pathname}`);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (state.offline) return route.abort('internetdisconnected');
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
    if (url.pathname === '/api/sa/ops' && req.method() === 'POST') {
      const res = state.ops.apply(req.postDataJSON());
      if (state.opsDelayMs) await new Promise((r) => setTimeout(r, state.opsDelayMs));
      return json(res.status, res.body);
    }
    if (url.pathname === '/api/realtime') {
      if (req.method() === 'POST') return route.fulfill({ status: 204, headers: cors }).catch(() => undefined);
      return route
        .fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: 'id:c1\nevent:PB_CONNECT\ndata:{"clientId":"c1"}\n\n' })
        .catch(() => undefined);
    }
    if (url.pathname === '/api/collections/schema_info/records') return json(200, { page: 1, perPage: 1, totalItems: 1, totalPages: 1, items: [{ id: 'schema000000001', version: 1 }] });
    const list = /^\/api\/collections\/([a-z_]+)\/records$/.exec(url.pathname);
    if (list && req.method() === 'GET' && list[1] !== 'core_devices') {
      const since = /updated > "([^"]*)"/.exec(url.searchParams.get('filter') ?? '')?.[1] ?? '';
      const items = state.ops.since(list[1]!, since);
      return json(200, { page: 1, perPage: 1000, totalItems: items.length, totalPages: 1, items });
    }
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
