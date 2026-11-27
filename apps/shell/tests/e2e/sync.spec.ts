import type { Page } from '@playwright/test';
import { SERVER, expect, signIn, test } from './fixtures.ts';

const hello = (page: Page) => page.frameLocator('iframe[data-app-id="hello"]');

async function openHello(page: Page) {
  await page.getByTestId('tile-hello').click();
  await expect(hello(page).locator('#status[data-connected="true"]')).toBeVisible();
}

async function toSyncCentre(page: Page) {
  if (await page.getByRole('button', { name: 'Back to launcher' }).isVisible()) await page.getByRole('button', { name: 'Back to launcher' }).click();
  await page.getByRole('button', { name: 'Sync centre', exact: true }).click();
}

test.describe('M3 acceptance', () => {
  test.beforeEach(async ({ page, server }) => {
    void server;
    await signIn(page);
  });

  test('100 writes made in airplane mode all reach the server after reconnect, with no duplicates', async ({ page, server }) => {
    await openHello(page);
    server.offline = true;
    await hello(page).getByRole('button', { name: 'Write 100 notes' }).click();
    await expect(hello(page).getByTestId('result-bulk')).toBeVisible();
    await expect(hello(page).getByTestId('notes-count')).toHaveText('100');
    expect(server.ops.liveRecords('hello_notes')).toHaveLength(0);

    await toSyncCentre(page);
    await expect(page.getByTestId('sync-outbox-count')).toHaveText('100');
    await expect(page.getByTestId('sync-centre-state')).toHaveText('Offline');

    server.offline = false;
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByTestId('sync-outbox-count')).toHaveText('0', { timeout: 20_000 });
    await expect(page.getByTestId('sync-centre-state')).toHaveText('Synced');
    const live = server.ops.liveRecords('hello_notes');
    expect(live).toHaveLength(100);
    expect(new Set(live.map((r) => r.id)).size).toBe(100);
  });

  test('killing the app mid-sync loses nothing and duplicates nothing', async ({ page, server }) => {
    await openHello(page);
    server.offline = true;
    await hello(page).getByRole('button', { name: 'Write 100 notes' }).click();
    await expect(hello(page).getByTestId('result-bulk')).toBeVisible();

    // Slow server: each op is applied, then answered 150 ms later. Kill the shell mid-way.
    server.opsDelayMs = 150;
    server.offline = false;
    await toSyncCentre(page);
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect.poll(() => server.ops.liveRecords('hello_notes').length, { timeout: 15_000 }).toBeGreaterThan(4);
    expect(server.ops.liveRecords('hello_notes').length).toBeLessThan(100);
    await page.reload();

    // Relaunch: sign in again (web builds keep the token in memory only); the outbox survived on disk.
    server.opsDelayMs = 0;
    await page.getByLabel('Server URL').fill(SERVER);
    await page.getByLabel('Email').fill('nick@example.test');
    await page.getByLabel('Password').fill('correct-horse');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('button', { name: 'Sync centre', exact: true }).click();
    await expect(page.getByTestId('sync-outbox-count')).toHaveText('0', { timeout: 20_000 });
    const live = server.ops.liveRecords('hello_notes');
    expect(live).toHaveLength(100);
    expect(new Set(live.map((r) => r.text)).size).toBe(100);
    expect([...server.ops.processed.values()].filter((p) => p.status === 200)).toHaveLength(100);
  });

  test('a forced version conflict appears in Needs attention and can be resolved', async ({ page, server }) => {
    await openHello(page);
    await hello(page).getByLabel('New note').fill('Original');
    await hello(page).getByRole('button', { name: 'Add note' }).click();
    await expect.poll(() => server.ops.liveRecords('hello_notes').length).toBe(1);
    const id = server.ops.liveRecords('hello_notes')[0]!.id;

    server.ops.editOnServer('hello_notes', id, { text: 'Changed on another device' });
    await hello(page).getByRole('button', { name: 'Edit first note' }).click();
    await expect(hello(page).getByTestId('sync-failed')).toContainText('needs attention');

    await page.getByRole('button', { name: 'Back to launcher' }).click();
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'Error');
    await page.getByRole('button', { name: 'Sync centre', exact: true }).click();
    const item = page.getByTestId(`attention-${id}`);
    await expect(item).toHaveAttribute('data-status', 'conflict');
    await expect(item).toContainText('Conflict');
    await item.getByRole('button', { name: 'Keep server version' }).click();
    await expect(page.getByTestId('needs-attention')).toHaveCount(0);
    await expect(page.getByTestId('sync-centre-state')).toHaveText('Synced');
    expect(server.ops.records.get(`hello_notes/${id}`)).toMatchObject({ text: 'Changed on another device', version: 2 });
  });

  test('Sync centre meets WCAG 2.1 AA (axe-core)', async ({ page }) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    await page.getByRole('button', { name: 'Sync centre', exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
