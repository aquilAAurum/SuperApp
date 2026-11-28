// EatWell (SA-2026-008): a calm food diary. Today (budget ring, macros, activity tiles, meals),
// add food (search, recents, favorites, own foods, quick add), Trends (weight, calories, steps),
// Foods (own foods and favorites) and Goals. No ads, no coaching, no streak nagging.
// Data: eatwell_* through @superapp/sdk (works offline from the shell's mirror). Activity: Health
// Connect through the shell's device.health.* bridge (ADR-010). DOM via createElement/textContent only.
import { connect, BridgeError } from '@superapp/sdk';
import { bars, line, ring } from './charts.ts';
import { watchAll } from './data.ts';
import { BUILTIN_BY_REF } from './foods.ts';
import { FOODDB_ATTRIBUTION } from './fooddb.ts';
import { Health, type DayActivity } from './health.ts';
import {
  ACTIVITY_LABEL,
  COLLECTIONS,
  MEALS,
  MEAL_LABEL,
  addDays,
  average,
  budgetFor,
  catalog,
  change,
  dayLabel,
  dayTotals,
  emptyRaw,
  favoriteRefs,
  favorites,
  fmtNum,
  isByWeight,
  fmtWater,
  fmtWeight,
  goalEta,
  heightParts,
  kcalByDay,
  localToday,
  mealForHour,
  newId,
  parseServings,
  parseYmd,
  perServing,
  recentFoods,
  round,
  scale,
  searchFoods,
  settingsOf,
  validateFood,
  waterStep,
  weightFromKg,
  weightOn,
  weightSeries,
  weightToKg,
  type Activity,
  type Entry,
  type FoodDraft,
  type Loggable,
  type Meal,
  type OwnFood,
  type Raw,
  type Settings,
  type Weight,
} from './model.ts';

const sa = connect({ appId: 'eatwell' });
const health = new Health(sa);

// ------------------------------------------------------------------ tiny DOM helper

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> | null = null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k in el && !k.startsWith('aria-') && !k.startsWith('data-')) (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const btn = (text: string, onclick: () => void, cls = '', extra: Record<string, unknown> = {}) => h('button', { type: 'button', class: cls, onclick, ...extra }, text);

function toast(text: string, kind: 'ok' | 'error' = 'ok'): void {
  const t = $('toast');
  t.textContent = text;
  t.dataset.kind = kind;
  t.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 3500);
}
let toastTimer = 0;

function errorText(err: unknown): string {
  if (err instanceof BridgeError) return err.code === 'OFFLINE_QUEUED' ? 'Saved offline; it will sync when you are back online.' : err.message;
  return (err as Error).message ?? String(err);
}

// ------------------------------------------------------------------ state

type Tab = 'today' | 'trends' | 'foods' | 'goals';
type Sheet =
  | { kind: 'add'; meal: Meal; list: 'recent' | 'favorites' | 'mine'; query: string }
  /** `servings` is a serving count, or for by-weight foods (per 100 g) an amount in `unit`. */
  | { kind: 'serving'; food: Loggable; meal: Meal; servings: string; unit?: 'g' | 'oz'; entry?: Entry }
  | { kind: 'quick'; meal: Meal }
  | { kind: 'food'; food?: OwnFood; draft: FoodDraft; errors: Partial<Record<keyof FoodDraft, string>>; thenLog?: Meal }
  | { kind: 'weight' };

let raw: Raw = emptyRaw();
let tab: Tab = 'today';
let date = localToday();
let sheets: Sheet[] = [];
let activity: DayActivity | null = null;
let activityFor = '';
let trendRange: 7 | 30 | 90 = 30;
let trendSteps = new Map<string, number>();
let trendStepsKey = '';
let loaded = false;
/** The owner is typing in the Goals form; data changes must not rebuild it under them. */
let goalsDirty = false;

const settings = () => settingsOf(raw);
const units = () => settings().units;
const sheet = () => sheets[sheets.length - 1];
function openSheet(s: Sheet): void {
  sheets.push(s);
  render();
}
function closeSheet(all = false): void {
  if (all) sheets = [];
  else sheets.pop();
  render();
}

// ------------------------------------------------------------------ writes

async function save<T extends Record<string, unknown>>(collection: string, data: T, existing?: { id: string; version?: number }): Promise<string> {
  if (existing) {
    await sa.data.update(collection, existing.id, data, existing.version);
    return existing.id;
  }
  const id = newId();
  await sa.data.create(collection, data, id);
  return id;
}

async function addEntry(food: Loggable, meal: Meal, servings: number, editing?: Entry): Promise<void> {
  const n = scale(food, servings);
  const now = new Date();
  const data = {
    date,
    meal,
    name: food.name,
    brand: food.brand ?? '',
    servings,
    serving_label: food.serving_label,
    food_ref: food.ref,
    logged_at: editing?.logged_at ?? (date === localToday() ? now.toISOString() : ''),
    ...n,
  };
  const id = await save(COLLECTIONS.entries, data, editing);
  if (settings().hc_write) void health.writeEntries([{ id, ...data } as Entry]);
  void sa.device.haptics('light').catch(() => undefined);
}

async function deleteEntry(e: Entry): Promise<void> {
  await sa.data.delete(COLLECTIONS.entries, e.id);
  void health.deleteEntry(e.id);
}

async function toggleFavorite(f: Loggable): Promise<void> {
  if (f.source === 'own') {
    const own = raw.foods.find((x) => x.id === f.ref);
    if (own) await save(COLLECTIONS.foods, { favorite: !own.favorite }, own);
  } else if (f.ref.startsWith('b:') || f.ref.startsWith('u:')) {
    const row = favoriteRefs(raw).get(f.ref);
    if (row) await save(COLLECTIONS.foods, { favorite: !row.favorite }, row);
    else await save(COLLECTIONS.foods, { name: f.name, builtin_ref: f.ref, favorite: true });
  }
}

async function addWater(): Promise<void> {
  const ml = waterStep(units());
  const data = { date, ml, logged_at: new Date().toISOString() };
  const id = await save(COLLECTIONS.water, data);
  if (settings().hc_write) void health.writeWater({ id, ...data });
  void sa.device.haptics('light').catch(() => undefined);
}

async function undoWater(): Promise<void> {
  const last = raw.water.filter((w) => !w.deleted && w.date === date).sort((a, b) => (b.logged_at ?? '').localeCompare(a.logged_at ?? ''))[0];
  if (!last) return;
  await sa.data.delete(COLLECTIONS.water, last.id);
  void health.deleteWater(last.id);
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = raw.settings.filter((s) => !s.deleted).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
  await save(COLLECTIONS.settings, patch as Record<string, unknown>, current);
}

function run(p: Promise<unknown>, ok?: string): void {
  p.then(() => ok && toast(ok)).catch((err) => toast(errorText(err), 'error'));
}

