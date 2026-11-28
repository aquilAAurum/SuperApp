import { describe, expect, it } from 'vitest';
import { BUILTIN_FOODS } from './foods.ts';
import {
  addDays,
  bmr,
  budgetFor,
  catalog,
  dayBounds,
  dayTotals,
  emptyRaw,
  fmtWater,
  fmtWeight,
  goalEta,
  heightParts,
  kcalByDay,
  loggingStreak,
  mealForHour,
  newId,
  parseServings,
  recentFoods,
  scale,
  searchFoods,
  settingsOf,
  validateFood,
  weightOn,
  weightSeries,
  weightToKg,
  type Raw,
} from './model.ts';

const raw = (patch: Partial<Raw> = {}): Raw => ({ ...emptyRaw(), ...patch });

describe('dates', () => {
  it('adds calendar days across month ends and DST', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    const b = dayBounds('2026-03-08');
    expect(b.end.getDate()).toBe(9);
    expect(b.end.getHours()).toBe(0);
  });
  it('picks a meal from the hour', () => {
    expect([7, 12, 16, 19, 23].map(mealForHour)).toEqual(['breakfast', 'lunch', 'snack', 'dinner', 'snack']);
  });
});

describe('budget', () => {
  const base = { id: 's', sex: 'male' as const, birth_year: 1990, height_cm: 178, activity: 'moderate' as const, rate_kg_week: -0.5, exercise_adds: false };

  it('uses Mifflin-St Jeor with activity and the weekly goal', () => {
    expect(bmr(85, 178, 36, 'male')).toBe(1787.5);
    const b = budgetFor(settingsOf(raw({ settings: [base] })), 85, 2026, null);
    // 1787.5 * 1.55 - 550 = 2220.6
    expect(b).toMatchObject({ basis: 'computed', base: 2221, exercise: 0, total: 2221, adjustment: -550, floored: false });
    expect(b.macros).toEqual({ protein_g: 167, carbs_g: 222, fat_g: 74 });
  });

  it('adds Health Connect active calories on a sedentary base, never both', () => {
    const b = budgetFor(settingsOf(raw({ settings: [{ ...base, exercise_adds: true }] })), 85, 2026, 412.6);
    expect(b.base).toBe(1595); // 1787.5 * 1.2 - 550
    expect(b.exercise).toBe(413);
    expect(b.total).toBe(b.base + 413);
    // Not connected: falls back to the activity factor.
    expect(budgetFor(settingsOf(raw({ settings: [{ ...base, exercise_adds: true }] })), 85, 2026, null).base).toBe(2221);
  });

  it('never goes below the safety floor and says so', () => {
    const b = budgetFor(settingsOf(raw({ settings: [{ ...base, sex: 'female', height_cm: 150, birth_year: 1950, activity: 'sedentary', rate_kg_week: -1 }] })), 50, 2026, null);
    expect(b).toMatchObject({ base: 1200, floored: true });
  });

  it('honours an override and defaults without a profile', () => {
    expect(budgetFor(settingsOf(raw({ settings: [{ ...base, budget_override: 1800 }] })), 85, 2026, null)).toMatchObject({ base: 1800, basis: 'override' });
    expect(budgetFor(settingsOf(raw()), null, 2026, null)).toMatchObject({ base: 2000, basis: 'default' });
  });
});

describe('diary', () => {
  const r = raw({
    entries: [
      { id: 'a', date: '2026-11-28', meal: 'breakfast', name: 'Oats', kcal: 166, protein_g: 5.9, logged_at: '2026-11-28T08:00' },
      { id: 'b', date: '2026-11-28', meal: 'dinner', name: 'Salmon', kcal: 233, protein_g: 25, logged_at: '2026-11-28T19:00' },
      { id: 'c', date: '2026-11-28', meal: 'dinner', name: 'Gone', kcal: 999, deleted: true },
      { id: 'd', date: '2026-11-27', meal: 'lunch', name: 'Pizza', kcal: 285 },
      { id: 'e', date: '2026-11-25', meal: 'lunch', name: 'Pizza', kcal: 285 },
    ],
    water: [
      { id: 'w', date: '2026-11-28', ml: 250 },
      { id: 'x', date: '2026-11-28', ml: 500 },
    ],
  });

  it('totals a day by meal, ignoring deleted entries', () => {
    const t = dayTotals(r, '2026-11-28');
    expect(t.kcal).toBe(399);
    expect(t.protein_g).toBeCloseTo(30.9);
    expect(t.byMeal.dinner.entries.map((e) => e.id)).toEqual(['b']);
    expect(t.byMeal.lunch.kcal).toBe(0);
    expect(t.water_ml).toBe(750);
  });

  it('scales per-serving nutrients', () => {
    expect(scale({ kcal: 105, protein_g: 1.3, sodium_mg: 1.4 }, 1.5)).toEqual({ kcal: 158, protein_g: 2, sodium_mg: 2 });
    expect(parseServings('1,5')).toBe(1.5);
    expect(parseServings('0')).toBeNull();
    expect(parseServings('abc')).toBeNull();
  });

  it('counts calories per day and the logging streak', () => {
    expect([...kcalByDay(r, '2026-11-26', '2026-11-28').values()]).toEqual([0, 285, 399]);
    expect(loggingStreak(r, '2026-11-28')).toBe(2);
    expect(loggingStreak(r, '2026-11-29')).toBe(2); // today not logged yet still counts yesterday's streak
  });

  it('replays recent foods once each, newest first', () => {
    const rec = recentFoods(r);
    expect(rec.map((f) => f.name)).toEqual(['Salmon', 'Oats', 'Pizza']);
  });
});

