import { describe, expect, it, vi } from 'vitest';
import { BridgeClient, BridgeError, StandaloneTransport, connect, type Transport } from './index.ts';
import type { RequestEnvelope, WelcomeMessage } from '@superapp/contracts/envelope';

const welcome: WelcomeMessage = {
  type: 'welcome',
  sessionToken: 'tok',
  apiVersion: '1.0',
  grantedScopes: [],
  user: null,
  device: { id: null, kind: 'phone', name: 'test' },
  formFactor: 'phone',
  theme: 'light',
  locale: 'en',
};

class FakeTransport implements Transport {
  readonly hosted = true;
  sent: RequestEnvelope[] = [];
  private fn: (m: unknown) => void = () => undefined;
  connect() {
    return Promise.resolve(welcome);
  }
  send(req: RequestEnvelope) {
    this.sent.push(req);
  }
  onMessage(fn: (m: unknown) => void) {
    this.fn = fn;
  }
  deliver(m: unknown) {
    this.fn(m);
  }
}

describe('BridgeClient', () => {
  it('sends the session token and resolves the matching response', async () => {
    const t = new FakeTransport();
    const c = new BridgeClient(t);
    const p = c.call('app.getContext');
    await c.ready;
    await Promise.resolve();
    expect(t.sent[0]).toMatchObject({ v: 1, kind: 'req', method: 'app.getContext', token: 'tok' });
    t.deliver({ v: 1, id: t.sent[0]!.id, kind: 'res', ok: true, result: { appId: 'x' } });
    await expect(p).resolves.toEqual({ appId: 'x' });
  });

  it('rejects with a typed BridgeError', async () => {
    const t = new FakeTransport();
    const c = new BridgeClient(t);
    const p = c.call('device.info');
    await c.ready;
    await Promise.resolve();
    t.deliver({ v: 1, id: t.sent[0]!.id, kind: 'res', ok: false, error: { code: 'SCOPE_DENIED', message: 'no', retryable: false } });
    await expect(p).rejects.toMatchObject({ name: 'BridgeError', code: 'SCOPE_DENIED' });
  });

  it('times out with TIMEOUT', async () => {
    vi.useFakeTimers();
    try {
      const t = new FakeTransport();
      const c = new BridgeClient(t);
      const p = c.call('app.ready', {}, { timeoutMs: 50 });
      const assertion = expect(p).rejects.toBeInstanceOf(BridgeError);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes events by topic and supports unsubscribe', async () => {
    const t = new FakeTransport();
    const c = new BridgeClient(t);
    const seen: unknown[] = [];
    const off = c.onEvent('core.person.updated', (p) => seen.push(p));
    t.deliver({ v: 1, kind: 'evt', topic: 'core.person.updated', payload: 1, ts: 'x' });
    off();
    t.deliver({ v: 1, kind: 'evt', topic: 'core.person.updated', payload: 2, ts: 'x' });
    expect(seen).toEqual([1]);
  });

  it('retries RATE_LIMITED with backoff, then succeeds', async () => {
    vi.useFakeTimers();
    try {
      const t = new FakeTransport();
      const c = new BridgeClient(t);
      const p = c.call('app.getContext');
      await vi.advanceTimersByTimeAsync(0);
      t.deliver({ v: 1, id: t.sent[0]!.id, kind: 'res', ok: false, error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true } });
      await vi.advanceTimersByTimeAsync(150);
      expect(t.sent).toHaveLength(2);
      t.deliver({ v: 1, id: t.sent[1]!.id, kind: 'res', ok: true, result: 'ok' });
      await expect(p).resolves.toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores malformed messages', async () => {
    const t = new FakeTransport();
    new BridgeClient(t);
    expect(() => t.deliver({ hello: 'world' })).not.toThrow();
  });
});

describe('standalone mode', () => {
  it('reports isHosted false and serves data from the dev mock', async () => {
    const sa = connect({ appId: 'demo', transport: new StandaloneTransport('demo'), captureErrors: false });
    expect(sa.isHosted).toBe(false);
    const { record } = await sa.data.create<{ id: string; n: number }>('demo_items', { n: 1 });
    const updated = await sa.data.update<{ version: number }>('demo_items', record.id, { n: 2 });
    expect(updated.record.version).toBe(2);
    const list = await sa.data.list('demo_items');
    expect(list.items).toHaveLength(1);
    await expect(sa.call('device.contacts.list')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});

describe('data.subscribe (standalone)', () => {
  it('delivers current items immediately and again after a write', async () => {
    const sa = connect({ appId: 'demo', transport: new StandaloneTransport('demo'), captureErrors: false });
    const seen: number[] = [];
    const off = await sa.data.subscribe('demo_items', (items) => seen.push(items.length));
    await sa.data.create('demo_items', { n: 1 });
    await new Promise((r) => setTimeout(r, 80));
    off();
    await sa.data.create('demo_items', { n: 2 });
    await new Promise((r) => setTimeout(r, 80));
    expect(seen).toEqual([0, 1]);
  });
});
