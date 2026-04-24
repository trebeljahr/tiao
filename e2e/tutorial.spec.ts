import { expect, test } from "@playwright/test";
import { waitForAppReady } from "./helpers";

// Text fragments from client/messages/en.json — kept short and distinctive
// so a minor copy tweak won't immediately break the suite.
const WELCOME_INTRO = 'Tiao (跳, Chinese for "jump")';
const PLACE_DESC_FRAGMENT = "place a new piece on an empty spot";
const CHAIN_DESC_FRAGMENT = "Chained captures make for devastating combos";
const CHAIN_DESC_DROPPED = "You can also stop early if you prefer.";

test.describe("Tutorial overlay + description flow", () => {
  test("welcome step shows description; interactive step hides it and surfaces it in the overlay", async ({
    page,
  }) => {
    await page.goto("/tutorial");
    await waitForAppReady(page);

    // --- Step 1: Welcome (non-interactive) ---
    await expect(page.getByRole("heading", { name: "Welcome to Tiao" })).toBeVisible();
    // Non-interactive steps still render their description text above the board area.
    await expect(page.getByText(WELCOME_INTRO)).toBeVisible();

    // Advance to the first interactive step.
    await page.getByRole("button", { name: /^Next/ }).click();

    // --- Step 2: Place a Piece (interactive) ---
    await expect(page.getByRole("heading", { name: "Place a Piece" })).toBeVisible();

    // The description text must appear EXACTLY ONCE on this page — inside the
    // in-board overlay — and NOT as a separate paragraph above the board.
    // (Regression guard for the "hide description on interactive steps" change.)
    const placeDesc = page.getByText(PLACE_DESC_FRAGMENT);
    await expect(placeDesc).toHaveCount(1);

    // The overlay container dims the board with a bg-black/45 backdrop.
    // We assert against its role-less text instead of a testid to stay robust.
    await expect(page.getByText("Tap anywhere to start")).toBeVisible();

    // Click on the overlay to dismiss it.
    await page.getByText(PLACE_DESC_FRAGMENT).click();

    // Dismiss hint should go away; description fragment now gone entirely.
    await expect(page.getByText("Tap anywhere to start")).not.toBeVisible();
    await expect(page.getByText(PLACE_DESC_FRAGMENT)).toHaveCount(0);
  });

  test("chain-jump step description no longer contains the 'stop early' sentence", async ({
    page,
  }) => {
    await page.goto("/tutorial");
    await waitForAppReady(page);

    // Skip directly to the Chain Jumps step via the progress dots.
    // Tree order: 1. Welcome, 2. Place, 3. Jump, 4. Chain Jumps.
    // The dot aria-label is 1-indexed via `goToStep: "Go to step {n}"`.
    await page.getByRole("button", { name: "Go to step 4" }).click();

    await expect(page.getByRole("heading", { name: "Chain Jumps" })).toBeVisible();
    await expect(page.getByText(CHAIN_DESC_FRAGMENT)).toBeVisible();
    // Hard regression guard — the dropped sentence must be gone from en/de/es.
    await expect(page.getByText(CHAIN_DESC_DROPPED)).toHaveCount(0);
  });

  test("?from=game swaps the last-step CTA for a single 'Back to your game' button", async ({
    page,
  }) => {
    // Enter the tutorial the way the multiplayer rules-intro dialog does.
    await page.goto("/tutorial?from=game");
    await waitForAppReady(page);

    // Jump to the last (summary) step via the progress dots. We query all
    // dots and click the last one so new/removed steps don't break this.
    const dots = page.getByRole("button", { name: /^Go to step \d+$/ });
    const count = await dots.count();
    await dots.nth(count - 1).click();

    // Last step heading.
    await expect(page.getByRole("heading", { name: "You're Ready!" })).toBeVisible();

    // "Back to your game →" is visible; the default CTAs are NOT.
    await expect(page.getByRole("button", { name: /Back to your game/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Play against the AI/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Or go back to the lobby/ })).toHaveCount(0);
  });

  test("without ?from=game the last step shows the default Play AI / Go to Lobby CTAs", async ({
    page,
  }) => {
    await page.goto("/tutorial");
    await waitForAppReady(page);

    const dots = page.getByRole("button", { name: /^Go to step \d+$/ });
    const count = await dots.count();
    await dots.nth(count - 1).click();

    await expect(page.getByRole("heading", { name: "You're Ready!" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Play against the AI/ })).toBeVisible();
    // "Or go back to the lobby" is a <button> (not a role=link) styled as a link.
    await expect(page.getByRole("button", { name: /Or go back to the lobby/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Back to your game/ })).toHaveCount(0);
  });
});