// ------------------------------------------------------------------ Today

function header(): HTMLElement {
  const today = localToday();
  return h(
    'div',
    { class: 'daybar' },
    btn('‹', () => setDate(addDays(date, -1)), 'icon', { 'aria-label': 'Previous day' }),
    h('h1', { class: 'daylabel', 'data-testid': 'day-label' }, dayLabel(date, today)),
    btn('›', () => setDate(addDays(date, 1)), 'icon', { 'aria-label': 'Next day', disabled: date >= addDays(today, 7) }),
  );
}

function setDate(d: string): void {
  date = d;
  render();
  void loadActivity();
}

async function loadActivity(): Promise<void> {
  const want = date;
  if (health.state.kind !== 'connected') {
    activity = null;
    activityFor = want;
    return;
  }
  const a = await health.day(want);
  if (date !== want) return;
  activity = a;
  activityFor = want;
  if (!sheet()) render();
}

function todayView(): HTMLElement {
  const s = settings();
  const t = dayTotals(raw, date);
  const kg = weightOn(raw.weights, date)?.kg ?? null;
  const active = activityFor === date && typeof activity?.activeCalories === 'number' ? activity.activeCalories : null;
  const b = budgetFor(s, kg, parseYmd(date).getFullYear(), active);
  const left = b.total - Math.round(t.kcal);
  const over = left < 0;

  const formula = h(
    'p',
    { class: 'formula', 'data-testid': 'formula' },
    h('span', null, h('b', null, fmtNum(b.base)), ' budget'),
    ' − ',
    h('span', null, h('b', null, fmtNum(t.kcal)), ' food'),
    s.exercise_adds && active !== null ? h('span', null, ' + ', h('b', null, fmtNum(b.exercise)), ' exercise') : null,
  );

  const calories = h(
    'section',
    { class: 'card hero', 'aria-labelledby': 'cal-h' },
    h('h2', { id: 'cal-h', class: 'sr-only' }, 'Calories'),
    h(
      'div',
      { class: 'ring-wrap' },
      ring(t.kcal, b.total, `${fmtNum(t.kcal)} of ${fmtNum(b.total)} calories eaten`),
      h('div', { class: 'ring-center' }, h('span', { class: `big${over ? ' over' : ''}`, 'data-testid': 'kcal-left' }, fmtNum(Math.abs(left))), h('span', { class: 'muted' }, over ? 'over' : 'left')),
    ),
    formula,
    b.basis === 'default' ? h('p', { class: 'hint' }, 'Using a 2,000 calorie budget. ', btn('Set your goal', () => switchTab('goals'), 'link')) : null,
  );

  const macro = (label: string, got: number, goal: number, cls: string) =>
    h(
      'div',
      { class: 'macro' },
      h('div', { class: 'macro-top' }, h('span', null, label), h('span', { class: 'muted' }, `${fmtNum(got)} / ${fmtNum(goal)} g`)),
      h('div', { class: `meter ${cls}`, role: 'meter', 'aria-label': `${label} ${fmtNum(got)} of ${fmtNum(goal)} grams`, 'aria-valuemin': 0, 'aria-valuemax': goal, 'aria-valuenow': Math.round(got) }, h('span', { style: `width:${Math.min(100, goal ? (got / goal) * 100 : 0)}%` })),
    );
  const macros = h(
    'section',
    { class: 'card', 'aria-labelledby': 'mac-h' },
    h('h2', { id: 'mac-h', class: 'sr-only' }, 'Macros'),
    h('div', { class: 'macros' }, macro('Protein', t.protein_g, b.macros.protein_g, 'm-protein'), macro('Carbs', t.carbs_g, b.macros.carbs_g, 'm-carbs'), macro('Fat', t.fat_g, b.macros.fat_g, 'm-fat')),
  );

  return h('div', { class: 'view' }, header(), calories, macros, tilesView(t.water_ml), ...MEALS.map((m) => mealCard(m, t.byMeal[m].kcal, t.byMeal[m].entries)));
}

function tile(label: string, value: string, sub: string, testid: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'tile', 'data-testid': testid }, h('span', { class: 'tile-label' }, label), h('span', { class: 'tile-value' }, value), h('span', { class: 'muted tile-sub' }, sub), action ?? null);
}

function tilesView(waterMl: number): HTMLElement {
  const s = settings();
  const u = units();
  const a = activityFor === date ? activity : null;
  const latest = weightOn(raw.weights, date);
  const tiles: HTMLElement[] = [];
  const hc = health.state;
  if (hc.kind === 'connected') {
    if (health.canRead('steps')) tiles.push(tile('Steps', a?.steps !== undefined ? fmtNum(a.steps) : '—', a?.distance ? `${round(a.distance / (u === 'metric' ? 1000 : 1609.34), 1)} ${u === 'metric' ? 'km' : 'mi'}` : 'Health Connect', 'tile-steps'));
    if (health.canRead('activeCalories')) tiles.push(tile('Active', a?.activeCalories !== undefined ? fmtNum(a.activeCalories) : '—', 'calories burned', 'tile-active'));
    if (health.canRead('exerciseMinutes')) tiles.push(tile('Exercise', a?.exerciseMinutes !== undefined ? `${fmtNum(a.exerciseMinutes)}` : '—', 'minutes', 'tile-exercise'));
    if (health.canRead('sleepMinutes')) tiles.push(tile('Sleep', a?.sleepMinutes ? `${Math.floor(a.sleepMinutes / 60)}h ${Math.round(a.sleepMinutes % 60)}m` : '—', 'last night', 'tile-sleep'));
  }
  tiles.push(
    tile(
      'Water',
      fmtWater(waterMl, u),
      `of ${fmtWater(s.water_goal_ml, u)}`,
      'tile-water',
      h('div', { class: 'tile-actions' }, btn('−', () => run(undoWater()), 'mini', { 'aria-label': 'Remove last water', disabled: waterMl === 0 }), btn('+', () => run(addWater()), 'mini primary', { 'aria-label': `Add ${fmtWater(waterStep(u), u)} of water` })),
    ),
  );
  tiles.push(tile('Weight', latest ? fmtWeight(latest.kg, u) : '—', latest ? (latest.date === date ? 'today' : `on ${dayLabel(latest.date, localToday())}`) : 'not logged', 'tile-weight', btn('+', () => openSheet({ kind: 'weight' }), 'mini primary', { 'aria-label': 'Log weight' })));

  const parts: HTMLElement[] = [h('div', { class: 'tiles' }, ...tiles)];
  if (hc.kind === 'not_connected') {
    parts.unshift(
      h(
        'div',
        { class: 'connect', 'data-testid': 'hc-connect' },
        h('div', null, h('strong', null, 'Connect Health Connect'), h('p', { class: 'muted' }, 'See steps, exercise and sleep here, and count exercise in your budget.')),
        btn('Connect', () => run(connectHealth()), 'primary'),
      ),
    );
  } else if (hc.kind === 'unavailable') {
    parts.push(h('p', { class: 'muted small', 'data-testid': 'hc-unavailable' }, hc.reason));
  }
  return h('section', { class: 'card', 'aria-label': 'Activity, water and weight' }, ...parts);
}

