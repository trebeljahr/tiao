import { test, expect } from "@playwright/test";
import { signUpViaUI } from "./helpers";

test.describe("Lobby", () => {
  test("lobby shows create game and find match buttons", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('button:has-text("Create a game")')).toBeVisible();
    await expect(page.locator('button:has-text("Unlimited time game")')).toBeVisible();
  });

  test("creating a game navigates to game page", async ({ page }) => {
    const username = `lobby_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaUI(page, username, "password123");
    await page.click('button:has-text("Create a game")');
    await expect(page).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  });

  test("active game appears in lobby after creation", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Sign up (needed to see games list)
    const username = `lobby_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaUI(page, username, "password123");

    // Create game
    await page.click('button:has-text("Create a game")');
    await expect(page).toHaveURL(/\/game\/[A-Z0-9]{6}/);
    const gameId = page.url().split("/").pop()!;

    // Go back to lobby
    await page.goto("/");

    // The game should appear in the active games section
    await expect(page.locator(`text=${gameId}`)).toBeVisible({ timeout: 5000 });

    await context.close();
  });
});
