import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const lib = require('../../pb_hooks/lib/agenda-core.js') as {
  ymd(d: Date): string;
  nextOccurrence(kd: Record<string, unknown>, today: Date): Date | null;
  keyDateItem(kd: Record<string, unknown>, person: { id: string; display_name: string } | null, today: Date): Record<string, unknown> | null;
  reachOutItem(row: Record<string, unknown> | null): Record<string, unknown> | null;
  reachRow(person: Record<string, unknown>, lastInteraction: string, ghost: boolean): Record<string, unknown>;
  eatwellGlance(date: string, entries: unknown[], water: unknown[], settings: unknown): Record<string, unknown>;
  projectedId(hash: (s: string) => string, owner: string, key: string): string;
};

const today = new Date(2026, 10, 28); // 28 Nov 2026
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

describe('key dates → core_agenda', () => {
  it('rolls a recurring birthday to its next occurrence and shows the age', () => {
    const item = lib.keyDateItem({ id: 'kd1', kind: 'birthday', year: 1990, month: 3, day: 14, recurring: true }, { id: 'p1', display_name: 'Ada' }, today);
    expect(item).toMatchObject({ kind: 'date', title: 'Birthday: Ada (37)', start: '2027-03-14', all_day: true, source_app: 'contacts', source_key: 'contacts:key_date:kd1', deep_link: 'superapp://contacts/person/p1', person: 'p1' });
  });

  it('keeps a recurring date that is today on today', () => {
    expect(lib.ymd(lib.nextOccurrence({ month: 11, day: 28, recurring: true }, today)!)).toBe('2026-11-28');
  });

  it('drops one-off dates in the past and deleted dates', () => {
    expect(lib.keyDateItem({ id: 'x', kind: 'follow_up', year: 2026, month: 1, day: 2, recurring: false }, null, today)).toBeNull();
    expect(lib.keyDateItem({ id: 'x', kind: 'birthday', month: 1, day: 2, recurring: true, deleted: true }, null, today)).toBeNull();
    expect(lib.keyDateItem({ id: 'x', kind: 'follow_up', year: 2026, month: 12, day: 2, recurring: false }, null, today)).toMatchObject({ start: '2026-12-02', title: 'Follow up' });
  });

  it('puts 29 February on 28 February in non-leap years', () => {
    expect(lib.ymd(lib.nextOccurrence({ month: 2, day: 29, recurring: true }, today)!)).toBe('2027-02-28');
  });
});

describe('reach-out → core_agenda', () => {
  it('creates a due task with a deep link to the person', () => {
    expect(lib.reachOutItem({ id: 'p1', display_name: 'Ada', due_on: '2026-11-30', is_ghost: false })).toMatchObject({ kind: 'task', title: 'Reach out to Ada', start: '2026-11-30', priority: 1, person: 'p1', deep_link: 'superapp://contacts/person/p1' });
  });
  it('computes the due date like the contacts_reach_out view', () => {
    const p = { id: 'p1', display_name: 'Ada', next_touch: '', last_touch: '2026-10-01', cadence_days: 30 };
    expect(lib.reachRow(p, '', false).due_on).toBe('2026-10-31');
    expect(lib.reachRow(p, '2026-11-10', false).due_on).toBe('2026-12-10');
    expect(lib.reachRow({ ...p, next_touch: '2026-12-01' }, '2026-11-10', false).due_on).toBe('2026-12-01');
    expect(lib.reachRow({ ...p, cadence_days: 0 }, '', false).due_on).toBeNull();
    expect(lib.reachRow({ ...p, last_touch: '' }, '', true)).toMatchObject({ due_on: null, is_ghost: true });
  });

  it('removes the item when there is no due date or the person is a ghost', () => {
    expect(lib.reachOutItem({ id: 'p1', display_name: 'Ada', due_on: null })).toBeNull();
    expect(lib.reachOutItem({ id: 'p1', display_name: 'Ada', due_on: '2026-11-30', is_ghost: true })).toBeNull();
    expect(lib.reachOutItem(null)).toBeNull();
  });
});

describe('EatWell → core_glances', () => {
  it('sums the day, ignores deleted rows and uses the budget override as target', () => {
    const g = lib.eatwellGlance('2026-11-28', [{ kcal: 420 }, { kcal: 610.4 }, { kcal: 900, deleted: true }], [{ ml: 500 }, { ml: 750 }], { budget_override: 2100 });
    expect(g).toMatchObject({ app_id: 'eatwell', key: 'intake', date: '2026-11-28', value: 1030, unit: 'kcal', target: 2100, detail: '1.3 L water' });
  });
  it('has no target without an override', () => {
    expect(lib.eatwellGlance('2026-11-28', [], [], null)).toMatchObject({ value: 0, target: null, detail: 'No water logged' });
  });
});

describe('projected ids', () => {
  it('are valid PocketBase ids and stable per owner and key', () => {
    const a = lib.projectedId(md5, 'user1', 'contacts:key_date:kd1');
    expect(a).toMatch(/^[a-z0-9]{15}$/);
    expect(lib.projectedId(md5, 'user1', 'contacts:key_date:kd1')).toBe(a);
    expect(lib.projectedId(md5, 'user2', 'contacts:key_date:kd1')).not.toBe(a);
  });
});
