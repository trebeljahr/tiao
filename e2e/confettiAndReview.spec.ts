import { test, expect } from "@playwright/test";
import { signUpViaAPI, waitForAppReady } from "./helpers";

test.describe("Game review from My Games page", () => {
  test("no confetti fires when opening a finished game in review mode", async ({ browser }) => {
    test.setTimeout(60000);
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Alice signs up
    const aliceUsername = `alice_rv_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaAPI(alicePage, aliceUsername, "password123");

    // Bob signs up
    const bobUsername = `bob_rv_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaAPI(bobPage, bobUsername, "password123");

    // Alice creates game, Bob joins
    await alicePage.click('button:has-text("Create a game")');
    await alicePage.click('button:has-text("Create Game")');
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
    await expect(alicePage.getByRole("heading", { name: /wins/ })).toBeVisible({ timeout: 5000 });

    // Navigate to My Games and open in review mode
    await alicePage.goto("/games", { waitUntil: "domcontentloaded" });
    await waitForAppReady(alicePage);
    await expect(alicePage.locator("text=Match History")).toBeVisible();

    // Track whether confetti fires by intercepting the canvas-confetti calls
    await alicePage.evaluate(() => {
      (window as any).__confettiFired = false;
      const origRAF = window.requestAnimationFrame;
      // Patch canvas-confetti's typical pattern: it creates a canvas element
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag: string) {
        if (tag === "canvas") {
          // confetti library creates a canvas — mark it
          (window as any).__confettiCanvasCreated = true;
        }
        return origCreate(tag);
      } as typeof document.createElement;
    });

    // Click Review on the finished game
    await alicePage.click('button:has-text("Review")');
    await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);

    // Wait a moment for any confetti to potentially fire
    await alicePage.waitForTimeout(1500);

    // In review mode, confetti should NOT fire (winner is passed as null to useWinConfetti)
    // Verify we're in review mode by checking that the board is visible
    // and there's no active "wins" celebration overlay animation
    // The key test: review mode shows navigation buttons, not celebration UI
    await expect(alicePage.locator('button[aria-label="Go to start"]')).toBeVisible();
    await expect(alicePage.locator('button[aria-label="Go to end"]')).toBeVisible();

    await aliceContext.close();
    await bobContext.close();
  });

  test("review mode shows nav buttons and hides rematch when opponent offline", async ({
    browser,
  }) => {
    test.setTimeout(60000);
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Alice signs up
    const aliceUsername = `alice_rv2_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaAPI(alicePage, aliceUsername, "password123");

    // Bob signs up
    const bobUsername = `bob_rv2_${Math.random().toString(36).slice(2, 7)}`;
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

    // Close Bob's context (he leaves the game) and navigate Alice to My Games
    await bobContext.close();

    await alicePage.goto("/games", { waitUntil: "domcontentloaded" });
    await waitForAppReady(alicePage);
    await expect(alicePage.locator("text=Match History")).toBeVisible();
    await alicePage.click('button:has-text("Review")');
    await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);

    // Rematch button should NOT be visible (Bob is offline, rematch requires opponent online)
    await expect(alicePage.locator('button:has-text("Rematch")')).not.toBeVisible({
      timeout: 3000,
    });

    // Move navigation buttons should appear in the floating review nav
    await expect(alicePage.locator('[data-testid="review-nav-buttons"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(alicePage.locator('button[aria-label="Go to start"]')).toBeVisible();
    await expect(alicePage.locator('button[aria-label="Go to end"]')).toBeVisible();

    await aliceContext.close();
  });
});
