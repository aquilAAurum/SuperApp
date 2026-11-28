import { describe, expect, it } from 'vitest';
import { BridgeRouter } from './router.ts';
import { HandshakeGuard, type WindowLike } from './handshake.ts';
import { MemoryGrantStore } from './permissions.ts';
import { FakePort, manifest, quietLogger } from '../test-helpers.ts';

class FakeWindow implements WindowLike {
  posted: { message: unknown; origin: string; transfer?: unknown[] }[] = [];
  postMessage(message: unknown, origin: string, transfer?: unknown[]) {
    this.posted.push({ message, origin, transfer });
  }
}

function setup() {
  const { logger } = quietLogger();
  const router = new BridgeRouter({ logger, grants: new MemoryGrantStore(), handlers: {} });
  const ports: FakePort[] = [];
  const guard = new HandshakeGuard({
    router,
    createChannel: () => {
      const port1 = new FakePort();
      ports.push(port1);
      return { port1, port2: { tag: 'port2' } };
    },
    welcomeFor: () => ({ grantedScopes: ['data.own'], user: null, device: { id: null, kind: 'phone', name: 't' }, formFactor: 'phone', theme: 'light', locale: 'en' }),
  });
  const frameWin = new FakeWindow();
  let connected = 0;
  guard.expect({ appId: 'hello', manifest: manifest(), window: frameWin, createdAt: Date.now(), onConnected: () => connected++ });
  return { guard, router, frameWin, ports, connected: () => connected };
}

const hello = (appId = 'hello', sdkVersion = '1.0.0') => ({ type: 'hello', appId, sdkVersion });

describe('HandshakeGuard', () => {
  it('welcomes the frame it created and transfers port2', () => {
    const s = setup();
    expect(s.guard.onWindowMessage({ source: s.frameWin, data: hello() })).toBe('connected');
    const w = s.frameWin.posted[0]!;
    expect(w.message).toMatchObject({ type: 'welcome', apiVersion: '1.1', grantedScopes: ['data.own'] });
    expect((w.message as { sessionToken: string }).sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(w.transfer).toEqual([{ tag: 'port2' }]);
    expect(s.router.hasSession('hello')).toBe(true);
    expect(s.connected()).toBe(1);
  });

  it('rejects and logs a hello forged from another frame', () => {
    const s = setup();
    const attacker = new FakeWindow();
    expect(s.guard.onWindowMessage({ source: attacker, data: hello() })).toBe('rejected');
    expect(attacker.posted).toHaveLength(0);
    expect(s.frameWin.posted).toHaveLength(0);
    expect(s.router.hasSession('hello')).toBe(false);
    expect(s.router.rejections.all()[0]).toMatchObject({ appId: 'hello', method: 'hello', code: 'BAD_ENVELOPE' });
    expect(s.router.rejections.all()[0]!.message).toMatch(/forged/);
  });

  it('rejects an app id that does not match the frame', () => {
    const s = setup();
    expect(s.guard.onWindowMessage({ source: s.frameWin, data: hello('budget') })).toBe('rejected');
    expect(s.router.hasSession('hello')).toBe(false);
    expect(s.router.hasSession('budget')).toBe(false);
  });

  it('rejects an SDK outside the manifest range', () => {
    const s = setup();
    expect(s.guard.onWindowMessage({ source: s.frameWin, data: hello('hello', '2.0.0') })).toBe('rejected');
    expect(s.router.rejections.all()[0]!.code).toBe('UNAVAILABLE');
  });

  it('ignores window messages after the handshake (and logs repeated hellos)', () => {
    const s = setup();
    s.guard.onWindowMessage({ source: s.frameWin, data: hello() });
    expect(s.guard.onWindowMessage({ source: s.frameWin, data: hello() })).toBe('ignored');
    expect(s.guard.onWindowMessage({ source: s.frameWin, data: { v: 1, kind: 'req' } })).toBe('ignored');
    expect(s.frameWin.posted).toHaveLength(1);
    expect(s.router.rejections.all()).toHaveLength(1);
  });

  it('ignores non-bridge window messages silently', () => {
    const s = setup();
    expect(s.guard.onWindowMessage({ source: {}, data: { foo: 1 } })).toBe('ignored');
    expect(s.router.rejections.all()).toHaveLength(0);
  });

  it('forgets destroyed frames', () => {
    const s = setup();
    s.guard.forget(s.frameWin);
    expect(s.guard.onWindowMessage({ source: s.frameWin, data: hello() })).toBe('rejected');
  });
});
