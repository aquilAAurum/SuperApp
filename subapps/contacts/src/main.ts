// Supra Contacts subapp (SA-2026-007, P2): Today (reach-out queue + dates), People (search), contact
// cards with edit and touch logging, and the network graph (Supra---Contacts viewer). Reads and
// writes only contacts_* through @superapp/sdk; everything works offline from the shell's mirror.
// DOM is built with createElement/textContent only (HB-SEC-04).
import { connect, BridgeError } from '@superapp/sdk';
import { watchAll } from './data.ts';
import {
  COLLECTIONS,
  TOUCH_KINDS,
  buildModel,
  dueList,
  graphData,
  linkGroups,
  localToday,
  nextScheduled,
  search,
  sharedContext,
  subtitle,
  touchWrites,
  upcomingDates,
  validatePersonEdit,
  type Entity,
  type Health,
  type Model,
  type PersonEdit,
  type ReachOut,
} from './model.ts';
import viewerCss from './viewer/graph-viewer.css?raw';
import './viewer/graph-viewer.js';

const sa = connect({ appId: 'contacts' });

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

// ------------------------------------------------------------------ state
type View = { name: 'today' } | { name: 'people' } | { name: 'card'; id: string; mode?: 'edit' | 'log' };
let model: Model | null = null;
let view: View = { name: 'today' };
const history: View[] = [];
let query = '';
let kindFilter: 'person' | 'organization' | 'other' | 'all' = 'person';
let loaded = false;

function toast(text: string, kind: 'ok' | 'error' = 'ok'): void {
  const t = $('toast');
  t.textContent = text;
  t.dataset.kind = kind;
  t.hidden = false;
  clearTimeout((toast as unknown as { timer?: number }).timer);
  (toast as unknown as { timer?: number }).timer = window.setTimeout(() => (t.hidden = true), 4000);
}

function go(next: View, push = true): void {
  if (push && !(view.name === next.name && view.name !== 'card')) history.push(view);
  view = next;
  render(true);
}
function back(): void {
  view = history.pop() ?? { name: 'today' };
  render(true);
}

// ------------------------------------------------------------------ pieces
const HEALTH: Record<Health, { icon: string; label: (r: ReachOut) => string }> = {
  overdue: { icon: '●', label: (r) => `Overdue ${-r.days!}d` },
  due: { icon: '●', label: () => 'Due today' },
  soon: { icon: '◐', label: (r) => `Due in ${r.days}d` },
  ok: { icon: '○', label: (r) => `Due ${r.due}` },
  none: { icon: '–', label: () => 'No schedule' },
};
const healthChip = (r: ReachOut) => h('span', { class: `c-health c-${r.health}`, 'data-health': r.health }, h('span', { 'aria-hidden': 'true', text: HEALTH[r.health].icon }), ` ${HEALTH[r.health].label(r)}`);

function cardButton(e: Entity, sub: string, extra?: Node | null): HTMLLIElement {
  return h(
    'li',
    null,
    h('button', { type: 'button', class: 'c-row', 'data-entity': e.id, onclick: () => go({ name: 'card', id: e.id }) }, h('span', { class: 'c-row-title', text: e.title }), sub ? h('span', { class: 'c-row-sub', text: sub }) : null, extra ?? null),
  );
}

function heading(text: string): HTMLHeadingElement {
  return h('h2', { id: 'view-heading', tabindex: '-1', text });
}

function banner(m: Model): HTMLElement | null {
  if (m.cutover || m.entities.size === 0) return null;
  return h('p', { class: 'c-banner', role: 'note', 'data-testid': 'precutover' }, 'The vault has not been cut over yet. The next push from the vault replaces edits made here (runbook: Supra---Contacts docs/runbook-migration.md).');
}