async function connectHealth(): Promise<void> {
  const st = await health.connect(settings().hc_write);
  if (st.kind === 'connected') {
    toast('Health Connect connected.');
    await loadActivity();
  } else if (st.kind === 'unavailable') toast(st.reason, 'error');
  else toast('Nothing was shared. You can connect any time.', 'error');
  render();
}

function mealCard(meal: Meal, kcal: number, entries: Entry[]): HTMLElement {
  const list = h(
    'ul',
    { class: 'entries' },
    ...entries.map((e) =>
      h(
        'li',
        null,
        h(
          'button',
          { type: 'button', class: 'entry', 'data-testid': 'entry', onclick: () => editEntry(e) },
          h('span', { class: 'entry-main' }, h('span', { class: 'entry-name' }, e.name), h('span', { class: 'muted small' }, [e.brand, isByWeight(e) ? fmtAmount((e.servings ?? 1) * 100) : e.servings && e.servings !== 1 ? `${e.servings} × ${e.serving_label ?? 'serving'}` : e.serving_label].filter(Boolean).join(' · '))),
          h('span', { class: 'entry-kcal' }, fmtNum(e.kcal ?? 0)),
        ),
      ),
    ),
  );
  return h(
    'section',
    { class: 'card meal', 'aria-labelledby': `meal-${meal}`, 'data-meal': meal },
    h('div', { class: 'meal-head' }, h('h2', { id: `meal-${meal}` }, MEAL_LABEL[meal]), h('span', { class: 'muted' }, kcal ? `${fmtNum(kcal)} cal` : ''), btn('Add', () => openSheet({ kind: 'add', meal, list: 'recent', query: '' }), 'add', { 'aria-label': `Add food to ${MEAL_LABEL[meal]}` })),
    entries.length ? list : null,
  );
}

function editEntry(e: Entry): void {
  const per = perServing(e);
  const builtin = e.food_ref ? BUILTIN_BY_REF.get(e.food_ref) : undefined;
  const food: Loggable = { ref: e.food_ref ?? '', name: e.name, brand: e.brand, serving_label: e.serving_label || builtin?.serving || '1 serving', source: 'recent', favorite: false, ...per };
  if (isByWeight(food)) openSheet({ kind: 'serving', food, meal: e.meal, servings: String(round((e.servings ?? 1) * 100)), unit: 'g', entry: e });
  else openSheet({ kind: 'serving', food, meal: e.meal, servings: String(e.servings ?? 1), entry: e });
}

// ------------------------------------------------------------------ Add food sheet

function sheetHeader(title: string, extra?: HTMLElement): HTMLElement {
  return h('div', { class: 'sheet-head' }, btn('←', () => closeSheet(), 'icon', { 'aria-label': 'Back' }), h('h1', { id: 'sheet-title' }, title), extra ?? null);
}

function mealSelect(value: Meal, onchange: (m: Meal) => void, id: string): HTMLElement {
  return h('select', { id, onchange: (ev: Event) => onchange((ev.currentTarget as HTMLSelectElement).value as Meal) }, ...MEALS.map((m) => h('option', { value: m, selected: m === value }, MEAL_LABEL[m])));
}

function foodRow(f: Loggable, onPick: () => void): HTMLElement {
  const gentle = settings().gentle_mode && f.gentle;
  return h(
    'li',
    { class: 'food' },
    h(
      'button',
      { type: 'button', class: 'food-pick', 'data-testid': 'food-result', onclick: onPick },
      h('span', { class: 'entry-main' }, h('span', { class: 'entry-name' }, f.name), h('span', { class: 'muted small' }, [f.brand, isByWeight(f) ? 'per 100 g' : f.serving_label].filter(Boolean).join(' · '))),
      gentle ? h('span', { class: 'chip', title: 'Gentle choice' }, 'Gentle') : null,
      h('span', { class: 'entry-kcal' }, fmtNum(f.kcal)),
    ),
    f.source !== 'recent'
      ? btn(f.favorite ? '★' : '☆', () => run(toggleFavorite(f), f.favorite ? 'Removed from favorites' : 'Added to favorites'), 'icon star', { 'aria-label': `${f.favorite ? 'Remove' : 'Add'} ${f.name} ${f.favorite ? 'from' : 'to'} favorites`, 'aria-pressed': String(f.favorite) })
      : null,
  );
}

function addSheet(s: Extract<Sheet, { kind: 'add' }>): HTMLElement {
  const results = h('ul', { class: 'foods', 'data-testid': 'food-results', 'aria-live': 'polite' });
  const fill = () => {
    let items: Loggable[];
    let empty: string;
    if (s.query.trim()) {
      const found = searchFoods(catalog(raw), s.query);
      items = settings().gentle_mode ? [...found.filter((f) => f.gentle), ...found.filter((f) => !f.gentle)] : found;
      empty = `Nothing matches "${s.query.trim()}". Try a simpler word (e.g. "yogurt"), create it as your own food, or quick add calories.`;
    } else if (s.list === 'recent') {
      items = recentFoods(raw);
      empty = 'Foods you log show up here.';
    } else if (s.list === 'favorites') {
      items = favorites(raw);
      empty = 'Tap ☆ on a food to keep it here.';
    } else {
      items = catalog(raw).filter((f) => f.source === 'own');
      empty = 'Foods you create show up here.';
    }
    results.replaceChildren(...(items.length ? items.map((f) => foodRow(f, () => openServing(f, s.meal))) : [h('li', { class: 'empty muted', 'data-testid': 'food-empty' }, empty)]));
  };
  const input = h('input', {
    id: 'food-search',
    type: 'search',
    placeholder: 'Search foods',
    autocomplete: 'off',
    value: s.query,
    'aria-label': 'Search foods',
    oninput: (ev: Event) => {
      s.query = (ev.currentTarget as HTMLInputElement).value;
      lists.hidden = Boolean(s.query.trim());
      fill();
    },
  });
  const chip = (k: typeof s.list, label: string) => btn(label, () => ((s.list = k), render()), `seg${s.list === k ? ' on' : ''}`, { 'aria-pressed': String(s.list === k) });
  const lists = h('div', { class: 'segs', role: 'group', 'aria-label': 'Lists' }, chip('recent', 'Recent'), chip('favorites', 'Favorites'), chip('mine', 'My foods'));
  lists.hidden = Boolean(s.query.trim());
  fill();
  return h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    sheetHeader(`Add to ${MEAL_LABEL[s.meal]}`),
    h('div', { class: 'row' }, h('label', { for: 'add-meal' }, 'Meal'), mealSelect(s.meal, (m) => ((s.meal = m), render()), 'add-meal')),
    input,
    lists,
    results,
    h('div', { class: 'row gap' }, btn('Quick add calories', () => openSheet({ kind: 'quick', meal: s.meal }), 'ghost'), btn('Create a food', () => openSheet({ kind: 'food', draft: blankDraft(s.query), errors: {}, thenLog: s.meal }), 'ghost')),
  );
}