describe('foods', () => {
  it('builtin keys are unique and values sane', () => {
    const keys = BUILTIN_FOODS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of BUILTIN_FOODS) {
      expect(f.n.kcal).toBeGreaterThanOrEqual(0);
      // Atwater check: calories roughly match macros (alcohol and rounding aside).
      const est = 4 * (f.n.protein_g ?? 0) + 4 * (f.n.carbs_g ?? 0) + 9 * (f.n.fat_g ?? 0);
      if (!['beer', 'wine'].includes(f.key) && f.n.kcal > 40) expect(Math.abs(est - f.n.kcal) / f.n.kcal).toBeLessThan(0.25);
    }
  });

  it('searches by word prefixes, own foods and favorites first', () => {
    const r = raw({ foods: [{ id: 'own1', name: 'Grandma oatmeal', kcal: 200 }, { id: 'fav', name: '', builtin_ref: 'b:banana', favorite: true }] });
    const items = catalog(r);
    expect(searchFoods(items, 'oat').map((f) => f.name).slice(0, 2)).toEqual(['Grandma oatmeal', 'Oatmeal, cooked with water']);
    expect(searchFoods(items, 'chick bre')[0]!.name).toBe('Chicken breast, roasted, skinless');
    expect(searchFoods(items, 'ban')[0]).toMatchObject({ name: 'Banana', favorite: true });
    expect(searchFoods(items, '')).toEqual([]);
  });

  it('validates an own food', () => {
    const ok = validateFood({ name: ' Protein pancakes ', brand: '', serving_label: '', kcal: '310', protein_g: '24', carbs_g: '', fat_g: '8', fiber_g: '', sugar_g: '', sodium_mg: '' });
    expect(ok).toEqual({ ok: true, food: { name: 'Protein pancakes', serving_label: '1 serving', kcal: 310, protein_g: 24, fat_g: 8 } });
    const bad = validateFood({ name: '', brand: '', serving_label: '', kcal: '-3', protein_g: 'x', carbs_g: '', fat_g: '', fiber_g: '', sugar_g: '', sodium_mg: '' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['kcal', 'name', 'protein_g']);
  });
});

describe('weight and units', () => {
  const r = raw({
    weights: [
      { id: '1', date: '2026-11-01', kg: 90 },
      { id: '2', date: '2026-11-15', kg: 88.5 },
      { id: '3', date: '2026-11-15', kg: 88.2, version: 2 },
      { id: '4', date: '2026-11-27', kg: 87.4 },
    ],
  });
  it('finds the latest weight and a one-per-day series', () => {
    expect(weightOn(r.weights, '2026-11-20')?.kg).toBe(88.5);
    expect(weightSeries(r, '2026-11-01', '2026-11-30').map((p) => p.value)).toEqual([90, 88.2, 87.4]);
  });
  it('formats and converts', () => {
    expect(fmtWeight(80, 'imperial')).toBe('176.4 lb');
    expect(fmtWeight(80, 'metric')).toBe('80 kg');
    expect(weightToKg(176.4, 'imperial')).toBeCloseTo(80.01, 1);
    expect(fmtWater(750, 'metric')).toBe('750 ml');
    expect(fmtWater(2000, 'metric')).toBe('2 L');
    expect(fmtWater(473, 'imperial')).toBe('16 fl oz');
    expect(heightParts(178)).toEqual({ ft: 5, inch: 10 });
  });
  it('estimates the goal date only when moving toward it', () => {
    expect(goalEta(85, 80, -0.5, '2026-11-28')).toBe('2027-02-06'); // 10 weeks
    expect(goalEta(85, 90, -0.5, '2026-11-28')).toBeNull();
  });
  it('generates PocketBase-format ids', () => {
    expect(newId()).toMatch(/^[a-z0-9]{15}$/);
  });
});