// ------------------------------------------------------------------ screens
function renderToday(m: Model): Node[] {
  const due = dueList(m);
  const overdue = due.filter((r) => r.health === 'overdue').length;
  const out: Node[] = [heading('Today')];
  const b = banner(m);
  if (b) out.push(b);
  if (m.entities.size === 0) {
    out.push(h('p', { class: 'c-empty', 'data-testid': 'empty-import', text: loaded ? 'No contacts yet. Import your vault with supra-contacts push, then they appear here.' : 'Loading contacts…' }));
    return out;
  }
  out.push(h('p', { class: 'c-summary', 'data-testid': 'today-summary', text: `${due.length} due this week (${overdue} overdue)` }));
  if (due.length === 0) {
    const n = nextScheduled(m);
    out.push(h('p', { class: 'c-empty', text: n ? `Nobody is due. Next: ${n.person.display_name} on ${n.due}.` : 'Nobody is due. Set a cadence on a card to start a schedule.' }));
  } else {
    out.push(
      h(
        'ul',
        { class: 'c-list', 'data-testid': 'due-list' },
        ...due.map((r) => cardButton(r.entity, [r.org, r.lastTouch ? `last touch ${r.lastTouch}` : 'never touched'].filter(Boolean).join(' · '), healthChip(r))),
      ),
    );
  }
  const dates = upcomingDates(m, 30);
  out.push(h('h3', { text: 'Dates (next 30 days)' }));
  if (dates.length === 0) out.push(h('p', { class: 'c-empty', text: 'No birthdays or anniversaries in the next 30 days.' }));
  else
    out.push(
      h(
        'ul',
        { class: 'c-list', 'data-testid': 'dates-list' },
        ...dates.map((d) => {
          const e = m.entities.get(d.entityId)!;
          const when = d.days === 0 ? 'today' : d.days === 1 ? 'tomorrow' : `in ${d.days}d (${d.on})`;
          return cardButton(e, `${d.label}${d.years ? ` (${d.years})` : ''} · ${when}`);
        }),
      ),
    );
  return out;
}

function renderPeople(m: Model, focusSearch: boolean): Node[] {
  const kinds = kindFilter === 'all' ? undefined : kindFilter === 'other' ? ['role', 'project', 'event', 'group', 'note'] : [kindFilter];
  const input = h('input', { id: 'search', type: 'search', value: query, placeholder: 'Name, org, title, email…', autocomplete: 'off', 'aria-describedby': 'result-count' });
  const results = h('ul', { class: 'c-list', 'data-testid': 'search-results' });
  const count = h('p', { id: 'result-count', class: 'c-summary', 'aria-live': 'polite' });
  const fill = () => {
    const t0 = performance.now();
    const hits = search(m, query, { kinds, limit: 100 });
    results.replaceChildren(...hits.map((x) => cardButton(x.entity, x.subtitle)));
    count.textContent = hits.length ? `${hits.length === 100 ? '100+' : hits.length} result${hits.length === 1 ? '' : 's'}` : query ? `No one matches “${query}”.` : 'Nothing here yet.';
    count.dataset.ms = String(Math.round(performance.now() - t0));
  };
  input.addEventListener('input', () => {
    query = input.value;
    fill();
  });
  const chip = (k: typeof kindFilter, label: string) =>
    h('button', { type: 'button', class: 'c-chip', 'aria-pressed': String(kindFilter === k), onclick: () => ((kindFilter = k), render(false)) }, label);
  fill();
  if (focusSearch) queueMicrotask(() => input.focus());
  return [heading('People'), h('label', { for: 'search', class: 'c-label', text: 'Search' }), input, h('div', { class: 'c-chips', role: 'group', 'aria-label': 'Show' }, chip('person', 'People'), chip('organization', 'Organizations'), chip('other', 'Roles, projects, events'), chip('all', 'All')), count, results];
}

function dl(rows: [string, string | null | undefined][], testid?: string): HTMLElement | null {
  const items = rows.filter(([, v]) => v);
  if (!items.length) return null;
  return h('dl', { class: 'c-dl', 'data-testid': testid }, ...items.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v! })]));
}