function openServing(food: Loggable, meal: Meal): void {
  if (isByWeight(food)) {
    const oz = units() === 'imperial';
    openSheet({ kind: 'serving', food, meal, servings: oz ? '4' : '100', unit: oz ? 'oz' : 'g' });
  } else openSheet({ kind: 'serving', food, meal, servings: '1' });
}

const G_PER_OZ = 28.3495;
const fmtAmount = (grams: number) => (units() === 'imperial' ? `${round(grams / G_PER_OZ, 1)} oz (${Math.round(grams)} g)` : `${Math.round(grams)} g`);

/** Serving count to store: plain servings, or grams / 100 for by-weight foods. */
function servingsOf(s: Extract<Sheet, { kind: 'serving' }>): number | null {
  if (!isByWeight(s.food)) return parseServings(s.servings);
  const v = Number(s.servings.replace(',', '.'));
  const grams = s.unit === 'oz' ? v * G_PER_OZ : v;
  if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) return null;
  return round(grams / 100, 3);
}

function servingSheet(s: Extract<Sheet, { kind: 'serving' }>): HTMLElement {
  const byWeight = isByWeight(s.food);
  const totals = h('p', { class: 'totals', 'data-testid': 'serving-totals', 'aria-live': 'polite' });
  const err = h('p', { class: 'error', role: 'alert' });
  const showTotals = () => {
    const n = servingsOf(s);
    if (n === null) {
      totals.textContent = '';
      err.textContent = byWeight ? 'Enter an amount up to 5 kg (176 oz).' : 'Enter servings between 0.01 and 100.';
      return;
    }
    err.textContent = '';
    const x = scale(s.food, n);
    totals.replaceChildren(h('b', null, `${fmtNum(x.kcal)} cal`), ` · Protein ${round(x.protein_g ?? 0, 1)} g · Carbs ${round(x.carbs_g ?? 0, 1)} g · Fat ${round(x.fat_g ?? 0, 1)} g`);
  };
  const step = byWeight ? (s.unit === 'oz' ? 1 : 25) : 0.25;
  const input = h('input', {
    id: 'servings',
    type: 'number',
    inputMode: 'decimal',
    min: String(step),
    step: 'any',
    value: s.servings,
    oninput: (ev: Event) => {
      s.servings = (ev.currentTarget as HTMLInputElement).value;
      showTotals();
    },
  });
  const bump = (d: number) => {
    const v = Math.max(step, round((Number(s.servings.replace(',', '.')) || 0) + d, 2));
    s.servings = String(v);
    input.value = s.servings;
    showTotals();
  };
  showTotals();
  const submit = () => {
    const n = servingsOf(s);
    if (n === null) return showTotals();
    run(
      addEntry(s.food, s.meal, n, s.entry).then(() => closeSheet(true)),
      s.entry ? 'Saved' : `Added to ${MEAL_LABEL[s.meal]}`,
    );
  };
  const unitSelect = byWeight
    ? h(
        'select',
        {
          id: 'serving-unit',
          'aria-label': 'Unit',
          class: 'unit',
          onchange: (ev: Event) => {
            const next = (ev.currentTarget as HTMLSelectElement).value as 'g' | 'oz';
            const v = Number(s.servings.replace(',', '.')) || 0;
            s.servings = String(next === s.unit ? v : next === 'oz' ? round(v / G_PER_OZ, 1) : Math.round(v * G_PER_OZ));
            s.unit = next;
            render();
          },
        },
        h('option', { value: 'g', selected: s.unit !== 'oz' }, 'g'),
        h('option', { value: 'oz', selected: s.unit === 'oz' }, 'oz'),
      )
    : null;
  return h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    sheetHeader(s.entry ? 'Edit entry' : s.food.name),
    h('p', { class: 'muted' }, byWeight ? `${fmtNum(s.food.kcal)} cal per 100 g` : [s.food.brand, `Serving: ${s.food.serving_label}`].filter(Boolean).join(' · ')),
    h(
      'div',
      { class: 'row' },
      h('label', { for: 'servings' }, byWeight ? 'Amount' : 'Servings'),
      h('div', { class: 'stepper' }, btn('−', () => bump(-step), 'icon', { 'aria-label': byWeight ? 'Less' : 'Fewer servings' }), input, unitSelect, btn('+', () => bump(step), 'icon', { 'aria-label': byWeight ? 'More' : 'More servings' })),
    ),
    h('div', { class: 'row' }, h('label', { for: 'serving-meal' }, 'Meal'), mealSelect(s.meal, (m) => (s.meal = m), 'serving-meal')),
    h('p', { class: 'muted small' }, dayLabel(s.entry?.date ?? date, localToday())),
    totals,
    err,
    btn(s.entry ? 'Save' : 'Add to diary', submit, 'primary wide', { 'data-testid': 'serving-submit' }),
    s.entry ? btn('Delete entry', () => run(deleteEntry(s.entry!).then(() => closeSheet(true)), 'Entry deleted'), 'danger wide') : null,
  );
}

function quickSheet(s: Extract<Sheet, { kind: 'quick' }>): HTMLElement {
  const name = h('input', { id: 'quick-name', placeholder: 'Quick add', maxLength: 120 });
  const kcal = h('input', { id: 'quick-kcal', type: 'number', inputMode: 'numeric', min: '1', max: '10000' });
  const err = h('p', { class: 'error', role: 'alert' });
  const submit = () => {
    const v = Number(kcal.value);
    if (!Number.isFinite(v) || v <= 0 || v > 10000) {
      err.textContent = 'Enter calories between 1 and 10,000.';
      kcal.focus();
      return;
    }
    const food: Loggable = { ref: '', name: name.value.trim() || 'Quick add', serving_label: '', source: 'recent', favorite: false, kcal: Math.round(v) };
    run(addEntry(food, s.meal, 1).then(() => closeSheet(true)), `Added to ${MEAL_LABEL[s.meal]}`);
  };
  return h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    sheetHeader('Quick add calories'),
    h('div', { class: 'row' }, h('label', { for: 'quick-meal' }, 'Meal'), mealSelect(s.meal, (m) => (s.meal = m), 'quick-meal')),
    h('label', { for: 'quick-kcal' }, 'Calories'),
    kcal,
    h('label', { for: 'quick-name' }, 'Description (optional)'),
    name,
    err,
    btn('Add to diary', submit, 'primary wide'),
  );
}

