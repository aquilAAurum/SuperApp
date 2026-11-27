import { describe, expect, it } from 'vitest';
import { BridgeRouter } from './router.ts';
import { MemoryGrantStore } from './permissions.ts';
import { ShellError } from './types.ts';
import { FakePort, manifest, quietLogger } from '../test-helpers.ts';

function setup(opts: { now?: () => number } = {}) {
  const { logger, lines } = quietLogger();
  const grants = new MemoryGrantStore();
  const router = new BridgeRouter({
    logger,
    grants,
    now: opts.now,
    handlers: {
      'app.getContext': ({ appId }) => ({ appId, route: '/', hosted: true }),
      'app.setTitle': () => {
        throw new ShellError('CONFLICT', 'nope');
      },
      'sys.capabilities': () => {
        throw new Error('boom');
      },
      'data.list': () => ({ items: [], pending: false }),
      'device.contacts.list': () => ({ contacts: [] }),
    },
  });
  const port = new FakePort();
  const session = { appId: 'hello', token: 'secret-token', manifest: manifest(), port, startedAt: 0 };
  router.attach(session);
  const req = (method: string, params: Record<string, unknown> = {}, token = 'secret-token') => ({ v: 1, id: `id-${method.replace(/\./g, "-")}-0001`, kind: 'req', method, params, token });
  const last = () => port.sent.at(-1) as { ok: boolean; result?: unknown; error?: { code: string } };
  return { router, port, req, last, lines, grants, session };
}

describe('BridgeRouter', () => {
  it('answers a valid call', async () => {
    const { port, req, last } = setup();
    await port.deliver(req('app.getContext'));
    expect(last()).toMatchObject({ ok: true, result: { appId: 'hello' } });
  });

  it.each([
    ['BAD_TOKEN', (r: ReturnType<typeof setup>) => r.req('app.getContext', {}, 'forged')],
    ['UNKNOWN_METHOD', (r: ReturnType<typeof setup>) => r.req('app.selfDestruct')],
    ['INVALID_PARAMS', (r: ReturnType<typeof setup>) => r.req('app.getContext', { extra: 1 })],
    ['SCOPE_DENIED', (r: ReturnType<typeof setup>) => r.req('data.list', { collection: 'budget_expenses' })],
    ['SCOPE_DENIED', (r: ReturnType<typeof setup>) => r.req('data.list', { collection: 'hello_secret' })],
    ['SCOPE_DENIED', (r: ReturnType<typeof setup>) => r.req('data.list', { collection: 'core_people' })],
    ['SCOPE_DENIED', (r: ReturnType<typeof setup>) => r.req('device.contacts.list', {})],
    ['NOT_IMPLEMENTED', (r: ReturnType<typeof setup>) => r.req('data.get', { collection: 'hello_notes', id: 'abcdefghij12345' })],
    ['CONFLICT', (r: ReturnType<typeof setup>) => r.req('app.setTitle', { title: 'x' })],
    ['INTERNAL', (r: ReturnType<typeof setup>) => r.req('sys.capabilities')],
  ])('rejects with %s and logs it', async (code, make) => {
    const r = setup();
    await r.port.deliver(make(r));
    expect(r.last()).toMatchObject({ ok: false, error: { code } });
    const rej = r.router.rejections.all().at(-1)!;
    expect(rej).toMatchObject({ appId: 'hello', code });
    expect(rej.ts).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(r.lines.some((l) => l.msg === 'bridge.rejected' && l.code === code)).toBe(true);
  });

  it('never logs the session token', async () => {
    const r = setup();
    await r.port.deliver(r.req('app.getContext', {}, 'forged'));
    expect(JSON.stringify(r.lines)).not.toContain('secret-token');
  });

  it('allows own declared collections and consented scopes', async () => {
    const r = setup();
    await r.port.deliver(r.req('data.list', { collection: 'hello_notes' }));
    expect(r.last()).toMatchObject({ ok: true });
    r.grants.set('hello', 'device.contacts.read', 'allow');
    await r.port.deliver(r.req('device.contacts.list', {}));
    expect(r.last()).toMatchObject({ ok: true });
  });

  it('rejects malformed envelopes without crashing', async () => {
    const r = setup();
    await r.port.deliver('garbage');
    await r.port.deliver({ v: 1, id: 'abcdefgh', kind: 'req' });
    expect(r.router.rejections.all().map((x) => x.code)).toEqual(['BAD_ENVELOPE', 'BAD_ENVELOPE']);
    expect(r.last()).toMatchObject({ ok: false, error: { code: 'BAD_ENVELOPE' } });
  });

  it('rate limits per app (50/s default)', async () => {
    const t = 1_000_000;
    const r = setup({ now: () => t });
    for (let i = 0; i < 50; i++) await r.port.deliver({ ...r.req('app.getContext'), id: `burst-${i}-xxxx` });
    expect(r.last()).toMatchObject({ ok: true });
    await r.port.deliver(r.req('app.getContext'));
    expect(r.last()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', retryable: true } });
  });

  it('detach closes the port and stops answering (revocation)', async () => {
    const r = setup();
    expect(r.router.detach('hello', 'scope_revoked')).toBe(true);
    expect(r.port.closed).toBe(true);
    expect(r.port.onmessage).toBeNull();
    const before = r.port.sent.length;
    await r.router.handle(r.session, r.req('app.getContext'));
    expect(r.port.sent.length).toBe(before);
    expect(r.router.hasSession('hello')).toBe(false);
  });

  it('records inspector entries with timings', async () => {
    const r = setup();
    await r.port.deliver(r.req('app.getContext'));
    const kinds = r.router.inspector.all().map((e) => `${e.direction}:${e.kind}`);
    expect(kinds).toEqual(['in:req', 'out:res']);
  });
});
