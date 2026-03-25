import { test, expect } from "@playwright/test";

/**
 * Helper to click a board cell at grid coordinates (x, y).
 */
function cell(page: import("@playwright/test").Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

test.describe("Local board – turn alternation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/local");
    // Wait for the board to render
    await expect(cell(page, 9, 9)).toBeVisible();
  });

  test("starts with White to move", async ({ page }) => {
    await expect(page.locator("text=White to move")).toBeVisible();
  });

  test("turns alternate after placing pieces", async ({ page }) => {
    // White places at (9, 9)
    await cell(page, 9, 9).click();
    await expect(page.locator("text=Black to move")).toBeVisible();
    await expect(cell(page, 9, 9)).toHaveAttribute("data-piece", "white");

    // Black places at (10, 10)
    await cell(page, 10, 10).click();
    await expect(page.locator("text=White to move")).toBeVisible();
    await expect(cell(page, 10, 10)).toHaveAttribute("data-piece", "black");
  });

  test("cannot select opponent piece for jumping", async ({ page }) => {
    // Place some pieces to set up a jump scenario
    // White at (9,9)
    await cell(page, 9, 9).click();
    await expect(page.locator("text=Black to move")).toBeVisible();

    // Black at (10,9) — adjacent to white
    await cell(page, 10, 9).click();
    await expect(page.locator("text=White to move")).toBeVisible();

    // White at (8,8)
    await cell(page, 8, 8).click();
    await expect(page.locator("text=Black to move")).toBeVisible();

    // Now it's Black's turn. Clicking the white piece at (9,9)
    // should NOT select it (no jump highlights should appear).
    // Black should NOT be able to jump with white's pieces.
    await cell(page, 9, 9).click();

    // Turn should still be Black's (no state change from clicking opponent piece)
    await expect(page.locator("text=Black to move")).toBeVisible();

    // The white piece should NOT have a selected visual state.
    // Verify by placing a black piece — if the click was ignored, we can still place.
    await cell(page, 7, 7).click();
    await expect(page.locator("text=White to move")).toBeVisible();
    await expect(cell(page, 7, 7)).toHaveAttribute("data-piece", "black");
  });
});