// ------------------------------------------------------------------ Own food form

const blankDraft = (name = ''): FoodDraft => ({ name, brand: '', serving_label: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '', fiber_g: '', sugar_g: '', sodium_mg: '' });
const draftOf = (f: OwnFood): FoodDraft => {
  const s = (v: number | undefined) => (typeof v === 'number' ? String(v) : '');
  return { name: f.name, brand: f.brand ?? '', serving_label: f.serving_label ?? '', kcal: s(f.kcal), protein_g: s(f.protein_g), carbs_g: s(f.carbs_g), fat_g: s(f.fat_g), fiber_g: s(f.fiber_g), sugar_g: s(f.sugar_g), sodium_mg: s(f.sodium_mg) };
};

function foodSheet(s: Extract<Sheet, { kind: 'food' }>): HTMLElement {
  const field = (k: keyof FoodDraft, label: string, opts: Record<string, unknown> = {}) => {
    const id = `food-${k}`;
    const errId = `${id}-err`;
    return h(
      'div',
      { class: 'field' },
      h('label', { for: id }, label),
      h('input', { id, value: s.draft[k], 'aria-invalid': s.errors[k] ? 'true' : undefined, 'aria-describedby': s.errors[k] ? errId : undefined, oninput: (ev: Event) => (s.draft[k] = (ev.currentTarget as HTMLInputElement).value), ...opts }),
      s.errors[k] ? h('span', { class: 'error', id: errId }, s.errors[k]!) : null,
    );
  };
  const num = { type: 'number', inputMode: 'decimal', min: '0', step: 'any' };
  const submit = () => {
    const v = validateFood(s.draft);
    if (!v.ok) {
      s.errors = v.errors;
      render();
      return;
    }
    run(
      (async () => {
        const id = await save(COLLECTIONS.foods, v.food as unknown as Record<string, unknown>, s.food);
        sheets.pop();
        if (s.thenLog) sheets.push({ kind: 'serving', food: { ...v.food, ref: id, source: 'own', favorite: false, serving_label: v.food.serving_label ?? '1 serving', kcal: v.food.kcal ?? 0 }, meal: s.thenLog, servings: '1' });
        render();
      })(),
      s.food ? 'Food saved' : 'Food created',
    );
  };
  return h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    sheetHeader(s.food ? 'Edit food' : 'Create a food'),
    h('form', { class: 'form', novalidate: true, onsubmit: (ev: Event) => (ev.preventDefault(), submit()) },
      field('name', 'Name', { maxLength: 120, autocomplete: 'off' }),
      field('brand', 'Brand (optional)', { maxLength: 80 }),
      field('serving_label', 'Serving size', { maxLength: 60, placeholder: '1 cup, 2 slices, 100 g' }),
      h('div', { class: 'grid2' }, field('kcal', 'Calories', { ...num, step: '1' }), field('protein_g', 'Protein (g)', num), field('carbs_g', 'Carbs (g)', num), field('fat_g', 'Fat (g)', num), field('fiber_g', 'Fiber (g)', num), field('sugar_g', 'Sugar (g)', num), field('sodium_mg', 'Sodium (mg)', num)),
      h('button', { type: 'submit', class: 'primary wide' }, s.thenLog ? 'Save and log' : 'Save'),
    ),
    s.food ? btn('Delete food', () => run(sa.data.delete(COLLECTIONS.foods, s.food!.id).then(() => closeSheet()), 'Food deleted'), 'danger wide') : null,
  );
}

// ------------------------------------------------------------------ Weight sheet

function weightSheet(): HTMLElement {
  const u = units();
  const latest = weightOn(raw.weights, date);
  const input = h('input', { id: 'weight-value', type: 'number', inputMode: 'decimal', step: '0.1', min: '1', value: latest ? String(weightFromKg(latest.kg, u)) : '' });
  const err = h('p', { class: 'error', role: 'alert' });
  const submit = () => {
    const v = Number(input.value);
    const kg = weightToKg(v, u);
    if (!Number.isFinite(v) || kg < 20 || kg > 500) {
      err.textContent = `Enter a weight in ${u === 'metric' ? 'kg' : 'lb'}.`;
      input.focus();
      return;
    }
    const existing = raw.weights.find((w) => !w.deleted && w.date === date);
    run(
      (async () => {
        const data = { date, kg: round(kg, 2) };
        const id = await save(COLLECTIONS.weights, data, existing);
        if (settings().hc_write) void health.writeWeight({ id, ...data });
        closeSheet();
      })(),
      'Weight logged',
    );
  };
  const recent = raw.weights.filter((w) => !w.deleted).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  return h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
    sheetHeader('Log weight'),
    h('p', { class: 'muted' }, dayLabel(date, localToday())),
    h('label', { for: 'weight-value' }, `Weight (${u === 'metric' ? 'kg' : 'lb'})`),
    input,
    err,
    btn('Save', submit, 'primary wide', { 'data-testid': 'weight-submit' }),
    recent.length ? h('h2', { class: 'sub' }, 'Recent') : null,
    h('ul', { class: 'plain' }, ...recent.map((w) => h('li', { class: 'row' }, h('span', null, `${dayLabel(w.date, localToday())}: ${fmtWeight(w.kg, u)}`), btn('Delete', () => run(deleteWeight(w), 'Weight deleted'), 'link danger-text', { 'aria-label': `Delete weight on ${w.date}` })))),
  );
}

async function deleteWeight(w: Weight): Promise<void> {
  await sa.data.delete(COLLECTIONS.weights, w.id);
  void health.deleteWeight(w.id);
}

// ------------------------------------------------------------------ Trends

