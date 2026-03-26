import { test, expect } from '@playwright/test';
import { signUpViaUI } from './helpers';

test.describe('Lobby cleanup — no Refresh buttons', () => {
  test('My Games page does NOT have a Refresh button', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Sign up to access My Games
    const username = `lobby_cl_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaUI(page, username, 'password123');

    // Navigate to My Games
    await page.goto('/games');
    await expect(page.locator('text=Match History')).toBeVisible();

    // Verify no Refresh button exists on the page
    await expect(page.locator('button:has-text("Refresh")')).not.toBeVisible({ timeout: 2000 });

    await context.close();
  });

  test('Lobby invitations section does NOT have a Refresh button', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Sign up to see the lobby with invitations
    const username = `lobby_cl2_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaUI(page, username, 'password123');

    // Go to lobby
    await page.goto('/');

    // Verify no Refresh button exists on the lobby page
    await expect(page.locator('button:has-text("Refresh")')).not.toBeVisible({ timeout: 2000 });

    await context.close();
  });
});
