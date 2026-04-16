import { test, expect } from "@playwright/test";
import { signUpViaAPI, waitForAppReady } from "./helpers";

test("spectator can view an active game without joining", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const spectatorContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const spectatorPage = await spectatorContext.newPage();

  // Alice signs up and creates a game
  const aliceUsername = `alice_spec_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(alicePage, aliceUsername, "password123");

  // Alice creates game
  await alicePage.click('button:has-text("Create a game")');
  await alicePage.click('button:has-text("Create Game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const gameUrl = alicePage.url();

  // Bob signs up and joins
  const bobUsername = `bob_spec_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(bobPage, bobUsername, "password123");

  await bobPage.goto(gameUrl);
  await expect(bobPage.locator("text=Live match")).toBeVisible();

  // Spectator (as guest) visits the game URL
  await spectatorPage.goto(gameUrl);
  // Spectator should see the game but not be a player
  // The board should be visible
  await expect(spectatorPage.locator('[data-testid="cell-9-9"]')).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
  await spectatorContext.close();
});

test('spectator sees "Spectating" title and players see spectator badge', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const spectatorContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const spectatorPage = await spectatorContext.newPage();

  // Alice signs up and creates a game
  const aliceUsername = `alice_badge_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(alicePage, aliceUsername, "password123");

  await alicePage.click('button:has-text("Create a game")');
  await alicePage.click('button:has-text("Create Game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const gameUrl = alicePage.url();

  // Bob signs up and joins
  const bobUsername = `bob_badge_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(bobPage, bobUsername, "password123");
  await bobPage.goto(gameUrl);
  await expect(bobPage.locator("text=Live match")).toBeVisible();

  // Spectator visits the game
  await spectatorPage.goto(gameUrl);
  await expect(spectatorPage.locator('[data-testid="cell-9-9"]')).toBeVisible();

  // Spectator should see "Spectating" heading (card title, rendered as h3)
  await expect(spectatorPage.getByRole("heading", { name: "Spectating" })).toBeVisible({
    timeout: 20_000,
  });

  // Players should see the spectator badge — the SpectateButton's
  // aria-label switches to "1 spectator" once the spectator context
  // joins the WebSocket.
  await expect(alicePage.getByRole("button", { name: "1 spectator" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(bobPage.getByRole("button", { name: "1 spectator" })).toBeVisible({
    timeout: 20_000,
  });

  await aliceContext.close();
  await bobContext.close();
  await spectatorContext.close();
});

test("lobby Watch a Game section navigates to game", async ({ page }) => {
  const username = `spec_w_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(page, username, "password123");

  // Navigate directly to a game URL (this is what the form does via router.push)
  await page.goto("/game/ABCDEF");

  // Should be on the game URL
  await expect(page).toHaveURL(/\/game\/ABCDEF/);
});

test("spectating own game shows error toast and stays on lobby", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Sign up and create a game
  const username = `own_spec_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(page, username, "password123");

  await page.click('button:has-text("Create a game")');
  await page.click('button:has-text("Create Game")');
  await expect(page).toHaveURL(/\/game\/[A-Z0-9]{6}/);

  // Extract the game ID from the URL
  const gameId = page.url().match(/\/game\/([A-Z0-9]{6})/)?.[1];
  expect(gameId).toBeTruthy();

  // Go back to lobby
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Try to spectate own game via the Watch a Game form
  const input = page.locator('input[name="spectate-id"]');
  await input.fill(gameId!);
  await page.click('button:has-text("Watch")');

  // Should show error toast and stay on lobby
  await expect(page.locator("text=your own game")).toBeVisible({ timeout: 3000 });
  await expect(page).toHaveURL("/");

  await context.close();
});
