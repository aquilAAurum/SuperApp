import AxeBuilder from '@axe-core/playwright';
import { expect, signIn, test, type MockServer } from './fixtures.ts';

const DAY = '2026-11-28';
const rid = (n: number) => `today${String(n).padStart(10, '0')}`;

function seed(server: MockServer) {
  const create = (n: number, collection: string, payload: Record<string, unknown>) =>
    server.ops.apply({ opId: `seed-op-${n}-xxxx`, collection, recordId: rid(n), op: 'create', payload });
  create(1, 'core_agenda', { kind: 'event', title: 'Standup', start: `${DAY}T09:00`, end: `${DAY}T09:30`, source_app: 'shell', status: 'open' });
  create(2, 'core_agenda', { kind: 'event', title: 'Lunch with Sam', start: `${DAY}T12:30`, end: `${DAY}T13:30`, source_app: 'shell', status: 'open' });
  create(3, 'core_agenda', { kind: 'date', title: 'Birthday: Ada Lovelace (35)', start: DAY, all_day: true, source_app: 'contacts', deep_link: 'superapp://contacts/person/p1', status: 'open' });
  create(4, 'core_agenda', { kind: 'task', title: 'Reach out to Ben Okafor', start: '2026-11-25', all_day: true, source_app: 'contacts', person: 'person000000001', deep_link: 'superapp://contacts/person/person000000001', status: 'open', priority: 1 });
  create(5, 'core_glances', { app_id: 'eatwell', key: 'intake', date: DAY, title: 'Eaten today', value: 1240, unit: 'kcal', target: 2000, detail: '1.2 L water', deep_link: 'superapp://eatwell/' });
}

test.describe('Today home (SA-2026-009)', () => {
  test.beforeEach(async ({ page, server }) => {
    await page.clock.setFixedTime(new Date(2026, 10, 28, 10, 2));
    seed(server);
    await signIn(page);
    await expect(page.getByTestId('timeline')).toContainText('Lunch with Sam');
  });

  test('brings agenda, people, dates and glances from every app into one day', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: '~Supra~' })).toBeVisible();
    await expect(page.getByText('Good morning')).toBeVisible();
    const now = page.getByTestId('now-card');
    await expect(now).toContainText('Free time');
    await expect(now).toContainText('2 h 25 min until 12:30');
    await expect(now).toContainText('Next: Lunch with Sam at 12:30');
    await expect(page.getByRole('list', { name: 'All day' })).toContainText('Birthday: Ada Lovelace (35)');
    await expect(page.getByRole('button', { name: /Reach out to Ben Okafor\s*, 3 days overdue/ })).toBeVisible();
    const timeline = page.getByTestId('timeline');
    await expect(timeline).toContainText('Standup');
    await expect(timeline).toContainText('Free · 2 h 28 min');
    await expect(page.getByRole('listitem', { name: 'Now, 10:02' })).toBeVisible();
    await expect(page.getByText('Eaten today')).toBeVisible();
    const glance = page.getByTestId('glance-eatwell-intake');
    await expect(glance).toContainText('1240');
    await expect(glance).toContainText('/ 2000');
    await expect(glance).toContainText('1.2 L water');
  });

  test('protects free time as a focus block that syncs to the server', async ({ page, server }) => {
    await page.getByTestId('start-focus').click();
    await expect(page.getByTestId('now-card')).toContainText('Now');
    await expect(page.getByTestId('now-card')).toContainText('Focus');
    await expect.poll(() => server.ops.liveRecords('core_agenda').find((r) => r.kind === 'focus')).toMatchObject({ start: `${DAY}T10:05`, end: `${DAY}T12:30`, source_app: 'shell' });
  });

  test('quick add puts an item on the day and the week', async ({ page, server }) => {
    await page.getByTestId('add-button').click();
    const sheet = page.getByTestId('quick-add');
    await sheet.getByLabel('What').fill('Dentist');
    await sheet.getByLabel('Time').fill('15:30');
    await sheet.getByLabel('Length').selectOption('45');
    await sheet.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('timeline')).toContainText('Dentist');
    await expect(page.getByTestId('timeline')).toContainText('15:30–16:15');
    await expect.poll(() => server.ops.liveRecords('core_agenda').find((r) => r.title === 'Dentist')).toMatchObject({ kind: 'event', source_app: 'shell' });

    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page.getByTestId('week-items').filter({ hasText: 'Dentist' })).toBeVisible();
    await page.getByRole('button', { name: /Sunday.*show this day/ }).click();
    await expect(page.getByTestId('now-card')).toContainText('items');
    await expect(page.getByRole('button', { name: /^29/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a task added by you can be checked off', async ({ page }) => {
    await page.getByTestId('add-button').click();
    const sheet = page.getByTestId('quick-add');
    await sheet.getByLabel('What').fill('Pay rent');
    await sheet.getByLabel('Task').check();
    await sheet.getByLabel('Time (optional)').fill('17:00');
    await sheet.getByRole('button', { name: 'Add', exact: true }).click();
    const done = page.getByRole('checkbox', { name: 'Done: Pay rent' });
    await done.check();
    await expect(page.locator('li.item.done')).toContainText('Pay rent');
  });

  test('Today, Week and quick add meet WCAG 2.1 AA (axe-core)', async ({ page }) => {
    const scan = async () =>
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('iframe').analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(await scan()).toEqual([]);
    await page.getByTestId('add-button').click();
    expect(await scan()).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    expect(await scan()).toEqual([]);
  });
});
