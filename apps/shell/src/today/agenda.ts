/**
 * Today home logic (SA-2026-009). Pure functions over core_agenda items: no DOM, no clock of its
 * own (callers pass `now`), so every rule here is unit-tested.
 */
export type AgendaKind = 'event' | 'task' | 'reminder' | 'focus' | 'date';

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  title: string;
  /** `YYYY-MM-DD` (all-day) or `YYYY-MM-DDTHH:MM[...]` local time. */
  start: string;
  end?: string | null;
  all_day?: boolean;
  status?: 'open' | 'done' | 'skipped' | '';
  priority?: number;
  source_app: string;
  deep_link?: string | null;
  person?: string | null;
  notes?: string | null;
  deleted?: boolean;
  version?: number;
}

export interface Glance {
  id: string;
  app_id: string;
  key: string;
  date: string;
  title: string;
  value?: number | null;
  unit?: string | null;
  target?: number | null;
  detail?: string | null;
  deep_link?: string | null;
  deleted?: boolean;
}

export type TimelineEntry =
  | { type: 'item'; item: AgendaItem; startMin: number; endMin: number }
  | { type: 'free'; startMin: number; endMin: number }
  | { type: 'now'; min: number };

export interface DayPlan {
  day: string;
  isToday: boolean;
  /** All-day items for the day (dates, all-day events, tasks due that day). */
  allDay: AgendaItem[];
  /** Open tasks and reminders from earlier days (only on today). */
  overdue: AgendaItem[];
  timeline: TimelineEntry[];
  /** Minutes of free time between dayStart and dayEnd (from now on, for today). */
  freeMinutes: number;
}

export interface PlanOptions {
  dayStartMin?: number;
  dayEndMin?: number;
  /** Shortest gap worth showing as free time. */
  minGapMin?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return ymd(new Date(y, m - 1, d + n));
}

/** Splits `start`/`end` into a local day and minutes after midnight (null for all-day). */
export function parseWhen(s: string | null | undefined): { day: string; min: number | null } | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s ?? ''));
  if (!m) return null;
  return { day: m[1]!, min: m[2] === undefined ? null : Number(m[2]) * 60 + Number(m[3]) };
}

const DEFAULT_LEN: Record<AgendaKind, number> = { event: 60, focus: 50, task: 15, reminder: 0, date: 0 };

export const isOpen = (i: AgendaItem) => !i.status || i.status === 'open';

function span(i: AgendaItem): { day: string; startMin: number; endMin: number } | null {
  const s = parseWhen(i.start);
  if (!s || s.min === null || i.all_day) return null;
  const e = parseWhen(i.end);
  const endMin = e && e.min !== null && e.day === s.day && e.min > s.min ? e.min : s.min + DEFAULT_LEN[i.kind];
  return { day: s.day, startMin: s.min, endMin: Math.min(endMin, 24 * 60) };
}

export function planDay(items: readonly AgendaItem[], day: string, now: Date, opts: PlanOptions = {}): DayPlan {
  const dayStart = opts.dayStartMin ?? 8 * 60;
  const dayEnd = opts.dayEndMin ?? 21 * 60;
  const minGap = opts.minGapMin ?? 30;
  const live = items.filter((i) => !i.deleted);
  const isToday = day === ymd(now);
  const nowMin = minutesOf(now);

  const allDay = live
    .filter((i) => {
      const s = parseWhen(i.start);
      return s && s.day === day && (s.min === null || i.all_day);
    })
    .sort((a, b) => kindRank(a) - kindRank(b) || (b.priority ?? 0) - (a.priority ?? 0) || a.title.localeCompare(b.title));

  const overdue = isToday
    ? live
        .filter((i) => (i.kind === 'task' || i.kind === 'reminder') && isOpen(i))
        .filter((i) => {
          const s = parseWhen(i.start);
          return s !== null && s.day < day;
        })
        .sort((a, b) => a.start.localeCompare(b.start))
    : [];

  const timed = live
    .map((item) => ({ item, s: span(item) }))
    .filter((x): x is { item: AgendaItem; s: { day: string; startMin: number; endMin: number } } => x.s !== null && x.s.day === day)
    .sort((a, b) => a.s.startMin - b.s.startMin || a.s.endMin - b.s.endMin);

  const timeline: TimelineEntry[] = [];
  let cursor = isToday ? Math.max(dayStart, nowMin) : dayStart;
  let freeMinutes = 0;
  let nowPlaced = !isToday;
  const placeNow = (beforeMin: number) => {
    if (!nowPlaced && nowMin <= beforeMin) {
      timeline.push({ type: 'now', min: nowMin });
      nowPlaced = true;
    }
  };
  const addFree = (from: number, to: number) => {
    const a = Math.max(from, dayStart);
    const b = Math.min(to, dayEnd);
    if (b - a >= minGap) {
      timeline.push({ type: 'free', startMin: a, endMin: b });
      freeMinutes += b - a;
    }
  };

  for (const { item, s } of timed) {
    placeNow(s.startMin);
    // Reminders are points in time: they do not end a free block.
    if (s.startMin > cursor && isOpen(item) && item.kind !== 'reminder') addFree(cursor, s.startMin);
    timeline.push({ type: 'item', item, startMin: s.startMin, endMin: s.endMin });
    if (isOpen(item) && item.kind !== 'reminder') cursor = Math.max(cursor, s.endMin);
  }
  placeNow(24 * 60);
  if (cursor < dayEnd) addFree(cursor, dayEnd);

  // Keep the now-line in chronological order relative to free blocks that start before it.
  timeline.sort((a, b) => entryStart(a) - entryStart(b) || order(a) - order(b));
  return { day, isToday, allDay, overdue, timeline, freeMinutes };
}

