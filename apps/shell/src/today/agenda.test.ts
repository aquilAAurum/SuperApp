import { describe, expect, it } from 'vitest';
import { appOfLink, fmtDuration, glanceProgress, nowNext, parseWhen, planDay, weekOf, type AgendaItem } from './agenda.ts';

const at = (h: number, m = 0) => new Date(2026, 10, 28, h, m); // Sat 28 Nov 2026
const item = (p: Partial<AgendaItem> & Pick<AgendaItem, 'start'>): AgendaItem => ({ id: p.title ?? p.start, kind: 'event', title: 'x', source_app: 'shell', status: 'open', ...p });

const day = [
  item({ title: 'Standup', start: '2026-11-28T09:00', end: '2026-11-28T09:30' }),
  item({ title: 'Lunch', start: '2026-11-28T12:30', end: '2026-11-28T13:30' }),
  item({ title: 'Drink water', kind: 'reminder', start: '2026-11-28T15:00' }),
  item({ title: 'Birthday: Ada', kind: 'date', start: '2026-11-28', all_day: true, source_app: 'contacts' }),
  item({ title: 'Reach out to Ben', kind: 'task', start: '2026-11-25', all_day: true, source_app: 'contacts' }),
  item({ title: 'Done task', kind: 'task', start: '2026-11-20', status: 'done' }),
  item({ title: 'Gone', start: '2026-11-28T10:00', deleted: true }),
  item({ title: 'Tomorrow', start: '2026-11-29T10:00' }),
];

describe('planDay', () => {
  it('splits all-day, overdue and timed items, with free gaps from now on', () => {
    const plan = planDay(day, '2026-11-28', at(10, 2));
    expect(plan.allDay.map((i) => i.title)).toEqual(['Birthday: Ada']);
    expect(plan.overdue.map((i) => i.title)).toEqual(['Reach out to Ben']);
    const shape = plan.timeline.map((e) => (e.type === 'item' ? e.item.title : e.type === 'free' ? `free ${e.startMin}-${e.endMin}` : `now ${e.min}`));
    expect(shape).toEqual(['Standup', 'now 602', 'free 602-750', 'Lunch', 'free 810-1260', 'Drink water']);
    expect(plan.freeMinutes).toBe(148 + 450);
  });

  it('plans another day from the day start, without overdue or now-line', () => {
    const plan = planDay(day, '2026-11-29', at(10));
    expect(plan.overdue).toEqual([]);
    expect(plan.timeline.some((e) => e.type === 'now')).toBe(false);
    expect(plan.timeline.filter((e) => e.type === 'free').map((e) => e.type === 'free' && [e.startMin, e.endMin])).toEqual([[480, 600], [660, 1260]]);
  });

  it('ignores gaps shorter than the minimum', () => {
    const plan = planDay([item({ start: '2026-11-28T09:00', end: '2026-11-28T09:50' }), item({ start: '2026-11-28T10:10', end: '2026-11-28T11:00' })], '2026-11-28', at(7), { dayEndMin: 11 * 60 });
    expect(plan.timeline.filter((e) => e.type === 'free').map((e) => e.type === 'free' && e.startMin)).toEqual([480]);
  });
});

describe('nowNext', () => {
  it('reports the current item and the next one', () => {
    const r = nowNext(planDay(day, '2026-11-28', at(9, 10)), at(9, 10));
    expect(r.current?.item.title).toBe('Standup');
    expect(r.next?.item.title).toBe('Lunch');
    expect(r.focusWindow).toBeNull();
  });

  it('offers a focus window in free time, rounded up to 5 minutes', () => {
    const r = nowNext(planDay(day, '2026-11-28', at(10, 2)), at(10, 2));
    expect(r.current).toBeNull();
    expect(r.focusWindow).toEqual({ startMin: 605, endMin: 750 });
  });

  it('suggests the next free window when the current gap is too short', () => {
    const r = nowNext(planDay(day, '2026-11-28', at(12, 10)), at(12, 10));
    expect(r.focusWindow).toEqual({ startMin: 810, endMin: 1260 });
  });

  it('no focus window while something is happening', () => {
    expect(nowNext(planDay(day, '2026-11-28', at(12, 45)), at(12, 45)).focusWindow).toBeNull();
  });
});

describe('weekOf', () => {
  it('is Monday-first with counts and focus minutes', () => {
    const items = [...day, item({ title: 'Deep work', kind: 'focus', start: '2026-11-26T14:00', end: '2026-11-26T15:30' })];
    const w = weekOf(items, '2026-11-28', at(10));
    expect(w.map((d) => d.day)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(w[5]).toMatchObject({ isToday: true, count: 4 });
    expect(w[3]).toMatchObject({ focusMinutes: 90 });
  });
});

describe('helpers', () => {
  it('parse, format, link and progress', () => {
    expect(parseWhen('2026-11-28T09:05:00Z')).toEqual({ day: '2026-11-28', min: 545 });
    expect(parseWhen('2026-11-28')).toEqual({ day: '2026-11-28', min: null });
    expect(parseWhen('nope')).toBeNull();
    expect(fmtDuration(150)).toBe('2 h 30 min');
    expect(appOfLink('superapp://contacts/person/abc')).toBe('contacts');
    expect(appOfLink('https://x')).toBeNull();
    expect(glanceProgress({ id: 'g', app_id: 'eatwell', key: 'intake', date: 'd', title: 't', value: 1500, target: 2000 })).toBe(0.75);
    expect(glanceProgress({ id: 'g', app_id: 'eatwell', key: 'intake', date: 'd', title: 't', value: 1500 })).toBeNull();
  });
});
