import { test, expect } from '@playwright/test';

function cell(page: import('@playwright/test').Page, x: number, y: number) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

async function waitForHumanTurn(page: import('@playwright/test').Page) {
  await expect(page.locator('text=Computer thinking')).not.toBeVisible({ timeout: 15000 });
  const toMove = page.locator('text=/^(White|Black) to move$/');
  await expect(toMove).toBeVisible({ timeout: 10000 });
  const text = await toMove.textContent();
  return text!.startsWith('White') ? 'white' : 'black';
}

async function findEmptyCell(page: import('@playwright/test').Page): Promise<{ x: number; y: number } | null> {
  // Scan a spread of cells across the board
  const candidates = [
    { x: 9, y: 9 }, { x: 8, y: 8 }, { x: 10, y: 10 }, { x: 7, y: 7 },
    { x: 11, y: 11 }, { x: 6, y: 6 }, { x: 5, y: 5 }, { x: 12, y: 12 },
    { x: 4, y: 4 }, { x: 13, y: 13 }, { x: 3, y: 3 }, { x: 14, y: 14 },
    { x: 2, y: 2 }, { x: 15, y: 15 }, { x: 1, y: 1 }, { x: 16, y: 16 },
    { x: 0, y: 0 }, { x: 17, y: 17 }, { x: 18, y: 18 },
  ];
  for (const c of candidates) {
    const piece = await cell(page, c.x, c.y).getAttribute('data-piece');
    if (!piece) return c;
  }
  return null;
}

// AI worker can be slow under CPU pressure; retry once on failure
test.describe.configure({ retries: 1 });

test('AI responds correctly over multiple rounds without getting stuck', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/computer');
  await page.click('button:has-text("Easy")');
  await page.click('button:has-text("Start Game")');
  await expect(cell(page, 9, 9)).toBeVisible();

  const humanColor = await waitForHumanTurn(page);
  const humanLabel = humanColor === 'white' ? 'White' : 'Black';

  // Play several rounds — each round the human places and waits for the AI.
  // If the AI gets stuck (e.g. during a multi-jump), the "X to move" text
  // will never reappear and the test will time out.
  const rounds = 5;
  for (let i = 0; i < rounds; i++) {
    const target = await findEmptyCell(page);
    if (!target) break; // board full

    await cell(page, target.x, target.y).click();
    await expect(cell(page, target.x, target.y)).toHaveAttribute('data-piece', humanColor, { timeout: 5000 });

    // Wait for the AI to respond and the human's turn to come back
    await expect(page.locator(`text=${humanLabel} to move`)).toBeVisible({ timeout: 15000 });
  }

  // Verify the board is still interactive after multiple rounds
  const finalTarget = await findEmptyCell(page);
  expect(finalTarget).not.toBeNull();
  await cell(page, finalTarget!.x, finalTarget!.y).click();
  await expect(cell(page, finalTarget!.x, finalTarget!.y)).toHaveAttribute('data-piece', humanColor, { timeout: 5000 });
});
