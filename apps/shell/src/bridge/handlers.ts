import type { Capabilities, MethodName } from '@superapp/contracts';
import type { Logger } from '../core/logger.ts';
import type { Handler } from './types.ts';

export interface CoreHandlerDeps {
  logger: Logger;
  capabilities: () => Promise<Capabilities> | Capabilities;
  setTitle: (appId: string, title: string) => void;
  close: (appId: string) => void;
  markReady: (appId: string) => void;
  route: (appId: string) => string;
}

/** M2 handlers: `app.*` and `sys.*` (no scope). */
export function coreHandlers(deps: CoreHandlerDeps): Partial<Record<MethodName, Handler>> {
  return {
    'app.ready': ({ appId }) => {
      deps.markReady(appId);
      return {};
    },
    'app.setTitle': ({ appId }, p) => {
      deps.setTitle(appId, String(p.title));
      return {};
    },
    'app.close': ({ appId }) => {
      // Respond first, then tear down on the next tick so the reply can be delivered.
      setTimeout(() => deps.close(appId), 0);
      return {};
    },
    'app.getContext': ({ appId }) => ({ appId, route: deps.route(appId), hosted: true }),
    'sys.capabilities': () => deps.capabilities(),
    'sys.log': ({ appId }, p) => {
      const level = p.level as 'debug' | 'info' | 'warn' | 'error';
      deps.logger.log(level, `subapp.${String(p.msg)}`, { appId, ...((p.fields as Record<string, unknown>) ?? {}) });
      return {};
    },
  };
}
