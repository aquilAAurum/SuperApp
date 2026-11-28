import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, signIn, test } from './fixtures.ts';

// EatWell subapp (SA-2026-008) inside the real shell, against the mocked server. The browser shell
// has no Health Connect, so the consent flow is exercised up to the native layer (UNAVAILABLE).
const eatwell = (page: Page) => page.frameLocator('iframe[data-app-id="eatwell"]');

async function openEatWell(page: Page): Promise<void> {
  await page.getByTestId('tile-eatwell').click();
  await expect(eatwell(page).getByTestId('kcal-left')).toBeVisible({ timeout: 10_000 });
}

const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).include('iframe[data-app-id="eatwell"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
};

test.describe('EatWell subapp', () => {
  // Requesting `server` installs the mocked PocketBase for this page (lazy fixture).
  test.beforeEach(async ({ page, server }) => {
    expect(server.ops).toBeDefined();
    await signIn(page);
  });

  test('logging a food writes the entry through the ops route and updates the budget', async ({ page, server }) => {
    await openEatWell(page);
    const f = eatwell(page);
    await expect(f.getByTestId('kcal-left')).toHaveText('2,000');
    await f.getByRole('button', { name: 'Add food to Breakfast' }).click();
    await f.getByLabel('Search foods').fill('banana');
    await f.getByTestId('food-result').first().click();
    await f.getByLabel('Servings', { exact: true }).fill('2');
    await expect(f.getByTestId('serving-totals')).toContainText('210 cal');
    await f.getByTestId('serving-submit').click();
    await expect(f.getByTestId('kcal-left')).toHaveText('1,790');
    await expect.poll(() => server.ops.liveRecords('eatwell_entries').length, { timeout: 15_000 }).toBe(1);
    expect(server.ops.liveRecords('eatwell_entries')[0]).toMatchObject({ meal: 'breakfast', name: 'Banana', servings: 2, kcal: 210, food_ref: 'b:banana', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  test('without Health Connect (browser shell) EatWell explains instead of offering Connect', async ({ page }) => {
    await openEatWell(page);
    const f = eatwell(page);
    await expect(f.getByTestId('hc-unavailable')).toContainText("isn't available");
    await expect(f.getByTestId('hc-connect')).toHaveCount(0);
  });

  test('EatWell screens meet WCAG 2.1 AA (axe-core)', async ({ page }) => {
    await openEatWell(page);
    const f = eatwell(page);
    await axe(page);
    await f.getByRole('button', { name: 'Add food to Lunch' }).click();
    await f.getByLabel('Search foods').fill('rice');
    await axe(page);
    await f.getByTestId('food-result').first().click();
    await axe(page);
    await f.getByRole('button', { name: 'Back' }).click();
    await f.getByRole('button', { name: 'Back' }).click();
    for (const tab of ['trends', 'foods', 'goals'] as const) {
      await f.getByTestId(`tab-${tab}`).click();
      await axe(page);
    }
  });
});
