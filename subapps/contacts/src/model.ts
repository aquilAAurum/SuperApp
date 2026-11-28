// Pure data model for the Contacts subapp: turns the synced contacts_* records (schema
// server/pb_migrations/1764201600_contacts.js) into what the screens show. No DOM, no SDK, so it is
// unit-tested in node (model.test.ts). Reach-out math matches the server view contacts_reach_out and
// the importer's v_reach_out_schedule: due = next_touch, else latest touch + cadence, where the latest
// touch is the newer of last_touch and the interaction log (excluding "Created" entries).

export const COLLECTIONS = {
  entities: 'contacts_entities',
  people: 'contacts_people',
  organizations: 'contacts_organizations',
  nodes: 'contacts_nodes',
  points: 'contacts_contact_points',
  dates: 'contacts_key_dates',
  interactions: 'contacts_interactions',
  edges: 'contacts_edges',
  mentions: 'contacts_mentions',
  imports: 'contacts_imports',
} as const;
export type CollectionKey = keyof typeof COLLECTIONS;

interface Base {
  id: string;
  version?: number;
}
export interface Entity extends Base {
  kind: string;
  title: string;
  is_ghost?: boolean;
  status?: string;
  seniority?: string;
  relationship?: string;
  aliases?: unknown;
  tags?: unknown;
  body?: string;
}
export interface Person extends Base {
  entity: string;
  display_name: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  current_org?: string;
  alma_mater?: string;
  location?: string;
  preferred_channel?: string;
  cadence_days?: number | null;
  last_touch?: string;
  next_touch?: string;
  how_met?: string;
  met_on?: string;
}
export interface Organization extends Base {
  entity: string;
  name: string;
  industry?: string;
  website?: string;
  domain?: string;
  hq_location?: string;
  relationship_tier?: string;
}
export interface NodeRec extends Base {
  entity: string;
  node_type: string;
  org?: string;
  start_date?: string;
  end_date?: string;
  occurred_on?: string;
  description?: string;
}
export interface ContactPoint extends Base {
  entity: string;
  channel: string;
  value: string;
  value_norm: string;
  label?: string;
  is_primary?: boolean;
  is_valid?: boolean;
}
export interface KeyDate extends Base {
  entity: string;
  kind: string;
  label?: string;
  year?: number | null;
  month: number;
  day: number;
  recurring?: boolean;
}
export interface Interaction extends Base {
  entity: string;
  occurred_on: string;
  kind?: string;
  summary?: string;
  source?: string;
}
export interface Edge extends Base {
  source: string;
  target: string;
  relation: string;
  origin?: string;
  field?: string;
  section?: string;
  context_note?: string;
  context?: string;
}
export interface Mention extends Base {
  entity: string;
  parent?: string;
  text: string;
  section?: string;
}
export interface ImportRun extends Base {
  status: string;
  newest_note?: string;
}

export interface Raw {
  entities: Entity[];
  people: Person[];
  organizations: Organization[];
  nodes: NodeRec[];
  points: ContactPoint[];
  dates: KeyDate[];
  interactions: Interaction[];
  edges: Edge[];
  mentions: Mention[];
  imports: ImportRun[];
}

export const emptyRaw = (): Raw => ({ entities: [], people: [], organizations: [], nodes: [], points: [], dates: [], interactions: [], edges: [], mentions: [], imports: [] });

export type Health = 'overdue' | 'due' | 'soon' | 'ok' | 'none';

export interface ReachOut {
  person: Person;
  entity: Entity;
  org: string | null;
  lastTouch: string | null;
  due: string | null;
  /** Days until due (negative = overdue), null without a schedule. */
  days: number | null;
  health: Health;
}

