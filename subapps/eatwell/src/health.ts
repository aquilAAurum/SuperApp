// Health Connect through the Supra bridge (ADR-010). EatWell never talks to Android itself: the shell
// checks the manifest, shows its consent sheet, then Health Connect's own permission dialog.
// Readings are shown live and never copied into eatwell_* collections.
import { BridgeError, type HealthReadMetric, type HealthStatus, type HealthWriteRecord, type SuperApp, isoLocal } from '@superapp/sdk';
import { dayBounds, ymd, type Entry, type Meal, type Weight, type Water } from './model.ts';

export const ACTIVITY_METRICS: HealthReadMetric[] = ['steps', 'activeCalories', 'exerciseMinutes', 'sleepMinutes', 'distance', 'restingHeartRate', 'weight'];

export type HealthState =
  | { kind: 'unknown' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'not_connected' }
  | { kind: 'connected'; status: HealthStatus };

export interface DayActivity {
  steps?: number;
  activeCalories?: number;
  exerciseMinutes?: number;
  sleepMinutes?: number;
  distance?: number;
  restingHeartRate?: number;
  weight?: number;
}

const REASON: Record<string, string> = {
  unsupported: "Health Connect isn't available on this device.",
  not_installed: 'Install Health Connect from the Play Store to see activity here.',
  update_required: 'Update Health Connect from the Play Store to see activity here.',
};

export class Health {
  state: HealthState = { kind: 'unknown' };

  constructor(private readonly sa: SuperApp) {}

  async refresh(): Promise<HealthState> {
    try {
      const st = await this.sa.device.health.status();
      if (!st.available) this.state = { kind: 'unavailable', reason: REASON[st.reason ?? 'unsupported'] ?? REASON.unsupported! };
      else if (st.granted.read.length === 0 && st.granted.write.length === 0) this.state = { kind: 'not_connected' };
      else this.state = { kind: 'connected', status: st };
    } catch (err) {
      const code = err instanceof BridgeError ? err.code : 'INTERNAL';
      // An older shell has no device.health.* methods; a newer one without the scope declared says SCOPE_DENIED.
      this.state = code === 'UNKNOWN_METHOD' || code === 'NOT_IMPLEMENTED' ? { kind: 'unavailable', reason: 'Update Supra to connect Health Connect.' } : { kind: 'unavailable', reason: REASON.unsupported! };
    }
    return this.state;
  }

  /** Shows Supra's consent sheet, then Health Connect's dialog. Write access only if the owner wants it. */
  async connect(write: boolean): Promise<HealthState> {
    try {
      await this.sa.device.health.request({ read: ACTIVITY_METRICS, write: write ? ['nutrition', 'weight', 'hydration'] : [] });
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'SCOPE_DENIED') {
        await this.refresh();
        throw new Error('Health access was not allowed. You can change this in Supra → Settings → Permissions.', { cause: err });
      }
      if (err instanceof BridgeError && err.code === 'UNAVAILABLE') return this.refresh();
      throw err;
    }
    return this.refresh();
  }

  canRead(m: HealthReadMetric): boolean {
    return this.state.kind === 'connected' && this.state.status.granted.read.includes(m);
  }

  canWrite(t: 'nutrition' | 'weight' | 'hydration'): boolean {
    return this.state.kind === 'connected' && this.state.status.granted.write.includes(t);
  }

  /** One day's activity (local calendar day). */
  async day(date: string): Promise<DayActivity | null> {
    const metrics = ACTIVITY_METRICS.filter((m) => this.canRead(m));
    if (!metrics.length) return null;
    const { start, end } = dayBounds(date);
    try {
      const res = await this.sa.device.health.read(metrics, start, end, 'none');
      return (res.buckets[0]?.values ?? {}) as DayActivity;
    } catch {
      return null;
    }
  }

  /** Per-day series for trends, oldest first. */
  async series(metric: HealthReadMetric, from: string, to: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!this.canRead(metric)) return out;
    try {
      const res = await this.sa.device.health.read([metric], dayBounds(from).start, dayBounds(to).end, 'day');
      for (const b of res.buckets) {
        const v = b.values[metric];
        // Bucket starts are local midnights; read them back as local calendar days.
        if (typeof v === 'number') out.set(ymd(new Date(b.start)), v);
      }
    } catch {
      // Trends without Health Connect still render from EatWell's own data.
    }
    return out;
  }

  // ------------------------------------------------------------ writes (owner's own logs only)

  async writeEntries(entries: Entry[]): Promise<void> {
    if (!this.canWrite('nutrition') || !entries.length) return;
    const records: HealthWriteRecord[] = entries.map((e) => {
      const at = e.logged_at ? new Date(e.logged_at) : mealTime(e.date, e.meal);
      return {
        type: 'nutrition',
        clientId: e.id,
        start: isoLocal(at),
        end: isoLocal(at),
        name: e.name.slice(0, 100),
        mealType: e.meal,
        energyKcal: Math.max(0, e.kcal ?? 0),
        ...num('proteinG', e.protein_g),
        ...num('carbsG', e.carbs_g),
        ...num('fatG', e.fat_g),
        ...num('fiberG', e.fiber_g),
        ...num('sugarG', e.sugar_g),
        ...num('sodiumMg', e.sodium_mg),
      };
    });
    await this.quiet(() => this.sa.device.health.write(records));
  }

  async deleteEntry(id: string): Promise<void> {
    if (this.canWrite('nutrition')) await this.quiet(() => this.sa.device.health.delete('nutrition', [id]));
  }

  async writeWeight(w: Weight): Promise<void> {
    if (!this.canWrite('weight')) return;
    const at = mealTime(w.date, 'breakfast');
    await this.quiet(() => this.sa.device.health.write([{ type: 'weight', clientId: w.id, time: isoLocal(at), kg: w.kg }]));
  }

  async deleteWeight(id: string): Promise<void> {
    if (this.canWrite('weight')) await this.quiet(() => this.sa.device.health.delete('weight', [id]));
  }

  async writeWater(w: Water): Promise<void> {
    if (!this.canWrite('hydration')) return;
    const at = w.logged_at ? new Date(w.logged_at) : mealTime(w.date, 'lunch');
    await this.quiet(() => this.sa.device.health.write([{ type: 'hydration', clientId: w.id, start: isoLocal(at), end: isoLocal(at), liters: w.ml / 1000 }]));
  }

  async deleteWater(id: string): Promise<void> {
    if (this.canWrite('hydration')) await this.quiet(() => this.sa.device.health.delete('hydration', [id]));
  }

  /** Health Connect mirroring is best effort: the diary (synced to the server) is the source of truth. */
  private async quiet(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      void this.sa.sys.log('warn', 'eatwell.health_write_failed', { code: err instanceof BridgeError ? err.code : 'INTERNAL' });
    }
  }
}

function num<K extends string>(k: K, v: number | undefined): Partial<Record<K, number>> {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? ({ [k]: v } as Record<K, number>) : {};
}

/** A plausible time for a meal logged against a past or future day. */
export function mealTime(date: string, meal: Meal): Date {
  const h = { breakfast: 8, lunch: 12, dinner: 18, snack: 15 }[meal];
  const d = dayBounds(date).start;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0);
}