function renderCard(m: Model, id: string, mode?: 'edit' | 'log'): Node[] {
  const e = m.entities.get(id);
  const backBtn = h('button', { type: 'button', class: 'c-back', onclick: back }, '← Back');
  if (!e) return [backBtn, heading('Not found'), h('p', { class: 'c-empty', text: 'This record is no longer in Contacts.' })];
  const p = m.personByEntity.get(id);
  const o = m.orgByEntity.get(id);
  const n = m.nodeByEntity.get(id);
  const r = m.reach.get(id);
  const out: Node[] = [backBtn, heading(e.title)];
  const sub = subtitle(m, e);
  if (sub) out.push(h('p', { class: 'c-sub', text: sub }));
  if (r) out.push(h('p', { class: 'c-health-line', 'data-testid': 'card-health' }, healthChip(r), r.lastTouch ? ` · last touch ${r.lastTouch}` : ' · never touched'));

  if (p && !mode) {
    out.push(
      h(
        'div',
        { class: 'c-actions' },
        h('button', { type: 'button', class: 'c-primary', onclick: () => go({ name: 'card', id, mode: 'log' }, false) }, 'Log a touch'),
        h('button', { type: 'button', onclick: () => go({ name: 'card', id, mode: 'edit' }, false) }, 'Edit'),
      ),
    );
  }
  if (p && mode === 'log') out.push(logForm(m, id));
  if (p && mode === 'edit') out.push(editForm(m, id));

  const points = (m.points.get(id) ?? []).slice().sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));
  if (points.length) {
    out.push(h('h3', { text: 'Reach' }));
    out.push(
      h(
        'dl',
        { class: 'c-dl', 'data-testid': 'card-points' },
        ...points.flatMap((c) => [
          h('dt', { text: [c.channel.replace(/_/g, ' '), c.label, c.is_primary ? 'primary' : null].filter(Boolean).join(' · ') }),
          h('dd', { class: c.is_valid === false ? 'c-invalid' : undefined }, h('span', { class: 'c-select', text: c.value_norm || c.value }), c.is_valid === false ? ' (check this)' : null),
        ]),
      ),
    );
  } else if (p) out.push(h('p', { class: 'c-empty', text: 'No email or phone yet.' }));

  const details = dl(
    p
      ? [
          ['Location', p.location],
          ['Alma mater', p.alma_mater ? m.entities.get(p.alma_mater)?.title : null],
          ['Preferred channel', p.preferred_channel],
          ['Cadence', p.cadence_days ? `every ${p.cadence_days} days` : null],
          ['Next touch', p.next_touch],
          ['Met', [p.met_on, p.how_met].filter(Boolean).join(' · ')],
          ['Seniority', e.seniority],
          ['Relationship', e.relationship],
          ['Status', e.status],
        ]
      : o
        ? [
            ['Industry', o.industry],
            ['HQ', o.hq_location],
            ['Website', o.website],
            ['Domain', o.domain],
            ['Relationship', o.relationship_tier],
          ]
        : n
          ? [
              ['Type', n.node_type],
              ['Organization', n.org ? m.entities.get(n.org)?.title : null],
              ['From', n.start_date],
              ['To', n.end_date],
              ['On', n.occurred_on],
              ['About', n.description],
            ]
          : [],
    'card-details',
  );
  if (details) out.push(h('h3', { text: 'Details' }), details);

  for (const g of linkGroups(m, id)) {
    out.push(h('h3', { text: `${g.label} (${g.items.length})` }), h('ul', { class: 'c-list c-compact' }, ...g.items.slice(0, 100).map((x) => cardButton(x.entity, [x.entity.kind === 'person' ? null : x.entity.kind, x.detail].filter(Boolean).join(' · ')))));
  }
  const listed = m.mentions.filter((x) => x.entity === id || x.parent === id);
  if (listed.length) out.push(h('h3', { text: `Unlinked names (${listed.length})` }), h('p', { class: 'c-sub', text: listed.map((x) => x.text + (x.section ? ` (${x.section})` : '')).join(', ') }));

  if (p) {
    const shared = sharedContext(m, id);
    if (shared.length) out.push(h('h3', { text: 'Shared background' }), h('ul', { class: 'c-list c-compact' }, ...shared.map((s) => cardButton(s.entity, `via ${s.via.join(', ')}`))));
  }
  const timeline = m.interactions.get(id) ?? [];
  if (timeline.length) {
    out.push(h('h3', { text: 'Timeline' }), h('ul', { class: 'c-timeline', 'data-testid': 'card-timeline' }, ...timeline.slice(0, 50).map((i) => h('li', null, h('strong', { text: i.occurred_on }), ` ${i.kind ?? ''}${i.summary ? `: ${i.summary}` : ''}`))));
  }
  if (e.body && e.body.trim()) {
    const body = e.body.trim();
    const short = body.length > 1200;
    const pre = h('div', { class: 'c-notes', text: short ? `${body.slice(0, 1200)}…` : body });
    out.push(h('h3', { text: 'Notes' }), pre);
    if (short) {
      const more = h('button', { type: 'button', class: 'c-link' }, 'Show all');
      more.addEventListener('click', () => {
        pre.textContent = body;
        more.remove();
      });
      out.push(more);
    }
  }
  return out;
}

function field(id: string, label: string, input: HTMLInputElement | HTMLTextAreaElement, error?: string): HTMLElement {
  input.id = id;
  if (error) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', `${id}-err`);
  }
  return h('div', { class: 'c-field' }, h('label', { for: id, class: 'c-label', text: label }), input, error ? h('p', { id: `${id}-err`, class: 'c-error', text: error }) : null);
}

