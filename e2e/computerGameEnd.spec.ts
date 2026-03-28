import { test, expect } from "@playwright/test";

function cell(page: import("@playwright/test").Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

test.describe("Computer game end dialog", () => {
  test("game over dialog appears with correct buttons when game ends", async ({ page }) => {
    await page.goto("/computer");

    // Select a difficulty to start the game
    await page.click('button:has-text("Easy")');
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();

    // Force a game-over state by injecting a winning score through React fiber
    // We find the React fiber from a DOM node and traverse up to find setLocalGame
    await page.evaluate(() => {
      // Find the React internal instance key on a DOM node
      const boardEl = document.querySelector('[data-testid="cell-9-9"]');
      if (!boardEl) throw new Error("Board not found");

      const fiberKey = Object.keys(boardEl).find(
        (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
      );
      if (!fiberKey) throw new Error("React fiber not found");

      // Walk up the fiber tree to find a stateNode with the game state
      let fiber = (boardEl as any)[fiberKey];
      let found = false;
      for (let i = 0; i < 50 && fiber; i++) {
        if (fiber.memoizedState) {
          // Walk the hooks linked list looking for a state hook with localGame shape
          let hook = fiber.memoizedState;
          while (hook) {
            const state = hook.memoizedState;
            if (
              state &&
              typeof state === "object" &&
              state.score &&
              typeof state.score.white === "number" &&
              state.positions
            ) {
              // Found the game state - now find the setState (queue) for this hook
              const queue = hook.queue;
              if (queue && queue.dispatch) {
                const newState = { ...state, score: { ...state.score, white: 10 } };
                queue.dispatch(newState);
                found = true;
                break;
              }
            }
            hook = hook.next;
          }
          if (found) break;
        }
        fiber = fiber.return;
      }

      if (!found) {
        throw new Error("Could not find game state in React fiber tree");
      }
    });

    // Wait for the game-over dialog to appear (600ms delay in the component)
    const dialog = page.locator(".fixed.inset-0.z-\\[300\\]");
    await expect(dialog).toBeVisible({ timeout: 3000 });

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
    await page.goto("/computer");

    // Select a difficulty to start the game
    await page.click('button:has-text("Easy")');
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();

    // Force game-over state
    await page.evaluate(() => {
      const boardEl = document.querySelector('[data-testid="cell-9-9"]');
      if (!boardEl) throw new Error("Board not found");

      const fiberKey = Object.keys(boardEl).find(
        (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
      );
      if (!fiberKey) throw new Error("React fiber not found");

      let fiber = (boardEl as any)[fiberKey];
      let found = false;
      for (let i = 0; i < 50 && fiber; i++) {
        if (fiber.memoizedState) {
          let hook = fiber.memoizedState;
          while (hook) {
            const state = hook.memoizedState;
            if (
              state &&
              typeof state === "object" &&
              state.score &&
              typeof state.score.white === "number" &&
              state.positions
            ) {
              const queue = hook.queue;
              if (queue && queue.dispatch) {
                const newState = { ...state, score: { ...state.score, white: 10 } };
                queue.dispatch(newState);
                found = true;
                break;
              }
            }
            hook = hook.next;
          }
          if (found) break;
        }
        fiber = fiber.return;
      }

      if (!found) {
        throw new Error("Could not find game state in React fiber tree");
      }
    });

    // Wait for dialog
    const dialog = page.locator(".fixed.inset-0.z-\\[300\\]");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Click "Back to lobby"
    await dialog.locator('button:has-text("Back to lobby")').click();

    // Should navigate to home
    await expect(page).toHaveURL("/");
  });
});
