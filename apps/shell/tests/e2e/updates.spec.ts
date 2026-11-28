import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import type { Page } from '@playwright/test';
import { expect, signIn, test, type MockServer } from './fixtures.ts';

// ADR-009: subapps pulled from the server's `subapps` collection, verified on the phone, applied on
// the next start, rolled back when an update keeps crashing. The builtin Hello (1.1.0) is the base.
const BUILTIN = new URL('../../public/builtin/hello/1.1.0/', import.meta.url).pathname;
const hello = (page: Page) => page.frameLocator('iframe[data-app-id="hello"]');

function publish(server: MockServer, version: string, html: string, opts: { sha?: string } = {}): void {
  const manifest = { ...JSON.parse(readFileSync(`${BUILTIN}app.json`, 'utf8')), version };
  const zip = zipSync({ 'app.json': new TextEncoder().encode(JSON.stringify(manifest)), 'index.html': new TextEncoder().encode(html) });
  const id = `hello${version.replace(/\D/g, '')}`.padEnd(15, '0');
  const name = `hello_${id.slice(0, 6)}.zip`;
  server.ops.records.set(`subapps/${id}`, { id, appId: 'hello', version, sha256: opts.sha ?? createHash('sha256').update(zip).digest('hex'), bundle: name, channel: 'stable', updated: new Date().toISOString() } as never);
  server.files.set(`subapps/${id}/${name}`, Buffer.from(zip));
}
const builtinHtml = () => readFileSync(`${BUILTIN}index.html`, 'utf8');

async function checkForUpdates(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Check for updates' }).click();
}

test.describe('subapp updates by pull', () => {
  test.beforeEach(async ({ page, server }) => {
    void server;
    await signIn(page);
  });

  test('a newer published version is downloaded, verified and runs on the next start', async ({ page, server }) => {
    publish(server, '1.2.0', builtinHtml().replace('Hello from a subapp', 'Hello from a pulled update'));
    await checkForUpdates(page);
    await expect(page.getByText('Hello updated to 1.2.0.')).toBeVisible();
    await expect(page.getByTestId('settings-subapps').locator('[data-app-id="hello"]')).toContainText('1.2.0 · from server');
    await page.getByRole('button', { name: 'Back to launcher' }).click();
    await page.getByTestId('tile-hello').click();
    await expect(hello(page).getByRole('heading', { level: 1 })).toHaveText('Hello from a pulled update');
    await expect(hello(page).locator('#status[data-connected="true"]')).toBeVisible();
  });

  test('a bundle whose hash does not match is rejected and the builtin keeps running', async ({ page, server }) => {
    publish(server, '1.2.0', builtinHtml().replace('Hello from a subapp', 'TAMPERED'), { sha: 'a'.repeat(64) });
    await checkForUpdates(page);
    await expect(page.getByText(/Update rejected: hello 1\.2\.0 \(SHA-256 does not match/)).toBeVisible();
    await expect(page.getByTestId('settings-subapps').locator('[data-app-id="hello"]')).toContainText('1.1.0 · built in');
  });

  test('an update that crashes twice within 60 s is rolled back to the builtin version', async ({ page, server }) => {
    test.setTimeout(60_000);
    publish(server, '1.3.0', '<!doctype html><title>broken</title><p>never says hello</p>');
    await checkForUpdates(page);
    await expect(page.getByText('Hello updated to 1.3.0.')).toBeVisible();
    await page.getByRole('button', { name: 'Back to launcher' }).click();
    for (let i = 0; i < 2; i++) {
      await page.getByTestId('tile-hello').click();
      await expect(page.getByTestId('tile-hello')).toBeVisible({ timeout: 15_000 }); // handshake timeout → back on the launcher
    }
    await expect(page.getByText(/rolled back to the built-in version/)).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('tile-hello').click();
    await expect(hello(page).getByRole('heading', { level: 1 })).toHaveText('Hello from a subapp');
  });
});
