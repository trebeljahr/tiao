import { test, expect } from "@playwright/test";
import { signUpViaAPI, waitForAppReady } from "./helpers";

function uniqueName(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
}

test.describe("Spectate link always visible (#90)", () => {
  test("eye icon is visible with 0 spectators and copies spectate link on click", async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Grant clipboard permissions
    await aliceContext.grantPermissions(["clipboard-read", "clipboard-write"]);

    const aliceName = uniqueName("alice");
    const bobName = uniqueName("bob");

    await signUpViaAPI(alicePage, aliceName, "password123");
    await signUpViaAPI(bobPage, bobName, "password123");

    // Alice creates a game
    await alicePage.click('button:has-text("Create a game")');
    await alicePage.click('button:has-text("Create Game")');
    await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
    const gameUrl = alicePage.url();

    // Bob joins the game
    await bobPage.goto(gameUrl);
    await expect(bobPage.locator("text=Live match")).toBeVisible({ timeout: 10000 });

    // The spectate button should be visible even with 0 spectators.
    // When there are no spectators the button is labelled "Copy spectate link";
    // when there are it switches to "{n} spectator(s)". Use aria-label so
    // the test isn't coupled to the SVG path data.
    const eyeButton = alicePage.getByRole("button", { name: "Copy spectate link" });
    await expect(eyeButton).toBeVisible({ timeout: 5000 });

    // Click the spectate button — should copy the link to the clipboard
    await eyeButton.click();

    // Verify a toast appears confirming the link was copied
    await expect(
      alicePage
        .locator("text=Copied")
        .or(alicePage.locator("text=copied"))
        .or(alicePage.locator("text=spectate link")),
    ).toBeVisible({ timeout: 3000 });

    await aliceContext.close();
    await bobContext.close();
  });

  test("eye icon shows spectator count when spectators are present", async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const spectatorContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();
    const spectatorPage = await spectatorContext.newPage();

    const aliceName = uniqueName("alice");
    const bobName = uniqueName("bob");

    await signUpViaAPI(alicePage, aliceName, "password123");
    await signUpViaAPI(bobPage, bobName, "password123");

    // Alice creates a game
    await alicePage.click('button:has-text("Create a game")');
    await alicePage.click('button:has-text("Create Game")');
    await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
    const gameUrl = alicePage.url();

    // Bob joins the game
    await bobPage.goto(gameUrl);
    await expect(bobPage.locator("text=Live match")).toBeVisible({ timeout: 10000 });

    // Spectator visits the game
    await spectatorPage.goto(gameUrl);
    await expect(spectatorPage.locator('[data-testid="cell-9-9"]')).toBeVisible();

    // Eye icon should now show count "1" for Alice (button label switches
    // to "1 spectator" once the spectator joins the WebSocket).
    await expect(alicePage.getByRole("button", { name: "1 spectator" })).toBeVisible({
      timeout: 20_000,
    });

    await aliceContext.close();
    await bobContext.close();
    await spectatorContext.close();
  });
});
