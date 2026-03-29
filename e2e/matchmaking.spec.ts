import { test, expect, Page } from "@playwright/test";
import { signUpViaUI, waitForAppReady, dismissRulesIntro } from "./helpers";

// Multiplayer matchmaking tests create many browser contexts; serialize to avoid
// overwhelming the single-threaded backend with concurrent auth/signup calls.
test.describe.configure({ mode: "serial" });

async function startMatchmaking(page: Page) {
  // Navigate directly — the session cookie from signUpViaUI carries over
  await page.goto("/matchmaking", { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  // Wait for matchmaking API to respond (moves from "Initializing" to "Searching")
  await expect(page.locator("text=Searching")).toBeVisible({ timeout: 15000 });
}

async function startTimedMatchmaking(page: Page, initialMs: number, incrementMs: number) {
  await page.goto(`/matchmaking?initial=${initialMs}&increment=${incrementMs}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForAppReady(page);
  await expect(page.locator("text=Searching")).toBeVisible({ timeout: 15000 });
}

test("matchmaking pairs two players into a game", async ({ browser }) => {
  test.setTimeout(60000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  const aliceName = `mm_a_${Math.random().toString(36).slice(2, 7)}`;
  const bobName = `mm_b_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(alicePage, aliceName, "password123");
  await signUpViaUI(bobPage, bobName, "password123");

  await startMatchmaking(alicePage);
  await expect(alicePage).toHaveURL(/\/matchmaking/);
  await expect(alicePage.locator("text=Searching")).toBeVisible();

  await startMatchmaking(bobPage);

  // Both should eventually land in a game
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/, { timeout: 10000 });
  await expect(bobPage).toHaveURL(/\/game\/[A-Z0-9]{6}/, { timeout: 10000 });

  await dismissRulesIntro(alicePage);
  await dismissRulesIntro(bobPage);

  // Both should see "Live match"
  await expect(alicePage.locator("text=Live match")).toBeVisible();
  await expect(bobPage.locator("text=Live match")).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});

test("matchmaking game has no console errors", async ({ browser }) => {
  test.setTimeout(60000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  const aliceName = `mm_a_${Math.random().toString(36).slice(2, 7)}`;
  const bobName = `mm_b_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(alicePage, aliceName, "password123");
  await signUpViaUI(bobPage, bobName, "password123");

  // Collect console errors from both pages
  const aliceErrors: string[] = [];
  const bobErrors: string[] = [];
  alicePage.on("console", (msg) => {
    if (msg.type() === "error") aliceErrors.push(msg.text());
  });
  bobPage.on("console", (msg) => {
    if (msg.type() === "error") bobErrors.push(msg.text());
  });

  // Also catch uncaught page errors
  alicePage.on("pageerror", (err) => aliceErrors.push(err.message));
  bobPage.on("pageerror", (err) => bobErrors.push(err.message));

  await startMatchmaking(alicePage);
  await startMatchmaking(bobPage);

  // Both should land in a game
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/, { timeout: 10000 });
  await expect(bobPage).toHaveURL(/\/game\/[A-Z0-9]{6}/, { timeout: 10000 });

  await dismissRulesIntro(alicePage);
  await dismissRulesIntro(bobPage);

  // Wait for the game page to fully render
  await expect(alicePage.locator("text=Live match")).toBeVisible();
  await expect(bobPage.locator("text=Live match")).toBeVisible();

  // Give a moment for any deferred errors to surface
  await alicePage.waitForTimeout(1000);
  await bobPage.waitForTimeout(1000);

  // Filter out unrelated browser extension errors
  const relevantErrors = (errors: string[]) =>
    errors.filter(
      (e) => !e.includes("runtime.lastError") && !e.includes("DevTools") && !e.includes("401"),
    );

  expect(relevantErrors(aliceErrors)).toEqual([]);
  expect(relevantErrors(bobErrors)).toEqual([]);

  await aliceContext.close();
  await bobContext.close();
});

test("timed matchmaking (30+0) pairs two players", async ({ browser }) => {
  test.setTimeout(60000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  const aliceName = `mm_a_${Math.random().toString(36).slice(2, 7)}`;
  const bobName = `mm_b_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(alicePage, aliceName, "password123");
  await signUpViaUI(bobPage, bobName, "password123");

  await startTimedMatchmaking(alicePage, 1_800_000, 0);
  await expect(alicePage).toHaveURL(/\/matchmaking/);
  await expect(alicePage.locator("text=Searching")).toBeVisible();
  // Verify time control label is shown
  await expect(alicePage.locator("text=30+0")).toBeVisible();

  await startTimedMatchmaking(bobPage, 1_800_000, 0);

  // Both should land in a game
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/, { timeout: 10000 });
  await expect(bobPage).toHaveURL(/\/game\/[A-Z0-9]{6}/, { timeout: 10000 });

  await dismissRulesIntro(alicePage);
  await dismissRulesIntro(bobPage);

  await expect(alicePage.locator("text=Live match")).toBeVisible();
  await expect(bobPage.locator("text=Live match")).toBeVisible();

  await aliceContext.close();
  await bobContext.close();
});

test("cancel matchmaking returns to lobby", async ({ page }) => {
  const username = `mm_c_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(page, username, "password123");
  await startMatchmaking(page);
  await expect(page).toHaveURL(/\/matchmaking/);
  await expect(page.locator("text=Searching")).toBeVisible();

  await page.locator('button:has-text("Cancel Search")').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 5000 });
});

test("different time controls do not match each other", async ({ browser }) => {
  test.setTimeout(60000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  const aliceName = `mm_a_${Math.random().toString(36).slice(2, 7)}`;
  const bobName = `mm_b_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaUI(alicePage, aliceName, "password123");
  await signUpViaUI(bobPage, bobName, "password123");

  await startTimedMatchmaking(alicePage, 1_800_000, 0);
  await expect(alicePage).toHaveURL(/\/matchmaking/);

  // Bob searches with a different time control (5+0 = 300s, 0 increment)
  await startTimedMatchmaking(bobPage, 300_000, 0);
  await expect(bobPage).toHaveURL(/\/matchmaking/);

  // Wait a bit — neither should be matched
  await alicePage.waitForTimeout(4000);
  await expect(alicePage).toHaveURL(/\/matchmaking/);
  await expect(bobPage).toHaveURL(/\/matchmaking/);

  await aliceContext.close();
  await bobContext.close();
});