export interface Model {
  entities: Map<string, Entity>;
  personByEntity: Map<string, Person>;
  orgByEntity: Map<string, Organization>;
  nodeByEntity: Map<string, NodeRec>;
  points: Map<string, ContactPoint[]>;
  dates: Map<string, KeyDate[]>;
  interactions: Map<string, Interaction[]>;
  out: Map<string, Edge[]>;
  in: Map<string, Edge[]>;
  mentions: Mention[];
  reach: Map<string, ReachOut>;
  cutover: boolean;
  today: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; // rejects 2026-02-30
};

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}
/** Local calendar date (the phone's day, not UTC). */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function group<T>(items: T[], key: (t: T) => string | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function healthOf(days: number | null): Health {
  if (days === null) return 'none';
  if (days < 0) return 'overdue';
  if (days === 0) return 'due';
  if (days <= 7) return 'soon';
  return 'ok';
}

export function buildModel(raw: Raw, today: string): Model {
  const entities = new Map(raw.entities.map((e) => [e.id, e]));
  const interactions = group(raw.interactions, (i) => i.entity);
  for (const list of interactions.values()) list.sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0));
  const m: Model = {
    entities,
    personByEntity: new Map(raw.people.map((p) => [p.entity, p])),
    orgByEntity: new Map(raw.organizations.map((o) => [o.entity, o])),
    nodeByEntity: new Map(raw.nodes.map((n) => [n.entity, n])),
    points: group(raw.points, (p) => p.entity),
    dates: group(raw.dates, (d) => d.entity),
    interactions,
    out: group(raw.edges, (e) => e.source),
    in: group(raw.edges, (e) => e.target),
    mentions: raw.mentions,
    reach: new Map(),
    cutover: raw.imports.some((i) => i.status === 'cutover'),
    today,
  };
  for (const p of raw.people) {
    const entity = entities.get(p.entity);
    if (!entity) continue;
    m.reach.set(p.entity, reachOut(m, p, entity));
  }
  return m;
}

function reachOut(m: Model, person: Person, entity: Entity): ReachOut {
  const logged = (m.interactions.get(person.entity) ?? []).find((i) => i.kind !== 'Created' && isDate(i.occurred_on))?.occurred_on ?? null;
  const own = isDate(person.last_touch) ? person.last_touch : null;
  const lastTouch = own && logged ? (own > logged ? own : logged) : (own ?? logged);
  const cadence = typeof person.cadence_days === 'number' && person.cadence_days > 0 ? person.cadence_days : null;
  const due = isDate(person.next_touch) ? person.next_touch : lastTouch && cadence ? addDays(lastTouch, cadence) : null;
  const days = due ? daysBetween(m.today, due) : null;
  const org = person.current_org ? (m.entities.get(person.current_org)?.title ?? null) : null;
  return { person, entity, org, lastTouch, due, days, health: healthOf(days) };
}

/** Today screen: overdue and due within `horizon` days, most overdue first. */
export function dueList(m: Model, horizon = 7): ReachOut[] {
  return [...m.reach.values()]
    .filter((r) => r.days !== null && r.days <= horizon && !r.entity.is_ghost)
    .sort((a, b) => a.days! - b.days! || a.person.display_name.localeCompare(b.person.display_name));
}

/** The next scheduled person after the due window (for the empty state). */
export function nextScheduled(m: Model, horizon = 7): ReachOut | null {
  return [...m.reach.values()].filter((r) => r.days !== null && r.days > horizon).sort((a, b) => a.days! - b.days!)[0] ?? null;
}

export interface UpcomingDate {
  entityId: string;
  title: string;
  label: string;
  on: string;
  days: number;
  years: number | null;
}

