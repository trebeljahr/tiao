import { test, expect } from '@playwright/test';
import { signUpViaUI } from './helpers';

test.describe('Forfeit in multiplayer', () => {
  test('forfeit button appears and forfeiting ends the game', async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Alice signs up
    const aliceUsername = `alice_ff_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaUI(alicePage, aliceUsername, 'password123');

    // Bob signs up
    const bobUsername = `bob_ff_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaUI(bobPage, bobUsername, 'password123');

    // Alice creates a game
    await alicePage.click('button:has-text("Create a game")');
    await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
    const gameUrl = alicePage.url();

    // Bob joins the game
    await bobPage.goto(gameUrl);
    await expect(bobPage.locator('text=Live match')).toBeVisible();
    await expect(alicePage.locator('text=Live match')).toBeVisible();

    // Verify the Forfeit button is visible for Alice (active player)
    await expect(alicePage.locator('button:has-text("Forfeit")')).toBeVisible();

    // Verify the Forfeit button is visible for Bob too
    await expect(bobPage.locator('button:has-text("Forfeit")')).toBeVisible();

    // Alice forfeits — click Forfeit to open the confirmation dialog, then confirm
    await alicePage.click('button:has-text("Forfeit")');
    // The custom Dialog appears with a second "Forfeit" button to confirm
    const confirmDialog = alicePage.locator('.fixed.inset-0.z-\\[300\\]');
    await expect(confirmDialog).toBeVisible({ timeout: 3000 });
    await confirmDialog.locator('button:has-text("Forfeit")').click();

    // Both should see the game as finished — the opponent (Bob) wins
    // The status title heading shows "{Color} wins" after game ends
    await expect(bobPage.getByRole('heading', { name: /wins/ })).toBeVisible({ timeout: 10000 });
    await expect(alicePage.getByRole('heading', { name: /wins/ })).toBeVisible({ timeout: 10000 });

    // After forfeit, the game should no longer show "Live match" status
    await expect(alicePage.locator('text=Live match')).not.toBeVisible({ timeout: 3000 });
    await expect(bobPage.locator('text=Live match')).not.toBeVisible({ timeout: 3000 });

    await aliceContext.close();
    await bobContext.close();
  });
});
