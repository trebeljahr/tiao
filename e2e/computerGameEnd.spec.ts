import { test, expect, type Page } from "@playwright/test";
import { waitForAppReady } from "./helpers";

function cell(page: Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

/**
 * Set up a computer game in "easy" mode with the e2e test hook enabled,
 * then force a white (player) win via the hook so we don't need to play
 * out a real game.
 */
async function startGameAndForceWin(page: Page) {
  await page.goto("/computer?e2e=1");
  await waitForAppReady(page);
  await page.click('button:has-text("Easy")');
  await page.click('button:has-text("Start Game")');
  await expect(cell(page, 9, 9)).toBeVisible();

  // Wait for the test hook to register (mounted by the autostarted page)
  await page.waitForFunction(() => {
    return Boolean((window as unknown as { __tiaoComputerTest__?: unknown }).__tiaoComputerTest__);
  });

  await page.evaluate(() => {
    const w = window as unknown as { __tiaoComputerTest__?: { forceWin: () => void } };
    w.__tiaoComputerTest__!.forceWin();
  });
}

test.describe("Computer game end dialog", () => {
  test("game over dialog appears with correct buttons when game ends", async ({ page }) => {
    await startGameAndForceWin(page);

    // Wait for the game-over dialog to appear (600ms delay in the component)
    const dialog = page.locator(".fixed.inset-0.z-\\[300\\]");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Check that the dialog shows the correct title
    const title = dialog.locator("h2");
    await expect(title).toBeVisible();
    // Title should be "You won!" or "You lost!" depending on winner
    await expect(title).toHaveText(/You won!|You lost!/);

    // Check "Play again" or "Try again" button
    const playAgainBtn = dialog.locator(
      'button:has-text("Play again"), button:has-text("Try again")',
    );
    await expect(playAgainBtn).toBeVisible();

    // Check "Change difficulty" button
    await expect(dialog.locator('button:has-text("Change difficulty")')).toBeVisible();

    // Check "Back to lobby" button
    await expect(dialog.locator('button:has-text("Back to lobby")')).toBeVisible();
  });

  test("clicking Back to lobby navigates to home", async ({ page }) => {
    await startGameAndForceWin(page);

    // Wait for dialog
    const dialog = page.locator(".fixed.inset-0.z-\\[300\\]");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click "Back to lobby"
    await dialog.locator('button:has-text("Back to lobby")').click();

    // Should navigate to home
    await expect(page).toHaveURL("/");
  });
});
