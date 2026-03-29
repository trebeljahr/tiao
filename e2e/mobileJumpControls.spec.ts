import { test, expect, devices } from "@playwright/test";
import { waitForAppReady, mobileClickCell } from "./helpers";

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

/**
 * Select a piece and execute a jump on mobile.
 * Playwright's .tap() doesn't fire the synthetic click event that the board
 * relies on for piece selection, so we use mobileClickCell to dispatch it.
 */
async function mobileSelectAndJump(
  page: import("@playwright/test").Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  await mobileClickCell(page, fromX, fromY);
  await mobileClickCell(page, toX, toY);
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

    // White selects piece at (9,9) and jumps over black at (10,9) to (11,9)
    await mobileSelectAndJump(page, 9, 9, 11, 9);

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

    await mobileSelectAndJump(page, 9, 9, 11, 9);

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

    await mobileSelectAndJump(page, 9, 9, 11, 9);

    // Tap Undo (use first() since there may be both board-level and floating undo)
    await page.locator('button[aria-label="Undo last jump"]').first().tap();

    // Still White's turn (jump was reverted, not confirmed)
    await expect(page.locator("text=White to move")).toBeVisible();
    // White piece should be back at (9,9)
    await expect(cell(page, 9, 9)).toHaveAttribute("data-piece", "white");
  });

  test("cannot switch to another piece during a pending jump", async ({ page }) => {
    await mobilePlaceStone(page, 9, 9);
    await mobilePlaceStone(page, 10, 9);
    await mobilePlaceStone(page, 8, 8);
    await mobilePlaceStone(page, 5, 5);

    await mobileSelectAndJump(page, 9, 9, 11, 9);

    // Try to click white piece at (8,8) — should be ignored during pending jump
    await mobileClickCell(page, 8, 8);

    // Confirm button should still be visible (pending jump not cancelled)
    await expect(page.locator('button[aria-label="Confirm jump"]')).toBeVisible({ timeout: 2000 });
  });
});