function editForm(m: Model, id: string, errors: Partial<Record<keyof PersonEdit, string>> = {}, values?: PersonEdit): HTMLElement {
  const p = m.personByEntity.get(id)!;
  const v: PersonEdit = values ?? {
    job_title: p.job_title ?? '',
    location: p.location ?? '',
    preferred_channel: p.preferred_channel ?? '',
    cadence_days: p.cadence_days ? String(p.cadence_days) : '',
    next_touch: p.next_touch ?? '',
    how_met: p.how_met ?? '',
  };
  const inp = (k: keyof PersonEdit, extra: Record<string, unknown> = {}) => h('input', { name: k, value: v[k], autocomplete: 'off', ...extra });
  const form = h(
    'form',
    { class: 'c-form', 'data-testid': 'edit-form', 'aria-label': 'Edit contact' },
    field('f-job', 'Job title', inp('job_title', { maxLength: 200 }), errors.job_title),
    field('f-loc', 'Location', inp('location', { maxLength: 200 }), errors.location),
    field('f-chan', 'Preferred channel', inp('preferred_channel', { maxLength: 50 }), errors.preferred_channel),
    field('f-cad', 'Reach out every (days)', inp('cadence_days', { inputMode: 'numeric' }), errors.cadence_days),
    field('f-next', 'Next touch (YYYY-MM-DD)', inp('next_touch', { inputMode: 'numeric', placeholder: 'YYYY-MM-DD' }), errors.next_touch),
    field('f-met', 'How we met', h('textarea', { name: 'how_met', value: v.how_met, maxLength: 1000, rows: 3 }), errors.how_met),
    h('div', { class: 'c-actions' }, h('button', { type: 'submit', class: 'c-primary' }, 'Save'), h('button', { type: 'button', onclick: () => go({ name: 'card', id }, false) }, 'Cancel')),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const input = Object.fromEntries((['job_title', 'location', 'preferred_channel', 'cadence_days', 'next_touch', 'how_met'] as const).map((k) => [k, String(fd.get(k) ?? '')])) as unknown as PersonEdit;
    const res = validatePersonEdit(input);
    if (!res.ok) {
      form.replaceWith(editForm(m, id, res.errors, input));
      return;
    }
    void write(() => sa.data.update(COLLECTIONS.people, p.id, res.patch), 'Saved.').then((ok) => ok && go({ name: 'card', id }, false));
  });
  queueMicrotask(() => (form.querySelector<HTMLElement>('[aria-invalid="true"]') ?? $('f-job'))?.focus());
  return form;
}

function logForm(m: Model, id: string): HTMLElement {
  const p = m.personByEntity.get(id)!;
  let kind: string = TOUCH_KINDS[0];
  const group = h('div', { class: 'c-chips', role: 'group', 'aria-label': 'How' });
  const paint = () => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === kind)));
  for (const k of TOUCH_KINDS) group.append(h('button', { type: 'button', class: 'c-chip', onclick: () => ((kind = k), paint()) }, k));
  paint();
  const note = h('textarea', { name: 'summary', rows: 3, maxLength: 5000 });
  const form = h(
    'form',
    { class: 'c-form', 'data-testid': 'log-form', 'aria-label': 'Log a touch' },
    h('p', { class: 'c-label', text: `Log a touch with ${p.display_name} today (${m.today})` }),
    group,
    field('f-note', 'Note (optional)', note),
    h('div', { class: 'c-actions' }, h('button', { type: 'submit', class: 'c-primary' }, 'Save'), h('button', { type: 'button', onclick: () => go({ name: 'card', id }, false) }, 'Cancel')),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const w = touchWrites(p, m.today, kind, note.value);
    void write(async () => {
      await sa.data.create(COLLECTIONS.interactions, w.interaction);
      await sa.data.update(COLLECTIONS.people, p.id, w.personPatch);
    }, 'Touch logged.').then((ok) => ok && go({ name: 'card', id }, false));
  });
  queueMicrotask(() => group.querySelector('button')?.focus());
  return form;
}

async function write(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
  try {
    await fn();
    toast(ok);
    return true;
  } catch (err) {
    const code = err instanceof BridgeError ? err.code : 'UNKNOWN';
    toast(`Couldn't save (${code}). ${(err as Error).message}`, 'error');
    void sa.sys.log('warn', 'contacts.write_failed', { code });
    return false;
  }
}

