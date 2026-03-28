import { test, expect } from "@playwright/test";
import { signUpViaUI } from "./helpers";

test("rematch creates a new game URL with fresh scores", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  // Alice signs up
  const aliceUsername = `alice_rn_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(alicePage, aliceUsername, "password123");

  // Bob signs up
  const bobUsername = `bob_rn_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(bobPage, bobUsername, "password123");

  // Alice creates a game
  await alicePage.click('button:has-text("Create a game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const originalGameUrl = alicePage.url();
  const originalGameId = originalGameUrl.split("/").pop()!;

  // Bob joins the game
  await bobPage.goto(originalGameUrl);
  await expect(bobPage.locator("text=Live match")).toBeVisible();
  await expect(alicePage.locator("text=Live match")).toBeVisible();

  // Force finish the game
  await alicePage.evaluate(async (gameId) => {
    await fetch(`/api/games/${gameId}/test-finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner: "white" }),
    });
  }, originalGameId);

  // Wait for game-over dialog and dismiss it
  const aliceDialog = alicePage.locator(".fixed.inset-0.z-\\[300\\]");
  const bobDialog = bobPage.locator(".fixed.inset-0.z-\\[300\\]");
  await expect(aliceDialog).toBeVisible({ timeout: 5000 });
  await expect(bobDialog).toBeVisible({ timeout: 5000 });
  await alicePage.keyboard.press("Escape");
  await bobPage.keyboard.press("Escape");
  await expect(aliceDialog).not.toBeVisible({ timeout: 2000 });
  await expect(bobDialog).not.toBeVisible({ timeout: 2000 });

  // Alice requests rematch (sidebar button now clickable without dialog overlay)
  await expect(alicePage.locator('button:has-text("Rematch")')).toBeVisible({ timeout: 5000 });
  await alicePage.click('button:has-text("Rematch")');
  await expect(alicePage.locator("text=Rematch requested")).toBeVisible({ timeout: 5000 });

  // Bob accepts rematch
  await expect(bobPage.locator('button:has-text("Accept Rematch")')).toBeVisible({ timeout: 5000 });
  await bobPage.click('button:has-text("Accept Rematch")');

  // Both should be navigated to a new game
  await expect(alicePage.locator("text=Live match")).toBeVisible({ timeout: 5000 });
  await expect(bobPage.locator("text=Live match")).toBeVisible({ timeout: 5000 });

  // The new game URL should be different from the original
  const newAliceUrl = alicePage.url();
  const newBobUrl = bobPage.url();
  const newGameId = newAliceUrl.split("/").pop()!;

  expect(newGameId).not.toBe(originalGameId);
  expect(newAliceUrl).toMatch(/\/game\/[A-Z0-9]{6}/);
  expect(newBobUrl).toMatch(/\/game\/[A-Z0-9]{6}/);

  // Verify fresh scores (0-0) by checking the score displays
  // Both score tiles should show 0
  await expect(alicePage.locator("text=0").first()).toBeVisible();
  await expect(bobPage.locator("text=0").first()).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});
