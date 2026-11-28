import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signIn, test, type MockServer } from './fixtures.ts';

// Contacts subapp (SA-2026-007 P2) inside the real shell, against the mocked server.
// Fictional records only (no real vault data in the repo).
const contacts = (page: Page) => page.frameLocator('iframe[data-app-id="contacts"]');
const id = (s: string) => s.padEnd(15, '0').slice(0, 15);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 864e5));

function seed(server: MockServer): void {
  let clock = 0;
  const put = (collection: string, rec: Record<string, unknown>) =>
    server.ops.records.set(`${collection}/${rec.id}`, { owner: 'user00000000001', deleted: false, version: 1, updated: new Date(1_690_000_000_000 + ++clock * 1000).toISOString(), ...rec } as never);
  put('contacts_entities', { id: id('ava'), kind: 'person', title: 'Ava Torres', body: 'Met at the expo.' });
  put('contacts_entities', { id: id('ben'), kind: 'person', title: 'Ben Okafor' });
  put('contacts_entities', { id: id('northwind'), kind: 'organization', title: 'Northwind Foods' });
  put('contacts_people', { id: id('pava'), entity: id('ava'), display_name: 'Ava Torres', job_title: 'Director of Ops', current_org: id('northwind'), cadence_days: 30, last_touch: daysAgo(40) });
  put('contacts_people', { id: id('pben'), entity: id('ben'), display_name: 'Ben Okafor', cadence_days: 90, last_touch: daysAgo(10) });
  put('contacts_organizations', { id: id('onw'), entity: id('northwind'), name: 'Northwind Foods', industry: 'Food' });
  put('contacts_contact_points', { id: id('cpava'), entity: id('ava'), channel: 'email', value: 'ava@northwind.example', value_norm: 'ava@northwind.example', is_primary: true, is_valid: true, source: 'vault' });
  put('contacts_edges', { id: id('g1'), source: id('ava'), target: id('northwind'), relation: 'works_at', origin: 'frontmatter' });
  put('contacts_edges', { id: id('g2'), source: id('ben'), target: id('northwind'), relation: 'worked_at', origin: 'frontmatter' });
}

async function openContacts(page: Page): Promise<void> {
  await page.getByTestId('tile-contacts').click();
  await expect(contacts(page).locator('#main[data-loaded="true"][data-entities="3"]')).toBeAttached({ timeout: 10_000 });
}

