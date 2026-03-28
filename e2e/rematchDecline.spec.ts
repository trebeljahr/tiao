import { test, expect } from "@playwright/test";
import { signUpViaUI } from "./helpers";

test("multiplayer rematch decline flow", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  // Alice signs up
  const aliceUsername = `alice_dec_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(alicePage, aliceUsername, "password123");

  // Bob signs up
  const bobUsername = `bob_dec_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(bobPage, bobUsername, "password123");

  // Alice creates game, Bob joins
  await alicePage.click('button:has-text("Create a game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const gameUrl = alicePage.url();
  const gameId = gameUrl.split("/").pop()!;

  await bobPage.goto(gameUrl);
  await expect(bobPage.locator("text=Live match")).toBeVisible();

  // Force finish the game
  await alicePage.evaluate(async (gameId) => {
    await fetch(`/api/games/${gameId}/test-finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner: "white" }),
    });
  }, gameId);

  // Wait for game-over dialog and dismiss it for both players
  const aliceDialog = alicePage.locator(".fixed.inset-0.z-\\[300\\]");
  const bobDialog = bobPage.locator(".fixed.inset-0.z-\\[300\\]");
  await expect(aliceDialog).toBeVisible({ timeout: 5000 });
  await expect(bobDialog).toBeVisible({ timeout: 5000 });
  // Close dialogs by clicking "Back to lobby" then navigating back, OR press Escape
  await alicePage.keyboard.press("Escape");
  await bobPage.keyboard.press("Escape");
  await expect(aliceDialog).not.toBeVisible({ timeout: 2000 });
  await expect(bobDialog).not.toBeVisible({ timeout: 2000 });

  // Rematch buttons appear in the sidebar (now visible without dialog overlay)
  await expect(alicePage.locator('button:has-text("Rematch")')).toBeVisible({ timeout: 5000 });
  await expect(bobPage.locator('button:has-text("Rematch")')).toBeVisible({ timeout: 5000 });

  // Alice requests rematch
  await alicePage.click('button:has-text("Rematch")');
  await expect(alicePage.locator("text=Rematch requested")).toBeVisible();

  // Bob declines (use first() to avoid strict mode when toast also shows Decline)
  await expect(bobPage.locator('button:has-text("Decline")').first()).toBeVisible({
    timeout: 5000,
  });
  await bobPage.locator('button:has-text("Decline")').first().click();

  // After decline, rematch request should be cleared
  // The game should still show as finished, no new game started
  await expect(alicePage.locator("text=Live match")).not.toBeVisible({ timeout: 3000 });

  await aliceContext.close();
  await bobContext.close();
});
