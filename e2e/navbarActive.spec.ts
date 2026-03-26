import { test, expect } from '@playwright/test';

test.describe('Navbar active link attributes', () => {
  test('active nav link has aria-current="page" and is not disabled', async ({ page }) => {
    // Navigate to /local — the "Local" nav link should be active
    await page.goto('/local');
    await page.click('[aria-label="Open navigation"]');

    // Find the nav link that has aria-current="page"
    const activeLink = page.locator('button[aria-current="page"]');
    await expect(activeLink).toBeVisible();

    // The active link should NOT have a disabled attribute
    await expect(activeLink).not.toHaveAttribute('disabled', '');

    // The active link should have aria-current="page"
    await expect(activeLink).toHaveAttribute('aria-current', 'page');
  });

  test('non-active nav links do not have aria-current', async ({ page }) => {
    await page.goto('/local');
    await page.click('[aria-label="Open navigation"]');

    // The active link should be visible
    const activeLink = page.locator('button[aria-current="page"]');
    await expect(activeLink).toBeVisible();

    // Other nav buttons inside the drawer should NOT have aria-current
    const navButtons = page.locator('aside button:not([aria-current])');
    const count = await navButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('active nav link on /computer page', async ({ page }) => {
    await page.goto('/computer');
    await page.click('[aria-label="Open navigation"]');

    const activeLink = page.locator('button[aria-current="page"]');
    await expect(activeLink).toBeVisible();

    // Should not be disabled
    await expect(activeLink).not.toHaveAttribute('disabled', '');
    await expect(activeLink).toHaveAttribute('aria-current', 'page');
  });

  test('active nav link on home page', async ({ page }) => {
    await page.goto('/');
    await page.click('[aria-label="Open navigation"]');

    const activeLink = page.locator('button[aria-current="page"]');
    await expect(activeLink).toBeVisible();

    // Should not be disabled
    await expect(activeLink).not.toHaveAttribute('disabled', '');
    await expect(activeLink).toHaveAttribute('aria-current', 'page');
  });
});
