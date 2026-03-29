import { test, expect } from "@playwright/test";
import { signUpViaUI } from "./helpers";

test("multiplayer rematch flow", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();

  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  // 1. Alice signs up
  const aliceUsername = `alice_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(alicePage, aliceUsername, "password123");

  // 2. Bob signs up
  const bobUsername = `bob_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(bobPage, bobUsername, "password123");

  // 3. Alice creates a game
  await alicePage.click('button:has-text("Create a game")');
  await alicePage.click('button:has-text("Create Game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const gameUrl = alicePage.url();
  const gameId = gameUrl.split("/").pop()!;

  // 4. Bob joins the game via URL
  await bobPage.goto(gameUrl);
  await expect(bobPage.locator("text=Live match")).toBeVisible();
  await expect(alicePage.locator("text=Live match")).toBeVisible();

  // 5. Force finish the game via the test route
  // We can use alicePage.evaluate to send a POST request to the test route
  await alicePage.evaluate(async (gameId) => {
    await fetch(`/api/games/${gameId}/test-finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner: "white" }),
    });
  }, gameId);

  // 6. Verify "Rematch" button appears for both (wait for WS broadcast + 600ms dialog delay)
  // Game-over dialog overlays the panel, so target the dialog's Rematch button
  const gameOverDialog = ".fixed.inset-0";
  await expect(alicePage.locator(`${gameOverDialog} button:has-text("Rematch")`)).toBeVisible({
    timeout: 5000,
  });
  await expect(bobPage.locator(`${gameOverDialog} button:has-text("Rematch")`)).toBeVisible({
    timeout: 5000,
  });

  // 7. Alice requests rematch
  await alicePage.locator(`${gameOverDialog} button:has-text("Rematch")`).click();
  await expect(alicePage.locator("text=Rematch requested")).toBeVisible();

  // 8. Bob sees "Accept Rematch" in the game-over dialog
  await expect(bobPage.locator(`${gameOverDialog} button:has-text("Accept Rematch")`)).toBeVisible({
    timeout: 5000,
  });

  // 9. Bob accepts rematch via the dialog
  await bobPage.locator(`${gameOverDialog} button:has-text("Accept Rematch")`).click();

  // 10. Verify both are back in a "Live match"
  await expect(alicePage.locator("text=Live match")).toBeVisible();
  await expect(bobPage.locator("text=Live match")).toBeVisible();

  // Verify scores are reset
  await expect(alicePage.locator("text=0").first()).toBeVisible();
  await expect(bobPage.locator("text=0").first()).toBeVisible();
});
