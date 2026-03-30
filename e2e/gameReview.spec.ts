import { test, expect } from "@playwright/test";
import { signUpViaAPI, waitForAppReady } from "./helpers";

test("game review mode shows review nav buttons and allows friend requests", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  // 1. Alice signs up
  const aliceUsername = `alice_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(alicePage, aliceUsername, "password123");

  // 2. Bob signs up
  const bobUsername = `bob_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(bobPage, bobUsername, "password123");

  // 3. Alice creates a game
  await alicePage.click('button:has-text("Create a game")');
  await alicePage.click('button:has-text("Create Game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const gameUrl = alicePage.url();
  const gameId = gameUrl.split("/").pop()!;

  // 4. Bob joins the game
  await bobPage.goto(gameUrl);
  await expect(bobPage.locator("text=Live match")).toBeVisible();
  await expect(alicePage.locator("text=Live match")).toBeVisible();

  // 5. Force finish the game
  await alicePage.evaluate(async (gameId) => {
    await fetch(`/api/games/${gameId}/test-finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner: "white" }),
    });
  }, gameId);

  // Wait for game over state
  await expect(alicePage.getByRole("heading", { name: /wins/ })).toBeVisible({ timeout: 5000 });

  // 6. Alice navigates away and comes back to review
  await alicePage.goto("/games", { waitUntil: "domcontentloaded" });
  await waitForAppReady(alicePage);
  await expect(alicePage.locator("text=Match History")).toBeVisible();

  // Click "Review" on the finished game
  await alicePage.click('button:has-text("Review")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);

  // 7. Verify review navigation buttons are visible (in floating review-nav-buttons)
  await expect(alicePage.locator('[data-testid="review-nav-buttons"]')).toBeVisible({
    timeout: 5000,
  });
  await expect(alicePage.locator('button[aria-label="Go to start"]')).toBeVisible();
  await expect(alicePage.locator('button[aria-label="Go to end"]')).toBeVisible();

  // 8. Verify friend request button is visible for the opponent
  const addFriendButton = alicePage.locator('button:has-text("Add friend")');
  await expect(addFriendButton).toBeVisible();

  // 9. Click friend request and verify pending badge appears
  await addFriendButton.click();
  await expect(alicePage.locator("text=Pending")).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});

test("game review shows status title and allows returning to lobby", async ({ browser }) => {
  test.setTimeout(60000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  // Setup: Alice and Bob sign up
  const aliceUsername = `alice_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(alicePage, aliceUsername, "password123");

  const bobUsername = `bob_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(bobPage, bobUsername, "password123");

  // Alice creates game, Bob joins
  await alicePage.click('button:has-text("Create a game")');
  await alicePage.click('button:has-text("Create Game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const gameUrl = alicePage.url();
  const gameId = gameUrl.split("/").pop()!;
  await bobPage.goto(gameUrl);
  await expect(bobPage.locator("text=Live match")).toBeVisible();

  // Force finish
  await alicePage.evaluate(async (gameId) => {
    await fetch(`/api/games/${gameId}/test-finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner: "white" }),
    });
  }, gameId);

  await expect(alicePage.getByRole("heading", { name: /wins/ })).toBeVisible({ timeout: 5000 });

  // Navigate to review
  await alicePage.goto("/games", { waitUntil: "domcontentloaded" });
  await waitForAppReady(alicePage);
  await alicePage.click('button:has-text("Review")');

  // Verify we're on the game page in review mode
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  // Status title should show "{Color} wins"
  await expect(alicePage.getByRole("heading", { name: /wins/ })).toBeVisible({ timeout: 5000 });

  // Navigate to lobby by going to the home page
  await alicePage.goto("/");
  await expect(alicePage).toHaveURL("/");

  await aliceContext.close();
  await bobContext.close();
});
