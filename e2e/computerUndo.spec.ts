import { test, expect } from "@playwright/test";

function cell(page: import("@playwright/test").Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

/**
 * Wait until it's the human's turn, returning the human's color.
 * The computer color is random, so the human might be white or black.
 */
async function waitForHumanTurn(page: import("@playwright/test").Page) {
  // Wait for "Computer thinking..." to disappear first (if present)
  await expect(page.locator("text=Computer thinking")).not.toBeVisible({ timeout: 15000 });
  // Now wait for the human turn indicator
  const toMove = page.locator("text=/^(White|Black) to move$/");
  await expect(toMove).toBeVisible({ timeout: 10000 });
  const text = await toMove.textContent();
  return text!.startsWith("White") ? "white" : "black";
}

/** Count pieces of a given color on the board. */
async function countPieces(page: import("@playwright/test").Page, color: string): Promise<number> {
  return page.locator(`[data-piece="${color}"]`).count();
}

test.describe("Computer game undo", () => {
  // AI computation can be slow under load in CI
  test.describe.configure({ timeout: 60000, retries: 1 });

  test("undo removes the human piece and lets the human place again", async ({ page }) => {
    await page.goto("/computer");
    await page.click('button:has-text("Easy")');
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();

    const humanColor = await waitForHumanTurn(page);
    const humanLabel = humanColor === "white" ? "White" : "Black";

    // Count pieces before human places (computer may have already placed)
    const whiteBeforePlace = await countPieces(page, "white");
    const blackBeforePlace = await countPieces(page, "black");

    // Human places at an empty, enabled cell
    const candidates = [9, 8, 10, 7, 11, 6, 5];
    let target = { x: 9, y: 9 };
    for (const n of candidates) {
      const piece = await cell(page, n, n).getAttribute("data-piece");
      if (!piece) {
        await expect(cell(page, n, n)).toBeEnabled({ timeout: 20000 });
        target = { x: n, y: n };
        break;
      }
    }
    await cell(page, target.x, target.y).click();
    await expect(cell(page, target.x, target.y)).toHaveAttribute("data-piece", humanColor);

    // Click undo before AI responds
    await page.locator('button:has-text("Undo move")').click();

    // The piece should be removed
    await expect(cell(page, target.x, target.y)).not.toHaveAttribute("data-piece", humanColor);
    // Should be human's turn again
    await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 5000 });

    // Piece count should be back to before the human placed
    await expect(page.locator(`[data-piece="white"]`)).toHaveCount(whiteBeforePlace);
    await expect(page.locator(`[data-piece="black"]`)).toHaveCount(blackBeforePlace);
  });

  test("undo after AI responds removes the round of moves", async ({ page }) => {
    await page.goto("/computer");
    await page.click('button:has-text("Easy")');
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();

    const humanColor = await waitForHumanTurn(page);
    const computerColor = humanColor === "white" ? "black" : "white";
    const humanLabel = humanColor === "white" ? "White" : "Black";

    // Count pieces before human places
    const whiteBeforePlace = await countPieces(page, "white");
    const blackBeforePlace = await countPieces(page, "black");

    // Human places at an enabled empty cell
    const candidates = [9, 8, 10, 7, 11, 6, 5];
    let target = { x: 9, y: 9 };
    for (const n of candidates) {
      const piece = await cell(page, n, n).getAttribute("data-piece");
      if (!piece) {
        await expect(cell(page, n, n)).toBeEnabled({ timeout: 20000 });
        target = { x: n, y: n };
        break;
      }
    }
    await cell(page, target.x, target.y).click();
    await expect(cell(page, target.x, target.y)).toHaveAttribute("data-piece", humanColor);

    // Wait for AI to respond
    await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 10000 });

    // Should have at least one computer piece
    const computerPieces = await countPieces(page, computerColor);
    expect(computerPieces).toBeGreaterThan(0);

    // Undo — should remove both AI and human moves from this round
    await page.locator('button:has-text("Undo move")').click();
    await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 5000 });

    // Piece counts should be back to before the human placed
    await expect(page.locator(`[data-piece="white"]`)).toHaveCount(whiteBeforePlace, {
      timeout: 2000,
    });
    await expect(page.locator(`[data-piece="black"]`)).toHaveCount(blackBeforePlace, {
      timeout: 2000,
    });
  });

  test("multiple undo-place cycles work correctly", async ({ page }) => {
    await page.goto("/computer");
    await page.click('button:has-text("Easy")');
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();

    const humanColor = await waitForHumanTurn(page);
    const humanLabel = humanColor === "white" ? "White" : "Black";

    // Count baseline pieces
    const whiteBaseline = await countPieces(page, "white");
    const blackBaseline = await countPieces(page, "black");

    // Cycle 1: place and undo (before AI responds)
    const candidates = [9, 8, 10, 7, 11, 6, 5];
    for (const n of candidates) {
      const piece = await cell(page, n, n).getAttribute("data-piece");
      if (!piece) {
        await expect(cell(page, n, n)).toBeEnabled({ timeout: 20000 });
        await cell(page, n, n).click();
        await expect(cell(page, n, n)).toHaveAttribute("data-piece", humanColor);
        await page.locator('button:has-text("Undo move")').click();
        await expect(cell(page, n, n)).not.toHaveAttribute("data-piece", humanColor);
        break;
      }
    }
    // Wait for human turn again in case undo triggered computer-goes-first
    await waitForHumanTurn(page);

    // Record new baseline (undo may have removed computer's opening move)
    const whiteAfterCycle1 = await countPieces(page, "white");
    const blackAfterCycle1 = await countPieces(page, "black");

    // Cycle 2: place, let AI respond, then undo
    for (const n of candidates) {
      const piece = await cell(page, n, n).getAttribute("data-piece");
      if (!piece) {
        await expect(cell(page, n, n)).toBeEnabled({ timeout: 20000 });
        await cell(page, n, n).click();
        break;
      }
    }
    await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 10000 });
    await page.locator('button:has-text("Undo move")').click();

    // After undo, piece counts should match or be less than cycle1 baseline
    // (undo removes the round of moves)
    await waitForHumanTurn(page);
    const whiteAfterCycle2 = await countPieces(page, "white");
    const blackAfterCycle2 = await countPieces(page, "black");
    expect(whiteAfterCycle2).toBeLessThanOrEqual(whiteAfterCycle1);
    expect(blackAfterCycle2).toBeLessThanOrEqual(blackAfterCycle1);
  });

  test("last move indicators update correctly after undo", async ({ page }) => {
    await page.goto("/computer");
    await page.click('button:has-text("Easy")');
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();

    const humanColor = await waitForHumanTurn(page);
    const computerColor = humanColor === "white" ? "black" : "white";
    const humanLabel = humanColor === "white" ? "White" : "Black";

    // Count baseline last-move indicators (computer may have already placed)
    const baselineLastMove = await page.locator("[data-last-move]").count();

    // Human places at an enabled empty cell
    const candidates = [9, 8, 10, 7, 11, 6, 5];
    let target = { x: 9, y: 9 };
    for (const n of candidates) {
      const piece = await cell(page, n, n).getAttribute("data-piece");
      if (!piece) {
        await expect(cell(page, n, n)).toBeEnabled({ timeout: 20000 });
        target = { x: n, y: n };
        await cell(page, n, n).click();
        await expect(cell(page, n, n)).toHaveAttribute("data-piece", humanColor);
        break;
      }
    }

    // Wait for AI to respond
    await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 10000 });

    // After undo, last-move indicator should show the previous move
    // (AI's opening move if computer went first, or nothing if human went first)
    await page.locator('button:has-text("Undo move")').click();
    await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 5000 });

    const lastMoveCount = await page.locator("[data-last-move]").count();
    if (computerColor === "white") {
      // Computer went first — its opening move should be highlighted
      expect(lastMoveCount).toBeGreaterThan(0);
    } else {
      // Human went first — no moves remain after undo, no indicators
      expect(lastMoveCount).toBe(0);
    }
  });

  test("undo goes back one round, not to the beginning (no restart)", async ({ page }) => {
    await page.goto("/computer");
    await page.click('button:has-text("Easy")');
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();

    const humanColor = await waitForHumanTurn(page);
    const computerColor = humanColor === "white" ? "black" : "white";
    const humanLabel = humanColor === "white" ? "White" : "Black";

    // Round 1: human places, AI responds
    const candidates = [9, 8, 10, 7, 11, 6, 5];
    let firstTarget = { x: 9, y: 9 };
    for (const n of candidates) {
      const piece = await cell(page, n, n).getAttribute("data-piece");
      if (!piece) {
        await expect(cell(page, n, n)).toBeEnabled({ timeout: 20000 });
        firstTarget = { x: n, y: n };
        await cell(page, n, n).click();
        break;
      }
    }
    await expect(cell(page, firstTarget.x, firstTarget.y)).toHaveAttribute(
      "data-piece",
      humanColor,
    );
    // Wait for AI to respond
    await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 10000 });

    // Count pieces after round 1
    const whiteAfterRound1 = await countPieces(page, "white");
    const blackAfterRound1 = await countPieces(page, "black");

    // Round 2: human places
    let secondTarget = { x: 9, y: 9 };
    for (const n of candidates) {
      const piece = await cell(page, n, n).getAttribute("data-piece");
      if (!piece) {
        await expect(cell(page, n, n)).toBeEnabled({ timeout: 20000 });
        secondTarget = { x: n, y: n };
        await cell(page, n, n).click();
        break;
      }
    }
    await expect(cell(page, secondTarget.x, secondTarget.y)).toHaveAttribute(
      "data-piece",
      humanColor,
    );
    // Wait for AI to respond
    await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 10000 });

    // Now undo — should go back to after round 1, NOT to the beginning
    await page.locator('button:has-text("Undo move")').click();
    await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 5000 });

    // Round 1 pieces should still be on the board
    await expect(page.locator(`[data-piece="white"]`)).toHaveCount(whiteAfterRound1, {
      timeout: 2000,
    });
    await expect(page.locator(`[data-piece="black"]`)).toHaveCount(blackAfterRound1, {
      timeout: 2000,
    });

    // The first human piece should still be there
    await expect(cell(page, firstTarget.x, firstTarget.y)).toHaveAttribute(
      "data-piece",
      humanColor,
    );
  });

  test("no stale pieces remain on the board after undo during AI thinking", async ({ page }) => {
    await page.goto("/computer");
    await page.click('button:has-text("Easy")');
    await page.click('button:has-text("Start Game")');
    await expect(cell(page, 9, 9)).toBeVisible();

    const humanColor = await waitForHumanTurn(page);
    const humanLabel = humanColor === "white" ? "White" : "Black";

    // Count baseline pieces
    const whiteBaseline = await countPieces(page, "white");
    const blackBaseline = await countPieces(page, "black");

    // Place and immediately undo (AI is still thinking)
    const candidates = [9, 8, 10, 7, 11, 6, 5];
    for (const n of candidates) {
      const piece = await cell(page, n, n).getAttribute("data-piece");
      if (!piece) {
        await expect(cell(page, n, n)).toBeEnabled({ timeout: 20000 });
        await cell(page, n, n).click();
        break;
      }
    }
    // Don't wait for AI — undo right away
    await page.locator('button:has-text("Undo move")').click();

    // Board should have no more pieces than baseline (undo may remove even the computer's opening)
    await waitForHumanTurn(page);
    const whiteAfter = await countPieces(page, "white");
    const blackAfter = await countPieces(page, "black");
    expect(whiteAfter).toBeLessThanOrEqual(whiteBaseline);
    expect(blackAfter).toBeLessThanOrEqual(blackBaseline);
  });
});