test.describe('Contacts subapp', () => {
  test.beforeEach(async ({ page, server }) => {
    seed(server);
    if (process.env.DEBUG_CONTACTS) page.on('console', (m) => console.log('CONSOLE', m.text()));
    await signIn(page);
  });

  test('the launcher shows the app under the new name', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: '~Supra~' })).toBeVisible();
    await expect(page.getByTestId('tile-contacts')).toContainText('Contacts');
  });

  test('Today lists who is overdue from the synced records', async ({ page }) => {
    await openContacts(page);
    const f = contacts(page);
    await expect(f.getByTestId('today-summary')).toHaveText('1 due this week (1 overdue)');
    await expect(f.getByTestId('due-list').getByRole('button')).toHaveCount(1);
    await expect(f.getByTestId('due-list')).toContainText('Ava Torres');
    await expect(f.getByTestId('due-list')).toContainText('Overdue 10d');
    await expect(f.getByTestId('precutover')).toBeVisible();
  });

  test('search finds people by org and opens a card with reach and relationships', async ({ page }) => {
    await openContacts(page);
    const f = contacts(page);
    await f.getByRole('button', { name: 'People' }).click();
    await f.getByLabel('Search').fill('northwind');
    await expect(f.getByTestId('search-results').getByRole('button')).toHaveCount(1);
    await f.getByTestId('search-results').getByRole('button', { name: /Ava Torres/ }).click();
    await expect(f.getByRole('heading', { level: 2, name: 'Ava Torres' })).toBeFocused();
    await expect(f.getByTestId('card-points')).toContainText('ava@northwind.example');
    await f.getByRole('button', { name: /^Northwind Foods/ }).click();
    await expect(f.getByRole('heading', { level: 2, name: 'Northwind Foods' })).toBeVisible();
    await expect(f.getByRole('button', { name: /Ben Okafor/ })).toBeVisible(); // former people (backlink)
    await f.getByRole('button', { name: '← Back' }).click();
    await expect(f.getByRole('heading', { level: 2, name: 'Ava Torres' })).toBeVisible();
  });

  test('logging a touch writes through the ops route and takes the person off Today', async ({ page, server }) => {
    await openContacts(page);
    const f = contacts(page);
    await f.getByTestId('due-list').getByRole('button', { name: /Ava Torres/ }).click();
    await f.getByRole('button', { name: 'Log a touch' }).click();
    await f.getByRole('button', { name: 'Call', exact: true }).click();
    await f.getByLabel('Note (optional)').fill('Caught up about Q1');
    await f.getByRole('button', { name: 'Save' }).click();
    await expect(f.getByTestId('card-timeline')).toContainText('Caught up about Q1');
    await expect.poll(() => server.ops.liveRecords('contacts_interactions').length, { timeout: 15_000 }).toBe(1);
    const today = iso(new Date());
    expect(server.ops.liveRecords('contacts_interactions')[0]).toMatchObject({ entity: id('ava'), kind: 'Call', occurred_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), source: 'contacts-app' });
    await expect.poll(() => server.ops.liveRecords('contacts_people').find((p) => p.id === id('pava'))?.version).toBe(2);
    expect(String(server.ops.liveRecords('contacts_people').find((p) => p.id === id('pava'))?.last_touch).slice(0, 7)).toBe(today.slice(0, 7));
    await f.getByRole('button', { name: 'Today' }).click();
    await expect(f.getByTestId('today-summary')).toHaveText('0 due this week (0 overdue)');
  });

  test('editing rejects a bad date and saves a valid cadence', async ({ page, server }) => {
    await openContacts(page);
    const f = contacts(page);
    await f.getByRole('button', { name: 'People' }).click();
    await f.getByTestId('search-results').getByRole('button', { name: /Ben Okafor/ }).click();
    await f.getByRole('button', { name: 'Edit' }).click();
    await f.getByLabel('Next touch (YYYY-MM-DD)').fill('2026-02-30');
    await f.getByRole('button', { name: 'Save' }).click();
    await expect(f.getByText('Use YYYY-MM-DD.')).toBeVisible();
    await f.getByLabel('Next touch (YYYY-MM-DD)').fill('');
    await f.getByLabel('Reach out every (days)').fill('14');
    await f.getByRole('button', { name: 'Save' }).click();
    await expect(f.getByTestId('card-details')).toContainText('every 14 days');
    await expect.poll(() => server.ops.liveRecords('contacts_people').find((p) => p.id === id('pben'))?.cadence_days, { timeout: 15_000 }).toBe(14);
  });

  test('the graph view renders the network and opens a card from a node', async ({ page }) => {
    await openContacts(page);
    const f = contacts(page);
    await f.getByRole('button', { name: 'Graph' }).click();
    await expect(f.locator('canvas#c')).toBeVisible();
    await expect(f.locator('#stats')).toContainText('3');
    await f.getByLabel('Search the graph').fill('ava');
    await f.locator('#res li').first().click();
    await f.getByRole('button', { name: 'Open card' }).click();
    await expect(f.getByRole('heading', { level: 2, name: 'Ava Torres' })).toBeVisible();
  });

  test('Contacts screens meet WCAG 2.1 AA (axe-core)', async ({ page }) => {
    await openContacts(page);
    const f = contacts(page);
    const scan = async () => {
      const r = await new AxeBuilder({ page }).include('iframe[data-app-id="contacts"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    };
    await scan();
    await f.getByRole('button', { name: 'People' }).click();
    await scan();
    await f.getByTestId('search-results').getByRole('button', { name: /Ava Torres/ }).click();
    await scan();
  });
});
