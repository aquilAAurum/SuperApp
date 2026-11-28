/**
 * Today home data (SA-2026-009, ADR-011). Reads core_agenda and core_glances from the local mirror
 * (so the screen works offline), refreshes them from the server, and writes the shell's own items
 * (quick add, focus blocks) with source_app "shell". Health on Today is opt-in and read on demand:
 * aggregates only, never stored or logged (ADR-010 §8).
 */
import { HEALTH_READ_PERMISSION } from '@superapp/contracts';
import type { HealthPort } from '../bridge/device-handlers.ts';
import type { Logger } from '../core/logger.ts';
import type { SyncEngine } from '../sync/engine.ts';
import { writable, type Writable } from '../ui/store.ts';
import { fmtClock, isOpen, ymd, type AgendaItem, type AgendaKind, type Glance } from './agenda.ts';

export const PREF_TODAY_HEALTH = 'today.health';

export interface HealthToday {
  steps: number | null;
  activeCalories: number | null;
}

export interface QuickAddInput {
  title: string;
  kind: Exclude<AgendaKind, 'date'>;
  day: string;
  /** Minutes after midnight, or null for all-day / untimed. */
  timeMin: number | null;
  durationMin: number;
  notes?: string;
}

export interface TodayDeps {
  sync: SyncEngine;
  health: HealthPort;
  isNative: () => boolean;
  getPref: (k: string) => Promise<string | null>;
  setPref: (k: string, v: string) => Promise<void>;
  logger: Logger;
  now?: () => Date;
}

const iso = (day: string, min: number) => `${day}T${fmtClock(min)}`;

export class TodayService {
  readonly items: Writable<AgendaItem[]> = writable([]);
  readonly glances: Writable<Glance[]> = writable([]);
  readonly health: Writable<HealthToday | null> = writable(null);
  readonly healthEnabled: Writable<boolean> = writable(false);
  readonly now: Writable<Date>;
  private offs: (() => void)[] = [];
  private readonly clock: () => Date;

  constructor(private readonly deps: TodayDeps) {
    this.clock = deps.now ?? (() => new Date());
    this.now = writable(this.clock());
  }

  /** Called when the Today screen mounts; returns a stop function. */
  start(): () => void {
    this.offs.push(this.deps.sync.watch('core_agenda', () => void this.reload()));
    this.offs.push(this.deps.sync.watch('core_glances', () => void this.reload()));
    const tick = setInterval(() => this.now.set(this.clock()), 30_000);
    this.offs.push(() => clearInterval(tick));
    void this.reload();
    void this.deps.sync.refresh('core_agenda');
    void this.deps.sync.refresh('core_glances');
    void this.loadHealth();
    return () => {
      for (const off of this.offs.splice(0)) off();
    };
  }

  async reload(): Promise<void> {
    const [a, g] = await Promise.all([
      this.deps.sync.data.list('core_agenda', { perPage: 5000 }),
      this.deps.sync.data.list('core_glances', { filter: `date = '${ymd(this.clock())}'`, perPage: 100 }),
    ]);
    this.items.set(a.items as unknown as AgendaItem[]);
    this.glances.set(g.items as unknown as Glance[]);
    this.now.set(this.clock());
  }

  async quickAdd(input: QuickAddInput): Promise<void> {
    const title = input.title.trim().slice(0, 200);
    if (!title) throw new Error('Give it a title.');
    const timed = input.timeMin !== null;
    const end = timed && input.durationMin > 0 && input.kind !== 'reminder' ? iso(input.day, Math.min(input.timeMin! + input.durationMin, 23 * 60 + 59)) : '';
    await this.deps.sync.data.create('shell', 'core_agenda', {
      kind: input.kind,
      title,
      start: timed ? iso(input.day, input.timeMin!) : input.day,
      end,
      all_day: !timed,
      status: 'open',
      priority: 0,
      source_app: 'shell',
      notes: (input.notes ?? '').slice(0, 2000),
    });
    this.deps.logger.info('today.item_added', { kind: input.kind, timed });
  }

  /** Protect a focus window: a "Focus" block from its start to its end, today. */
  async startFocus(startMin: number, endMin: number, title = 'Focus'): Promise<void> {
    const day = ymd(this.clock());
    await this.deps.sync.data.create('shell', 'core_agenda', {
      kind: 'focus',
      title,
      start: iso(day, startMin),
      end: iso(day, endMin),
      all_day: false,
      status: 'open',
      priority: 0,
      source_app: 'shell',
    });
    this.deps.logger.info('today.focus_started', { minutes: endMin - startMin });
  }

  /** The shell only completes its own items; other apps' items open their app instead. */
  async toggleDone(item: AgendaItem): Promise<void> {
    if (item.source_app !== 'shell') return;
    await this.deps.sync.data.update('shell', 'core_agenda', item.id, { status: isOpen(item) ? 'done' : 'open' });
  }

  async remove(item: AgendaItem): Promise<void> {
    if (item.source_app !== 'shell') return;
    await this.deps.sync.data.delete('shell', 'core_agenda', item.id);
  }

  async setHealthEnabled(on: boolean): Promise<void> {
    await this.deps.setPref(PREF_TODAY_HEALTH, on ? '1' : '0');
    this.healthEnabled.set(on);
    if (on) await this.loadHealth();
    else this.health.set(null);
  }

  /** Steps and active calories since midnight, when the owner opted in and Health Connect granted them. */
  async loadHealth(): Promise<void> {
    const on = (await this.deps.getPref(PREF_TODAY_HEALTH)) === '1';
    this.healthEnabled.set(on);
    if (!on || !this.deps.isNative()) return this.health.set(null);
    try {
      const status = await this.deps.health.status();
      if (!status.available) return this.health.set(null);
      const granted = new Set(status.granted);
      const metrics = (['steps', 'activeCalories'] as const).filter((m) => granted.has(HEALTH_READ_PERMISSION[m]));
      if (metrics.length === 0) return this.health.set({ steps: null, activeCalories: null });
      const now = this.clock();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const [bucket] = await this.deps.health.aggregate([...metrics], midnight.toISOString(), now.toISOString(), 'none');
      this.health.set({ steps: bucket?.values.steps ?? null, activeCalories: bucket?.values.activeCalories ?? null });
      this.deps.logger.info('today.health_read', { metrics: metrics.length });
    } catch (err) {
      this.deps.logger.warn('today.health_failed', { error: (err as Error).message });
      this.health.set(null);
    }
  }
}
