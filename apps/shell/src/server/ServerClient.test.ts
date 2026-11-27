import { describe, expect, it } from 'vitest';
import { SECRET_DEVICE, SECRET_TOKEN, ServerClient, type SecretStore } from './ServerClient.ts';
import { quietLogger } from '../test-helpers.ts';

class MemorySecrets implements SecretStore {
  map = new Map<string, string>();
  async getSecret(k: string) {
    return this.map.get(k) ?? null;
  }
  async setSecret(k: string, v: string) {
    this.map.set(k, v);
  }
  async removeSecret(k: string) {
    this.map.delete(k);
  }
}

const exp = Math.floor(Date.now() / 1000) + 3600;
const TOKEN = `x.${Buffer.from(JSON.stringify({ exp, type: 'auth', collectionId: 'users' })).toString('base64url')}.y`;

function fakeFetch(routes: Record<string, (body: unknown) => { status: number; body: unknown }>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    calls.push(key);
    const route = routes[key];
    const res = route ? route(init?.body ? JSON.parse(String(init.body)) : null) : { status: 404, body: { message: 'nf' } };
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

describe('ServerClient', () => {
  it('refuses unsafe server URLs before any request', () => {
    const c = new ServerClient(new MemorySecrets(), quietLogger().logger, fakeFetch({}).impl);
    expect(() => c.configure('http://example.com')).toThrow(/HTTPS/);
  });

  it('signs in, stores the token only in secret storage, and registers the device once', async () => {
    const secrets = new MemorySecrets();
    const { impl, calls } = fakeFetch({
      'POST /api/collections/users/auth-with-password': () => ({ status: 200, body: { token: TOKEN, record: { id: 'user00000000001', email: 'n@x.test', name: 'Nick', collectionName: 'users' } } }),
      'POST /api/collections/core_devices/records': (b) => ({ status: 200, body: { id: 'device000000001', ...(b as object) } }),
      'PATCH /api/collections/core_devices/records/device000000001': () => ({ status: 200, body: { id: 'device000000001' } }),
    });
    const { logger, lines } = quietLogger();
    const c = new ServerClient(secrets, logger, impl);
    c.configure('https://minipc.tail.ts.net');
    const user = await c.signIn('n@x.test', 'pw');
    expect(user).toEqual({ id: 'user00000000001', name: 'Nick', email: 'n@x.test' });
    expect(secrets.map.get(SECRET_TOKEN)).toBe(TOKEN);

    const reg = { name: 'Pixel', kind: 'phone' as const, formFactor: 'phone' as const, shellVersion: '0.1.0', capabilities: { location: true, contacts: true, haptics: true, battery: true, network: true, camera: true, notifications: true } };
    expect(await c.registerDevice(reg)).toBe('device000000001');
    expect(secrets.map.get(SECRET_DEVICE)).toBe('device000000001');
    expect(await c.registerDevice(reg)).toBe('device000000001');
    expect(calls.filter((x) => x.startsWith('POST /api/collections/core_devices'))).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain(TOKEN);
  });

  it('maps a 400 sign-in to a friendly message and stores nothing', async () => {
    const secrets = new MemorySecrets();
    const { impl } = fakeFetch({ 'POST /api/collections/users/auth-with-password': () => ({ status: 400, body: { message: 'Failed to authenticate.' } }) });
    const c = new ServerClient(secrets, quietLogger().logger, impl);
    c.configure('https://minipc.tail.ts.net');
    await expect(c.signIn('n@x.test', 'bad')).rejects.toThrow('Email or password is incorrect.');
    expect(secrets.map.size).toBe(0);
  });

  it('drops the stored token when refresh says it is invalid', async () => {
    const secrets = new MemorySecrets();
    await secrets.setSecret(SECRET_TOKEN, TOKEN);
    const { impl } = fakeFetch({ 'POST /api/collections/users/auth-refresh': () => ({ status: 401, body: { message: 'expired' } }) });
    const c = new ServerClient(secrets, quietLogger().logger, impl);
    c.configure('https://minipc.tail.ts.net');
    expect(await c.restore()).toBeNull();
    expect(secrets.map.has(SECRET_TOKEN)).toBe(false);
  });

  it('reports reachability', async () => {
    const { impl } = fakeFetch({ 'GET /api/health': () => ({ status: 200, body: { code: 200 } }) });
    const c = new ServerClient(new MemorySecrets(), quietLogger().logger, impl);
    expect(await c.health()).toEqual({ state: 'offline' });
    c.configure('https://minipc.tail.ts.net');
    expect((await c.health()).state).toBe('online');
  });
});
