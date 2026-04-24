import { devices, expect, test } from "@playwright/test";
import { waitForAppReady } from "./helpers";

const iphone13 = devices["iPhone 13"];
test.use({
  viewport: iphone13.viewport,
  hasTouch: iphone13.hasTouch,
  isMobile: iphone13.isMobile,
  userAgent: iphone13.userAgent,
  deviceScaleFactor: iphone13.deviceScaleFactor,
});

function cell(page: import("@playwright/test").Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

/**
 * Place a stone on mobile by double-tapping (preview + confirm).
 */
async function mobilePlaceStone(page: import("@playwright/test").Page, x: number, y: number) {
  await cell(page, x, y).tap();
  await cell(page, x, y).tap();
}

test.describe("Mobile jump controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/local");
    await waitForAppReady(page);
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();
  });

  test("shows floating Confirm and Undo buttons during a pending jump", async ({ page }) => {
    // White at (9,9)
    await mobilePlaceStone(page, 9, 9);
    await expect(page.locator("text=Black to move")).toBeVisible();

    // Black at (10,9)
    await mobilePlaceStone(page, 10, 9);
    await expect(page.locator("text=White to move")).toBeVisible();

    // White at (8,8)
    await mobilePlaceStone(page, 8, 8);
    await expect(page.locator("text=Black to move")).toBeVisible();

    // Black at (12,9) — enables chain jump
    await mobilePlaceStone(page, 12, 9);
    await expect(page.locator("text=White to move")).toBeVisible();

    // White selects piece at (9,9) — tap on existing piece triggers selection
    // (handled by touchend in TiaoBoard which calls onPointClick directly)
    await cell(page, 9, 9).tap();
    // Jump over black at (10,9) to (11,9) — activeOrigin is set so touchend
    // calls onPointClick directly
    await cell(page, 11, 9).tap();

    // Should show floating confirm and undo buttons
    await expect(page.locator('button[aria-label="Confirm jump"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('button[aria-label="Undo last jump"]').first()).toBeVisible({
      timeout: 3000,
    });
  });

  test("Confirm button finalizes the jump", async ({ page }) => {
    await mobilePlaceStone(page, 9, 9);
    await mobilePlaceStone(page, 10, 9);
    await mobilePlaceStone(page, 8, 8);
    await mobilePlaceStone(page, 5, 5);

    // Select piece and jump
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
    await mobilePlaceStone(page, 9, 9);
    await mobilePlaceStone(page, 10, 9);
    await mobilePlaceStone(page, 8, 8);
    await mobilePlaceStone(page, 5, 5);

    // Select piece and jump
    await cell(page, 9, 9).tap();
    await cell(page, 11, 9).tap();

    // Tap the floating mobile Undo button (last one — the first is an invisible
    // board-level overlay whose tap gets intercepted by the board's touchend)
    await page.locator('button[aria-label="Undo last jump"]').last().tap();

    // Still White's turn (jump was reverted, not confirmed)
    await expect(page.locator("text=White to move")).toBeVisible();
    // White piece should be back at (9,9) (allow time for state to update)
    await expect(cell(page, 9, 9)).toHaveAttribute("data-piece", "white", { timeout: 3000 });
  });

  test("cannot switch to another piece during a pending jump", async ({ page }) => {
    await mobilePlaceStone(page, 9, 9);
    await mobilePlaceStone(page, 10, 9);
    await mobilePlaceStone(page, 8, 8);
    await mobilePlaceStone(page, 5, 5);

    // Select piece and jump
    await cell(page, 9, 9).tap();
    await cell(page, 11, 9).tap();

    // Try to tap white piece at (8,8) — should be ignored during pending jump
    await cell(page, 8, 8).tap();

    // Confirm button should still be visible (pending jump not cancelled)
    await expect(page.locator('button[aria-label="Confirm jump"]')).toBeVisible({ timeout: 2000 });
  });
});
