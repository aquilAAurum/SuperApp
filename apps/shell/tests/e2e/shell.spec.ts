import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { SERVER, expect, signIn, test } from './fixtures.ts';

const helloFrame = (page: Page) => page.frameLocator('iframe[data-app-id="hello"]');

async function openHello(page: Page) {
  await page.getByTestId('tile-hello').click();
  await expect(helloFrame(page).locator('#status[data-connected="true"]')).toBeVisible();
}

async function openDiagnostics(page: Page) {
  await page.getByRole('button', { name: 'Back to launcher' }).click();
  await page.getByRole('button', { name: 'Diagnostics' }).click();
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('iframe').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe('first run', () => {
  test('refuses plain HTTP to a public host and wrong passwords', async ({ page, server }) => {
    await page.goto('/');
    await page.getByLabel('Server URL').fill('http://example.com');
    await page.getByLabel('Email').fill('nick@example.test');
    await page.getByLabel('Password').fill('correct-horse');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByTestId('setup-error')).toContainText('Plain HTTP');

    await page.getByLabel('Server URL').fill(SERVER);
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByTestId('setup-error')).toContainText('incorrect');
    expect(server.devicesCreated).toHaveLength(0);
  });

  test('signs in once and registers this device in core_devices', async ({ page, server }) => {
    await signIn(page);
    expect(server.devicesCreated).toHaveLength(1);
    expect(server.devicesCreated[0]).toMatchObject({ kind: 'phone', formFactor: 'phone', owner: 'user00000000001' });
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'Synced');
  });
});

test.describe('M2 acceptance', () => {
  test.beforeEach(async ({ page, server }) => {
    void server;
    await signIn(page);
  });

  test('hello launches and completes the handshake in under 500 ms', async ({ page }) => {
    await openHello(page);
    await expect(helloFrame(page).getByText('Granted scopes')).toBeVisible();
    await openDiagnostics(page);
    const cell = page.getByTestId('diag-handshake-hello');
    await expect(cell).not.toHaveAttribute('data-ms', '');
    const ms = Number(await cell.getAttribute('data-ms'));
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(500);
  });

  test('a forged hello from another frame is rejected and logged', async ({ page }) => {
    await openHello(page);
    // An attacker frame the shell did not create claims to be "hello".
    await page.evaluate(() => {
      const f = document.createElement('iframe');
      f.name = 'attacker';
      document.body.append(f);
    });
    const attacker = page.frame({ name: 'attacker' })!;
    await attacker.evaluate(() => {
      (window as unknown as { __welcomed: boolean }).__welcomed = false;
      window.addEventListener('message', (e) => {
        if (e.origin !== window.location.origin) return;
        if ((e.data as { type?: string })?.type === 'welcome') (window as unknown as { __welcomed: boolean }).__welcomed = true;
      });
      window.parent.postMessage({ type: 'hello', appId: 'hello', sdkVersion: '1.0.0' }, '*');
    });
    // The real hello frame also tries a second handshake on window.postMessage.
    const helloInner = page.frames().find((f) => f.parentFrame() === page.mainFrame() && f.name() !== 'attacker')!;
    await helloInner.evaluate(() => window.parent.postMessage({ type: 'hello', appId: 'hello', sdkVersion: '1.0.0' }, '*'));

    await openDiagnostics(page);
    const log = page.getByTestId('error-log');
    await expect(log).toContainText('forged frame');
    await expect(log).toContainText('Handshake already complete');
    expect(await attacker.evaluate(() => (window as unknown as { __welcomed: boolean }).__welcomed)).toBe(false);
    await expect(page.getByTestId('diag-sessions')).toHaveText('1');
  });

  test('the subapp cannot reach the network, the shell DOM, storage or cookies', async ({ page }) => {
    await openHello(page);
    await helloFrame(page).getByRole('button', { name: 'Run isolation check' }).click();
    for (const probe of ['network', 'parent-dom', 'storage', 'cookies']) {
      await expect(helloFrame(page).getByTestId(`isolation-${probe}`)).toContainText('blocked');
    }
  });

  test('app and sys methods work; undeclared scopes are denied and logged', async ({ page }) => {
    await openHello(page);
    const frame = helloFrame(page);
    await frame.getByRole('button', { name: 'Set title' }).click();
    await expect(page.getByRole('heading', { name: 'Hello ✓' })).toBeVisible();
    await frame.getByRole('button', { name: 'Show capabilities' }).click();
    await expect(frame.getByTestId('result-caps')).toContainText('sys.capabilities');
    await frame.getByRole('button', { name: 'Try a denied call' }).click();
    await expect(frame.getByTestId('result-denied')).toContainText('SCOPE_DENIED');
    await openDiagnostics(page);
    await expect(page.getByTestId('error-log')).toContainText('device.contacts.list SCOPE_DENIED');
    await expect(page.getByTestId('bridge-inspector')).toContainText('app.setTitle');
  });

  test('app.close destroys the iframe and returns to the launcher', async ({ page }) => {
    await openHello(page);
    await helloFrame(page).getByRole('button', { name: 'Close app' }).click();
    await expect(page.getByTestId('tile-hello')).toBeVisible();
    await expect(page.locator('iframe[data-app-id]')).toHaveCount(0);
  });

  test('safe mode disables every subapp', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel(/safe mode/i).check();
    await page.getByRole('button', { name: 'Back to launcher' }).click();
    await expect(page.getByTestId('tile-hello')).toBeDisabled();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel(/safe mode/i).uncheck();
    await page.getByRole('button', { name: 'Back to launcher' }).click();
    await expect(page.getByTestId('tile-hello')).toBeEnabled();
  });

  test('shell screens meet WCAG 2.1 AA (axe-core)', async ({ page }) => {
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Diagnostics' }).click();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Back to launcher' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expectNoAxeViolations(page);
  });
});

test('setup screen meets WCAG 2.1 AA (axe-core)', async ({ page, server }) => {
  void server;
  await page.goto('/');
  await expect(page.getByLabel('Server URL')).toBeVisible();
  await expectNoAxeViolations(page);
});
