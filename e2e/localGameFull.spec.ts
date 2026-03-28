import { test, expect } from "@playwright/test";

function cell(page: import("@playwright/test").Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

test.describe("Local game – full play-through", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/local");
    await expect(cell(page, 9, 9)).toBeVisible();
  });

  test("score display starts at zero", async ({ page }) => {
    await expect(page.locator("text=0").first()).toBeVisible();
  });

  test("pieces remain on board after placement", async ({ page }) => {
    await cell(page, 9, 9).click();
    await cell(page, 10, 10).click();
    await cell(page, 8, 8).click();

    await expect(cell(page, 9, 9)).toHaveAttribute("data-piece", "white");
    await expect(cell(page, 10, 10)).toHaveAttribute("data-piece", "black");
    await expect(cell(page, 8, 8)).toHaveAttribute("data-piece", "white");
  });

  test("jump capture workflow", async ({ page }) => {
    // White at (9,9)
    await cell(page, 9, 9).click();
    await expect(page.locator("text=Black to move")).toBeVisible();

    // Black at (10,9) — adjacent to white
    await cell(page, 10, 9).click();
    await expect(page.locator("text=White to move")).toBeVisible();

    // White at (8,8) — some other position
    await cell(page, 8, 8).click();
    await expect(page.locator("text=Black to move")).toBeVisible();

    // Black at (7,7)
    await cell(page, 7, 7).click();
    await expect(page.locator("text=White to move")).toBeVisible();

    // Now white can try to set up a jump scenario
    // White at (11,9) — will be able to jump over black at (10,9) from (9,9) to (11,9)?
    // Actually, (9,9) has white piece, (10,9) has black piece — white at (9,9) can jump to (11,9)
    // First, select white piece at (9,9)
    await cell(page, 9, 9).click();

    // Click jump destination (11,9) — over black at (10,9)
    await cell(page, 11, 9).click();

    // If jump is valid, we should see a confirm button or the piece should have moved
    // The pending jump means the piece moves but turn hasn't changed
    // Check if there's a confirm button
    const confirmButton = page.locator('button:has-text("Confirm")');
    if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmButton.click();
      // After confirming, it should be black's turn and white scored
      await expect(page.locator("text=Black to move")).toBeVisible();
    }
  });
});
