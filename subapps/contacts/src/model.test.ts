import { describe, expect, it } from 'vitest';
import { addDays, buildModel, dueList, emptyRaw, graphData, healthOf, linkGroups, nextScheduled, search, sharedContext, touchWrites, upcomingDates, validatePersonEdit, type Raw } from './model.ts';

// Fictional people and organisations only (Supra---Contacts AGENTS.md rule 5).
const id = (s: string) => s.padEnd(15, '0').slice(0, 15);
const E = { ava: id('ava'), ben: id('ben'), cy: id('cy'), dee: id('dee'), nw: id('northwind'), uni: id('lakeside'), mars: id('projmars'), ghost: id('ghostco') };

function fixture(): Raw {
  const raw = emptyRaw();
  raw.entities = [
    { id: E.ava, kind: 'person', title: 'Ava Torres', aliases: ['A. Torres'], body: 'Met at the expo.' },
    { id: E.ben, kind: 'person', title: 'Ben Okafor' },
    { id: E.cy, kind: 'person', title: 'Cy Lund' },
    { id: E.dee, kind: 'person', title: 'Dee Marsh' },
    { id: E.nw, kind: 'organization', title: 'Northwind Foods' },
    { id: E.uni, kind: 'organization', title: 'Lakeside University' },
    { id: E.mars, kind: 'project', title: 'Project MARS' },
    { id: E.ghost, kind: 'organization', title: 'Ghost Co', is_ghost: true },
  ];
  raw.people = [
    { id: id('p-ava'), entity: E.ava, display_name: 'Ava Torres', job_title: 'Director of Ops', current_org: E.nw, cadence_days: 30, last_touch: '2026-10-01' },
    { id: id('p-ben'), entity: E.ben, display_name: 'Ben Okafor', next_touch: '2026-11-28' },
    { id: id('p-cy'), entity: E.cy, display_name: 'Cy Lund', cadence_days: 14, last_touch: '2026-10-01' },
    { id: id('p-dee'), entity: E.dee, display_name: 'Dee Marsh', cadence_days: 90, last_touch: '2026-11-01' },
  ];
  raw.organizations = [{ id: id('o-nw'), entity: E.nw, name: 'Northwind Foods', industry: 'Food' }];
  raw.nodes = [{ id: id('n-mars'), entity: E.mars, node_type: 'project', org: E.nw }];
  raw.points = [
    { id: id('cp1'), entity: E.ava, channel: 'email', value: 'Ava@Northwind.example', value_norm: 'ava@northwind.example', is_primary: true, is_valid: true },
    { id: id('cp2'), entity: E.ava, channel: 'phone', value: '(555) 010-0101', value_norm: '+15550100101', is_valid: true },
  ];
  raw.dates = [
    { id: id('d1'), entity: E.ben, kind: 'birthday', year: 1990, month: 12, day: 5, recurring: true },
    { id: id('d2'), entity: E.cy, kind: 'birthday', month: 3, day: 14, recurring: true },
    { id: id('d3'), entity: E.mars, kind: 'meeting', label: 'Kick-off', year: 2026, month: 12, day: 1, recurring: false },
  ];
  // Cy's interaction log is newer than last_touch: the cadence counts from it.
  raw.interactions = [
    { id: id('i1'), entity: E.cy, occurred_on: '2026-11-20', kind: 'Call', summary: 'Caught up' },
    { id: id('i2'), entity: E.dee, occurred_on: '2026-11-27', kind: 'Created' },
  ];
  raw.edges = [
    { id: id('g1'), source: E.ava, target: E.nw, relation: 'works_at', origin: 'frontmatter' },
    { id: id('g2'), source: E.cy, target: E.nw, relation: 'worked_at', origin: 'frontmatter' },
    { id: id('g3'), source: E.ava, target: E.mars, relation: 'involved_in', origin: 'outline', section: 'Stakeholders' },
    { id: id('g4'), source: E.ben, target: E.mars, relation: 'involved_in', origin: 'outline', context_note: E.mars },
    { id: id('g5'), source: E.ava, target: E.uni, relation: 'alumnus_of', origin: 'frontmatter' },
    { id: id('g6'), source: E.ava, target: E.mars, relation: 'mentions', origin: 'body' },
  ];
  raw.mentions = [{ id: id('m1'), entity: E.mars, text: 'Pat Rivera', section: 'Vendors' }];
  return raw;
}

