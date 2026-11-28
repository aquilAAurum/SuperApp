import { describe, expect, it } from 'vitest';
import {
  METHODS,
  canEmit,
  declaredScopes,
  isHelloMessage,
  isKnownScope,
  parseRequest,
  parseTopic,
  sdkSatisfies,
  validateManifest,
  type MethodName,
} from './index.ts';
import { compileParamValidators } from './schemas.ts';

const goodManifest = {
  id: 'budget',
  name: 'Budget',
  version: '1.4.0',
  sdk: '>=1.0 <2.0',
  entry: 'index.html',
  icon: 'icon.png',
  formFactors: ['phone', 'tv'],
  scopes: { required: ['data.own', 'core.people.read'], optional: ['device.contacts.read', 'notify.post'] },
  collections: ['budget_expenses', 'budget_categories'],
  events: { emits: ['budget.expense.created'], listens: ['core.person.updated'] },
  deepLinks: ['/expense/:id', '/report/:month'],
  intents: [{ action: 'share.receive', types: ['text/plain', 'image/*'] }],
  car: null,
  background: { tasks: [] },
};

describe('manifest', () => {
  it('accepts the spec example', () => {
    expect(validateManifest(goodManifest)).toEqual({ ok: true, manifest: goodManifest });
  });

  it.each([
    ['uppercase id', { id: 'Budget' }],
    ['reserved id', { id: 'core' }],
    ['unprefixed collection', { collections: ['expenses'] }],
    ['foreign emitted topic', { events: { emits: ['other.thing.done'], listens: [] } }],
    ['reserved scope', { scopes: { required: ['device.sms.read'], optional: [] } }],
    ['unknown scope', { scopes: { required: ['root'], optional: [] } }],
    ['car set in v1', { car: { screens: [] } }],
    ['background tasks in v1', { background: { tasks: ['sync'] } }],
    ['path traversal entry', { entry: '../index.html' }],
    ['bad sdk range', { sdk: 'latest please' }],
    ['unknown form factor', { formFactors: ['fridge'] }],
  ])('rejects %s', (_name, patch) => {
    const res = validateManifest({ ...goodManifest, ...patch });
    expect(res.ok).toBe(false);
  });

  it('derives bus scopes from events', () => {
    const res = validateManifest(goodManifest);
    if (!res.ok) throw new Error('expected ok');
    const scopes = declaredScopes(res.manifest);
    expect(scopes.has('bus.emit:budget.expense.created')).toBe(true);
    expect(scopes.has('bus.listen:core.person.updated')).toBe(true);
  });

  it('checks sdk ranges', () => {
    expect(sdkSatisfies('1.0.0', '>=1.0 <2.0')).toBe(true);
    expect(sdkSatisfies('2.0.0', '>=1.0 <2.0')).toBe(false);
    expect(sdkSatisfies('nope', '>=1.0')).toBe(false);
  });
});

describe('envelope', () => {
  it('accepts a valid hello', () => {
    expect(isHelloMessage({ type: 'hello', appId: 'hello', sdkVersion: '1.0.0' })).toBe(true);
  });

  it.each([null, 'hello', { type: 'hello', appId: 'Hello', sdkVersion: '1.0.0' }, { type: 'hello', appId: 'hello', sdkVersion: 'x' }])(
    'rejects malformed hello %#',
    (data) => expect(isHelloMessage(data)).toBe(false),
  );

  it('parses a request and defaults params', () => {
    const r = parseRequest({ v: 1, id: 'abcdefgh-1234', kind: 'req', method: 'app.ready', token: 't' });
    expect(r).toMatchObject({ ok: true, req: { params: {} } });
  });

  it.each([
    [{ v: 2, id: 'abcdefgh', kind: 'req', method: 'app.ready', token: 't' }, 'version'],
    [{ v: 1, id: 'short', kind: 'req', method: 'app.ready', token: 't' }, 'id'],
    [{ v: 1, id: 'abcdefgh', kind: 'res', method: 'app.ready', token: 't' }, 'kind'],
    [{ v: 1, id: 'abcdefgh', kind: 'req', method: 'app.ready', params: [], token: 't' }, 'params'],
    [{ v: 1, id: 'abcdefgh', kind: 'req', method: 'app.ready' }, 'token'],
  ])('rejects bad request (%#: %s)', (data, _reason) => {
    expect(parseRequest(data).ok).toBe(false);
  });
});

