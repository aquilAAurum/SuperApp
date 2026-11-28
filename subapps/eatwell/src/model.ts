// EatWell model: pure functions over the eatwell_* records (no DOM, no SDK) so the numbers the owner
// relies on (budget, totals, macros, trends) are unit-tested. Amounts are metric internally.
import { BUILTIN_FOODS, type BuiltinFood } from './foods.ts';
import { dbFoods } from './fooddb.ts';

export const COLLECTIONS = {
  entries: 'eatwell_entries',
  foods: 'eatwell_foods',
  weights: 'eatwell_weights',
  water: 'eatwell_water',
  settings: 'eatwell_settings',
} as const;
export type CollectionKey = keyof typeof COLLECTIONS;

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Meal = (typeof MEALS)[number];
export const MEAL_LABEL: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };

export interface Nutrients {
  kcal: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  sugar_g?: number;
  sodium_mg?: number;
}
const NUTRIENT_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg'] as const;

interface Synced {
  id: string;
  version?: number;
  deleted?: boolean;
}
export interface Entry extends Synced, Nutrients {
  date: string;
  meal: Meal;
  name: string;
  brand?: string;
  servings?: number;
  serving_label?: string;
  food_ref?: string;
  logged_at?: string;
}
export interface OwnFood extends Synced, Partial<Nutrients> {
  name: string;
  brand?: string;
  serving_label?: string;
  favorite?: boolean;
  builtin_ref?: string;
}
export interface Weight extends Synced {
  date: string;
  kg: number;
}
export interface Water extends Synced {
  date: string;
  ml: number;
  logged_at?: string;
}
export type Activity = 'sedentary' | 'light' | 'moderate' | 'very' | 'extra';
export interface Settings extends Synced {
  units?: 'imperial' | 'metric';
  sex?: 'male' | 'female';
  birth_year?: number;
  height_cm?: number;
  activity?: Activity;
  goal_kg?: number;
  rate_kg_week?: number;
  budget_override?: number;
  protein_pct?: number;
  carbs_pct?: number;
  fat_pct?: number;
  water_goal_ml?: number;
  exercise_adds?: boolean;
  hc_write?: boolean;
  gentle_mode?: boolean;
}

export interface Raw {
  entries: Entry[];
  foods: OwnFood[];
  weights: Weight[];
  water: Water[];
  settings: Settings[];
}
export const emptyRaw = (): Raw => ({ entries: [], foods: [], weights: [], water: [], settings: [] });

export const DEFAULTS: Required<Pick<Settings, 'units' | 'activity' | 'rate_kg_week' | 'protein_pct' | 'carbs_pct' | 'fat_pct' | 'water_goal_ml' | 'exercise_adds' | 'hc_write' | 'gentle_mode'>> = {
  units: 'imperial',
  activity: 'light',
  rate_kg_week: -0.5,
  protein_pct: 30,
  carbs_pct: 40,
  fat_pct: 30,
  water_goal_ml: 2000,
  exercise_adds: true,
  hc_write: true,
  gentle_mode: false,
};

// ------------------------------------------------------------------ dates (owner's local calendar)

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localToday = (now = new Date()): string => ymd(now);
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}
export const addDays = (s: string, n: number): string => {
  const d = parseYmd(s);
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
/** Local midnight-to-midnight for a day (DST-safe: built from calendar fields, not +24 h). */
export function dayBounds(s: string): { start: Date; end: Date } {
  const d = parseYmd(s);
  return { start: d, end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) };
}
export function dayLabel(s: string, today: string): string {
  if (s === today) return 'Today';
  if (s === addDays(today, -1)) return 'Yesterday';
  if (s === addDays(today, 1)) return 'Tomorrow';
  return parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
/** Meal a new entry defaults to, from the hour it is logged. */
export function mealForHour(h: number): Meal {
  if (h < 10.5) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h >= 17 && h < 21.5) return 'dinner';
  return 'snack';
}

// ------------------------------------------------------------------ units

