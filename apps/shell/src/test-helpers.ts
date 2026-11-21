import type { Manifest } from '@superapp/contracts';
import { Logger, type LogEntry } from './core/logger.ts';
import type { PortLike } from './bridge/types.ts';

export function manifest(patch: Partial<Manifest> = {}): Manifest {
  return {
    id: 'hello',
    name: 'Hello',
    version: '1.0.0',
    sdk: '>=1.0 <2.0',
    entry: 'index.html',
    formFactors: ['phone'],
    scopes: { required: ['data.own'], optional: ['device.contacts.read'] },
    collections: ['hello_notes'],
    events: { emits: ['hello.note.created'], listens: [] },
    deepLinks: [],
    intents: [],
    car: null,
    background: { tasks: [] },
    ...patch,
  };
}

export function quietLogger(): { logger: Logger; lines: LogEntry[] } {
  const lines: LogEntry[] = [];
  const logger = new Logger(() => undefined);
  logger.addSink((e) => lines.push(e));
  return { logger, lines };
}

export class FakePort implements PortLike {
  sent: unknown[] = [];
  closed = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(msg: unknown) {
    this.sent.push(msg);
  }
  close() {
    this.closed = true;
  }
  /** Simulate the subapp sending a message on its end. */
  async deliver(data: unknown) {
    this.onmessage?.({ data });
    await new Promise((r) => setTimeout(r, 0));
  }
}