const TODAY = '2026-11-28';

describe('reach-out schedule', () => {
  const m = buildModel(fixture(), TODAY);

  it('uses next_touch first, else latest touch + cadence (interaction log included, Created ignored)', () => {
    expect(m.reach.get(E.ava)).toMatchObject({ due: '2026-10-31', days: -28, health: 'overdue', org: 'Northwind Foods' });
    expect(m.reach.get(E.ben)).toMatchObject({ due: '2026-11-28', days: 0, health: 'due' });
    expect(m.reach.get(E.cy)).toMatchObject({ lastTouch: '2026-11-20', due: '2026-12-04', days: 6, health: 'soon' });
    expect(m.reach.get(E.dee)).toMatchObject({ lastTouch: '2026-11-01', due: '2027-01-30', health: 'ok' });
  });

  it('Today lists overdue first, then due within a week; the empty state names the next person', () => {
    expect(dueList(m).map((r) => r.entity.title)).toEqual(['Ava Torres', 'Ben Okafor', 'Cy Lund']);
    expect(nextScheduled(m)?.entity.title).toBe('Dee Marsh');
  });

  it('health thresholds', () => {
    expect([healthOf(null), healthOf(-1), healthOf(0), healthOf(7), healthOf(8)]).toEqual(['none', 'overdue', 'due', 'soon', 'ok']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('dates', () => {
  it('rolls recurring dates to the next occurrence and keeps one-off dates on their day', () => {
    const d = upcomingDates(buildModel(fixture(), TODAY), 30);
    expect(d.map((x) => [x.title, x.on, x.years])).toEqual([
      ['Project MARS', '2026-12-01', null],
      ['Ben Okafor', '2026-12-05', 36],
    ]);
    const march = upcomingDates(buildModel(fixture(), '2027-03-01'), 30);
    expect(march.map((x) => x.title)).toEqual(['Cy Lund']);
  });
});

describe('search', () => {
  const m = buildModel(fixture(), TODAY);
  it('matches names, aliases, orgs, titles, emails and phones; every term must match', () => {
    expect(search(m, 'ava')[0]?.entity.title).toBe('Ava Torres');
    expect(search(m, 'torres director').map((h) => h.entity.title)).toEqual(['Ava Torres']);
    expect(search(m, 'northwind', { kinds: ['person'] }).map((h) => h.entity.title)).toEqual(['Ava Torres']);
    expect(search(m, '+1555010').map((h) => h.entity.title)).toEqual(['Ava Torres']);
    expect(search(m, 'ava@northwind').length).toBe(1);
    expect(search(m, 'zzz')).toEqual([]);
  });
  it('ranks title prefix matches above other matches and real notes above ghosts', () => {
    const titles = search(m, 'north').map((h) => h.entity.title);
    expect(titles[0]).toBe('Northwind Foods');
    expect(search(m, 'co', { kinds: ['organization'] }).at(-1)?.entity.title).toBe('Ghost Co');
  });
  it('is fast enough for NFR-2 on 5,000 people (< 100 ms)', () => {
    const raw = fixture();
    for (let i = 0; i < 5000; i++) {
      const eid = `x${String(i).padStart(14, '0')}`;
      raw.entities.push({ id: eid, kind: 'person', title: `Person ${i} Example` });
      raw.people.push({ id: `p${String(i).padStart(14, '0')}`, entity: eid, display_name: `Person ${i}`, current_org: E.nw });
    }
    const big = buildModel(raw, TODAY);
    const t0 = performance.now();
    search(big, 'person 4999');
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('card', () => {
  const m = buildModel(fixture(), TODAY);
  it('groups outgoing links and backlinks by relation', () => {
    const g = linkGroups(m, E.nw);
    expect(g.map((x) => [x.label, x.items.map((i) => i.entity.title)])).toEqual([
      ['People here', ['Ava Torres']],
      ['Former people', ['Cy Lund']],
    ]);
    const ava = linkGroups(m, E.ava).map((x) => x.label);
    expect(ava).toEqual(['Works at', 'Involved in', 'Alumnus of', 'Mentions']);
    const mars = linkGroups(m, E.mars).find((x) => x.label === 'Involved');
    expect(mars?.items.map((i) => i.entity.title)).toEqual(['Ava Torres', 'Ben Okafor']);
    expect(mars?.items[0]?.detail).toBe('Stakeholders');
  });
  it('finds shared background (warm intros)', () => {
    expect(sharedContext(m, E.ava).map((s) => [s.entity.title, s.via])).toEqual([
      ['Ben Okafor', ['Project MARS']],
      ['Cy Lund', ['Northwind Foods']],
    ]);
  });
});

describe('graph data', () => {
  it('has the shape of the desktop export: one link per pair with every relation, ghosts, unlinked names', () => {
    const g = graphData(buildModel(fixture(), TODAY));
    const idx = (t: string) => g.nodes.findIndex((n) => n.t === t);
    expect(g.nodes[0]?.t).toBe('Ava Torres'); // highest degree first
    const avaMars = g.links.find((l) => [l.s, l.t].sort().join() === [idx('Ava Torres'), idx('Project MARS')].sort().join());
    expect(avaMars).toMatchObject({ w: 2, r: 'involved_in,mentions' });
    expect(g.nodes.find((n) => n.t === 'Ghost Co')).toMatchObject({ g: 1, d: 0 });
    expect(g.nodes.find((n) => n.t === 'Pat Rivera')).toMatchObject({ k: 'mention', d: 1 });
    expect(g.nodes.find((n) => n.t === 'Ava Torres')).toMatchObject({ email: 'ava@northwind.example', phone: '+15550100101', org: 'Northwind Foods', due: '2026-10-31' });
    expect(graphData(buildModel(fixture(), TODAY), { contactInfo: false }).nodes.some((n) => n.email || n.phone)).toBe(false);
  });
});

describe('edits', () => {
  it('validates the edit form and builds a patch', () => {
    const ok = validatePersonEdit({ job_title: ' VP ', location: '', preferred_channel: 'email', cadence_days: '30', next_touch: '2026-12-01', how_met: '' });
    expect(ok).toEqual({ ok: true, patch: { job_title: 'VP', location: '', preferred_channel: 'email', cadence_days: 30, next_touch: '2026-12-01', how_met: '' } });
    const bad = validatePersonEdit({ job_title: '', location: '', preferred_channel: '', cadence_days: 'monthly', next_touch: '12/01/2026', how_met: '' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(['cadence_days', 'next_touch']);
    expect(validatePersonEdit({ job_title: '', location: '', preferred_channel: '', cadence_days: '', next_touch: '2026-02-30', how_met: '' }).ok).toBe(false);
  });
  it('logging a touch sets last_touch and clears a next_touch that has passed', () => {
    const p = fixture().people[1]!; // Ben, next_touch today
    const w = touchWrites(p, TODAY, 'Call', '  Talked about Q1  ');
    expect(w.interaction).toEqual({ entity: E.ben, occurred_on: TODAY, kind: 'Call', summary: 'Talked about Q1', source: 'contacts-app' });
    expect(w.personPatch).toEqual({ last_touch: TODAY, next_touch: '' });
    expect(touchWrites(fixture().people[0]!, TODAY, 'Email', '').personPatch).toEqual({ last_touch: TODAY });
  });
});
