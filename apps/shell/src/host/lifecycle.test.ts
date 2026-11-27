import { describe, expect, it } from 'vitest';
import { BridgeRouter } from '../bridge/router.ts';
import { HandshakeGuard } from '../bridge/handshake.ts';
import { MemoryGrantStore } from '../bridge/permissions.ts';
import { SubappLifecycle, type FrameHandle } from './lifecycle.ts';
import { FakePort, manifest, quietLogger } from '../test-helpers.ts';

function setup() {
  const { logger } = quietLogger();
  const router = new BridgeRouter({ logger, grants: new MemoryGrantStore(), handlers: {} });
  const guard = new HandshakeGuard({
    router,
    createChannel: () => ({ port1: new FakePort(), port2: {} }),
    welcomeFor: () => ({ grantedScopes: [], user: null, device: { id: null, kind: 'phone', name: 't' }, formFactor: 'phone', theme: 'light', locale: 'en' }),
  });
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const frames: (FrameHandle & { destroyed: boolean; visible: boolean; appId: string })[] = [];
  const lc = new SubappLifecycle({
    handshake: guard,
    router,
    logger,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => (t.cancelled = true);
    },
    createFrame: async (app) => {
      const f = {
        appId: app.manifest.id,
        destroyed: false,
        visible: false,
        window: { postMessage: () => undefined },
        show() {
          f.visible = true;
        },
        hide() {
          f.visible = false;
        },
        destroy() {
          f.destroyed = true;
        },
      };
      frames.push(f);
      return f;
    },
  });
  for (const id of ['aa', 'bb', 'cc', 'dd', 'ee']) lc.register({ manifest: manifest({ id, collections: [], events: { emits: [], listens: [] } }), source: 'builtin' });
  const connect = (appId: string) => {
    const f = frames.filter((x) => x.appId === appId).at(-1)!;
    return guard.onWindowMessage({ source: f.window, data: { type: 'hello', appId, sdkVersion: '1.0.0' } });
  };
  return { lc, router, frames, timers, connect };
}

describe('SubappLifecycle', () => {
  it('starting → active after the handshake', async () => {
    const s = setup();
    await s.lc.launch('aa');
    expect(s.lc.get('aa')!.state).toBe('starting');
    expect(s.connect('aa')).toBe('connected');
    expect(s.lc.get('aa')!.state).toBe('active');
    expect(s.lc.get('aa')!.handshakeMs).not.toBeNull();
    expect(s.timers[0]!.cancelled).toBe(true);
  });

  it('crashes after 10 s without hello and destroys the frame', async () => {
    const s = setup();
    await s.lc.launch('aa');
    expect(s.timers[0]!.ms).toBe(10_000);
    s.timers[0]!.fn();
    expect(s.lc.get('aa')).toMatchObject({ state: 'crashed' });
    expect(s.frames[0]!.destroyed).toBe(true);
    expect(s.lc.liveFrameCount()).toBe(0);
    expect(s.router.rejections.all().at(-1)).toMatchObject({ appId: 'aa', code: 'TIMEOUT' });
  });

  it('keeps at most 3 suspended iframes and destroys the least recently used (CORE-15)', async () => {
    const s = setup();
    for (const id of ['aa', 'bb', 'cc', 'dd', 'ee']) {
      await s.lc.launch(id);
      s.connect(id);
    }
    // ee active; dd, cc, bb suspended; aa evicted.
    expect(s.lc.get('ee')!.state).toBe('active');
    expect(['bb', 'cc', 'dd'].map((id) => s.lc.get(id)!.state)).toEqual(['suspended', 'suspended', 'suspended']);
    expect(s.lc.get('aa')!.state).toBe('installed');
    expect(s.frames.find((f) => f.appId === 'aa')!.destroyed).toBe(true);
    expect(s.lc.liveFrameCount()).toBe(4);
    expect(s.router.hasSession('aa')).toBe(false);
    expect(s.router.sessionCount()).toBe(4);
  });

  it('resumes a suspended app without a new frame', async () => {
    const s = setup();
    await s.lc.launch('aa');
    s.connect('aa');
    await s.lc.launch('bb');
    s.connect('bb');
    await s.lc.launch('aa');
    expect(s.frames.filter((f) => f.appId === 'aa')).toHaveLength(1);
    expect(s.lc.get('aa')!.state).toBe('active');
    expect(s.lc.get('bb')!.state).toBe('suspended');
  });

  it('close and destroyAll release every frame and session', async () => {
    const s = setup();
    for (const id of ['aa', 'bb']) {
      await s.lc.launch(id);
      s.connect(id);
    }
    s.lc.close('bb');
    expect(s.lc.get('bb')!.state).toBe('installed');
    s.lc.destroyAll();
    expect(s.lc.liveFrameCount()).toBe(0);
    expect(s.router.sessionCount()).toBe(0);
    expect(s.frames.every((f) => f.destroyed)).toBe(true);
  });

  it('safe mode disables and tears down everything', async () => {
    const s = setup();
    await s.lc.launch('aa');
    s.connect('aa');
    s.lc.setSafeMode(true);
    expect(s.lc.get('aa')!.state).toBe('disabled');
    expect(s.lc.liveFrameCount()).toBe(0);
    await s.lc.launch('aa');
    expect(s.lc.liveFrameCount()).toBe(0);
    s.lc.setSafeMode(false);
    expect(s.lc.get('aa')!.state).toBe('installed');
  });

  it('marks the app crashed if the bundle cannot load', async () => {
    const s = setup();
    const lc = new SubappLifecycle({
      handshake: (s.lc as unknown as { deps: { handshake: HandshakeGuard } }).deps.handshake,
      router: s.router,
      logger: quietLogger().logger,
      createFrame: async () => {
        throw new Error('404');
      },
    });
    lc.register({ manifest: manifest(), source: 'builtin' });
    await lc.launch('hello');
    expect(lc.get('hello')).toMatchObject({ state: 'crashed', lastError: 'Could not load bundle: 404' });
  });
});
