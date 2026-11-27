import { API_VERSION, isHelloMessage, sdkSatisfies, type Manifest, type WelcomeMessage } from '@superapp/contracts';
import type { BridgeRouter } from './router.ts';
import type { PortLike } from './types.ts';
import { newSessionToken } from '../core/ids.ts';

/** What the shell knows about a frame it created and is waiting to hear from. */
export interface PendingFrame {
  appId: string;
  manifest: Manifest;
  /** The iframe's contentWindow at creation time. Identity is the authentication. */
  window: WindowLike;
  createdAt: number;
  onConnected: (info: { ms: number }) => void;
}

export interface WindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer?: unknown[]): void;
}

export interface ChannelLike {
  port1: PortLike;
  port2: unknown;
}

export interface HandshakeDeps {
  router: BridgeRouter;
  createChannel: () => ChannelLike;
  welcomeFor: (manifest: Manifest, token: string) => Omit<WelcomeMessage, 'type' | 'sessionToken' | 'apiVersion'>;
  now?: () => number;
}

export type HandshakeOutcome = 'connected' | 'rejected' | 'ignored';

/**
 * Implements spec §Handshake. A hello is accepted only if:
 *   (1) event.source is the window of a frame the shell created and is still waiting on,
 *   (2) the claimed appId is that frame's app,
 *   (3) the SDK version satisfies the manifest's `sdk` range.
 * Anything else is rejected and logged. After the handshake, window messages from that frame are
 * ignored; all traffic uses the private port.
 */
export class HandshakeGuard {
  private pending: PendingFrame[] = [];
  private connected = new Set<unknown>();
  private now: () => number;

  constructor(private readonly deps: HandshakeDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  expect(frame: PendingFrame): void {
    this.forget(frame.window);
    this.pending.push(frame);
  }

  /** Called when a frame is destroyed. */
  forget(win: unknown): void {
    this.pending = this.pending.filter((p) => p.window !== win);
    this.connected.delete(win);
  }

  isPending(appId: string): boolean {
    return this.pending.some((p) => p.appId === appId);
  }

  onWindowMessage(event: { source: unknown; data: unknown; origin?: string }): HandshakeOutcome {
    const { router } = this.deps;
    const data = event.data as { type?: unknown; appId?: unknown } | null;
    const looksLikeHello = typeof data === 'object' && data !== null && data.type === 'hello';
    const claimed = looksLikeHello && typeof data.appId === 'string' ? data.appId.slice(0, 40) : 'unknown';

    if (this.connected.has(event.source)) {
      if (looksLikeHello) router.reject(claimed, 'hello', 'BAD_ENVELOPE', 'Handshake already complete; window messages are ignored.');
      return 'ignored';
    }
    if (!looksLikeHello) return 'ignored'; // not bridge traffic (e.g. devtools, extensions)

    const frame = this.pending.find((p) => p.window === event.source);
    if (!frame) {
      router.reject(claimed, 'hello', 'BAD_ENVELOPE', 'Hello from a window the shell did not create (forged frame).');
      return 'rejected';
    }
    if (!isHelloMessage(event.data)) {
      router.reject(frame.appId, 'hello', 'BAD_ENVELOPE', 'Malformed hello.');
      return 'rejected';
    }
    if (event.data.appId !== frame.appId) {
      router.reject(frame.appId, 'hello', 'BAD_ENVELOPE', `Frame for ${frame.appId} claimed to be ${event.data.appId}.`);
      return 'rejected';
    }
    if (!sdkSatisfies(event.data.sdkVersion, frame.manifest.sdk)) {
      router.reject(frame.appId, 'hello', 'UNAVAILABLE', `SDK ${event.data.sdkVersion} does not satisfy ${frame.manifest.sdk}.`);
      return 'rejected';
    }

    const token = newSessionToken();
    const channel = this.deps.createChannel();
    router.attach({ appId: frame.appId, token, manifest: frame.manifest, port: channel.port1, startedAt: this.now() });
    const welcome: WelcomeMessage = {
      type: 'welcome',
      sessionToken: token,
      apiVersion: API_VERSION,
      ...this.deps.welcomeFor(frame.manifest, token),
    };
    // The sandboxed frame has an opaque origin, so '*' is the only usable target. The window identity
    // check above, made in the same task, is what binds the port to the frame we created.
    frame.window.postMessage(welcome, '*', [channel.port2]);
    this.pending = this.pending.filter((p) => p !== frame);
    this.connected.add(event.source);
    router.trace({ appId: frame.appId, direction: 'out', kind: 'welcome', ms: this.now() - frame.createdAt });
    frame.onConnected({ ms: this.now() - frame.createdAt });
    return 'connected';
  }
}
