import { test, expect } from '@playwright/test';
import { signUpViaUI } from './helpers';

test('spectator can view an active game without joining', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const spectatorContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const spectatorPage = await spectatorContext.newPage();

  // Alice signs up and creates a game
  const aliceUsername = `alice_spec_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(alicePage, aliceUsername, 'password123');

  // Alice creates game
  await alicePage.click('button:has-text("Create a game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const gameUrl = alicePage.url();

  // Bob signs up and joins
  const bobUsername = `bob_spec_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(bobPage, bobUsername, 'password123');

  await bobPage.goto(gameUrl);
  await expect(bobPage.locator('text=Live match')).toBeVisible();

  // Spectator (as guest) visits the game URL
  await spectatorPage.goto(gameUrl);
  // Spectator should see the game but not be a player
  // The board should be visible
  await expect(spectatorPage.locator('[data-testid="cell-9-9"]')).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
  await spectatorContext.close();
});