export const KG_PER_LB = 0.45359237;
export const ML_PER_FLOZ = 29.5735;
export const round = (n: number, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
export function fmtWeight(kg: number, units: Settings['units']): string {
  return units === 'metric' ? `${round(kg, 1)} kg` : `${round(kg / KG_PER_LB, 1)} lb`;
}
export function weightToKg(value: number, units: Settings['units']): number {
  return units === 'metric' ? value : value * KG_PER_LB;
}
export function weightFromKg(kg: number, units: Settings['units']): number {
  return round(units === 'metric' ? kg : kg / KG_PER_LB, 1);
}
export function fmtWater(ml: number, units: Settings['units']): string {
  return units === 'metric' ? (ml >= 1000 ? `${round(ml / 1000, 2)} L` : `${Math.round(ml)} ml`) : `${Math.round(ml / ML_PER_FLOZ)} fl oz`;
}
/** One tap of the water button: a 250 ml glass, or 8 fl oz. */
export const waterStep = (units: Settings['units']): number => (units === 'metric' ? 250 : round(8 * ML_PER_FLOZ));
export function heightParts(cm: number): { ft: number; inch: number } {
  const total = cm / 2.54;
  let ft = Math.floor(total / 12);
  let inch = Math.round(total - ft * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return { ft, inch };
}
export const fmtNum = (n: number): string => Math.round(n).toLocaleString();

// ------------------------------------------------------------------ settings and budget

export function settingsOf(raw: Raw): Settings & typeof DEFAULTS {
  const s = raw.settings.filter((x) => !x.deleted).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? { id: '' };
  return { ...DEFAULTS, ...stripUndefined(s), id: s.id };
}
function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>;
}

export const ACTIVITY_FACTOR: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, extra: 1.9 };
export const ACTIVITY_LABEL: Record<Activity, string> = {
  sedentary: 'Mostly sitting',
  light: 'On my feet some of the day',
  moderate: 'On my feet most of the day',
  very: 'Physical job or daily training',
  extra: 'Hard physical work and training',
};
export const KCAL_PER_KG = 7700;

/** Most recent weight on or before `date`. */
export function weightOn(weights: Weight[], date: string): Weight | null {
  let best: Weight | null = null;
  for (const w of weights) if (!w.deleted && w.date <= date && (!best || w.date > best.date)) best = w;
  return best;
}

export interface Budget {
  /** Calories before exercise. */
  base: number;
  /** Calories added from Health Connect active energy (0 when off or not connected). */
  exercise: number;
  total: number;
  /** Why the base is what it is, for the Goals screen. */
  basis: 'override' | 'computed' | 'default';
  bmr: number | null;
  /** Daily change from the weekly goal (negative = deficit). */
  adjustment: number;
  /** True when the computed base was raised to the safety floor. */
  floored: boolean;
  macros: { protein_g: number; carbs_g: number; fat_g: number };
}

export const DEFAULT_BUDGET = 2000;

export function bmr(kg: number, cm: number, age: number, sex: Settings['sex']): number {
  const s = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
  return 10 * kg + 6.25 * cm - 5 * age + s;
}

/**
 * Daily calorie budget (LoseIt-style): maintenance from Mifflin-St Jeor and activity, plus the weekly
 * goal as a daily adjustment, never below a safety floor. When "add exercise" is on, maintenance uses
 * the sedentary factor and the day's Health Connect active calories are added on top, so movement is
 * counted once.
 */