describe('topics', () => {
  it('parses and restricts emitters', () => {
    expect(parseTopic('budget.expense.created')).toEqual({ owner: 'budget', entity: 'expense', verb: 'created' });
    expect(parseTopic('core.person.updated')?.owner).toBe('core');
    expect(parseTopic('budget.expense')).toBeNull();
    expect(canEmit('budget', 'budget.expense.created')).toBe(true);
    expect(canEmit('budget', 'core.person.updated')).toBe(false);
  });
});

describe('methods', () => {
  const validators = compileParamValidators();

  it('every method has a compiled schema and a scope rule', () => {
    for (const name of Object.keys(METHODS) as MethodName[]) {
      expect(typeof validators[name]).toBe('function');
      expect(typeof METHODS[name].scopes).toBe('function');
    }
  });

  it('rejects unknown params (additionalProperties: false)', () => {
    expect(validators['app.setTitle']({ title: 'Hi' })).toBe(true);
    expect(validators['app.setTitle']({ title: 'Hi', evil: true })).toBe(false);
    expect(validators['app.setTitle']({})).toBe(false);
  });

  it('resolves data scopes from the collection prefix', () => {
    expect(METHODS['data.create'].scopes({ collection: 'budget_expenses' }, 'budget')).toEqual(['data.own']);
    expect(METHODS['data.list'].scopes({ collection: 'core_people' }, 'budget')).toEqual(['core.people.read']);
    expect(METHODS['data.update'].scopes({ collection: 'core_people' }, 'budget')).toEqual(['core.people.write']);
    expect(METHODS['data.get'].scopes({ collection: 'other_things' }, 'budget')).toBeNull();
    expect(METHODS['data.get'].scopes({ collection: 'subapps' }, 'budget')).toBeNull();
  });

  it('only lets apps emit their own topics', () => {
    expect(METHODS['bus.emit'].scopes({ topic: 'budget.expense.created' }, 'budget')).toEqual(['bus.emit:budget.expense.created']);
    expect(METHODS['bus.emit'].scopes({ topic: 'core.person.updated' }, 'budget')).toBeNull();
    expect(METHODS['bus.on'].scopes({ topic: 'core.person.updated' }, 'budget')).toEqual(['bus.listen:core.person.updated']);
  });

  it('knows the scope vocabulary', () => {
    expect(isKnownScope('core.people.read')).toBe(true);
    expect(isKnownScope('bus.emit:budget.expense.created')).toBe(true);
    expect(isKnownScope('admin')).toBe(false);
  });

  it('validates Health Connect params (ADR-010)', () => {
    const t0 = '2026-11-28T00:00:00-05:00';
    const t1 = '2026-11-29T00:00:00-05:00';
    expect(validators['device.health.read']({ metrics: ['steps', 'activeCalories'], start: t0, end: t1, bucket: 'day' })).toBe(true);
    expect(validators['device.health.read']({ metrics: ['heartbeat'], start: t0, end: t1 })).toBe(false);
    expect(validators['device.health.read']({ metrics: ['steps', 'steps'], start: t0, end: t1 })).toBe(false);
    expect(validators['device.health.read']({ metrics: ['steps'], start: '2026-11-28', end: t1 })).toBe(false);
    const meal = { type: 'nutrition', clientId: 'abc123def456ghi', start: t0, end: t0, name: 'Oatmeal', mealType: 'breakfast', energyKcal: 300, proteinG: 10 };
    expect(validators['device.health.write']({ records: [meal, { type: 'weight', clientId: 'w1', time: t0, kg: 80.2 }] })).toBe(true);
    expect(validators['device.health.write']({ records: [{ ...meal, steps: 5 }] })).toBe(false);
    expect(validators['device.health.write']({ records: [{ type: 'steps', clientId: 'x', time: t0 }] })).toBe(false);
    expect(validators['device.health.write']({ records: [{ ...meal, energyKcal: -1 }] })).toBe(false);
    expect(validators['device.health.delete']({ type: 'nutrition', clientIds: ['abc'] })).toBe(true);
  });

  it('health writes need the write scope; reads only the read scope', () => {
    expect(METHODS['device.health.read'].scopes({}, 'eatwell')).toEqual(['device.health.read']);
    expect(METHODS['device.health.request'].scopes({ read: ['steps'] }, 'eatwell')).toEqual(['device.health.read']);
    expect(METHODS['device.health.request'].scopes({ read: [], write: ['nutrition'] }, 'eatwell')).toEqual(['device.health.read', 'device.health.write']);
    expect(METHODS['device.health.write'].scopes({}, 'eatwell')).toEqual(['device.health.write']);
    expect(isKnownScope('device.health.read')).toBe(true);
    expect(validateManifest({ ...goodManifest, scopes: { required: ['data.own'], optional: ['device.health.read', 'device.health.write'] } }).ok).toBe(true);
  });
});
