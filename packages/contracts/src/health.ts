/**
 * Health Connect over the bridge (ADR-010). Device-agnostic names: a subapp asks for "steps", not
 * for an Android record class, so the same contract can later be served by another platform's
 * health store. Units are fixed (SI + kcal) so no subapp ever converts on the phone's behalf.
 *
 *   steps            count              (aggregate)
 *   distance         metres             (aggregate)
 *   activeCalories   kcal               (aggregate)
 *   totalCalories    kcal               (aggregate; BMR + active, as the watch reports it)
 *   exerciseMinutes  minutes            (aggregate of exercise sessions)
 *   sleepMinutes     minutes            (aggregate of sleep sessions ending in the bucket)
 *   restingHeartRate bpm                (average)
 *   weight           kg                 (latest sample in the bucket)
 *   hydration        litres             (aggregate)
 *   nutrition        kcal               (aggregate energy of nutrition records, any app)
 */
export const HEALTH_READ_METRICS = [
  'steps',
  'distance',
  'activeCalories',
  'totalCalories',
  'exerciseMinutes',
  'sleepMinutes',
  'restingHeartRate',
  'weight',
  'hydration',
  'nutrition',
] as const;
export type HealthReadMetric = (typeof HEALTH_READ_METRICS)[number];

/** Record types a subapp may write. Writes are upserts keyed by the app's own `clientId`. */
export const HEALTH_WRITE_TYPES = ['nutrition', 'weight', 'hydration'] as const;
export type HealthWriteType = (typeof HEALTH_WRITE_TYPES)[number];

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'unknown'] as const;
export type HealthMealType = (typeof MEAL_TYPES)[number];

/** Why Health Connect cannot be used on this device. */
export type HealthUnavailableReason = 'unsupported' | 'not_installed' | 'update_required';

export interface HealthStatus {
  available: boolean;
  reason?: HealthUnavailableReason;
  /** Health Connect permissions the shell holds right now, in contract names. */
  granted: { read: HealthReadMetric[]; write: HealthWriteType[] };
}

export interface HealthBucket {
  /** ISO 8601 instant, inclusive. */
  start: string;
  /** ISO 8601 instant, exclusive. */
  end: string;
  /** Only metrics that were requested, granted and have data in the bucket. */
  values: Partial<Record<HealthReadMetric, number>>;
}

export interface HealthReadResult {
  buckets: HealthBucket[];
  /** Requested metrics the shell lacks a Health Connect permission for (ask with device.health.request). */
  missing: HealthReadMetric[];
}

interface WriteBase {
  /** The subapp's own stable id (its record id). Rewriting the same clientId replaces the record. */
  clientId: string;
}
export interface NutritionWrite extends WriteBase {
  type: 'nutrition';
  start: string;
  end: string;
  name?: string;
  mealType?: HealthMealType;
  energyKcal: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
}
export interface WeightWrite extends WriteBase {
  type: 'weight';
  time: string;
  kg: number;
}
export interface HydrationWrite extends WriteBase {
  type: 'hydration';
  start: string;
  end: string;
  liters: number;
}
export type HealthWriteRecord = NutritionWrite | WeightWrite | HydrationWrite;

export interface HealthWriteResult {
  written: number;
  /** Types the shell lacks write permission for; those records were skipped. */
  missing: HealthWriteType[];
}

/** Longest range one read may cover (keeps a single call bounded on the phone). */
export const HEALTH_MAX_RANGE_DAYS = 400;

/** Contract name → Health Connect permission (`android.permission.health.*`) the shell must hold. */
export const HEALTH_READ_PERMISSION: Record<HealthReadMetric, string> = {
  steps: 'READ_STEPS',
  distance: 'READ_DISTANCE',
  activeCalories: 'READ_ACTIVE_CALORIES_BURNED',
  totalCalories: 'READ_TOTAL_CALORIES_BURNED',
  exerciseMinutes: 'READ_EXERCISE',
  sleepMinutes: 'READ_SLEEP',
  restingHeartRate: 'READ_RESTING_HEART_RATE',
  weight: 'READ_WEIGHT',
  hydration: 'READ_HYDRATION',
  nutrition: 'READ_NUTRITION',
};
export const HEALTH_WRITE_PERMISSION: Record<HealthWriteType, string> = {
  nutrition: 'WRITE_NUTRITION',
  weight: 'WRITE_WEIGHT',
  hydration: 'WRITE_HYDRATION',
};
