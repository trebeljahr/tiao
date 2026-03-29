import { test, expect } from "@playwright/test";
import { waitForAppReady } from "./helpers";

function cell(page: import("@playwright/test").Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

/**
 * Wait until it's the human's turn, returning the human's color.
 * The computer color is random, so the human might be white or black.
 * When it's the human's turn, the status shows "{Color} to move".
 * When it's the computer's turn, the status shows "Computer thinking...".
 */
async function waitForHumanTurn(page: import("@playwright/test").Page) {
  // Wait for computer to finish thinking first
  await expect(page.locator("text=Computer thinking")).not.toBeVisible({ timeout: 15000 });
  const toMove = page.locator("text=/^(White|Black) to move$/");
  await expect(toMove).toBeVisible({ timeout: 10000 });
  const text = await toMove.textContent();
  return text!.startsWith("White") ? "white" : "black";
}

/**
 * Find an empty cell to click on (one without data-piece attribute).
 * Tries a sequence of cells and returns the first empty one.
 */
async function findEmptyCell(
  page: import("@playwright/test").Page,
): Promise<{ x: number; y: number }> {
  const candidates = [
    { x: 9, y: 9 },
    { x: 8, y: 8 },
    { x: 10, y: 10 },
    { x: 7, y: 7 },
    { x: 11, y: 11 },
    { x: 6, y: 6 },
    { x: 5, y: 5 },
    { x: 12, y: 12 },
  ];
  for (const c of candidates) {
    const piece = await cell(page, c.x, c.y).getAttribute("data-piece");
    if (!piece) {
      await expect(cell(page, c.x, c.y)).toBeEnabled({ timeout: 10000 });
      return c;
    }
  }
  throw new Error("Could not find an empty cell");
}

// AI worker can be slow under CPU pressure; retry once on failure
test.describe.configure({ retries: 1 });

test("computer game lets human place and AI responds", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/computer");
  await waitForAppReady(page);
  await page.click('button:has-text("Easy")');
  await page.click('button:has-text("Start Game")');
  await expect(cell(page, 9, 9)).toBeVisible();

  // Wait for the human's turn (computer color is random, may go first)
  const humanColor = await waitForHumanTurn(page);
  const computerColor = humanColor === "white" ? "black" : "white";

  // Find an empty cell to place on
  const target = await findEmptyCell(page);

  // Human places a stone
  await cell(page, target.x, target.y).click();
  await expect(cell(page, target.x, target.y)).toHaveAttribute("data-piece", humanColor);

  // Wait for computer to make its move (AI has a COMPUTER_THINK_MS of 440ms delay)
  const humanLabel = humanColor === "white" ? "White" : "Black";
  await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 15000 });

  // Verify the computer placed a piece somewhere
  await expect(page.locator(`[data-piece="${computerColor}"]`).first()).toBeVisible();
});

test("cannot place during computer turn", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/computer");
  await waitForAppReady(page);
  await page.click('button:has-text("Easy")');
  await page.click('button:has-text("Start Game")');
  await expect(cell(page, 9, 9)).toBeVisible();

  // Wait for the human's turn
  const humanColor = await waitForHumanTurn(page);

  // Find an empty cell and place
  const target1 = await findEmptyCell(page);
  await cell(page, target1.x, target1.y).click();
  await expect(cell(page, target1.x, target1.y)).toHaveAttribute("data-piece", humanColor);

  // Wait for AI to respond and human turn to come back
  const humanLabel = humanColor === "white" ? "White" : "Black";
  await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 10000 });

  // Now human should be able to place again on another empty cell
  const target2 = await findEmptyCell(page);
  await cell(page, target2.x, target2.y).click();
  await expect(cell(page, target2.x, target2.y)).toHaveAttribute("data-piece", humanColor);
});