function trendsView(): HTMLElement {
  const s = settings();
  const u = units();
  const today = localToday();
  const from = addDays(today, -(trendRange - 1));
  const seg = (n: 7 | 30 | 90, label: string) => btn(label, () => ((trendRange = n), render(), void loadTrendSteps()), `seg${trendRange === n ? ' on' : ''}`, { 'aria-pressed': String(trendRange === n) });

  // Weight
  const pts = weightSeries(raw, from, today);
  const fromDate = parseYmd(from).getTime();
  const xy = pts.map((p) => ({ x: Math.round((parseYmd(p.date).getTime() - fromDate) / 864e5), y: weightFromKg(p.value, u) }));
  const delta = change(pts);
  const current = weightOn(raw.weights, today)?.kg ?? null;
  const eta = goalEta(current, s.goal_kg, s.rate_kg_week, today);
  const fmtW = (n: number) => `${round(n, 1)}`;
  const weightCard = h(
    'section',
    { class: 'card', 'aria-labelledby': 'tw-h' },
    h('div', { class: 'card-head' }, h('h2', { id: 'tw-h' }, 'Weight'), btn('Log', () => openSheet({ kind: 'weight' }), 'add')),
    pts.length
      ? line(xy.length ? xy : [{ x: 0, y: 0 }], { goal: s.goal_kg ? weightFromKg(s.goal_kg, u) : undefined, label: `Weight over the last ${trendRange} days`, format: fmtW, xLabels: [dayLabel(from, today), 'Today'] })
      : h('p', { class: 'muted' }, 'No weights in this period.'),
    h(
      'p',
      { class: 'stat-line' },
      [
        delta !== null ? `${delta > 0 ? '+' : '−'}${fmtWeight(Math.abs(delta), u)} in ${trendRange} days` : '',
        s.goal_kg ? `Goal ${fmtWeight(s.goal_kg, u)}${eta ? ` around ${parseYmd(eta).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: eta.slice(0, 4) !== today.slice(0, 4) ? 'numeric' : undefined })}` : ''}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  );

  // Calories (last 7 or more days)
  const days = Math.min(trendRange, 30);
  const calFrom = addDays(today, -(days - 1));
  const byDay = kcalByDay(raw, calFrom, today);
  const budget = budgetFor(s, current, new Date().getFullYear(), null).base;
  const logged = [...byDay.values()].filter((v) => v > 0);
  const avg = average(logged);
  const calCard = h(
    'section',
    { class: 'card', 'aria-labelledby': 'tc-h' },
    h('h2', { id: 'tc-h' }, 'Calories'),
    bars(
      [...byDay].map(([d, v]) => ({ label: days <= 7 ? parseYmd(d).toLocaleDateString(undefined, { weekday: 'narrow' }) : d === today || parseYmd(d).getDate() % 7 === 1 ? String(parseYmd(d).getDate()) : '', value: v, current: d === today })),
      { target: budget, label: `Calories eaten per day for the last ${days} days, budget ${fmtNum(budget)}`, format: fmtNum },
    ),
    h('p', { class: 'stat-line' }, avg !== null ? `Average ${fmtNum(avg)} cal on ${logged.length} logged day${logged.length === 1 ? '' : 's'}` : 'Nothing logged yet.'),
  );

  // Steps from Health Connect
  let stepsCard: HTMLElement | null = null;
  if (health.canRead('steps')) {
    const sDays = Math.min(trendRange, 30);
    const sFrom = addDays(today, -(sDays - 1));
    const series: { label: string; value: number; current: boolean }[] = [];
    for (let d = sFrom; d <= today; d = addDays(d, 1)) series.push({ label: sDays <= 7 ? parseYmd(d).toLocaleDateString(undefined, { weekday: 'narrow' }) : d === today || parseYmd(d).getDate() % 7 === 1 ? String(parseYmd(d).getDate()) : '', value: trendSteps.get(d) ?? 0, current: d === today });
    const sAvg = average([...trendSteps.values()]);
    stepsCard = h(
      'section',
      { class: 'card', 'aria-labelledby': 'ts-h' },
      h('h2', { id: 'ts-h' }, 'Steps'),
      bars(series, { label: `Steps per day for the last ${sDays} days`, format: fmtNum }),
      h('p', { class: 'stat-line' }, sAvg !== null ? `Average ${fmtNum(sAvg)} steps a day` : 'No steps in Health Connect for this period.'),
    );
  }

  return h('div', { class: 'view' }, h('div', { class: 'daybar' }, h('h1', null, 'Trends')), h('div', { class: 'segs', role: 'group', 'aria-label': 'Period' }, seg(7, 'Week'), seg(30, 'Month'), seg(90, '3 months')), weightCard, calCard, stepsCard);
}

async function loadTrendSteps(): Promise<void> {
  const today = localToday();
  const days = Math.min(trendRange, 30);
  const key = `${today}:${days}`;
  if (!health.canRead('steps') || trendStepsKey === key) return;
  trendStepsKey = key;
  trendSteps = await health.series('steps', addDays(today, -(days - 1)), today);
  if (tab === 'trends' && !sheet()) render();
}

// ------------------------------------------------------------------ Foods

function foodsView(): HTMLElement {
  const own = raw.foods.filter((f) => !f.deleted && !f.builtin_ref).sort((a, b) => a.name.localeCompare(b.name));
  const favs = favorites(raw);
  const meal = mealForHour(new Date().getHours());
  return h(
    'div',
    { class: 'view' },
    h('div', { class: 'daybar' }, h('h1', null, 'Foods')),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'my-h' },
      h('div', { class: 'card-head' }, h('h2', { id: 'my-h' }, 'My foods'), btn('Create', () => openSheet({ kind: 'food', draft: blankDraft(), errors: {} }), 'add')),
      own.length
        ? h('ul', { class: 'foods' }, ...own.map((f) => h('li', { class: 'food' }, h('button', { type: 'button', class: 'food-pick', onclick: () => openSheet({ kind: 'food', food: f, draft: draftOf(f), errors: {} }) }, h('span', { class: 'entry-main' }, h('span', { class: 'entry-name' }, f.name), h('span', { class: 'muted small' }, [f.brand, f.serving_label].filter(Boolean).join(' · '))), h('span', { class: 'entry-kcal' }, fmtNum(f.kcal ?? 0))))))
        : h('p', { class: 'muted' }, 'Save recipes and packaged foods you eat often.'),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'fav-h' },
      h('h2', { id: 'fav-h' }, 'Favorites'),
      favs.length ? h('ul', { class: 'foods' }, ...favs.map((f) => foodRow(f, () => openServing(f, meal)))) : h('p', { class: 'muted' }, 'Tap ☆ next to any food to keep it here.'),
    ),
    h('p', { class: 'muted small', 'data-testid': 'fooddb-attribution' }, FOODDB_ATTRIBUTION),
  );
}

// ------------------------------------------------------------------ Goals

function goalsView(): HTMLElement {
  const s = settings();
  const u = s.units;
  const today = localToday();
  const current = weightOn(raw.weights, today);
  const b = budgetFor(s, current?.kg ?? null, new Date().getFullYear(), null);
  const draft: Partial<Settings> = {};
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    goalsDirty = true;
    draft[k] = v;
  };
  const sel = (id: string, label: string, value: string, options: [string, string][], on: (v: string) => void) =>
    h('div', { class: 'field' }, h('label', { for: id }, label), h('select', { id, onchange: (ev: Event) => on((ev.currentTarget as HTMLSelectElement).value) }, ...options.map(([v, t]) => h('option', { value: v, selected: v === value }, t))));
  const numField = (id: string, label: string, value: number | undefined, on: (v: number | undefined) => void, opts: Record<string, unknown> = {}) =>
    h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, type: 'number', inputMode: 'decimal', value: value === undefined ? '' : String(value), oninput: (ev: Event) => {
      const raw = (ev.currentTarget as HTMLInputElement).value.trim();
      goalsDirty = true;
      on(raw === '' ? undefined : Number(raw));
    }, ...opts }));
  const toggle = (id: string, label: string, checked: boolean, on: (v: boolean) => void, hint?: string) =>
    h('div', { class: 'toggle' }, h('input', { id, type: 'checkbox', checked, onchange: (ev: Event) => on((ev.currentTarget as HTMLInputElement).checked) }), h('label', { for: id }, label, hint ? h('span', { class: 'muted small block' }, hint) : null));

  const hgt = s.height_cm ? heightParts(s.height_cm) : null;
  const heightInputs =
    u === 'metric'
      ? numField('g-height', 'Height (cm)', s.height_cm ? round(s.height_cm) : undefined, (v) => set('height_cm', v), { min: '100', max: '250' })
      : h(
          'div',
          { class: 'grid2' },
          numField('g-ft', 'Height (ft)', hgt?.ft, (v) => ((draft as Record<string, unknown>)._ft = v), { min: '3', max: '8' }),
          numField('g-in', 'Height (in)', hgt?.inch, (v) => ((draft as Record<string, unknown>)._in = v), { min: '0', max: '11' }),
        );
  const RATES: [string, string][] = u === 'metric'
    ? [['-1', 'Lose 1 kg a week'], ['-0.75', 'Lose 0.75 kg a week'], ['-0.5', 'Lose 0.5 kg a week'], ['-0.25', 'Lose 0.25 kg a week'], ['0', 'Maintain'], ['0.25', 'Gain 0.25 kg a week'], ['0.5', 'Gain 0.5 kg a week']]
    : [['-0.907', 'Lose 2 lb a week'], ['-0.68', 'Lose 1.5 lb a week'], ['-0.454', 'Lose 1 lb a week'], ['-0.227', 'Lose 0.5 lb a week'], ['0', 'Maintain'], ['0.227', 'Gain 0.5 lb a week'], ['0.454', 'Gain 1 lb a week']];
  const rateValue = RATES.reduce((best, [v]) => (Math.abs(Number(v) - s.rate_kg_week) < Math.abs(Number(best) - s.rate_kg_week) ? v : best), RATES[0]![0]);

  const hc = health.state;
  const hcStatus =
    hc.kind === 'connected'
      ? `Connected · reading ${hc.status.granted.read.length} data type${hc.status.granted.read.length === 1 ? '' : 's'}${hc.status.granted.write.length ? `, saving ${hc.status.granted.write.join(', ')}` : ''}`
      : hc.kind === 'unavailable'
        ? hc.reason
        : 'Not connected';

  const err = h('p', { class: 'error', role: 'alert' });
  const submit = () => {
    const d = draft as Partial<Settings> & { _ft?: number; _in?: number; _weight?: number };
    if (u !== 'metric' && (d._ft !== undefined || d._in !== undefined)) {
      const ft = d._ft ?? hgt?.ft ?? 0;
      const inch = d._in ?? hgt?.inch ?? 0;
      d.height_cm = round((ft * 12 + inch) * 2.54, 1);
    }
    delete d._ft;
    delete d._in;
    const goalRaw = (d as Record<string, unknown>)._goal as number | undefined;
    delete (d as Record<string, unknown>)._goal;
    if (goalRaw !== undefined) d.goal_kg = goalRaw ? round(weightToKg(goalRaw, u), 2) : undefined;
    const waterRaw = (d as Record<string, unknown>)._water as number | undefined;
    delete (d as Record<string, unknown>)._water;
    if (waterRaw !== undefined) d.water_goal_ml = Math.round(u === 'metric' ? waterRaw : waterRaw * 29.5735);
    const p = d.protein_pct ?? s.protein_pct;
    const c = d.carbs_pct ?? s.carbs_pct;
    const f = d.fat_pct ?? s.fat_pct;
    const problems: string[] = [];
    if (p + c + f !== 100) problems.push(`Protein, carbs and fat must add up to 100 % (now ${p + c + f} %).`);
    if (d.height_cm !== undefined && (d.height_cm < 100 || d.height_cm > 250)) problems.push('Check your height.');
    if (d.birth_year !== undefined && (d.birth_year < 1900 || d.birth_year > new Date().getFullYear() - 13)) problems.push('Check your birth year.');
    if (d.budget_override !== undefined && d.budget_override !== 0 && (d.budget_override < 800 || d.budget_override > 10000)) problems.push('A custom budget must be between 800 and 10,000 calories.');
    if (problems.length) {
      err.textContent = problems.join(' ');
      return;
    }
    if (d.budget_override === undefined && 'budget_override' in d) d.budget_override = 0;
    run(
      saveSettings(d).then(() => {
        goalsDirty = false;
        render();
      }),
      'Goals saved',
    );
  };

  return h(
    'div',
    { class: 'view' },
    h('div', { class: 'daybar' }, h('h1', null, 'Goals')),
    h(
      'section',
      { class: 'card hero-sm', 'aria-labelledby': 'gb-h' },
      h('h2', { id: 'gb-h' }, 'Daily budget'),
      h('p', { class: 'big', 'data-testid': 'goal-budget' }, `${fmtNum(b.base)} cal`),
      h(
        'p',
        { class: 'muted small' },
        b.basis === 'override'
          ? 'Your custom budget.'
          : b.basis === 'computed'
            ? `Maintenance from your profile${b.adjustment ? `, ${b.adjustment > 0 ? '+' : '−'}${fmtNum(Math.abs(b.adjustment))} a day for your weekly goal` : ''}${s.exercise_adds ? ', before exercise' : ''}.${b.floored ? ' Raised to a safe minimum.' : ''}`
            : 'Add your profile and a weight to calculate it.',
      ),
      h('p', { class: 'muted small' }, `Protein ${b.macros.protein_g} g · Carbs ${b.macros.carbs_g} g · Fat ${b.macros.fat_g} g`),
    ),
    h(
      'form',
      { class: 'card form', novalidate: true, onsubmit: (ev: Event) => (ev.preventDefault(), submit()) },
      h('h2', null, 'Profile'),
      sel('g-units', 'Units', u, [['imperial', 'Pounds, feet, fl oz'], ['metric', 'Kilograms, cm, ml']], (v) => {
        run(saveSettings({ units: v as Settings['units'] }).then(() => render()));
      }),
      sel('g-sex', 'Sex (for the calorie formula)', s.sex ?? '', [['', 'Prefer not to say'], ['female', 'Female'], ['male', 'Male']], (v) => set('sex', (v || undefined) as Settings['sex'])),
      numField('g-birth', 'Birth year', s.birth_year, (v) => set('birth_year', v), { min: '1900', max: String(new Date().getFullYear()) }),
      heightInputs,
      sel('g-activity', 'Day-to-day activity', s.activity, (Object.keys(ACTIVITY_LABEL) as Activity[]).map((a) => [a, ACTIVITY_LABEL[a]]), (v) => set('activity', v as Activity)),
      h('h2', null, 'Weight goal'),
      h('p', { class: 'muted small' }, current ? `Current: ${fmtWeight(current.kg, u)} (${dayLabel(current.date, today)})` : 'Log a weight on the Today tab to calculate your budget.'),
      numField('g-goal', `Goal weight (${u === 'metric' ? 'kg' : 'lb'})`, s.goal_kg ? weightFromKg(s.goal_kg, u) : undefined, (v) => ((draft as Record<string, unknown>)._goal = v), { min: '30', step: '0.1' }),
      sel('g-rate', 'Weekly goal', rateValue, RATES, (v) => set('rate_kg_week', Number(v))),
      h('h2', null, 'Budget and macros'),
      numField('g-override', 'Custom calorie budget (optional)', s.budget_override || undefined, (v) => set('budget_override', v === undefined ? undefined : Math.round(v)), { min: '800', max: '10000', placeholder: 'Calculated' }),
      h('div', { class: 'grid3' }, numField('g-p', 'Protein %', s.protein_pct, (v) => set('protein_pct', v), { min: '5', max: '70' }), numField('g-c', 'Carbs %', s.carbs_pct, (v) => set('carbs_pct', v), { min: '5', max: '80' }), numField('g-f', 'Fat %', s.fat_pct, (v) => set('fat_pct', v), { min: '5', max: '70' })),
      numField('g-water', `Water goal (${u === 'metric' ? 'ml' : 'fl oz'})`, u === 'metric' ? s.water_goal_ml : Math.round(s.water_goal_ml / 29.5735), (v) => ((draft as Record<string, unknown>)._water = v), { min: '0', max: u === 'metric' ? '10000' : '340' }),
      h('h2', null, 'Health Connect'),
      h('p', { class: 'muted small', 'data-testid': 'hc-status' }, hcStatus),
      hc.kind === 'not_connected' || (hc.kind === 'connected' && s.hc_write && hc.status.granted.write.length === 0)
        ? btn(hc.kind === 'connected' ? 'Allow saving to Health Connect' : 'Connect Health Connect', () => run(connectHealth()), 'ghost')
        : null,
      toggle('g-exercise', 'Add exercise calories to my budget', s.exercise_adds, (v) => set('exercise_adds', v), 'Uses active calories from your watch or phone.'),
      toggle('g-hcwrite', 'Save meals, weight and water to Health Connect', s.hc_write, (v) => set('hc_write', v), 'So your watch and other health apps see them.'),
      h('h2', null, 'Food list'),
      toggle('g-gentle', 'Gentle mode', s.gentle_mode, (v) => set('gentle_mode', v), 'Shows low-residue, easy-to-digest choices first in search, marked "Gentle".'),
      err,
      h('button', { type: 'submit', class: 'primary wide', 'data-testid': 'goals-save' }, 'Save goals'),
    ),
  );
}

// ------------------------------------------------------------------ shell

function switchTab(t: Tab): void {
  tab = t;
  goalsDirty = false;
  sheets = [];
  render();
  $('main').scrollTop = 0;
  if (t === 'trends') void loadTrendSteps();
}

function tabBar(): HTMLElement {
  const item = (t: Tab, label: string) =>
    h('button', { type: 'button', class: `tab${tab === t ? ' on' : ''}`, 'aria-current': tab === t ? 'page' : undefined, onclick: () => switchTab(t), 'data-testid': `tab-${t}` }, tabIcon(t), h('span', null, label));
  return h('nav', { class: 'tabs', 'aria-label': 'EatWell' }, item('today', 'Today'), item('trends', 'Trends'), item('foods', 'Foods'), item('goals', 'Goals'));
}

/** 24 px stroke icons (decorative; the label carries the meaning). */
const TAB_ICON: Record<Tab, string> = {
  today: 'M12 3a9 9 0 1 0 9 9h-9z M14 2.5v7.5h7.5A9 9 0 0 0 14 2.5z',
  trends: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  foods: 'M7 3v8a2 2 0 0 0 4 0V3 M9 11v10 M17 3c-2 2-2 6 0 8v10',
  goals: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8z',
};
function tabIcon(t: Tab): SVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '24', height: '24', 'aria-hidden': 'true', class: 'tab-icon' })) el.setAttribute(k, v);
  const p = document.createElementNS(NS, 'path');
  for (const [k, v] of Object.entries({ d: TAB_ICON[t], fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) p.setAttribute(k, v);
  el.append(p);
  return el;
}

function render(): void {
  if (!loaded) return;
  const top = sheet();
  const main = $('main');
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.id;
  if (top) {
    const body =
      top.kind === 'add' ? addSheet(top) : top.kind === 'serving' ? servingSheet(top) : top.kind === 'quick' ? quickSheet(top) : top.kind === 'food' ? foodSheet(top) : weightSheet();
    main.replaceChildren(body);
    $('nav').replaceChildren();
  } else {
    main.replaceChildren(tab === 'today' ? todayView() : tab === 'trends' ? trendsView() : tab === 'foods' ? foodsView() : goalsView());
    $('nav').replaceChildren(tabBar());
  }
  // Keep the caret where the owner was typing; otherwise land on the sheet's first control.
  const again = focusId ? document.getElementById(focusId) : null;
  if (again) again.focus();
  else if (top) (main.querySelector('#food-search, #servings, #quick-kcal, #food-name, #weight-value') as HTMLElement | null)?.focus();
}

async function main(): Promise<void> {
  const ctx = await sa.ready;
  document.documentElement.dataset.theme = ctx.theme;
  await sa.app.setTitle('EatWell');
  await health.refresh();
  await watchAll(sa, (r) => {
    raw = r;
    const first = !loaded;
    loaded = true;
    // Data changed (own write, sync, another device). Refresh what is on screen unless that would
    // throw away something the owner is typing: open forms keep their state until they close.
    const top = sheet();
    if (first || (!top && !(tab === 'goals' && goalsDirty)) || top?.kind === 'add') render();
  });
  await sa.app.ready();
  void loadActivity();
  sa.data.onSyncFailed((e) => toast(`A change in ${e.collection.replace('eatwell_', '')} needs attention in Supra's Sync centre.`, 'error'));
  // A new day while the app stays open: follow it if the owner was on "today".
  let lastToday = localToday();
  window.setInterval(() => {
    const now = localToday();
    if (now !== lastToday) {
      if (date === lastToday) setDate(now);
      lastToday = now;
    }
  }, 60_000);
}

main().catch((err: Error) => {
  $('main').replaceChildren(h('p', { class: 'error', role: 'alert' }, `EatWell could not start: ${err.message}`));
});
