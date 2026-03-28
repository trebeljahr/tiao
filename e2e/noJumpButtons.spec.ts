import { test, expect } from "@playwright/test";
import { signUpViaUI } from "./helpers";

function cell(page: import("@playwright/test").Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

test.describe("No Confirm/Undo jump buttons", () => {
  test("local mode does not show Confirm jump or Undo jump buttons during a multi-jump", async ({
    page,
  }) => {
    await page.goto("/local");
    await expect(cell(page, 9, 9)).toBeVisible();

    // Set up a jump scenario:
    // White at (9,9)
    await cell(page, 9, 9).click();
    await expect(page.locator("text=Black to move")).toBeVisible();

    // Black at (10,9) — adjacent to white
    await cell(page, 10, 9).click();
    await expect(page.locator("text=White to move")).toBeVisible();

    // White at (8,8)
    await cell(page, 8, 8).click();
    await expect(page.locator("text=Black to move")).toBeVisible();

    // Black at (12,9) — placed to enable chain jump later
    await cell(page, 12, 9).click();
    await expect(page.locator("text=White to move")).toBeVisible();

    // White selects piece at (9,9) and jumps over black at (10,9) to (11,9)
    await cell(page, 9, 9).click();
    await cell(page, 11, 9).click();

    // After a jump, there should be NO "Confirm jump" or "Undo jump" buttons
    await expect(page.locator('button:has-text("Confirm jump")')).not.toBeVisible({
      timeout: 1000,
    });
    await expect(page.locator('button:has-text("Undo jump")')).not.toBeVisible({ timeout: 1000 });
  });

  test("multiplayer mode does not show Confirm jump or Undo jump buttons", async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Alice signs up
    const aliceUsername = `alice_nj_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaUI(alicePage, aliceUsername, "password123");

    // Bob signs up
    const bobUsername = `bob_nj_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaUI(bobPage, bobUsername, "password123");

    // Alice creates game, Bob joins
    await alicePage.click('button:has-text("Create a game")');
    await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
    const gameUrl = alicePage.url();
    await bobPage.goto(gameUrl);
    await expect(bobPage.locator("text=Live match")).toBeVisible();

    // Verify no Confirm jump / Undo jump buttons exist on either page
    await expect(alicePage.locator('button:has-text("Confirm jump")')).not.toBeVisible({
      timeout: 1000,
    });
    await expect(alicePage.locator('button:has-text("Undo jump")')).not.toBeVisible({
      timeout: 1000,
    });
    await expect(bobPage.locator('button:has-text("Confirm jump")')).not.toBeVisible({
      timeout: 1000,
    });
    await expect(bobPage.locator('button:has-text("Undo jump")')).not.toBeVisible({
      timeout: 1000,
    });

    await aliceContext.close();
    await bobContext.close();
  });
});