// ------------------------------------------------------------------ graph (full-screen overlay)
let graph: { destroy(): void } | null = null;
function openGraph(focusId?: string): void {
  if (!model) return;
  const m = model;
  $('app').hidden = true;
  const style = h('style', { id: 'graph-css', text: viewerCss });
  document.head.append(style);
  const root = $('graph');
  const closeBtn = h('button', { type: 'button', class: 'btn', id: 'graph-back', onclick: () => closeGraph() }, '← Contacts');
  root.replaceChildren(
    h('canvas', { id: 'c', 'aria-label': 'Contact graph. Use search to find a person, organization, role or project.' }),
    h(
      'div',
      { class: 'bar' },
      closeBtn,
      h('div', { class: 'search' }, h('input', { id: 'q', type: 'search', placeholder: 'Search', 'aria-label': 'Search the graph', role: 'combobox', 'aria-controls': 'res', 'aria-expanded': 'false', autocomplete: 'off' }), h('ul', { id: 'res', class: 'res', role: 'listbox', 'aria-label': 'Matches' })),
      h('button', { class: 'btn', id: 'filters', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'drawer' }, 'Filters'),
      h(
        'select',
        { class: 'btn', id: 'color', 'aria-label': 'Colour by' },
        ...[
          ['kind', 'Colour: type'],
          ['community', 'Colour: cluster'],
          ['reach', 'Colour: reach-out'],
          ['seniority', 'Colour: seniority'],
          ['relationship', 'Colour: relationship'],
        ].map(([v, t]) => h('option', { value: v, text: t })),
      ),
      h('button', { class: 'btn', id: 'fit', type: 'button' }, 'Fit'),
    ),
    h('aside', { class: 'drawer', id: 'drawer', 'aria-label': 'Filters' }),
    h('aside', { class: 'panel', id: 'panel', 'aria-live': 'polite' }),
    h('div', { class: 'legend', id: 'legend' }),
    h('div', { class: 'stats', id: 'stats' }),
  );
  root.hidden = false;
  const mount = (globalThis as unknown as { mountSupraGraph: (d: unknown, o: { onOpen: (id: string) => void }) => { destroy(): void; select?: (id: string) => void } }).mountSupraGraph;
  graph = mount(graphData(m), { onOpen: (eid) => (closeGraph(), go({ name: 'card', id: eid })) });
  if (focusId) (window as unknown as { __supraGraph?: { select(id: string): void } }).__supraGraph?.select(focusId);
  closeBtn.focus();
}
function closeGraph(): void {
  graph?.destroy();
  graph = null;
  $('graph').replaceChildren();
  $('graph').hidden = true;
  $('graph-css')?.remove();
  $('app').hidden = false;
  render(true);
}

// ------------------------------------------------------------------ render
function render(moveFocus: boolean): void {
  if (!model) return;
  const main = $('main');
  const tabs = document.querySelectorAll<HTMLButtonElement>('#tabs button[data-view]');
  tabs.forEach((t) => (t.dataset.view === view.name ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
  const nodes = view.name === 'today' ? renderToday(model) : view.name === 'people' ? renderPeople(model, moveFocus) : renderCard(model, view.id, view.mode);
  main.replaceChildren(...nodes);
  main.dataset.view = view.name;
  if (moveFocus && view.name !== 'people' && !(view.name === 'card' && view.mode)) $('view-heading')?.focus();
}

document.querySelectorAll<HTMLButtonElement>('#tabs button[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    const v = b.dataset.view;
    if (v === 'graph') openGraph(view.name === 'card' ? view.id : undefined);
    else go({ name: v as 'today' | 'people' });
  }),
);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (graph) return; // the viewer handles Escape (clear selection); its Back button closes it
  if (view.name === 'card') back();
});

async function main(): Promise<void> {
  const ctx = await sa.ready;
  document.documentElement.dataset.theme = ctx.theme;
  await sa.app.ready();
  let first = true;
  await watchAll(sa, (raw) => {
    const t0 = performance.now();
    model = buildModel(raw, localToday());
    loaded = true;
    $('main').dataset.loaded = 'true';
    $('main').dataset.entities = String(model.entities.size);
    if (first) void sa.sys.log('info', 'contacts.loaded', { entities: model.entities.size, people: model.personByEntity.size, ms: Math.round(performance.now() - t0) });
    // Don't yank the screen away from someone typing in a form; data refreshes on the next render.
    const editing = view.name === 'card' && view.mode;
    if (!editing && !graph) render(first);
    first = false;
  });
  sa.data.onSyncFailed((e) => {
    if (e.collection.startsWith('contacts_')) toast(`A change needs attention (${e.status}). Open the Sync centre in Supra to resolve it.`, 'error');
  });
}

model = buildModel({ entities: [], people: [], organizations: [], nodes: [], points: [], dates: [], interactions: [], edges: [], mentions: [], imports: [] }, localToday());
render(false);
main().catch((err: Error) => {
  $('main').replaceChildren(h('p', { class: 'c-error', role: 'alert', text: `Could not connect: ${err.message}` }));
});
