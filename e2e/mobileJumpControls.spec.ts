import { test, expect, devices } from "@playwright/test";

test.use({ ...devices["iPhone 13"] });

function cell(page: import("@playwright/test").Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

test.describe("Mobile jump controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/local");
    await expect(cell(page, 9, 9)).toBeVisible();
  });

  test("shows floating Confirm and Undo buttons during a pending jump", async ({ page }) => {
    // White at (9,9)
    await cell(page, 9, 9).tap();
    await expect(page.locator("text=Black to move")).toBeVisible();

    // Black at (10,9)
    await cell(page, 10, 9).tap();
    await expect(page.locator("text=White to move")).toBeVisible();

    // White at (8,8)
    await cell(page, 8, 8).tap();
    await expect(page.locator("text=Black to move")).toBeVisible();

    // Black at (12,9) — enables chain jump
    await cell(page, 12, 9).tap();
    await expect(page.locator("text=White to move")).toBeVisible();

    // White selects piece at (9,9) and jumps over black at (10,9) to (11,9)
    await cell(page, 9, 9).tap();
    await cell(page, 11, 9).tap();

    // Should show floating confirm and undo buttons
    await expect(page.locator('button[aria-label="Confirm jump"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('button[aria-label="Undo last jump"]').first()).toBeVisible({
      timeout: 3000,
    });
  });

  test("Confirm button finalizes the jump", async ({ page }) => {
    // White at (9,9)
    await cell(page, 9, 9).tap();
    // Black at (10,9)
    await cell(page, 10, 9).tap();
    // White at (8,8)
    await cell(page, 8, 8).tap();
    // Black at (5,5)
    await cell(page, 5, 5).tap();

    // White selects (9,9), jumps to (11,9)
    await cell(page, 9, 9).tap();
    await cell(page, 11, 9).tap();

    // Tap Confirm
    await page.locator('button[aria-label="Confirm jump"]').tap();

    // Turn should switch to Black
    await expect(page.locator("text=Black to move")).toBeVisible();
    // Floating controls should disappear
    await expect(page.locator('button[aria-label="Confirm jump"]')).not.toBeVisible({
      timeout: 2000,
    });
  });

  test("Undo button reverts the last jump step", async ({ page }) => {
    // White at (9,9)
    await cell(page, 9, 9).tap();
    // Black at (10,9)
    await cell(page, 10, 9).tap();
    // White at (8,8)
    await cell(page, 8, 8).tap();
    // Black at (5,5)
    await cell(page, 5, 5).tap();

    // White selects (9,9), jumps to (11,9)
    await cell(page, 9, 9).tap();
    await cell(page, 11, 9).tap();

    // Tap Undo (use first() since there may be both board-level and floating undo)
    await page.locator('button[aria-label="Undo last jump"]').first().tap();

    // Still White's turn (jump was reverted, not confirmed)
    await expect(page.locator("text=White to move")).toBeVisible();
    // White piece should be back at (9,9)
    await expect(cell(page, 9, 9)).toHaveAttribute("data-piece", "white");
  });

  test("cannot switch to another piece during a pending jump", async ({ page }) => {
    // White at (9,9)
    await cell(page, 9, 9).tap();
    // Black at (10,9)
    await cell(page, 10, 9).tap();
    // White at (8,8)
    await cell(page, 8, 8).tap();
    // Black at (5,5)
    await cell(page, 5, 5).tap();

    // White selects (9,9), jumps to (11,9)
    await cell(page, 9, 9).tap();
    await cell(page, 11, 9).tap();

    // Try to tap white piece at (8,8) — should be ignored during pending jump
    await cell(page, 8, 8).tap();

    // Confirm button should still be visible (pending jump not cancelled)
    await expect(page.locator('button[aria-label="Confirm jump"]')).toBeVisible({ timeout: 2000 });
  });
});
