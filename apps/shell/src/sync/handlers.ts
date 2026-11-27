import type { MethodName } from '@superapp/contracts';
import type { Handler } from '../bridge/types.ts';
import type { SyncEngine } from './engine.ts';

/** M3 handlers: `data.*` (scopes and declared collections are checked by the router first). */
export function dataHandlers(engine: SyncEngine): Partial<Record<MethodName, Handler>> {
  const str = (v: unknown) => String(v);
  const refreshLater = (collection: string) => void engine.refresh(collection);
  return {
    'data.list': async (_ctx, p) => {
      const res = await engine.data.list(str(p.collection), {
        filter: p.filter as string | undefined,
        sort: p.sort as string | undefined,
        page: p.page as number | undefined,
        perPage: p.perPage as number | undefined,
      });
      refreshLater(str(p.collection)); // local first, then server (spec §Read path)
      return res;
    },
    'data.get': async (_ctx, p) => {
      const r = await engine.data.get(str(p.collection), str(p.id));
      refreshLater(str(p.collection));
      return r;
    },
    'data.create': ({ appId }, p) => engine.data.create(appId, str(p.collection), p.data as Record<string, unknown>, p.id as string | undefined),
    'data.update': ({ appId }, p) => engine.data.update(appId, str(p.collection), str(p.id), p.data as Record<string, unknown>, p.baseVersion as number | undefined),
    'data.delete': ({ appId }, p) => engine.data.delete(appId, str(p.collection), str(p.id)),
    'data.subscribe': ({ appId }, p) => {
      const subscriptionId = engine.subscribe(appId, str(p.collection));
      refreshLater(str(p.collection));
      return { subscriptionId };
    },
    'data.unsubscribe': ({ appId }, p) => ({ ok: engine.unsubscribe(appId, str(p.subscriptionId)) }),
  };
}
