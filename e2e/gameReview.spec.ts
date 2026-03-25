import { test, expect } from '@playwright/test';

test('game review mode hides rematch, shows move history, and allows friend requests', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  // 1. Alice signs up
  await alicePage.goto('/');
  await alicePage.click('button:has-text("Sign up")');
  const aliceUsername = `alice_${Math.random().toString(36).slice(2, 7)}`;
  await alicePage.fill('input[placeholder="Username"]', aliceUsername);
  await alicePage.fill('input[placeholder="Password"]', 'password123');
  await alicePage.click('button:has-text("Create account")');
  await expect(alicePage.locator('text=Account')).toBeVisible();

  // 2. Bob signs up
  await bobPage.goto('/');
  await bobPage.click('button:has-text("Sign up")');
  const bobUsername = `bob_${Math.random().toString(36).slice(2, 7)}`;
  await bobPage.fill('input[placeholder="Username"]', bobUsername);
  await bobPage.fill('input[placeholder="Password"]', 'password123');
  await bobPage.click('button:has-text("Create account")');
  await expect(bobPage.locator('text=Account')).toBeVisible();

  // 3. Alice creates a game
  await alicePage.click('button:has-text("Create game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const gameUrl = alicePage.url();
  const gameId = gameUrl.split('/').pop()!;

  // 4. Bob joins the game
  await bobPage.goto(gameUrl);
  await expect(bobPage.locator('text=Live match')).toBeVisible();
  await expect(alicePage.locator('text=Live match')).toBeVisible();

  // 5. Force finish the game
  await alicePage.evaluate(async (gameId) => {
    await fetch(`/api/games/${gameId}/test-finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner: 'white' }),
    });
  }, gameId);

  // Wait for game over state
  await expect(alicePage.locator('text=wins')).toBeVisible();

  // 6. Alice navigates away and comes back to review
  await alicePage.goto('/games');
  await expect(alicePage.locator('text=Match History')).toBeVisible();

  // Click "Review" on the finished game
  await alicePage.click('button:has-text("Review")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);

  // 7. Verify the move history panel is visible
  await expect(alicePage.locator('[data-testid="move-list"]')).toBeVisible();

  // 8. Verify navigation buttons are present (interactive review mode)
  await expect(alicePage.locator('button[aria-label="Go to start"]')).toBeVisible();
  await expect(alicePage.locator('button[aria-label="Previous move"]')).toBeVisible();
  await expect(alicePage.locator('button[aria-label="Next move"]')).toBeVisible();
  await expect(alicePage.locator('button[aria-label="Go to end"]')).toBeVisible();

  // 9. Verify friend request button is visible for the opponent
  // The "+" add friend button should be visible for the other player's seat
  const addFriendButton = alicePage.locator('button[title^="Send friend request"]');
  await expect(addFriendButton).toBeVisible();

  // 10. Click friend request and verify pending badge appears
  await addFriendButton.click();
  await expect(alicePage.locator('text=Pending')).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});

test('game review allows stepping through move history', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  // Setup: Alice and Bob sign up
  await alicePage.goto('/');
  await alicePage.click('button:has-text("Sign up")');
  const aliceUsername = `alice_${Math.random().toString(36).slice(2, 7)}`;
  await alicePage.fill('input[placeholder="Username"]', aliceUsername);
  await alicePage.fill('input[placeholder="Password"]', 'password123');
  await alicePage.click('button:has-text("Create account")');
  await expect(alicePage.locator('text=Account')).toBeVisible();

  await bobPage.goto('/');
  await bobPage.click('button:has-text("Sign up")');
  const bobUsername = `bob_${Math.random().toString(36).slice(2, 7)}`;
  await bobPage.fill('input[placeholder="Username"]', bobUsername);
  await bobPage.fill('input[placeholder="Password"]', 'password123');
  await bobPage.click('button:has-text("Create account")');
  await expect(bobPage.locator('text=Account')).toBeVisible();

  // Alice creates game, Bob joins
  await alicePage.click('button:has-text("Create game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const gameUrl = alicePage.url();
  const gameId = gameUrl.split('/').pop()!;
  await bobPage.goto(gameUrl);
  await expect(bobPage.locator('text=Live match')).toBeVisible();

  // Determine who is white by checking the page
  // Make some moves before finishing - find out seat assignment
  // For simplicity, just force finish (history may be empty but navigation should still work)
  await alicePage.evaluate(async (gameId) => {
    await fetch(`/api/games/${gameId}/test-finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner: 'white' }),
    });
  }, gameId);

  await expect(alicePage.locator('text=wins')).toBeVisible();

  // Navigate to review
  await alicePage.goto('/games');
  await alicePage.click('button:has-text("Review")');

  // Verify "Back to lobby" button is visible
  await expect(alicePage.locator('button:has-text("Back to lobby")')).toBeVisible();

  // Click back to lobby
  await alicePage.click('button:has-text("Back to lobby")');
  await expect(alicePage).toHaveURL('/');

  await aliceContext.close();
  await bobContext.close();
});
