import { test, expect, devices } from "@playwright/test";
import { waitForAppReady } from "./helpers";

function cell(page: import("@playwright/test").Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

function board(page: import("@playwright/test").Page) {
  return page.locator('[data-testid="tiao-board"]');
}

// ---------- Desktop tests (default project uses Desktop Chrome) ----------

test.describe("Desktop – no loupe on click", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/local");
    await waitForAppReady(page);
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();
  });

  test("single click places stone immediately without loupe", async ({ page }) => {
    await cell(page, 9, 9).click();
    await expect(cell(page, 9, 9)).toHaveAttribute("data-piece", "white");
    // No loupe element should exist
    await expect(board(page).locator('[class*="z-30"]')).toHaveCount(0);
  });
});

// ---------- Mobile tests (iPhone 13 emulation with touch) ----------

const iphone13 = devices["iPhone 13"];
test.describe("Mobile loupe – stone placement", () => {
  test.use({
    viewport: iphone13.viewport,
    hasTouch: iphone13.hasTouch,
    isMobile: iphone13.isMobile,
    userAgent: iphone13.userAgent,
    deviceScaleFactor: iphone13.deviceScaleFactor,
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/local");
    await waitForAppReady(page);
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();
  });

  test("first tap shows preview, second tap confirms placement", async ({ page }) => {
    const cellBox = await cell(page, 9, 9).boundingBox();
    expect(cellBox).not.toBeNull();

    const cx = cellBox!.x + cellBox!.width / 2;
    const cy = cellBox!.y + cellBox!.height / 2;

    // First tap — should show preview (loupe), NOT place stone
    await page.touchscreen.tap(cx, cy);
    await expect(cell(page, 9, 9)).not.toHaveAttribute("data-piece", "white");

    // Preview/loupe should be visible
    const loupe = board(page).locator('[class*="z-30"]');
    await expect(loupe).toBeVisible({ timeout: 2000 });

    // Second tap on same position — confirms placement
    await page.touchscreen.tap(cx, cy);
    await expect(cell(page, 9, 9)).toHaveAttribute("data-piece", "white");
  });

  test("preview disappears after confirming placement", async ({ page }) => {
    const cellBox = await cell(page, 9, 9).boundingBox();
    expect(cellBox).not.toBeNull();

    const cx = cellBox!.x + cellBox!.width / 2;
    const cy = cellBox!.y + cellBox!.height / 2;

    // First tap — show preview
    await page.touchscreen.tap(cx, cy);
    const loupe = board(page).locator('[class*="z-30"]');
    await expect(loupe).toBeVisible({ timeout: 2000 });

    // Second tap — confirm placement
    await page.touchscreen.tap(cx, cy);
    await expect(cell(page, 9, 9)).toHaveAttribute("data-piece", "white");

    // Loupe should be gone after placement
    await expect(loupe).not.toBeVisible({ timeout: 2000 });
  });

  test("tapping a different empty position moves the preview", async ({ page }) => {
    const cell99 = await cell(page, 9, 9).boundingBox();
    const cell88 = await cell(page, 8, 8).boundingBox();
    expect(cell99).not.toBeNull();
    expect(cell88).not.toBeNull();

    // First tap at (9,9) — show preview there
    await page.touchscreen.tap(cell99!.x + cell99!.width / 2, cell99!.y + cell99!.height / 2);
    const loupe = board(page).locator('[class*="z-30"]');
    await expect(loupe).toBeVisible({ timeout: 2000 });

    // Tap at (8,8) — preview should move (not confirm at 9,9)
    await page.touchscreen.tap(cell88!.x + cell88!.width / 2, cell88!.y + cell88!.height / 2);

    // No stone placed at (9,9)
    await expect(cell(page, 9, 9)).not.toHaveAttribute("data-piece", "white");
    // Preview should still be visible (now at 8,8)
    await expect(loupe).toBeVisible();

    // Confirm at (8,8) with second tap
    await page.touchscreen.tap(cell88!.x + cell88!.width / 2, cell88!.y + cell88!.height / 2);
    await expect(cell(page, 8, 8)).toHaveAttribute("data-piece", "white");
  });

  test("turn alternates correctly with double-tap flow", async ({ page }) => {
    const cell99 = await cell(page, 9, 9).boundingBox();
    expect(cell99).not.toBeNull();

    const cx = cell99!.x + cell99!.width / 2;
    const cy = cell99!.y + cell99!.height / 2;

    // White places at (9,9) with double tap
    await page.touchscreen.tap(cx, cy);
    await page.touchscreen.tap(cx, cy);
    await expect(cell(page, 9, 9)).toHaveAttribute("data-piece", "white");

    // Should now be Black's turn
    await expect(page.locator("text=Black to move")).toBeVisible();
  });
});
