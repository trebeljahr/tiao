import { expect, test } from "@playwright/test";
import { waitForAppReady } from "./helpers";

/**
 * The navbar only lists a subset of app routes (Lobby, Tutorial, and
 * for signed-in users: Friends, My Games, Tournaments, Achievements,
 * Shop). `/local`, `/computer`, etc. have no nav item so no link ever
 * carries aria-current — we test only the routes that actually appear
 * in the drawer.
 */
test.describe("Navbar active link attributes", () => {
  test('active nav link on / has aria-current="page"', async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);
    await page.click('[aria-label="Open navigation"]');

    const activeLink = page.locator('aside a[aria-current="page"]');
    await expect(activeLink).toBeVisible();
    await expect(activeLink).toHaveAttribute("aria-current", "page");
  });

  test("non-active nav links do not have aria-current", async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);
    await page.click('[aria-label="Open navigation"]');

    // The active link (Lobby) should be visible
    const activeLink = page.locator('aside a[aria-current="page"]');
    await expect(activeLink).toBeVisible();

    // Other nav links inside the drawer should NOT have aria-current
    const navLinks = page.locator("aside a:not([aria-current])");
    const count = await navLinks.count();
    expect(count).toBeGreaterThan(0);
  });

  test('active nav link on /tutorial has aria-current="page"', async ({ page }) => {
    await page.goto("/tutorial");
    await waitForAppReady(page);
    await page.click('[aria-label="Open navigation"]');

    const activeLink = page.locator('aside a[aria-current="page"]');
    await expect(activeLink).toBeVisible();
    await expect(activeLink).toHaveAttribute("aria-current", "page");
  });

  test("navigating from /tutorial back to / swaps the active link", async ({ page }) => {
    await page.goto("/tutorial");
    await waitForAppReady(page);
    await page.click('[aria-label="Open navigation"]');
    const tutorialActive = page.locator('aside a[aria-current="page"]');
    await expect(tutorialActive).toHaveText(/Tutorial/);

    await page.goto("/");
    await waitForAppReady(page);
    await page.click('[aria-label="Open navigation"]');
    const lobbyActive = page.locator('aside a[aria-current="page"]');
    await expect(lobbyActive).toHaveText(/Lobby/);
  });
});
