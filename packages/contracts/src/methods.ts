/**
 * Bridge API v1 method registry (spec §Bridge API, "v1 methods"). Each method declares:
 *   - params: JSON Schema (draft 2020-12 subset understood by Ajv) validated by the shell before acting
 *   - scopes: the scope(s) the caller must hold for these params (resolved per call)
 *   - since:  the milestone that implements the handler; the shell answers NOT_IMPLEMENTED before it.
 * Change this file first, then the SDK, then the shell handler (spec implementation note 1).
 */
import { parseTopic } from './topics.ts';

export type JsonSchema = Record<string, unknown>;

export interface MethodSpec {
  params: JsonSchema;
  /** Returns the scopes required for this call, or null if the call can never be authorised. */
  scopes: (params: Record<string, unknown>, appId: string) => string[] | null;
  since: 'M2' | 'M3' | 'M4' | 'M5' | 'M6';
}

const obj = (properties: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const str = (maxLength = 256, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', minLength: 1, maxLength, ...extra });
const COLLECTION = str(64, { pattern: '^[a-z][a-z0-9_]*$' });
const RECORD_ID = str(15, { pattern: '^[a-z0-9]{15}$' });
const TOPIC = str(128, { pattern: '^[a-z][a-z0-9]*\\.[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$' });
const DEVICE = str(15, { pattern: '^([a-z0-9]{15}|\\*)$' });
const JSON_OBJECT: JsonSchema = { type: 'object' };

const none = (): string[] => [];
const fixed = (...scopes: string[]) => (): string[] => scopes;

/** data.* scope: own collections → data.own; core_<x> → core.<x>.read|write; anything else is denied. */
function dataScope(mode: 'read' | 'write') {
  return (params: Record<string, unknown>, appId: string): string[] | null => {
    const collection = params.collection;
    if (typeof collection !== 'string') return null;
    if (collection.startsWith(`${appId}_`)) return ['data.own'];
    if (collection.startsWith('core_')) return [`core.${collection.slice('core_'.length)}.${mode}`];
    return null;
  };
}

function busScope(mode: 'emit' | 'listen') {
  return (params: Record<string, unknown>, appId: string): string[] | null => {
    const topic = params.topic;
    const parsed = parseTopic(topic);
    if (!parsed || typeof topic !== 'string') return null;
    if (mode === 'emit' && parsed.owner !== appId) return null;
    return [`bus.${mode}:${topic}`];
  };
}

export const METHODS = {
  // app: lifecycle, no scope
  'app.ready': { params: obj(), scopes: none, since: 'M2' },
  'app.setTitle': { params: obj({ title: str(80) }, ['title']), scopes: none, since: 'M2' },
  'app.close': { params: obj(), scopes: none, since: 'M2' },
  'app.getContext': { params: obj(), scopes: none, since: 'M2' },

  // sys: capability discovery and logging, no scope
  'sys.capabilities': { params: obj(), scopes: none, since: 'M2' },
  'sys.log': {
    params: obj(
      {
        level: { enum: ['debug', 'info', 'warn', 'error'] },
        msg: str(200),
        fields: { type: 'object', maxProperties: 20 },
      },
      ['level', 'msg'],
    ),
    scopes: none,
    since: 'M2',
  },

  // data: store (M3)
  'data.list': {
    params: obj({ collection: COLLECTION, filter: str(512), sort: str(128), page: { type: 'integer', minimum: 1 }, perPage: { type: 'integer', minimum: 1, maximum: 500 } }, ['collection']),
    scopes: dataScope('read'),
    since: 'M3',
  },
  'data.get': { params: obj({ collection: COLLECTION, id: RECORD_ID }, ['collection', 'id']), scopes: dataScope('read'), since: 'M3' },
  'data.create': { params: obj({ collection: COLLECTION, id: RECORD_ID, data: JSON_OBJECT }, ['collection', 'data']), scopes: dataScope('write'), since: 'M3' },
  'data.update': {
    params: obj({ collection: COLLECTION, id: RECORD_ID, data: JSON_OBJECT, baseVersion: { type: 'integer', minimum: 1 } }, ['collection', 'id', 'data']),
    scopes: dataScope('write'),
    since: 'M3',
  },
  'data.delete': { params: obj({ collection: COLLECTION, id: RECORD_ID }, ['collection', 'id']), scopes: dataScope('write'), since: 'M3' },
  'data.subscribe': { params: obj({ collection: COLLECTION, filter: str(512) }, ['collection']), scopes: dataScope('read'), since: 'M3' },
  'data.unsubscribe': { params: obj({ subscriptionId: str(64) }, ['subscriptionId']), scopes: none, since: 'M3' },

  // bus (M5)
  'bus.emit': { params: obj({ topic: TOPIC, payload: {}, device: DEVICE, durable: { type: 'boolean' } }, ['topic']), scopes: busScope('emit'), since: 'M5' },
  'bus.on': { params: obj({ topic: TOPIC }, ['topic']), scopes: busScope('listen'), since: 'M5' },
  'bus.off': { params: obj({ topic: TOPIC }, ['topic']), scopes: none, since: 'M5' },
  'bus.request': {
    params: obj({ topic: TOPIC, payload: {}, device: DEVICE, timeoutMs: { type: 'integer', minimum: 100, maximum: 60_000 } }, ['topic']),
    scopes: busScope('emit'),
    since: 'M5',
  },

  // nav (M4/M5)
  'nav.open': { params: obj({ link: str(512, { pattern: '^superapp://' }) }, ['link']), scopes: fixed('nav.open'), since: 'M5' },
  'nav.back': { params: obj(), scopes: none, since: 'M5' },
  'nav.share': { params: obj({ title: str(200), text: str(4000), url: str(2048) }), scopes: fixed('nav.open'), since: 'M4' },

  // launcher (M4)
  'launcher.open': { params: obj({ target: str(128), device: DEVICE }, ['target']), scopes: fixed('apps.launch'), since: 'M4' },

  // files (M4)
  'files.pick': { params: obj({ accept: { type: 'array', items: str(64), maxItems: 10 }, multiple: { type: 'boolean' } }), scopes: fixed('files.read'), since: 'M4' },
  'files.upload': { params: obj({ name: str(200), mime: str(100), dataBase64: { type: 'string', maxLength: 20_000_000 }, tags: { type: 'array', items: str(64) } }, ['name', 'mime', 'dataBase64']), scopes: fixed('files.write'), since: 'M4' },
  'files.getUrl': { params: obj({ id: RECORD_ID }, ['id']), scopes: fixed('files.read'), since: 'M4' },

  // notify (M4)
  'notify.post': { params: obj({ title: str(120), body: str(1000), deepLink: str(512, { pattern: '^superapp://' }) }, ['title']), scopes: fixed('notify.post'), since: 'M4' },
  'notify.cancel': { params: obj({ id: str(64) }, ['id']), scopes: fixed('notify.post'), since: 'M4' },
  'notify.badge': { params: obj({ count: { type: 'integer', minimum: 0, maximum: 9999 } }, ['count']), scopes: fixed('notify.post'), since: 'M4' },

  // device (M4)
  'device.info': { params: obj(), scopes: fixed('device.info'), since: 'M4' },
  'device.battery': { params: obj(), scopes: fixed('device.battery'), since: 'M4' },
  'device.network': { params: obj(), scopes: fixed('device.network'), since: 'M4' },
  'device.location': { params: obj({ highAccuracy: { type: 'boolean' } }), scopes: fixed('device.location'), since: 'M4' },
  'device.contacts.list': { params: obj({ query: str(100) }), scopes: fixed('device.contacts.read'), since: 'M4' },
  'device.haptics': { params: obj({ style: { enum: ['light', 'medium', 'heavy'] } }), scopes: fixed('device.haptics'), since: 'M4' },

  // integrations (M6)
  'ha.states': { params: obj({ entityIds: { type: 'array', items: str(128), maxItems: 200 } }), scopes: fixed('home.read'), since: 'M6' },
  'ha.call': { params: obj({ domain: str(64), service: str(64), data: JSON_OBJECT }, ['domain', 'service']), scopes: fixed('home.control'), since: 'M6' },
  'ha.subscribe': { params: obj({ entityIds: { type: 'array', items: str(128), maxItems: 200 } }, ['entityIds']), scopes: fixed('home.read'), since: 'M6' },
  'media.search': { params: obj({ query: str(200), limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['query']), scopes: fixed('media.read'), since: 'M6' },
  'media.item': { params: obj({ id: str(64) }, ['id']), scopes: fixed('media.read'), since: 'M6' },
  'media.streamUrl': { params: obj({ id: str(64) }, ['id']), scopes: fixed('media.play'), since: 'M6' },
  'media.playOn': { params: obj({ id: str(64), device: DEVICE }, ['id', 'device']), scopes: fixed('media.play'), since: 'M6' },
  'ai.chat': {
    params: obj(
      {
        messages: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: obj({ role: { enum: ['user', 'assistant'] }, content: str(100_000) }, ['role', 'content']),
        },
        system: str(20_000),
        maxTokens: { type: 'integer', minimum: 1, maximum: 8192 },
      },
      ['messages'],
    ),
    scopes: fixed('ai.chat'),
    since: 'M6',
  },
} as const satisfies Record<string, MethodSpec>;

export type MethodName = keyof typeof METHODS;

export function isMethodName(name: string): name is MethodName {
  return Object.prototype.hasOwnProperty.call(METHODS, name);
}