/** Birthdays, anniversaries and other dates in the next `days` days (recurring dates roll to their next occurrence). */
export function upcomingDates(m: Model, days = 30): UpcomingDate[] {
  const out: UpcomingDate[] = [];
  const year = Number(m.today.slice(0, 4));
  for (const [entityId, list] of m.dates) {
    const e = m.entities.get(entityId);
    if (!e) continue;
    for (const d of list) {
      if (d.kind === 'last_touch' || d.kind === 'created') continue; // shown elsewhere (reach-out), as in the importer's upcoming list
      const md = `${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      let on: string | null = null;
      if (d.recurring) {
        for (const y of [year, year + 1]) {
          const c = `${y}-${md}`;
          if (isDate(c) && c >= m.today) {
            on = c;
            break;
          }
        }
      } else if (d.year) on = `${d.year}-${md}`;
      if (!on || !isDate(on)) continue;
      const n = daysBetween(m.today, on);
      if (n < 0 || n > days) continue;
      const label = d.label || d.kind.replace(/_/g, ' ');
      out.push({ entityId, title: e.title, label, on, days: n, years: d.year && d.recurring ? Number(on.slice(0, 4)) - d.year : null });
    }
  }
  return out.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title));
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);

export interface Hit {
  entity: Entity;
  subtitle: string;
  score: number;
}

/** Subtitle line for a row: job · org for people, industry for orgs, type for nodes. */
export function subtitle(m: Model, e: Entity): string {
  const p = m.personByEntity.get(e.id);
  if (p) return [p.job_title, p.current_org ? m.entities.get(p.current_org)?.title : null].filter(Boolean).join(' · ');
  const o = m.orgByEntity.get(e.id);
  if (o) return [o.industry, o.hq_location].filter(Boolean).join(' · ') || 'Organization';
  const n = m.nodeByEntity.get(e.id);
  if (n) return [n.node_type, n.org ? m.entities.get(n.org)?.title : null].filter(Boolean).join(' · ');
  return e.is_ghost ? `${e.kind} · no note yet` : e.kind;
}

/**
 * Local search over names, aliases, job titles, organisations, emails and phone numbers. Every
 * whitespace-separated term must match somewhere; title prefix matches rank first. Ghost entities
 * (linked but never written) are included last so they can still be found.
 */
export function search(m: Model, query: string, opts: { kinds?: string[]; limit?: number } = {}): Hit[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const limit = opts.limit ?? 50;
  const hits: Hit[] = [];
  for (const e of m.entities.values()) {
    if (opts.kinds && !opts.kinds.includes(e.kind)) continue;
    const title = fold(e.title);
    const sub = subtitle(m, e);
    const p = m.personByEntity.get(e.id);
    const hay = [title, ...asStrings(e.aliases).map(fold), fold(sub), ...(m.points.get(e.id) ?? []).map((c) => fold(c.value_norm)), p?.location ? fold(p.location) : ''].join('\n');
    if (!terms.every((t) => hay.includes(t))) continue;
    let score = 0;
    if (terms.length && title.startsWith(terms[0]!)) score += 4;
    else if (terms.length && title.split(/\s+/).some((w) => w.startsWith(terms[0]!))) score += 2;
    if (!e.is_ghost) score += 1;
    if (e.kind === 'person') score += 0.5;
    hits.push({ entity: e, subtitle: sub, score });
  }
  hits.sort((a, b) => b.score - a.score || a.entity.title.localeCompare(b.entity.title));
  return terms.length ? hits.slice(0, limit) : hits.sort((a, b) => a.entity.title.localeCompare(b.entity.title)).slice(0, limit);
}

export const RELATION_LABEL: Record<string, string> = {
  works_at: 'Works at',
  worked_at: 'Worked at',
  involved_in: 'Involved in',
  alumnus_of: 'Alumnus of',
  knows: 'Knows',
  reports_to: 'Reports to',
  key_contact: 'Key contact',
  primary_contact: 'Primary contact',
  related_to: 'Related to',
  subsidiary_of: 'Part of',
  member_of: 'Member of',
  listed_under: 'Listed under',
  mentions: 'Mentions',
};
const INVERSE_LABEL: Record<string, string> = {
  works_at: 'People here',
  worked_at: 'Former people',
  involved_in: 'Involved',
  alumnus_of: 'Alumni',
  knows: 'Known by',
  reports_to: 'Reports',
  key_contact: 'Key contact for',
  primary_contact: 'Primary contact for',
  related_to: 'Related',
  subsidiary_of: 'Units',
  member_of: 'Members',
  listed_under: 'Listed here',
  mentions: 'Mentioned in',
};

export interface LinkGroup {
  label: string;
  items: { entity: Entity; detail: string }[];
}

/** Relationships for a card: outgoing edges by relation, then backlinks (incoming) by relation. */
export function linkGroups(m: Model, entityId: string): LinkGroup[] {
  const groups = new Map<string, Map<string, { entity: Entity; detail: string }>>();
  const add = (label: string, otherId: string, e: Edge) => {
    const other = m.entities.get(otherId);
    if (!other || otherId === entityId) return;
    let g = groups.get(label);
    if (!g) groups.set(label, (g = new Map()));
    if (g.has(otherId)) return;
    const via = e.context_note && e.context_note !== otherId ? m.entities.get(e.context_note)?.title : null;
    g.set(otherId, { entity: other, detail: [e.section, via ? `via ${via}` : null].filter(Boolean).join(' · ') });
  };
  for (const e of m.out.get(entityId) ?? []) add(RELATION_LABEL[e.relation] ?? e.relation.replace(/_/g, ' '), e.target, e);
  for (const e of m.in.get(entityId) ?? []) add(INVERSE_LABEL[e.relation] ?? `${e.relation.replace(/_/g, ' ')} (from)`, e.source, e);
  return [...groups.entries()].map(([label, items]) => ({ label, items: [...items.values()].sort((a, b) => a.entity.title.localeCompare(b.entity.title)) }));
}

/** People who share an organisation, role, project, event or group with this person (warm intros). */
export function sharedContext(m: Model, personId: string, limit = 20): { entity: Entity; via: string[] }[] {
  const viaOf = (id: string): Set<string> => {
    const s = new Set<string>();
    for (const e of [...(m.out.get(id) ?? []), ...(m.in.get(id) ?? [])]) {
      const other = e.source === id ? e.target : e.source;
      const k = m.entities.get(other)?.kind;
      if (k && k !== 'person') s.add(other);
      if (e.context_note) s.add(e.context_note);
    }
    s.delete(id);
    return s;
  };
  const mine = viaOf(personId);
  const found = new Map<string, Set<string>>();
  for (const via of mine) {
    for (const e of [...(m.out.get(via) ?? []), ...(m.in.get(via) ?? [])]) {
      const other = e.source === via ? e.target : e.source;
      if (other === personId || m.entities.get(other)?.kind !== 'person') continue;
      let s = found.get(other);
      if (!s) found.set(other, (s = new Set()));
      s.add(via);
    }
  }
  return [...found.entries()]
    .map(([id, via]) => ({ entity: m.entities.get(id)!, via: [...via].map((v) => m.entities.get(v)?.title ?? v).sort() }))
    .sort((a, b) => b.via.length - a.via.length || a.entity.title.localeCompare(b.entity.title))
    .slice(0, limit);
}

// ------------------------------------------------------------------ graph (same shape as Supra---Contacts src/graph.ts)
export interface GraphNode {
  id: string;
  t: string;
  k: string;
  g: 0 | 1;
  d: number;
  sen?: string;
  rel?: string;
  org?: string;
  job?: string;
  email?: string;
  phone?: string;
  due?: string;
}
export interface GraphLink {
  s: number;
  t: number;
  w: number;
  r: string;
}
export interface GraphData {
  generated: string;
  nodes: GraphNode[];
  links: GraphLink[];
}

function primaryPoint(m: Model, entityId: string, channels: string[]): string | undefined {
  const list = (m.points.get(entityId) ?? []).filter((c) => channels.includes(c.channel) && c.is_valid !== false);
  list.sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));
  return list[0]?.value_norm;
}
const mentionKey = (s: string) => fold(s).replace(/\s+/g, ' ').trim();

export function graphData(m: Model, opts: { contactInfo?: boolean } = {}): GraphData {
  const contactInfo = opts.contactInfo ?? true;
  const degree = new Map<string, Set<string>>();
  const pairs = new Map<string, { a: string; b: string; w: number; r: Set<string> }>();
  for (const list of m.out.values()) {
    for (const e of list) {
      if (e.source === e.target || !m.entities.has(e.source) || !m.entities.has(e.target)) continue;
      const [a, b] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
      const k = `${a}|${b}`;
      const p = pairs.get(k);
      if (p) {
        p.w++;
        p.r.add(e.relation);
      } else pairs.set(k, { a, b, w: 1, r: new Set([e.relation]) });
      for (const [x, y] of [[e.source, e.target], [e.target, e.source]] as const) {
        let s = degree.get(x);
        if (!s) degree.set(x, (s = new Set()));
        s.add(y);
      }
    }
  }
  const ents = [...m.entities.values()].map((e) => ({ e, d: degree.get(e.id)?.size ?? 0 }));
  ents.sort((x, y) => y.d - x.d || x.e.title.localeCompare(y.e.title));
  const nodes: GraphNode[] = [];
  const index = new Map<string, number>();
  for (const { e, d } of ents) {
    const n: GraphNode = { id: e.id, t: e.title, k: e.kind, g: e.is_ghost ? 1 : 0, d };
    if (e.seniority) n.sen = e.seniority;
    if (e.relationship) n.rel = e.relationship;
    const r = m.reach.get(e.id);
    if (r) {
      if (r.org) n.org = r.org;
      if (r.person.job_title) n.job = r.person.job_title;
      if (r.due) n.due = r.due;
      if (contactInfo) {
        const email = primaryPoint(m, e.id, ['email']);
        const phone = primaryPoint(m, e.id, ['phone', 'google_voice', 'whatsapp']);
        if (email) n.email = email;
        if (phone) n.phone = phone;
      }
    }
    index.set(e.id, nodes.length);
    nodes.push(n);
  }
  const links: GraphLink[] = [];
  const byPair = new Map<string, GraphLink>();
  const link = (s: number, t: number, w: number, rels: string[]) => {
    if (s === t) return;
    const [lo, hi] = s < t ? [s, t] : [t, s];
    const k = `${lo}|${hi}`;
    const cur = byPair.get(k);
    if (cur) {
      cur.w += w;
      cur.r = [...new Set([...cur.r.split(','), ...rels])].join(',');
      return;
    }
    const l = { s: lo, t: hi, w, r: rels.join(',') };
    byPair.set(k, l);
    links.push(l);
  };
  for (const p of pairs.values()) link(index.get(p.a)!, index.get(p.b)!, p.w, [...p.r].sort());

  // Unlinked names as lightweight nodes, as in the desktop export (hidden in the viewer until enabled).
  const byTitle = new Map([...m.entities.values()].map((e) => [mentionKey(e.title), e.id]));
  const mentionDeg = new Map<number, number>();
  for (const mn of [...m.mentions].sort((a, b) => a.entity.localeCompare(b.entity) || a.text.localeCompare(b.text))) {
    const host = index.get(mn.parent ?? mn.entity) ?? index.get(mn.entity);
    if (host === undefined) continue;
    const key = mentionKey(mn.text);
    let at = index.get(byTitle.get(key) ?? '');
    if (at === undefined) {
      const id = `m:${key.includes(' ') ? key : `${key}@${mn.entity}`}`;
      at = index.get(id);
      if (at === undefined) {
        at = nodes.length;
        index.set(id, at);
        nodes.push({ id, t: mn.text, k: 'mention', g: 0, d: 0 });
      }
    }
    link(at, host, 1, [mn.parent ? 'listed_under' : 'mentions']);
    const note = index.get(mn.entity);
    if (mn.parent && note !== undefined && note !== host) link(note, at, 1, ['mentions']);
  }
  for (const l of links) for (const i of [l.s, l.t]) if (nodes[i]!.k === 'mention') mentionDeg.set(i, (mentionDeg.get(i) ?? 0) + 1);
  for (const [i, d] of mentionDeg) nodes[i]!.d = d;
  return { generated: new Date().toISOString(), nodes, links };
}

// ------------------------------------------------------------------ edits (validated before they reach data.*)
export interface PersonEdit {
  job_title: string;
  location: string;
  preferred_channel: string;
  cadence_days: string;
  next_touch: string;
  how_met: string;
}

export function validatePersonEdit(input: PersonEdit): { ok: true; patch: Record<string, unknown> } | { ok: false; errors: Partial<Record<keyof PersonEdit, string>> } {
  const errors: Partial<Record<keyof PersonEdit, string>> = {};
  const patch: Record<string, unknown> = {};
  const text = (k: 'job_title' | 'location' | 'preferred_channel' | 'how_met', max: number) => {
    const v = input[k].trim();
    if (v.length > max) errors[k] = `At most ${max} characters.`;
    patch[k] = v;
  };
  text('job_title', 200);
  text('location', 200);
  text('preferred_channel', 50);
  text('how_met', 1000);
  const cad = input.cadence_days.trim();
  if (cad === '') patch.cadence_days = 0;
  else if (!/^\d{1,4}$/.test(cad)) errors.cadence_days = 'Whole days, for example 30.';
  else patch.cadence_days = Number(cad);
  const next = input.next_touch.trim();
  if (next !== '' && !isDate(next)) errors.next_touch = 'Use YYYY-MM-DD.';
  patch.next_touch = next;
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, patch };
}

export const TOUCH_KINDS = ['Call', 'Message', 'Email', 'Meeting', 'Note'] as const;

/** Records for "log a touch": an interaction plus the person's last_touch (and a next_touch that has passed is cleared so the cadence takes over). */
export function touchWrites(person: Person, today: string, kind: string, summary: string): { interaction: Record<string, unknown>; personPatch: Record<string, unknown> } {
  const personPatch: Record<string, unknown> = { last_touch: today };
  if (isDate(person.next_touch) && person.next_touch <= today) personPatch.next_touch = '';
  return {
    interaction: { entity: person.entity, occurred_on: today, kind, summary: summary.trim().slice(0, 5000), source: 'contacts-app' },
    personPatch,
  };
}