const entryStart = (e: TimelineEntry) => (e.type === 'now' ? e.min : e.startMin);
const order = (e: TimelineEntry) => (e.type === 'now' ? 0 : e.type === 'free' ? 1 : 2);
const kindRank = (i: AgendaItem) => ({ date: 0, event: 1, task: 2, reminder: 3, focus: 4 })[i.kind];

export interface NowNext {
  current: { item: AgendaItem; startMin: number; endMin: number } | null;
  next: { item: AgendaItem; startMin: number; endMin: number } | null;
  /** A free window worth protecting, starting now (or at its start) and at least minGap long. */
  focusWindow: { startMin: number; endMin: number } | null;
}

export function nowNext(plan: DayPlan, now: Date, minGapMin = 30): NowNext {
  const nowMin = minutesOf(now);
  const items = plan.timeline.filter((e): e is Extract<TimelineEntry, { type: 'item' }> => e.type === 'item' && isOpen(e.item) && e.item.kind !== 'reminder');
  const current = items.find((e) => e.startMin <= nowMin && nowMin < e.endMin) ?? null;
  const next = items.find((e) => e.startMin > nowMin) ?? null;
  let focusWindow: NowNext['focusWindow'] = null;
  if (plan.isToday && !current) {
    const free = plan.timeline.find((e): e is Extract<TimelineEntry, { type: 'free' }> => e.type === 'free' && e.endMin > nowMin);
    if (free) {
      const start = Math.max(free.startMin, Math.ceil(nowMin / 5) * 5);
      if (free.endMin - start >= minGapMin) focusWindow = { startMin: start, endMin: free.endMin };
    }
  }
  return { current: current && { item: current.item, startMin: current.startMin, endMin: current.endMin }, next: next && { item: next.item, startMin: next.startMin, endMin: next.endMin }, focusWindow };
}

export interface WeekDay {
  day: string;
  weekday: number;
  count: number;
  focusMinutes: number;
  isToday: boolean;
}

/** Monday-first week containing `day`, with item counts and planned focus per day. */
export function weekOf(items: readonly AgendaItem[], day: string, now: Date): WeekDay[] {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const monday = addDays(day, -((date.getDay() + 6) % 7));
  const today = ymd(now);
  return Array.from({ length: 7 }, (_, i) => {
    const di = addDays(monday, i);
    const onDay = items.filter((it) => !it.deleted && parseWhen(it.start)?.day === di);
    const focusMinutes = onDay.filter((it) => it.kind === 'focus').reduce((sum, it) => {
      const s = span(it);
      return sum + (s ? s.endMin - s.startMin : 0);
    }, 0);
    return { day: di, weekday: i, count: onDay.length, focusMinutes, isToday: di === today };
  });
}

export const fmtClock = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

/** `superapp://<appId>/<path>` → app id, or null. */
export function appOfLink(link: string | null | undefined): string | null {
  const m = /^superapp:\/\/([a-z][a-z0-9]{1,31})(?:\/|$)/.exec(String(link ?? ''));
  return m ? m[1]! : null;
}

export function glanceProgress(g: Glance): number | null {
  if (g.value === null || g.value === undefined || !g.target) return null;
  return Math.max(0, Math.min(1, g.value / g.target));
}
