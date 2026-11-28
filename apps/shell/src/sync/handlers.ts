import type { MethodName } from '@superapp/contracts';
import type { Handler } from '../bridge/types.ts';
import type { SyncEngine } from './engine.ts';
import { ShellError } from '../bridge/types.ts';

/**
 * Shared core collections that many apps contribute to (ADR-011). An app may only create, change or
 * delete records that carry its own id in the owner field; the scope (core.<x>.write) alone is not
 * enough, so one app cannot rewrite another app's agenda items or glances.
 */
export const APP_OWNED_FIELD: Readonly<Record<string, string>> = { core_agenda: 'source_app', core_glances: 'app_id' };

async function assertAppOwns(engine: SyncEngine, appId: string, collection: string, id: string | null, data: Record<string, unknown> | null): Promise<void> {
  const field = APP_OWNED_FIELD[collection];
  if (!field) return;
  if (data && field in data && data[field] !== appId) throw new ShellError('SCOPE_DENIED', `${collection}.${field} must be "${appId}".`);
  if (id === null) {
    if (!data || data[field] !== appId) throw new ShellError('SCOPE_DENIED', `${collection}.${field} must be "${appId}".`);
    return;
  }
  const existing = await engine.data.get(collection, id);
  if (existing && existing[field] !== appId) throw new ShellError('SCOPE_DENIED', `${collection} record ${id} belongs to ${String(existing[field])}.`);
}

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
    'data.create': async ({ appId }, p) => {
      await assertAppOwns(engine, appId, str(p.collection), null, p.data as Record<string, unknown>);
      return engine.data.create(appId, str(p.collection), p.data as Record<string, unknown>, p.id as string | undefined);
    },
    'data.update': async ({ appId }, p) => {
      await assertAppOwns(engine, appId, str(p.collection), str(p.id), p.data as Record<string, unknown>);
      return engine.data.update(appId, str(p.collection), str(p.id), p.data as Record<string, unknown>, p.baseVersion as number | undefined);
    },
    'data.delete': async ({ appId }, p) => {
      await assertAppOwns(engine, appId, str(p.collection), str(p.id), null);
      return engine.data.delete(appId, str(p.collection), str(p.id));
    },
    'data.subscribe': ({ appId }, p) => {
      const subscriptionId = engine.subscribe(appId, str(p.collection));
      refreshLater(str(p.collection));
      return { subscriptionId };
    },
    'data.unsubscribe': ({ appId }, p) => ({ ok: engine.unsubscribe(appId, str(p.subscriptionId)) }),
  };
}