export function budgetFor(s: ReturnType<typeof settingsOf>, kg: number | null, year: number, activeKcal: number | null): Budget {
  const exerciseOn = s.exercise_adds && activeKcal !== null;
  const exercise = exerciseOn ? Math.max(0, Math.round(activeKcal)) : 0;
  const adjustment = Math.round((s.rate_kg_week * KCAL_PER_KG) / 7);
  let base = DEFAULT_BUDGET;
  let basis: Budget['basis'] = 'default';
  let b: number | null = null;
  let floored = false;
  if (s.budget_override && s.budget_override > 0) {
    base = s.budget_override;
    basis = 'override';
  } else if (kg && s.height_cm && s.birth_year) {
    b = bmr(kg, s.height_cm, Math.max(13, year - s.birth_year), s.sex);
    const maintenance = b * (exerciseOn ? ACTIVITY_FACTOR.sedentary : ACTIVITY_FACTOR[s.activity]);
    const floor = s.sex === 'male' ? 1500 : 1200;
    const raw = Math.round(maintenance + adjustment);
    base = Math.max(floor, raw);
    floored = raw < floor;
    basis = 'computed';
  }
  const total = base + exercise;
  const pct = s.protein_pct + s.carbs_pct + s.fat_pct || 100;
  return {
    base,
    exercise,
    total,
    basis,
    bmr: b === null ? null : Math.round(b),
    adjustment,
    floored,
    macros: {
      protein_g: Math.round((total * s.protein_pct) / pct / 4),
      carbs_g: Math.round((total * s.carbs_pct) / pct / 4),
      fat_g: Math.round((total * s.fat_pct) / pct / 9),
    },
  };
}

// ------------------------------------------------------------------ diary

export interface DayTotals extends Required<Nutrients> {
  byMeal: Record<Meal, { kcal: number; entries: Entry[] }>;
  water_ml: number;
}

export function dayTotals(raw: Raw, date: string): DayTotals {
  const byMeal = Object.fromEntries(MEALS.map((m) => [m, { kcal: 0, entries: [] as Entry[] }])) as DayTotals['byMeal'];
  const t: DayTotals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, byMeal, water_ml: 0 };
  for (const e of raw.entries) {
    if (e.deleted || e.date !== date) continue;
    for (const k of NUTRIENT_KEYS) t[k] += Number(e[k] ?? 0);
    const slot = byMeal[MEALS.includes(e.meal) ? e.meal : 'snack'];
    slot.kcal += Number(e.kcal ?? 0);
    slot.entries.push(e);
  }
  for (const m of MEALS) byMeal[m].entries.sort((a, b) => (a.logged_at ?? '').localeCompare(b.logged_at ?? ''));
  for (const w of raw.water) if (!w.deleted && w.date === date) t.water_ml += Number(w.ml);
  return t;
}

/** Nutrients for `servings` of a per-serving food, rounded for storage. */
export function scale(per: Nutrients, servings: number): Nutrients {
  const out: Nutrients = { kcal: Math.round(per.kcal * servings) };
  for (const k of NUTRIENT_KEYS) {
    if (k === 'kcal') continue;
    const v = per[k];
    if (typeof v === 'number') out[k] = round(v * servings, k === 'sodium_mg' ? 0 : 1);
  }
  return out;
}

/** Per-serving nutrients of an existing entry (for editing the servings later). */
export function perServing(e: Entry): Nutrients {
  const s = e.servings && e.servings > 0 ? e.servings : 1;
  const out: Nutrients = { kcal: (e.kcal ?? 0) / s };
  for (const k of NUTRIENT_KEYS) if (k !== 'kcal' && typeof e[k] === 'number') out[k] = (e[k] as number) / s;
  return out;
}

export function kcalByDay(raw: Raw, from: string, to: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let d = from; d <= to; d = addDays(d, 1)) m.set(d, 0);
  for (const e of raw.entries) if (!e.deleted && m.has(e.date)) m.set(e.date, m.get(e.date)! + Number(e.kcal ?? 0));
  return m;
}

/** Days in [from, to] with at least one entry; the streak counts back from `to`. */
export function loggingStreak(raw: Raw, today: string): number {
  const days = new Set(raw.entries.filter((e) => !e.deleted).map((e) => e.date));
  let n = 0;
  let d = days.has(today) ? today : addDays(today, -1);
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// ------------------------------------------------------------------ foods: search, recents, favorites

/** Something that can be logged: a builtin food, an own food, or a recent entry replayed. */
export interface Loggable extends Nutrients {
  ref: string;
  name: string;
  brand?: string;
  serving_label: string;
  /** builtin: curated with real servings; db: reference database, per 100 g (logged by weight). */
  source: 'builtin' | 'db' | 'own' | 'recent';
  favorite: boolean;
  gentle?: boolean;
}

export const builtinRef = (f: BuiltinFood) => `b:${f.key}`;

export function loggableFromBuiltin(f: BuiltinFood, favorite = false): Loggable {
  return { ref: builtinRef(f), name: f.name, serving_label: f.serving, source: 'builtin', favorite, gentle: f.gentle, ...f.n };
}
export function loggableFromOwn(f: OwnFood): Loggable {
  return {
    ref: f.id,
    name: f.name,
    brand: f.brand,
    serving_label: f.serving_label || '1 serving',
    source: 'own',
    favorite: Boolean(f.favorite),
    kcal: f.kcal ?? 0,
    protein_g: f.protein_g,
    carbs_g: f.carbs_g,
    fat_g: f.fat_g,
    fiber_g: f.fiber_g,
    sugar_g: f.sugar_g,
    sodium_mg: f.sodium_mg,
  };
}

/** Builtin favorites are stored as eatwell_foods rows with `builtin_ref` and no nutrients. */
export function favoriteRefs(raw: Raw): Map<string, OwnFood> {
  const m = new Map<string, OwnFood>();
  for (const f of raw.foods) if (!f.deleted && f.builtin_ref) m.set(f.builtin_ref, f);
  return m;
}

export function catalog(raw: Raw): Loggable[] {
  const favs = favoriteRefs(raw);
  const own = raw.foods.filter((f) => !f.deleted && !f.builtin_ref).map(loggableFromOwn);
  const builtin = BUILTIN_FOODS.map((f) => loggableFromBuiltin(f, Boolean(favs.get(builtinRef(f))?.favorite)));
  const db = dbFoods().map((f): Loggable => ({ ref: f.ref, name: f.name, serving_label: PER_100G, source: 'db', favorite: Boolean(favs.get(f.ref)?.favorite), ...f.n }));
  return [...own, ...builtin, ...db];
}

/** Serving label of database foods: amounts are logged by weight (servings = grams / 100). */
export const PER_100G = '100 g';
export const isByWeight = (f: { serving_label?: string }) => f.serving_label === PER_100G;

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();

/** Crude English singular, enough that "eggs", "potatoes", "berries" find "egg", "potato", "berry". */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(oes|ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
const words = (s: string) => norm(s).split(/\s+/).filter(Boolean).map(stem);

/** Name tokens per food object, computed once (the catalog has thousands of entries). */
const tokenCache = new WeakMap<object, { name: string; words: string[] }>();
const tokensOf = (f: Loggable, key: object) => {
  let t = tokenCache.get(key);
  if (!t) tokenCache.set(key, (t = { name: norm(f.name), words: words(`${f.name} ${f.brand ?? ''}`) }));
  return t;
};

/**
 * Ranked search: every query word (singularised) must prefix a word of the name or brand. Own foods,
 * favorites and curated foods (real serving sizes) rank above the reference database; within a
 * group, names that start with the query and shorter names come first.
 */
export function searchFoods(items: Loggable[], query: string, limit = 50): Loggable[] {
  const q = words(query);
  if (!q.length) return [];
  const phrase = norm(query);
  const scored: { f: Loggable; s: number }[] = [];
  for (const f of items) {
    const t = tokensOf(f, dbKey.get(f.ref) ?? f);
    if (!q.every((qw) => t.words.some((w) => w.startsWith(qw)))) continue;
    let s = 0;
    if (t.name.startsWith(phrase)) s += 10;
    if (t.words[0]?.startsWith(q[0]!)) s += 6;
    if (f.source === 'own') s += 30;
    if (f.favorite) s += 20;
    if (f.source === 'builtin') s += 8;
    s -= t.name.length / 25;
    scored.push({ f, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name)).slice(0, limit).map((x) => x.f);
}
/** Database foods are rebuilt per catalog() call; cache their tokens by the stable ref instead. */
const dbKey = new Map<string, object>(dbFoods().map((f) => [f.ref, f]));

/** Distinct foods from recent entries, newest first, replayable with one tap. */
export function recentFoods(raw: Raw, limit = 20): Loggable[] {
  const seen = new Set<string>();
  const out: Loggable[] = [];
  const entries = raw.entries.filter((e) => !e.deleted).sort((a, b) => (b.logged_at ?? b.date).localeCompare(a.logged_at ?? a.date));
  for (const e of entries) {
    const key = e.food_ref || `n:${norm(e.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const per = perServing(e);
    out.push({ ref: e.food_ref || '', name: e.name, brand: e.brand, serving_label: e.serving_label || '1 serving', source: 'recent', favorite: false, ...per, kcal: Math.round(per.kcal) });
    if (out.length >= limit) break;
  }
  return out;
}

export function favorites(raw: Raw): Loggable[] {
  return catalog(raw).filter((f) => f.favorite).sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ validation of owner input

export interface FoodDraft {
  name: string;
  brand: string;
  serving_label: string;
  kcal: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  fiber_g: string;
  sugar_g: string;
  sodium_mg: string;
}

export function validateFood(d: FoodDraft): { ok: true; food: Omit<OwnFood, 'id'> } | { ok: false; errors: Partial<Record<keyof FoodDraft, string>> } {
  const errors: Partial<Record<keyof FoodDraft, string>> = {};
  const name = d.name.trim();
  if (!name) errors.name = 'Give the food a name.';
  else if (name.length > 120) errors.name = 'Keep the name under 120 characters.';
  const num = (k: keyof FoodDraft, max: number, required = false): number | undefined => {
    const raw = d[k].trim();
    if (!raw) {
      if (required) errors[k] = 'Required.';
      return undefined;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > max) {
      errors[k] = `Enter a number from 0 to ${max.toLocaleString()}.`;
      return undefined;
    }
    return v;
  };
  const food: Omit<OwnFood, 'id'> = {
    name,
    brand: d.brand.trim().slice(0, 80) || undefined,
    serving_label: d.serving_label.trim().slice(0, 60) || '1 serving',
    kcal: Math.round(num('kcal', 20000, true) ?? 0),
    protein_g: num('protein_g', 2000),
    carbs_g: num('carbs_g', 2000),
    fat_g: num('fat_g', 2000),
    fiber_g: num('fiber_g', 1000),
    sugar_g: num('sugar_g', 2000),
    sodium_mg: num('sodium_mg', 100000),
  };
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, food: stripUndefined(food) as Omit<OwnFood, 'id'> };
}

/** Servings typed by the owner: positive, at most 2 decimals, ≤ 100. */
export function parseServings(s: string): number | null {
  const v = Number(s.replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0 || v > 100) return null;
  return round(v, 2);
}

// ------------------------------------------------------------------ trends

export interface Point {
  date: string;
  value: number;
}

export function weightSeries(raw: Raw, from: string, to: string): Point[] {
  const byDay = new Map<string, Weight>();
  for (const w of raw.weights) {
    if (w.deleted || w.date < from || w.date > to) continue;
    const prev = byDay.get(w.date);
    if (!prev || (w.version ?? 0) >= (prev.version ?? 0)) byDay.set(w.date, w);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((w) => ({ date: w.date, value: w.kg }));
}

/** Change between the first and last points of a series (null with fewer than two points). */
export function change(points: Point[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1]!.value - points[0]!.value;
}

export function average(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Estimated date to reach the goal weight at the planned rate, or null if not applicable. */
export function goalEta(currentKg: number | null, goalKg: number | undefined, rateKgWeek: number, today: string): string | null {
  if (!currentKg || !goalKg || rateKgWeek === 0) return null;
  const diff = goalKg - currentKg;
  if (Math.sign(diff) !== Math.sign(rateKgWeek) || Math.abs(diff) < 0.1) return null;
  return addDays(today, Math.ceil((diff / rateKgWeek) * 7));
}

// ------------------------------------------------------------------ ids

/** PocketBase-format id generated on the device (spec §Data layer: retries never duplicate). */
export function newId(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(rand(15), (b) => abc[b % abc.length]).join('');
}
